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

test('30k roads cost far less than the legacy per-frame parse', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  const r = await page.evaluate(() => {
    const median = (f: () => void, runs = 15, warm = 3) => {
      for (let i = 0; i < warm; i++) f();
      const t: number[] = [];
      for (let i = 0; i < runs; i++) { const s = performance.now(); f(); t.push(performance.now() - s); }
      t.sort((a, b) => a - b); return t[runs >> 1];
    };
    const render = () => { Canvas.render(); Canvas.getCtx().getImageData(0, 0, 1, 1); };
    const base = median(render);
    for (let i = 0; i < 30000; i++) roadsData[(i % 150) + ',' + (i / 150 | 0)] = { type: 'road_hex' };
    const withRoads = median(render);
    let sink = 0;
    const legacy = median(() => {   // the per-frame parse the cache replaced
      Object.entries(roadsData).forEach(([key]) => { const [col, row] = key.split(',').map(Number); sink += col + row; });
    });
    return { base, withRoads, legacy, sink };
  });
  const overhead = r.withRoads - r.base;
  console.log(`render base ${r.base.toFixed(2)}ms, +30k roads ${r.withRoads.toFixed(2)}ms, overhead ${overhead.toFixed(2)}ms, legacy parse ${r.legacy.toFixed(2)}ms`);
  test.info().annotations.push({ type: 'timing', description: `overhead ${overhead.toFixed(2)}ms vs legacy ${r.legacy.toFixed(2)}ms` });
  test.skip(r.legacy < 1, 'legacy parse under 1ms: machine too fast for a meaningful ratio');
  expect(overhead).toBeLessThan(r.legacy * 0.6);
});

test('overlay caching keeps pixels identical', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  for (const z of [25, 100]) {
    await frame(page, z);
    checkBaseline(`render_${z}`, await hashCanvas(page, '#map-canvas'));
  }
});
