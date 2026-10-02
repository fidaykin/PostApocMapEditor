import { test } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, medianMs, saveBaselineKey } from './perf-scene';

declare const Terrain: any;
test.use({ viewport: VIEWPORT });

test('record baseline timings', async ({ page }) => {
  test.skip(!process.env.UPDATE_BASELINE, 'timings are only recorded with UPDATE_BASELINE=1');
  await openEditor(page);
  await setupScene(page);
  for (const z of [25, 100]) {
    await frame(page, z);
    saveBaselineKey(`t_render_${z}`, await medianMs(page, 'render'));
  }
  await frame(page, 100);
  saveBaselineKey('t_minimap', await medianMs(page, 'minimap'));
  saveBaselineKey('t_byHexId_200k', await page.evaluate(() => {
    const ids = ['Plain_1', 'Forest_1', 'Water_1', 'Hills_1'];
    const s = performance.now();
    for (let i = 0; i < 200000; i++) Terrain.byHexId(ids[i & 3]);
    return performance.now() - s;
  }));
});
