import { test, expect } from '@playwright/test';
import { openEditor, reloadEditor, FakeGitHub, hexRec, bldRec, seedHexes, seedBuildings, dataUrl, TINY_PNG } from './helpers';

const A = 'data:image/png;base64,AAAA', B = 'data:image/png;base64,BBBB';

async function open(page: any, gh = new FakeGitHub()) {
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => (window as any).__startupSyncDone);
  return gh;
}

test('sprites are stored and resolved per package, with no cross-package overwrite', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async ([a, b]) => {
    await SpriteStore.save('Foo', a, 'hex');
    await SpriteStore.save('Foo', b, 'hex', 'medieval');
    Terrain.registerUploadedUrls({ 'Foo': 'data:A', 'medieval/Foo': 'data:B' });
    const BASE = GitHubSync.BASE_URL;
    const names = async (p: string) => (await SpriteStore.loadForPackage(p)).filter((e: any) => e.name === 'Foo').map((e: any) => e.dataUrl);
    const raw = (await SpriteStore.loadAll()).filter((e: any) => e.name.endsWith('Foo'));
    return {
      BASE, pkg: await names('medieval'), base: await names('postapoc'),
      rawNames: raw.map((e: any) => e.name).sort(),
      merged: (await SpriteStore.loadByCategory('hex', 'medieval')).filter((e: any) => e.name === 'Foo').map((e: any) => e.dataUrl),
      mergedBase: (await SpriteStore.loadByCategory('hex')).filter((e: any) => e.name === 'Foo').map((e: any) => e.dataUrl),
      keys: [SpriteStore.keyFor('postapoc', 'Foo'), SpriteStore.keyFor('medieval', 'Foo')],
      urlPkg: Terrain.getUploadedUrl('Foo', 'medieval'), urlBase: Terrain.getUploadedUrl('Foo', 'postapoc'), urlLegacy: Terrain.getUploadedUrl('Foo'),
      urlOther: Terrain.getUploadedUrl('Foo', 'scifi'),
      srcPkg: Packages.spriteSrc({ spriteName: 'X', package: 'medieval' }, 'hex'),
      srcBase: Packages.spriteSrc({ spriteName: 'X' }, 'hex'),
      srcBridge: Packages.spriteSrc({ spriteName: 'Y', package: 'medieval', buildingCategory: 'Bridge' }, 'bld'),
      srcRoad: Packages.spriteSrc({ spriteName: 'Z', isRoad: true }, 'bld'),
      srcBld: Packages.spriteSrc({ spriteName: 'W', package: 'medieval' }, 'bld'),
      srcUp: Packages.spriteSrc({ spriteName: 'Foo', package: 'medieval' }, 'hex'),
      srcNone: Packages.spriteSrc({ spriteName: '' }, 'hex'),
    };
  }, [A, B]);
  expect(r.pkg).toEqual([B]);
  expect(r.base).toEqual([A]);                       // the medieval copy did not overwrite the postapoc one
  expect(r.rawNames).toEqual(['Foo', 'medieval/Foo']);
  expect(r.keys).toEqual(['Foo', 'medieval/Foo']);
  expect(r.merged).toEqual([B]);                     // the active package wins
  expect(r.mergedBase).toEqual([A]);
  expect([r.urlPkg, r.urlBase, r.urlLegacy]).toEqual(['data:B', 'data:A', 'data:A']);
  expect(r.urlOther).toBe('data:A');                 // a package without its own copy falls back to the default package
  expect(r.srcPkg).toBe(`${r.BASE}/packages/medieval/sprites/hex/X.png`);
  expect(r.srcBase).toBe('packages/postapoc/sprites/hex/X.png');
  expect(r.srcBridge).toBe(`${r.BASE}/packages/medieval/sprites/hex/Y.png`);
  expect(r.srcRoad).toBe('packages/postapoc/sprites/terrain/roads/Z.png');
  expect(r.srcBld).toBe(`${r.BASE}/packages/medieval/sprites/buildings/W.png`);
  expect(r.srcUp).toBe('data:B');
  expect(r.srcNone).toBe('');
});

test('sprite URLs encode untrusted names and package ids as single path segments', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => ({
    base: Packages.spriteSrc({ spriteName: 'a b/../c?x#"<' }, 'hex'),
    pkg: Packages.spriteSrc({ spriteName: 'n', package: 'p/../q?' }, 'bld'),
    BASE: GitHubSync.BASE_URL,
  }));
  expect(r.base).toBe('packages/postapoc/sprites/hex/' + encodeURIComponent('a b/../c?x#"<') + '.png');
  expect(r.base).not.toMatch(/\.\.\/|["<#]|\?/);
  expect(r.pkg).toBe(`${r.BASE}/packages/${encodeURIComponent('p/../q?')}/sprites/buildings/n.png`);
});

test('a package hex resolves its own sprite; a missing one is reported as failed (validator rule input)', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async (png) => {
    Terrain.registerUploadedUrls({ 'medieval/OwnSprite': png });
    await Terrain.applyHexDbOverrides([
      { id: 'Medieval_Own', spriteName: 'OwnSprite', package: 'medieval' },
      { id: 'Medieval_Missing', spriteName: 'NoSuchSpriteAnywhere', package: 'medieval' },
    ]);
    return [Terrain.spriteState('Medieval_Own'), Terrain.spriteState('Medieval_Missing')];
  }, dataUrl(TINY_PNG));
  expect(r).toEqual(['loaded', 'failed']);       // only the package-qualified lookup can have loaded the first one
});

test('Publish Sprites never pushes package sprites into the postapoc pool', async ({ page }) => {
  const gh = await open(page);
  await page.evaluate(async (d) => {
    await SpriteStore.save('Only_Base', d, 'hex');
    await SpriteStore.save('Only_Med', d, 'hex', 'medieval');
    await GitHubSync.publishAllSprites();
  }, dataUrl(TINY_PNG));
  expect(gh.putPaths()).toContain('packages/postapoc/sprites/hex/Only_Base.png');
  expect(gh.putPaths().some(p => p.includes('Only_Med') || p.includes('medieval'))).toBe(false);
});

test('publishing a package writes its sprites into the package folder, preferring its own copy, falling back to postapoc', async ({ page }) => {
  const gh = await open(page);
  await seedHexes(page, [hexRec('Medieval_Own', 'medieval', { spriteName: 'OwnS' }), hexRec('Medieval_Base', 'medieval', { spriteName: 'Barren' })]);
  const res = await page.evaluate(async (d) => {
    await SpriteStore.save('OwnS', d, 'hex', 'medieval');
    return Packages.publishPackageSprites('medieval');
  }, dataUrl(TINY_PNG));
  expect(res).toMatchObject({ total: 2, pushed: 2, missing: [] });
  expect(gh.putPaths()).toContain('packages/medieval/sprites/hex/OwnS.png');
  expect(gh.putPaths()).toContain('packages/medieval/sprites/hex/Barren.png');   // came from the postapoc pool
  expect(gh.putPaths().some(p => p.startsWith('packages/postapoc/'))).toBe(false);
});

test('migration moves flat sprites that only a non-default package uses, losslessly and idempotently', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Medieval_A', 'medieval', { spriteName: 'MedOnly' }), hexRec('Medieval_B', 'medieval', { spriteName: 'Shared' }),
                         hexRec('Medieval_C', 'medieval', { spriteName: 'Clash' })]);
  await seedBuildings(page, [bldRec('Postapoc_Bld', 'postapoc', { spriteName: 'Shared' })]);
  await page.evaluate(async ([a, b]) => {
    for (const n of ['MedOnly', 'Shared', 'Orphan', 'Clash']) await SpriteStore.save(n, a, 'hex');
    await SpriteStore.save('Clash', b, 'hex', 'medieval');            // a different copy already exists under the package
  }, [A, B]);
  const snap = () => page.evaluate(async () => Object.fromEntries((await SpriteStore.loadAll()).map((e: any) => [e.name, e.dataUrl])));
  const r1 = await page.evaluate(() => Packages.migrateFlatSprites());
  const s1 = await snap();
  expect(s1).toEqual({ 'medieval/MedOnly': A, Shared: A, Orphan: A, Clash: A, 'medieval/Clash': B });   // MedOnly moved; the rest kept (nothing lost)
  expect(r1.moved).toBe(1);
  const r2 = await page.evaluate(() => Packages.migrateFlatSprites());
  expect(r2.moved).toBe(0);
  expect(await snap()).toEqual(s1);
  // the live lookup follows the move
  expect(await page.evaluate(() => [Terrain.getUploadedUrl('MedOnly', 'medieval'), Terrain.getUploadedUrl('MedOnly', 'postapoc')])).toEqual([A, null]);
});

test('startup migrates a pre-existing flat sprite store', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Medieval_A', 'medieval', { spriteName: 'MedOnly' })]);
  await page.evaluate(async (a) => { await SpriteStore.save('MedOnly', a, 'hex'); }, A);
  await reloadEditor(page);
  await page.evaluate(() => (window as any).__startupSyncDone);
  await expect.poll(() => page.evaluate(async () => (await SpriteStore.loadAll()).map((e: any) => e.name).sort())).toEqual(['medieval/MedOnly']);
});

test('a failing IndexedDB does not break startup or publishing a package sprite', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => { const req: any = {}; setTimeout(() => req.onerror && req.onerror({ target: { error: new Error('idb blocked') } })); return req; };
  });
  const gh = await open(page);
  await seedHexes(page, [hexRec('Medieval_Base', 'medieval', { spriteName: 'Barren' })]);
  const res = await page.evaluate(() => Packages.publishPackageSprites('medieval'));
  expect(res).toMatchObject({ total: 1, pushed: 1, missing: [] });
  expect(gh.putPaths()).toContain('packages/medieval/sprites/hex/Barren.png');
  expect(await page.evaluate(() => Packages.migrateFlatSprites())).toMatchObject({ moved: 0 });
});
