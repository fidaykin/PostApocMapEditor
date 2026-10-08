import { test, expect, Page } from '@playwright/test';
import { freshEditor, clickCell, cellPoint } from './editor-helpers';
import { openSection } from './helpers';

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


// ---------------------------------------------------------------------------------------------------------------------
// W1-2: the zone painter's bulk writers follow the bulk-writer contract of Clear Map / Fill Map.
const zoneSeed = (page: Page) => page.evaluate(() => {
  const id = ZonePainter.addZone('Z'); ZonePainter.setSelectedZoneId(id);
  const zl = ZonePainter.getZoneLayer();
  for (let r = 215; r < 235; r++) for (let c = 215; c < 235; c++) zl[r * MAP_WIDTH + c] = id;
  return id;
});
const ZONE_WRITERS = ['_fillAllZones', '_uiFillThisZone', '_randomizeFillUI'];
const fingerprint = (page: Page) => page.evaluate(() => {
  let h = 0; const zl = ZonePainter.getZoneLayer();
  for (let i = 0; i < mapData.length; i += 7) h = (h * 31 + mapData[i].charCodeAt(0) + mapData[i].length + zl[i]) | 0;
  return h + ':' + JSON.stringify(ZonePainter.getZones()) + ':' + JSON.stringify(bridgesData);
});

test.describe('W1-2 zone painter bulk writers', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); await spyToasts(page); });

  for (const w of ZONE_WRITERS) {
    test(`${w}: refused while an async fill runs (no step, nothing written, toast); works afterwards`, async ({ page }) => {
      await zoneSeed(page);
      const r = await page.evaluate(async (w) => {
        UI.selectTerrain('Forest_1'); Tools.setActive('fill');
        const p = Tools.fill(100, 100);
        const busy = Tools.isFillBusy();
        const s0 = History.undoSize(), z0 = JSON.stringify(ZonePainter.getZones()), zl0 = ZonePainter.getZoneLayer().slice();
        (ZonePainter as any)[w]();
        const out = { busy, steps: History.undoSize() - s0, zones: JSON.stringify(ZonePainter.getZones()) === z0, layer: ZonePainter.getZoneLayer().every((v: number, i: number) => v === zl0[i]) };
        await p;
        return out;
      }, w);
      expect(r.busy, 'positive control: the fill was running').toBe(true);
      expect(r).toEqual({ busy: true, steps: 0, zones: true, layer: true });
      expect((await toasts(page)).some(t => /fill is still running/i.test(t))).toBe(true);
      const s1 = await page.evaluate(() => History.undoSize());
      await page.evaluate((w) => { Tools.setActive('paint'); (ZonePainter as any)[w](); }, w);
      expect(await page.evaluate(() => History.undoSize()), 'control: the writer runs once the fill is done').toBe(s1 + 1);
    });

    test(`${w}: refused during a mouse stroke (only the stroke's own step exists)`, async ({ page }) => {
      await zoneSeed(page);
      const fp0 = await fingerprint(page), s0 = await page.evaluate(() => History.undoSize());
      const a = await cellPoint(page, 226, 224), b = await cellPoint(page, 228, 224);
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 3 });
      expect(await page.evaluate(() => Tools.isStrokeActive()), 'positive control').toBe(true);
      await page.evaluate((w) => { (ZonePainter as any)[w](); }, w);
      expect(await page.evaluate(() => History.undoSize())).toBe(s0 + 1);
      expect((await toasts(page)).some(t => /finish the current stroke/i.test(t))).toBe(true);
      await page.mouse.up();
      expect(await page.evaluate(() => History.undoSize()), 'the stroke kept its own single step').toBe(s0 + 1);
      expect(await page.evaluate(() => mapData.some((t: string) => t !== 'Plain_1')), 'the writer wrote no terrain').toBe(false);
      expect(await fingerprint(page)).toBe(fp0);
    });

    test(`${w}: cancels a lifted region (float)`, async ({ page }) => {
      await zoneSeed(page);
      const r = await page.evaluate((w) => {
        Selection.setCells([{ col: 226, row: 224 }]);
        const lifted = Tools.beginMove();
        const during = Tools.isMoving();
        (ZonePainter as any)[w]();
        return { lifted, during, after: Tools.isMoving(), pasting: Tools.isPasting(), buf: Tools.getFloatBuffer() };
      }, w);
      expect(r).toEqual({ lifted: true, during: true, after: false, pasting: false, buf: null });
    });
  }

  test('Fill Zones: bridges on repainted cells are dropped, the edge pass is asked about the written cells (a no-op: zone fills do not re-pick river pieces), footprints are kept', async ({ page }) => {
    await zoneSeed(page);
    const r = await page.evaluate(() => {
      bridgesData.push({ col: 220, row: 220, axis: 1 }, { col: 100, row: 100, axis: 1 });
      // an anchor OUTSIDE the zone whose footprint reaches INTO it: the zone fill must keep that footprint cell
      const e = Terrain.byHexId('Rabbit_Flat_1'); let pick: any = null;
      for (let c = 212; c <= 238 && !pick; c++) for (let rw = 212; rw <= 238 && !pick; rw++) {
        if (c >= 215 && c < 235 && rw >= 215 && rw < 235) continue;
        const inside = footprintCells(c, rw, e).filter((f: any) => f.col >= 215 && f.col < 235 && f.row >= 215 && f.row < 235);
        if (inside.length) pick = { c, rw, inside };
      }
      mapData[pick.rw * MAP_WIDTH + pick.c] = 'Rabbit_Flat_1'; bumpMapWrite();
      // Zone fills follow the hand-tool contract (owner decision): the finish goes through Tools.manualEdgesAround, which does
      // nothing while Tools.AUTO_WATER_EDGES is off, so no river / shore piece is re-picked (tests/zone-fill-no-water-logic.spec.ts).
      const calls: number[] = []; const orig = Tools.manualEdgesAround;
      Tools.manualEdgesAround = (t: any[]) => { calls.push(t.length); return orig(t); };
      try { ZonePainter._fillAllZones(); } finally { Tools.manualEdgesAround = orig; }
      return { pick, calls, bridges: bridgesData.map((b: any) => b.col + ',' + b.row), anchor: mapData[pick.rw * MAP_WIDTH + pick.c],
               fpTerrain: pick.inside.map((f: any) => mapData[f.row * MAP_WIDTH + f.col]), written: 400 - pick.inside.length };
    });
    expect(r.bridges).toEqual(['100,100']);
    expect(r.anchor).toBe(MULTI);
    expect(r.fpTerrain.every((t: string) => t === 'Plain_1'), 'footprint cells inside the zone keep their terrain').toBe(true);
    expect(r.calls).toEqual([r.written]);
    expect(await truthDiff(page)).toMatchObject({ bad: 0 });
  });

  test('Fill Zones keeps bridges while the objects layer is locked', async ({ page }) => {
    await zoneSeed(page);
    const n = await page.evaluate(() => { bridgesData.push({ col: 220, row: 220, axis: 1 }); Layers.setLocked('objects', true); ZonePainter._fillAllZones(); return bridgesData.length; });
    expect(n).toBe(1);
  });

  test('Generator apply cancels a lifted region', async ({ page }) => {
    const r = await page.evaluate(async () => {
      Selection.setCells([{ col: 226, row: 224 }]);
      const lifted = Tools.beginMove();
      await Generator.apply();
      return { lifted, after: Tools.isMoving(), pasting: Tools.isPasting() };
    });
    expect(r).toEqual({ lifted: true, after: false, pasting: false });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// W1-3: ids / names / sprite names that come from imported packages, shared maps and localisation files are DATA.
const P1 = '"><img src=x onerror=window.__pwn=1>';
const P2 = "');window.__pwn=1;//";
const bld = (id: string, extra: any = {}) => Object.assign({ id, spriteName: id, buildingCategory: 'Industrial', package: 'evil' }, extra);

/** Nothing executed, and no element carries an inline handler that the payload could have created. */
const noPwn = async (page: Page, where: string) => {
  await page.waitForFunction(() => Array.from(document.images).every(i => i.complete || !i.src));
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  expect(await page.evaluate(() => (window as any).__pwn), where + ': window.__pwn').toBeUndefined();
  expect(await page.evaluate(() => document.querySelectorAll('img[onerror]').length), where + ': img[onerror]').toBe(0);
};

test.describe('W1-3 untrusted ids never become markup', () => {
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(([a, b]) => {
      BldDB.addEntries([
        { id: a, spriteName: a, buildingCategory: 'Industrial', package: 'evil' },
        { id: b, spriteName: b, buildingCategory: 'Industrial', package: 'evil' },
        { id: 'Evil_Bridge_' + a, spriteName: a, buildingCategory: 'Bridge', package: 'evil' },
        { id: 'Evil_Bridge_' + b, spriteName: b, buildingCategory: 'Bridge', package: 'evil' },
      ]);
      HexDB.addEntries([{ id: a, spriteName: a, package: 'evil' }, { id: b, spriteName: b, package: 'evil' }]);
    }, [P1, P2]);
  });

  test('the building picker renders the raw id as text, executes nothing, and selecting the card selects the raw id', async ({ page }) => {
    await page.evaluate(() => Tools.setActive('object'));
    const info = await page.evaluate(([a, b]) => {
      const cards = Array.from(document.querySelectorAll('#obj-building-picker-grid .bld-card')) as HTMLElement[];
      const by = (id: string) => cards.find(c => c.dataset.bldId === id) as HTMLElement | undefined;
      return {
        n: cards.length, imgs: document.querySelectorAll('#obj-building-picker-grid img').length,
        texts: [a, b].map(id => { const c = by(id); return c ? c.querySelector('span')!.textContent : null; }),
        inlineHandlers: cards.filter(c => c.hasAttribute('onclick') || c.hasAttribute('onkeydown')).length,
        total: BldDB.getAll().filter((x: any) => x.id && x.buildingCategory !== 'Bridge' && !x.isRoad).length,
      };
    }, [P1, P2]);
    expect(info.texts).toEqual([P1, P2]);
    expect(info.n).toBe(info.total);
    expect(info.imgs, 'one img per card, nothing injected').toBe(info.n);
    expect(info.inlineHandlers).toBe(0);
    for (const id of [P1, P2]) {
      await page.evaluate(i => { (Array.from(document.querySelectorAll('#obj-building-picker-grid .bld-card')) as HTMLElement[]).find(c => c.dataset.bldId === i)!.click(); }, id);
      expect(await page.evaluate(() => Tools.getSelectedBuildingId())).toBe(id);
    }
    // keyboard selection too
    await page.evaluate(() => Tools.selectBuilding('Artefact_Test_1'));
    await page.evaluate(i => { (Array.from(document.querySelectorAll('#obj-building-picker-grid .bld-card')) as HTMLElement[]).find(c => c.dataset.bldId === i)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }, P2);
    expect(await page.evaluate(() => Tools.getSelectedBuildingId())).toBe(P2);
    await noPwn(page, 'building picker');
  });

  test('the bridge picker is safe too', async ({ page }) => {
    await page.evaluate(() => Tools.setActive('bridge'));
    const ids = await page.evaluate(() => (Array.from(document.querySelectorAll('#obj-building-picker-grid .bld-card')) as HTMLElement[]).map(c => [c.dataset.bldId, c.querySelector('span')!.textContent]));
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(ids.every(([a, b]) => a === b)).toBe(true);
    for (const id of [P1, P2].map(x => 'Evil_Bridge_' + x)) {
      expect(ids.some(([a]) => a === id)).toBe(true);
      await page.evaluate(i => { (Array.from(document.querySelectorAll('#obj-building-picker-grid .bld-card')) as HTMLElement[]).find(c => c.dataset.bldId === i)!.click(); }, id);
      expect(await page.evaluate(() => Tools.getSelectedBridgeId())).toBe(id);
    }
    await noPwn(page, 'bridge picker');
  });

  test('the Replace dialog datalist holds the raw ids as option values and nothing else', async ({ page }) => {
    await page.evaluate(() => Tools.openReplace());
    const r = await page.evaluate(() => {
      const dl = document.getElementById('replace-id-list')!;
      return { values: Array.from(dl.querySelectorAll('option')).map(o => (o as HTMLOptionElement).value), kids: dl.children.length, nonOption: Array.from(dl.children).filter(c => c.tagName !== 'OPTION').length, hexes: HexDB.getAll().length };
    });
    expect(r.nonOption).toBe(0);
    expect(r.kids).toBe(r.hexes);
    expect(r.values).toContain(P1);
    expect(r.values).toContain(P2);
    await noPwn(page, 'replace dialog');
  });

  test('zone list: hostile zone ids / names from a map file are inert', async ({ page }) => {
    await page.evaluate(([a, b]) => {
      ZonePainter.fromSaveObject({ zones: [{ id: 2, name: a, color: 'red', presetId: 'x' }, { id: b, name: b, color: 'blue', presetId: 'x' }, { id: '3', name: 'str id', presetId: 'x' }] });
      ZonePainter._uiRebuildZoneList();
    }, [P1, P2]);
    const r = await page.evaluate(() => ({
      zones: ZonePainter.getZones().map((z: any) => z.id),
      names: Array.from(document.querySelectorAll('#zone-list .zone-name')).map(n => n.textContent),
      inline: document.querySelectorAll('#zone-list [onclick]').length,
    }));
    expect(r.zones).toEqual([2]);                         // ids that are not integers 1..255 are dropped on load
    expect(r.names).toEqual([P1]);
    expect(r.inline).toBe(0);
    await page.evaluate(() => { (document.querySelector('#zone-list .zone-swatch') as HTMLElement).click(); });
    await noPwn(page, 'zone list');
  });

  test('package panel and filter chips: a hostile package id travels through data-pkg-id, not through script text', async ({ page }) => {
    // T5.1 rebuilt the PACKAGES panel with DOM APIs: its buttons carry the id as data-pkg-id and act through listeners
    // bound to the package object (no inline handler at all). The filter chips still use one fixed inline handler that
    // reads this.dataset.pkgId. Either way the hostile id must stay data: never inside script text, never markup.
    await page.evaluate(([a, b]) => {
      Packages.getAll().push({ id: b, name: a, version: '1', isDefault: false });
      Packages.renderPanel(); Packages.renderFilterChips();
    }, [P1, P2]);
    const r = await page.evaluate((b) => {
      const panel = Array.from(document.querySelectorAll('#pkg-panel button[data-pkg-id]')) as HTMLElement[];
      const chips = Array.from(document.querySelectorAll('.pkg-chip[data-pkg-id]')) as HTMLElement[];
      const inline = Array.from(document.querySelectorAll('#pkg-panel *, .pkg-chip')).flatMap(e =>
        Array.from(e.attributes).filter(a => /^on/i.test(a.name)).map(a => a.value));
      return {
        panelIds: Array.from(new Set(panel.map(x => x.dataset.pkgId))).filter(x => x === b),
        chipIds: Array.from(new Set(chips.map(x => x.dataset.pkgId))).filter(x => x === b),
        panelInline: panel.filter(x => Array.from(x.attributes).some(a => /^on/i.test(a.name))).length,
        chipHandlers: chips.map(x => x.getAttribute('onclick') || ''),
        inline,
        idText: Array.from(document.querySelectorAll('#pkg-panel tr[data-pkg] code')).map(c => c.textContent).filter(t => t === b),
        rowKeys: Array.from(document.querySelectorAll('#pkg-panel tr[data-pkg]')).map(tr => (tr as HTMLElement).dataset.pkg).filter(x => x === b),
      };
    }, P2);
    expect(r.panelIds, 'panel buttons carry the raw id as data').toEqual([P2]);
    expect(r.chipIds, 'chips carry the raw id as data').toEqual([P2]);
    expect(r.idText, 'the id is shown as text').toEqual([P2]);
    expect(r.rowKeys).toEqual([P2]);
    expect(r.panelInline, 'panel buttons have no inline handlers').toBe(0);
    expect(r.chipHandlers.length).toBeGreaterThan(0);
    expect(r.chipHandlers.every(h => h === 'Packages.togglePkgFilter(this.dataset.pkgId)'), 'chips: one fixed handler').toBe(true);
    expect(r.inline.some(h => h.includes('__pwn') || h.includes(P2)), 'no handler contains the payload').toBe(false);
    // The id reaches the code as a property: Set active on the hostile row makes exactly that id active.
    await page.evaluate((b) => {
      const tr = Array.from(document.querySelectorAll('#pkg-panel tr[data-pkg]')).find(t => (t as HTMLElement).dataset.pkg === b)!;
      (tr.querySelector('.pkg-set-active') as HTMLElement).click();
    }, P2);
    expect(await page.evaluate(() => Packages.getActive())).toBe(P2);
    await page.evaluate((b) => {
      const c = Array.from(document.querySelectorAll('.pkg-chip[data-pkg-id]')).find(x => (x as HTMLElement).dataset.pkgId === b) as HTMLElement;
      c.click();
    }, P2);
    await noPwn(page, 'package panel');
  });

  test('localisation key rows: a hostile key cannot break out of the inline handler', async ({ page }) => {
    await page.evaluate(() => { window.confirm = () => true; });   // remove() asks with a native confirm
    await page.evaluate((b) => { LocalizationKeys.add(b, 'en', 'uk'); LocalizationKeys._renderList(); }, P2);
    const rowButton = () => page.evaluate((b) => {
      const inp = Array.from(document.querySelectorAll('#loc-keys-list input[data-orig]')).find(i => (i as HTMLInputElement).value === b);
      return !!inp && !!inp.parentElement!.querySelector('button[onclick*="LocalizationKeys.remove("]');
    }, P2);
    expect(await rowButton(), 'the hostile key has its own row and remove button').toBe(true);
    await page.evaluate((b) => {
      const inp = Array.from(document.querySelectorAll('#loc-keys-list input[data-orig]')).find(i => (i as HTMLInputElement).value === b)!;
      (inp.parentElement!.querySelector('button[onclick*="LocalizationKeys.remove("]') as HTMLElement).click();
    }, P2);
    expect(await page.evaluate((b) => LocalizationKeys.getKeys().includes(b), P2), 'the click removed exactly that key').toBe(false);
    await noPwn(page, 'localisation list');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// W1-4: zone ids are map-local.
test.describe('W1-4 zone ids are map-local', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); await spyToasts(page); });
  const ZMSG = /Zones were not pasted \(copied from a different map\)/;
  const seedZones = (page: Page) => page.evaluate(() => {
    const id = ZonePainter.addZone('A'), zl = ZonePainter.getZoneLayer();
    const cells = [{ col: 220, row: 220 }, { col: 221, row: 220 }, { col: 220, row: 221 }];
    cells.forEach((c, i) => { mapData[c.row * MAP_WIDTH + c.col] = 'Forest_1'; zl[c.row * MAP_WIDTH + c.col] = id; });
    Selection.setCells(cells); Tools.copySelection();
    return id;
  });
  const replacements: Record<string, (page: Page) => Promise<void>> = {
    'File > New': p => p.evaluate(() => { IO.newMap(true); }),
    'Open (load)': p => p.evaluate(() => { IO.loadFromJSON({ width: 60, height: 60, data: Array.from({ length: 60 }, () => Array.from({ length: 60 }, () => 'Plain_1')) }); }),
    'Expand Map': p => p.evaluate(() => { IO.loadFromJSON({ width: 60, height: 60, data: Array.from({ length: 60 }, () => Array.from({ length: 60 }, () => 'Plain_1')) }); Selection.setCells([{ col: 20, row: 20 }]); }).then(async () => {
      // copy on the 60x60 map (with a zone), then expand it: the expanded map is a different map
      await p.evaluate(() => { const id = ZonePainter.addZone('B'); ZonePainter.getZoneLayer()[20 * MAP_WIDTH + 20] = id; Tools.copySelection(); IO.openExpandMap(); IO.applyExpandMap(); });
    }),
  };
  for (const [name, replace] of Object.entries(replacements)) {
    test(`${name}: pasting a buffer copied before it skips the zones, keeps the rest, and toasts once`, async ({ page }) => {
      if (name !== 'Expand Map') await seedZones(page);
      await replace(page);
      await page.evaluate(() => { window.confirm = () => true; });
      const r = await page.evaluate(() => {
        const zl = ZonePainter.getZoneLayer(), t = { col: 30, row: 30 };
        zl[30 * MAP_WIDTH + 30] = 7;                                    // a sentinel zone of the NEW map where the paste lands
        const count = () => Array.from(zl).filter((v: number) => v !== 0).length, before = count();
        const buf = Clipboard.get(), n = Clipboard.place(buf, t, null, {});
        const cell = buf.cells.find((c: any) => c.dq === 0 && c.dr === 0);
        const after = count() - before;
        return { n, sentinel: zl[30 * MAP_WIDTH + 30], zonesAfter: after, hadZone: buf.cells.some((c: any) => c.z), terrain: mapData[30 * MAP_WIDTH + 30], t: cell.t };
      });
      expect(r.hadZone, 'positive control: the buffer carries zones').toBe(true);
      expect(r.n).toBeGreaterThan(0);
      expect(r.terrain).toBe(r.t);
      expect(r.sentinel).toBe(7);
      expect(r.zonesAfter, 'no zone of the buffer reached the new map').toBe(0);
      expect((await toasts(page)).filter(t => ZMSG.test(t)).length).toBe(1);
    });
  }

  test('a rotated paste (zones carried from footprint cells) from another map also skips zones with ONE toast', async ({ page }) => {
    await page.evaluate(() => {
      const id = ZonePainter.addZone('A'), zl = ZonePainter.getZoneLayer(), W = MAP_WIDTH;
      mapData.fill('Plain_1');
      Tools.applyTerrainCells([{ col: 200, row: 200 }], 'Rabbit_Flat_1');
      const cells: any[] = [];
      for (let r = 198; r <= 202; r++) for (let c = 198; c <= 203; c++) { cells.push({ col: c, row: r }); zl[r * W + c] = id; roadsData[c + ',' + r] = { type: 'road_hex' }; }   // roads too: the carried footprint cells then reach write() with a road AND a zone
      Selection.setCells(cells); Tools.copySelection();
      IO.newMap(true);
    });
    const r = await page.evaluate(() => {
      const buf = Clipboard.get(), zl = ZonePainter.getZoneLayer();
      const n = Clipboard.place(buf, { col: 100, row: 100 }, { rot: 1, mh: false, mv: false }, {});
      return { n, zones: Array.from(zl).filter((v: number) => v !== 0).length, anchor: mapData.filter((t: string) => t === 'Rabbit_Flat_1').length, roads: Object.keys(roadsData).length };
    });
    expect(r.n).toBeGreaterThan(0);
    expect(r.anchor).toBe(1);
    expect(r.roads, 'the carried roads were pasted').toBeGreaterThan(0);
    expect(r.zones).toBe(0);
    expect((await toasts(page)).filter(t => ZMSG.test(t)).length).toBe(1);
  });

  test('same map: paste, move and cut keep the zones, no toast', async ({ page }) => {
    const id = await seedZones(page);
    const r = await page.evaluate(() => {
      const zl = ZonePainter.getZoneLayer(), buf = Clipboard.get();
      const n = Clipboard.place(buf, { col: 250, row: 250 }, null, {});
      return { n, zones: Array.from(zl).filter((v: number) => v !== 0).length };
    });
    expect(r.n).toBe(3);
    expect(r.zones).toBe(6);                                            // the 3 originals + the 3 pasted
    // move: lift the original cells and drop them elsewhere
    const m = await page.evaluate((id) => {
      const zl = ZonePainter.getZoneLayer();
      Selection.setCells([{ col: 220, row: 220 }, { col: 221, row: 220 }, { col: 220, row: 221 }]);
      Tools.beginMove();
      const buf = Tools.getFloatBuffer();
      Clipboard.place(buf, { col: 300, row: 300 }, null, {});
      return { atTarget: zl[300 * MAP_WIDTH + 300], id };
    }, id);
    expect(m.atTarget).toBe(m.id);
    expect((await toasts(page)).some(t => ZMSG.test(t))).toBe(false);
  });

  test('a stamp pastes no zones and saving a selection with zones says so', async ({ page }) => {
    await seedZones(page);
    await page.evaluate(() => { Selection.setCells([{ col: 220, row: 220 }, { col: 221, row: 220 }, { col: 220, row: 221 }]); });
    await page.evaluate(async () => { await Stamps.saveSelection(); });
    expect((await toasts(page)).some(t => /Zones are not saved in stamps/.test(t))).toBe(true);
    const r = await page.evaluate(async () => {
      const rec = (await Stamps.list())[0], buf = Stamps.toBuffer(rec), zl = ZonePainter.getZoneLayer();
      const before = Array.from(zl).filter((v: number) => v !== 0).length;
      const n = Clipboard.place(buf, { col: 250, row: 250 }, null, {});
      return { stored: rec.cells.some((c: any) => c.z !== undefined), n, grew: Array.from(zl).filter((v: number) => v !== 0).length - before, terrain: mapData[250 * MAP_WIDTH + 250] };
    });
    expect(r).toEqual({ stored: false, n: 3, grew: 0, terrain: 'Forest_1' });
    expect((await toasts(page)).some(t => ZMSG.test(t)), 'a stamp has nothing to skip: no zone toast').toBe(false);
  });

  test('a stamp file with a zone id per cell imports; the zone is ignored (still range-checked)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const mk = (z: any) => '{"format":"mapeditor-stamps","version":1,"stamps":[{"name":"s","cells":[{"dq":0,"dr":0,"t":"Forest_1","z":' + z + '}]}]}';
      const out: any = {};
      out.ok = await Stamps.importJson(mk(5));
      try { await Stamps.importJson(mk(300)); out.bad = 'imported'; } catch (e: any) { out.bad = /bad zone/.test(e.message); }
      out.stored = (await Stamps.list()).map((s: any) => s.cells.some((c: any) => 'z' in c));
      return out;
    });
    expect(r).toEqual({ ok: 1, bad: true, stored: [false] });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// W1-5: smaller integrity fixes.
test.describe('W1-5 integrity', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); await spyToasts(page); });

  test('Place Building revalidates its selection on press: a building that vanished with its package is not written', async ({ page }) => {
    await page.evaluate(() => {
      BldDB.addEntries([{ id: 'Gone_Bld_1', spriteName: 'Gone_Bld_1', buildingCategory: 'Industrial', package: 'gone' }]);
      Tools.setActive('object'); Tools.selectBuilding('Gone_Bld_1');
      document.getElementById('obj-building-picker')!.style.display = 'none';
    });
    expect(await page.evaluate(() => Tools.getSelectedBuildingId()), 'positive control: it was selected').toBe('Gone_Bld_1');
    await page.evaluate(() => { BldDB.removeByPackage('gone'); });
    const s0 = await page.evaluate(() => History.undoSize());
    await clickCell(page, 227, 224);
    expect(await page.evaluate(() => Object.keys(objectsData))).toEqual([]);
    expect(await page.evaluate(() => History.undoSize())).toBe(s0);
    expect((await toasts(page)).filter(t => /Pick a building first/.test(t)).length).toBe(1);
    expect(await page.evaluate(() => Tools.getSelectedBuildingId())).toBeNull();
    // control: a loaded building still places
    await page.evaluate(() => { Tools.selectBuilding('Artefact_Test_1'); });
    await clickCell(page, 227, 224);
    expect(await page.evaluate(() => objectsData['227,224'])).toBe('Artefact_Test_1');
  });

  test('pasting a stamp counts cells with a building that is not loaded (alone, and together with a missing tile)', async ({ page }) => {
    await page.evaluate(async () => {
      await Stamps.importJson(JSON.stringify({ format: 'mapeditor-stamps', version: 1, stamps: [
        { name: 'bld-only', cells: [{ dq: 0, dr: 0, t: 'Forest_1', o: 'Ghost_Bld_1' }, { dq: 1, dr: 0, t: 'Forest_1', o: 'Artefact_Test_1' }, { dq: 0, dr: 1, t: 'Forest_1', o: 'Ghost_Bld_2' }] },
        { name: 'both', cells: [{ dq: 0, dr: 0, t: 'NoSuch_Tile', o: 'Ghost_Bld_1' }, { dq: 1, dr: 0, t: 'Forest_1', o: 'Ghost_Bld_3' }, { dq: 0, dr: 1, t: 'Forest_1' }] },
      ] }));
      await Stamps.refresh();
    });
    await openSection(page, 'stamps');
    const place = async (name: string) => {
      await page.evaluate(() => { (window as any).__toasts.length = 0; });
      await page.locator('.stamp-row', { hasText: name }).locator('.stamp-name').click();
      return toasts(page);
    };
    expect((await place('bld-only')).filter(t => /not loaded/.test(t))).toEqual(['2 cells use buildings that are not loaded']);
    await page.keyboard.press('Escape');
    expect((await place('both')).filter(t => /not loaded/.test(t))).toEqual(['2 cells use tiles or buildings that are not loaded']);
  });

  test('ending a paste whose previous tool is unavailable (Bridge with no bridge buildings) falls back to Paint and drops the float', async ({ page }) => {
    await page.evaluate(() => {
      Tools.setActive('bridge');
      mapData[220 * MAP_WIDTH + 220] = 'Forest_1';
      Clipboard.set(Clipboard.capture([{ col: 220, row: 220 }]));
      Tools.beginPaste(Clipboard.get());
      (window as any).__orig = BldDB.getAll;
      BldDB.getAll = () => (window as any).__orig.call(BldDB).filter((b: any) => b.buildingCategory !== 'Bridge');   // the bridge package went away
    });
    expect(await page.evaluate(() => [Tools.getActive(), Tools.isPasting()]), 'positive control: pasting, previous tool = bridge').toEqual(['paste', true]);
    await page.keyboard.press('Escape');
    const r = await page.evaluate(() => { const o = [Tools.getActive(), Tools.isPasting(), Tools.getFloatBuffer()]; BldDB.getAll = (window as any).__orig; return o; });
    expect(r).toEqual(['paint', false, null]);
  });
});
