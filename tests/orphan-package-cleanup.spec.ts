import { test, expect } from '@playwright/test';
import { openEditor, FakeGitHub } from './helpers';

// A package that is gone from the server leaves its tiles in this browser, and the palette keeps a section nobody can open.
// The registry refresh removes them (with a restore copy); anything the registry or this browser still knows is left alone.
async function setup(page: any) {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'livepkg', name: 'Live Pkg' }]);
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('livepkg'));
  await page.evaluate(() => {
    HexDB.addEntries([
      { id: 'Ghost_H', package: 'ghost', type: 'Plains' }, { id: 'Ghost_H2', package: 'ghost', type: 'Plains' },
      { id: 'Livepkg_H', package: 'livepkg', type: 'Plains' },
    ]);
    BldDB.addEntries([{ id: 'Ghost_B', package: 'ghost' }, { id: 'Livepkg_B', package: 'livepkg' }]);
  });
}
const SERVER = [{ id: 'postapoc', isDefault: true }, { id: 'livepkg' }];
const pkgIds = (page: any) => page.evaluate(() =>
  [...new Set([...HexDB.getAll(), ...BldDB.getAll()].map((e: any) => e.package || 'postapoc'))].sort());

test('entries of a package missing from the registry are removed, the rest stay', async ({ page }) => {
  await setup(page);
  const removed = await page.evaluate((s) => Packages.purgeOrphans(s), SERVER);
  expect(removed).toBe(3);
  const ids = await pkgIds(page);
  expect(ids).not.toContain('ghost');
  expect(ids).toContain('livepkg');
  expect(ids).toContain('postapoc');
});

test('a restore copy is kept and restores locally without touching the server', async ({ page }) => {
  await setup(page);
  await page.evaluate((s) => Packages.purgeOrphans(s), SERVER);
  const trash = await page.evaluate(() => Packages.listTrash().find((t: any) => t.id === 'ghost'));
  expect(trash.hexes).toHaveLength(2);
  expect(trash.buildings).toHaveLength(1);
  expect(trash.entry.localOnly).toBe(true);
  await page.evaluate(() => Packages.restoreDeleted('ghost'));
  await expect.poll(() => pkgIds(page)).toContain('ghost');
  expect(await page.evaluate(() => Packages.getEntry('ghost')?.localOnly)).toBe(true);
});

test('a package registered in this browser is not an orphan', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { localStorage.setItem('pkg_local_registry', JSON.stringify([{ id: 'ghost', name: 'Ghost', version: '1.0.0' }])); });
  await page.reload();
  await page.waitForFunction(() => !!Packages.getEntry('livepkg') && !!Packages.getEntry('ghost'));
  expect(await pkgIds(page)).toContain('ghost');
});

test('a registry without the default package, or an empty one, removes nothing', async ({ page }) => {
  await setup(page);
  expect(await page.evaluate(() => Packages.purgeOrphans([{ id: 'livepkg' }]))).toBe(0);
  expect(await page.evaluate(() => Packages.purgeOrphans([]))).toBe(0);
  expect(await page.evaluate(() => Packages.purgeOrphans(undefined as any))).toBe(0);
  expect(await pkgIds(page)).toContain('ghost');
});

test('the cleanup runs on its own when the editor starts and reads the live registry', async ({ page }) => {
  await setup(page);
  await page.reload();
  await page.waitForFunction(() => !!Packages.getEntry('livepkg'));
  await expect.poll(() => pkgIds(page)).not.toContain('ghost');
  expect(await pkgIds(page)).toContain('livepkg');
});
