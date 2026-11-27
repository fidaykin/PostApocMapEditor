import { test, expect } from '@playwright/test';
import { freshEditor, clickCell } from './editor-helpers';

// Opt-in "Auto water edges" (ClickUp 869fpav2z): river / lake pieces around written cells are re-picked from the REAL hex adjacency.
// Off by default (owner decision 2026-10-07); on, only directional pieces are rewritten.

const FACES = ['SE', 'NE', 'N', 'NW', 'SW', 'S'];                // HexUtils.CUBE_DIRS order on the drawn grid

/** In-page helpers: the neighbour of a cell in compass direction `name`, the piece id at a cell, its exits. */
const SETUP = `
window.__nb = (col, row, name) => { const i = ['SE','NE','N','NW','SW','S'].indexOf(name); const c = HexUtils.toCube(col, row, MAP_WIDTH, MAP_HEIGHT), d = HexUtils.CUBE_DIRS[i];
  return HexUtils.fromCube({ q: c.q + d.q, r: c.r + d.r, s: c.s + d.s }, MAP_WIDTH, MAP_HEIGHT); };
window.__id = (c) => mapData[c.row * MAP_WIDTH + c.col];
window.__faces = (c) => (Terrain.byHexId(window.__id(c)) || {}).edgeFaces || [];
`;

test.describe('auto water edges', () => {
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(SETUP);
    await page.evaluate(() => { localStorage.removeItem('autoWaterEdges'); Tools.setAutoWaterEdges(false); });
  });

  test('off by default: the written tile is exactly what lands and no neighbour changes', async ({ page }) => {
    expect(await page.evaluate(() => Tools.getAutoWaterEdges())).toBe(false);
    const r = await page.evaluate(() => {
      const c = { col: 225, row: 224 }, n = (window as any).__nb(225, 224, 'N');
      mapData[n.row * MAP_WIDTH + n.col] = 'River_L_1';
      mapData[c.row * MAP_WIDTH + c.col] = 'River_L_1';
      Tools.manualEdgesAround([c]);                                             // the hand-tool entry point: a no-op while the option is off
      return { north: (window as any).__id(n), centre: (window as any).__id(c) };
    });
    expect(r).toEqual({ north: 'River_L_1', centre: 'River_L_1' });
  });

  test('a straight river written cell by cell settles into pieces whose exits match the real neighbours', async ({ page }) => {
    await page.evaluate(() => Tools.setAutoWaterEdges(true));
    const r = await page.evaluate(() => {
      const w = window as any;
      const mid = { col: 225, row: 224 }, up = w.__nb(225, 224, 'N'), down = w.__nb(225, 224, 'S');
      const write = (c: any) => { mapData[c.row * MAP_WIDTH + c.col] = 'River_L_1'; Tools.resolveWaterEdges([c]); };
      write(mid); write(up); write(down);
      return { mid: w.__faces(mid), up: w.__faces(up), down: w.__faces(down), midId: w.__id(mid) };
    });
    expect([...r.mid].sort()).toEqual(['N', 'S']);                              // the middle piece runs north-south
    expect(r.up).toEqual(['S']);                                                // the north end caps towards the middle
    expect(r.down).toEqual(['N']);
  });

  test('every exit of every settled piece points at a water neighbour, on a bent river too', async ({ page }) => {
    await page.evaluate(() => Tools.setAutoWaterEdges(true));
    const bad = await page.evaluate(() => {
      const w = window as any;
      const FACES = ['SE', 'NE', 'N', 'NW', 'SW', 'S'];
      // a bent river: N, centre, SE, then SE of that
      const a = { col: 225, row: 224 }, path = [w.__nb(225, 224, 'N'), a, w.__nb(225, 224, 'SE')];
      path.push(w.__nb(path[2].col, path[2].row, 'S'));
      for (const c of path) { mapData[c.row * MAP_WIDTH + c.col] = 'River_L_1'; Tools.resolveWaterEdges([c]); }
      const wrong: string[] = [];
      for (const c of path) for (const f of w.__faces(c)) {
        const n = w.__nb(c.col, c.row, f), e = Terrain.byHexId(w.__id(n));
        if (!e || !['Water', 'Rivers'].includes(e.type)) wrong.push(`${c.col},${c.row} exit ${f} -> ${w.__id(n)}`);
      }
      return wrong;
    });
    expect(bad).toEqual([]);
  });

  test('only river and lake pieces are rewritten: plain neighbours and far pieces stay', async ({ page }) => {
    await page.evaluate(() => Tools.setAutoWaterEdges(true));
    const r = await page.evaluate(() => {
      const w = window as any;
      const c = { col: 225, row: 224 }, plainN = w.__nb(225, 224, 'N'), far = { col: 225, row: 230 };
      mapData[far.row * MAP_WIDTH + far.col] = 'River_L_1';
      mapData[c.row * MAP_WIDTH + c.col] = 'River_L_1';
      Tools.resolveWaterEdges([c]);
      return { plain: w.__id(plainN), far: w.__id(far) };
    });
    expect(r).toEqual({ plain: 'Plain_1', far: 'River_L_1' });
  });

  test('no piece fits: the cell stays as it is (no random water)', async ({ page }) => {
    await page.evaluate(() => Tools.setAutoWaterEdges(true));
    const r = await page.evaluate(() => {
      const w = window as any;
      const c = { col: 225, row: 224 };
      mapData[c.row * MAP_WIDTH + c.col] = 'River_L_1';                         // alone: nothing wanted
      Tools.resolveWaterEdges([c]);
      return w.__id(c);
    });
    expect(r).toBe('River_L_1');
  });

  test('a real stroke re-picks the neighbour and ONE undo restores both cells', async ({ page }) => {
    await page.evaluate(() => Tools.setAutoWaterEdges(true));
    const before = await page.evaluate(() => {
      const w = window as any, nb = w.__nb(225, 224, 'N');
      mapData[nb.row * MAP_WIDTH + nb.col] = 'River_L_1';                       // a lone piece north of the cell we will paint
      UI.selectTerrain('River_L_1'); Tools.setActive('paint'); Brush.setSize(0);
      return { nb, nbId: w.__id(nb) };
    });
    await clickCell(page, 225, 224);
    const after = await page.evaluate(([nb]) => { const w = window as any; return { centre: w.__id({ col: 225, row: 224 }), north: w.__id(nb), faces: w.__faces(nb) }; }, [before.nb]);
    expect(after.centre).not.toBe('Plain_1');
    expect(after.faces).toEqual(['S']);                                         // the north piece now caps towards the new cell
    await page.evaluate(() => History.undo());
    const undone = await page.evaluate(([nb]) => { const w = window as any; return { centre: w.__id({ col: 225, row: 224 }), north: w.__id(nb) }; }, [before.nb]);
    expect(undone).toEqual({ centre: 'Plain_1', north: before.nbId });
  });

  test('the quick bar toggle flips the option, is remembered, and is refused during a stroke', async ({ page }) => {
    await page.evaluate(() => QuickBar.open());
    await page.click('#qb-water');
    expect(await page.evaluate(() => Tools.getAutoWaterEdges())).toBe(true);
    await expect(page.locator('#qb-water')).toHaveClass(/active/);
    expect(await page.evaluate(() => localStorage.getItem('autoWaterEdges'))).toBe('1');
    await page.evaluate(() => Tools.setActive('eraser'));
    const p = await page.evaluate(() => { const q = Canvas.hexScreenPos(225, 230); const r = document.getElementById('map-canvas')!.getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; });
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.evaluate(() => QuickBar.toggleWaterEdges());
    expect(await page.evaluate(() => Tools.getAutoWaterEdges())).toBe(true);    // refused mid-stroke
    await page.mouse.up();
    await page.evaluate(() => QuickBar.open());
    await page.click('#qb-water');
    expect(await page.evaluate(() => Tools.getAutoWaterEdges())).toBe(false);
  });
});
