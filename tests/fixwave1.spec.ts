import { test, expect, Page } from '@playwright/test';
import { freshEditor, clickCell, cellPoint } from './editor-helpers';

// Phase 2 fix wave 1. W1-1: the derived footprint (satellite) map must never go stale. Every scenario here changes the
// map WITHOUT calling invalidateSatelliteMap() by hand (earlier tests hid the bug by doing exactly that).

const MULTI = 'Rabbit_Flat_1';   // anchor + 3 footprint cells

/** Independent truth: scans mapData, derives the footprints with footprintCells, compares with getSatelliteAnchor everywhere. */
const truthDiff = (page: Page): Promise<{ bad: number; anchors: number }> => page.evaluate(() => {
  const W = MAP_WIDTH, H = MAP_HEIGHT, truth = new Map<string, string>();
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const e = Terrain.byHexId(mapData[r * W + c]);
    if (!e || !Array.isArray(e.occupiedOffsets) || !e.occupiedOffsets.length) continue;
    for (const f of footprintCells(c, r, e)) if (f.col >= 0 && f.col < W && f.row >= 0 && f.row < H) truth.set(f.col + '_' + f.row, c + ',' + r);
  }
  let bad = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const a = getSatelliteAnchor(c, r);
    if ((a ? a.col + ',' + a.row : undefined) !== truth.get(c + '_' + r)) bad++;
  }
  return { bad, anchors: new Set(truth.values()).size };
});

/** Footprint cells of the anchor at (col,row) on the CURRENT map, from the geometry definition (not the cache). */
const footprintOf = (page: Page, col: number, row: number): Promise<{ col: number; row: number }[]> =>
  page.evaluate(([c, r]) => footprintCells(c, r, Terrain.byHexId('Rabbit_Flat_1')), [col, row]);

const placeCluster = (page: Page, col: number, row: number) =>
  page.evaluate(([c, r, id]) => { Tools.applyTerrainCells([{ col: c, row: r }], id); }, [col, row, MULTI] as const);

/** "Hover" = what the mouse-move does: ask the cache about cells (builds it). */
const hover = async (page: Page, col: number, row: number) => {
  const p = await cellPoint(page, col, row);
  await page.mouse.move(p.x, p.y);
  await page.evaluate(([c, r]) => { getSatelliteAnchor(c, r); }, [col, row]);
};

const hidePicker = (page: Page) => page.evaluate(() => { document.getElementById('obj-building-picker')!.style.display = 'none'; });
const spyToasts = (page: Page) => page.evaluate(() => { (window as any).__toasts = []; const t = UI.toast; UI.toast = (m: string) => { (window as any).__toasts.push(m); return t.call(UI, m); }; });
const toasts = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__toasts);

const plainJson = (n: number, anchor?: { col: number; row: number }) => ({
  width: n, height: n,
  data: Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (anchor && anchor.col === c && anchor.row === r ? 'Rabbit_Flat_1' : 'Plain_1'))),
});

test.describe('W1-1 footprint map self-validates', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('File > New: Place Building / paste / Replace work on the cells of the OLD footprint', async ({ page }) => {
    await spyToasts(page);
    await placeCluster(page, 228, 224);
    const fp = await footprintOf(page, 228, 224);
    expect(fp.length).toBeGreaterThan(0);
    await hover(page, fp[0].col, fp[0].row);                       // the cache now knows the cluster
    await page.evaluate(() => IO.newMap(true));
    await page.evaluate(() => { Canvas.centerOnCity(); });
    // Place Building on an old footprint cell
    await page.evaluate(() => { Tools.setActive('object'); Tools.selectBuilding('Artefact_Test_1'); });
    await hidePicker(page);
    await clickCell(page, fp[0].col, fp[0].row);
    expect(await page.evaluate(([c, r]) => objectsData[c + ',' + r], [fp[0].col, fp[0].row])).toBe('Artefact_Test_1');
    // paste onto another old footprint cell
    const n = await page.evaluate(([c, r]) => {
      mapData[200 * MAP_WIDTH + 200] = 'Forest_1';
      const buf = Clipboard.capture([{ col: 200, row: 200 }]);
      const n = Clipboard.place(buf, { col: c, row: r }, null, {});
      return [n, mapData[r * MAP_WIDTH + c]];
    }, [fp[1].col, fp[1].row]);
    expect(n).toEqual([1, 'Forest_1']);
    // Replace over the remaining old footprint cells
    const rep = await page.evaluate((cells) => {
      const w = Tools.replaceTerrain('Plain_1', 'Mountain_1', cells);
      return [w, cells.map((c: any) => mapData[c.row * MAP_WIDTH + c.col])];
    }, [fp[2]]);
    expect(rep).toEqual([1, ['Mountain_1']]);
    expect(await truthDiff(page)).toEqual({ bad: 0, anchors: 0 });
  });

  test('Open: a loaded cluster is protected from Replace overlap, Delete and Cut that clip its footprint', async ({ page }) => {
    await hover(page, 1, 1);                                       // the startup map's cache is warm
    await page.evaluate(j => IO.loadFromJSON(j), plainJson(60, { col: 30, row: 30 }));
    expect(await page.evaluate(() => [MAP_WIDTH, mapData[30 * MAP_WIDTH + 30]])).toEqual([60, MULTI]);
    const fp = await footprintOf(page, 30, 30);
    expect(fp.length).toBeGreaterThan(0);
    await page.evaluate(cells => { for (const c of cells) mapData[c.row * MAP_WIDTH + c.col] = 'Forest_1'; }, fp);
    // Delete / Cut of the footprint WITHOUT its anchor leaves the cells alone
    for (const op of ['deleteSelection', 'cutSelection']) {
      const r = await page.evaluate(([cells, op]) => {
        Selection.setCells(cells); (Tools as any)[op as string]();
        return (cells as any[]).map(c => mapData[c.row * MAP_WIDTH + c.col]);
      }, [fp, op] as const);
      expect(r, op).toEqual(fp.map(() => 'Forest_1'));
    }
    // Replace Plain_1 -> multi-tile all around the loaded cluster: footprints must stay disjoint (T2.11)
    await page.evaluate(() => {
      const cells = [];
      for (let r = 24; r <= 36; r++) for (let c = 24; c <= 36; c++) cells.push({ col: c, row: r });
      Tools.replaceTerrain('Plain_1', 'Rabbit_Flat_1', cells);
    });
    const res = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT, e = Terrain.byHexId('Rabbit_Flat_1'), claimed = new Map<string, string>();
      let overlap = 0, anchorsOnFootprint = 0, anchors = 0;
      const anchorSet = new Set<string>();
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (mapData[r * W + c] === 'Rabbit_Flat_1') { anchors++; anchorSet.add(c + ',' + r); }
      for (const k of anchorSet) {
        const [c, r] = k.split(',').map(Number);
        for (const f of footprintCells(c, r, e)) {
          const fk = f.col + ',' + f.row;
          if (anchorSet.has(fk)) anchorsOnFootprint++;
          if (claimed.has(fk)) overlap++;
          claimed.set(fk, k);
        }
      }
      return { overlap, anchorsOnFootprint, anchors, keptAnchor: mapData[30 * W + 30], first: mapData[25 * W + 25] };
    });
    expect(res.keptAnchor).toBe(MULTI);
    expect(res.anchors).toBeGreaterThan(1);
    expect(res.overlap).toBe(0);
    expect(res.anchorsOnFootprint).toBe(0);
    expect(await truthDiff(page)).toMatchObject({ bad: 0 });
  });

  test('the QA placer: the first Replace afterwards is planned against the placed footprints', async ({ page }) => {
    await hover(page, 1, 1);
    await page.evaluate(() => Dev.qaPlaceAllTiles());
    expect((await truthDiff(page)).anchors, 'the QA placer really placed multi-tile anchors').toBeGreaterThan(0);
    const r = await page.evaluate(() => {
      // the QA layout itself may overlap its own tiles; the invariant is that the Replace adds NO new overlap
      const count = () => {
        const W = MAP_WIDTH, H = MAP_HEIGHT, claimed = new Set<string>(); let overlap = 0;
        const anchors: any[] = [];
        for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const e = Terrain.byHexId(mapData[r * W + c]); if (e && Array.isArray(e.occupiedOffsets) && e.occupiedOffsets.length) anchors.push({ c, r, e }); }
        const anchorKeys = new Set(anchors.map(a => a.c + ',' + a.r));
        for (const a of anchors) for (const f of footprintCells(a.c, a.r, a.e)) {
          const fk = f.col + ',' + f.row;
          if (claimed.has(fk) || anchorKeys.has(fk)) overlap++;
          claimed.add(fk);
        }
        return { overlap, n: anchors.length };
      };
      const before = count();
      const cells = [];
      for (let r = 200; r <= 250; r++) for (let c = 200; c <= 250; c++) cells.push({ col: c, row: r });
      Tools.replaceTerrain('Plain_1', 'Rabbit_Flat_1', cells);
      return { before, after: count() };
    });
    expect(r.after.n, 'the Replace placed new multi-tile anchors').toBeGreaterThan(r.before.n);
    expect(r.after.overlap).toBe(r.before.overlap);
    expect(await truthDiff(page)).toMatchObject({ bad: 0 });
  });

  test('Expand Map shifts the footprints: refused on the new footprint cell, allowed on the old position', async ({ page }) => {
    await spyToasts(page);
    await page.evaluate(() => IO.loadFromJSON({ width: 60, height: 60, data: Array.from({ length: 60 }, () => Array.from({ length: 60 }, () => 'Plain_1')) }));
    await placeCluster(page, 30, 30);
    const fp0 = await footprintOf(page, 30, 30);
    await hover(page, fp0[0].col, fp0[0].row);
    await page.evaluate(() => { IO.openExpandMap(); IO.applyExpandMap(); });
    expect(await page.evaluate(() => MAP_WIDTH)).toBeGreaterThan(60);
    const at = await page.evaluate(() => { for (let i = 0; i < mapData.length; i++) if (mapData[i] === 'Rabbit_Flat_1') return { col: i % MAP_WIDTH, row: (i / MAP_WIDTH) | 0 }; return null; });
    expect(at).not.toBeNull();
    expect(at).not.toEqual({ col: 30, row: 30 });
    const fp1 = await footprintOf(page, at!.col, at!.row);
    expect(await truthDiff(page)).toMatchObject({ bad: 0 });
    await page.evaluate(() => { Canvas.centerOnCity(); Tools.setActive('object'); Tools.selectBuilding('Artefact_Test_1'); });
    await hidePicker(page);
    const key = (c: { col: number; row: number }) => c.col + ',' + c.row;
    const oldOnly = fp0.find(c => !fp1.some(d => key(d) === key(c)) && key(c) !== key(at!));
    expect(oldOnly, 'a cell that was a footprint before and is not now').toBeTruthy();
    // call the tool's own press path through the canvas events (cells may be off screen: centre the camera on them)
    const place = (c: { col: number; row: number }) => page.evaluate(([col, row]) => {
      Canvas.centerOn ? Canvas.centerOn(col, row) : null;
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), p = Canvas.hexScreenPos(col, row);
      const init = { clientX: rc.left + p.x, clientY: rc.top + p.y, button: 0, bubbles: true };
      cv.dispatchEvent(new MouseEvent('mousedown', init)); window.dispatchEvent(new MouseEvent('mouseup', init));
      return objectsData[col + ',' + row] || null;
    }, [c.col, c.row]);
    expect(await place(fp1[0])).toBeNull();                          // new footprint: refused
    expect((await toasts(page)).some(t => /footprint/i.test(t))).toBe(true);
    expect(await place(oldOnly!)).toBe('Artefact_Test_1');           // old position, plain now: allowed
  });

  test('Generator apply and Satellite apply rebuild the footprint map', async ({ page }) => {
    await placeCluster(page, 228, 224);
    await hover(page, 228, 224);
    expect((await truthDiff(page)).anchors).toBe(1);
    await page.evaluate(async () => { await Generator.apply(); });
    expect(await truthDiff(page), 'after Generator apply').toMatchObject({ bad: 0 });
    // Satellite apply
    await placeCluster(page, 228, 224);
    await hover(page, 228, 224);
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d')!;
      for (let j = 0; j < 64; j += 8) for (let i = 0; i < 64; i += 8) { x.fillStyle = `hsl(${(i * 7 + j * 3) % 360},50%,${20 + (j % 5) * 12}%)`; x.fillRect(i, j, 8, 8); }
      return c.toDataURL('image/png');
    });
    await page.evaluate(() => Satellite.open());
    await page.locator('#sat-modal input[type=file]').setInputFiles({ name: 'sat.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
    await page.waitForFunction(() => !(document.getElementById('sat-apply-btn') as HTMLButtonElement).disabled);
    await placeCluster(page, 228, 224);
    await hover(page, 228, 224);
    await page.evaluate(() => Satellite.apply());
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 228]), 'the satellite map replaced the cluster anchor').not.toBe(MULTI);
    expect(await truthDiff(page), 'after Satellite apply').toMatchObject({ bad: 0 });
  });

  test('Fill Map and zone fills rebuild the footprint map', async ({ page }) => {
    await placeCluster(page, 228, 224);
    await hover(page, 228, 224);
    await page.evaluate(() => { UI.selectTerrain('Forest_1'); IO.fillMap(); });
    await page.evaluate(() => { const b = document.getElementById('confirm-ok') as HTMLElement; if (document.getElementById('confirm-modal')!.classList.contains('open')) b.click(); });
    expect(await page.evaluate(() => mapData.every(x => x === 'Forest_1'))).toBe(true);
    expect(await truthDiff(page), 'after Fill Map').toMatchObject({ bad: 0 });
    // zone fill that overwrites a cluster anchor
    await page.evaluate(() => { mapData.fill('Plain_1'); });
    await placeCluster(page, 228, 224);
    await hover(page, 228, 224);
    await page.evaluate(() => {
      const id = ZonePainter.addZone('Z'); ZonePainter.setSelectedZoneId(id);
      const zl = ZonePainter.getZoneLayer();
      for (let r = 215; r < 235; r++) for (let c = 215; c < 235; c++) zl[r * MAP_WIDTH + c] = id;
      ZonePainter._fillAllZones();
    });
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 228]), 'the zone fill replaced the anchor').not.toBe(MULTI);
    expect(await truthDiff(page), 'after the zone fill').toMatchObject({ bad: 0 });
  });

  test('the cache key alone catches a replaced array, a resized map and a bare write-counter bump (no invalidate call at all)', async ({ page }) => {
    await placeCluster(page, 228, 224);
    await hover(page, 228, 224);
    expect((await truthDiff(page)).anchors).toBe(1);
    // 1) the array is replaced by plain assignment
    await page.evaluate(() => { mapData = new Array(MAP_WIDTH * MAP_HEIGHT).fill('Plain_1'); });
    expect(await truthDiff(page)).toEqual({ bad: 0, anchors: 0 });
    // 2) an in-place write followed ONLY by the write counter
    await page.evaluate(() => { mapData[224 * MAP_WIDTH + 228] = 'Rabbit_Flat_1'; _mapWriteSeq++; });
    expect(await truthDiff(page)).toEqual({ bad: 0, anchors: 1 });
    // 3) a resized map: same anchor index, different row stride, new array
    await page.evaluate(() => { MAP_WIDTH = 100; MAP_HEIGHT = 100; mapData = new Array(100 * 100).fill('Plain_1'); mapData[50 * 100 + 50] = 'Rabbit_Flat_1'; });
    expect(await truthDiff(page)).toEqual({ bad: 0, anchors: 1 });
    // 4) the size changes with the same array object: the stride (and so the footprint rows) changed
    await page.evaluate(() => { MAP_WIDTH = 50; MAP_HEIGHT = 200; });
    expect(await truthDiff(page)).toMatchObject({ bad: 0 });
  });

  test('a stroke of single-tile ids never rebuilds the footprint map; a multi-tile write does', async ({ page }) => {
    await placeCluster(page, 100, 100);
    const r = await page.evaluate(() => {
      getSatelliteAnchor(1, 1);
      const b0 = _satBuilds;
      for (let i = 0; i < 200; i++) Tools.applyTerrainCells([{ col: 150 + (i % 20), row: 150 + ((i / 20) | 0) }], 'Forest_1');
      const single = _satBuilds - b0;
      Tools.applyTerrainCells([{ col: 160, row: 160 }], 'Rabbit_Flat_1');
      getSatelliteAnchor(1, 1);
      const multi = _satBuilds - b0 - single;
      Tools.applyTerrainCells([{ col: 160, row: 160 }], 'Forest_1');       // overwrites the anchor: stale again
      getSatelliteAnchor(1, 1);
      return { single, multi, over: _satBuilds - b0 - single - multi };
    });
    expect(r.single).toBeLessThanOrEqual(1);
    expect(r.multi).toBeGreaterThanOrEqual(1);
    expect(r.over).toBe(1);
    expect(await truthDiff(page)).toMatchObject({ bad: 0 });
  });
});

declare const Dev: any;
