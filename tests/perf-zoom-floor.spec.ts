import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT } from './perf-scene';

declare const Canvas: any, MAP_WIDTH: number, MAP_HEIGHT: number, COL_PITCH: number, ROW_PITCH: number, STAGGER: number, HEX_SIZE: number;
declare const IO: any;
test.use({ viewport: VIEWPORT });
// Cheap 450x450 map (no terrain mix / roads / sprites): these tests only need the map size.
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

test('fit-to-screen puts the four corner tiles inside the canvas', async ({ page }) => {
  await openEditor(page);
  await bigMap(page);
  const r = await page.evaluate(() => {
    Canvas.fitToScreen();
    const cv = document.getElementById('map-canvas') as HTMLCanvasElement;
    const hp = Canvas.hexScreenPos;
    const pts = [[0, 0], [MAP_WIDTH - 1, 0], [0, MAP_HEIGHT - 1], [MAP_WIDTH - 1, MAP_HEIGHT - 1]].map(([c, rw]) => hp(c, rw));
    return { pts, cw: cv.width, ch: cv.height };
  });
  for (const p of r.pts) {
    expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(r.cw);
    expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(r.ch);
  }
});

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
  await bigMap(page);
  const r = await page.evaluate(() => {
    Canvas.setZoom(6);   // start next to the floor: every render here draws the whole map until T1.12 (LOD) lands
    for (let i = 0; i < 6; i++) Canvas.zoomOut();
    const z = Canvas.getZoom();
    Canvas.setZoom(60); const z60 = Canvas.getZoom();
    Canvas.setZoom(25); const z25 = Canvas.getZoom();
    return { z, z60, z25, floor: Canvas.minZoom() };
  });
  expect(r.z).toBe(r.floor);
  expect(r.z60).toBe(60);
  expect(r.z25).toBe(25);
});

test('small map keeps the legacy 25% floor', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => {
    const cv = document.getElementById('map-canvas') as HTMLCanvasElement;
    return { floor: Canvas.minZoom(), cw: cv.width };
  });
  // 450x450 map in a 1400px canvas is far below 25% fit; the floor must be the fit, capped at 25
  expect(r.floor).toBeLessThanOrEqual(25);
  expect(r.floor).toBeGreaterThanOrEqual(1);
});

test('resize re-clamps zoom below the new floor and updates the label', async ({ page }) => {
  await openEditor(page);
  await bigMap(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.evaluate(() => { Canvas.setZoom(Canvas.minZoom()); });
  const before = await page.evaluate(() => Canvas.getZoom());
  await page.setViewportSize({ width: 2800, height: 1800 });
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({ z: Canvas.getZoom(), floor: Canvas.minZoom(), label: document.getElementById('st-zoom')!.textContent }));
  expect(after.floor).toBeGreaterThanOrEqual(before);
  expect(after.z).toBeGreaterThanOrEqual(after.floor);
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
