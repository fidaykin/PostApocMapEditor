import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT } from './perf-scene';

declare const Canvas: any, MAP_WIDTH: number, MAP_HEIGHT: number, COL_PITCH: number, ROW_PITCH: number, STAGGER: number, HEX_SIZE: number;
declare const IO: any;
test.use({ viewport: VIEWPORT });
// Cheap 450x450 map (no terrain mix / roads / sprites): these tests only need the map size.
// 100x100: floor is ~11% at the test viewport, so renders at the floor stay cheap before T1.12 (LOD).
const midMap = (page: any) => page.evaluate(() => { IO.setNewMapSize(100, 100); IO.applyNewMap(); });
const bigMap = (page: any) => page.evaluate(() => IO.newMap(true));

test('fit-to-screen fits the whole 450x450 map below 25%', async ({ page }) => {
  await openEditor(page);
  await bigMap(page);
  const r = await page.evaluate(() => {
    Canvas.fitToScreen();
    const cv = document.getElementById('map-canvas') as HTMLCanvasElement;
    const z = Canvas.getZoom();
    const w = ((MAP_HEIGHT - 1) * COL_PITCH + HEX_SIZE * 2) * z / 100;
    const h = ((MAP_WIDTH - 1) * ROW_PITCH + STAGGER + HEX_SIZE * 2) * z / 100;
    return { z, w, h, cw: cv.width, ch: cv.height, label: document.getElementById('st-zoom')!.textContent, floor: Canvas.minZoom() };
  });
  expect(r.z).toBeLessThan(25);
  expect(r.z).toBeGreaterThanOrEqual(1);
  expect(r.w).toBeLessThanOrEqual(r.cw);
  expect(r.h).toBeLessThanOrEqual(r.ch);
  expect(r.label).toBe(r.z + '%');
  expect(r.z).toBe(r.floor);
});

for (const rulers of [true, false]) {
  test(`fit-to-screen keeps all four corner hexes fully inside the free area (rulers ${rulers ? 'on' : 'off'})`, async ({ page }) => {
    await openEditor(page);
    await bigMap(page);
    const r = await page.evaluate((rulers) => {
      if (!rulers) Canvas.toggleRulers();   // rulers are on by default
      Canvas.fitToScreen();
      const cv = document.getElementById('map-canvas') as HTMLCanvasElement;
      const rad = HEX_SIZE * Canvas.getZoom() / 100;
      const pts = [[0, 0], [MAP_WIDTH - 1, 0], [0, MAP_HEIGHT - 1], [MAP_WIDTH - 1, MAP_HEIGHT - 1]].map(([c, rw]) => Canvas.hexScreenPos(c, rw));
      return { pts, rad, cw: cv.width, ch: cv.height };
    }, rulers);
    const left = rulers ? 28 : 0, top = rulers ? 20 : 0;   // RULER_LEFT / RULER_TOP
    for (const p of r.pts) {
      expect(p.x - r.rad).toBeGreaterThanOrEqual(left); expect(p.x + r.rad).toBeLessThanOrEqual(r.cw);
      expect(p.y - r.rad).toBeGreaterThanOrEqual(top);  expect(p.y + r.rad).toBeLessThanOrEqual(r.ch);
    }
  });
}

test('setZoom clamps to the dynamic floor, not 25%', async ({ page }) => {
  await openEditor(page);
  await bigMap(page);
  const r = await page.evaluate(() => {
    Canvas.setZoom(1); const low = Canvas.getZoom();
    Canvas.setZoom(10); const mid = Canvas.getZoom();
    Canvas.setZoom(500); const high = Canvas.getZoom();
    return { low, mid, high, floor: Canvas.minZoom() };
  });
  expect(r.low).toBe(r.floor);
  expect(r.mid).toBe(Math.max(10, r.floor));
  expect(r.high).toBe(200);
});

test('wheel zoom out steps proportionally at low zoom', async ({ page }) => {
  await openEditor(page);
  await bigMap(page);
  await page.evaluate(() => Canvas.setZoom(20));
  const box = (await page.locator('#map-canvas').boundingBox())!;
  await page.mouse.move(box.x + 700, box.y + 450);
  await page.mouse.wheel(0, 100);
  const z = await page.evaluate(() => Canvas.getZoom());
  expect(z).toBeLessThan(20);
  expect(z).toBeGreaterThanOrEqual(15);
});

test('repeated zoomOut stops at the floor; normal zooms unchanged', async ({ page }) => {
  await openEditor(page);
  await midMap(page);
  const r = await page.evaluate(() => {
    Canvas.setZoom(30);
    for (let i = 0; i < 12; i++) Canvas.zoomOut();
    const z = Canvas.getZoom();
    Canvas.setZoom(60); const z60 = Canvas.getZoom();
    Canvas.setZoom(25); const z25 = Canvas.getZoom();
    return { z, z60, z25, floor: Canvas.minZoom() };
  });
  expect(r.z).toBe(r.floor);
  expect(r.z60).toBe(60);
  expect(r.z25).toBe(25);
});

const FLOOR_FORMULA = `(() => {
  const cv = document.getElementById('map-canvas');
  const w = (MAP_HEIGHT - 1) * COL_PITCH + HEX_SIZE * 2, h = (MAP_WIDTH - 1) * ROW_PITCH + STAGGER + HEX_SIZE * 2;
  const fit = Math.min((cv.width - 28) / w, (cv.height - 20) / h) * 100;   // rulers on: strips 28 x 20
  return { fit, expected: Math.max(1, Math.min(25, Math.floor(fit))) };
})()`;

test('a small map keeps the legacy 25% floor', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate((f) => {
    IO.setNewMapSize(20, 20); IO.applyNewMap();
    const q = eval(f);
    Canvas.setZoom(1);
    return { floor: Canvas.minZoom(), z: Canvas.getZoom(), fit: q.fit };
  }, FLOOR_FORMULA);
  expect(r.fit).toBeGreaterThan(25);   // precondition: this map fits well above 25%
  expect(r.floor).toBe(25);
  expect(r.z).toBe(25);
});

test('a mid-size map floors at floor(fit) when that is below 25%', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate((f) => {
    IO.setNewMapSize(100, 100); IO.applyNewMap();
    const q = eval(f);
    Canvas.setZoom(1);
    return { floor: Canvas.minZoom(), z: Canvas.getZoom(), fit: q.fit, expected: q.expected };
  }, FLOOR_FORMULA);
  expect(r.fit).toBeLessThan(25);
  expect(r.fit).toBeGreaterThan(1);
  expect(r.floor).toBe(r.expected);
  expect(r.z).toBe(r.expected);
});

test('resize re-clamps zoom below the new floor and updates the label', async ({ page }) => {
  await openEditor(page);
  await midMap(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.evaluate(() => { Canvas.setZoom(Canvas.minZoom()); });
  const before = await page.evaluate(() => Canvas.getZoom());
  await page.setViewportSize({ width: 2800, height: 1800 });
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({ z: Canvas.getZoom(), floor: Canvas.minZoom(), label: document.getElementById('st-zoom')!.textContent }));
  expect(after.floor).toBeGreaterThan(before);   // a bigger canvas raises the floor
  expect(after.z).toBeGreaterThan(before);       // so the zoom was re-clamped upwards
  expect(after.z).toBe(after.floor);
  expect(after.label).toBe(after.z + '%');
});

test('no NaN or zero floor on a 0x0 canvas; bad zoom input is ignored', async ({ page }) => {
  await openEditor(page);
  await bigMap(page);
  const r = await page.evaluate(() => {
    const cv = document.getElementById('map-canvas') as HTMLCanvasElement;
    const w = cv.width, h = cv.height;
    cv.width = 0; cv.height = 0;
    const floor = Canvas.minZoom();
    Canvas.setZoom(NaN); const zNaN = Canvas.getZoom();
    Canvas.setZoom(Infinity); const zInf = Canvas.getZoom();
    Canvas.fitToScreen();
    const cam = Canvas.getCamera();
    const z = Canvas.getZoom();
    cv.width = w; cv.height = h;
    return { floor, zNaN, zInf, z, cam };
  });
  expect(r.floor).toBe(1);
  expect(Number.isFinite(r.zNaN)).toBe(true);
  expect(Number.isFinite(r.zInf)).toBe(true);
  expect(r.z).toBe(1);
  expect(Number.isFinite(r.cam.x) && Number.isFinite(r.cam.y)).toBe(true);
});

test('real wheel events never zoom below the floor', async ({ page }) => {
  await openEditor(page);
  await midMap(page);
  await page.evaluate(() => Canvas.setZoom(14));
  const box = (await page.locator('#map-canvas').boundingBox())!;
  await page.mouse.move(box.x + 700, box.y + 450);
  const zs: number[] = [];
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);
    zs.push(await page.evaluate(() => Canvas.getZoom()));
  }
  const floor = await page.evaluate(() => Canvas.minZoom());
  expect(zs[0]).toBeLessThan(14);
  for (const z of zs) expect(z).toBeGreaterThanOrEqual(floor);
  expect(zs[zs.length - 1]).toBe(floor);
});

test('loading a smaller map re-clamps a zoom that is below its floor', async ({ page }) => {
  test.setTimeout(90000);   // one render of the full 450x450 map at its floor (~1.5 s until T1.12)
  await openEditor(page);
  await bigMap(page);
  const r = await page.evaluate(() => {
    Canvas.setZoom(1);
    const before = Canvas.getZoom();
    IO.setNewMapSize(100, 100); IO.applyNewMap();
    return { before, z: Canvas.getZoom(), floor: Canvas.minZoom(), label: document.getElementById('st-zoom')!.textContent };
  });
  expect(r.z).toBeGreaterThan(r.before);
  expect(r.z).toBeGreaterThanOrEqual(r.floor);
  expect(r.label).toBe(r.z + '%');
});

test('toggling rulers re-applies the floor', async ({ page }) => {
  await openEditor(page);
  await midMap(page);
  const r = await page.evaluate(() => {
    Canvas.setZoom(1);
    const on = Canvas.minZoom();
    Canvas.toggleRulers();
    return { on, off: Canvas.minZoom(), z: Canvas.getZoom() };
  });
  expect(r.off).toBeGreaterThanOrEqual(r.on);
  expect(r.z).toBeGreaterThanOrEqual(r.off);
});
