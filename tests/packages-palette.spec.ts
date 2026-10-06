import { test, expect, Page } from '@playwright/test';
import { openEditor, reloadEditor, FakeGitHub, hexRec, bldRec, seedHexes, seedBuildings } from './helpers';

// T5.11: the palette groups terrain and building tiles by package (default package first, collapsible headers that are
// real buttons, state remembered per browser), a package without visible entries has no header, and the package chips
// still hide a package everywhere. Package names and ids are untrusted (textContent only).

async function boot(page: Page, extra: { id: string; name: string }[] = [{ id: 'medieval', name: 'Medieval Kingdom' }]) {
  const gh = new FakeGitHub();
  gh.setRegistry(extra);
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.waitForFunction(n => Packages.getAll().length >= n, extra.length + 1);
  await seedHexes(page, [hexRec('Med_A', 'medieval'), hexRec('Med_B', 'medieval', { type: 'Forests' })]);
  await seedBuildings(page, [bldRec('Med_Farm', 'medieval', { type: 'Ground Building', buildingCategory: 'Standard' })]);
  await page.evaluate(() => UI.buildPalette());
}
const headers = (page: Page) => page.locator('#palette-scroll .pkg-header');
const tile = (page: Page, id: string) => page.locator(`#palette-scroll [data-hex-id="${id}"]`);

test('groups by package: default first, headers are buttons with counts, tiles live inside their own group', async ({ page }) => {
  await boot(page);
  await expect(headers(page)).toHaveCount(2);
  expect(await headers(page).evaluateAll(h => h.map(e => e.tagName))).toEqual(['BUTTON', 'BUTTON']);
  await expect(headers(page).nth(0)).toContainText('Post-Apocalypse');
  await expect(headers(page).nth(1)).toContainText('Medieval Kingdom (3)');
  await expect(headers(page).nth(1)).toHaveAttribute('aria-expanded', 'true');
  expect(await tile(page, 'Med_A').evaluate(e => e.closest('.pkg-group')!.getAttribute('data-pkg'))).toBe('medieval');
  expect(await tile(page, 'Med_Farm').evaluate(e => e.closest('.pkg-group')!.getAttribute('data-pkg'))).toBe('medieval');
  expect(await tile(page, 'Plain_1').evaluate(e => e.closest('.pkg-group')!.getAttribute('data-pkg'))).toBe('postapoc');
  await expect(tile(page, 'Med_Farm').locator('.tile-tooltip')).toHaveText('Med_Farm [medieval]');
  // categories do not bleed across packages: the medieval group has its own category headers
  expect(await page.locator('.pkg-group[data-pkg="medieval"] .cat-header').allInnerTexts()).toEqual(expect.arrayContaining(['🌾 PLAINS', '🌲 FOREST']));
});

test('package chips hide a package for terrain and buildings; a single visible package shows no group headers', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => Packages.togglePkgFilter('medieval'));
  await expect(headers(page)).toHaveCount(0);
  await expect(tile(page, 'Med_A')).toHaveCount(0);
  await expect(tile(page, 'Med_Farm')).toHaveCount(0);
  await expect(tile(page, 'Plain_1')).toHaveCount(1);
  await page.evaluate(() => Packages.togglePkgFilter('medieval'));
  await expect(headers(page)).toHaveCount(2);
  await expect(tile(page, 'Med_Farm')).toHaveCount(1);
});

test('a package with no visible entries has no header', async ({ page }) => {
  await boot(page, [{ id: 'medieval', name: 'Medieval Kingdom' }, { id: 'empty', name: 'Empty One' }]);
  await expect(headers(page)).toHaveCount(2);
  await expect(page.locator('#palette-scroll')).not.toContainText('Empty One');
});

test('collapse: aria-expanded flips, tiles hide, keyboard works, state survives rebuild and reload, selection stays', async ({ page }) => {
  await boot(page);
  await tile(page, 'Med_A').click();
  await expect(tile(page, 'Med_A')).toHaveClass(/selected/);
  const h = headers(page).nth(1);
  await h.focus();
  await page.keyboard.press('Enter');
  await expect(h).toHaveAttribute('aria-expanded', 'false');
  await expect(tile(page, 'Med_A')).toBeHidden();
  await expect(tile(page, 'Plain_1')).toHaveCount(1);
  expect(await page.evaluate(() => UI.getSelectedTerrain())).toBe('Med_A');
  await page.evaluate(() => UI.buildPalette());
  await expect(headers(page).nth(1)).toHaveAttribute('aria-expanded', 'false');
  await expect(tile(page, 'Med_A')).toHaveClass(/selected/);          // selection re-applied inside the collapsed group
  await reloadEditor(page);
  await expect(headers(page).nth(1)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');
  await headers(page).nth(1).click();
  await expect(headers(page).nth(1)).toHaveAttribute('aria-expanded', 'true');
  await expect(tile(page, 'Med_A')).toBeVisible();
});

test('stored state that is garbage or a throwing localStorage never breaks the palette', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { localStorage.setItem('palette_pkg_collapsed', '{not json'); UI.buildPalette(); });
  await expect(headers(page)).toHaveCount(2);
  await expect(headers(page).nth(1)).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => { localStorage.setItem('palette_pkg_collapsed', '{"a":1}'); UI.buildPalette(); });
  await expect(headers(page)).toHaveCount(2);
  await page.evaluate(() => {
    const orig = Storage.prototype.setItem, g = Storage.prototype.getItem;
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    Storage.prototype.getItem = () => { throw new Error('denied'); };
    (window as any).__restore = () => { Storage.prototype.setItem = orig; Storage.prototype.getItem = g; };
    UI.buildPalette();
  });
  await headers(page).nth(1).click();                                   // toggling still works in memory, no throw
  await expect(headers(page).nth(1)).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => (window as any).__restore());
});

test('active package marker follows setActive without rebuilding the palette', async ({ page }) => {
  await boot(page);
  const dot = (id: string) => page.locator(`.pkg-header[data-pkg="${id}"] .pkg-active-dot`);
  await expect(dot('postapoc')).toHaveCount(1);
  await expect(dot('medieval')).toHaveCount(0);
  await page.evaluate(() => Packages.setActive('medieval'));
  await expect(dot('medieval')).toHaveCount(1);
  await expect(dot('postapoc')).toHaveCount(0);
  await expect(page.locator('.pkg-header[data-pkg="medieval"]')).toHaveClass(/active/);
});

test('hostile package names are plain text; grouping is computed once per build', async ({ page }) => {
  await boot(page, [{ id: 'medieval', name: '<img src=x onerror=window.__xss=1>Evil' }]);
  await expect(headers(page).nth(1)).toContainText('<img src=x onerror=window.__xss=1>Evil');
  await expect(headers(page).locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  const calls = await page.evaluate(() => {
    let n = 0; const o = Packages.getAll;
    (Packages as any).getAll = () => { n++; return o(); };
    UI.buildPalette();
    (Packages as any).getAll = o;
    return n;
  });
  expect(calls).toBeGreaterThan(0);                 // positive control: the build does consult the registry
  expect(calls).toBeLessThanOrEqual(4);             // ... a bounded number of times, not once per comparison/tile
});
