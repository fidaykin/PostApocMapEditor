import { test, expect } from '@playwright/test';
import { FakeGitHub, seedServerPackage, openEditor } from './helpers';

// The compressed atlases are built on GitHub from the published sprites (workflow package-atlases.yml). The editor shows whether they match
// (atlas/source.json lists the blob ids they were built from), asks for a rebuild, and asks again after every publish.

const A = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const B = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/6E6g/wAAAABJRU5ErkJggg==', 'base64');
const seed = () => {
  const gh = new FakeGitHub();
  seedServerPackage(gh, 'hs', { sprites: { 'buildings/HS_Farm_1.png': A, 'hex/HS_Plain_1.png': A } });
  return gh;
};
// writes source.json the way the builder does, from what the server lists now
const recordBuild = (page: any, gh: FakeGitHub) => page.evaluate(async () => {
  const sprites: Record<string, string> = {};
  for (const [g, d] of [['hex', 'hex'], ['buildings', 'buildings']]) for (const f of await GitHubSync._listFolder(`packages/hs/sprites/${d}`)) sprites[`${g}/${f.name}`] = f.sha;
  return sprites;
}).then((sprites: any) => gh.setJson('packages/hs/atlas/source.json', { stamp: 'x', builtAt: '2026-11-17T10:00:00.000Z', sprites }));

test('atlasStatus: none without an atlas, current when the sprites match its record, stale when one changed', async ({ page }) => {
  const gh = seed();
  await openEditor(page, { gh, pat: true });
  expect((await page.evaluate(() => GitHubSync.atlasStatus('hs'))).state).toBe('none');
  gh.write('packages/hs/atlas/astc6x6/atlas.json', Buffer.from('{}'));
  expect((await page.evaluate(() => GitHubSync.atlasStatus('hs'))).state).toBe('unknown');   // built before the record existed
  await recordBuild(page, gh);
  const ok = await page.evaluate(() => GitHubSync.atlasStatus('hs'));
  expect(ok).toMatchObject({ state: 'current', builtAt: '2026-11-17T10:00:00.000Z', changed: [] });
  gh.write('packages/hs/sprites/hex/HS_Plain_1.png', B);
  gh.write('packages/hs/sprites/hex/HS_New_1.png', A);
  const stale = await page.evaluate(() => GitHubSync.atlasStatus('hs'));
  expect(stale.state).toBe('stale');
  expect(stale.changed.sort()).toEqual(['HS_New_1', 'HS_Plain_1']);
});

test('a deleted sprite makes the atlas stale too', async ({ page }) => {
  const gh = seed();
  await openEditor(page, { gh, pat: true });
  await recordBuild(page, gh);
  await page.evaluate(() => GitHubSync._removeFile('packages/hs/sprites/buildings/HS_Farm_1.png'));
  const st = await page.evaluate(() => GitHubSync.atlasStatus('hs'));
  expect(st).toMatchObject({ state: 'stale', changed: ['HS_Farm_1'] });
});

test('requestAtlasRebuild writes packages/atlas-request.json, and overwrites it the second time', async ({ page }) => {
  const gh = seed();
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => GitHubSync.requestAtlasRebuild('hs', 'manual'));
  expect(gh.json('packages/atlas-request.json')).toMatchObject({ package: 'hs', why: 'manual' });
  await page.evaluate(() => GitHubSync.requestAtlasRebuild('hs', 'publish'));
  expect(gh.json('packages/atlas-request.json').why).toBe('publish');
});

test('publishing a package asks for its atlases to be rebuilt and says so', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'pp', name: 'PP', version: '1.0.0' }]);
  gh.setJson('packages/pp/package.json', { id: 'pp', name: 'PP', version: '1.2.3', description: 'd', preview: 'pv.png', isDefault: false });
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('pp'));
  await page.evaluate(() => HexDB.addEntries([{ id: 'Pp_Hex_1', package: 'pp', type: 'Plains' }]));
  await page.evaluate(() => Packages.publishPackage('pp'));
  await expect.poll(() => gh.read('packages/atlas-request.json') !== null).toBe(true);
  expect(gh.json('packages/atlas-request.json')).toMatchObject({ package: 'pp', why: 'publish' });
  await expect(page.locator('body')).toContainText('Atlases of "pp" are being rebuilt');
});

test('a failed request does not fail the publish and tells the author what to do', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'pp', name: 'PP', version: '1.0.0' }]);
  gh.setJson('packages/pp/package.json', { id: 'pp', name: 'PP', version: '1.2.3', description: 'd', preview: 'pv.png', isDefault: false });
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('pp'));
  await page.evaluate(() => HexDB.addEntries([{ id: 'Pp_Hex_1', package: 'pp', type: 'Plains' }]));
  gh.failPut = p => p === 'packages/atlas-request.json';
  const r = await page.evaluate(() => Packages.publishPackage('pp'));
  expect(r.ok).toBe(true);
  await expect(page.locator('body')).toContainText('atlas rebuild could not be requested');
});

test('the PACKAGES tab shows a badge next to Atlases reflecting current/stale state, and clears on rebuild request', async ({ page }) => {
  const gh = seed();
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('hs'));
  await page.click('#tab-packages');
  const badge = page.locator('tr[data-pkg="hs"] .pkg-atlas-badge');
  await expect(badge).toHaveText('⚪');   // no atlas built yet
  await expect(badge).toHaveAttribute('title', /No atlas built yet/);

  await recordBuild(page, gh);
  await badge.click();   // force a re-check — the "none" result is still within the cache TTL otherwise
  await expect(badge).toHaveText('🟢');
  await expect(badge).toHaveAttribute('title', /match the published sprites/);

  gh.write('packages/hs/sprites/hex/HS_Plain_1.png', B);
  await badge.click();
  await expect(badge).toHaveText('🟡');
  await expect(badge).toHaveAttribute('title', /sprite\(s\) differ/);

  // Rebuild request clears the cache so the next render re-checks instead of repeating the stale verdict verbatim
  await page.evaluate(() => { Packages.openAtlases('hs'); });
  await page.getByRole('button', { name: 'Rebuild atlases' }).click();
  await expect.poll(() => gh.read('packages/atlas-request.json') !== null).toBe(true);
});

test('the package row has an Atlases button that explains the state and offers the rebuild', async ({ page }) => {
  const gh = seed();
  await openEditor(page, { gh, pat: true });
  await recordBuild(page, gh);
  gh.write('packages/hs/sprites/hex/HS_Plain_1.png', B);
  await page.evaluate(() => { Packages.openAtlases('hs'); });
  await expect(page.locator('body')).toContainText('OUT OF DATE');
  await page.getByRole('button', { name: 'Rebuild atlases' }).click();
  await expect.poll(() => gh.read('packages/atlas-request.json') !== null).toBe(true);
  expect(gh.json('packages/atlas-request.json').why).toBe('manual');
});
