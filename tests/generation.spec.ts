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
