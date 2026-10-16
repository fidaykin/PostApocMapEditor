import { test, expect, Page } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// The coastline preview is turned off in the editor: the button is disabled, nothing is drawn and the shortcut
// does nothing. (Unity draws its own shores; the preview only confused authors.)

const btn = (page: Page) => page.locator('#btn-toggle-coastline');

// Counts Coastline.drawOverlay calls during one render of a map with a water cell next to land.
async function overlayCallsOnWaterNextToLand(page: Page): Promise<number> {
  return page.evaluate(() => {
    const water = HexDB.getAll().find((h: any) => h.type === 'Water' && h.id);
    if (!water) throw new Error('no Water tile in the base hex DB');
    const c = Math.floor(MAP_WIDTH / 2), r = Math.floor(MAP_HEIGHT / 2) + 3;   // land all around (blank Plain_1 map)
    mapData[r * MAP_WIDTH + c] = water.id;
    let calls = 0;
    const orig = Coastline.drawOverlay;
    (Coastline as any).drawOverlay = (...a: any[]) => { calls++; return orig.apply(Coastline, a as any); };
    try { Canvas.centerOnCity(); Canvas.setZoom(120); Canvas.render(); } finally { (Coastline as any).drawOverlay = orig; }
    return calls;
  });
}

test.describe('coastline preview is off', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('the Coastline button is disabled, dimmed and explains why', async ({ page }) => {
    await expect(btn(page)).toBeDisabled();
    expect(await btn(page).evaluate(e => getComputedStyle(e).opacity)).toBe('0.4');
    expect(await btn(page).getAttribute('title')).toMatch(/turned off/i);
  });

  test('a water cell next to land draws no coastline overlay', async ({ page }) => {
    expect(await overlayCallsOnWaterNextToLand(page)).toBe(0);
  });

  test('positive control: the developer switch draws the overlay, so the zero above means something', async ({ page }) => {
    await page.evaluate(() => Canvas.setCoastlinePreview(true));
    expect(await overlayCallsOnWaterNextToLand(page)).toBeGreaterThan(0);
  });

  test('the 3 key and Canvas.toggleCoastline() change nothing', async ({ page }) => {
    await page.keyboard.press('3');
    await page.evaluate(() => Canvas.toggleCoastline());
    expect(await btn(page).evaluate(e => getComputedStyle(e).opacity)).toBe('0.4');
    await expect(btn(page)).toBeDisabled();
    expect(await overlayCallsOnWaterNextToLand(page)).toBe(0);
  });
});
