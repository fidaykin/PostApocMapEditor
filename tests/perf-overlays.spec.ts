import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, hashCanvas, checkBaseline, medianMs } from './perf-scene';

declare const Canvas: any, roadsData: any, objectsData: any, History: any, IO: any;
test.use({ viewport: VIEWPORT });

test('overlay lists are cached and revalidated', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  const r = await page.evaluate(() => {
    const rebuilds = () => Canvas.getStats().overlayRebuilds;
    Canvas.render(); const a = rebuilds();
    Canvas.render(); const b = rebuilds();                    // unchanged data: no rebuild
    roadsData['3,3'] = { type: 'road_hex' }; Canvas.render(); const c = rebuilds();   // key added
    const k = Object.keys(objectsData)[0];
    objectsData[k] = objectsData[k] + '_x'; Canvas.render(); const d = rebuilds();    // value changed in place
    roadsData = { ...roadsData }; Canvas.render(); const e = rebuilds();              // reassigned, same content
    return { a, b, c, d, e };
  });
  expect(r.b).toBe(r.a);
  expect(r.c).toBeGreaterThan(r.b);
  expect(r.d).toBeGreaterThan(r.c);
  expect(r.e).toBe(r.d);
});

test('every mutation path is picked up by the next render', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  const r = await page.evaluate(() => {
    const hash = () => { Canvas.render(); return (document.getElementById('map-canvas') as HTMLCanvasElement).toDataURL(); };
    const rb = () => Canvas.getStats().overlayRebuilds;
    const out: Record<string, boolean> = {};
    const h0 = hash();
    const rk = Object.keys(roadsData), ok = Object.keys(objectsData);
    const mid = Math.floor(rk.length / 2); [rk[0], rk[mid]] = [rk[mid], rk[0]];   // pick visible roads (near map centre)
    [rk[1], rk[mid + 1]] = [rk[mid + 1], rk[1]];
    // in-place delete
    History.push();
    const savedRoad = roadsData[rk[0]]; delete roadsData[rk[0]];
    const hDel = hash(); out.deleteChangesPixels = hDel !== h0;
    // reorder: same key set, new order (delete + re-add moves key to the end)
    delete roadsData[rk[1]]; roadsData[rk[1]] = { type: 'road_hex' };
    const before = rb(); hash(); out.reorderRebuilds = rb() > before && Object.keys(roadsData).pop() === rk[1];
    roadsData[rk[0]] = savedRoad;
    // objects: delete in place
    const savedObj = objectsData[ok[0]]; delete objectsData[ok[0]];
    out.objDeleteChangesPixels = hash() !== hDel;
    objectsData[ok[0]] = savedObj;
    // undo restores a reassigned copy
    History.undo(); out.undoRestores = hash() === h0;
    // IO.newMap replaces both maps
    IO.newMap(true);
    out.newMapEmpties = Object.keys(roadsData).length === 0 && hash() !== h0;
    return out;
  });
  expect(r.deleteChangesPixels).toBe(true);
  expect(r.reorderRebuilds).toBe(true);
  expect(r.objDeleteChangesPixels).toBe(true);
  expect(r.undoRestores).toBe(true);
  expect(r.newMapEmpties).toBe(true);
});

test('30k off-screen roads add almost no render time', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  const base = await medianMs(page, 'render');
  await page.evaluate(() => { for (let i = 0; i < 30000; i++) roadsData[(i % 150) + ',' + (i / 150 | 0)] = { type: 'road_hex' }; });
  const withRoads = await medianMs(page, 'render');
  console.log(`render base ${base.toFixed(2)}ms with 30k roads ${withRoads.toFixed(2)}ms`);
  expect(withRoads - base).toBeLessThan(3);
});

test('overlay caching keeps pixels identical', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  for (const z of [25, 100]) {
    await frame(page, z);
    checkBaseline(`render_${z}`, await hashCanvas(page, '#map-canvas'));
  }
});
