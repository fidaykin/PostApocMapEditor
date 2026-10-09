import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT } from './perf-scene';

declare const History: any, mapData: string[], IO: any, Tools: any, UI: any, Canvas: any, Generator: any,
  MAP_WIDTH: number, MAP_HEIGHT: number, COL_PITCH: number, ROW_PITCH: number, STAGGER: number, HEX_SIZE: number;
test.use({ viewport: VIEWPORT });

// B1 (T1.7): after an undo the next push must share rows with the restored snapshot.
test('History: a push after undo shares rows with the restored snapshot', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => IO.newMap(true));
  const r = await page.evaluate(() => {
    History.clear();
    History.push(); History.push();                                       // Pa, Pb: both state0 (share every row)
    for (let row = 0; row < 100; row++) mapData[row * MAP_WIDTH + 3] = 'Water_1';   // 100 rows change (live, unpushed)
    History.undo();                                                       // snapshots state1 for redo, live = state0
    mapData[200 * MAP_WIDTH + 9] = 'Rubble_1';                            // one-tile edit
    History.push();                                                       // must share with the restored snapshot, not with the redo copy
    return { distinct: History.debugRowCount(), height: MAP_HEIGHT };
  });
  // Pa/Pb: one full grid + zone copy; the new snapshot may add only ~1 grid row (no 100-row duplicate).
  expect(r.distinct).toBeLessThanOrEqual(r.height * 2 + 10);
});

// B2 (T1.8): Ctrl+S during a fill that then throws must still save; the abort path must schedule an autosave.
test('Save during a fill that fails still saves the map', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    IO.newMap(true); mapData.fill('Plain_1');
    UI.selectTerrain('Forest_1');
    const origToast = UI.toast; UI.toast = () => {};
    const origRender = Canvas.render; let thrown = false;
    Canvas.render = () => { if (!thrown) { thrown = true; throw new Error('boom'); } return origRender.call(Canvas); };
    const saved: string[] = [];
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = () => { saved.push('blob'); return 'blob:x'; };
    HTMLAnchorElement.prototype.click = function () {};
    const p = Tools.fill(225, 225).catch(() => {});
    const busy = Tools.isFillBusy();
    IO.saveMap();
    await p;
    await new Promise(res => setTimeout(res, 50));
    Canvas.render = origRender; UI.toast = origToast; URL.createObjectURL = origCreate;
    return { busy, thrown, saved: saved.length };
  });
  expect(r.busy).toBe(true);
  expect(r.thrown).toBe(true);
  expect(r.saved).toBe(1);
});

test('a fill aborted by a replaced map schedules an autosave for the replacement', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    IO.newMap(true); mapData.fill('Plain_1');
    UI.selectTerrain('Forest_1');
    const p = Tools.fill(225, 225);
    IO.newMap(true);
    let calls = 0;
    const orig = IO.scheduleAutoSave; IO.scheduleAutoSave = (...a: any[]) => { calls++; return orig.apply(IO, a); };
    await p;
    IO.scheduleAutoSave = orig;
    return { calls };
  });
  expect(r.calls).toBeGreaterThanOrEqual(1);
});

// B3 (T1.3): a non-finite camera must fall back to the full range, not draw a blank canvas.
test('a NaN camera renders the full range instead of nothing', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => {
    IO.setNewMapSize(40, 40); IO.applyNewMap();
    let err = '';
    try { Canvas._test.setCamera(NaN, NaN); Canvas.render(); } catch (e: any) { err = String(e); }
    const drawn = Canvas.getStats().tilesDrawn;
    Canvas._test.setCamera(0, 0); Canvas.clampCamera();
    return { err, drawn };
  });
  expect(r.err).toBe('');
  expect(r.drawn).toBeGreaterThan(0);
});

// B4 (T1.10): an async map replacement mid-job (same size) must not be overwritten by the generator result.
test('Generator Apply discards its result when the map was replaced mid-job (same size)', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    IO.newMap(true); mapData.fill('Plain_1');
    const toasts: string[] = [];
    const origToast = UI.toast; UI.toast = (m: string) => { toasts.push(String(m)); };
    const p = Generator.apply();
    IO.newMap(true);                          // same 450x450, new array identity
    const fresh = mapData;
    await p;
    UI.toast = origToast;
    return { same: mapData === fresh, allPlain: fresh.every(x => x === 'Plain_1'), toasts };
  });
  expect(r.same).toBe(true);
  expect(r.allPlain).toBe(true);
  expect(r.toasts.some(t => /discarded/i.test(t))).toBe(true);
});

// B5 (T1.11): ruler toggle / Expand Map / autosave restore re-clamp zoom against a floor that actually changes.
const FIND_SIZE = `(() => {
  const cv = document.getElementById('map-canvas');
  const fl = (cw, ch, n) => {
    const w = (n - 1) * COL_PITCH + HEX_SIZE * 2, h = (n - 1) * ROW_PITCH + STAGGER + HEX_SIZE * 2;
    return Math.max(1, Math.min(25, Math.floor(Math.min(cw / w, ch / h) * 100)));
  };
  for (let n = 30; n <= 450; n++) {
    const on = fl(cv.width - 28, cv.height - 20, n), off = fl(cv.width, cv.height, n);
    if (off > on && on < 25) return n;
  }
  return 0;
})()`;

test('toggling rulers re-clamps zoom against a floor that really differs', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate((f) => {
    const n = eval(f) as number;
    if (!n) return { n };
    IO.setNewMapSize(n, n); IO.applyNewMap();
    Canvas.setZoom(1);
    const floorOn = Canvas.minZoom(), zOn = Canvas.getZoom();
    Canvas.toggleRulers();
    const floorOff = Canvas.minZoom(), zOff = Canvas.getZoom();
    Canvas.toggleRulers();
    return { n, floorOn, zOn, floorOff, zOff, zBack: Canvas.getZoom(), floorBack: Canvas.minZoom() };
  }, FIND_SIZE) as any;
  expect(r.n, 'no map size makes the ruler strips change the floor at this viewport').toBeGreaterThan(0);
  expect(r.floorOff).toBeGreaterThan(r.floorOn);       // precondition: the floor really differs
  expect(r.zOn).toBe(r.floorOn);
  expect(r.zOff).toBe(r.floorOff);                      // zoom was re-clamped up when the strips went away
  expect(r.zBack).toBeGreaterThanOrEqual(r.floorBack);
});

test('Loading a smaller map re-clamps zoom to its higher floor', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    IO.setNewMapSize(100, 100); IO.applyNewMap();
    const smallJson = IO.getMapJson();
    const smallFloor = Canvas.minZoom();
    IO.newMap(true); Canvas.setZoom(1);
    const bigZoom = Canvas.getZoom();
    IO.loadFromJSON(JSON.parse(smallJson));   // (the side-copy restore path calls the same reclampZoom)
    return { ok: true, bigZoom, smallFloor, z: Canvas.getZoom(), floor: Canvas.minZoom() };
  });
  expect(r.ok).toBe(true);
  expect(r.bigZoom).toBeLessThan(r.smallFloor);   // precondition
  expect(r.z).toBeGreaterThanOrEqual(r.floor);
  expect(r.floor).toBe(r.smallFloor);
});

test('Expand Map keeps zoom at/above the floor and the camera clamped', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => {
    IO.setNewMapSize(30, 30); IO.applyNewMap();
    Canvas.setZoom(25);
    (document.getElementById('expandmap-amount') as HTMLInputElement).value = '100';
    IO.applyExpandMap();
    const cam = Canvas.getCamera(); Canvas.clampCamera(); const cam2 = Canvas.getCamera();
    return { w: MAP_WIDTH, z: Canvas.getZoom(), floor: Canvas.minZoom(), cam, cam2 };
  });
  expect(r.w).toBe(230);
  expect(r.z).toBeGreaterThanOrEqual(r.floor);
  expect(r.cam2).toEqual(r.cam);
});
