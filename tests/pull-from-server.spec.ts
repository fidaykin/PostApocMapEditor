import { test, expect, Page } from '@playwright/test';
import { openEditor, reloadEditor, FakeGitHub, quiesceAfterDialog } from './helpers';

// ClickUp 869fm23zy: a laptop keeps an older copy of a package's records (local edits win at the startup merge). PACKAGES >
// Pull from server replaces this package's hex and building records with the published ones, after a diff.
const hex = (id: string, extra: object = {}) => ({ id, package: 'pullpkg', spriteName: id, type: 'Plains', ...extra });
const bld = (id: string, extra: object = {}) => ({
  id, package: 'pullpkg', type: 'Ground Building', buildingCategory: 'Standard', canBuild: true, canDestroy: true,
  destroyTransformToMode: 'HexID', destroyTransformTo: '', availableTiles: [] as string[], additionalBuildCondition: true,
  tilesTypeMode: 'HexID', tilesTypeValue: '', canProduceEnabled: true, canProduce: [] as string[], availableTilesForProduce: [] as string[],
  price: [{ type: 'Gold', amount: 5 }], minLevel: 1, premiumPrice: 0, radius: 0, buildingRadius: 0, spriteName: id, ...extra,
});

async function setup(page: Page, gh: FakeGitHub) {
  gh.setRegistry([{ id: 'pullpkg', name: 'Pull Pkg', version: '1.0.0' }]);
  gh.setJson('packages/pullpkg/package.json', { id: 'pullpkg', name: 'Pull Pkg', version: '1.0.0', description: 'D', preview: 'p.png', isDefault: false });
  gh.setJson('packages/pullpkg/hex_database.json', { version: 1, package: 'pullpkg', hexes: [hex('Pull_A', { biome: 'Decameron' }), hex('Pull_B')] });
  gh.setJson('packages/pullpkg/building_database.json', { version: 1, package: 'pullpkg', buildings: [bld('Pull_Bld', { biome: 'Decameron' })] });
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('pullpkg'));
  await page.evaluate(() => (window as any).__startupSyncDone);
  // The stale laptop: an older, trimmed copy of A (no biome), a local-only C, a trimmed building; and a record of another package.
  await page.evaluate(([a, c, b, other]: any) => {
    HexDB.removeByPackage('pullpkg'); BldDB.removeByPackage('pullpkg');
    HexDB.addEntries([a, c, other]); BldDB.addEntries([b]);
  }, [hex('Pull_A', { biome: 'Summer' }), hex('Pull_C'), bld('Pull_Bld', { biome: 'Summer' }), { id: 'Other_1', package: 'otherpkg', spriteName: 'x', type: 'Plains' }]);
}
const hexOf = (page: Page, id: string) => page.evaluate(i => HexDB.getAll().find((h: any) => h.id === i) || null, id);
const ids = (page: Page) => page.evaluate(() => HexDB.getAll().filter((h: any) => h.package === 'pullpkg').map((h: any) => h.id).sort());

test('the confirm lists what the pull overwrites, removes and adds; Cancel changes nothing', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.evaluate(() => { void Packages.pullFromServer('pullpkg'); });
  const details = page.locator('#dialog-details');
  await expect(details).toContainText('~ hex Pull_A');          // overwritten
  await expect(details).toContainText('- hex Pull_C');          // local only: removed
  await expect(details).toContainText('+ hex Pull_B');          // on the server only: added
  await expect(page.locator('#dialog-msg')).toContainText('local edits');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await quiesceAfterDialog(page);
  expect((await hexOf(page, 'Pull_A')).biome).toBe('Summer');
  expect(await ids(page)).toEqual(['Pull_A', 'Pull_C']);
  expect(gh.putPaths()).toEqual([]);
});

test('confirming replaces this package with the server version and keeps other packages', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.evaluate(() => { void Packages.pullFromServer('pullpkg'); });
  await page.getByRole('button', { name: 'Pull from server' }).click();
  await expect.poll(() => ids(page)).toEqual(['Pull_A', 'Pull_B']);
  expect((await hexOf(page, 'Pull_A')).biome).toBe('Decameron');
  expect(await hexOf(page, 'Other_1')).not.toBeNull();
  expect(await page.evaluate(() => BldDB.getAll().find((b: any) => b.id === 'Pull_Bld').biome)).toBe('Decameron');
  expect(gh.putPaths()).toEqual([]);                            // a pull never writes to the server
});

test('the next startup sync keeps the pulled entries (the merge base was reset)', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.evaluate(() => { void Packages.pullFromServer('pullpkg'); });
  await page.getByRole('button', { name: 'Pull from server' }).click();
  await expect.poll(() => ids(page)).toEqual(['Pull_A', 'Pull_B']);
  const r = await page.evaluate(() => GitHubSync.syncContentFromServer());
  expect(r.conflicts).toEqual([]);
  expect(await ids(page)).toEqual(['Pull_A', 'Pull_B']);
});

test('a package that is not on the server cannot be pulled', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => { void Packages.pullFromServer('nosuchpkg'); });
  await expect(page.locator('#dialog-title')).not.toBeVisible();
});

test('the PACKAGES row has a Pull from server button', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.evaluate(() => App.setMode('packages'));
  await expect(page.locator('tr[data-pkg="pullpkg"] button', { hasText: 'Pull from server' })).toBeVisible();
});

test('the startup notice about kept local edits stays on screen and names the way out', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);                                      // the stale local copy of Pull_A is in the autosave now
  await page.evaluate(() => { SyncMerge.saveBase('hex', 'pullpkg', null); });   // a browser that never synced this package
  await reloadEditor(page);
  const toast = page.locator('#toast-container').getByText(/Kept \d+ local edit\(s\)/);
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('PACKAGES > Pull from server');
  await page.waitForTimeout(7000);                            // the old notice vanished after 6 s
  await expect(toast).toBeVisible();
});
