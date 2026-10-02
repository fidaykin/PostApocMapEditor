import { test, expect } from '@playwright/test';
import { openEditor, FakeGitHub } from './helpers';

const hex = (id: string, extra: object = {}) => ({ id, package: 'difpkg', spriteName: id, type: 'Plains', ...extra });

async function setup(page: any, gh: FakeGitHub) {
  gh.setRegistry([{ id: 'difpkg', name: 'Dif Pkg', version: '1.0.0' }]);
  gh.setJson('packages/difpkg/package.json', { id: 'difpkg', name: 'Dif Pkg', version: '1.0.0', description: 'D', preview: 'p.png', isDefault: false });
  gh.setJson('packages/difpkg/hex_database.json', { version: 1, package: 'difpkg', hexes: [hex('Difpkg_Same'), hex('Difpkg_A'), hex('Difpkg_Gone')] });
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('difpkg'));
  // Startup sync pulls every server entry in; drop Difpkg_Gone again so it exists only on the server.
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.evaluate(() => { const h = HexDB.getData().hexes; const i = h.findIndex((x: any) => x.id === 'Difpkg_Gone'); if (i >= 0) h.splice(i, 1); });
  await page.evaluate(([same, a, n]: any) => HexDB.addEntries([same, a, n]),
    [hex('Difpkg_Same'), hex('Difpkg_A', { effects: 'edited' }), hex('Difpkg_New')]);
}

test('publish dialog lists new, changed and server-only entries and Cancel writes nothing', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.evaluate(() => { Packages.openPublishConfirm('difpkg'); });
  const details = page.locator('#dialog-details');
  await expect(details).toContainText('+ hex Difpkg_New');
  await expect(details).toContainText('~ hex Difpkg_A');
  await expect(details).toContainText('- hex Difpkg_Gone');
  await expect(details).not.toContainText('Difpkg_Same');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  expect(gh.putPaths()).toEqual([]);
});

test('confirming the dialog publishes', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.evaluate(() => { Packages.openPublishConfirm('difpkg'); });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect.poll(() => gh.putPaths()).toContain('packages/difpkg/hex_database.json');
});

test('a server entry without an id is listed as removed', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  gh.setJson('packages/difpkg/hex_database.json', { version: 1, package: 'difpkg',
    hexes: [hex('Difpkg_Same'), hex('Difpkg_A'), { package: 'difpkg', spriteName: 'orphan', type: 'Plains' }] });
  await page.evaluate(() => { Packages.openPublishConfirm('difpkg'); });
  await expect(page.locator('#dialog-details')).toContainText('- unkeyed hex');
  await expect(page.locator('#dialog-details')).toContainText('orphan');
});

test('a failing read of the published files blocks the dialog and writes nothing', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.route(/packages\/difpkg\/hex_database\.json/, r => r.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: 'boom' }));
  await page.evaluate(() => { Packages.openPublishConfirm('difpkg'); });
  await expect(page.locator('#toast-container')).toContainText('Could not compare');
  await expect(page.locator('#dialog-details')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  expect(gh.putPaths()).toEqual([]);
});
