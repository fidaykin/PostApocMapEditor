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

async function setupPublish(page: any, gh: FakeGitHub) {
  gh.setRegistry([{ id: 'pp', name: 'PP', version: '1.0.0' }]);                 // stale registry version
  gh.setJson('packages/pp/package.json', { id: 'pp', name: 'PP', version: '1.2.3', description: 'My desc', preview: 'pv.png', isDefault: false });
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('pp'));
  await page.evaluate(() => HexDB.addEntries([{ id: 'Pp_Hex_1', package: 'pp', type: 'Plains' }]));
}

test('publish keeps description and preview, bumps from the server version, writes package.json last', async ({ page }) => {
  const gh = new FakeGitHub();
  await setupPublish(page, gh);
  await page.evaluate(() => Packages.publishPackage('pp'));
  const pkg = gh.json('packages/pp/package.json');
  expect(pkg.description).toBe('My desc');
  expect(pkg.preview).toBe('pv.png');
  expect(pkg.version).toBe('1.2.4');
  expect(gh.putPaths().at(-1)).toBe('packages/pp/package.json');
  expect(gh.putPaths()).toContain('packages/registry.json');
  expect(gh.json('packages/registry.json').packages.find((p: any) => p.id === 'pp').version).toBe('1.2.4');
});

test('a failed package.json write is retry-safe: the retry computes the same version', async ({ page }) => {
  const gh = new FakeGitHub();
  await setupPublish(page, gh);
  gh.failPut = p => p === 'packages/pp/package.json';
  await page.evaluate(() => Packages.publishPackage('pp'));
  expect(gh.json('packages/pp/package.json').version).toBe('1.2.3');        // untouched: still the old, complete release
  gh.failPut = () => false;
  await page.evaluate(() => Packages.publishPackage('pp'));
  expect(gh.json('packages/pp/package.json').version).toBe('1.2.4');        // not 1.2.5
});

test('an unreadable server package.json aborts the publish before any write', async ({ page }) => {
  const gh = new FakeGitHub();
  await setupPublish(page, gh);
  await page.route(/packages\/pp\/package\.json/, r => r.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: 'boom' }));
  await page.evaluate(() => Packages.publishPackage('pp'));
  expect(gh.putPaths()).toEqual([]);
});

test('an unreadable server registry.json aborts before package.json is written', async ({ page }) => {
  const gh = new FakeGitHub();
  await setupPublish(page, gh);
  await page.route(/packages\/registry\.json/, r => r.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: 'boom' }));
  await page.evaluate(() => Packages.publishPackage('pp'));
  expect(gh.putPaths()).not.toContain('packages/registry.json');
  expect(gh.putPaths()).not.toContain('packages/pp/package.json');
  expect(gh.json('packages/pp/package.json').version).toBe('1.2.3');
});
