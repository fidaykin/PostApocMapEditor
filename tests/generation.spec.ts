import { test, expect } from '@playwright/test';
import { freshEditor, clickCell } from './editor-helpers';

// T3.2: generate into a selection (window mode in the worker, feathered border, bulk-writer contract).
const MARK = 'BrokenRails_1';   // a Special tile the generator never produces

async function setup(page: any) {
  await freshEditor(page);
  await page.evaluate((MARK: string) => {
    mapData.fill(MARK);
    (document.getElementById('gen-seed') as HTMLInputElement).value = '7';
  }, MARK);
}

test.describe('generate into selection (T3.2)', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('generates only inside the region, feathers the border, whole interior is new terrain', async ({ page }) => {
    const r = await page.evaluate(async (MARK: string) => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const cells = HexUtils.discCells(200, 200, 12, W, H);
      const keys = new Set<string>(cells.map((c: any) => c.col + ',' + c.row));
      const dist = HexUtils.edgeDistances(keys, W, H);
      const p = Generator._buildJob().p;
      const n = await Generator.applyToRegion(cells, p, 4);
      let outside = 0;
      for (let i = 0; i < mapData.length; i++)
        if (mapData[i] !== MARK && !keys.has((i % W) + ',' + Math.floor(i / W))) outside++;
      let edgeN = 0, edgeC = 0, inN = 0, inC = 0;
      for (const c of cells) {
        const d = dist.get(c.col + ',' + c.row), changed = mapData[c.row * W + c.col] !== MARK;
        if (d === 1) { edgeN++; if (changed) edgeC++; }
        if (d >= 6) { inN++; if (changed) inC++; }
      }
      return { n, outside, edgeN, inN, edge: edgeC / edgeN, inner: inC / inN, undo: History.undoSize() };
    }, MARK);
    expect(r.outside).toBe(0);
    expect(r.edgeN).toBeGreaterThan(20);     // the ratios below are over real populations
    expect(r.inN).toBeGreaterThan(20);
    expect(r.inner).toBeGreaterThan(0.95);
    expect(r.edge).toBeLessThan(0.6);        // weight 1/5 at the boundary
    expect(r.edge).toBeGreaterThan(0);       // ... but not nothing: feathered, not cut
    expect(r.n).toBeGreaterThan(200);
    expect(r.undo).toBeGreaterThan(0);
  });

  test('window mode: no centre flatten and no ocean falloff; default job unchanged outside window mode', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH;
      const def = MapJobs.generate(Generator._buildJob({ skipExpensive: true }));
      const win = MapJobs.generate(Generator._buildJob({ skipExpensive: true, window: true }));
      const defAgain = MapJobs.generate(Generator._buildJob({ skipExpensive: true, window: false }));
      const id = (r: any, c: number, rr: number) => r.names[r.grid[rr * W + c]];
      const water = (n: string) => /^water/i.test(n);
      let cornerDefWater = 0, cornerWinWater = 0, n = 0, centreDiff = 0, farDiff = 0, farN = 0;
      for (let rr = 0; rr < 40; rr++) for (let c = 0; c < 40; c++) { n++; if (water(id(def, c, rr))) cornerDefWater++; if (water(id(win, c, rr))) cornerWinWater++; }
      for (const cell of HexUtils.discCells(225, 224, 6, W, MAP_HEIGHT)) if (id(def, cell.col, cell.row) !== id(win, cell.col, cell.row)) centreDiff++;
      for (let c = 270; c < 300; c++) { farN++; if (id(def, c, 224) !== id(win, c, 224)) farDiff++; }
      return { n, cornerDefWater, cornerWinWater, centreDiff, farDiff, farN, same: JSON.stringify(def.names) === JSON.stringify(defAgain.names) && def.grid.every((v: number, i: number) => v === defAgain.grid[i]) };
    });
    expect(r.cornerDefWater).toBeGreaterThan(r.n * 0.15);                 // default: the corner is ocean (falloff)
    expect(r.cornerWinWater).toBeLessThan(r.cornerDefWater * 0.5);        // window: the same corner receives real terrain
    expect(r.centreDiff).toBeGreaterThan(0);          // the centre flatten is gone in window mode
    expect(r.farDiff).toBeLessThan(r.farN);           // positive control: away from both effects they agree somewhere
    expect(r.same).toBe(true);
  });

  test('blend 0 gives a hard border; undo restores the region exactly', async ({ page }) => {
    const r = await page.evaluate(async (MARK: string) => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const cells = HexUtils.discCells(200, 200, 8, W, H);
      const p = Generator._buildJob().p; p.rivers = 0;
      const u0 = History.undoSize();
      const n = await Generator.applyToRegion(cells, p, 0);
      let unchanged = 0;
      for (const c of cells) if (mapData[c.row * W + c.col] === MARK) unchanged++;
      const u1 = History.undoSize();
      History.undo();
      const restored = mapData.every((x: string) => x === MARK);
      return { n, unchanged, steps: u1 - u0, restored, size: cells.length };
    }, MARK);
    expect(r.steps).toBe(1);
    expect(r.unchanged).toBe(0);
    expect(r.n).toBe(r.size);
    expect(r.restored).toBe(true);
  });

  test('whole-map selection has weight 1: every cell is generated (mask input, blend 4)', async ({ page }) => {
    const r = await page.evaluate(async (MARK: string) => {
      const p = Generator._buildJob().p;
      const all = new Uint8Array(MAP_WIDTH * MAP_HEIGHT).fill(1);
      const n = await Generator.applyToRegion(all, p, 4);
      let left = 0; for (const x of mapData) if (x === MARK) left++;
      return { n, left, total: mapData.length };
    }, MARK);
    expect(r.left).toBe(0);                   // the brief's maths kept only ~20% here
    expect(r.n).toBe(r.total);
  });

  test('mask and cell-array inputs are equivalent and the result is seeded (rivers off)', async ({ page }) => {
    const r = await page.evaluate(async (MARK: string) => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const cells = HexUtils.discCells(220, 220, 10, W, H);
      const mask = new Uint8Array(W * H); for (const c of cells) mask[c.row * W + c.col] = 1;
      const p = Generator._buildJob().p; p.rivers = 0;
      await Generator.applyToRegion(cells, p, 3);
      const a = mapData.slice(); mapData.fill(MARK);
      await Generator.applyToRegion(mask, p, 3);
      const sameMask = a.every((x: string, i: number) => x === mapData[i]);
      mapData.fill(MARK);
      p.seed = 8;
      await Generator.applyToRegion(mask, p, 3);
      const differsBySeed = a.some((x: string, i: number) => x !== mapData[i]);
      return { sameMask, differsBySeed };
    }, MARK);
    expect(r.sameMask).toBe(true);
    expect(r.differsBySeed).toBe(true);       // positive control: the comparison can fail
  });

  test('terrain only: objects, settlements and roads inside the region stay', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const cells = HexUtils.discCells(200, 200, 6, MAP_WIDTH, MAP_HEIGHT);
      objectsData['200,200'] = 'Grain_1'; roadsData['201,200'] = { n: 1 } as any;
      settlements.push({ col: 199, row: 200, type: 'settlement' } as any);
      const sc = settlements.length, city = settlements.filter((s: any) => s.type === 'city').length;
      await Generator.applyToRegion(cells, Generator._buildJob().p, 2);
      return { obj: objectsData['200,200'], road: !!roadsData['201,200'], sc: settlements.length === sc, city: settlements.filter((s: any) => s.type === 'city').length === city };
    });
    expect(r).toEqual({ obj: 'Grain_1', road: true, sc: true, city: true });
  });

  test('locked terrain refuses (toast, no step, no change); locking during generation discards', async ({ page }) => {
    const r = await page.evaluate(async (MARK: string) => {
      const cells = HexUtils.discCells(200, 200, 6, MAP_WIDTH, MAP_HEIGHT);
      const p = Generator._buildJob().p;
      const u0 = History.undoSize();
      Layers.setLocked('terrain', true);
      const n1 = await Generator.applyToRegion(cells, p, 2);
      const pristine1 = mapData.every((x: string) => x === MARK);
      Layers.setLocked('terrain', false);
      const pr = Generator.applyToRegion(cells, p, 2);
      Layers.setLocked('terrain', true);          // locked while the worker runs
      const n2 = await pr;
      const pristine2 = mapData.every((x: string) => x === MARK);
      Layers.setLocked('terrain', false);
      const n3 = await Generator.applyToRegion(cells, p, 2);   // positive control: unlocked it writes
      return { n1, pristine1, n2, pristine2, steps: History.undoSize() - u0, n3, changed: mapData.some((x: string) => x !== MARK) };
    }, MARK);
    expect(r.n1).toBe(-1); expect(r.pristine1).toBe(true);
    expect(r.n2).toBe(-1); expect(r.pristine2).toBe(true);
    expect(r.n3).toBeGreaterThan(0); expect(r.changed).toBe(true);
    expect(r.steps).toBe(1);
  });

  test('map replaced during generation: result discarded', async ({ page }) => {
    const r = await page.evaluate(async (MARK: string) => {
      const cells = HexUtils.discCells(200, 200, 6, MAP_WIDTH, MAP_HEIGHT);
      const pr = Generator.applyToRegion(cells, Generator._buildJob().p, 2);
      IO.newMap(true); mapData.fill(MARK);
      const n = await pr;
      return { n, pristine: mapData.every((x: string) => x === MARK) };
    }, MARK);
    expect(r.n).toBe(-1); expect(r.pristine).toBe(true);
  });

  test('a running fill refuses generation (no step, no change)', async ({ page }) => {
    const r = await page.evaluate(async (MARK: string) => {
      mapData.fill('Plain_1');
      UI.selectTerrain('Forest_1'); Tools.setActive('fill');
      const f = Tools.fill(225, 225);
      const busy = Tools.isFillBusy();
      const u0 = History.undoSize();
      const n = await Generator.applyToRegion(HexUtils.discCells(100, 100, 5, MAP_WIDTH, MAP_HEIGHT), Generator._buildJob().p, 2);
      const noStep = History.undoSize() === u0;
      await f;
      return { busy, n, noStep };
    }, MARK);
    expect(r.busy).toBe(true); expect(r.n).toBe(-1); expect(r.noStep).toBe(true);
  });

  test('cells under a multi-tile footprint are skipped', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let anchored = 0, anchoredChanged = 0;
      // find a multi-tile terrain id in the DB; if none exists the test is not applicable
      const multi = HexDB.getAll().map((h: any) => h.id).find((id: string) => _isMultiTileId(id));
      if (!multi) return { multi: null, anchored, anchoredChanged };
      mapData[200 * MAP_WIDTH + 200] = multi; bumpMapWrite();
      const cells = HexUtils.discCells(200, 200, 6, MAP_WIDTH, MAP_HEIGHT);
      const foot = cells.filter((c: any) => getSatelliteAnchor(c.col, c.row));
      const before = foot.map((c: any) => mapData[c.row * MAP_WIDTH + c.col]);
      await Generator.applyToRegion(cells, Generator._buildJob().p, 0);
      foot.forEach((c: any, i: number) => { anchored++; if (mapData[c.row * MAP_WIDTH + c.col] !== before[i]) anchoredChanged++; });
      return { multi, anchored, anchoredChanged };
    });
    test.skip(!r.multi, 'no multi-tile terrain id in this build');
    expect(r.anchored).toBeGreaterThan(0);
    expect(r.anchoredChanged).toBe(0);
  });
});

test.describe('Generate dialog: only inside the selection (T3.2)', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('one undo step, nothing outside changes, modal closes', async ({ page }) => {
    await page.evaluate(() => {
      Selection.setCells(HexUtils.discCells(225, 224, 6, MAP_WIDTH, MAP_HEIGHT));
      Generator.open();
    });
    await page.check('#gen-sel-only');
    await page.fill('#gen-blend', '0');
    const before = await page.evaluate(() => History.undoSize());
    await page.click('#gen-modal .btn-primary');
    await page.waitForFunction((b: number) => History.undoSize() === b + 1, before);
    const r = await page.evaluate((MARK: string) => ({
      changed: mapData.filter((x: string) => x !== MARK).length, undo: History.undoSize(),
      open: document.getElementById('gen-modal')!.classList.contains('open'),
    }), MARK);
    expect(r.changed).toBeGreaterThan(80);
    expect(r.changed).toBeLessThanOrEqual(127 + 6 * 7);
    expect(r.undo).toBe(before + 1);
    expect(r.open).toBe(false);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate((MARK: string) => mapData.filter((x: string) => x !== MARK).length, MARK)).toBe(0);
  });

  test('empty selection: toast, no step, modal stays; unchecked box still generates the whole map', async ({ page }) => {
    await page.evaluate(() => { Selection.clear(); Generator.open(); });
    await page.check('#gen-sel-only');
    const u0 = await page.evaluate(() => History.undoSize());
    await page.click('#gen-modal .btn-primary');
    await expect(page.locator('#toast-container')).toContainText('Select a region first');
    expect(await page.evaluate(() => History.undoSize())).toBe(u0);
    expect(await page.evaluate(() => document.getElementById('gen-modal')!.classList.contains('open'))).toBe(true);
    await page.uncheck('#gen-sel-only');
    await page.click('#gen-modal .btn-primary');
    await page.waitForFunction((b: number) => History.undoSize() === b + 1, u0);
    expect(await page.evaluate((MARK: string) => mapData.filter((x: string) => x === MARK).length, MARK)).toBeLessThan(100);
  });

  test('blend label follows the slider and the controls sit inside the generator modal', async ({ page }) => {
    await page.evaluate(() => Generator.open());
    await page.locator('#gen-blend').evaluate((el: HTMLInputElement) => { el.value = '9'; el.dispatchEvent(new Event('input')); });
    await expect(page.locator('#gen-blend-v')).toHaveText('9');
    expect(await page.evaluate(() => !!document.querySelector('#gen-modal #gen-sel-only') && !document.querySelector('#toolbar #gen-sel-only'))).toBe(true);
  });
});

test.describe('Tools.guardBulkWrite (shared bulk-writer gate)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('refuses on locked layer, ok otherwise; dry run has no side effects; real run clears the road start; a lifted region is refused (float kept)', async ({ page }) => {
    await clickCellTool(page);
    const r = await page.evaluate(() => {
      const out: any = {};
      out.okUnlocked = Tools.guardBulkWrite(['terrain'], { label: 'T' });
      Layers.setLocked('roads', true);
      out.refusedLocked = Tools.guardBulkWrite(['terrain', 'roads'], { label: 'T' });
      out.okOtherLayer = Tools.guardBulkWrite(['terrain'], { label: 'T', dry: true });
      Layers.setLocked('roads', false);
      return out;
    });
    expect(r).toEqual({ okUnlocked: true, refusedLocked: false, okOtherLayer: true });
    // lifted region + Connect Road start
    const lift = await page.evaluate(() => { Selection.setCells([{ col: 225, row: 225 }]); return Tools.beginMove(); });
    expect(lift).toBe(true);
    const dry = await page.evaluate(() => ({ g: Tools.guardBulkWrite(['terrain'], { dry: true }), moving: Tools.isMoving() }));
    expect(dry.g).toBe(false);                 // a lifted region counts as a move in progress: refused, float kept
    expect(dry.moving).toBe(true);
    await page.evaluate(() => Tools.cancelFloat());
    await page.evaluate(() => Tools.setActive('road-connect'));
    await clickCell(page, 226, 225);
    expect(await page.evaluate(() => Tools.getRoadConnectStart())).not.toBeNull();
    const dry2 = await page.evaluate(() => ({ g: Tools.guardBulkWrite(['terrain'], { dry: true }), start: Tools.getRoadConnectStart() }));
    expect(dry2.g).toBe(true); expect(dry2.start).not.toBeNull();
    const real = await page.evaluate(() => ({ g: Tools.guardBulkWrite(['terrain']), start: Tools.getRoadConnectStart() }));
    expect(real.g).toBe(true); expect(real.start).toBeNull();
  });

  test('refuses while a fill runs and toasts with the label', async ({ page }) => {
    const r = await page.evaluate(async () => {
      mapData.fill('Plain_1'); UI.selectTerrain('Forest_1'); Tools.setActive('fill');
      const f = Tools.fill(225, 225);
      const g = Tools.guardBulkWrite(['terrain'], { label: 'Probe' });
      const toast = Array.from(document.querySelectorAll('#toast-container .toast')).map(t => t.textContent).join('|');
      await f;
      return { g, toast, after: Tools.guardBulkWrite(['terrain']) };
    });
    expect(r.g).toBe(false); expect(r.toast).toContain('Probe: a fill is still running'); expect(r.after).toBe(true);
  });
});

async function clickCellTool(page: any) { await page.evaluate(() => Tools.setActive('paint')); }

// T3.3: heightmap maths (gen-utils.js). Orientation references come from the rendered world geometry
// (Canvas.hexCenterWorld: Unity axis flip, col<->worldY, row<->worldX, stagger parity from floor(H/2)), not from the
// index formula inside GenUtils.resampleToMap.
test.describe('heightmap maths (T3.3)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  // helper source shared by the tests: builds a w*h luminance grid from a predicate, and the world-geometry frame
  const FRAME = `
    const W = MAP_WIDTH, H = MAP_HEIGHT;
    const mk = (w, h, v) => { const px = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; px[i] = px[i+1] = px[i+2] = v(x, y); px[i+3] = 255; }
      return GenUtils.luminanceGrid(px, w, h); };
    const pos = new Array(W * H);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const w = Canvas.hexCenterWorld(c, r); pos[r * W + c] = w;
      if (w.x < minX) minX = w.x; if (w.x > maxX) maxX = w.x; if (w.y < minY) minY = w.y; if (w.y > maxY) maxY = w.y; }
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  `;

  test('a half-bright image splits at the world midline on screen (west-left, north-top, stagger-exact)', async ({ page }) => {
    const r = await page.evaluate(`(() => { ${FRAME}
      const left = GenUtils.resampleToMap(mk(2, 1, x => x === 0 ? 255 : 0), 2, 1, W, H);   // west half bright
      const top  = GenUtils.resampleToMap(mk(1, 2, (x, y) => y === 0 ? 255 : 0), 1, 2, W, H); // north half bright
      const bad = { left: 0, top: 0 }, seen = { l1: 0, l0: 0, t1: 0, t0: 0 };
      for (let i = 0; i < W * H; i++) {
        const p = pos[i];
        if (Math.abs(p.x - midX) > 1e-6) { const want = p.x < midX ? 255 : 0; if (left[i] !== want) bad.left++; seen[want ? 'l1' : 'l0']++; }
        if (Math.abs(p.y - midY) > 1e-6) { const want = p.y < midY ? 255 : 0; if (top[i] !== want) bad.top++; seen[want ? 't1' : 't0']++; }
      }
      return { bad, seen };
    })()`);
    expect(r.bad).toEqual({ left: 0, top: 0 });
    for (const k of ['l1', 'l0', 't1', 't0']) expect((r.seen as any)[k]).toBeGreaterThan(50000);   // positive control: both halves populated
  });

  test('a single bright pixel lands at its world position (quadrant check: x and y are not swapped or mirrored)', async ({ page }) => {
    const r = await page.evaluate(`(() => { ${FRAME}
      const out = [];
      for (const [px, py] of [[2, 7], [8, 1], [0, 0], [9, 9]]) {
        const g = GenUtils.resampleToMap(mk(10, 10, (x, y) => (x === px && y === py) ? 255 : 0), 10, 10, W, H);
        let sx = 0, sy = 0, n = 0;
        for (let i = 0; i < W * H; i++) if (g[i] > 127) { sx += pos[i].x; sy += pos[i].y; n++; }
        // expected world position: the image rectangle is the cells' bounding box (centres +/- half a hex)
        const hexHalfW = HEX_SIZE, hexHalfH = ROW_PITCH / 2;   // flat-top hex: circumradius wide, row pitch tall
        const left = minX - hexHalfW, top = minY - hexHalfH, wid = maxX - minX + 2 * hexHalfW, hei = maxY - minY + 2 * hexHalfH;
        out.push({ n, dx: sx / n - (left + (px + 0.5) / 10 * wid), dy: sy / n - (top + (py + 0.5) / 10 * hei), tolX: wid / 10, tolY: hei / 10 });
      }
      return out;
    })()`);
    for (const o of r as any[]) {
      expect(o.n).toBeGreaterThan(1000);                      // positive control: the pixel actually covers cells
      expect(Math.abs(o.dx)).toBeLessThan(o.tolX * 0.15);     // centroid within 15% of an image pixel
      expect(Math.abs(o.dy)).toBeLessThan(o.tolY * 0.15);
    }
  });

  test('a fine ramp image reproduces each cell\'s world position (stagger parity from floor(H/2) included)', async ({ page }) => {
    const r = await page.evaluate(`(() => { ${FRAME}
      const N = 4000, hexHalfW = HEX_SIZE, hexHalfH = ROW_PITCH / 2;
      const top = minY - hexHalfH, hei = maxY - minY + 2 * hexHalfH, left = minX - hexHalfW, wid = maxX - minX + 2 * hexHalfW;
      const rampY = GenUtils.resampleToMap(mk(1, N, () => 0).map((_, i) => i), 1, N, W, H);   // value = image row index
      const rampX = GenUtils.resampleToMap(Float32Array.from({ length: N }, (_, i) => i), N, 1, W, H);   // value = image column index
      let worstY = 0, worstX = 0;
      for (let i = 0; i < W * H; i++) {
        worstY = Math.max(worstY, Math.abs(rampY[i] + 0.5 - (pos[i].y - top) / hei * N));
        worstX = Math.max(worstX, Math.abs(rampX[i] + 0.5 - (pos[i].x - left) / wid * N));
      }
      return { worstY, worstX };
    })()`);
    // nearest-neighbour: within one image pixel of the exact world position (a half-pitch stagger error would be ~N/(2W) = 4.4 px)
    expect(r.worstY).toBeLessThan(1.01);
    expect(r.worstX).toBeLessThan(1.01);
  });

  test('luminance weights, normalize (flat flag), applySeaLevel clamp', async ({ page }) => {
    const r = await page.evaluate(() => {
      const lum = GenUtils.luminanceGrid(Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), 3, 1);
      const n = GenUtils.normalize(Float32Array.from([10, 20, 30]));
      const flat = GenUtils.normalize(new Float32Array(5));
      const sea = GenUtils.applySeaLevel(Float32Array.from([0.1, 0.5, 0.9]), 0.2);
      const neg = GenUtils.applySeaLevel(Float32Array.from([0.1, 0.9]), -0.3);
      return { lum: Array.from(lum), grid: Array.from(n.grid), nflat: n.flat, flatFlag: flat.flat, flatVals: Array.from(flat.grid), sea: Array.from(sea), neg: Array.from(neg) };
    });
    expect(r.lum[0]).toBeCloseTo(0.299 * 255, 3);
    expect(r.lum[1]).toBeCloseTo(0.587 * 255, 3);
    expect(r.lum[2]).toBeCloseTo(0.114 * 255, 3);
    expect(r.grid).toEqual([0, 0.5, 1]);
    expect(r.nflat).toBe(false);
    expect(r.flatFlag).toBe(true);
    expect(r.flatVals).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(r.sea[0]).toBe(0);
    expect(r.sea[1]).toBeCloseTo(0.3, 5);
    expect(r.sea[2]).toBeCloseTo(0.7, 5);
    expect(r.neg[0]).toBeCloseTo(0.4, 5);
    expect(r.neg[1]).toBe(1);
  });

  test('resampling a huge image costs only W*H samples (work counter via Proxy, no wall clock)', async ({ page }) => {
    const r = await page.evaluate(() => {
      let reads = 0;
      const sw = 8000, sh = 6000;
      const src = new Proxy({ length: sw * sh }, { get(t: any, k: any) { if (typeof k === 'string' && /^\d+$/.test(k)) { reads++; return 0.5; } return t[k]; } });
      const out = GenUtils.resampleToMap(src as any, sw, sh, MAP_WIDTH, MAP_HEIGHT);
      return { reads, len: out.length, W: MAP_WIDTH * MAP_HEIGHT };
    });
    expect(r.len).toBe(r.W);
    expect(r.reads).toBe(r.W);
  });
});

// T3.4: Import Elevation in the Generator (modal only). File contents are untrusted: validation before reading, DOM APIs only.
test.describe('Import Elevation (T3.4)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  // dark west -> bright east gradient PNG, made in the page; returns a data URL
  const gradientPng = (page: any, w = 64, h = 64) => page.evaluate(({ w, h }: any) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#000'); grad.addColorStop(1, '#fff');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    return cv.toDataURL('image/png');
  }, { w, h });

  const importDataUrl = (page: any, url: string, name = 'h.png') => page.evaluate(async ({ url, name }: any) => {
    const blob = await (await fetch(url)).blob();
    await Generator.importElevation(new File([blob], name, { type: 'image/png' }));
  }, { url, name });

  const toasts = (page: any): Promise<string[]> => page.evaluate(() => [...document.querySelectorAll('#toast-container .toast')].map(t => t.textContent || ''));

  test('imported elevation is east-bright by world geometry and the sea level moves the coastline', async ({ page }) => {
    await importDataUrl(page, await gradientPng(page));
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const eo = Generator._buildJob().p.elevOverride;
      let sE = 0, nE = 0, sW = 0, nW = 0, minX = Infinity, maxX = -Infinity;
      for (let i = 0; i < W * H; i++) { const x = Canvas.hexCenterWorld(i % W, Math.floor(i / W)).x; if (x < minX) minX = x; if (x > maxX) maxX = x; }
      const mid = (minX + maxX) / 2;
      for (let i = 0; i < W * H; i++) { const x = Canvas.hexCenterWorld(i % W, Math.floor(i / W)).x; if (x > mid) { sE += eo[i]; nE++; } else { sW += eo[i]; nW++; } }
      const water = (sea: number) => {
        (document.getElementById('gen-sea') as HTMLInputElement).value = String(sea);
        const job = Generator._buildJob({ skipExpensive: true }); job.p.rivers = 0;
        const res = MapJobs.generate(job);
        let w = 0;
        for (let i = 0; i < res.grid.length; i++) { const e = Terrain.byHexId(res.names[res.grid[i]]); if (e && e.type === 'Water') w++; }
        return w / res.grid.length;
      };
      return { has: Generator.hasElevation(), len: eo.length, east: sE / nE, west: sW / nW, low: water(-0.3), mid: water(0), high: water(0.3) };
    });
    expect(r.has).toBe(true);
    expect(r.len).toBe(450 * 450);
    expect(r.east).toBeGreaterThan(r.west + 0.4);
    expect(r.low).toBeLessThan(r.mid);          // positive control: sea level really changes the water share, both directions
    expect(r.mid).toBeLessThan(r.high);
    expect(r.high - r.low).toBeGreaterThan(0.2);
  });

  test('the worker honours elevOverride and agrees with the main-thread job; default output carries no override', async ({ page }) => {
    const none = await page.evaluate(() => Generator._buildJob().p.elevOverride ?? null);
    expect(none).toBeNull();
    await importDataUrl(page, await gradientPng(page));
    const r = await page.evaluate(async () => {
      const job = Generator._buildJob({ skipExpensive: true });
      const viaWorker = await WorkerJobs.run('generate', job);
      const direct = MapJobs.generate(Generator._buildJob({ skipExpensive: true }));
      let diff = 0; for (let i = 0; i < direct.grid.length; i++) if (viaWorker.names[viaWorker.grid[i]] !== direct.names[direct.grid[i]]) diff++;
      const plain = MapJobs.generate({ ...Generator._buildJob({ skipExpensive: true }), p: { ...job.p, elevOverride: undefined } });
      let vsPlain = 0; for (let i = 0; i < direct.grid.length; i++) if (plain.names[plain.grid[i]] !== direct.names[direct.grid[i]]) vsPlain++;
      return { diff, vsPlain, usedWorker: WorkerJobs.lastUsedWorker ?? null };
    });
    expect(r.diff).toBe(0);
    expect(r.vsPlain).toBeGreaterThan(1000);     // positive control: the override really changes the map
  });

  test('validation: type, size (before any read), empty, corrupt, too many pixels; state untouched, toasts say why', async ({ page }) => {
    await importDataUrl(page, await gradientPng(page), 'good.png');
    const r = await page.evaluate(async () => {
      let decodes = 0;
      const real = window.createImageBitmap.bind(window);
      (window as any).createImageBitmap = (...a: any[]) => { decodes++; return (real as any)(...a); };
      const out: any = {};
      const run = async (k: string, f: File) => { const d0 = decodes; await Generator.importElevation(f); out[k] = decodes - d0; };
      await run('text', new File(['hello'], 'a.txt', { type: 'text/plain' }));
      await run('svg', new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'a.svg', { type: 'image/svg+xml' }));
      const big = new File(['x'], 'big.png', { type: 'image/png' });
      Object.defineProperty(big, 'size', { value: 200 * 1024 * 1024 });
      await run('big', big);
      await run('empty', new File([], 'e.png', { type: 'image/png' }));
      // a PNG header that states a small size followed by garbage: the header check passes, so the decoder runs and fails
      const png = (w: number, h: number) => { const b = new Uint8Array(200).fill(7); b.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0); const dv = new DataView(b.buffer); dv.setUint32(16, w); dv.setUint32(20, h); return b; };
      await run('junk', new File([new Uint8Array(200).fill(7)], 'junk.png', { type: 'image/png' }));   // no image header at all: refused before decoding (final wave A11)
      await run('corrupt', new File([png(64, 64)], 'bad.png', { type: 'image/png' }));
      (window as any).createImageBitmap = async () => ({ width: 20000, height: 20000, close() {} });
      await run('huge', new File([png(100, 100)], 'huge.png', { type: 'image/png' }));   // the post-decode check stays as a second line of defence
      (window as any).createImageBitmap = real;
      return { ...out, has: Generator.hasElevation(), name: document.getElementById('gen-elev-name')!.textContent };
    });
    expect(r.text).toBe(0); expect(r.svg).toBe(0); expect(r.big).toBe(0); expect(r.empty).toBe(0);   // rejected before decoding
    expect(r.junk).toBe(0);                                                                          // no recognisable header: never decoded
    expect(r.corrupt).toBe(1);                                                                       // positive control: decode was attempted
    expect(r.has).toBe(true);                                                                        // the earlier good import survived every failure
    expect(r.name).toBe('good.png');
    const t = (await toasts(page)).join(' | ');
    expect(t).toContain('Not an image');
    expect(t).toContain('too large');
    expect(t).toContain('is empty');
    expect(t).toContain('unrecognised header');
    expect(t).toContain('could not be decoded');
    expect(t).toContain('too many pixels');
  });

  test('a flat image warns and gives a flat 0.5 grid', async ({ page }) => {
    await page.evaluate(async () => {
      const cv = document.createElement('canvas'); cv.width = 8; cv.height = 8;
      const g = cv.getContext('2d')!; g.fillStyle = '#808080'; g.fillRect(0, 0, 8, 8);
      const blob: Blob = await new Promise(res => cv.toBlob(b => res(b!), 'image/png'));
      await Generator.importElevation(new File([blob], 'flat.png', { type: 'image/png' }));
    });
    expect(await toasts(page)).toContain('Warning: the image has no usable elevation variation');
    expect(await page.evaluate(() => Generator._buildJob().p.elevOverride[12345])).toBe(0.5);
  });

  test('a huge image is downscaled before any per-pixel work (work counter, no wall clock)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const cv = document.createElement('canvas'); cv.width = 5000; cv.height = 3000;
      const g = cv.getContext('2d')!;
      const grad = g.createLinearGradient(0, 0, 5000, 0); grad.addColorStop(0, '#000'); grad.addColorStop(1, '#fff');
      g.fillStyle = grad; g.fillRect(0, 0, 5000, 3000);
      const blob: Blob = await new Promise(res => cv.toBlob(b => res(b!), 'image/png'));
      const real = GenUtils.luminanceGrid; const seen: number[] = [];
      GenUtils.luminanceGrid = (px: any, w: number, h: number) => { seen.push(w * h); return real(px, w, h); };
      try { await Generator.importElevation(new File([blob], 'big.png', { type: 'image/png' })); } finally { GenUtils.luminanceGrid = real; }
      const eo = Generator._buildJob().p.elevOverride;
      return { seen, has: Generator.hasElevation(), fit: GenUtils.fitWithin(5000, 3000, 2048), first: eo[0], last: eo[eo.length - 1] };
    });
    expect(r.has).toBe(true);
    expect(r.fit).toEqual({ w: 2048, h: 1229 });
    expect(r.seen).toEqual([2048 * 1229]);       // exactly one luminance pass, over the downscaled pixels (15 Mpx source never walked)
    expect(r.seen[0]).toBeLessThan(5000 * 3000 / 5);
  });

  test('fitWithin keeps small images, scales large ones keeping aspect, never returns 0', async ({ page }) => {
    const r = await page.evaluate(() => [GenUtils.fitWithin(100, 50, 2048), GenUtils.fitWithin(4096, 1024, 2048), GenUtils.fitWithin(1000000, 1, 2048), GenUtils.fitWithin(2048, 2048, 2048)]);
    expect(r).toEqual([{ w: 100, h: 50 }, { w: 2048, h: 512 }, { w: 2048, h: 1 }, { w: 2048, h: 2048 }]);
  });

  test('the modal controls work through the real file input; the file name is shown as text only', async ({ page }) => {
    const url = await gradientPng(page);
    const buffer = Buffer.from(url.split(',')[1], 'base64');
    await page.evaluate(() => Generator.open());
    expect(await page.locator('#gen-modal #gen-elev-file, #gen-modal #gen-sea, #gen-modal #gen-use-elev').count()).toBe(3);
    expect(await page.locator('.toolbar #gen-elev-file, #toolbar #gen-elev-file').count()).toBe(0);
    expect(await page.locator('#gen-use-elev').isDisabled()).toBe(true);
    const evil = '<img src=x onerror="window.__xss=1">.png';
    await page.setInputFiles('#gen-elev-file', { name: evil, mimeType: 'image/png', buffer });
    await expect(page.locator('#gen-elev-name')).toHaveText(evil);
    expect(await page.locator('#gen-elev-name *').count()).toBe(0);
    expect(await page.evaluate(() => (window as any).__xss ?? null)).toBeNull();
    expect(await page.locator('#gen-use-elev').isChecked()).toBe(true);
    // unticking stops the override, the slider shifts it
    const a = await page.evaluate(() => Generator._buildJob().p.elevOverride[225 * 450 + 225]);
    await page.evaluate(() => { const s = document.getElementById('gen-sea') as HTMLInputElement; s.value = '0.2'; s.dispatchEvent(new Event('input')); });
    const b = await page.evaluate(() => Generator._buildJob().p.elevOverride[225 * 450 + 225]);
    expect(b).toBeCloseTo(Math.max(0, a - 0.2), 4);
    await page.locator('#gen-use-elev').uncheck();
    expect(await page.evaluate(() => Generator._buildJob().p.elevOverride ?? null)).toBeNull();
    await page.locator('#gen-use-elev').check();
    await page.evaluate(() => Generator.clearElevation());
    expect(await page.evaluate(() => [Generator.hasElevation(), Generator._buildJob().p.elevOverride ?? null])).toEqual([false, null]);
    await expect(page.locator('#gen-elev-name')).toHaveText('none');
  });

  test('the last import wins when two overlap', async ({ page }) => {
    const url = await gradientPng(page);
    const name = await page.evaluate(async (url: string) => {
      const blob = await (await fetch(url)).blob();
      const p1 = Generator.importElevation(new File([blob], 'first.png', { type: 'image/png' }));
      const p2 = Generator.importElevation(new File([blob], 'second.png', { type: 'image/png' }));
      await Promise.all([p1, p2]);
      return document.getElementById('gen-elev-name')!.textContent;
    }, url);
    expect(name).toBe('second.png');
  });

  test('the imported elevation survives a map size change (re-resampled for the new size)', async ({ page }) => {
    await importDataUrl(page, await gradientPng(page));
    const r = await page.evaluate(() => {
      MAP_WIDTH = 60; MAP_HEIGHT = 40;
      const eo = Generator._buildJob().p.elevOverride;
      return { has: Generator.hasElevation(), len: eo ? eo.length : -1 };
    });
    expect(r).toEqual({ has: true, len: 60 * 40 });
  });
});

// T3.7: pure placement primitives (gen-utils.js). Run in an EMPTY vm context (no DOM, no editor globals, Math.random
// poisoned) so the "pure and seeded" contract is enforced, with references computed here from axial coordinates.
import * as nodeFs from 'fs';
import * as nodeVm from 'vm';
test.describe('placement primitives (T3.7)', () => {
  type C = { q: number; r: number; s: number; id: number };
  const src = nodeFs.readFileSync(require('path').join(__dirname, '..', 'gen-utils.js'), 'utf8');
  const load = () => {
    const ctx: any = nodeVm.createContext({ Math: Object.assign(Object.create(Math), { random: () => { throw new Error('Math.random used'); } }) });
    return nodeVm.runInContext(src + '\n;GenUtils', ctx);
  };
  const dist = (a: C, b: C) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
  const mulberry = (seed: number) => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // a hexagonal field of radius R (axial), ids unique
  const field = (R: number): C[] => { const o: C[] = []; for (let q = -R; q <= R; q++) for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) o.push({ q, r, s: -q - r, id: o.length }); return o; };
  const minPair = (a: C[]) => { let m = Infinity; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) m = Math.min(m, dist(a[i], a[j])); return m; };

  test('spreadPick: count, distinct subset, and every pick is a farthest point of the earlier picks (brute-force replay)', () => {
    const G = load(), cands = field(40);
    const picks: C[] = G.spreadPick(cands, 6, mulberry(5), dist);
    expect(picks).toHaveLength(6);
    expect(new Set(picks.map(p => p.id)).size).toBe(6);
    expect(picks.every(p => cands[p.id] === p)).toBe(true);                      // elements of the input, not copies
    for (let k = 1; k < picks.length; k++) {                                     // reference: no candidate is farther from the earlier picks
      const md = (c: C) => Math.min(...picks.slice(0, k).map(p => dist(c, p)));
      const best = Math.max(...cands.map(md));
      expect(md(picks[k])).toBe(best);
    }
    expect(minPair(picks)).toBeGreaterThan(20);                                  // 6 spread points of a radius-40 field (crowded random picks fall below this)
    expect(G.spreadPick(cands, 0, mulberry(1), dist)).toEqual([]);
    expect(G.spreadPick([], 3, mulberry(1), dist)).toEqual([]);
    expect(G.spreadPick(cands.slice(0, 4), 10, mulberry(1), dist)).toHaveLength(4);   // never more than there are candidates
    expect(G.spreadPick(cands, 2.9, mulberry(1), dist)).toHaveLength(2);         // non-integer counts floor
  });

  test('poissonPick: spacing, count, taken, maximality (reference scan) and no input mutation', () => {
    const G = load(), cands = field(60), copy = cands.slice();
    const taken = [cands[0], cands[500]];
    const picks: C[] = G.poissonPick(cands, 40, 12, mulberry(9), dist, taken);
    expect(picks).toHaveLength(40);
    expect(minPair(picks)).toBeGreaterThanOrEqual(12);
    for (const p of picks) for (const t of taken) expect(dist(p, t)).toBeGreaterThanOrEqual(12);
    expect(new Set(picks.map(p => p.id)).size).toBe(40);
    expect(cands).toEqual(copy);                                                 // candidates (order too) untouched
    expect(taken).toHaveLength(2);
    // saturation: asking for more than fit returns a MAXIMAL set (every candidate left out is within spacing of a pick or taken)
    const sat: C[] = G.poissonPick(cands, 100000, 12, mulberry(3), dist, taken);
    expect(sat.length).toBeGreaterThan(40);
    expect(sat.length).toBeLessThan(cands.length);
    const ids = new Set(sat.map(p => p.id));
    for (const c of cands) if (!ids.has(c.id)) expect([...sat, ...taken].some(p => dist(c, p) < 12)).toBe(true);
    expect(minPair(sat)).toBeGreaterThanOrEqual(12);
    expect(G.poissonPick(cands, 0, 5, mulberry(1), dist)).toEqual([]);
    expect(G.poissonPick(cands, 5, 5, mulberry(1), dist, undefined)).toHaveLength(5);   // `taken` is optional
    // exclusion mask: nothing is picked inside a taken disc
    const centre = cands[Math.floor(cands.length / 2)];
    const ex: C[] = G.poissonPick(cands, 500, 1, mulberry(4), dist, [centre]);
    expect(ex.every(p => dist(p, centre) >= 1)).toBe(true);
  });

  test('oreCluster: centre first, distinct cells inside the radius-2 disc, size clamps to the 19 cells of the disc', () => {
    const G = load(), c = { q: 7, r: -3, s: -4 };
    for (const size of [1, 2, 4, 7, 19, 30]) {
      const cl: any[] = G.oreCluster(c, size, mulberry(size));
      expect(cl).toHaveLength(Math.min(size, 19));
      expect([cl[0].q, cl[0].r, cl[0].s]).toEqual([7, -3, -4]);
      expect(new Set(cl.map(x => x.q + ',' + x.r)).size).toBe(cl.length);
      expect(cl.every(x => dist(x, c as any) <= 2 && x.q + x.r + x.s === 0)).toBe(true);
    }
    expect(G.oreCluster(c, 0, mulberry(1))).toEqual([]);
    // 19 = the whole disc: reference count of axial cells with distance <= 2
    expect(field(2)).toHaveLength(19);
    // different seeds give different 4-cell clusters (the pick is random, not a fixed ring slice)
    const shapes = new Set([1, 2, 3, 4, 5, 6].map(sd => JSON.stringify(G.oreCluster(c, 4, mulberry(sd)))));
    expect(shapes.size).toBeGreaterThan(1);
  });

  test('deterministic per seed, different across seeds, and never touches Math.random', () => {
    const G = load(), cands = field(50);
    const run = (seed: number) => { const r = mulberry(seed); return JSON.stringify([G.spreadPick(cands, 5, r, dist).map((p: C) => p.id), G.poissonPick(cands, 30, 8, r, dist, []).map((p: C) => p.id), G.oreCluster(cands[1000], 5, r)]); };
    expect(run(11)).toBe(run(11));
    expect(run(11)).not.toBe(run(12));
  });
});
