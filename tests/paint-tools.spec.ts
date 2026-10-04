import { test, expect } from '@playwright/test';
import { freshEditor, clickCell, dragCells } from './editor-helpers';

const CITY = { col: 225, row: 224 };

test.describe('terrain apply and edge re-resolution (T2.2)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('Rectangle re-resolves directional river tiles', async ({ page }) => {
    await page.evaluate(() => {
      const river = HexDB.getAll().find((h: any) => h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0);
      UI.selectTerrain(river.id); Tools.setActive('rect');
      (window as any).__resolveCalls = 0;
      const orig = EdgeTiling.resolveEdgeTile;
      EdgeTiling.resolveEdgeTile = (...a: any[]) => { (window as any).__resolveCalls++; return orig(...a); };
    });
    await dragCells(page, { col: 224, row: 222 }, { col: 226, row: 226 });
    expect(await page.evaluate(() => (window as any).__resolveCalls)).toBeGreaterThan(0);
  });

  test('painting land over a river re-resolves its directional neighbours', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH;
      const river = HexDB.getAll().find((h: any) => h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0).id;
      const c = { col: 225, row: 224 };
      const nb = HexUtils.neighbors(c.col, c.row, W, MAP_HEIGHT)[0];
      mapData[c.row * W + c.col] = river;
      mapData[nb.row * W + nb.col] = river;
      const seen: string[] = [];
      const orig = EdgeTiling.resolveEdgeTile;
      EdgeTiling.resolveEdgeTile = (col: number, row: number, ...rest: any[]) => { seen.push(col + ',' + row); return orig(col, row, ...rest); };
      Tools.applyTerrainCells([c], 'Plain_1');
      EdgeTiling.resolveEdgeTile = orig;
      return { seen, nb: nb.col + ',' + nb.row };
    });
    expect(r.seen).toContain(r.nb);
  });

  test('Rectangle over a river equals painting the same cells one by one (seeded Math.random)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH;
      const river = HexDB.getAll().filter((h: any) => h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0);
      const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const origRandom = Math.random;
      const build = () => {
        IO.newMap(true);
        // a 3-wide band of river cells crossing the area, edges resolved as Paint would
        const band: any[] = [];
        for (let row = 215; row <= 233; row++) for (let col = 222; col <= 228; col++) band.push({ col, row });
        for (const p of band) mapData[p.row * W + p.col] = river[0].id;
        Math.random = seeded(7);
        Tools.autoResolveEdgesAround(band);
      };
      const rect = { c1: 224, r1: 218, c2: 226, r2: 229 };
      const cells: any[] = [];
      for (let c = rect.c1; c <= rect.c2; c++) for (let rr = rect.r1; rr <= rect.r2; rr++) cells.push({ col: c, row: rr });
      try {
        build();
        Math.random = seeded(99);
        UI.selectTerrain('Plain_1');
        Tools.applyRect(rect.c1, rect.r1, rect.c2, rect.r2);
        const viaRect = mapData.slice();
        build();
        Math.random = seeded(99);
        for (const p of cells) Tools.applyTerrainCells([p], 'Plain_1');
        const viaPaint = mapData.slice();
        const diff = viaRect.reduce((n, v, i) => n + (v !== viaPaint[i] ? 1 : 0), 0);
        const changedByRect = viaRect.filter(v => v !== 'Plain_1' && !river.some((h: any) => h.id === v) ? true : false).length;
        const hasPlainInside = viaRect[220 * W + 225] === 'Plain_1';
        return { diff, hasPlainInside, changedByRect };
      } finally { Math.random = origRandom; }
    });
    expect(r.hasPlainInside).toBe(true);
    expect(r.diff).toBe(0);
  });

  test('Fill stays inside a hex ring and fills exactly the 7 enclosed cells', async ({ page }) => {
    const filled = await page.evaluate(async () => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const centre = HexUtils.toCube(225, 224, W, H);
      for (const p of HexUtils.cellsFromCubes(HexUtils.cubeRing(centre, 2), W, H)) mapData[p.row * W + p.col] = 'Rubble_1';
      UI.selectTerrain('Forest_1');
      await Tools.fillAt(225, 224);
      return mapData.filter(id => id === 'Forest_1').length;
    });
    expect(filled).toBe(7);
  });

  test('Paint still undoes in one step', async ({ page }) => {
    await page.evaluate(() => UI.selectTerrain('Water_1'));
    await clickCell(page, CITY.col + 2, CITY.row);
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 227])).toBe('Water_1');
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 227])).toBe('Plain_1');
  });

  test('Rectangle and Fill are one undo step each', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Forest_1'); Tools.setActive('rect'); });
    const before = await page.evaluate(() => History.undoSize());
    await dragCells(page, { col: 224, row: 222 }, { col: 226, row: 226 });
    expect(await page.evaluate(() => History.undoSize())).toBe(before + 1);
    await page.evaluate(() => { UI.selectTerrain('Hills_1'); Tools.setActive('fill'); });
    await clickCell(page, CITY.col - 4, CITY.row - 6);
    await page.evaluate(() => Tools.whenIdle());
    expect(await page.evaluate(() => History.undoSize())).toBe(before + 2);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => mapData.filter(x => x === 'Hills_1').length)).toBe(0);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => mapData.every(x => x === 'Plain_1'))).toBe(true);
  });
});
