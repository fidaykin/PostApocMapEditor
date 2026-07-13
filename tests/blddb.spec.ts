import { test, expect, type Page } from '@playwright/test';
import { MINIMAL_BLD_DB, MINIMAL_HEX_DB, MINIMAL_MAP } from './fixtures';

test.describe('Building Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(({ bld, hex, map }) => {
      localStorage.setItem('blddb_autosave', JSON.stringify(bld));
      localStorage.setItem('hexdb_autosave', JSON.stringify(hex));
      localStorage.setItem('map_autosave', JSON.stringify(map));
    }, { bld: MINIMAL_BLD_DB, hex: MINIMAL_HEX_DB, map: MINIMAL_MAP });

    await page.goto('/MapEditorPro.html');
    await page.locator('#tab-buildings').click();
    await expect(page.locator('body')).toHaveClass(/mode-buildings/);
    // Elements in the panel are in DOM but may be layout-hidden in headless
    await page.waitForSelector('#bld-list .hexdb-list-row', { state: 'attached' });
    await page.locator('#bld-list .hexdb-list-row').first().click({ force: true });
    await page.waitForSelector('#bld-f-capacity', { state: 'attached' });
  });

  // ── Field rendering ───────────────────────────────────────────────

  test('selects building and renders key fields', async ({ page }) => {
    await expect(page.locator('#bld-f-id')).toHaveValue(/.+/);
    await expect(page.locator('#bld-f-capacity')).toBeAttached();
    await expect(page.locator('#bld-f-incomeTransformTo')).toBeAttached();
  });

  test('capacity field shows correct initial value', async ({ page }) => {
    await expect(page.locator('#bld-f-capacity')).toHaveValue('5');
  });

  // ── Capacity integer validation ───────────────────────────────────

  test('capacity: decimal key (.) is blocked', async ({ page }) => {
    const cap = page.locator('#bld-f-capacity');
    await cap.fill('3');
    await cap.press('.');
    await cap.pressSequentially('7');
    expect(await cap.inputValue()).not.toContain('.');
  });

  test('capacity: e/E keys are blocked', async ({ page }) => {
    const cap = page.locator('#bld-f-capacity');
    await cap.fill('2');
    await cap.press('e');
    await cap.pressSequentially('5');
    expect(await cap.inputValue()).not.toContain('e');
  });

  test('capacity: normalises to integer on change event', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.getElementById('bld-f-capacity') as HTMLInputElement;
      el.value = '4.9';
      el.dispatchEvent(new Event('change'));
    });
    await expect(page.locator('#bld-f-capacity')).toHaveValue('4');
  });

  test('capacity: negative value clamped to 0 on change', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.getElementById('bld-f-capacity') as HTMLInputElement;
      el.value = '-3';
      el.dispatchEvent(new Event('change'));
    });
    await expect(page.locator('#bld-f-capacity')).toHaveValue('0');
  });

  // ── Resource amount integer validation ────────────────────────────

  test('resource amount: decimal key (.) is blocked', async ({ page }) => {
    const amt = page.locator('[data-res-key="amount"]').first();
    await amt.fill('10');
    await amt.press('.');
    await amt.pressSequentially('5');
    expect(await amt.inputValue()).not.toContain('.');
  });

  test('resource amount: e key is blocked', async ({ page }) => {
    const amt = page.locator('[data-res-key="amount"]').first();
    await amt.fill('10');
    await amt.press('e');
    await amt.pressSequentially('2');
    expect(await amt.inputValue()).not.toContain('e');
  });

  test('resource amount: normalises to integer on change', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('[data-res-key="amount"]') as HTMLInputElement;
      if (el) { el.value = '7.8'; el.dispatchEvent(new Event('change')); }
    });
    const val = await page.evaluate(() => {
      const el = document.querySelector('[data-res-key="amount"]') as HTMLInputElement;
      return el?.value;
    });
    expect(val).toBe('7');
  });

  // ── Transform to tile dropdown ────────────────────────────────────

  test('Income Transform to field has blddb-hex-id-list datalist', async ({ page }) => {
    const listId = await page.locator('#bld-f-incomeTransformTo').getAttribute('list');
    expect(listId).toBe('blddb-hex-id-list');
  });

  test('blddb-hex-id-list datalist contains hex IDs from HexDB', async ({ page }) => {
    const count = await page.evaluate(() =>
      document.querySelector<HTMLDataListElement>('#blddb-hex-id-list')
        ?.querySelectorAll('option').length ?? 0
    );
    expect(count).toBeGreaterThan(0);
  });

  test('Destroy Transform to field has blddb-hex-id-list datalist', async ({ page }) => {
    const listId = await page.locator('#bld-f-destroyTransformTo').getAttribute('list');
    expect(listId).toBe('blddb-hex-id-list');
  });

  // ── Save / localStorage round-trip ───────────────────────────────

  test('edited capacity is saved to localStorage', async ({ page }) => {
    const cap = page.locator('#bld-f-capacity');
    await cap.fill('9');
    await cap.press('Tab');

    const saved = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('blddb_autosave') || '{}');
      return d?.buildings?.[0]?.capacity;
    });
    expect(saved).toBe(9);
  });
});
