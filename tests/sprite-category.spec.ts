import { test, expect, Page } from '@playwright/test';
import { openEditor, reloadEditor, FakeGitHub, bldRec, hexRec, seedHexes, seedBuildings, dataUrl, TINY_PNG } from './helpers';

// Two different PNGs that share a name: the OLD one in sprites/hex, the NEW one in sprites/buildings.
const OLD = Buffer.concat([TINY_PNG, Buffer.from('old')]);
const NEW = Buffer.concat([TINY_PNG, Buffer.from('newer')]);
const OLD_URL = dataUrl(OLD), NEW_URL = dataUrl(NEW);

async function open(page: Page, gh = new FakeGitHub()) {
  gh.setRegistry([{ id: 'medieval', name: 'Medieval Kingdom', version: '1.0.0' }]);
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => (window as any).__startupSyncDone);
  return gh;
}

test.describe('local sprite records are used only for their own category', () => {
  test('a local hex record with a building sprite name is ignored by the building views; a buildings record wins', async ({ page }) => {
    await open(page);
    await page.route(/sprites\/buildings\/Boat1\.png/, r => r.fulfill({ status: 200, contentType: 'image/png', body: NEW }));   // the server's buildings copy
    await seedBuildings(page, [bldRec('Boat', 'postapoc', { spriteName: 'Boat1', buildingCategory: 'Water Building' })]);
    // The stale record, then a restart so the real startup registration runs.
    await page.evaluate(async d => { await SpriteStore.save('Boat1', d, 'hex'); }, OLD_URL);
    await reloadEditor(page);
    await page.evaluate(() => (window as any).__startupSyncDone);
    await seedBuildings(page, [bldRec('Boat', 'postapoc', { spriteName: 'Boat1', buildingCategory: 'Water Building' })]);

    const r = await page.evaluate(async () => {
      const bld = BldDB.getAll().find((b: any) => b.id === 'Boat');
      await Terrain.applyHexDbOverrides([bld], 'packages/postapoc/sprites/buildings/');
      return {
        panel: Packages.spriteSrc(bld, 'bld'),
        map: Terrain.getSprite('Boat')?.src ?? null,
        hexView: Packages.spriteSrc({ spriteName: 'Boat1' }, 'hex'),
      };
    });
    expect(r.panel).toContain('sprites/buildings/Boat1.png');
    expect(r.map).toContain('sprites/buildings/Boat1.png');
    expect(r.hexView).toBe(OLD_URL);                                  // the record still serves its own category

    // A record of the matching category wins, exactly as before.
    await page.evaluate(async d => {
      await SpriteStore.save('Boat1', d, 'buildings');
      Terrain.registerUploadedUrls({ Boat1: d }, { Boat1: 'buildings' });
    }, NEW_URL);
    const r2 = await page.evaluate(async () => {
      const bld = BldDB.getAll().find((b: any) => b.id === 'Boat');
      await Terrain.applyHexDbOverrides([bld], 'packages/postapoc/sprites/buildings/');
      return { panel: Packages.spriteSrc(bld, 'bld'), map: Terrain.getSprite('Boat')?.src ?? null };
    });
    expect(r2.panel).toBe(NEW_URL);
    expect(r2.map).toBe(NEW_URL);
  });

  test('a record registered without a category is still used everywhere (old behaviour)', async ({ page }) => {
    await open(page);
    const url = await page.evaluate(d => { Terrain.registerUploadedUrls({ Legacy: d }); return [Terrain.getUploadedUrl('Legacy', 'postapoc', 'buildings'), Terrain.getUploadedUrl('Legacy', 'postapoc', 'hex')]; }, NEW_URL);
    expect(url).toEqual([NEW_URL, NEW_URL]);
  });

  test('a Bridge building keeps using the hex folder and hex records', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(d => {
      Terrain.registerUploadedUrls({ Br1: d }, { Br1: 'hex' });
      return Packages.spriteSrc({ spriteName: 'Br1', buildingCategory: 'Bridge' }, 'bld');
    }, NEW_URL);
    expect(r).toBe(NEW_URL);
    expect(await page.evaluate(() => Packages.spriteSrc({ spriteName: 'Br2', buildingCategory: 'Bridge' }, 'bld'))).toContain('sprites/hex/Br2.png');
  });
});

test.describe('sprite picker', () => {
  const stored = (page: Page) => page.evaluate(async () => (await SpriteStore.loadAll()).map((e: any) => e.name).sort());

  test('server-listed sprites are shown but never written into the local store; an explicit upload still is', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.write('packages/postapoc/sprites/hex/Server_Only_One.png', OLD);
    await open(page, gh);
    expect(await stored(page)).toEqual([]);
    await page.evaluate(() => UI.showSpritePicker(() => {}, { folder: 'packages/postapoc/sprites/hex', getSprites: () => [] }));
    const thumb = page.locator('#sprite-picker-grid img[src^="data:"]').first();
    await expect(thumb).toBeVisible();                                        // the downloaded bytes are displayed...
    await expect.poll(() => page.locator('#sprite-picker-grid img').count()).toBeGreaterThan(0);
    await page.waitForTimeout(500);                                          // ...and given any store write time to land
    expect(await stored(page)).toEqual([]);                                  // ...but not persisted

    const png = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const g = c.getContext('2d')!; g.fillStyle = 'rgb(10,200,30)'; g.fillRect(0, 0, 64, 64);
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.setInputFiles('#sprite-upload-input', [{ name: 'Mine_Uploaded.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
    await expect.poll(() => stored(page)).toEqual(['Mine_Uploaded']);
  });
});

test.describe('publishPackageSprites', () => {
  async function setup(page: Page, gh: FakeGitHub) {
    await open(page, gh);
    await seedBuildings(page, [bldRec('Med_Boat', 'medieval', { spriteName: 'Boat1', buildingCategory: 'Water Building' })]);
  }

  test('reports a local copy that differs from the server, and still publishes it', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.write('packages/medieval/sprites/buildings/Boat1.png', NEW);
    await setup(page, gh);
    await page.evaluate(async d => { await SpriteStore.save('Boat1', d, 'buildings', 'medieval'); }, OLD_URL);
    const res = await page.evaluate(() => Packages.publishPackageSprites('medieval'));
    expect(res).toMatchObject({ total: 1, pushed: 1, missing: [], differs: ['Boat1'], categoryMismatch: [] });
    expect(gh.putPaths()).toContain('packages/medieval/sprites/buildings/Boat1.png');
    expect(gh.read('packages/medieval/sprites/buildings/Boat1.png')!.equals(OLD)).toBe(true);   // not blocked
  });

  test('an identical local copy is not reported', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.write('packages/medieval/sprites/buildings/Boat1.png', NEW);
    await setup(page, gh);
    await page.evaluate(async d => { await SpriteStore.save('Boat1', d, 'buildings', 'medieval'); }, NEW_URL);
    const res = await page.evaluate(() => Packages.publishPackageSprites('medieval'));
    expect(res).toMatchObject({ pushed: 1, differs: [], categoryMismatch: [] });
  });

  test('the folder follows the referencing entry, not the category of the local record', async ({ page }) => {
    const gh = new FakeGitHub();
    await setup(page, gh);
    await page.evaluate(async d => { await SpriteStore.save('Boat1', d, 'hex', 'medieval'); }, OLD_URL);
    const res = await page.evaluate(() => Packages.publishPackageSprites('medieval'));
    expect(res).toMatchObject({ total: 1, pushed: 1, categoryMismatch: ['Boat1'] });
    expect(gh.putPaths()).toContain('packages/medieval/sprites/buildings/Boat1.png');
    expect(gh.putPaths()).not.toContain('packages/medieval/sprites/hex/Boat1.png');
  });

  test('a hex entry still publishes into the hex folder', async ({ page }) => {
    const gh = new FakeGitHub();
    await open(page, gh);
    await seedHexes(page, [hexRec('Med_Tile', 'medieval', { spriteName: 'Tile1' })]);
    await page.evaluate(async d => { await SpriteStore.save('Tile1', d, 'hex', 'medieval'); }, OLD_URL);
    const res = await page.evaluate(() => Packages.publishPackageSprites('medieval'));
    expect(res).toMatchObject({ pushed: 1, differs: [], categoryMismatch: [] });
    expect(gh.putPaths()).toContain('packages/medieval/sprites/hex/Tile1.png');
  });

  test('the publish result toast names the overwritten and the re-foldered sprites', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.setJson('packages/medieval/package.json', { id: 'medieval', name: 'Medieval Kingdom', version: '1.0.0', description: 'D', isDefault: false });
    gh.write('packages/medieval/sprites/buildings/Boat1.png', NEW);
    await setup(page, gh);
    await page.evaluate(async d => { await SpriteStore.save('Boat1', d, 'hex', 'medieval'); }, OLD_URL);
    await page.evaluate(() => { Packages.openPublishConfirm('medieval'); });
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('button', { name: /^Publish (now|anyway)$/ }).click();
    const t = page.locator('#toast-container');
    await expect(t).toContainText('1 sprite(s) overwritten with a different local copy: Boat1');
    await expect(t).toContainText('published to the referencing folder');
  });
});

test.describe('manifest', () => {
  const seed = (gh: FakeGitHub) => {
    gh.setRegistry([{ id: 'mpk', name: 'mpk', version: '1.0.0' }]);
    gh.write('packages/mpk/hex_database.json', '{"version":1,"hexes":[{"id":"T","spriteName":"Tile1"}]}');
    gh.write('packages/mpk/building_database.json', '{"version":1,"buildings":[{"id":"B","spriteName":"Boat1"},{"id":"Br","spriteName":"Bridge1","buildingCategory":"Bridge"}]}');
  };

  test('lists a name only from the folder its referencing database implies, and warns when the other copy differs', async ({ page }) => {
    const gh = new FakeGitHub();
    seed(gh);
    gh.write('packages/mpk/sprites/hex/Boat1.png', OLD);         // stale copy in the folder nothing needs for Boat1
    gh.write('packages/mpk/sprites/buildings/Boat1.png', NEW);
    gh.write('packages/mpk/sprites/hex/Tile1.png', OLD);
    gh.write('packages/mpk/sprites/buildings/Tile1.png', NEW);   // hex tile: the buildings copy is not listed
    gh.write('packages/mpk/sprites/hex/Bridge1.png', OLD);       // a Bridge building keeps the hex folder
    await openEditor(page, { gh, pat: true });
    const r = await page.evaluate(async () => {
      const warn: any[] = [];
      const m = await GitHubSync.buildManifest('mpk', '1.0.0', { onWarn: (missing: any, differ: any) => warn.push([missing, differ]) });
      return { paths: m.files.map((f: any) => f.path), warn };
    });
    expect(r.paths).toEqual(['building_database.json', 'hex_database.json', 'sprites/buildings/Boat1.png', 'sprites/hex/Bridge1.png', 'sprites/hex/Tile1.png']);
    expect(r.warn).toHaveLength(1);
    expect(r.warn[0][0]).toEqual([]);
    expect(r.warn[0][1]).toEqual([
      'same-named sprite differs between sprites/hex and sprites/buildings: Boat1',
      'same-named sprite differs between sprites/hex and sprites/buildings: Tile1',
    ]);
  });

  test('identical same-named copies in both folders do not warn', async ({ page }) => {
    const gh = new FakeGitHub();
    seed(gh);
    gh.write('packages/mpk/sprites/hex/Boat1.png', NEW);
    gh.write('packages/mpk/sprites/buildings/Boat1.png', NEW);
    gh.write('packages/mpk/sprites/hex/Tile1.png', OLD);
    gh.write('packages/mpk/sprites/hex/Bridge1.png', OLD);
    await openEditor(page, { gh, pat: true });
    const r = await page.evaluate(async () => {
      let differ: any = null;
      const m = await GitHubSync.buildManifest('mpk', '1.0.0', { onWarn: (_m: any, d: any) => { differ = d; } });
      return { paths: m.files.map((f: any) => f.path), differ };
    });
    expect(r.paths).toContain('sprites/buildings/Boat1.png');
    expect(r.paths).not.toContain('sprites/hex/Boat1.png');
    expect(r.differ).toEqual([]);
  });

  test('a referenced name whose only file is in the other folder is reported missing', async ({ page }) => {
    const gh = new FakeGitHub();
    seed(gh);
    gh.write('packages/mpk/sprites/hex/Boat1.png', OLD);         // the game would look in sprites/buildings: not there
    await openEditor(page, { gh, pat: true });
    const missing = await page.evaluate(async () => {
      let miss: any = null;
      await GitHubSync.buildManifest('mpk', '1.0.0', { onWarn: (m: any) => { miss = m; } });
      return miss;
    });
    expect(missing).toContain('Boat1');
  });
});
