import { test, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { openEditor, FakeGitHub } from './helpers';

function crc32(buf: Buffer) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A real, valid PNG of w x h (one transparent colour). */
function png(w: number, h: number): number[] {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  return [...Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])];
}

function seed(gh: FakeGitHub) {
  gh.setRegistry([{ id: 'decameroon', name: 'Decameroon', version: '1.0.17' }]);
  gh.write('packages/decameroon/hex_database.json', '{"version":1,"hexes":[]}');
  gh.write('packages/decameroon/package.json', JSON.stringify({ id: 'decameroon', version: '1.0.17' }));
}

test('a name outside the game’s list, a non-PNG and a wrong size are refused', async ({ page }) => {
  await openEditor(page, { gh: new FakeGitHub(), pat: true });
  const out = await page.evaluate((good) => {
    const ok = new Uint8Array(good);
    return [
      GitHubSync.terrainSpriteProblem('roads', 'road_hex_36_NS.png', ok),
      GitHubSync.terrainSpriteProblem('coastline', 'Coastline_5_Top.png', ok),
      GitHubSync.terrainSpriteProblem('roads', 'road_hex_99_xx.png', ok),
      GitHubSync.terrainSpriteProblem('coastline', 'road_hex_36_NS.png', ok),
      GitHubSync.terrainSpriteProblem('roads', 'road_hex_36_NS.png', new Uint8Array(40)),
      GitHubSync.terrainSpriteProblem('shores', 'x.png', ok),
    ];
  }, png(512, 512));
  expect(out[0]).toBe('');
  expect(out[1]).toBe('');
  expect(out[2]).toContain('not a roads sprite name');
  expect(out[3]).toContain('not a coastline sprite name');
  expect(out[4]).toContain('not a PNG');
  expect(out[5]).toContain('unknown terrain folder');
  const small = await page.evaluate((b) => GitHubSync.terrainSpriteProblem('roads', 'River_bridge_1.png', new Uint8Array(b)), png(64, 64));
  expect(small).toContain('64x64');
});

test('the name tables have the sizes the game expects', async ({ page }) => {
  await openEditor(page, { gh: new FakeGitHub(), pat: true });
  const n = await page.evaluate(() => ({ c: GitHubSync.TERRAIN_SPRITE_SETS.coastline.length, r: GitHubSync.TERRAIN_SPRITE_SETS.roads.length }));
  expect(n).toEqual({ c: 6, r: 27 });
});

test('upload puts the files, lists them in the manifest and bumps the package version', async ({ page }) => {
  const gh = new FakeGitHub(); seed(gh);
  await openEditor(page, { gh, pat: true });
  const r = await page.evaluate((b) => GitHubSync.uploadTerrainSprites('decameroon', 'roads', [
    { name: 'road_hex_36_NS.png', bytes: new Uint8Array(b) }, { name: 'River_bridge_2.png', bytes: new Uint8Array(b) },
  ]), png(512, 512));
  expect(r).toEqual({ version: '1.0.18', count: 2 });
  expect(gh.read('packages/decameroon/sprites/terrain/roads/road_hex_36_NS.png')).not.toBeNull();
  expect(gh.read('packages/decameroon/sprites/terrain/roads/River_bridge_2.png')).not.toBeNull();
  const manifest = gh.json('packages/decameroon/manifest.json');
  expect(manifest.version).toBe('1.0.18');
  const paths = manifest.files.map((f: any) => f.path);
  expect(paths).toContain('sprites/terrain/roads/road_hex_36_NS.png');
  expect(paths).toContain('sprites/terrain/roads/River_bridge_2.png');
  expect(gh.json('packages/registry.json').packages.find((p: any) => p.id === 'decameroon').version).toBe('1.0.18');
  expect(gh.json('packages/decameroon/package.json').version).toBe('1.0.18');
});

test('one bad file uploads nothing and the version stays', async ({ page }) => {
  const gh = new FakeGitHub(); seed(gh);
  await openEditor(page, { gh, pat: true });
  const err = await page.evaluate((b) => GitHubSync.uploadTerrainSprites('decameroon', 'coastline', [
    { name: 'Coastline_0_UpperRight.png', bytes: new Uint8Array(b) }, { name: 'shore.png', bytes: new Uint8Array(b) },
  ]).then(() => '', (e: any) => String(e.message)), png(512, 512));
  expect(err).toContain('Nothing was uploaded');
  expect(err).toContain('shore.png');
  expect(gh.read('packages/decameroon/sprites/terrain/coastline/Coastline_0_UpperRight.png')).toBeNull();
  expect(gh.json('packages/registry.json').packages.find((p: any) => p.id === 'decameroon').version).toBe('1.0.17');
});

test('the base package is refused', async ({ page }) => {
  const gh = new FakeGitHub(); seed(gh);
  await openEditor(page, { gh, pat: true });
  const err = await page.evaluate((b) => GitHubSync.uploadTerrainSprites('postapoc', 'roads', [
    { name: 'road_hex_36_NS.png', bytes: new Uint8Array(b) }]).then(() => '', (e: any) => String(e.message)), png(512, 512));
  expect(err).toContain('base package');
  expect(gh.writeLog.filter(w => w.path.includes('sprites/terrain'))).toEqual([]);
});

test('the Packages tab has a Terrain sprites button for a non-default package that opens the dialog', async ({ page }) => {
  const gh = new FakeGitHub(); seed(gh);
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => Packages.openTerrainUpload('decameroon'));
  await expect(page.locator('#terrain-upload-modal')).toBeVisible();
  await expect(page.locator('#terrain-upload-folder option')).toHaveCount(2);
  await expect(page.locator('#terrain-upload-names')).toContainText('Coastline_5_Top');
  await page.selectOption('#terrain-upload-folder', 'roads');
  await expect(page.locator('#terrain-upload-names')).toContainText('road_hex_36_NS');
});
