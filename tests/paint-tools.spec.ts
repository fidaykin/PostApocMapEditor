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

  // Rectangle resolves each neighbour once, per-cell Paint many times, so the RNG is consumed in a different
  // order: compare resolved MASKS (edgeFaces) with the live RNG, and exact ids with Math.random stubbed constant.
  for (const mode of ['masks', 'constant-rng ids'] as const) {
    test(`Rectangle over a river equals painting the same cells one by one (${mode})`, async ({ page }) => {
      const r = await page.evaluate((mode: string) => {
        const W = MAP_WIDTH;
        const rivers = HexDB.getAll().filter((h: any) => h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0);
        const faces = (id: string) => { const e = Terrain.byHexId(id); return e && Array.isArray(e.edgeFaces) ? e.edgeFaces.slice().sort().join('') : ''; };
        const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        const origRandom = Math.random;
        const rng = (seed: number) => mode === 'masks' ? seeded(seed) : () => 0.5;
        const build = () => {
          IO.newMap(true);
          const band: any[] = [];
          for (let row = 215; row <= 233; row++) for (let col = 222; col <= 228; col++) band.push({ col, row });
          for (const p of band) mapData[p.row * W + p.col] = rivers[0].id;
          Math.random = rng(7);
          Tools.autoResolveEdgesAround(band);
        };
        const rects = [[224, 218, 226, 229], [222, 215, 228, 220], [225, 224, 225, 224], [223, 217, 227, 222]];
        const out: any[] = [];
        try {
          for (const [c1, r1, c2, r2] of rects) {
            const cells: any[] = [];
            for (let c = c1; c <= c2; c++) for (let rr = r1; rr <= r2; rr++) cells.push({ col: c, row: rr });
            build(); Math.random = rng(99); UI.selectTerrain('Plain_1');
            Tools.applyRect(c1, r1, c2, r2);
            const viaRect = mapData.slice();
            build(); Math.random = rng(99);
            for (const p of cells) Tools.applyTerrainCells([p], 'Plain_1');
            const viaPaint = mapData.slice();
            let diff = 0;
            for (let i = 0; i < viaRect.length; i++) {
              if (mode === 'masks' ? faces(viaRect[i]) !== faces(viaPaint[i]) : viaRect[i] !== viaPaint[i]) diff++;
            }
            out.push({ rect: [c1, r1, c2, r2], diff, riversLeft: viaRect.filter(v => rivers.some((h: any) => h.id === v) || faces(v)).length });
          }
        } finally { Math.random = origRandom; }
        return out;
      }, mode);
      for (const x of r) { expect(x.diff, JSON.stringify(x)).toBe(0); expect(x.riversLeft).toBeGreaterThan(0); }
    });
  }

  // K1: EdgeTiling's mask reads the legacy _DIRS tables, which differ from true hex adjacency on some heights.
  // Every cell whose mask reads a written cell must be re-resolved, under both kinds of map height.
  for (const H of [450, 452]) {
    test(`edge re-resolution reaches every cell whose mask reads the painted cell (H=${H})`, async ({ page }) => {
      const r = await page.evaluate((H: number) => {
        const oldH = MAP_HEIGHT, oldData = mapData, W = MAP_WIDTH;
        const rivers = HexDB.getAll().filter((h: any) => h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0);
        const faces = (id: string) => { const e = Terrain.byHexId(id); return e && Array.isArray(e.edgeFaces) ? e.edgeFaces.slice().sort().join('') : ''; };
        const fallback = HexDB.getAll().find((h: any) => h.id === 'Water_1').id;
        const bad: string[] = [];
        try {
          MAP_HEIGHT = H; mapData = new Array(W * H).fill('Plain_1'); invalidateSatelliteMap();
          for (const P of [{ col: 225, row: 224 }, { col: 225, row: 225 }, { col: 100, row: 100 }, { col: 100, row: 101 }]) {
            const cands = new Map<string, any>();
            for (const n of HexUtils.neighbors(P.col, P.row, W, H)) cands.set(n.col + ',' + n.row, n);
            for (const o of EdgeTiling.legacyOffsets(P.row, H)) cands.set((P.col + o[0]) + ',' + (P.row + o[1]), { col: P.col + o[0], row: P.row + o[1] });
            // legacy readers of P: cells X whose own legacy offsets include P (symmetric, but computed independently)
            for (const X of cands.values()) {
              mapData.fill('Plain_1');
              mapData[X.row * W + X.col] = fallback;                 // a stale flat tile that should become directional
              Tools.applyTerrainCells([P], rivers[0].id);
              const got = faces(mapData[X.row * W + X.col]);
              const want = faces(EdgeTiling.resolveEdgeTile(X.col, X.row, W, H, mapData, ['Water', 'Rivers'], () => 0, [fallback]));
              if (got !== want) bad.push(`P=${P.col},${P.row} X=${X.col},${X.row} got "${got}" want "${want}"`);
            }
          }
        } finally { MAP_HEIGHT = oldH; mapData = oldData; invalidateSatelliteMap(); }
        return bad;
      }, H);
      expect(r).toEqual([]);
    });
  }

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
