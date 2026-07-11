import { test, expect, type Page } from '@playwright/test';
import { MINIMAL_MAP } from './fixtures';

const withMap = (page: Page) =>
  page.addInitScript((map) => {
    localStorage.setItem('map_autosave', JSON.stringify(map));
  }, MINIMAL_MAP);

const clickTab = async (page: Page, mode: string) => {
  await page.locator(`#tab-${mode}`).click();
  await expect(page.locator('body')).toHaveClass(new RegExp(`mode-${mode}`));
};

test.describe('Editor — core load and navigation', () => {
  test('loads without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await withMap(page);
    await page.goto('/MapEditorPro.html');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test('all primary tab buttons are visible', async ({ page }) => {
    await withMap(page);
    await page.goto('/MapEditorPro.html');
    for (const id of ['tab-map', 'tab-hexdb', 'tab-buildings', 'tab-settlements', 'tab-keys']) {
      await expect(page.locator(`#${id}`), `tab #${id}`).toBeVisible();
    }
  });

  test('HEX DB mode: body class changes and panel is not hidden', async ({ page }) => {
    await withMap(page);
    await page.goto('/MapEditorPro.html');
    await clickTab(page, 'hexdb');
    const display = await page.locator('#hexdb-main').evaluate(
      el => getComputedStyle(el).display
    );
    expect(display).not.toBe('none');
  });

  test('BUILDINGS mode: body class changes and panel is not hidden', async ({ page }) => {
    await withMap(page);
    await page.goto('/MapEditorPro.html');
    await clickTab(page, 'buildings');
    const display = await page.locator('#buildings-main').evaluate(
      el => getComputedStyle(el).display
    );
    expect(display).not.toBe('none');
  });

  test('switching mode hides previous panel', async ({ page }) => {
    await withMap(page);
    await page.goto('/MapEditorPro.html');
    await clickTab(page, 'hexdb');
    await clickTab(page, 'buildings');
    expect(await page.locator('#hexdb-main').evaluate(el => getComputedStyle(el).display)).toBe('none');
    expect(await page.locator('#buildings-main').evaluate(el => getComputedStyle(el).display)).not.toBe('none');
  });
});
