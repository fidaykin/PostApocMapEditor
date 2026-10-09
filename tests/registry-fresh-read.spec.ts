import { test, expect } from '@playwright/test';
import { openEditor, buildZip, TINY_PNG, FakeGitHub } from './helpers';

// Every read-modify-write of registry.json / package.json must read the live repo (Contents API,
// no-store), never the GitHub Pages copy, which lags commits by 30 s to minutes.

const registryIds = (gh: FakeGitHub) => gh.json('packages/registry.json').packages.map((p: any) => p.id);
const UNVERIFIED = 'Could not verify that the id is free — check your connection and try again.';

async function zipFor(id: string, name: string) {
  const prefix = id.charAt(0).toUpperCase() + id.slice(1) + '_';
  return buildZip({
    'package.json': JSON.stringify({ id, name, version: '1.0.0' }),
    'hex_database.json': JSON.stringify({ version: 1, package: id, hexes: [{ id: `${prefix}Hex_1`, package: id, type: 'Plains' }] }),
    'building_database.json': JSON.stringify({ version: 1, package: id, buildings: [] }),
    ['sprites/hex/' + prefix + 'Hex_1.png']: TINY_PNG,
  });
}

// Both the Pages copy and the Contents API fail once the first file has been written.
// Returns the list of attempted registry PUTs (FakeGitHub.puts only records successful ones).
async function failRegistryReadsAfterFirstWrite(page: any, gh: FakeGitHub) {
  const attempts: string[] = [];
  await page.route(/packages\/registry\.json/, (r: any) => {
    const m = r.request().method();
    if (m === 'PUT') attempts.push(r.request().url());
    return m === 'GET' && gh.puts.length > 0
      ? r.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: 'boom' }) : r.fallback();
  });
  return attempts;
}

async function createPackage(page: any, id: string, name: string) {
  await page.evaluate(() => Packages.openNewModal());
  await page.fill('#pkg-new-name', name);
  await page.fill('#pkg-new-id', id);
  await page.evaluate(() => Packages.createPackage());
}

test('(a) Delete then immediate Restore under Pages lag puts the id back into the server registry', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'delpkg', name: 'Del Pkg' }]);
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('delpkg'));
  gh.pagesLag = true;                                   // Pages keeps listing delpkg after the delete
  await page.evaluate(() => Packages.deletePackage('delpkg', { removeEntries: false }));
  await expect.poll(() => registryIds(gh)).not.toContain('delpkg');
  await page.evaluate(() => Packages.restoreDeleted('delpkg'));
  expect(registryIds(gh)).toContain('delpkg');
  expect(gh.puts.filter(p => p.path === 'packages/registry.json').at(-1)!.message).toBe('registry: restore delpkg');
  expect(await page.evaluate(() => Packages.listTrash().length)).toBe(0);
});

test('(b) Create then Publish under Pages lag keeps the new package in the registry and bumps it', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh, pat: true });
  gh.pagesLag = true;                                   // Pages never sees the new package
  await createPackage(page, 'fresh', 'Fresh');
  await expect.poll(() => registryIds(gh)).toContain('fresh');
  await page.evaluate(() => Packages.publishPackage('fresh'));
  expect(registryIds(gh)).toContain('fresh');
  expect(gh.json('packages/registry.json').packages.find((p: any) => p.id === 'fresh').version).toBe('1.0.1');
  expect(gh.json('packages/fresh/package.json').version).toBe('1.0.1');
});

test('publishing twice under Pages lag writes two different versions', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'pp', name: 'PP', version: '1.2.3' }]);
  gh.setJson('packages/pp/package.json', { id: 'pp', name: 'PP', version: '1.2.3', description: '', preview: 'p.png' });
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('pp'));
  gh.pagesLag = true;
  await page.evaluate(() => Packages.publishPackage('pp'));
  await page.evaluate(() => Packages.publishPackage('pp'));
  expect(gh.json('packages/pp/package.json').version).toBe('1.2.5');
});

test('publish adds the registry entry when the live registry has none for the id', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'pp', name: 'PP', version: '1.0.0' }]);
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('pp'));
  const reg = gh.json('packages/registry.json');
  gh.setJson('packages/registry.json', { ...reg, packages: reg.packages.filter((p: any) => p.id !== 'pp') });
  await page.evaluate(() => Packages.publishPackage('pp'));
  const entry = gh.json('packages/registry.json').packages.find((p: any) => p.id === 'pp');
  expect(entry).toMatchObject({ id: 'pp', name: 'PP', version: '1.0.1' });
});

test('a registry changed on the server between read and write aborts the publish instead of overwriting', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'pp', name: 'PP', version: '1.0.0' }]);
  gh.setJson('packages/pp/package.json', { id: 'pp', name: 'PP', version: '1.0.0', description: '', preview: 'p.png' });
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('pp'));
  gh.failPut = p => {                                  // someone else adds a package mid-publish
    if (p === 'packages/pp/hex_database.json') gh.setRegistry([{ id: 'other', name: 'Other' }]);
    return false;
  };
  await page.evaluate(() => Packages.publishPackage('pp'));
  expect(registryIds(gh)).toContain('other');
  expect(gh.json('packages/registry.json').packages.find((p: any) => p.id === 'pp').version).toBe('1.0.0');
  expect(gh.json('packages/pp/package.json').version).toBe('1.0.0');
  await expect(page.locator('#toast-container')).toContainText(/409|changed on the server since it was read/);   // caught before the manifest write now, or by the registry's own conditional write
});

test('New Package refuses with no write when the live registry cannot be read', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh, pat: true });
  gh.failGet = p => p === 'packages/registry.json';
  await createPackage(page, 'fresh', 'Fresh');
  await expect(page.locator('#pkg-new-error')).toHaveText(UNVERIFIED);
  expect(gh.putPaths()).toEqual([]);
});

test('New Package does not write the registry from the local cache when the registry read fails mid-create', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh, pat: true });
  const registryPuts = await failRegistryReadsAfterFirstWrite(page, gh);
  await createPackage(page, 'fresh', 'Fresh');
  await expect(page.locator('.toast', { hasText: 'Failed to create package' })).toBeVisible();
  expect(registryPuts).toEqual([]);
});

test('Import refuses with no write when the live registry cannot be read', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh, pat: true });
  gh.failGet = p => p === 'packages/registry.json';
  await page.setInputFiles('#pkg-import-input', { name: 'p.zip', mimeType: 'application/zip', buffer: await zipFor('zipmod', 'Zip Mod') });
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
  await page.fill('#pkg-import-id', 'zipimp');
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('#pkg-import-error')).toHaveText(UNVERIFIED);
  expect(gh.putPaths()).toEqual([]);
});

test('Import does not write the registry from the local cache when the registry read fails mid-import', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh, pat: true });
  const registryPuts = await failRegistryReadsAfterFirstWrite(page, gh);
  await page.setInputFiles('#pkg-import-input', { name: 'p.zip', mimeType: 'application/zip', buffer: await zipFor('zipmod', 'Zip Mod') });
  await page.fill('#pkg-import-id', 'zipimp');
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('.toast', { hasText: 'Import failed' })).toBeVisible();
  expect(registryPuts).toEqual([]);
});

test('readRepoJson decodes UTF-8 and returns null on 404', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setJson('packages/utf/package.json', { id: 'utf', name: 'Ünïcødé — пакет' });
  await openEditor(page, { gh, pat: true });
  const r = await page.evaluate(async () => [
    (await GitHubSync.readRepoJson('packages/utf/package.json')).name,
    await GitHubSync.readRepoJson('packages/nope/package.json'),
  ]);
  expect(r).toEqual(['Ünïcødé — пакет', null]);
  gh.failGet = () => true;
  const err = await page.evaluate(() => GitHubSync.readRepoJson('packages/utf/package.json').then(() => 'ok', e => e.message));
  expect(err).toContain('500');
});
