import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, hexRec } from './helpers';

// fallbackPackage (2026-11-27): a package can declare another package as its fallback. The game client auto-includes the
// fallback whenever the owner is active, so coastline/road art falls through to it. Registry-only, written only when set,
// same rule as autoUnlock — never on the default package, never on itself, never pointing at postapoc.

const REG = 'packages/registry.json';
const entry = (gh: FakeGitHub, id: string) => gh.json(REG).packages.find((p: any) => p.id === id);

function fake(pkgs: any[]) {
  const gh = new FakeGitHub();
  gh.setRegistry(pkgs as any);
  for (const p of pkgs) gh.setJson(`packages/${p.id}/package.json`, { id: p.id, name: p.name, version: p.version ?? '1.0.0', description: 'd', isDefault: false });
  return gh;
}
async function boot(page: Page, gh: FakeGitHub) {
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.waitForFunction(() => !!Packages.getEntry('a'));
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('A_One', 'a', {})]);
}
async function setFallback(page: Page, value: string) {
  await page.click('#tab-packages');
  await page.locator('tr[data-pkg="a"]').getByRole('button', { name: 'Details' }).click();
  const input = page.locator('#pkg-det-fallback');
  await expect(input).toBeVisible();
  await input.fill(value);
  await page.getByRole('button', { name: 'Save details' }).click();
}

test('field is offered for a custom package, empty by default, absent for the default package', async ({ page }) => {
  const gh = fake([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]);
  await boot(page, gh);
  await page.click('#tab-packages');
  await page.locator('tr[data-pkg="a"]').getByRole('button', { name: 'Details' }).click();
  await expect(page.locator('#pkg-det-fallback')).toHaveValue('');
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => { Packages.openDetails('postapoc'); return !!document.getElementById('pkg-det-fallback'); })).toBe(false);
});

test('setting it to another installed package persists it and survives a reload of the panel', async ({ page }) => {
  const gh = fake([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]);
  await boot(page, gh);
  await setFallback(page, 'b');
  await expect(page.locator('#pkg-details-modal')).toHaveCount(0);
  expect(await page.evaluate(() => Packages.getDetails('a').fallbackPackage)).toBe('b');
  await page.locator('tr[data-pkg="a"]').getByRole('button', { name: 'Details' }).click();
  await expect(page.locator('#pkg-det-fallback')).toHaveValue('b');
});

test('a package cannot be its own fallback', async ({ page }) => {
  const gh = fake([{ id: 'a', name: 'Alpha' }]);
  await boot(page, gh);
  await setFallback(page, 'a');
  await expect(page.locator('#pkg-det-error')).toContainText('cannot be its own fallback');
  await expect(page.locator('#pkg-details-modal')).toBeVisible();
  expect(await page.evaluate(() => Packages.getDetails('a').fallbackPackage)).toBe('');
});

test('postapoc is rejected: it is already the built-in fallback', async ({ page }) => {
  const gh = fake([{ id: 'a', name: 'Alpha' }]);
  await boot(page, gh);
  await setFallback(page, 'postapoc');
  await expect(page.locator('#pkg-det-error')).toContainText('already the built-in fallback');
  await expect(page.locator('#pkg-details-modal')).toBeVisible();
});

test('an id not present in the registry is a warning, not an error, and still saves', async ({ page }) => {
  const gh = fake([{ id: 'a', name: 'Alpha' }]);
  await boot(page, gh);
  await setFallback(page, 'not-installed');
  await expect(page.locator('#pkg-details-modal')).toHaveCount(0);
  expect(await page.evaluate(() => Packages.getDetails('a').fallbackPackage)).toBe('not-installed');
  const w = await page.evaluate(() => Packages.validateDetails('a', { fallbackPackage: 'not-installed' } as any).warnings);
  expect(w.join(' ')).toContain('not-installed');
});

test('publish writes fallbackPackage when set and omits it when unset', async ({ page }) => {
  const gh = fake([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]);
  await boot(page, gh);
  await setFallback(page, 'b');
  await page.evaluate(() => Packages.publishPackage('a'));
  expect(entry(gh, 'a').fallbackPackage).toBe('b');
  expect(gh.json(`packages/a/package.json`).fallbackPackage).toBeUndefined();
  await setFallback(page, '');
  await page.evaluate(() => Packages.publishPackage('a'));
  expect('fallbackPackage' in entry(gh, 'a')).toBe(false);
});

test('republishing keeps an existing fallbackPackage untouched when the editor made no change', async ({ page }) => {
  const gh = fake([{ id: 'a', name: 'Alpha', version: '1.0.0', fallbackPackage: 'b' }, { id: 'b', name: 'Beta' }]);
  await boot(page, gh);
  await page.evaluate(() => Packages.publishPackage('a'));
  expect(entry(gh, 'a').fallbackPackage).toBe('b');
});

test('fallbackPackage must be a lowercase package id', async ({ page }) => {
  await boot(page, fake([{ id: 'a', name: 'Alpha' }]));
  const r = await page.evaluate(() => [
    Packages.validateDetails('a', { fallbackPackage: 'Bad Id' } as any).ok,
    Packages.validateDetails('a', { fallbackPackage: 'decameroon' } as any).ok,
    Packages.validateDetails('a', { fallbackPackage: '' } as any).ok,
  ]);
  expect(r).toEqual([false, true, true]);
});
