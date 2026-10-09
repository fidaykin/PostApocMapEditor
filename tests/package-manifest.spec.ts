import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { openEditor, FakeGitHub } from './helpers';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function seedPackage(gh: FakeGitHub, id: string) {
  gh.setRegistry([{ id, name: id, version: '1.0.0' }]);
  gh.write(`packages/${id}/hex_database.json`, '{"version":1,"hexes":[{"id":"A"}]}');
  gh.write(`packages/${id}/building_database.json`, '{"version":1,"buildings":[]}');
  gh.write(`packages/${id}/sprites/hex/B_two.png`, PNG);
  gh.write(`packages/${id}/sprites/hex/A_one.png`, Buffer.concat([PNG, Buffer.from('x')]));
  gh.write(`packages/${id}/sprites/buildings/House.png`, PNG);
  gh.write(`packages/${id}/sprites/hex/manifest.json`, '["A_one"]');   // legacy array: must not be listed
  gh.write(`packages/${id}/preview.png`, PNG);                         // preview: must not be listed
}

test('sha256Hex matches Node for the empty input, ASCII and binary', async ({ page }) => {
  await openEditor(page, { gh: new FakeGitHub(), pat: true });
  const out = await page.evaluate(async () => [
    await GitHubSync.sha256Hex(new Uint8Array([])),
    await GitHubSync.sha256Hex(new Uint8Array([97, 98, 99])),
    await GitHubSync.sha256Hex(new Uint8Array([0, 255, 128, 1])),
  ]);
  expect(out).toEqual([sha(''), sha('abc'), sha(Buffer.from([0, 255, 128, 1]))]);
});

test('buildManifest lists databases and sprites sorted, with the real hash and size of each file', async ({ page }) => {
  const gh = new FakeGitHub();
  seedPackage(gh, 'zpkg');
  await openEditor(page, { gh, pat: true });
  const m = await page.evaluate(() => GitHubSync.buildManifest('zpkg', '1.2.3', { dependencies: ['postapoc'] }));

  expect(m.schemaVersion).toBe(1);
  expect(m.id).toBe('zpkg');
  expect(m.version).toBe('1.2.3');
  expect(m.minAppVersion).toBe('0.0.0');
  expect(m.dependencies).toEqual(['postapoc']);
  expect(m.files.map((f: any) => f.path)).toEqual([
    'building_database.json', 'hex_database.json',
    'sprites/buildings/House.png', 'sprites/hex/A_one.png', 'sprites/hex/B_two.png',
  ]);
  const byPath = Object.fromEntries(m.files.map((f: any) => [f.path, f]));
  expect(byPath['hex_database.json'].sha256).toBe(sha(gh.read('packages/zpkg/hex_database.json')!));
  expect(byPath['hex_database.json'].size).toBe(gh.read('packages/zpkg/hex_database.json')!.length);
  expect(byPath['sprites/hex/A_one.png'].sha256).toBe(sha(gh.read('packages/zpkg/sprites/hex/A_one.png')!));
  expect(m.totalBytes).toBe(m.files.reduce((n: number, f: any) => n + f.size, 0));
  expect(Date.parse(m.generatedAt)).not.toBeNaN();
});

test('a package without sprite folders still gets a valid manifest of its databases', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'bare', name: 'bare' }]);
  gh.write('packages/bare/hex_database.json', '{"version":1,"hexes":[]}');
  await openEditor(page, { gh, pat: true });
  const m = await page.evaluate(() => GitHubSync.buildManifest('bare', '1.0.0'));
  expect(m.files.map((f: any) => f.path)).toEqual(['hex_database.json']);
});

test('files over 1 MB (no inline content from the Contents API) are hashed through the raw media type', async ({ page }) => {
  const gh = new FakeGitHub();
  seedPackage(gh, 'big');
  const bigBytes = Buffer.alloc(1_300_000, 7);
  gh.write('packages/big/sprites/hex/Huge.png', bigBytes);
  gh.hideContent = p => p === 'packages/big/sprites/hex/Huge.png';
  await openEditor(page, { gh, pat: true });
  // the fake answers 'content: ""' for hidden files; serve the raw bytes for the Accept: raw request
  await page.route(/api\.github\.com\/repos\/.*\/contents\/packages\/big\/sprites\/hex\/Huge\.png/, route => {
    const accept = route.request().headers()['accept'] || '';
    if (accept.includes('raw')) return route.fulfill({ status: 200, body: bigBytes, headers: { 'access-control-allow-origin': '*' } });
    return route.fallback();
  });
  const m = await page.evaluate(() => GitHubSync.buildManifest('big', '1.0.0'));
  const huge = m.files.find((f: any) => f.path === 'sprites/hex/Huge.png');
  expect(huge.size).toBe(bigBytes.length);
  expect(huge.sha256).toBe(sha(bigBytes));
});

test('an id that could climb out of the package folder is refused before any request', async ({ page }) => {
  const gh = new FakeGitHub();
  seedPackage(gh, 'evilpkg');
  await openEditor(page, { gh, pat: true });
  const before = gh.requests.length;
  const err = await page.evaluate(() =>
    GitHubSync.buildManifest('../evilpkg', '1.0.0').then(() => '', (e: any) => String(e.message)));
  expect(err).toContain('Refusing unsafe');
  expect(gh.requests.length).toBe(before);
});

test('manifestRegistryFields maps a manifest to the optional registry fields', async ({ page }) => {
  await openEditor(page, { gh: new FakeGitHub(), pat: true });
  const f = await page.evaluate(() =>
    GitHubSync.manifestRegistryFields({ id: 'p', schemaVersion: 1, minAppVersion: '0.0.0', totalBytes: 42, files: [] }));
  expect(f).toEqual({ manifestUrl: 'packages/p/manifest.json', totalBytes: 42, minAppVersion: '0.0.0', schemaVersion: 1 });
});

import { seedHexes } from './helpers';

test('publishManifest writes packages/<id>/manifest.json and rewriting it is conditional on the stored sha', async ({ page }) => {
  const gh = new FakeGitHub();
  seedPackage(gh, 'mp');
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => GitHubSync.publishManifest('mp', '1.0.1'));
  const m1 = gh.json('packages/mp/manifest.json');
  expect(m1.version).toBe('1.0.1');
  await page.evaluate(() => GitHubSync.publishManifest('mp', '1.0.2'));     // second write must carry the first file's sha
  expect(gh.json('packages/mp/manifest.json').version).toBe('1.0.2');
  expect(gh.puts.filter(p => p.path === 'packages/mp/manifest.json')).toHaveLength(2);
});

test('a package publish writes the manifest BEFORE the registry and advertises it there', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'wpkg', name: 'W Pkg', version: '1.0.0' }]);
  gh.setJson('packages/wpkg/package.json', { id: 'wpkg', name: 'W Pkg', version: '1.0.0', isDefault: false });
  await openEditor(page, { gh, pat: true });
  await seedHexes(page, [{ id: 'Wpkg_Hex_1', package: 'wpkg', type: 'Plains', spriteName: 'Wpkg_Hex_1' }]);
  await page.evaluate(() => Packages.publishPackage('wpkg', { bump: 'patch' }));

  const order = gh.writeLog.map(w => w.path);
  const iManifest = order.indexOf('packages/wpkg/manifest.json');
  const iRegistry = order.indexOf('packages/registry.json');
  const iPkgJson  = order.indexOf('packages/wpkg/package.json');
  expect(iManifest).toBeGreaterThan(-1);
  expect(iManifest).toBeLessThan(iRegistry);
  expect(iRegistry).toBeLessThan(iPkgJson);

  const manifest = gh.json('packages/wpkg/manifest.json');
  const entry = gh.json('packages/registry.json').packages.find((p: any) => p.id === 'wpkg');
  expect(manifest.version).toBe('1.0.1');
  expect(entry.version).toBe('1.0.1');
  expect(entry.manifestUrl).toBe('packages/wpkg/manifest.json');
  expect(entry.totalBytes).toBe(manifest.totalBytes);
  expect(entry.schemaVersion).toBe(1);
  expect(manifest.files.map((f: any) => f.path)).toContain('hex_database.json');
});

test('if the manifest cannot be written the registry is not touched', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'fpkg', name: 'F Pkg', version: '1.0.0' }]);
  gh.setJson('packages/fpkg/package.json', { id: 'fpkg', name: 'F Pkg', version: '1.0.0', isDefault: false });
  gh.failPut = p => p === 'packages/fpkg/manifest.json';
  await openEditor(page, { gh, pat: true });
  await seedHexes(page, [{ id: 'Fpkg_Hex_1', package: 'fpkg', type: 'Plains', spriteName: 'Fpkg_Hex_1' }]);
  const r = await page.evaluate(() => Packages.publishPackage('fpkg', { bump: 'patch' }).catch((e: any) => ({ error: String(e && e.message || e) })));
  expect(gh.json('packages/registry.json').packages.find((p: any) => p.id === 'fpkg').version).toBe('1.0.0');
  expect(gh.putPaths()).not.toContain('packages/registry.json');
  void r;
});

test('sprite names the editor itself publishes (spaces, + and &) are listed, not refused', async ({ page }) => {
  const gh = new FakeGitHub();
  seedPackage(gh, 'odd');
  gh.write('packages/odd/sprites/hex/a b+c&d.png', PNG);
  await openEditor(page, { gh, pat: true });
  const m = await page.evaluate(() => GitHubSync.buildManifest('odd', '1.0.0'));
  const f = m.files.find((x: any) => x.path === 'sprites/hex/a b+c&d.png');
  expect(f.sha256).toBe(sha(PNG));
});

test('refreshBaseManifest bumps the patch once and keeps manifest, registry and package.json consistent', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.write('packages/registry.json', JSON.stringify({ version: 1, packages: [{ id: 'postapoc', name: 'Post-Apocalypse', isDefault: true, version: '1.0.0' }] }));
  gh.setJson('packages/postapoc/package.json', { id: 'postapoc', name: 'Post-Apocalypse', version: '1.0.0', isDefault: true });
  gh.write('packages/postapoc/hex_database.json', '{"version":1,"package":"postapoc","hexes":[]}');
  gh.write('packages/postapoc/building_database.json', '{"version":2,"package":"postapoc","buildings":[]}');
  await openEditor(page, { gh, pat: true });

  const r = await page.evaluate(() => GitHubSync.refreshBaseManifest());
  expect(r.version).toBe('1.0.1');
  expect(gh.json('packages/postapoc/manifest.json').version).toBe('1.0.1');
  expect(gh.json('packages/registry.json').packages[0].version).toBe('1.0.1');
  expect(gh.json('packages/registry.json').packages[0].manifestUrl).toBe('packages/postapoc/manifest.json');
  expect(gh.json('packages/postapoc/package.json').version).toBe('1.0.1');

  const r2 = await page.evaluate(() => GitHubSync.refreshBaseManifest());
  expect(r2.version).toBe('1.0.2');
});

test('Publish HexDB also refreshes the postapoc manifest; a manifest failure only warns', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.write('packages/registry.json', JSON.stringify({ version: 1, packages: [{ id: 'postapoc', name: 'Post-Apocalypse', isDefault: true, version: '1.0.0' }] }));
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => GitHubSync.publishHexDbOnly());
  expect(gh.putPaths()).toContain('packages/postapoc/hex_database.json');
  expect(gh.putPaths()).toContain('packages/postapoc/manifest.json');

  const gh2 = new FakeGitHub();
  gh2.write('packages/registry.json', JSON.stringify({ version: 1, packages: [{ id: 'postapoc', name: 'Post-Apocalypse', isDefault: true, version: '1.0.0' }] }));
  gh2.failPut = p => p === 'packages/postapoc/manifest.json';
  const page2 = await page.context().newPage();
  await openEditor(page2, { gh: gh2, pat: true });
  await page2.evaluate(() => GitHubSync.publishHexDbOnly());           // must not throw
  expect(gh2.putPaths()).toContain('hex_database.json');                // the publish itself still succeeded
  expect(gh2.json('packages/registry.json').packages[0].version).toBe('1.0.0');
});

test('Publish Buildings DB refreshes the postapoc manifest', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.write('packages/registry.json', JSON.stringify({ version: 1, packages: [{ id: 'postapoc', name: 'Post-Apocalypse', isDefault: true, version: '1.0.0' }] }));
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => GitHubSync.publishBuildingsDb());
  expect(gh.putPaths()).toContain('packages/postapoc/building_database.json');
  expect(gh.putPaths()).toContain('packages/postapoc/manifest.json');
});

test('Publish Sprites also refreshes the postapoc manifest', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.write('packages/registry.json', JSON.stringify({ version: 1, packages: [{ id: 'postapoc', name: 'Post-Apocalypse', isDefault: true, version: '1.0.0' }] }));
  await openEditor(page, { gh, pat: true });
  await page.evaluate(async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await SpriteStore.save('ManifestProbe', png, 'hex', 'postapoc');
    await GitHubSync.publishAllSprites();
  });
  expect(gh.putPaths()).toContain('packages/postapoc/sprites/hex/ManifestProbe.png');
  expect(gh.putPaths()).toContain('packages/postapoc/manifest.json');
});
