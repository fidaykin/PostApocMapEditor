import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, hashCanvas, hashMapData, checkBaseline } from './perf-scene';

declare const HexUtils: any, getSatelliteAnchor: any, Canvas: any, UI: any, Tools: any, Generator: any, Satellite: any,
  mapData: string[], MAP_WIDTH: number, MAP_HEIGHT: number;

test.use({ viewport: VIEWPORT });

for (const z of [25, 60, 100, 200]) {
  test(`render hash at zoom ${z}`, async ({ page }) => {
    await openEditor(page);
    await setupScene(page);
    await frame(page, z);
    checkBaseline(`render_${z}`, await hashCanvas(page, '#map-canvas'));
  });
}

test('minimap hash', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  checkBaseline('minimap', await hashCanvas(page, '#minimap'));
});

async function clickFill(page: any, mode: 'scene' | 'uniform') {
  const pt = await page.evaluate((mode: string) => {
    if (mode === 'uniform') mapData.fill('Plain_1');
    Canvas.setZoom(100); Canvas.centerOnCity();
    const col = Math.floor(MAP_WIDTH / 2), row = Math.floor((MAP_HEIGHT - 1) / 2);
    const target = mapData[row * MAP_WIDTH + col];
    UI.selectTerrain(target === 'Forest_1' ? 'Hills_1' : 'Forest_1');
    Tools.setActive('fill');
    Canvas.render();
    const p = Canvas.hexScreenPos(col, row);
    const r = (document.getElementById('map-canvas') as HTMLCanvasElement).getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, mode);
  await page.mouse.click(pt.x, pt.y);
  // pre-change Fill is synchronous (no whenIdle); T1.8 makes it async and adds Tools.whenIdle
  await page.evaluate(async () => { if (typeof Tools.whenIdle === 'function') await Tools.whenIdle(); });
}

// T2.2: Fill now floods true hex neighbours (K2), so the stored `fill_scene` baseline (captured with the
// legacy non-adjacent table) no longer applies and is not asserted. The scene result is checked against an
// independent HexUtils flood fill instead; `fill_uniform` (whole map one region) is adjacency-independent and
// still compared against its baseline.
test('fill result (scene)', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const before = await hashMapData(page);
  const snapshot = await page.evaluate(() => mapData.slice());
  await clickFill(page, 'scene');
  const after = await hashMapData(page);
  expect(after).not.toBe(before);   // a broken click must not pass as a no-op
  const r = await page.evaluate((snap: string[]) => {
    const W = MAP_WIDTH, H = MAP_HEIGHT, col = Math.floor(W / 2), row = Math.floor((H - 1) / 2);
    const target = snap[row * W + col], fillId = target === 'Forest_1' ? 'Hills_1' : 'Forest_1';
    const out = snap.slice(), seen = new Set([row * W + col]), q = [[col, row]];
    for (let qi = 0; qi < q.length; qi++) {
      const [c, rr] = q[qi];
      if (getSatelliteAnchor(c, rr)) continue;
      out[rr * W + c] = fillId;
      for (const n of HexUtils.neighbors(c, rr, W, H)) {
        const k = n.row * W + n.col;
        if (!seen.has(k) && snap[k] === target) { seen.add(k); q.push([n.col, n.row]); }
      }
    }
    let diff = 0;
    for (let i = 0; i < out.length; i++) if (out[i] !== mapData[i]) diff++;
    return { diff, filled: seen.size };
  }, snapshot);
  expect(r.filled).toBeGreaterThanOrEqual(1);   // the scene pattern leaves the click cell a tiny region under true adjacency; big regions are covered in perf-fill.spec.ts
  expect(r.diff).toBe(0);
});

test('fill result (uniform)', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await clickFill(page, 'uniform');
  const after = await hashMapData(page);
  expect(await page.evaluate(() => mapData.some(id => id !== 'Plain_1'))).toBe(true);
  checkBaseline('fill_uniform', after);
});

test('generator seed 42', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await page.evaluate(() => { (document.getElementById('gen-seed') as HTMLInputElement).value = '42'; });
  await page.evaluate(async () => { await Generator.apply(); });   // sync today, async after T1.10
  checkBaseline('generator_seed42', await hashMapData(page));
});

test('satellite synthetic image', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 320;
    const x = c.getContext('2d')!;
    for (let j = 0; j < 320; j += 16)
      for (let i = 0; i < 320; i += 16) {
        x.fillStyle = `hsl(${(i * 7 + j * 3) % 360},${30 + (i % 5) * 12}%,${15 + (j % 7) * 10}%)`;
        x.fillRect(i, j, 16, 16);
      }
    return c.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
  await page.evaluate(() => Satellite.open());
  await page.locator('#sat-modal input[type=file]').setInputFiles({ name: 'sat.png', mimeType: 'image/png', buffer });
  await page.waitForFunction(() => !(document.getElementById('sat-apply-btn') as HTMLButtonElement).disabled);
  await page.evaluate(() => Satellite.apply());
  checkBaseline('satellite_synth', await hashMapData(page));
});
