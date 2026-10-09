import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { openEditor, FakeGitHub } from './helpers';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function seedPackage(gh: FakeGitHub, id: string) {
  gh.setRegistry([{ id, name: id, version: '1.0.0' }]);
  gh.write(`packages/${id}/hex_database.json`, '{"version":1,"hexes":[{"id":"A","spriteName":"A_one"},{"id":"B","spriteName":"B_two"}]}');
  gh.write(`packages/${id}/building_database.json`, '{"version":1,"buildings":[{"id":"H","spriteName":"House"}]}');
  gh.write(`packages/${id}/sprites/hex/B_two.png`, PNG);
  gh.write(`packages/${id}/sprites/hex/A_one.png`, Buffer.concat([PNG, Buffer.from('x')]));
  gh.write(`packages/${id}/sprites/buildings/House.png`, PNG);
  gh.write(`packages/${id}/sprites/hex/Orphan.png`, PNG);             // not referenced by any entry: must not be listed
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
  gh.write('packages/big/hex_database.json', '{"version":1,"hexes":[{"id":"A","spriteName":"Huge"}]}');
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
  for (const n of ['100%', 'x#y', 'q?r', 'Zażółć'])
    gh.write(`packages/odd/sprites/hex/${n}.png`, PNG);
  gh.write('packages/odd/hex_database.json', JSON.stringify({ version: 1, hexes: ['a b+c&d', '100%', 'x#y', 'q?r', 'Zażółć'].map(n => ({ id: n, spriteName: n })) }));
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

test('contract: a built manifest satisfies every documented rule', async ({ page }) => {
  const gh = new FakeGitHub();
  seedPackage(gh, 'cpkg');
  await openEditor(page, { gh, pat: true });
  const m = await page.evaluate(() => GitHubSync.buildManifest('cpkg', '2.0.0', { dependencies: ['postapoc'] }));
  const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  expect(Object.keys(m).sort()).toEqual(['dependencies', 'files', 'generatedAt', 'id', 'minAppVersion', 'schemaVersion', 'totalBytes', 'version']);
  expect(m.id).toMatch(SAFE);
  expect(m.version).toMatch(SAFE);
  const paths = m.files.map((f: any) => f.path);
  expect(new Set(paths).size).toBe(paths.length);
  expect([...paths].sort()).toEqual(paths);
  for (const f of m.files) {
    expect(f.path.split('/').every((s: string) => s && s !== '.' && s !== '..')).toBe(true);
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isInteger(f.size) && f.size >= 0).toBe(true);
  }
});

// ───────────────────────── fix round 1 ─────────────────────────
import { packageZip, hexRec, TINY_PNG, seedServerPackage, waitForLastWrite } from './helpers';
import type { Page } from '@playwright/test';

/** Re-hashes every listed file from the SERVER bytes and compares with the manifest; returns the manifest. */
function verifyManifest(gh: FakeGitHub, id: string) {
  const m = gh.json(`packages/${id}/manifest.json`);
  expect(m, `manifest of ${id}`).not.toBeNull();
  for (const f of m.files) {
    const b = gh.read(`packages/${id}/${f.path}`);
    expect(b, f.path).not.toBeNull();
    expect(sha(b!), f.path).toBe(f.sha256);
    expect(b!.length, f.path).toBe(f.size);
  }
  return m;
}
const manifestPuts = (gh: FakeGitHub, id: string) => gh.putPaths().filter(p => p === `packages/${id}/manifest.json`).length;
const baseReg = (version = '1.0.0') => JSON.stringify({ version: 1, packages: [{ id: 'postapoc', name: 'Post-Apocalypse', isDefault: true, version }] });
function seedBase(gh: FakeGitHub, hexes: object[] = [], blds: object[] = [], version = '1.0.0') {
  gh.write('packages/registry.json', baseReg(version));
  gh.setJson('packages/postapoc/package.json', { id: 'postapoc', name: 'Post-Apocalypse', version, isDefault: true });
  gh.write('packages/postapoc/hex_database.json', JSON.stringify({ version: 1, package: 'postapoc', hexes }));
  gh.write('packages/postapoc/building_database.json', JSON.stringify({ version: 1, package: 'postapoc', buildings: blds }));
}
async function imgBytes(page: Page, w = 512, h = 512): Promise<Buffer> {
  const b64 = await page.evaluate(([w, h]) => {
    const c = document.createElement('canvas'); c.width = w as number; c.height = h as number;
    const g = c.getContext('2d')!; g.fillStyle = 'rgb(200,30,30)'; g.fillRect(0, 0, w as number, h as number);
    return c.toDataURL('image/png').split(',')[1];
  }, [w, h] as const);
  return Buffer.from(b64, 'base64');
}

test.describe('C1: every writer of a covered file leaves a matching manifest', () => {
  test('sprite picker upload to postapoc: ONE manifest refresh after the batch, new sprites listed, hashes match', async ({ page }) => {
    const gh = new FakeGitHub();
    seedBase(gh, [{ id: 'Up1', spriteName: 'Up_One' }, { id: 'Up2', spriteName: 'Up_Two' }]);
    await openEditor(page, { gh, pat: true });
    await page.evaluate(() => (window as any).__startupSyncDone);
    const png = await imgBytes(page);
    await page.setInputFiles('#sprite-upload-input', [
      { name: 'Up_One.png', mimeType: 'image/png', buffer: png }, { name: 'Up_Two.png', mimeType: 'image/png', buffer: png }]);
    for (let i = 0; i < 2; i++) await page.locator('.ui-modal').getByRole('button', { name: 'Replace' }).click();   // both names are referenced by the base DB: "already exists" question
    await expect.poll(() => manifestPuts(gh, 'postapoc'), { timeout: 20000 }).toBe(1);
    const m = verifyManifest(gh, 'postapoc');
    expect(m.files.map((f: any) => f.path)).toEqual(expect.arrayContaining(['sprites/hex/Up_One.png', 'sprites/hex/Up_Two.png']));
    expect(manifestPuts(gh, 'postapoc')).toBe(1);
    expect(gh.json('packages/registry.json').packages[0].version).toBe('1.0.1');
  });

  test('Content Manager sprite upload: one refresh after the batch', async ({ page }) => {
    const gh = new FakeGitHub();
    seedBase(gh, [{ id: 'Cm1', spriteName: 'Cm_One' }]);
    await openEditor(page, { gh, pat: true });
    await page.evaluate(() => (window as any).__startupSyncDone);
    const png = await imgBytes(page);
    const chooser = page.waitForEvent('filechooser');
    await page.evaluate(() => { void GitHubSync._cmUploadSprite('hex'); });
    await (await chooser).setFiles([{ name: 'Cm_One.png', mimeType: 'image/png', buffer: png }]);
    await page.locator('.ui-modal').getByRole('button', { name: 'Replace' }).click();
    await expect.poll(() => manifestPuts(gh, 'postapoc'), { timeout: 20000 }).toBe(1);
    const m = verifyManifest(gh, 'postapoc');
    expect(m.files.map((f: any) => f.path)).toContain('sprites/hex/Cm_One.png');
  });

  test('migrate hex to building: the sprite is pushed BEFORE the publishes, ONE manifest refresh at the end, one version bump', async ({ page }) => {
    const gh = new FakeGitHub();
    seedBase(gh);
    await openEditor(page, { gh, pat: true });
    await page.evaluate(() => (window as any).__startupSyncDone);
    await page.evaluate(async () => {
      await SpriteStore.save('Mig_Sprite', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'hex', 'postapoc');
      HexDB.add();
      HexDB.getData().hexes[HexDB.getData().hexes.length - 1].spriteName = 'Mig_Sprite';
      UI.showConfirm = (_t: string, _m: string, cb: () => void) => cb();
      HexDB.migrateToBuilding();
    });
    await expect.poll(() => manifestPuts(gh, 'postapoc'), { timeout: 60000 }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    const order = gh.writeLog.map(w => w.path);
    const iSprite = order.indexOf('packages/postapoc/sprites/buildings/Mig_Sprite.png');
    expect(iSprite).toBeGreaterThan(-1);
    expect(order.indexOf('packages/postapoc/manifest.json')).toBeGreaterThan(Math.max(order.indexOf('packages/postapoc/hex_database.json'), order.indexOf('packages/postapoc/building_database.json'), iSprite));
    expect(manifestPuts(gh, 'postapoc')).toBe(1);
    expect(gh.json('packages/registry.json').packages[0].version).toBe('1.0.1');
    const m = verifyManifest(gh, 'postapoc');
    expect(m.files.map((f: any) => f.path)).toContain('sprites/buildings/Mig_Sprite.png');
  });

  test('package import (new id): the manifest is written after the sprites and before the registry, and the registry advertises it', async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh, pat: true });
    await page.evaluate(() => (window as any).__startupSyncDone);
    const zip = await packageZip('np', 'New P', { version: '1.4.0', hexes: [hexRec('Np_Tile', 'np', { spriteName: 'S1' })], sprites: { 'hex/S1.png': TINY_PNG } });
    await page.setInputFiles('#pkg-import-input', { name: 'p.zip', mimeType: 'application/zip', buffer: zip });
    await page.fill('#pkg-import-id', 'np');
    await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
    await waitForLastWrite(gh, 'packages/registry.json');
    const order = gh.writeLog.map(w => w.path);
    expect(order.at(-1)).toBe('packages/registry.json');
    expect(order.at(-2)).toBe('packages/np/manifest.json');
    const m = verifyManifest(gh, 'np');
    expect(m.version).toBe('1.4.0');
    expect(m.files.map((f: any) => f.path)).toEqual(['building_database.json', 'hex_database.json', 'sprites/hex/S1.png']);
    const e = gh.json('packages/registry.json').packages.find((p: any) => p.id === 'np');
    expect(e).toMatchObject({ version: '1.4.0', manifestUrl: 'packages/np/manifest.json', totalBytes: m.totalBytes, schemaVersion: 1 });
  });

  test('package import in Replace mode replaces the stale manifest and the registry fields', async ({ page }) => {
    const gh = new FakeGitHub();
    seedServerPackage(gh, 'old', { name: 'Old Pack', hexes: [hexRec('Old_Tile', 'old', { spriteName: 'S1' })], sprites: { 'hex/S1.png': TINY_PNG } });
    gh.setJson('packages/old/manifest.json', { schemaVersion: 1, id: 'old', version: '1.0.0', minAppVersion: '0.0.0', generatedAt: 'x', totalBytes: 9, dependencies: [],
      files: [{ path: 'hex_database.json', sha256: '0'.repeat(64), size: 9 }, { path: 'sprites/hex/Gone.png', sha256: '1'.repeat(64), size: 1 }] });
    const reg = gh.json('packages/registry.json'); reg.packages.find((p: any) => p.id === 'old').manifestUrl = 'packages/old/manifest.json'; gh.setJson('packages/registry.json', reg);
    await openEditor(page, { gh, pat: true });
    await page.evaluate(() => (window as any).__startupSyncDone);
    const zip = await packageZip('old', 'Old Pack', { version: '2.0.0', hexes: [hexRec('Old_Tile', 'old', { spriteName: 'S1' })], sprites: { 'hex/S1.png': TINY_PNG } });
    await page.setInputFiles('#pkg-import-input', { name: 'p.zip', mimeType: 'application/zip', buffer: zip });
    await page.fill('#pkg-import-id', 'old');
    await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
    await page.locator('#pkg-import-conflict-modal').getByRole('button', { name: 'Replace' }).click();
    await waitForLastWrite(gh, 'packages/registry.json');
    const m = verifyManifest(gh, 'old');
    expect(m.version).toBe('2.0.0');                           // the ZIP's 2.0.0 is above everything the server has: kept
    expect(m.files.map((f: any) => f.path)).not.toContain('sprites/hex/Gone.png');
    const e = gh.json('packages/registry.json').packages.find((p: any) => p.id === 'old');
    expect(e.version).toBe('2.0.0');
    expect(e.totalBytes).toBe(m.totalBytes);
  });

  test('a failed manifest write during an import is compensated like any other import file (nothing left behind)', async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh, pat: true });
    await page.evaluate(() => (window as any).__startupSyncDone);
    gh.failPut = p => p === 'packages/np/manifest.json';
    const zip = await packageZip('np', 'New P', { hexes: [hexRec('Np_Tile', 'np', { spriteName: 'S1' })], sprites: { 'hex/S1.png': TINY_PNG } });
    await page.setInputFiles('#pkg-import-input', { name: 'p.zip', mimeType: 'application/zip', buffer: zip });
    await page.fill('#pkg-import-id', 'np');
    await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
    await expect.poll(() => page.evaluate(() => (Packages as any).getImportResult()?.status)).toBe('failed');
    expect(gh.putPaths()).not.toContain('packages/registry.json');
    expect(gh.list('packages/np')).toBeNull();
  });

  test('the Publish postapoc confirm runs both publishes but ONE manifest refresh (one version bump)', async ({ page }) => {
    const gh = new FakeGitHub();
    seedBase(gh);
    await openEditor(page, { gh, pat: true });
    await page.evaluate(() => (window as any).__startupSyncDone);
    await page.evaluate(() => { UI.showConfirm = (_t: string, _m: string, cb: () => void) => cb(); void Packages.openPublishConfirm('postapoc'); });
    await expect.poll(() => manifestPuts(gh, 'postapoc'), { timeout: 60000 }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(gh.putPaths()).toContain('packages/postapoc/hex_database.json');
    expect(gh.putPaths()).toContain('packages/postapoc/building_database.json');
    expect(manifestPuts(gh, 'postapoc')).toBe(1);
    expect(gh.json('packages/registry.json').packages[0].version).toBe('1.0.1');
    verifyManifest(gh, 'postapoc');
  });

  test('standalone Publish HexDB still refreshes by itself', async ({ page }) => {
    const gh = new FakeGitHub();
    seedBase(gh);
    await openEditor(page, { gh, pat: true });
    await page.evaluate(() => GitHubSync.publishHexDbOnly());
    expect(manifestPuts(gh, 'postapoc')).toBe(1);
    await page.evaluate(() => GitHubSync.publishHexDbOnly({ skipManifest: true }));
    expect(manifestPuts(gh, 'postapoc')).toBe(1);
  });
});

test.describe('I1: manifest path rules equal Unity PackageManifest.Parse', () => {
  const build = (page: Page) => page.evaluate(() => GitHubSync.buildManifest('rule', '1.0.0').then(() => '', (e: any) => String(e.message)));
  function seedNames(gh: FakeGitHub, hexNames: string[], files: string[]) {
    gh.write('packages/rule/hex_database.json', JSON.stringify({ version: 1, hexes: hexNames.map(n => ({ id: n, spriteName: n })) }));
    for (const f of files) gh.write(`packages/rule/sprites/hex/${f}`, PNG);
  }
  test('a ":" name aborts and names the offender', async ({ page }) => {
    const gh = new FakeGitHub(); seedNames(gh, ['a:b', 'ok'], ['a:b.png', 'ok.png']);
    await openEditor(page, { gh, pat: true });
    const err = await build(page);
    expect(err).toContain('a:b.png');
  });
  test('names that differ only by case abort', async ({ page }) => {
    const gh = new FakeGitHub(); seedNames(gh, ['Tree', 'tree'], ['Tree.png', 'tree.png']);
    await openEditor(page, { gh, pat: true });
    const err = await build(page);
    expect(err).toMatch(/Tree\.png/); expect(err).toMatch(/tree\.png/);
  });
  test('a name starting with a dot and a backslash name abort', async ({ page }) => {
    const gh = new FakeGitHub(); seedNames(gh, ['.hidden', 'a\\b'], ['.hidden.png', 'a\\b.png']);
    await openEditor(page, { gh, pat: true });
    const err = await build(page);
    expect(err).toContain('.hidden.png'); expect(err).toContain('a\\b.png');
  });
  test('the path rule itself rejects ":" "\\" leading "/" and empty / "." / ".." segments', async ({ page }) => {
    await openEditor(page, { gh: new FakeGitHub(), pat: true });
    const r = await page.evaluate(() => ['sprites/hex/ok.png', 'sprites/hex/a b+c.png', 'a/../b.png', './b.png', 'a//b.png', '/abs.png', 'a:b.png', 'a\\b.png', 'sprites/hex/.x.png', '']
      .map(p => GitHubSync._manifestPathProblem(p) === ''));
    expect(r).toEqual([true, true, false, false, false, false, false, false, false, false]);
  });
  test('unreferenced unsafe names do not matter; spaces + & % # ? and non-ASCII are allowed', async ({ page }) => {
    const gh = new FakeGitHub(); seedNames(gh, ['a b+c&d', '100%', 'x#y', 'q?r', 'Zażółć'], ['a b+c&d.png', '100%.png', 'x#y.png', 'q?r.png', 'Zażółć.png', 'bad:unref.png']);
    await openEditor(page, { gh, pat: true });
    expect(await build(page)).toBe('');
  });
  test('an aborted package publish writes no manifest and no registry change', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.setRegistry([{ id: 'kp', name: 'K', version: '1.0.0' }]);
    gh.setJson('packages/kp/package.json', { id: 'kp', name: 'K', version: '1.0.0', isDefault: false });
    await openEditor(page, { gh, pat: true });
    await seedHexes(page, [{ id: 'Kp_A', package: 'kp', type: 'Plains', spriteName: 'Tree' }, { id: 'Kp_B', package: 'kp', type: 'Plains', spriteName: 'tree' }]);
    await page.evaluate(async () => {
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      await SpriteStore.save('Tree', png, 'hex', 'kp'); await SpriteStore.save('tree', png, 'hex', 'kp');
    });
    const r = await page.evaluate(() => Packages.publishPackage('kp', { bump: 'patch' }));
    expect(r.ok).toBe(false);
    expect(gh.putPaths()).not.toContain('packages/kp/manifest.json');
    expect(gh.putPaths()).not.toContain('packages/registry.json');
    expect(gh.putPaths()).not.toContain('packages/kp/package.json');
  });
});

test.describe('I2/I3/M3: listing and what the manifest lists', () => {
  test('the sprite listing is authenticated and not cached', async ({ page }) => {
    const gh = new FakeGitHub(); seedPackage(gh, 'auth');
    await openEditor(page, { gh, pat: true });
    const seen = await page.evaluate(async () => {
      const calls: { url: string; cache?: string; auth?: string }[] = [];
      const orig = window.fetch;
      window.fetch = ((input: any, init: any) => { calls.push({ url: String(input), cache: init?.cache, auth: init?.headers?.Authorization }); return orig(input, init); }) as any;
      await GitHubSync.buildManifest('auth', '1.0.0');
      window.fetch = orig;
      return calls.filter(c => /\/sprites\/(hex|buildings)\?/.test(c.url));
    });
    expect(seen.length).toBe(2);
    for (const c of seen) { expect(c.cache).toBe('no-store'); expect(c.auth).toMatch(/^Bearer /); }
  });
  test('a failing listing aborts the build (no partial manifest)', async ({ page }) => {
    const gh = new FakeGitHub(); seedPackage(gh, 'lf');
    gh.failGet = p => p === 'packages/lf/sprites/buildings';
    await openEditor(page, { gh, pat: true });
    const err = await page.evaluate(() => GitHubSync.buildManifest('lf', '1.0.0').then(() => '', (e: any) => String(e.message)));
    expect(err).toContain('500');
  });
  test('unreferenced sprites are not listed; a building sprite living in the hex folder is; a missing referenced file is not fatal', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.write('packages/lst/hex_database.json', JSON.stringify({ version: 1, hexes: [{ id: 'A', spriteName: 'In_Hex' }, { id: 'M', spriteName: 'Missing_One' }] }));
    gh.write('packages/lst/building_database.json', JSON.stringify({ version: 1, buildings: [{ id: 'Br', spriteName: 'Bridge_S' }, { id: 'N', spriteName: '' }, { id: 'U' }] }));
    gh.write('packages/lst/sprites/hex/In_Hex.png', PNG);
    gh.write('packages/lst/sprites/hex/Bridge_S.png', PNG);        // a Bridge building's sprite lives in the hex folder
    gh.write('packages/lst/sprites/hex/Unref.png', PNG);
    gh.write('packages/lst/sprites/buildings/Unref_B.png', PNG);
    await openEditor(page, { gh, pat: true });
    const m = await page.evaluate(() => GitHubSync.buildManifest('lst', '1.0.0'));
    expect(m.files.map((f: any) => f.path)).toEqual(['building_database.json', 'hex_database.json', 'sprites/hex/Bridge_S.png', 'sprites/hex/In_Hex.png']);
  });
  test('a name present in BOTH folders lists both files', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.write('packages/both/hex_database.json', JSON.stringify({ version: 1, hexes: [{ id: 'A', spriteName: 'Dual' }] }));
    gh.write('packages/both/sprites/hex/Dual.png', PNG);
    gh.write('packages/both/sprites/buildings/Dual.png', PNG);
    await openEditor(page, { gh, pat: true });
    const m = await page.evaluate(() => GitHubSync.buildManifest('both', '1.0.0'));
    expect(m.files.map((f: any) => f.path)).toEqual(['hex_database.json', 'sprites/buildings/Dual.png', 'sprites/hex/Dual.png']);
  });
  test('an unparseable database makes buildManifest throw', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.write('packages/badjson/hex_database.json', '{not json');
    await openEditor(page, { gh, pat: true });
    const err = await page.evaluate(() => GitHubSync.buildManifest('badjson', '1.0.0').then(() => '', (e: any) => String(e.message)));
    expect(err).toContain('hex_database.json');
  });
  test('an unexpected answer for a file (a directory listing) is refused', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.write('packages/dirx/hex_database.json', '{"version":1,"hexes":[]}');
    await openEditor(page, { gh, pat: true });
    await page.route(/api\.github\.com\/repos\/.*\/contents\/packages\/dirx\/hex_database\.json/, route =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ name: 'x', type: 'file' }]) }));
    const err = await page.evaluate(() => GitHubSync.buildManifest('dirx', '1.0.0').then(() => '', (e: any) => String(e.message)));
    expect(err).toMatch(/unexpected/i);
  });
  test('onProgress reports done/total', async ({ page }) => {
    const gh = new FakeGitHub(); seedPackage(gh, 'prog');
    await openEditor(page, { gh, pat: true });
    const calls = await page.evaluate(async () => { const c: number[][] = []; await GitHubSync.buildManifest('prog', '1.0.0', { onProgress: (d: number, t: number) => c.push([d, t]) }); return c; });
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.at(-1)![0]).toBe(calls.at(-1)![1]);
  });
});

test.describe('I4/I5/M5: consistency and failures', () => {
  test('a corrupt existing manifest.json is replaced', async ({ page }) => {
    const gh = new FakeGitHub(); seedPackage(gh, 'cm');
    gh.write('packages/cm/manifest.json', '{{{ not json');
    await openEditor(page, { gh, pat: true });
    await page.evaluate(() => GitHubSync.publishManifest('cm', '1.0.1'));
    expect(gh.json('packages/cm/manifest.json').version).toBe('1.0.1');
  });
  test('the manifest write is conditional on the sha read BEFORE the build: a concurrent change makes it fail instead of being overwritten', async ({ page }) => {
    const gh = new FakeGitHub(); seedPackage(gh, 'cc');
    gh.write('packages/cc/manifest.json', '{"old":true}');
    let fired = false;
    gh.failGet = p => { if (!fired && p === 'packages/cc/hex_database.json') { fired = true; gh.write('packages/cc/manifest.json', '{"other":"writer"}'); } return false; };
    await openEditor(page, { gh, pat: true });
    const err = await page.evaluate(() => GitHubSync.publishManifest('cc', '1.0.1').then(() => '', (e: any) => String(e.message)));
    expect(err).toContain('changed on the server');
    expect(gh.read('packages/cc/manifest.json')!.toString()).toBe('{"other":"writer"}');
  });
  test('base refresh aborts when the registry changed after it was read (nothing written)', async ({ page }) => {
    const gh = new FakeGitHub(); seedBase(gh);
    let fired = false;
    gh.failGet = p => { if (!fired && p === 'packages/postapoc/hex_database.json') { fired = true; gh.write('packages/registry.json', baseReg('1.0.7')); } return false; };
    await openEditor(page, { gh, pat: true });
    const err = await page.evaluate(() => GitHubSync.refreshBaseManifest().then(() => '', (e: any) => String(e.message)));
    expect(err).toContain('registry.json changed');
    expect(gh.putPaths()).toEqual([]);
  });
  test('package publish: the manifest is written even when the registry moved meanwhile; only the registry PUT fails, the retry converges', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.setRegistry([{ id: 'rc', name: 'R', version: '1.0.0' }]);
    gh.setJson('packages/rc/package.json', { id: 'rc', name: 'R', version: '1.0.0', isDefault: false });
    let fired = false;
    gh.failGet = p => { if (!fired && p === 'packages/rc/hex_database.json') { fired = true; gh.setRegistry([{ id: 'other', name: 'O', version: '1.0.0' }]); } return false; };
    await openEditor(page, { gh, pat: true });
    await seedHexes(page, [{ id: 'Rc_A', package: 'rc', type: 'Plains', spriteName: 'Rc_A' }]);
    const r = await page.evaluate(() => Packages.publishPackage('rc', { bump: 'patch' }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('409');
    expect(gh.putPaths()).not.toContain('packages/registry.json');
    expect(gh.putPaths()).not.toContain('packages/rc/package.json');
    const m = verifyManifest(gh, 'rc');                       // the manifest already matches the files that were written
    expect(m.version).toBe('1.0.1');
    const r2 = await page.evaluate(() => Packages.publishPackage('rc', { bump: 'patch' }));
    expect(r2.ok).toBe(true);
    expect(r2.version).toBe('1.0.1');                         // package.json was never written: same version again
    expect(verifyManifest(gh, 'rc').version).toBe('1.0.1');
    expect(gh.json('packages/registry.json').packages.find((p: any) => p.id === 'rc').version).toBe('1.0.1');
  });
  test('a version already used by a manifest is never reused (failed earlier run, manifest ahead of the registry)', async ({ page }) => {
    const gh = new FakeGitHub(); seedBase(gh);
    gh.failPut = p => p === 'packages/registry.json';
    await openEditor(page, { gh, pat: true });
    const e1 = await page.evaluate(() => GitHubSync.refreshBaseManifest().then(() => '', (e: any) => String(e.message)));
    expect(e1).toBeTruthy();
    expect(gh.json('packages/postapoc/manifest.json').version).toBe('1.0.1');      // left behind by the failed run
    gh.failPut = () => false;
    const r = await page.evaluate(() => GitHubSync.refreshBaseManifest());
    expect(r.version).toBe('1.0.2');
    expect(gh.json('packages/registry.json').packages[0].version).toBe('1.0.2');
  });
  test('manifest version above the registry: the new version is above both', async ({ page }) => {
    const gh = new FakeGitHub(); seedBase(gh);
    gh.setJson('packages/postapoc/manifest.json', { schemaVersion: 1, id: 'postapoc', version: '1.0.9', files: [] });
    await openEditor(page, { gh, pat: true });
    expect((await page.evaluate(() => GitHubSync.refreshBaseManifest())).version).toBe('1.0.10');
  });
  test('compares versions numerically (1.0.10 > 1.0.9)', async ({ page }) => {
    const gh = new FakeGitHub(); seedBase(gh, [], [], '1.0.9');
    gh.setJson('packages/postapoc/manifest.json', { id: 'postapoc', version: '1.0.10', files: [] });
    await openEditor(page, { gh, pat: true });
    expect((await page.evaluate(() => GitHubSync.refreshBaseManifest())).version).toBe('1.0.11');
  });
  test('an odd registry version throws, and a base publish only warns (sticky toast with the reason)', async ({ page }) => {
    const gh = new FakeGitHub(); seedBase(gh, [], [], 'banana');
    await openEditor(page, { gh, pat: true });
    const err = await page.evaluate(() => GitHubSync.refreshBaseManifest().then(() => '', (e: any) => String(e.message)));
    expect(err).toMatch(/banana/);
    expect(gh.putPaths()).toEqual([]);
    await page.evaluate(() => GitHubSync.publishHexDbOnly());
    expect(gh.putPaths()).toContain('packages/postapoc/hex_database.json');
    await expect(page.locator('#toast-container .toast.sticky')).toContainText('package manifest was NOT updated');
  });
  test('a 500 midway through the build aborts: no manifest and no registry change (base)', async ({ page }) => {
    const gh = new FakeGitHub();
    seedBase(gh, [{ id: 'A', spriteName: 'S_a' }, { id: 'B', spriteName: 'S_b' }]);
    gh.write('packages/postapoc/sprites/hex/S_a.png', PNG); gh.write('packages/postapoc/sprites/hex/S_b.png', PNG);
    gh.failGet = p => p === 'packages/postapoc/sprites/hex/S_b.png';
    await openEditor(page, { gh, pat: true });
    const err = await page.evaluate(() => GitHubSync.refreshBaseManifest().then(() => '', (e: any) => String(e.message)));
    expect(err).toContain('500');
    expect(gh.putPaths()).toEqual([]);
  });
  test('a 500 midway through a package publish: error reported, registry and package.json untouched', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.setRegistry([{ id: 'mf', name: 'M', version: '1.0.0' }]);
    gh.setJson('packages/mf/package.json', { id: 'mf', name: 'M', version: '1.0.0', isDefault: false });
    gh.failGet = p => p === 'packages/mf/building_database.json';
    await openEditor(page, { gh, pat: true });
    await seedHexes(page, [{ id: 'Mf_A', package: 'mf', type: 'Plains', spriteName: 'Mf_A' }]);
    const r = await page.evaluate(() => Packages.publishPackage('mf', { bump: 'patch' }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('500');
    expect(gh.putPaths()).not.toContain('packages/mf/manifest.json');
    expect(gh.putPaths()).not.toContain('packages/registry.json');
    expect(gh.putPaths()).not.toContain('packages/mf/package.json');
  });
  test('a failed manifest write during a package publish surfaces an error and leaves registry and package.json untouched', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.setRegistry([{ id: 'fp2', name: 'F', version: '1.0.0' }]);
    gh.setJson('packages/fp2/package.json', { id: 'fp2', name: 'F', version: '1.0.0', isDefault: false });
    gh.failPut = p => p === 'packages/fp2/manifest.json';
    await openEditor(page, { gh, pat: true });
    await seedHexes(page, [{ id: 'Fp2_A', package: 'fp2', type: 'Plains', spriteName: 'Fp2_A' }]);
    const r = await page.evaluate(() => Packages.publishPackage('fp2', { bump: 'patch' }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('manifest.json');
    expect(gh.putPaths()).not.toContain('packages/registry.json');
    expect(gh.putPaths()).not.toContain('packages/fp2/package.json');
    expect(gh.json('packages/fp2/package.json').version).toBe('1.0.0');
  });
});

test('contract (Unity-strict): every rule of PackageManifest.Parse holds for an editor-built manifest', async ({ page }) => {
  const gh = new FakeGitHub();
  seedPackage(gh, 'ucon');
  gh.write('packages/ucon/sprites/hex/a b+c.png', PNG);
  gh.write('packages/ucon/hex_database.json', '{"version":1,"hexes":[{"id":"A","spriteName":"A_one"},{"id":"B","spriteName":"a b+c"}]}');
  await openEditor(page, { gh, pat: true });
  const m = await page.evaluate(() => GitHubSync.buildManifest('ucon', '3.0.0', { dependencies: ['postapoc'] }));
  const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  expect(m.id).toMatch(TOKEN); expect(m.version).toMatch(TOKEN);
  const seen = new Set<string>();
  for (const f of m.files) {
    expect(f.path.length > 0 && f.path[0] !== '/' && !f.path.includes('\\') && !f.path.includes(':')).toBe(true);
    expect(f.path.split('/').every((s: string) => s.length > 0 && s !== '.' && s !== '..')).toBe(true);
    expect(seen.has(f.path.toLowerCase())).toBe(false); seen.add(f.path.toLowerCase());
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isInteger(f.size) && f.size >= 0).toBe(true);
  }
  for (const d of m.dependencies) expect(d.replace(/[<>=^~].*$/, '')).toMatch(TOKEN);
  expect(m.dependencies).not.toContain(m.id);
});

test.describe('import versions and missing-sprite note', () => {
  const importOver = async (page: Page, gh: FakeGitHub, zipVersion: string, id = 'old') => {
    await openEditor(page, { gh, pat: true });
    await page.evaluate(() => (window as any).__startupSyncDone);
    const zip = await packageZip(id, 'Old Pack', { version: zipVersion, hexes: [hexRec(`${id[0].toUpperCase()}${id.slice(1)}_Tile`, id, { spriteName: 'S1' })], sprites: { 'hex/S1.png': TINY_PNG } });
    await page.setInputFiles('#pkg-import-input', { name: 'p.zip', mimeType: 'application/zip', buffer: zip });
    await page.fill('#pkg-import-id', id);
    await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  };
  const seedOld = (gh: FakeGitHub, version = '1.0.0', manifestVersion?: string) => {
    seedServerPackage(gh, 'old', { name: 'Old Pack', version, hexes: [hexRec('Old_Tile', 'old', { spriteName: 'S1' })], sprites: { 'hex/S1.png': TINY_PNG } });
    if (manifestVersion) gh.setJson('packages/old/manifest.json', { schemaVersion: 1, id: 'old', version: manifestVersion, files: [] });
  };
  const replace = (page: Page) => page.locator('#pkg-import-conflict-modal').getByRole('button', { name: 'Replace' }).click();

  test('importing over a published package with the SAME version publishes a higher one everywhere', async ({ page }) => {
    const gh = new FakeGitHub(); seedOld(gh, '1.0.0');
    await importOver(page, gh, '1.0.0'); await replace(page);
    await waitForLastWrite(gh, 'packages/registry.json');
    expect(verifyManifest(gh, 'old').version).toBe('1.0.1');
    expect(gh.json('packages/old/package.json').version).toBe('1.0.1');
    expect(gh.json('packages/registry.json').packages.find((p: any) => p.id === 'old').version).toBe('1.0.1');
    await expect(page.locator('#toast-container')).toContainText('as v1.0.1');
  });
  test('a LOWER zip version, or a server manifest ahead of everything, ends above the server', async ({ page }) => {
    const gh = new FakeGitHub(); seedOld(gh, '2.0.0', '2.0.4');
    await importOver(page, gh, '0.5.0'); await replace(page);
    await waitForLastWrite(gh, 'packages/registry.json');
    expect(verifyManifest(gh, 'old').version).toBe('2.0.5');
    expect(gh.json('packages/registry.json').packages.find((p: any) => p.id === 'old').version).toBe('2.0.5');
  });
  test('a fresh package keeps the ZIP version', async ({ page }) => {
    const gh = new FakeGitHub();
    await importOver(page, gh, '3.2.1', 'brandnew');
    await waitForLastWrite(gh, 'packages/registry.json');
    expect(verifyManifest(gh, 'brandnew').version).toBe('3.2.1');
  });
  test('a failed Replace restores the old files AND the old manifest.json', async ({ page }) => {
    const gh = new FakeGitHub(); seedOld(gh, '1.0.0', '1.0.0');
    const oldManifest = gh.read('packages/old/manifest.json')!.toString();
    const oldReg = gh.read('packages/registry.json')!.toString();
    await importOver(page, gh, '1.0.0');
    gh.failPut = p => p === 'packages/registry.json';
    await replace(page);
    await expect.poll(() => page.evaluate(() => (Packages as any).getImportResult()?.status)).toBe('failed');
    expect(gh.putPaths()).toContain('packages/old/manifest.json');          // it was written, then compensated
    expect(gh.read('packages/old/manifest.json')!.toString()).toBe(oldManifest);
    expect(gh.read('packages/registry.json')!.toString()).toBe(oldReg);
    expect(gh.json('packages/old/package.json').version).toBe('1.0.0');
  });
  test('referenced sprites that are not on the server are named in the base-refresh toast (first 5)', async ({ page }) => {
    const gh = new FakeGitHub();
    seedBase(gh, ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map(n => ({ id: n, spriteName: n })));
    await openEditor(page, { gh, pat: true });
    const r = await page.evaluate(() => GitHubSync.refreshBaseManifestSafely());
    expect(r.version).toBe('1.0.1');
    await expect(page.locator('#toast-container .toast.sticky').first()).toContainText('6 referenced sprite(s) are not on the server: m1, m2, m3, m4, m5');
    const names = await page.evaluate(() => { let w: string[] = []; return GitHubSync.buildManifest('postapoc', '9.9.9', { onWarn: (m: string[]) => { w = m; } }).then(() => w); });
    expect(names).toHaveLength(6);
  });
});
