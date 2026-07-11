import { test, expect, type Page } from '@playwright/test';
import { MINIMAL_HEX_DB, MINIMAL_MAP } from './fixtures';

test.describe('Hex Editor', () => {
  test.beforeEach(async ({ page }) => {
    // Block static DB fetch so our test fixture is the only data
    await page.route('**/hex_database.json', route =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ dbVersion: 1, hexes: [] }) })
    );

    await page.addInitScript(({ hex, map }) => {
      localStorage.setItem('hexdb_autosave', JSON.stringify(hex));
      localStorage.setItem('map_autosave', JSON.stringify(map));
    }, { hex: MINIMAL_HEX_DB, map: MINIMAL_MAP });

    await page.goto('/MapEditorPro.html');
    await page.locator('#tab-hexdb').click();
    await expect(page.locator('body')).toHaveClass(/mode-hexdb/);
    await page.waitForSelector('#hexdb-list .hexdb-list-row', { state: 'attached' });
    await page.locator('#hexdb-list .hexdb-list-row').first().click({ force: true });
    await page.waitForSelector('[data-field="baseCostTaps"]', { state: 'attached' });
  });

  // ── Field rendering ───────────────────────────────────────────────

  test('renders hex form fields after selection', async ({ page }) => {
    await expect(page.locator('[data-field="baseCostTaps"]')).toBeAttached();
    await expect(page.locator('[data-field="destroyTransformTo"]')).toBeAttached();
  });

  // ── Destroy Transform to datalist ────────────────────────────────

  test('Destroy Transform to has hexdb-id-list datalist', async ({ page }) => {
    const listId = await page.locator('[data-field="destroyTransformTo"]').getAttribute('list');
    expect(listId).toBe('hexdb-id-list');
  });

  test('hexdb-id-list contains at least one option', async ({ page }) => {
    const count = await page.evaluate(() =>
      document.querySelector<HTMLDataListElement>('#hexdb-id-list')
        ?.querySelectorAll('option').length ?? 0
    );
    expect(count).toBeGreaterThan(0);
  });

  test('Income Transform to has hexdb-id-list datalist', async ({ page }) => {
    const listId = await page.locator('[data-field="incomeTransformTo"]').getAttribute('list');
    expect(listId).toBe('hexdb-id-list');
  });

  // ── Edit and save round-trip ──────────────────────────────────────

  test('editing baseCostTaps saves to hexdb_autosave', async ({ page }) => {
    const input = page.locator('[data-field="baseCostTaps"]');
    await input.fill('5');
    await input.press('Tab');

    const saved = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('hexdb_autosave') || '{}');
      return d?.hexes?.[0]?.baseCostTaps;
    });
    expect(saved).toBe(5);
  });

  test('toggling canDestroy checkbox updates the field', async ({ page }) => {
    const getState = () => page.evaluate(() =>
      (document.querySelector('[data-field="canDestroy"]') as HTMLInputElement)?.checked
    );
    const initial = await getState();
    await page.evaluate(() =>
      (document.querySelector('[data-field="canDestroy"]') as HTMLInputElement)?.click()
    );
    expect(await getState()).toBe(!initial);
  });
});
