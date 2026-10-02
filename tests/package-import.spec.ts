import { test, expect } from '@playwright/test';
import { openEditor, buildZip, TINY_PNG, FakeGitHub } from './helpers';

async function zipFor(id: string, name: string) {
  const prefix = id.charAt(0).toUpperCase() + id.slice(1) + '_';
  return buildZip({
    'package.json': JSON.stringify({ id, name, version: '1.0.0' }),
    'hex_database.json': JSON.stringify({ version: 1, package: id, hexes: [{ id: `${prefix}Hex_1`, package: id, spriteName: `${prefix}Hex_1`, type: 'Plains' }] }),
    'building_database.json': JSON.stringify({ version: 1, package: id, buildings: [{ id: `${prefix}Bld_1`, package: id, spriteName: `${prefix}Bld_1` }] }),
    ['sprites/hex/' + prefix + 'Hex_1.png']: TINY_PNG,
  });
}

async function pickZip(page: any, buf: Buffer) {
  await page.setInputFiles('#pkg-import-input', { name: 'p.zip', mimeType: 'application/zip', buffer: buf });
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
}

test('importing a ZIP puts its hexes, buildings and sprites into the editor', async ({ page }) => {
  await openEditor(page, { pat: true });
  await pickZip(page, await zipFor('zipmod', 'Zip Mod'));
  await page.fill('#pkg-import-id', 'zipimp');
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  await expect.poll(() => page.evaluate(() => HexDB.getAll().some(h => h.id === 'Zipimp_Hex_1' && h.package === 'zipimp'))).toBe(true);
  expect(await page.evaluate(() => BldDB.getAll().some(b => b.id === 'Zipimp_Bld_1' && b.package === 'zipimp'))).toBe(true);
  expect(await page.evaluate(async () => (await SpriteStore.loadAll()).some(s => s.name === 'Zipmod_Hex_1' && s.category === 'hex'))).toBe(true);
  expect(await page.evaluate(() => typeof Terrain.getUploadedUrl('Zipmod_Hex_1'))).toBe('string');
});

test('importing a ZIP never overwrites an existing local sprite of the same name', async ({ page }) => {
  await openEditor(page, { pat: true });
  const orig = 'data:image/png;base64,ORIGINAL';
  await page.evaluate((u) => SpriteStore.save('Zipmod_Hex_1', u, 'hex'), orig);
  await pickZip(page, await zipFor('zipmod', 'Zip Mod'));
  await page.fill('#pkg-import-id', 'zipimp');
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('.toast', { hasText: '1 sprite(s) skipped' })).toContainText('Zipmod_Hex_1');
  const stored = await page.evaluate(async () => (await SpriteStore.loadAll()).find(s => s.name === 'Zipmod_Hex_1')!.dataUrl);
  expect(stored).toBe(orig);
  expect(await page.evaluate(() => HexDB.getAll().some(h => h.id === 'Zipimp_Hex_1'))).toBe(true);
});

function seedTaken(gh: FakeGitHub) {
  // exists on the server but is NOT in the registry (e.g. removed from it earlier, or a stale local cache)
  gh.setJson('packages/taken/package.json', { id: 'taken', name: 'Taken', version: '3.0.0' });
}

test('New Package refuses an id whose folder already exists on the server', async ({ page }) => {
  const gh = new FakeGitHub();
  seedTaken(gh);
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => Packages.openNewModal());
  await page.fill('#pkg-new-name', 'Taken Again');
  await page.fill('#pkg-new-id', 'taken');
  await page.evaluate(() => Packages.createPackage());
  await expect(page.locator('#pkg-new-error')).toHaveText('Package "taken" already exists on the server. Pick another id.');
  expect(gh.putPaths()).toEqual([]);
});

test('New Package still works for a free id', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => Packages.openNewModal());
  await page.fill('#pkg-new-name', 'Fresh');
  await page.fill('#pkg-new-id', 'fresh');
  await page.evaluate(() => Packages.createPackage());
  await expect.poll(() => gh.putPaths()).toContain('packages/fresh/package.json');
});

test('Import refuses an id that already exists on the server', async ({ page }) => {
  const gh = new FakeGitHub();
  seedTaken(gh);
  await openEditor(page, { gh, pat: true });
  await pickZip(page, await zipFor('zipmod', 'Zip Mod'));
  await page.fill('#pkg-import-id', 'taken');
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('#pkg-import-error')).toHaveText('Package "taken" already exists on the server. Pick another id.');
  expect(gh.putPaths()).toEqual([]);
});

const UNVERIFIED = 'Could not verify that the id is free \u2014 check your connection and try again.';

for (const mode of ['aborted', 'http 500'] as const) {
  const breakProbe = (page: any) => page.route(/packages\/(fresh|retry)\/package\.json/, (r: any) =>
    mode === 'aborted' ? r.abort() : r.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: 'boom' }));

  test(`New Package refuses when the server id check is indeterminate (${mode})`, async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh, pat: true });
    await breakProbe(page);
    await page.evaluate(() => Packages.openNewModal());
    await page.fill('#pkg-new-name', 'Fresh');
    await page.fill('#pkg-new-id', 'fresh');
    await page.evaluate(() => Packages.createPackage());
    await expect(page.locator('#pkg-new-error')).toHaveText(UNVERIFIED);
    expect(gh.putPaths()).toEqual([]);
  });

  test(`Import refuses when the server id check is indeterminate (${mode}), and a retry works`, async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh, pat: true });
    await breakProbe(page);
    await pickZip(page, await zipFor('zipmod', 'Zip Mod'));
    await page.fill('#pkg-import-id', 'retry');
    const btn = page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' });
    await btn.click();
    await expect(page.locator('#pkg-import-error')).toHaveText(UNVERIFIED);
    expect(gh.putPaths()).toEqual([]);
    await page.unroute(/packages\/(fresh|retry)\/package\.json/);
    await btn.click();
    await expect.poll(() => gh.putPaths()).toContain('packages/retry/package.json');
  });
}
