import { test, expect } from '@playwright/test';
import { openEditor, reloadEditor, FakeGitHub } from './helpers';

const REG = [{ id: 'medieval', name: 'Medieval Kingdom' }, { id: 'scifi', name: 'Sci-Fi' }];

async function open(page: any, storage?: Record<string, string>) {
  const gh = new FakeGitHub();
  gh.setRegistry(REG);
  await openEditor(page, { gh, pat: true, storage });
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.waitForFunction(() => Packages.getAll().length === 3);
  return gh;
}

test('the active package is chosen from HEX DB and BUILDINGS toolbars and stays in sync with the PACKAGES tab', async ({ page }) => {
  await open(page);
  await page.click('#tab-hexdb');
  const hexSel = page.locator('#hexdb-tools select.pkg-active-select');
  await expect(hexSel).toBeVisible();
  await expect(hexSel.locator('option')).toHaveCount(3);
  await expect(hexSel).toHaveAttribute('aria-label', /active package/i);
  await hexSel.selectOption('medieval');
  expect(await page.evaluate(() => Packages.getActive())).toBe('medieval');
  await expect(page.locator('#hexdb-pkg-badge')).toHaveText('[Medieval]');

  await page.click('#tab-buildings');
  const bldSel = page.locator('#bld-tools select.pkg-active-select');
  await expect(bldSel).toHaveValue('medieval');
  await bldSel.selectOption('scifi');
  await page.click('#tab-hexdb');
  await expect(hexSel).toHaveValue('scifi');

  await page.click('#tab-packages');
  await expect(page.locator('#pkg-active-select')).toHaveValue('scifi');
  await expect(page.locator('tr[data-pkg="scifi"] .pkg-active-dot')).toBeVisible();
  // and the other direction: the PACKAGES row marker drives the toolbars
  await page.locator('tr[data-pkg="postapoc"] .pkg-set-active').click();
  await page.click('#tab-buildings');
  await expect(bldSel).toHaveValue('postapoc');
});

test('the select is a native, labelled, focusable control (keyboard operable)', async ({ page }) => {
  await open(page);
  await page.click('#tab-hexdb');
  const sel = page.getByRole('combobox', { name: /active package/i });
  await expect(sel).toHaveCount(1);        // only the visible toolbar's select is exposed
  await sel.focus();
  expect(await page.evaluate(() => document.activeElement?.matches('#hexdb-tools select.pkg-active-select'))).toBe(true);
  expect(await sel.evaluate((e: HTMLSelectElement) => e.tabIndex >= 0 && !e.disabled)).toBe(true);
  await sel.selectOption({ label: 'Medieval Kingdom' });   // dispatches the same change event the keyboard produces
  expect(await page.evaluate(() => Packages.getActive())).toBe('medieval');
});

test('new entries are authored into the package chosen in the toolbar', async ({ page }) => {
  await open(page);
  await page.click('#tab-hexdb');
  await page.locator('#hexdb-tools select.pkg-active-select').selectOption('medieval');
  await page.getByRole('button', { name: '+ Add Hex' }).click();
  await page.click('#tab-buildings');
  await page.getByRole('button', { name: '+ Add Building' }).click();
  const r = await page.evaluate(() => {
    const h = HexDB.getData().hexes.at(-1), b = BldDB.getAll().at(-1);
    return { h: [h.id, h.package], b: [b.id, b.package] };
  });
  expect(r.h[0]).toMatch(/^Medieval_NewHex_/); expect(r.h[1]).toBe('medieval');
  expect(r.b[0]).toMatch(/^Medieval_/); expect(r.b[1]).toBe('medieval');
});

test('the choice is remembered per browser and survives a reload', async ({ page }) => {
  await open(page);
  await page.click('#tab-hexdb');
  await page.locator('#hexdb-tools select.pkg-active-select').selectOption('scifi');
  await reloadEditor(page);
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.waitForFunction(() => Packages.getAll().length === 3);
  expect(await page.evaluate(() => Packages.getActive())).toBe('scifi');
  await page.click('#tab-buildings');
  await expect(page.locator('#bld-tools select.pkg-active-select')).toHaveValue('scifi');
});

test('a remembered package that no longer exists falls back to the default with a toast', async ({ page }) => {
  await open(page, { pkg_active: 'gone' });
  await page.waitForFunction(() => Packages.getActive() === 'postapoc');
  await expect(page.locator('.toast', { hasText: 'gone' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pkg_active'))).toBe('postapoc');
  await page.click('#tab-hexdb');
  await expect(page.locator('#hexdb-tools select.pkg-active-select')).toHaveValue('postapoc');
});

test('selecting an unknown package keeps the current one and says so; blocked storage does not break selection', async ({ page }) => {
  await open(page);
  await page.evaluate(() => Packages.setActive('medieval'));
  await page.evaluate(() => Packages.setActive('nope'));
  expect(await page.evaluate(() => Packages.getActive())).toBe('medieval');
  await expect(page.locator('.toast', { hasText: 'nope' })).toBeVisible();
  await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) { if (k === 'pkg_active') throw new DOMException('blocked', 'SecurityError'); return orig.call(this, k, v); };
  });
  await page.evaluate(() => Packages.setActive('scifi'));
  expect(await page.evaluate(() => Packages.getActive())).toBe('scifi');
  await page.click('#tab-hexdb');
  await expect(page.locator('#hexdb-tools select.pkg-active-select')).toHaveValue('scifi');
});

test('package names are text in the selectors, and the map canvas keeps its size', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'evil', name: '<img src=x onerror="window.__xss=1">' }]);
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.waitForFunction(() => Packages.getAll().length === 2);
  await page.click('#tab-hexdb');
  expect(await page.locator('#hexdb-tools select.pkg-active-select img').count()).toBe(0);
  await expect(page.locator('#hexdb-tools select.pkg-active-select option').nth(1)).toHaveText('<img src=x onerror="window.__xss=1">');
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  await page.click('#tab-map');
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  const box = await page.evaluate(() => { const c = document.getElementById('map-canvas') as HTMLCanvasElement; return [c.width, c.height]; });
  expect(box).toEqual([1491, 808]);
});
