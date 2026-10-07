import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import { openEditor, reloadEditor, FakeGitHub, readZip, packageZip, hexRec, dataUrl, TINY_PNG, seedServerPackage, waitForLastWrite } from './helpers';

// T5.12: local-only mode. Without a token (or offline) a package can be created, filled, edited, exported and imported
// entirely locally. Local-only packages are flagged, survive reload and the startup registry rebuild, publish later through
// the normal flow (flag cleared only after a full success), and an id taken on the server meanwhile is reported, never
// overwritten. Offline `_serverIdProblem` = 'cannot verify, allow with a warning' (local only, nothing written).

const REG = 'packages/registry.json';
const LOCAL_KEY = 'pkg_local_registry';

async function boot(page: Page, gh = new FakeGitHub(), pat = false) {
  await openEditor(page, { gh, pat });
  await page.evaluate(() => (window as any).__startupSyncDone);
  return gh;
}
async function reload(page: Page) {
  await reloadEditor(page);
  await page.evaluate(() => (window as any).__startupSyncDone);
}
async function createLocal(page: Page, id: string, name: string) {
  await page.evaluate(() => Packages.openNewModal());
  await page.fill('#pkg-new-name', name);
  await page.fill('#pkg-new-id', id);
  await page.locator('#pkg-new-modal').getByRole('button', { name: 'Create' }).click();
  await page.waitForFunction(i => !!Packages.getEntry(i), id);
}
/** Anything that is not a plain read: the page must never write without a token. */
const writes = (gh: FakeGitHub) => gh.requests.filter(r => r.method !== 'GET');
const apiRequests = (gh: FakeGitHub) => gh.requests.length;
const localIds = (page: Page) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]').map((p: any) => p.id), LOCAL_KEY);
const row = (page: Page, id: string) => page.locator(`tr[data-pkg="${id}"]`);

test('without a token: create stays local, is badged, survives reload and a registry without it, no API request at all', async ({ page }) => {
  const gh = await boot(page);
  await page.click('#tab-packages');
  await expect(page.locator('#pkg-local-notice')).toHaveCount(0);   // positive control: no local package yet
  const before = apiRequests(gh);
  await createLocal(page, 'local-pack', 'Local Pack');

  await expect(row(page, 'local-pack').locator('.pkg-local-badge')).toBeVisible();
  await expect(page.locator('#pkg-local-notice')).toContainText('not on the server');
  expect(await page.evaluate(() => Packages.getEntry('local-pack').localOnly)).toBe(true);
  expect(await localIds(page)).toEqual(['local-pack']);
  expect(apiRequests(gh)).toBe(before);
  expect(writes(gh)).toEqual([]);
  // appears in every active-package selector (T5.2)
  expect(await page.evaluate(() => [...document.querySelectorAll('.pkg-active-select')].every(s => [...(s as HTMLSelectElement).options].some(o => o.value === 'local-pack')))).toBe(true);
  // entries and per-package sprites work and survive the reload + startup sync
  await page.evaluate(() => { Packages.setActive('local-pack'); });
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('LocalPack_One', 'local-pack', { spriteName: 'S1' })]);
  await page.evaluate(d => SpriteStore.save('S1', d, 'hex', 'local-pack'), dataUrl(TINY_PNG));

  await reload(page);   // the registry the page fetches does NOT contain local-pack
  expect(gh.json(REG).packages.some((p: any) => p.id === 'local-pack')).toBe(false);
  expect(await page.evaluate(() => Packages.getEntry('local-pack')?.localOnly)).toBe(true);
  expect(await page.evaluate(() => Packages.getActive())).toBe('local-pack');
  expect(await page.evaluate(() => HexDB.getData().hexes.some((h: any) => h.id === 'LocalPack_One' && h.package === 'local-pack'))).toBe(true);
  expect(await page.evaluate(async () => (await SpriteStore.loadForPackage('local-pack')).length)).toBe(1);
  await page.click('#tab-packages');
  await expect(row(page, 'local-pack').locator('.pkg-local-badge')).toBeVisible();
  expect(writes(gh)).toEqual([]);
});

test('a server registry with other packages merges with the local one instead of replacing it', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'srv', name: 'Server Pack' }]);
  await boot(page, gh);
  await createLocal(page, 'mine', 'Mine');
  await reload(page);
  expect(await page.evaluate(() => Packages.getAll().map((p: any) => p.id).sort())).toEqual(['mine', 'postapoc', 'srv']);
  expect(await page.evaluate(() => Packages.getEntry('srv').localOnly)).toBeFalsy();
  expect(writes(gh)).toEqual([]);
});

test('a failing registry fetch keeps the local package too', async ({ page }) => {
  const gh = await boot(page);
  await createLocal(page, 'mine', 'Mine');
  await page.route(/packages\/registry\.json/, r => r.abort());
  await reload(page);
  expect(await page.evaluate(() => Packages.getEntry('mine')?.localOnly)).toBe(true);
});

test('details of a local-only package persist in its own record', async ({ page }) => {
  await boot(page);
  await createLocal(page, 'mine', 'Mine');
  await page.evaluate(() => Packages.updateDetails('mine', { description: 'only here', dependencies: ['other@^1.0.0'] }));
  const rec = await page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]').find((p: any) => p.id === 'mine'), LOCAL_KEY);
  expect(rec).toMatchObject({ id: 'mine', name: 'Mine', version: '1.0.0', description: 'only here', dependencies: ['other@^1.0.0'] });
  await page.evaluate(() => localStorage.removeItem('pkg_details'));   // the record alone must be enough
  await reload(page);
  expect(await page.evaluate(() => Packages.getDetails('mine'))).toMatchObject({ description: 'only here', dependencies: ['other@^1.0.0'] });
});

test('export then import round trip without a token, nothing leaves the browser', async ({ page }) => {
  const gh = await boot(page);
  await createLocal(page, 'mine', 'Mine');
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('Mine_A', 'mine', { spriteName: 'S1' })]);
  await page.evaluate(d => SpriteStore.save('S1', d, 'hex', 'mine'), dataUrl(TINY_PNG));
  await page.click('#tab-packages');
  const before = apiRequests(gh);
  const [dl] = await Promise.all([page.waitForEvent('download'), row(page, 'mine').getByRole('button', { name: /Export/ }).click()]);
  const buf = fs.readFileSync((await dl.path())!);
  expect(apiRequests(gh)).toBe(before);       // no comparison with the server for a local-only package
  expect(await page.locator('#pkg-export-warn').count()).toBe(0);
  const zip = await readZip(buf);
  expect(JSON.parse(await zip.file('package.json')!.async('text')).localOnly).toBeUndefined();

  await page.setInputFiles('#pkg-import-input', { name: 'm.zip', mimeType: 'application/zip', buffer: buf });
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
  await page.fill('#pkg-import-id', 'copy');
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  await page.waitForFunction(() => !!Packages.getEntry('copy'));
  expect(await page.evaluate(() => Packages.getEntry('copy').localOnly)).toBe(true);
  expect(await page.evaluate(() => HexDB.getData().hexes.filter((h: any) => h.package === 'copy').length)).toBe(1);
  expect(await page.evaluate(async () => (await SpriteStore.loadForPackage('copy')).length)).toBe(1);
  expect(await localIds(page)).toEqual(['mine', 'copy']);
  expect(apiRequests(gh)).toBe(before);
  expect(writes(gh)).toEqual([]);
  await reload(page);
  expect(await page.evaluate(() => Packages.getEntry('copy')?.localOnly)).toBe(true);
});

test('importing a plain ZIP without a token loads it locally and writes nothing', async ({ page }) => {
  const gh = await boot(page);
  const zip = await packageZip('old', 'Old Pack', { hexes: [hexRec('Old_Tile', 'old', { spriteName: 'S1' })], sprites: { 'hex/S1.png': TINY_PNG } });
  const before = apiRequests(gh);
  await page.setInputFiles('#pkg-import-input', { name: 'p.zip', mimeType: 'application/zip', buffer: zip });
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  await page.waitForFunction(() => !!Packages.getEntry('old'));
  expect(await page.evaluate(() => Packages.getEntry('old').localOnly)).toBe(true);
  expect(await page.evaluate(() => HexDB.getData().hexes.some((h: any) => h.package === 'old'))).toBe(true);
  expect(apiRequests(gh)).toBe(before);
});

test('deleting a local-only package goes through the trash, never the server, and Restore brings it back locally', async ({ page }) => {
  const gh = await boot(page);
  await createLocal(page, 'tmp', 'Tmp');
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('Tmp_A', 'tmp')]);
  const before = apiRequests(gh);
  await page.evaluate(() => Packages.deletePackage('tmp'));
  await page.waitForFunction(() => Packages.getEntry('tmp') === null);
  expect(await localIds(page)).toEqual([]);
  expect(await page.evaluate(() => Packages.listTrash().map((t: any) => t.id))).toEqual(['tmp']);
  expect(apiRequests(gh)).toBe(before);

  await page.evaluate(() => Packages.restoreDeleted('tmp'));
  await page.waitForFunction(() => !!Packages.getEntry('tmp'));
  expect(await page.evaluate(() => Packages.getEntry('tmp').localOnly)).toBe(true);
  expect(await localIds(page)).toEqual(['tmp']);
  expect(await page.evaluate(() => HexDB.getData().hexes.some((h: any) => h.id === 'Tmp_A'))).toBe(true);
  expect(await page.evaluate(() => Packages.listTrash().length)).toBe(0);
  expect(apiRequests(gh)).toBe(before);
});

test('the map JSON lists a local-only package the map uses', async ({ page }) => {
  await boot(page);
  await createLocal(page, 'mine', 'Mine');
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('Mine_A', 'mine')]);
  const pk = await page.evaluate(() => { mapData[0] = 'Mine_A'; const p = JSON.parse(IO.getMapJson()).packages; mapData[0] = null; return p; });
  expect(pk).toEqual(['mine', 'postapoc']);
});

test('adding a token later: Publish sends the package through the normal flow and clears the local flag only afterwards', async ({ page }) => {
  const gh = await boot(page);
  await createLocal(page, 'local-pack', 'Local Pack');
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('LocalPack_One', 'local-pack', { spriteName: 'S1' })]);
  await page.evaluate(d => SpriteStore.save('S1', d, 'hex', 'local-pack'), dataUrl(TINY_PNG));
  await reload(page);
  expect(writes(gh)).toEqual([]);

  await page.evaluate(() => GitHubSync.setPAT('test-token'));
  // a failed publish leaves the flag in place
  gh.failPut = p => p === 'packages/local-pack/package.json';
  await page.evaluate(() => Packages.publishPackage('local-pack', { bump: 'none' }));
  expect(await page.evaluate(() => Packages.getEntry('local-pack').localOnly)).toBe(true);
  expect(await localIds(page)).toEqual(['local-pack']);

  gh.failPut = () => false;
  gh.writeLog.length = 0;
  const res = await page.evaluate(() => Packages.publishPackage('local-pack', { bump: 'none' }));
  expect(res.ok).toBe(true);
  await waitForLastWrite(gh, 'packages/local-pack/package.json');
  const reg = gh.json(REG);
  expect(reg.packages.map((p: any) => p.id)).toContain('local-pack');
  expect(JSON.stringify(reg)).not.toContain('localOnly');
  expect(JSON.stringify(gh.json('packages/local-pack/package.json'))).not.toContain('localOnly');
  expect(gh.json('packages/local-pack/hex_database.json').hexes.length).toBe(1);
  expect(await page.evaluate(() => Packages.getEntry('local-pack').localOnly)).toBeFalsy();
  expect(await localIds(page)).toEqual([]);
  await reload(page);
  expect(await page.evaluate(() => Packages.getEntry('local-pack')?.localOnly)).toBeFalsy();
  expect(await page.evaluate(() => !!Packages.getEntry('local-pack'))).toBe(true);
});

test('an id that appeared on the server meanwhile is reported at publish and nothing is overwritten', async ({ page }) => {
  const gh = await boot(page);
  await createLocal(page, 'clash', 'Mine');
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('Clash_Local', 'clash')]);
  seedServerPackage(gh, 'clash', { name: 'Theirs', version: '3.0.0', hexes: [hexRec('Clash_Theirs', 'clash')] });
  const theirs = JSON.stringify(gh.json('packages/clash/hex_database.json'));
  await page.evaluate(() => GitHubSync.setPAT('test-token'));
  await reload(page);   // startup sync + registry fetch now see the server package
  expect(await page.evaluate(() => Packages.getEntry('clash').localOnly)).toBe(true);   // still the local one
  gh.writeLog.length = 0;
  const res = await page.evaluate(() => Packages.publishPackage('clash', { bump: 'none' }));
  expect(res.ok).toBe(false);
  expect(res.error).toContain('already exists on the server');
  expect(gh.writeLog).toEqual([]);
  expect(JSON.stringify(gh.json('packages/clash/hex_database.json'))).toBe(theirs);
  expect(gh.json(REG).packages.find((p: any) => p.id === 'clash').name).toBe('Theirs');
  expect(await localIds(page)).toEqual(['clash']);
});

test('offline with a token: the id check cannot verify, so create is allowed locally with a warning and writes nothing', async ({ page }) => {
  const gh = await boot(page, new FakeGitHub(), true);
  await page.context().setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  const before = apiRequests(gh);
  await createLocal(page, 'off', 'Off');
  expect(await page.evaluate(() => Packages.getEntry('off').localOnly)).toBe(true);
  await expect(page.locator('#toast-container')).toContainText('could not be verified');
  expect(await page.evaluate(() => Packages._serverIdProblem('anything'))).toBeNull();
  expect(apiRequests(gh)).toBe(before);
  await page.context().setOffline(false);
  expect(writes(gh)).toEqual([]);
});

test('with a token and a reachable server an indeterminate check still refuses (Phase 0 behaviour kept)', async ({ page }) => {
  const gh = await boot(page, new FakeGitHub(), true);
  gh.failGet = p => p === REG;
  await page.evaluate(() => Packages.openNewModal());
  await page.fill('#pkg-new-name', 'Fresh');
  await page.fill('#pkg-new-id', 'fresh');
  await page.evaluate(() => Packages.createPackage());
  await expect(page.locator('#pkg-new-error')).toContainText('Could not verify');
  expect(writes(gh)).toEqual([]);
  expect(await page.evaluate(() => !!Packages.getEntry('fresh'))).toBe(false);
});
