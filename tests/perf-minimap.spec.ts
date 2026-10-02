import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, hashCanvas, checkBaseline, medianMs, expectFasterThan } from './perf-scene';

declare const Canvas: any, History: any, IO: any, Terrain: any, mapData: string[], MAP_WIDTH: number, MAP_HEIGHT: number;
test.use({ viewport: VIEWPORT });

// In-page helper: redraw the minimap, then count layer pixels that differ from a from-scratch rebuild.
const DEFINE_CHECK = `window.__layerMismatches = () => {
  const mc = document.getElementById('minimap');
  const pw = mc.width, ph = mc.height;
  Canvas.drawMinimap();
  const lc = Canvas._test.minimapLayer(pw, ph);
  const got = lc.getContext('2d').getImageData(0, 0, pw, ph).data;
  let bad = 0;
  for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
    const row = MAP_HEIGHT - 1 - Math.floor(px / pw * MAP_HEIGHT);
    const col = MAP_WIDTH - 1 - Math.floor(py / ph * MAP_WIDTH);
    const c = Terrain.color(mapData[row * MAP_WIDTH + col]), o = (py * pw + px) * 4;
    if (got[o] !== c[0] || got[o + 1] !== c[1] || got[o + 2] !== c[2] || got[o + 3] !== 255) bad++;
  }
  return bad;
};`;
async function prep(page: any) {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  await page.evaluate(DEFINE_CHECK.replace(/^/, ''));
  await page.evaluate(() => { if ((window as any).__layerMismatches() !== 0) throw new Error('initial mismatch'); });
}
const mism = (page: any) => page.evaluate(() => (window as any).__layerMismatches());

test('minimap pixels identical to baseline', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  checkBaseline('minimap', await hashCanvas(page, '#minimap'));
});

test('only changed tiles are recoloured', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  const r = await page.evaluate(() => {
    const mc = document.getElementById('minimap') as HTMLCanvasElement;
    Canvas.drawMinimap(); const first = Canvas.getStats().minimapRecolored;
    Canvas.drawMinimap(); const none = Canvas.getStats().minimapRecolored;
    // the tile sampled by minimap pixel (10,10)
    const row = MAP_HEIGHT - 1 - Math.floor(10 / mc.width * MAP_HEIGHT);
    const col = MAP_WIDTH - 1 - Math.floor(10 / mc.height * MAP_WIDTH);
    mapData[row * MAP_WIDTH + col] = mapData[row * MAP_WIDTH + col] === 'Lava_Plain_1' ? 'Rift_1' : 'Lava_Plain_1';
    Canvas.drawMinimap(); const one = Canvas.getStats().minimapRecolored;
    return { first, none, one };
  });
  expect(r.none).toBe(0);
  expect(r.one).toBe(1);
});

test('stays correct after in-place bulk write (fill / generator-style)', async ({ page }) => {
  await prep(page);
  await page.evaluate(() => mapData.fill('Lava_Plain_1'));
  expect(await mism(page)).toBe(0);
  await page.evaluate(() => { for (let i = 0; i < mapData.length; i += 3) mapData[i] = 'Rift_1'; });
  expect(await mism(page)).toBe(0);
});

test('stays correct across History undo / redo', async ({ page }) => {
  await prep(page);
  await page.evaluate(() => { History.push(); mapData.fill('Lava_Plain_1'); });
  expect(await mism(page)).toBe(0);
  await page.evaluate(() => History.undo());
  expect(await mism(page)).toBe(0);
  await page.evaluate(() => History.redo());
  expect(await mism(page)).toBe(0);
});

test('stays correct when mapData is reassigned (same size, new size, New Map)', async ({ page }) => {
  await prep(page);
  await page.evaluate(() => { (window as any).mapData = mapData.map((id, i) => (i % 5 ? id : 'Lava_Plain_1')); });
  expect(await mism(page)).toBe(0);
  await page.evaluate(() => { IO.newMap(true); });
  expect(await mism(page)).toBe(0);
  await page.evaluate(() => {
    const w = 120, h = 90;
    (window as any).MAP_WIDTH = w; (window as any).MAP_HEIGHT = h;
    (window as any).mapData = new Array(w * h).fill('Rift_1');
  });
  expect(await mism(page)).toBe(0);
});

test('randomized mixed edits match a from-scratch rebuild', async ({ page }) => {
  await prep(page);
  const bad = await page.evaluate(() => {
    let seed = 12345; const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    const ids = ['Plain_1', 'Water_1', 'Lava_Plain_1', 'Rift_1', 'Forest_1', 'Hills_1', 'Mountain_1'];
    let total = 0;
    for (let step = 0; step < 60; step++) {
      const kind = rnd(5);
      if (kind === 0) for (let k = 0; k < 1 + rnd(50); k++) mapData[rnd(mapData.length)] = ids[rnd(ids.length)];
      else if (kind === 1) { const a = rnd(mapData.length), n = rnd(3000); mapData.fill(ids[rnd(ids.length)], a, a + n); }
      else if (kind === 2) { History.push(); for (let k = 0; k < 200; k++) mapData[rnd(mapData.length)] = ids[rnd(ids.length)]; }
      else if (kind === 3) History.undo();
      else (window as any).mapData = mapData.map(id => (rnd(40) ? id : ids[rnd(ids.length)]));
      total += (window as any).__layerMismatches();
    }
    return total;
  });
  expect(bad).toBe(0);
});

test('minimap redraw is faster than baseline', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  expectFasterThan('t_minimap', await medianMs(page, 'minimap'), 0.6);
});
