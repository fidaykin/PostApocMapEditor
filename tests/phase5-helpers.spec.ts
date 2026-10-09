import { test, expect } from '@playwright/test';
import {
  openEditor, FakeGitHub, buildZip, readZip, packageZip, TINY_PNG, dataUrl, hexRec, bldRec,
  seedHexes, seedBuildings, seedSprites, seedServerPackage, waitForLastWrite,
} from './helpers';

test('FakeGitHub: DELETE needs the current sha, removes disk-backed and written files, and is logged', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => (window as any).__startupSyncDone);
  gh.write('packages/zz/package.json', '{"id":"zz"}');
  const del = (p: string, sha: string) => page.evaluate(async ([path, s]) => {
    const r = await fetch(`https://api.github.com/repos/fidaykin/PostApocMapEditor/contents/${path}`, {
      method: 'DELETE', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'm', sha: s, branch: 'gh-pages' }) });
    return r.status;
  }, [p, sha]);
  expect(await del('packages/zz/package.json', 'stale')).toBe(409);
  expect(gh.read('packages/zz/package.json')).not.toBeNull();            // positive control: a refused delete changes nothing
  expect(await del('packages/zz/package.json', gh.sha('packages/zz/package.json'))).toBe(200);
  expect(gh.read('packages/zz/package.json')).toBeNull();
  expect(await del('packages/zz/package.json', 'x')).toBe(404);
  expect(gh.read('packages/registry.json')).not.toBeNull();              // exists on disk
  expect(await del('packages/registry.json', gh.sha('packages/registry.json'))).toBe(200);
  expect(gh.read('packages/registry.json')).toBeNull();                  // tombstone hides the disk copy
  expect(gh.deletes).toEqual(['packages/zz/package.json', 'packages/registry.json']);
  expect(gh.writeLog.map(w => `${w.op} ${w.path}`)).toEqual(['DELETE packages/zz/package.json', 'DELETE packages/registry.json']);
});

test('FakeGitHub: ordered write log and waitForLastWrite; routes of openEditor are not shadowed', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'medieval', name: 'Medieval Kingdom' }]);
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => (window as any).__startupSyncDone);
  expect(await page.evaluate(() => GitHubSync.isPATConfigured())).toBe(true);
  expect(await page.evaluate(() => !!Packages.getEntry('medieval'))).toBe(true);   // served by the fake registry
  await page.evaluate(async () => {
    await GitHubSync._putText('packages/o/a.json', '{"a":1}', 'one');
    await GitHubSync._putText('packages/o/b.json', '{"b":1}', 'two');
    await GitHubSync._putText('packages/o/c.json', '{"c":1}', 'three');
  });
  await waitForLastWrite(gh, 'packages/o/c.json');
  expect(gh.writeLog.map(w => w.path)).toEqual(['packages/o/a.json', 'packages/o/b.json', 'packages/o/c.json']);
  expect(gh.writeLog.every(w => w.op === 'PUT')).toBe(true);
  expect(gh.putPaths()).toEqual(gh.writeLog.map(w => w.path));
  expect(gh.requests.some(r => r.method === 'GET' && r.path === 'packages/o/a.json' && r.status === 404)).toBe(true);
  await expect(waitForLastWrite(gh, 'packages/o/never.json', 300)).rejects.toThrow();   // negative control
});

test('JSZip helpers: build a package ZIP, read it back, and the editor loads it', async ({ page }) => {
  const buf = await packageZip('zipmod', 'Zip Mod', { hexes: [hexRec('Zipmod_H', 'zipmod')], sprites: { 'hex/Zipmod_H.png': TINY_PNG } });
  const z = await readZip(buf);
  expect(Object.keys(z.files).filter(n => !n.endsWith('/')).sort()).toEqual(['building_database.json', 'hex_database.json', 'package.json', 'sprites/hex/Zipmod_H.png']);
  expect(JSON.parse(await z.file('hex_database.json')!.async('string')).hexes[0].id).toBe('Zipmod_H');
  expect((await buildZip({ 'a.txt': 'x' })).length).toBeGreaterThan(0);
  await openEditor(page, { pat: true });
  const names = await page.evaluate(async (b64) => {
    const JSZip = await Packages._loadJSZip();
    const zip = await JSZip.loadAsync(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    return Object.keys(zip.files).filter((n: string) => !n.endsWith('/')).sort();
  }, buf.toString('base64'));
  expect(names).toEqual(Object.keys(z.files).filter(n => !n.endsWith('/')).sort());
});

test('seeding helpers: local hexes, buildings, sprites and a server package', async ({ page }) => {
  const gh = new FakeGitHub();
  seedServerPackage(gh, 'srvpkg', { name: 'Srv Pkg', hexes: [hexRec('Srvpkg_H', 'srvpkg')], buildings: [bldRec('Srvpkg_B', 'srvpkg')], sprites: { 'hex/Srvpkg_H.png': TINY_PNG } });
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => (window as any).__startupSyncDone);
  expect(await page.evaluate(() => Packages.getEntry('srvpkg')?.name)).toBe('Srv Pkg');
  expect(gh.json('packages/srvpkg/package.json').id).toBe('srvpkg');
  expect(gh.read('packages/srvpkg/sprites/hex/Srvpkg_H.png')!.equals(TINY_PNG)).toBe(true);

  await seedHexes(page, [hexRec('Loc_H', 'locpkg')]);
  await seedBuildings(page, [bldRec('Loc_B', 'locpkg')]);
  await seedSprites(page, [{ name: 'Loc_H', category: 'hex', dataUrl: dataUrl(TINY_PNG) }]);
  expect(await page.evaluate(() => HexDB.getAll().filter(h => h.package === 'locpkg').map(h => h.id))).toEqual(['Loc_H']);
  expect(await page.evaluate(() => BldDB.getAll().filter(b => b.package === 'locpkg').map(b => b.id))).toEqual(['Loc_B']);
  expect(await page.evaluate(async () => (await SpriteStore.loadAll()).find(s => s.name === 'Loc_H')?.category)).toBe('hex');
  expect(await page.evaluate(() => typeof Terrain.getUploadedUrl('Loc_H'))).toBe('string');
});
