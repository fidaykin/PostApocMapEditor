import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, hashCanvas, hashMapData, checkBaseline } from './perf-scene';

declare const Canvas: any, UI: any, Tools: any, Generator: any, Satellite: any,
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

for (const mode of ['scene', 'uniform'] as const) {
  test(`fill result (${mode})`, async ({ page }) => {
    await openEditor(page);
    await setupScene(page);
    const before = mode === 'scene' ? await hashMapData(page) : null;
    await clickFill(page, mode);
    const after = await hashMapData(page);
    // a broken click must not record a no-op hash (uniform: the pre-fill map is all Plain_1)
    if (before) expect(after).not.toBe(before);
    else expect(await page.evaluate(() => mapData.some(id => id !== 'Plain_1'))).toBe(true);
    checkBaseline(`fill_${mode}`, after);
  });
}

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
