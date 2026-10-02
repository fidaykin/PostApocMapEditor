import { test, expect } from '@playwright/test';
import { openEditor, FakeGitHub } from './helpers';

async function setup(page: any) {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'delpkg', name: 'Del Pkg' }]);
  gh.setJson('maps/map_list.json', { maps: [{ name: 'm1', fileName: 'm1.json' }, { name: 'm2', fileName: 'm2.json' }] });
  gh.setJson('maps/m1.json', { width: 20, height: 20, packages: ['postapoc', 'delpkg'], data: [] });
  gh.setJson('maps/m2.json', { width: 20, height: 20, packages: ['postapoc'], data: [] });
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('delpkg'));
  await page.evaluate(() => {
    HexDB.addEntries([{ id: 'Delpkg_H', package: 'delpkg', type: 'Plains' }]);
    BldDB.addEntries([{ id: 'Delpkg_B', package: 'delpkg' }]);
  });
  return gh;
}
const registryIds = (gh: FakeGitHub) => gh.json('packages/registry.json').packages.map((p: any) => p.id);
const hasEntries = (page: any) => page.evaluate(() =>
  [HexDB.getAll().some((h: any) => h.id === 'Delpkg_H'), BldDB.getAll().some((b: any) => b.id === 'Delpkg_B')]);

test('dialog lists entry counts and the maps that use the package', async ({ page }) => {
  const gh = await setup(page);
  await page.evaluate(() => { Packages.confirmDelete('delpkg'); });
  const d = page.locator('#dialog-details');
  await expect(d).toContainText('1 hex tile(s), 1 building(s)');
  await expect(d).toContainText('m1');
  await expect(d).not.toContainText('m2');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  expect(gh.putPaths()).toEqual([]);
});

test('Escape produces no writes and keeps everything', async ({ page }) => {
  const gh = await setup(page);
  await page.evaluate(() => { Packages.confirmDelete('delpkg'); });
  await expect(page.locator('#dialog-details')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(gh.putPaths()).toEqual([]);
  expect(registryIds(gh)).toContain('delpkg');
  expect(await hasEntries(page)).toEqual([true, true]);
});

test('"Delete, keep entries" removes only the registry entry', async ({ page }) => {
  const gh = await setup(page);
  await page.evaluate(() => { Packages.confirmDelete('delpkg'); });
  await page.getByRole('button', { name: 'Delete, keep entries' }).click();
  await expect.poll(() => registryIds(gh)).not.toContain('delpkg');
  expect(await hasEntries(page)).toEqual([true, true]);
});

test('"Delete and remove entries" also removes the local entries', async ({ page }) => {
  const gh = await setup(page);
  await page.evaluate(() => { Packages.confirmDelete('delpkg'); });
  await page.getByRole('button', { name: 'Delete and remove entries' }).click();
  await expect.poll(() => registryIds(gh)).not.toContain('delpkg');
  await expect.poll(() => hasEntries(page)).toEqual([false, false]);
});

test('usage counts maps that cannot be read instead of treating them as unused', async ({ page }) => {
  await setup(page);
  await page.route('**/maps/m2.json*', r => r.fulfill({ status: 500, body: 'boom' }));
  const u = await page.evaluate(() => Packages.usage('delpkg'));
  expect(u).toMatchObject({ maps: ['m1'], unreadable: 1, currentMap: false });
  expect(u.hex).toEqual(['Delpkg_H']);
  expect(u.bld).toEqual(['Delpkg_B']);
  await page.evaluate(() => { Packages.confirmDelete('delpkg'); });
  await expect(page.locator('#dialog-details')).toContainText('1 map(s) could not be checked');
});

test('usage reports an unreadable map list', async ({ page }) => {
  await setup(page);
  await page.route('**/maps/map_list.json*', r => r.fulfill({ status: 500, body: 'boom' }));
  const u = await page.evaluate(() => Packages.usage('delpkg'));
  expect(u.maps).toEqual([]);
  expect(u.unreadable).toBe(1);
});

test('fails closed when the server registry cannot be read: no write, entries kept, error toast', async ({ page }) => {
  const gh = await setup(page);
  await page.route('**/packages/registry.json*', r => r.fulfill({ status: 500, body: 'boom' }));
  await page.evaluate(() => { Packages.confirmDelete('delpkg'); });
  await page.getByRole('button', { name: 'Delete and remove entries' }).click();
  await expect(page.locator('.toast', { hasText: 'Delete failed' })).toBeVisible();
  expect(gh.putPaths()).toEqual([]);
  expect(registryIds(gh)).toContain('delpkg');
  expect(await hasEntries(page)).toEqual([true, true]);
  expect(await page.evaluate(() => !!Packages.getEntry('delpkg'))).toBe(true);
});

test('a failed registry write keeps local entries and the registry entry', async ({ page }) => {
  const gh = await setup(page);
  gh.failPut = p => p === 'packages/registry.json';
  await page.evaluate(() => { Packages.confirmDelete('delpkg'); });
  await page.getByRole('button', { name: 'Delete and remove entries' }).click();
  await expect(page.locator('.toast', { hasText: 'Delete failed' })).toBeVisible();
  expect(gh.putPaths()).toEqual([]);
  expect(registryIds(gh)).toContain('delpkg');
  expect(await hasEntries(page)).toEqual([true, true]);
  expect(await page.evaluate(() => !!Packages.getEntry('delpkg'))).toBe(true);
});

test('delete saves a restore copy and restoreDeleted brings back registry entry and entries', async ({ page }) => {
  const gh = await setup(page);
  await page.evaluate(() => { Packages.confirmDelete('delpkg'); });
  await page.getByRole('button', { name: 'Delete and remove entries' }).click();
  await expect.poll(() => registryIds(gh)).not.toContain('delpkg');

  const trash = await page.evaluate(() => Packages.listTrash());
  expect(trash.length).toBe(1);
  expect(trash[0].id).toBe('delpkg');
  expect(trash[0].hexes.map((h: any) => h.id)).toEqual(['Delpkg_H']);
  expect(await page.evaluate(() => document.getElementById('pkg-panel')!.textContent)).toContain('Recently deleted');

  await page.evaluate(() => Packages.restoreDeleted('delpkg'));
  expect(registryIds(gh)).toContain('delpkg');
  expect(await page.evaluate(() => [HexDB.getAll().some(h => h.id === 'Delpkg_H'), BldDB.getAll().some(b => b.id === 'Delpkg_B')])).toEqual([true, true]);
  expect(await page.evaluate(() => Packages.listTrash().length)).toBe(0);
});

test('delete is aborted when the restore copy cannot be stored', async ({ page }) => {
  const gh = await setup(page);
  await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'pkg_trash') throw new DOMException('full', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  });
  await page.evaluate(() => Packages.deletePackage('delpkg', { removeEntries: true }));
  expect(gh.putPaths()).toEqual([]);
  expect(await page.evaluate(() => HexDB.getAll().some(h => h.id === 'Delpkg_H'))).toBe(true);
  await expect(page.locator('.toast', { hasText: 'restore copy' })).toBeVisible();
});

test('a failed delete leaves no restore copy for a package that still exists', async ({ page }) => {
  const gh = await setup(page);
  gh.failPut = p => p === 'packages/registry.json';
  await page.evaluate(() => Packages.deletePackage('delpkg', { removeEntries: true }));
  await expect(page.locator('.toast', { hasText: 'Delete failed' })).toBeVisible();
  expect(await page.evaluate(() => Packages.listTrash().length)).toBe(0);
});

async function deleted(page: any, gh: FakeGitHub) {
  await page.evaluate(() => Packages.deletePackage('delpkg', { removeEntries: true }));
  await expect.poll(() => registryIds(gh)).not.toContain('delpkg');
  expect(await page.evaluate(() => Packages.listTrash().length)).toBe(1);
}

test('restore fails closed when the server registry cannot be read: no write, trash kept', async ({ page }) => {
  const gh = await setup(page);
  await deleted(page, gh);
  const before = gh.putPaths().length;
  await page.route('**/packages/registry.json*', r => r.fulfill({ status: 500, body: 'boom' }));
  await page.evaluate(() => Packages.restoreDeleted('delpkg'));
  await expect(page.locator('.toast', { hasText: 'Restore failed' })).toBeVisible();
  expect(gh.putPaths().length).toBe(before);
  expect(await page.evaluate(() => Packages.listTrash().length)).toBe(1);
  expect(await hasEntries(page)).toEqual([false, false]);
});

test('restore refuses when the id is already in the server registry', async ({ page }) => {
  const gh = await setup(page);
  await deleted(page, gh);
  gh.setRegistry([{ id: 'delpkg', name: 'Someone Else' }]);
  const before = gh.putPaths().length;
  await page.evaluate(() => Packages.restoreDeleted('delpkg'));
  await expect(page.locator('.toast', { hasText: 'already exists' })).toBeVisible();
  expect(gh.putPaths().length).toBe(before);
  expect(gh.json('packages/registry.json').packages.find((p: any) => p.id === 'delpkg').name).toBe('Someone Else');
  expect(await page.evaluate(() => Packages.listTrash().length)).toBe(1);
  expect(await hasEntries(page)).toEqual([false, false]);
});

test('restore refuses when the id is already in the local registry', async ({ page }) => {
  const gh = await setup(page);
  await page.evaluate(() => localStorage.setItem('pkg_trash', JSON.stringify([{ id: 'delpkg', entry: null, hexes: [], buildings: [], deletedAt: '2026-01-01' }])));
  await page.evaluate(() => Packages.restoreDeleted('delpkg'));
  await expect(page.locator('.toast', { hasText: 'already exists' })).toBeVisible();
  expect(gh.putPaths()).toEqual([]);
  expect(await page.evaluate(() => Packages.listTrash().length)).toBe(1);
});

test('a failed registry write during restore keeps the trash copy and adds no entries', async ({ page }) => {
  const gh = await setup(page);
  await deleted(page, gh);
  gh.failPut = p => p === 'packages/registry.json';
  await page.evaluate(() => Packages.restoreDeleted('delpkg'));
  await expect(page.locator('.toast', { hasText: 'Restore failed' })).toBeVisible();
  expect(registryIds(gh)).not.toContain('delpkg');
  expect(await page.evaluate(() => Packages.listTrash().length)).toBe(1);
  expect(await hasEntries(page)).toEqual([false, false]);
  expect(await page.evaluate(() => !!Packages.getEntry('delpkg'))).toBe(false);
});

test('restore does not overwrite an entry the user has since recreated', async ({ page }) => {
  const gh = await setup(page);
  await deleted(page, gh);
  await page.evaluate(() => HexDB.addEntries([{ id: 'Delpkg_H', package: 'delpkg', type: 'Water' }]));
  await page.evaluate(() => Packages.restoreDeleted('delpkg'));
  expect(registryIds(gh)).toContain('delpkg');
  expect(await page.evaluate(() => HexDB.getAll().find(h => h.id === 'Delpkg_H')!.type)).toBe('Water');
  expect(await page.evaluate(() => Packages.listTrash().length)).toBe(0);
});
