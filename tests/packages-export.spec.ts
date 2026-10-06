import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import { openEditor, FakeGitHub, readZip, hexRec, bldRec, dataUrl, TINY_PNG, seedServerPackage } from './helpers';

// T5.9: Export builds the ZIP from the LOCAL state (entries, per-package sprites, package.json), warns when it differs
// from the published copy (same diff as publish) and works without a PAT and offline. No network writes.

async function boot(page: Page, gh: FakeGitHub, pat = true) {
  await openEditor(page, { gh, pat });
  await page.waitForFunction(() => (window as any).__startupSyncDone);
  await page.waitForFunction(() => !!Packages.getEntry('pp'));
}

// Server has pp with one hex (Pp_A type Plains). Local: Pp_A (same unless `differs`) + sprite Spr_1 in the package store.
async function setup(page: Page, mode: 'never' | 'same' | 'differs', opts: { pat?: boolean } = {}) {
  const gh = new FakeGitHub();
  if (mode === 'never') gh.setRegistry([{ id: 'pp', name: 'PP', version: '1.0.0' }]);
  else seedServerPackage(gh, 'pp', { name: 'PP', version: '1.2.3', description: 'srv', hexes: [hexRec('Pp_A', 'pp', { spriteName: 'Spr_1' })] });
  await boot(page, gh, opts.pat !== false);
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('Pp_A', 'pp', mode === 'differs' ? { spriteName: 'Spr_1', type: 'Forests' } : { spriteName: 'Spr_1' })]);
  await page.evaluate(d => SpriteStore.save('Spr_1', d, 'hex', 'pp'), dataUrl(TINY_PNG));
  await page.click('#tab-packages');
  return gh;
}
const exportBtn = (page: Page) => page.locator('tr[data-pkg="pp"]').getByRole('button', { name: /Export/ });
async function download(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: dl.suggestedFilename(), buf: fs.readFileSync((await dl.path())!) };
}
async function validate(page: Page, buf: Buffer) {
  return page.evaluate(async b64 => {
    const JSZip = await Packages._loadJSZip();
    const z = await JSZip.loadAsync(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    const p = await Packages.validatePackageZip(z);
    return { ok: p.ok, errors: p.errors, warnings: p.warnings, hexes: p.hexes.length, sprites: p.sprites.length };
  }, buf.toString('base64'));
}

test('in sync with the server: exports immediately, local entries + sprite, zero validator errors, no writes', async ({ page }) => {
  const gh = await setup(page, 'same');
  const writes0 = gh.writeLog.length;
  const { name, buf } = await download(page, () => exportBtn(page).click());
  expect(name).toBe('pp-1.2.3.zip');
  await expect(page.locator('#pkg-export-warn')).toHaveCount(0);
  const zip = await readZip(buf);
  expect(JSON.parse(await zip.file('hex_database.json')!.async('text')).hexes[0]).toMatchObject({ id: 'Pp_A', package: 'pp' });
  expect(await zip.file('sprites/hex/Spr_1.png')!.async('nodebuffer')).toEqual(TINY_PNG);
  const pj = JSON.parse(await zip.file('package.json')!.async('text'));
  expect(pj).toMatchObject({ id: 'pp', name: 'PP', version: '1.2.3', description: 'srv' });
  expect(pj.localOnly).toBeUndefined();
  const v = await validate(page, buf);
  expect(v.errors).toEqual([]);
  expect(v).toMatchObject({ ok: true, hexes: 1, sprites: 1 });
  expect(gh.writeLog.length).toBe(writes0);
});

test('unpublished changes: warns, Cancel downloads nothing, Export local exports the LOCAL version', async ({ page }) => {
  await setup(page, 'differs');
  await exportBtn(page).click();
  const warn = page.locator('#pkg-export-warn');
  await expect(warn).toContainText('1 hex tile');
  await expect(warn).toContainText('changed');
  // Cancel: nothing downloaded
  let downloads = 0; page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(warn).toHaveCount(0);
  expect(downloads).toBe(0);
  await exportBtn(page).click();
  await expect(warn).toBeVisible();
  const { name, buf } = await download(page, () => page.getByRole('button', { name: 'Export local' }).click());
  expect(name).toBe('pp-1.2.3.zip');
  const zip = await readZip(buf);
  expect(JSON.parse(await zip.file('hex_database.json')!.async('text')).hexes[0].type).toBe('Forests');   // local, not the server's value
  expect((await validate(page, buf)).errors).toEqual([]);
});

test('never published: warns, still exports (no PAT, version from the registry entry)', async ({ page }) => {
  await setup(page, 'never', { pat: false });
  await exportBtn(page).click();
  await expect(page.locator('#pkg-export-warn')).toContainText('never been published');
  const { name, buf } = await download(page, () => page.getByRole('button', { name: 'Export local' }).click());
  expect(name).toBe('pp-1.0.0.zip');
  expect((await validate(page, buf)).errors).toEqual([]);
});

test('offline / server unreadable: warns it could not compare and still exports locally', async ({ page }) => {
  const gh = await setup(page, 'same');
  await page.route(/\/packages\/pp\/hex_database\.json/, r => r.abort());
  await exportBtn(page).click();
  await expect(page.locator('#pkg-export-warn')).toContainText('Could not compare');
  const { buf } = await download(page, () => page.getByRole('button', { name: 'Export local' }).click());
  expect((await validate(page, buf)).errors).toEqual([]);
  void gh;
});

test('missing sprites are listed in the warning and left out of the ZIP; hostile names stay plain text', async ({ page }) => {
  await setup(page, 'same');
  await page.evaluate(() => HexDB.addEntries([{ id: 'Pp_X', type: 'Plains', package: 'pp', spriteName: 'x<img src=x onerror=window.__xss=1>' }]));
  await exportBtn(page).click();
  const list = page.locator('#pkg-export-missing');
  await expect(list).toContainText('hex/x<img src=x onerror=window.__xss=1>.png');
  await expect(list.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  const { buf } = await download(page, () => page.getByRole('button', { name: 'Export local' }).click());
  const zip = await readZip(buf);
  expect(Object.keys(zip.files).filter(n => n.startsWith('sprites/') && !n.endsWith('/'))).toEqual(['sprites/hex/Spr_1.png']);
});

test('sprite resolution: package copy beats the shared copy; shared copy beats the server pool; buildings go to sprites/buildings', async ({ page }) => {
  const gh = await setup(page, 'same');
  const other = Buffer.from(TINY_PNG); other[other.length - 20] ^= 1;   // distinguishable bytes, never decoded
  gh.write('packages/postapoc/sprites/hex/Pool_1.png', TINY_PNG);
  await page.evaluate(() => HexDB.addEntries([{ id: 'Pp_B', type: 'Plains', package: 'pp', spriteName: 'Shared_1' }, { id: 'Pp_C', type: 'Plains', package: 'pp', spriteName: 'Pool_1' }]));
  await page.evaluate(() => BldDB.addEntries([{ id: 'Pp_Farm', spriteName: 'Farm_1', package: 'pp', type: 'Ground Building', buildingCategory: 'Standard' }]));
  await page.evaluate(([a, b]) => Promise.all([SpriteStore.save('Shared_1', a, 'hex'), SpriteStore.save('Shared_1', b, 'hex', 'pp'), SpriteStore.save('Farm_1', a, 'buildings', 'pp')]), [dataUrl(TINY_PNG), dataUrl(other)]);
  await exportBtn(page).click();                                       // new local entries differ from the server: warning only, no missing-sprite list
  await expect(page.locator('#pkg-export-warn')).toBeVisible();
  await expect(page.locator('#pkg-export-missing')).toHaveCount(0);    // every sprite resolves (package, shared, pool)
  const { buf } = await download(page, () => page.getByRole('button', { name: 'Export local' }).click());
  const zip = await readZip(buf);
  expect(await zip.file('sprites/hex/Shared_1.png')!.async('nodebuffer')).toEqual(other);
  expect(zip.file('sprites/hex/Pool_1.png')).not.toBeNull();
  expect(zip.file('sprites/buildings/Farm_1.png')).not.toBeNull();
  expect((await validate(page, buf)).errors).toEqual([]);
});

test('size sanity: too many entries refuses the export with a message', async ({ page }) => {
  await setup(page, 'same');
  await page.evaluate(() => { HexDB.addEntries(Array.from({ length: 20001 }, (_, i) => ({ id: 'Big_' + i, type: 'Plains', package: 'pp' }))); });
  let downloads = 0; page.on('download', () => downloads++);
  await exportBtn(page).click();
  await expect(page.locator('#toast-container, .toast').filter({ hasText: /too many entries/i }).first()).toBeVisible();
  expect(downloads).toBe(0);
});

test('object URL is revoked, a second click while exporting is ignored', async ({ page }) => {
  await setup(page, 'same');
  await page.evaluate(() => {
    (window as any).__urls = { made: 0, revoked: 0 };
    const c = URL.createObjectURL.bind(URL), r = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b: any) => { (window as any).__urls.made++; return c(b); };
    URL.revokeObjectURL = (u: string) => { (window as any).__urls.revoked++; return r(u); };
  });
  const dls: string[] = []; page.on('download', d => dls.push(d.suggestedFilename()));
  await page.evaluate(() => { Packages.exportPackage('pp'); Packages.exportPackage('pp'); });
  await expect.poll(() => page.evaluate(() => (window as any).__urls.revoked)).toBe(1);
  expect(await page.evaluate(() => (window as any).__urls.made)).toBe(1);
  expect(dls).toEqual(['pp-1.2.3.zip']);
});
