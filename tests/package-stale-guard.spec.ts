import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, quiesceAfterDialog } from './helpers';

// ClickUp 869fnyg6y: two laptops edit one package. The one that did not publish keeps an older copy; Publish from it would
// overwrite the other's work without a word. The editor now compares the published files with the merge base stored at this
// browser's last sync and says which records the server changed since: before Publish and in the Skin slots dialog.
const hex = (id: string, extra: object = {}) => ({ id, package: 'stalepkg', spriteName: id, type: 'Plains', ...extra });

async function setup(page: Page, gh: FakeGitHub) {
  gh.setRegistry([{ id: 'stalepkg', name: 'Stale Pkg', version: '1.0.0' }]);
  gh.setJson('packages/stalepkg/package.json', { id: 'stalepkg', name: 'Stale Pkg', version: '1.0.0', description: 'D', preview: 'p.png', isDefault: false });
  gh.setJson('packages/stalepkg/hex_database.json', { version: 1, package: 'stalepkg', hexes: [hex('Stale_A', { skinSlot: 'Plain_1' }), hex('Stale_B')] });
  gh.setJson('packages/stalepkg/building_database.json', { version: 1, package: 'stalepkg', buildings: [] });
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('stalepkg'));
  await page.evaluate(() => (window as any).__startupSyncDone);
}
// The other laptop published: the skin of Stale_A is gone on the server.
const otherLaptopPublishes = (gh: FakeGitHub) =>
  gh.setJson('packages/stalepkg/hex_database.json', { version: 1, package: 'stalepkg', hexes: [hex('Stale_A'), hex('Stale_B')] });

test('serverNewer names the records the server changed since this browser synced', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  expect(await page.evaluate(() => Packages.serverNewer('stalepkg'))).toMatchObject({ known: true, hex: [], bld: [] });
  otherLaptopPublishes(gh);
  expect(await page.evaluate(() => Packages.serverNewer('stalepkg'))).toMatchObject({ known: true, hex: ['Stale_A'], bld: [] });
});

test('Publish warns that the server has newer changes and Cancel writes nothing', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  otherLaptopPublishes(gh);
  await page.evaluate(() => { void Packages.openPublishConfirm('stalepkg'); });
  await expect(page.locator('#dialog-title')).toHaveText('The server has newer changes');
  await expect(page.locator('#dialog-details')).toContainText('hex Stale_A');
  await expect(page.locator('#dialog-msg')).toContainText('Pull from server');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await quiesceAfterDialog(page);
  expect(gh.putPaths()).toEqual([]);
});

test('Publish anyway goes on to the normal publish dialog', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  otherLaptopPublishes(gh);
  await page.evaluate(() => { void Packages.openPublishConfirm('stalepkg'); });
  await page.getByRole('button', { name: 'Publish anyway' }).click();
  await expect(page.locator('#dialog-title')).toHaveText('Publish Package');
});

test('no warning when only this browser changed something', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.evaluate(() => HexDB.addEntries([{ id: 'Stale_C', package: 'stalepkg', spriteName: 'Stale_C', type: 'Plains' }]));
  await page.evaluate(() => { void Packages.openPublishConfirm('stalepkg'); });
  await expect(page.locator('#dialog-title')).toHaveText('Publish Package');
});

test('a browser that never synced the package says it cannot tell who changed what', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  otherLaptopPublishes(gh);
  await page.evaluate(() => { SyncMerge.saveBase('hex', 'stalepkg', null); SyncMerge.saveBase('bld', 'stalepkg', null); });
  await page.evaluate(() => { void Packages.openPublishConfirm('stalepkg'); });
  await expect(page.locator('#dialog-title')).toHaveText('Publish Package');
  await expect(page.locator('#dialog-msg')).toContainText('no record of its last sync');
});

test('after this browser publishes, the next check starts from what it wrote', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.evaluate(() => HexDB.addEntries([{ id: 'Stale_C', package: 'stalepkg', spriteName: 'Stale_C', type: 'Plains' }]));
  const r = await page.evaluate(() => Packages.publishPackage('stalepkg', { bump: 'patch' }));
  expect(r.ok).toBe(true);
  expect(await page.evaluate(() => Packages.serverNewer('stalepkg'))).toMatchObject({ known: true, hex: [], bld: [] });
});

test('the Skin slots dialog warns when the server has newer changes', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  otherLaptopPublishes(gh);
  await page.evaluate(() => Packages.openSkinSlots('stalepkg'));
  await expect(page.locator('#skin-stale')).toContainText('newer change');
  await expect(page.locator('#skin-stale')).toContainText('Stale_A');
});

test('the Skin slots dialog has no warning when nothing changed on the server', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.evaluate(() => Packages.openSkinSlots('stalepkg'));
  await expect(page.locator('#skin-slots-body')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('#skin-stale')).toHaveCount(0);
});
