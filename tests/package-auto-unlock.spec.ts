import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, hexRec } from './helpers';

// Per-package "install by default" (autoUnlock): a registry-level flag the game client reads. Written only as true, preserved
// when the registry entry is rewritten, never available for the default package.

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
async function setFlag(page: Page, on: boolean) {
  await page.click('#tab-packages');
  await page.locator('tr[data-pkg="a"]').getByRole('button', { name: 'Details' }).click();
  const cb = page.locator('#pkg-det-autounlock');
  await expect(cb).toBeVisible();
  if (on) await cb.check(); else await cb.uncheck();
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.locator('#pkg-details-modal')).toHaveCount(0);
}

test('checkbox is offered for a custom package, reflects the registry, and is absent for the default package', async ({ page }) => {
  const gh = fake([{ id: 'a', name: 'Alpha', autoUnlock: true }, { id: 'b', name: 'Beta' }]);
  await boot(page, gh);
  await page.click('#tab-packages');
  await page.locator('tr[data-pkg="a"]').getByRole('button', { name: 'Details' }).click();
  await expect(page.locator('#pkg-det-autounlock')).toBeChecked();
  await expect(page.locator('#pkg-details')).toContainText('Install by default (auto-unlock at game launch)');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('tr[data-pkg="b"]').getByRole('button', { name: 'Details' }).click();
  await expect(page.locator('#pkg-det-autounlock')).not.toBeChecked();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('tr[data-pkg="postapoc"]').getByRole('button', { name: 'Details' })).toHaveCount(0);
  expect(await page.evaluate(() => { Packages.openDetails('postapoc'); return !!document.getElementById('pkg-det-autounlock'); })).toBe(false);
  expect(await page.evaluate(() => Packages.updateDetails('postapoc', { autoUnlock: true } as any))).toBe(false);
});

test('badge shows only for entries with autoUnlock true', async ({ page }) => {
  const gh = fake([{ id: 'a', name: 'Alpha', autoUnlock: true }, { id: 'b', name: 'Beta' }]);
  await boot(page, gh);
  await page.click('#tab-packages');
  await expect(page.locator('tr[data-pkg="a"] .pkg-auto-badge')).toHaveText('auto');
  await expect(page.locator('tr[data-pkg="b"] .pkg-auto-badge')).toHaveCount(0);
  await expect(page.locator('tr[data-pkg="postapoc"] .pkg-auto-badge')).toHaveCount(0);
});

test('toggle on + publish writes autoUnlock:true; toggle off + publish removes it', async ({ page }) => {
  const gh = fake([{ id: 'a', name: 'Alpha' }]);
  await boot(page, gh);
  await setFlag(page, true);
  await page.evaluate(() => Packages.publishPackage('a'));
  expect(entry(gh, 'a').autoUnlock).toBe(true);
  expect(entry(gh, 'a').version).toBe('1.0.1');
  await expect(page.locator('tr[data-pkg="a"] .pkg-auto-badge')).toHaveText('auto');
  await setFlag(page, false);
  await page.evaluate(() => Packages.publishPackage('a'));
  expect('autoUnlock' in entry(gh, 'a')).toBe(false);
  await expect(page.locator('tr[data-pkg="a"] .pkg-auto-badge')).toHaveCount(0);
});

test('republishing and bumping keep an existing autoUnlock:true; an entry without it stays without', async ({ page }) => {
  const gh = fake([{ id: 'a', name: 'Alpha', version: '1.2.3', autoUnlock: true }, { id: 'b', name: 'Beta' }]);
  await boot(page, gh);
  await page.evaluate(() => Packages.publishPackage('a'));
  expect(entry(gh, 'a').version).toBe('1.2.4');
  expect(entry(gh, 'a').autoUnlock).toBe(true);
  await page.evaluate(() => Packages.publishPackage('a', { bump: 'minor' }));
  expect(entry(gh, 'a').version).toBe('1.3.0');
  expect(entry(gh, 'a').autoUnlock).toBe(true);
  await page.evaluate(() => Packages.publishPackage('a', { bump: 'none' }));
  expect(entry(gh, 'a').autoUnlock).toBe(true);
  // a save of other details must not touch the flag either
  await page.evaluate(() => Packages.updateDetails('a', { description: 'changed' }));
  await page.evaluate(() => Packages.publishPackage('a'));
  expect(entry(gh, 'a').autoUnlock).toBe(true);
  // B never had it
  await page.evaluate(() => HexDB.addEntries([{ id: 'B_One', package: 'b', type: 'Plains' }]));
  await page.evaluate(() => Packages.publishPackage('b'));
  expect('autoUnlock' in entry(gh, 'b')).toBe(false);
});

test('base refresh keeps autoUnlock on the entry', async ({ page }) => {
  const gh = fake([{ id: 'a', name: 'Alpha', autoUnlock: true }]);
  await boot(page, gh);
  await page.evaluate(() => GitHubSync.refreshBaseManifest('a'));
  expect(entry(gh, 'a').autoUnlock).toBe(true);
});

test('delete then restore keeps autoUnlock', async ({ page }) => {
  const gh = fake([{ id: 'a', name: 'Alpha', autoUnlock: true }]);
  await boot(page, gh);
  await page.evaluate(() => Packages.deletePackage('a'));
  expect(entry(gh, 'a')).toBeUndefined();
  await page.evaluate(() => Packages.restoreDeleted('a'));
  expect(entry(gh, 'a').autoUnlock).toBe(true);
});

test('autoUnlock must be a boolean', async ({ page }) => {
  await boot(page, fake([{ id: 'a', name: 'Alpha' }]));
  const r = await page.evaluate(() => [Packages.validateDetails('a', { autoUnlock: 'yes' } as any).ok, Packages.validateDetails('a', { autoUnlock: true } as any).ok]);
  expect(r).toEqual([false, true]);
});
