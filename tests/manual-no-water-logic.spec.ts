import { test, expect, Page } from '@playwright/test';
import { freshEditor, clickCell, dragCells, cellPoint } from './editor-helpers';
import { openEditor } from './helpers';
import { readBaseline, setupScene, hashMapData } from './perf-scene';

// Owner decision (2026-10-07): the hand-painting tools no longer run the automatic river / lake / shore logic (edge
// re-resolution). Every manual tool writes EXACTLY the chosen tile into exactly the intended cells and changes no
// neighbouring cell; a chosen river / lake piece is placed as-is. The map generator (Generator.apply and generate-into-
// selection, Generator.applyToRegion) keeps its own edge logic.
//
// Scene (rebuilt per test on the blank 450x450 map): a 41x41 field (cols/rows 205..245) of ONE directional river piece D,
// with a radius-3 disc of flat Water_1 around (225,224). Every written cell therefore touches directional pieces, which
// the old re-resolution rewrote (Math.random is pinned so it would pick the same ids every run). Intended cell sets come
// from pixel geometry (Canvas.hexCenterWorld), grid rectangles, or the buffer's own cube offsets (HexUtils), never from
// the tool under test. Each check: (1) the written cells hold the selected id, (2) a whole-map diff against the snapshot
// taken before the gesture shows ONLY the intended cells, (3) one History.undo() restores the whole map.

const C0 = { col: 225, row: 224 };

async function scene(page: Page) {
  return page.evaluate(() => {
    const dirs = HexDB.getAll().filter((h: any) => (h.package || 'postapoc') === 'postapoc' && h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0);
    const D = dirs.find((h: any) => h.edgeFaces.length === 2)!.id;
    const P = dirs.find((h: any) => h.edgeFaces.length === 1 || h.edgeFaces.length === 3)!.id;   // a different piece, placed by hand
    const W = MAP_WIDTH;
    for (let r = 205; r <= 245; r++) for (let c = 205; c <= 245; c++) mapData[r * W + c] = D;
    (window as any).__pix = (c0: number, r0: number, R: number) => {          // hex distance by BFS over PIXEL adjacency
      const P0 = (c: number, r: number) => Canvas.hexCenterWorld(c, r);
      const dist = new Map<string, number>([[c0 + ',' + r0, 0]]);
      let frontier: [number, number][] = [[c0, r0]];
      for (let d = 1; d <= R; d++) {
        const next: [number, number][] = [];
        for (const [c, r] of frontier) {
          const p0 = P0(c, r);
          for (let dc = -2; dc <= 2; dc++) for (let dr = -2; dr <= 2; dr++) {
            const k = (c + dc) + ',' + (r + dr);
            if (dist.has(k)) continue;
            const p = P0(c + dc, r + dr);
            if (Math.abs(Math.hypot(p.x - p0.x, p.y - p0.y) - ROW_PITCH) < 1e-6) { dist.set(k, d); next.push([c + dc, r + dr]); }
          }
        }
        frontier = next;
      }
      return dist;
    };
    for (const k of (window as any).__pix(225, 224, 3).keys()) { const [c, r] = k.split(',').map(Number); mapData[r * W + c] = 'Water_1'; }
    Math.random = () => 0.999;
    Canvas.setZoom(50); Canvas.centerOnCity();         // every gesture cell (cols 210..236) is on screen
    (window as any).__before = mapData.slice();
    (window as any).__undo0 = History.undoSize();
    return { D, P };
  });
}

/** Cells whose id differs from the snapshot, as 'col,row=id', sorted. */
const diff = (page: Page) => page.evaluate(() => {
  const b = (window as any).__before as string[], W = MAP_WIDTH, out: string[] = [];
  for (let i = 0; i < mapData.length; i++) if (mapData[i] !== b[i]) out.push((i % W) + ',' + Math.floor(i / W) + '=' + mapData[i]);
  return out.sort();
});
const expectWritten = (cells: string[], id: string) => cells.map(k => k + '=' + id).sort();
const disc = (page: Page, c: number, r: number, R: number, ring = false) => page.evaluate(([c, r, R, ring]) =>
  [...(window as any).__pix(c, r, R).entries()].filter(([, d]: any) => !ring || d === R).map(([k]: any) => k) as string[], [c, r, R, ring] as any);
async function expectOneUndoRestores(page: Page) {
  expect(await page.evaluate(() => History.undoSize() - (window as any).__undo0)).toBe(1);
  await page.evaluate(() => History.undo());
  expect(await diff(page)).toEqual([]);
}

test.describe('hand tools write exactly the chosen tile, no river/lake/shore re-resolution (owner decision)', () => {
  let D = '', P = '';
  test.beforeEach(async ({ page }) => { await freshEditor(page); ({ D, P } = await scene(page)); });

  test('Paint click: flat water next to river pieces, and a river piece placed as-is', async ({ page }) => {
    await page.evaluate(() => UI.selectTerrain('Water_Dirty_1'));
    await clickCell(page, 229, 224);
    expect(await diff(page)).toEqual(expectWritten(['229,224'], 'Water_Dirty_1'));
    await expectOneUndoRestores(page);
    await page.evaluate(([p]) => { UI.selectTerrain(p); (window as any).__undo0 = History.undoSize(); }, [P]);
    await clickCell(page, 222, 224);                      // on the edge of the flat-water disc, next to D pieces
    expect(await diff(page)).toEqual(expectWritten(['222,224'], P));
  });

  test('Paint drag with brush radius 1 writes the union of the brush discs along the stroke only', async ({ page }) => {
    // the stroke runs along one row: the cells of a row are stacked one ROW_PITCH apart on a straight pixel line,
    // so the cursor passes exactly through cells (229..233, 219)
    const aligned = await page.evaluate(() => { const a = Canvas.hexCenterWorld(229, 219), b = Canvas.hexCenterWorld(233, 219); return Math.abs(a.x - b.x) < 1e-6 && Math.abs(Math.abs(a.y - b.y) - 4 * ROW_PITCH) < 1e-6; });
    expect(aligned).toBe(true);
    await page.evaluate(() => { UI.selectTerrain('Water_Dirty_1'); Brush.setSize(1); });
    await dragCells(page, { col: 229, row: 219 }, { col: 233, row: 219 });
    const want = new Set<string>();
    for (let c = 229; c <= 233; c++) for (const k of await disc(page, c, 219, 1)) want.add(k);
    expect(await diff(page)).toEqual(expectWritten([...want], 'Water_Dirty_1'));
    await expectOneUndoRestores(page);
  });

  test('Paint with brush radius 2 and mirror symmetry: both discs, nothing around them', async ({ page }) => {
    const mirror = await page.evaluate(() => {                 // the pixel mirror of (232,220) about the centre cell's x
      const mid = Canvas.hexCenterWorld(225, 224), p = Canvas.hexCenterWorld(232, 220);
      for (let c = 200; c < 250; c++) for (let r = 200; r < 250; r++) { const q = Canvas.hexCenterWorld(c, r); if (Math.abs(q.x - (2 * mid.x - p.x)) < 1e-6 && Math.abs(q.y - p.y) < 1e-6) return { col: c, row: r }; }
      return null;
    });
    expect(mirror).not.toBeNull();
    await page.evaluate(() => { UI.selectTerrain('Water_Dirty_1'); Brush.setSize(2); Tools.setSymmetry('h'); });
    await clickCell(page, 232, 220);
    await page.evaluate(() => Tools.setSymmetry('none'));
    const want = new Set([...await disc(page, 232, 220, 2), ...await disc(page, mirror!.col, mirror!.row, 2)]);
    expect(want.size).toBe(38);
    expect(await diff(page)).toEqual(expectWritten([...want], 'Water_Dirty_1'));
    await expectOneUndoRestores(page);
  });

  test('Fill: the enclosed flat water takes the chosen tile; the river pieces around it stay', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Water_Dirty_1'); Tools.setActive('fill'); });
    await clickCell(page, C0.col, C0.row);
    await page.evaluate(() => Tools.whenIdle());
    expect(await diff(page)).toEqual(expectWritten(await disc(page, C0.col, C0.row, 3), 'Water_Dirty_1'));
    await expectOneUndoRestores(page);
  });

  test('Fill with a river piece writes that piece into every filled cell', async ({ page }) => {
    await page.evaluate(([p]) => { UI.selectTerrain(p); Tools.setActive('fill'); }, [P]);
    await clickCell(page, C0.col, C0.row);
    await page.evaluate(() => Tools.whenIdle());
    expect(await diff(page)).toEqual(expectWritten(await disc(page, C0.col, C0.row, 3), P));
  });

  test('Rectangle writes exactly the grid rectangle', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Water_Dirty_1'); Tools.setActive('rect'); });
    await dragCells(page, { col: 229, row: 220 }, { col: 233, row: 223 });
    const want: string[] = [];
    for (let c = 229; c <= 233; c++) for (let r = 220; r <= 223; r++) want.push(c + ',' + r);
    expect(await diff(page)).toEqual(expectWritten(want, 'Water_Dirty_1'));
    await expectOneUndoRestores(page);
  });

  test('Line writes exactly the cells under the line', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Water_Dirty_1'); Tools.setActive('line'); });
    await dragCells(page, { col: 229, row: 219 }, { col: 234, row: 219 });     // one row: a straight pixel line through the centres
    const want: string[] = [];
    for (let c = 229; c <= 234; c++) want.push(c + ',219');
    expect(await diff(page)).toEqual(expectWritten(want, 'Water_Dirty_1'));
    await expectOneUndoRestores(page);
  });

  test('Circle writes exactly the ring', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Water_Dirty_1'); Tools.setActive('circle'); });
    const centre = { col: 234, row: 216 };
    const edge = await page.evaluate((c) => { const k = HexUtils.toCube(c.col, c.row, MAP_WIDTH, MAP_HEIGHT); return HexUtils.fromCube({ q: k.q - 2, r: k.r, s: k.s + 2 }, MAP_WIDTH, MAP_HEIGHT); }, centre);
    await dragCells(page, centre, edge);
    const ring = await disc(page, centre.col, centre.row, 2, true);
    expect(ring.length).toBe(12);
    expect(await diff(page)).toEqual(expectWritten(ring, 'Water_Dirty_1'));
    await expectOneUndoRestores(page);
  });

  test('Polygon writes exactly the filled polygon', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Water_Dirty_1'); Tools.setActive('polygon'); });
    const verts = await page.evaluate(() => {
      const a = HexUtils.toCube(230, 214, MAP_WIDTH, MAP_HEIGHT);
      return [a, { q: a.q + 4, r: a.r, s: a.s - 4 }, { q: a.q, r: a.r + 4, s: a.s - 4 }].map(c => HexUtils.fromCube(c, MAP_WIDTH, MAP_HEIGHT));
    });
    for (const v of verts) await clickCell(page, v.col, v.row);
    await page.keyboard.press('Enter');
    const want = await page.evaluate((verts) => HexUtils.polygonCells(verts.map((v: any) => HexUtils.toCube(v.col, v.row, MAP_WIDTH, MAP_HEIGHT)), MAP_WIDTH, MAP_HEIGHT, true).map((c: any) => c.col + ',' + c.row), verts);
    expect(want.length).toBeGreaterThan(10);
    expect(await diff(page)).toEqual(expectWritten(want, 'Water_Dirty_1'));
    await expectOneUndoRestores(page);
  });

  test('Scatter (density 100) writes only flat variants of the family into the brush disc, nothing around it', async ({ page }) => {
    await page.evaluate(() => {
      UI.selectTerrain('Water_Dirty_1'); Brush.setSize(1); Tools.setActive('scatter');
      (document.getElementById('scatter-density') as HTMLInputElement).value = '100';
      (document.getElementById('scatter-seed') as HTMLInputElement).value = '77';
    });
    await clickCell(page, 230, 218);
    const want = (await disc(page, 230, 218, 1)).sort();
    const d = await diff(page);
    expect(d.map(s => s.split('=')[0]).sort()).toEqual(want);
    const flatWater = await page.evaluate(() => HexDB.getAll().filter((h: any) => (h.package || 'postapoc') === 'postapoc' && h.type === 'Water' && !(h.edgeFaces || []).length).map((h: any) => h.id));
    for (const s of d) expect(flatWater).toContain(s.split('=')[1]);
    await expectOneUndoRestores(page);
  });

  test('Replace: only the matching cells change', async ({ page }) => {
    const n = await page.evaluate(() => Tools.replaceTerrain('Water_1', 'Water_Dirty_1', null, { beforeWrite: () => History.push('Replace') }));
    expect(n).toBe(37);
    expect(await diff(page)).toEqual(expectWritten(await disc(page, C0.col, C0.row, 3), 'Water_Dirty_1'));
    await expectOneUndoRestores(page);
  });

  test('Replace a river piece by another piece writes that piece as-is', async ({ page }) => {
    const cells = await disc(page, 236, 230, 1);
    await page.evaluate(([d, p, cells]) => Tools.replaceTerrain(d as string, p as string, (cells as string[]).map(k => { const [col, row] = k.split(',').map(Number); return { col, row }; })), [D, P, cells] as any);
    expect(await diff(page)).toEqual(expectWritten(cells, P));
  });

  test('Eraser resets the brush disc to Plain_1 and leaves the river pieces next to it alone', async ({ page }) => {
    await page.evaluate(() => { Brush.setSize(1); Tools.setActive('eraser'); });
    await clickCell(page, 231, 228);
    expect(await diff(page)).toEqual(expectWritten(await disc(page, 231, 228, 1), 'Plain_1'));
    await expectOneUndoRestores(page);
  });

  /** Expected cells of a buffer placed at `t`: cube(t) + (dq,dr) of each buffer cell (HexUtils), holding the buffer id. */
  const placed = (page: Page, buf: any, t: { col: number; row: number }) => page.evaluate(([buf, t]: any) => {
    const a = HexUtils.toCube(t.col, t.row, MAP_WIDTH, MAP_HEIGHT);
    return buf.cells.map((e: any) => { const c = HexUtils.fromCube({ q: a.q + e.dq, r: a.r + e.dr, s: a.s - e.dq - e.dr }, MAP_WIDTH, MAP_HEIGHT); return c.col + ',' + c.row + '=' + e.t; }).sort();
  }, [buf, t]);

  test('Paste: the pasted cells are written as copied (pieces included), the river pieces around them stay', async ({ page }) => {
    const buf = await page.evaluate(([p]) => {
      mapData[224 * MAP_WIDTH + 225] = p as string; (window as any).__before = mapData.slice();     // a piece inside the copied water
      Selection.setCells(Tools._rectCells(224, 223, 226, 225)); Tools.copySelection();
      return Clipboard.get();
    }, [P]);
    expect(buf.cells.length).toBe(9);
    await page.evaluate(() => { Tools.beginPaste(Clipboard.get()); Tools.dropFloat(234, 232); });
    expect(await diff(page)).toEqual(await placed(page, buf, { col: 234, row: 232 }));
    await expectOneUndoRestores(page);
  });

  test('Move: source cells become Plain_1, the target cells hold the lifted tiles, nothing else changes', async ({ page }) => {
    const buf = await page.evaluate(() => { Selection.setCells(Tools._rectCells(224, 223, 226, 225)); return Clipboard.capture(Selection.getCells()); });
    await page.evaluate(() => { Tools.beginMove(); Tools.dropFloat(233, 233); });
    const want = new Map<string, string>();
    for (let c = 224; c <= 226; c++) for (let r = 223; r <= 225; r++) want.set(c + ',' + r, 'Plain_1');
    for (const s of await placed(page, buf, { col: 233, row: 233 })) { const [k, id] = s.split('='); want.set(k, id); }
    const before = await page.evaluate(() => (window as any).__before as string[]);
    const W = 450;
    const exp = [...want].filter(([k, id]) => { const [c, r] = k.split(',').map(Number); return before[r * W + c] !== id; }).map(([k, id]) => k + '=' + id).sort();
    expect(await diff(page)).toEqual(exp);
    await expectOneUndoRestores(page);
  });

  test('Stamp placement writes the stamp exactly, the river pieces around it stay', async ({ page }) => {
    await page.evaluate(async (p) => {
      mapData[224 * MAP_WIDTH + 225] = p; (window as any).__before = mapData.slice();
      Selection.setCells(Tools._rectCells(224, 223, 226, 225));
      await Stamps.save('pond', Clipboard.capture(Selection.getCells()));
    }, P);
    const buf = await page.evaluate(async () => { const l = await Stamps.list(); const b = Stamps.toBuffer(l[0]); Tools.beginPaste(b); return b; });
    await page.evaluate(() => Tools.dropFloat(236, 210));
    expect(await diff(page)).toEqual(await placed(page, buf, { col: 236, row: 210 }));
    await expectOneUndoRestores(page);
  });

  test('the switch is off: Tools.AUTO_WATER_EDGES is false', async ({ page }) => {
    expect(await page.evaluate(() => (Tools as any).AUTO_WATER_EDGES)).toBe(false);
  });
});

test.describe('the generator keeps its edge logic', () => {
  test('generate into a selection still re-resolves the river pieces around the region', async ({ page }) => {
    await freshEditor(page);
    await scene(page);
    const r = await page.evaluate(async () => {
      (document.getElementById('gen-seed') as HTMLInputElement).value = '7';
      let calls = 0; const orig = EdgeTiling.resolveEdgeTile;
      EdgeTiling.resolveEdgeTile = (...a: any[]) => { calls++; return (orig as any)(...a); };
      let n = 0;
      try { n = await Generator.applyToRegion(HexUtils.discCells(232, 232, 3, MAP_WIDTH, MAP_HEIGHT), Generator._buildJob().p, 0); }
      finally { EdgeTiling.resolveEdgeTile = orig; }
      return { n, calls };
    });
    expect(r.n).toBeGreaterThan(0);
    expect(r.calls).toBeGreaterThan(0);        // the D pieces around the generated disc were re-resolved
  });

  test('seed 42 generator output is byte-identical to the baseline', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openEditor(page);
    await setupScene(page);
    await page.evaluate(() => { (document.getElementById('gen-seed') as HTMLInputElement).value = '42'; });
    await page.evaluate(async () => { await Generator.apply(); });
    expect(await hashMapData(page)).toBe(readBaseline()['generator_seed42']);   // read-only: tests/perf-baseline.json is never written here
  });
});
