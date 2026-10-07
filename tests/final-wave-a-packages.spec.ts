import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import { openEditor, FakeGitHub, packageZip, buildZip, readZip, hexRec, bldRec, dataUrl, TINY_PNG, seedServerPackage, waitForLastWrite } from './helpers';

// Final fix wave A, package items (A1-A8): hostile sprite names, import rollback that only touches what THIS import
// wrote, local-only packages claimed by an online import, Merge vs server sprites, large server files, sprite name rules.

const REG = 'packages/registry.json';

async function boot(page: Page, gh = new FakeGitHub(), pat = true) {
  await openEditor(page, { gh, pat });
  await page.waitForFunction(() => (window as any).__startupSyncDone);
  return gh;
}
const importErrors = async (page: Page, buf: Buffer) => {
  await page.setInputFiles('#pkg-import-input', { name: 'pkg.zip', mimeType: 'application/zip', buffer: buf });
  await expect(page.locator('#pkg-import-errors')).toBeVisible();
  const text = await page.locator('#pkg-import-errors').innerText();
  await page.locator('#pkg-import-errors-modal').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#pkg-import-errors')).toHaveCount(0);
  return text;
};
async function pick(page: Page, buf: Buffer, id: string) {
  await page.setInputFiles('#pkg-import-input', { name: 'pkg.zip', mimeType: 'application/zip', buffer: buf });
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
  await page.fill('#pkg-import-id', id);
}
const clickImport = (page: Page) => page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
const status = (page: Page) => page.evaluate(() => (Packages as any).getImportResult());
const settled = (page: Page) => expect.poll(async () => (await status(page))?.status).not.toMatch(/^(running|undefined)$/);

const HOSTILE = ['../../../registry.json?', 'x#y', '%2e%2e', 'a/b', 'a\\b', '..', '<img src=x onerror=window.__xss=1>', 'nul\u0000x', 'CON', 'aux.x', '__preview', 'trailing.', 'x'.repeat(65), 'é'];

// ── A1 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('A1: a ZIP whose database names an unsafe sprite is refused before anything is written (hostile table)', async ({ page }) => {
  const gh = await boot(page);
  const n = gh.requests.length;
  for (const bad of HOSTILE) {
    const text = await importErrors(page, await packageZip('evil', 'Evil', { hexes: [hexRec('Evil_A', 'evil', { spriteName: bad })] }));
    expect(text, JSON.stringify(bad)).toMatch(/unsafe spriteName/);
    const text2 = await importErrors(page, await packageZip('evil', 'Evil', { buildings: [bldRec('Evil_B', 'evil', { spriteName: bad })] }));
    expect(text2, JSON.stringify(bad)).toMatch(/unsafe spriteName/);
  }
  expect(gh.writeLog).toEqual([]);
  expect(gh.requests.length).toBe(n);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  // positive control: a canonical name (spaces, dots and dashes are fine) passes
  await page.setInputFiles('#pkg-import-input', { name: 'ok.zip', mimeType: 'application/zip',
    buffer: await packageZip('evil', 'Evil', { hexes: [hexRec('Evil_A', 'evil', { spriteName: 'Good name-1.v2' })] }) });
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
});

test('A1: publish refuses unsafe sprite names (from older data or the server) with zero requests; encodes safe-but-odd names', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'evil', name: 'Evil', version: '1.0.0' }]);
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('evil'));
  await page.evaluate(() => (window as any).__startupSyncDone);
  for (const bad of HOSTILE) {
    await page.evaluate(h => { HexDB.removeByPackage('evil'); HexDB.addEntries(h); }, [hexRec('Evil_A', 'evil', { spriteName: bad })]);
    const n = gh.requests.length;
    const r = await page.evaluate(() => Packages.publishPackage('evil', { bump: 'patch' }));
    expect(r.ok, JSON.stringify(bad)).toBe(false);
    expect(r.error, JSON.stringify(bad)).toMatch(/Unsafe sprite name/);
    expect(gh.writeLog).toEqual([]);
    expect(gh.requests.slice(n).filter(q => q.method !== 'GET')).toEqual([]);
  }
  // positive control + encoding: 'a b+c&d' is canonical and is written as ONE encoded segment
  const urls: string[] = [];
  page.on('request', q => { if (q.method() === 'PUT') urls.push(q.url()); });
  await page.evaluate(h => { HexDB.removeByPackage('evil'); HexDB.addEntries(h); }, [hexRec('Evil_A', 'evil', { spriteName: 'a b+c&d' })]);
  await page.evaluate(d => SpriteStore.save('a b+c&d', d, 'hex', 'evil'), dataUrl(TINY_PNG));
  const r = await page.evaluate(() => Packages.publishPackage('evil', { bump: 'patch' }));
  expect(r.ok).toBe(true);
  expect(urls.some(u => u.endsWith('/contents/packages/evil/sprites/hex/a%20b%2Bc%26d.png'))).toBe(true);
  expect(gh.read('packages/evil/sprites/hex/a b+c&d.png')).not.toBeNull();
});

test('A1: the Contents API path of a write encodes every segment (a name with ? # % cannot address another file)', async ({ page }) => {
  const gh = await boot(page);
  const urls: string[] = [];
  page.on('request', q => { if (q.url().includes('api.github.com')) urls.push(q.url()); });
  await page.evaluate(async () => { await GitHubSync._putText('packages/x/sprites/hex/q?r#s%t.png', 'hi', 'm', null); });
  expect(urls.some(u => u.includes('/contents/packages/x/sprites/hex/q%3Fr%23s%25t.png'))).toBe(true);
  expect(gh.read('packages/x/sprites/hex/q?r#s%t.png')?.toString()).toBe('hi');
});

test('A1: export refuses a package with an unsafe sprite name and every exported ZIP round-trips through our validator', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'evil', name: 'Evil', version: '1.0.0' }]);
  await openEditor(page, { gh, pat: false });
  await page.waitForFunction(() => !!Packages.getEntry('evil'));
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.evaluate(() => { (window as any).__zips = 0; const o = URL.createObjectURL; URL.createObjectURL = (b: any) => { (window as any).__zips++; return o.call(URL, b); }; });
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('Evil_A', 'evil', { spriteName: '../../registry' })]);
  await page.evaluate(() => Packages.exportPackage('evil', { skipWarning: true }));
  expect(await page.evaluate(() => (window as any).__zips)).toBe(0);
  await expect(page.locator('#toast-container')).toContainText(/Unsafe sprite name/);
  // a package with odd-but-canonical names exports and re-validates
  await page.evaluate(h => { HexDB.removeByPackage('evil'); HexDB.addEntries(h); }, [hexRec('Evil_A', 'evil', { spriteName: 'a b+c&d' })]);
  await page.evaluate(d => SpriteStore.save('a b+c&d', d, 'hex', 'evil'), dataUrl(TINY_PNG));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => Packages.exportPackage('evil', { skipWarning: true }))]);
  const buf = fs.readFileSync((await dl.path())!);
  const zip = await readZip(buf);
  expect(Object.keys(zip.files)).toContain('sprites/hex/a b+c&d.png');
  const v = await page.evaluate(async b64 => {
    const JSZip = await Packages._loadJSZip();
    const p = await Packages.validatePackageZip(await JSZip.loadAsync(Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
    return { ok: p.ok, errors: p.errors, sprites: p.sprites.length };
  }, buf.toString('base64'));
  expect(v).toEqual({ ok: true, errors: [], sprites: 1 });
});

// ── import fixtures ───────────────────────────────────────────────────────────────────────────────────────────────
const NEW = 'new-pack';
const P = `packages/${NEW}`;
const OTHER_PNG = (() => { const b = Buffer.from(TINY_PNG); b[b.length - 20] ^= 1; return b; })();   // different bytes, never decoded
const newZip = (extra: { version?: string; sprites?: Record<string, Buffer> } = {}) => packageZip('src', 'Src Pack', {
  hexes: [hexRec('Src_Tile', 'src', { spriteName: 'S1' })],
  buildings: [bldRec('Src_Farm', 'src', { spriteName: 'S2' })],
  sprites: extra.sprites ?? { 'hex/S1.png': TINY_PNG, 'buildings/S2.png': TINY_PNG },
  version: extra.version,
});
const conflictModal = (page: Page) => page.locator('#pkg-import-conflict-modal');
const failedModal = (page: Page) => page.locator('#pkg-import-failed-modal');
const snapAll = (page: Page) => page.evaluate(async () => ({
  hex: JSON.stringify(HexDB.getData().hexes), bld: JSON.stringify(BldDB.getAll()),
  sprites: JSON.stringify((await SpriteStore.loadAll()).sort((a: any, b: any) => a.name < b.name ? -1 : 1)),
  trash: localStorage.getItem('pkg_trash'), registry: JSON.stringify(Packages.getAll()),
}));

// ── A2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('A2: another writer created the id between the id check and the first write: the import refuses before writing, nothing of theirs is touched', async ({ page }) => {
  const gh = await boot(page);
  await pick(page, await newZip(), NEW);
  let seen = 0;
  gh.failGet = p => {
    if (p === `${P}/package.json` && ++seen === 2) {   // 1st = the id check, 2nd = the pre-write snapshot
      gh.write(`${P}/package.json`, JSON.stringify({ id: NEW, name: 'theirs' }));
      gh.write(`${P}/hex_database.json`, '{"theirs":true}');
    }
    return false;
  };
  await clickImport(page);
  await settled(page);
  expect((await status(page)).status).toBe('failed');
  expect(gh.writeLog).toEqual([]);                                       // zero writes by this import
  expect(JSON.parse(gh.read(`${P}/package.json`)!.toString()).name).toBe('theirs');
  expect(gh.read(`${P}/hex_database.json`)!.toString()).toBe('{"theirs":true}');
  expect(await page.evaluate(() => HexDB.getData().hexes.some((h: any) => h.package === 'new-pack'))).toBe(false);
});

test('A2: a writer that creates a file after the snapshot makes the write fail (create-only); rollback leaves their file alone and says so', async ({ page }) => {
  const gh = await boot(page);
  await pick(page, await newZip(), NEW);
  let hit = false;
  gh.failPut = p => { if (p === `${P}/hex_database.json` && !hit) { hit = true; gh.write(p, 'theirs'); } return false; };
  await clickImport(page);
  await settled(page);
  expect((await status(page)).status).toBe('failed');
  expect(gh.read(`${P}/hex_database.json`)!.toString()).toBe('theirs');   // never overwritten
  expect(gh.read(`${P}/package.json`)).toBeNull();                          // ours: removed again
  expect(gh.deletes).toEqual([`${P}/package.json`]);
  await expect(failedModal(page)).toContainText('changed by someone else');
  await expect(failedModal(page)).toContainText(`${P}/hex_database.json`);
  expect((await status(page)).changed).toEqual([`${P}/hex_database.json`]);
});

test('A2: a file another writer changed between our write and the rollback is left alone and listed', async ({ page }) => {
  const gh = await boot(page);
  await pick(page, await newZip(), NEW);
  gh.failPut = p => { if (p === REG) { gh.write(`${P}/hex_database.json`, 'edited by someone else'); return true; } return false; };
  await clickImport(page);
  await settled(page);
  expect((await status(page)).status).toBe('failed');
  expect(gh.read(`${P}/hex_database.json`)!.toString()).toBe('edited by someone else');
  expect(gh.read(`${P}/package.json`)).toBeNull();
  expect(gh.read(`${P}/sprites/hex/S1.png`)).toBeNull();
  expect(gh.deletes).not.toContain(`${P}/hex_database.json`);
  await expect(failedModal(page)).toContainText('changed by someone else');
  await expect(failedModal(page)).toContainText(`${P}/hex_database.json`);
});

// ── A3 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('A3: importing over a local-only id online claims it: no local record, no badge, and publish works', async ({ page }) => {
  const gh = await boot(page, new FakeGitHub(), false);
  await page.evaluate(() => Packages.openNewModal());
  await page.fill('#pkg-new-name', 'Loc Pack');
  await page.fill('#pkg-new-id', 'loc-pack');
  await page.locator('#pkg-new-modal').getByRole('button', { name: 'Create' }).click();
  await page.waitForFunction(() => !!Packages.getEntry('loc-pack'));
  expect(await page.evaluate(() => Packages.getEntry('loc-pack').localOnly)).toBe(true);
  await page.evaluate(() => GitHubSync.setPAT('test-token'));              // now online with a token
  await page.click('#tab-packages');
  await pick(page, await packageZip('loc-pack', 'Loc Pack', { hexes: [hexRec('LocPack_A', 'loc-pack', { spriteName: 'S1' })], sprites: { 'hex/S1.png': TINY_PNG } }), 'loc-pack');
  await clickImport(page);
  await conflictModal(page).getByRole('button', { name: 'Replace' }).click();
  await waitForLastWrite(gh, REG);
  await settled(page);
  expect((await status(page)).status).toBe('ok');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pkg_local_registry') || '[]').map((r: any) => r.id))).toEqual([]);
  expect(await page.evaluate(() => !!Packages.getEntry('loc-pack').localOnly)).toBe(false);
  await expect(page.locator('tr[data-pkg="loc-pack"] .pkg-local-badge')).toHaveCount(0);
  const r = await page.evaluate(() => Packages.publishPackage('loc-pack', { bump: 'patch' }));
  expect(r.ok, JSON.stringify(r)).toBe(true);
});

test('A3: an id someone else published meanwhile is not overwritten by importing over a local-only package', async ({ page }) => {
  const gh = await boot(page, new FakeGitHub(), false);
  await page.evaluate(() => Packages.openNewModal());
  await page.fill('#pkg-new-name', 'Loc Pack');
  await page.fill('#pkg-new-id', 'loc-pack');
  await page.locator('#pkg-new-modal').getByRole('button', { name: 'Create' }).click();
  await page.waitForFunction(() => !!Packages.getEntry('loc-pack'));
  seedServerPackage(gh, 'loc-pack', { name: 'Strangers' });
  await page.evaluate(() => GitHubSync.setPAT('test-token'));
  await pick(page, await packageZip('loc-pack', 'Loc Pack', { hexes: [hexRec('LocPack_A', 'loc-pack')] }), 'loc-pack');
  await clickImport(page);
  await expect(page.locator('#pkg-import-error')).toContainText('already exists on the server');
  expect(gh.writeLog).toEqual([]);
});

// ── A4 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const seedOld = (gh: FakeGitHub) => seedServerPackage(gh, 'old', {
  name: 'Old Pack', hexes: [hexRec('Old_Tile', 'old', { spriteName: 'S1' })], buildings: [], sprites: { 'hex/S1.png': TINY_PNG },
});
const oldZip = () => packageZip('old', 'Old Pack', {
  hexes: [hexRec('Old_Tile', 'old', { spriteName: 'S1' }), hexRec('Old_Two', 'old', { spriteName: 'S2' })],
  sprites: { 'hex/S1.png': OTHER_PNG, 'hex/S2.png': OTHER_PNG },
});
async function bootOld(page: Page) {
  const gh = new FakeGitHub(); seedOld(gh);
  await boot(page, gh);
  await page.waitForFunction(() => !!Packages.getEntry('old'));
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('Old_Tile', 'old', { spriteName: 'S1' })]);
  await page.evaluate(d => SpriteStore.save('S1', d, 'hex', 'old'), dataUrl(TINY_PNG));   // the sprite the user keeps locally
  return gh;
}

test('A4: Merge keeps a same-name local sprite and does NOT overwrite the server copy; new sprites are still written and the summary says so', async ({ page }) => {
  const gh = await bootOld(page);
  const serverBefore = gh.read('packages/old/sprites/hex/S1.png')!;
  await pick(page, await oldZip(), 'old');
  await clickImport(page);
  await conflictModal(page).getByRole('button', { name: 'Merge' }).click();
  await waitForLastWrite(gh, REG);
  await settled(page);
  expect((await status(page)).status).toBe('ok');
  expect(gh.writeLog.map(w => w.path)).not.toContain('packages/old/sprites/hex/S1.png');
  expect(gh.read('packages/old/sprites/hex/S1.png')!.equals(serverBefore)).toBe(true);
  expect(gh.read('packages/old/sprites/hex/S2.png')!.equals(OTHER_PNG)).toBe(true);   // the new one is written
  const local = await page.evaluate(async () => (await SpriteStore.loadForPackage('old')).map((e: any) => [e.name, e.dataUrl.length]).sort());
  expect(local.map((x: any) => x[0])).toEqual(['S1', 'S2']);
  expect(await page.evaluate(async () => (await SpriteStore.get('S1', 'old')).dataUrl)).toBe(dataUrl(TINY_PNG));
  await expect(page.locator('#toast-container')).toContainText('skipped');
});

test('A4: Replace (and New) write every ZIP sprite to the server and locally', async ({ page }) => {
  const gh = await bootOld(page);
  await pick(page, await oldZip(), 'old');
  await clickImport(page);
  await conflictModal(page).getByRole('button', { name: 'Replace' }).click();
  await waitForLastWrite(gh, REG);
  await settled(page);
  expect(gh.read('packages/old/sprites/hex/S1.png')!.equals(OTHER_PNG)).toBe(true);
  expect(await page.evaluate(async () => (await SpriteStore.get('S1', 'old')).dataUrl)).toBe(dataUrl(OTHER_PNG));
  // New mode
  await page.evaluate(() => Packages.closeImportModal());
  await pick(page, await newZip(), NEW);
  const n = gh.writeLog.length;
  await clickImport(page);
  await waitForLastWrite(gh, REG);
  await expect.poll(() => gh.writeLog.slice(n).filter(w => w.path === REG).length).toBe(1);
  await settled(page);
  expect(gh.writeLog.slice(n).map(w => w.path).filter(p => p.includes('/sprites/'))).toEqual([`${P}/sprites/hex/S1.png`, `${P}/sprites/buildings/S2.png`]);
  expect(await page.evaluate(async () => (await SpriteStore.loadForPackage('new-pack')).map((e: any) => e.name).sort())).toEqual(['S1', 'S2']);
});

// ── A5 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('A5: a server file over 1 MB (no inline content) refuses a Replace import with ZERO writes and an accurate message', async ({ page }) => {
  const gh = await bootOld(page);
  const before = await snapAll(page);
  await pick(page, await oldZip(), 'old');
  gh.hideContent = p => p === 'packages/old/hex_database.json';
  await clickImport(page);
  await conflictModal(page).getByRole('button', { name: 'Replace' }).click();
  await settled(page);
  expect((await status(page)).status).toBe('failed');
  expect(gh.writeLog).toEqual([]);                                       // not even a write that had to be compensated
  await expect(page.locator('#toast-container')).toContainText('1 MB');
  await expect(page.locator('#toast-container')).toContainText('Nothing was written');
  expect(await snapAll(page)).toEqual(before);
});

// ── A8 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('A8: a failed import restores only the imported package: an edit to another package made while it ran survives', async ({ page }) => {
  const gh = await boot(page);
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('Other_1', 'other', { spriteName: 'x', label: 'before' }), hexRec('Plain_edit', 'postapoc', { label: 'before' })]);
  await page.evaluate(() => {
    const o = GitHubSync._putContents;
    GitHubSync._putContents = async (...a: any[]) => {
      if (String(a[0]).endsWith('building_database.json'))
        HexDB.addEntries([{ id: 'Other_1', type: 'Plains', spriteName: 'x', package: 'other', label: 'edited mid-import' }]);
      return o(...a);
    };
  });
  await pick(page, await newZip(), NEW);
  gh.failPut = p => p === REG;
  await clickImport(page);
  await settled(page);
  expect((await status(page)).status).toBe('failed');
  const after = await page.evaluate(() => ({
    other: HexDB.getData().hexes.find((h: any) => h.id === 'Other_1' && h.package === 'other')?.label,
    imported: HexDB.getData().hexes.filter((h: any) => h.package === 'new-pack').length,
    importedB: BldDB.getAll().filter((b: any) => b.package === 'new-pack').length,
  }));
  expect(after).toEqual({ other: 'edited mid-import', imported: 0, importedB: 0 });
});

// ── A6: sprite name and file rules ────────────────────────────────────────────────────────────────────────────────
test('A6: sanitizeSpriteName: trailing dots/spaces, Windows device names, __ internal names, NFC (table)', async ({ page }) => {
  await boot(page);
  const rows: [string, string | null][] = [
    ['Good_1.png', 'Good_1'], ['a.png', 'a'], ['name .png', 'name'], ['dots...png', 'dots'], ['x..y.png', 'xy'],
    ['CON.png', null], ['con', null], ['Prn.png', null], ['AUX.png', null], ['nul.png', null], ['COM1.png', null], ['com9', null], ['LPT1.png', null], ['lpt9.txt', null],
    ['aux.v2.png', null], ['con2.png', 'con2'], ['console.png', 'console'], ['com10.png', 'com10'], ['comx.png', 'comx'],
    ['__preview.png', null], ['__x.png', null], ['_x.png', '_x'], ['a__b.png', 'a__b'],
    ['é.png', 'é'], ['...png', null], ['', null], ['a/b.png', 'b'], ['../../x.png', 'x'], ['a?b#c%d.png', 'a_b_c_d'],
  ];
  const got = await page.evaluate(r => r.map(([n]: any) => Packages.sanitizeSpriteName(n)), rows);
  expect(got).toEqual(rows.map(r => r[1]));
  expect(await page.evaluate(() => ['é', 'CON', '__preview', 'x ', 'ok-1'].map(n => Packages.isSafeSpriteName(n)))).toEqual([false, false, false, false, true]);
});

test('A6: the uploaded-URL registry has no inherited keys (constructor / toString are harmless names)', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    Terrain.registerUploadedUrls({ 'pkg/toString': 'data:x', 'pkg/constructor': 'data:y' });
    return {
      inherited: ['constructor', 'toString', 'hasOwnProperty', 'valueOf'].map(n => Terrain.getUploadedUrl(n) === null),
      inheritedPkg: ['constructor', 'toString'].map(n => Terrain.getUploadedUrl(n, 'other') === null),
      own: [Terrain.getUploadedUrl('toString', 'pkg'), Terrain.getUploadedUrl('constructor', 'pkg')],
    };
  });
  expect(r.inherited).toEqual([true, true, true, true]);
  expect(r.inheritedPkg).toEqual([true, true]);
  expect(r.own).toEqual(['data:x', 'data:y']);
});

test('A6: a file whose size cannot be read from the header is refused without a decode (JPEG SOF past 64 KB, short PNG, unknown WebP)', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async png => {
    let decodes = 0;
    const real = window.createImageBitmap;
    (window as any).createImageBitmap = (...a: any[]) => { decodes++; return (real as any)(...a); };
    const seg = (marker: number, n: number) => { const a = new Uint8Array(n + 4); a[0] = 0xFF; a[1] = marker; a[2] = ((n + 2) >> 8) & 255; a[3] = (n + 2) & 255; return a; };
    const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
    const sof = Uint8Array.from([0xFF, 0xC0, 0, 17, 8, 0, 16, 0, 16, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    const jpeg = cat(Uint8Array.from([0xFF, 0xD8]), seg(0xE0, 60000), seg(0xE1, 60000), sof, new Uint8Array(40));
    const shortPng = Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13]);
    const webp = Uint8Array.from([...'RIFF'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBPABCD'.slice(0, 4)].map(c => c.charCodeAt(0)), [...'ABCD'].map(c => c.charCodeAt(0)), new Array(20).fill(0)));
    const out: any = {};
    for (const [k, bytes, type] of [['jpeg', jpeg, 'image/jpeg'], ['png', shortPng, 'image/png'], ['webp', webp, 'image/webp']] as any)
      out[k] = await Packages.normalizeSpriteFile(new File([bytes], `x.${k}`, { type }));
    out.decodesAfterRefusals = decodes;
    // positive control: a real PNG still passes and IS decoded
    const bin = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    out.good = await Packages.normalizeSpriteFile(new File([bin], 'ok.png', { type: 'image/png' }));
    out.decodesAfterGood = decodes;
    return JSON.parse(JSON.stringify(out));
  }, TINY_PNG.toString('base64'));
  for (const k of ['jpeg', 'png', 'webp']) { expect(r[k].ok, k).toBe(false); expect(r[k].error, k).toMatch(/header/); }
  expect(r.decodesAfterRefusals).toBe(0);
  expect(r.good.ok).toBe(true);
  expect(r.decodesAfterGood).toBe(1);
});

test('A6: an imported sprite with upper-case folder/extension is written under the canonical lower-case path; names that differ only by case are refused', async ({ page }) => {
  const gh = await boot(page);
  const base = { 'package.json': JSON.stringify({ id: 'src', name: 'Src', version: '1.0.0' }),
    'hex_database.json': JSON.stringify({ hexes: [hexRec('Src_A', 'src', { spriteName: 'S1' })] }), 'building_database.json': JSON.stringify({ buildings: [] }) };
  await pick(page, await buildZip({ ...base, 'sprites/HEX/S1.PNG': TINY_PNG }), NEW);
  await clickImport(page);
  await waitForLastWrite(gh, REG);
  await settled(page);
  expect((await status(page)).status).toBe('ok');
  expect(gh.writeLog.map(w => w.path).filter(p => p.includes('/sprites/'))).toEqual([`${P}/sprites/hex/S1.png`]);
  expect(await page.evaluate(async () => (await SpriteStore.loadForPackage('new-pack')).map((e: any) => [e.name, e.category]))).toEqual([['S1', 'hex']]);
  await page.evaluate(() => Packages.closeImportModal());
  const errs = await importErrors(page, await buildZip({ ...base, 'sprites/hex/A.png': TINY_PNG, 'sprites/hex/a.png': TINY_PNG }));
  expect(errs).toMatch(/used twice/);
  const errs2 = await importErrors(page, await buildZip({ ...base, 'sprites/Hex/a.PNG': TINY_PNG, 'sprites/buildings/A.png': TINY_PNG }));
  expect(errs2).toMatch(/used twice/);
});

// ── A7 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function setupPp(page: Page, gh: FakeGitHub, version: string, pkg: object = {}) {
  gh.setRegistry([{ id: 'pp', name: 'PP', version }]);
  gh.setJson('packages/pp/package.json', { id: 'pp', name: 'PP', version, description: 'd', isDefault: false, ...pkg });
  await boot(page, gh);
  await page.waitForFunction(() => !!Packages.getEntry('pp'));
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('Pp_A', 'pp')]);
}

test('A7: nextVersion bumps the numeric core of a pre-release/build version (documented), junk is still refused', async ({ page }) => {
  await boot(page);
  const rows: [string, string, string | null][] = [
    ['1.0.0-beta', 'patch', '1.0.1'], ['1.0.0-beta', 'minor', '1.1.0'], ['1.0.0-beta', 'major', '2.0.0'], ['1.0.0-beta', 'none', '1.0.0'],
    ['1.2.3-beta.1', 'patch', '1.2.4'], ['1.2.3+b5', 'patch', '1.2.4'], ['1.2.3-rc.1+b5', 'minor', '1.3.0'],
    ['1.2.3-', 'patch', null], ['1.2.3-be ta', 'patch', null], ['v1.2.3-beta', 'patch', null], ['1.2.3-beta', 'huge', null],
  ];
  expect(await page.evaluate(r => r.map(([v, b]: any) => Packages.nextVersion(v, b)), rows)).toEqual(rows.map(r => r[2]));
});

test('A7: a pre-release version on the server does not block publish; the bump is computed from its numeric core', async ({ page }) => {
  const gh = new FakeGitHub();
  await setupPp(page, gh, '1.0.0-beta');
  const r = await page.evaluate(() => Packages.publishPackage('pp', { bump: 'patch' }));
  expect(r).toEqual({ ok: true, version: '1.0.1' });
  expect(gh.json('packages/pp/package.json').version).toBe('1.0.1');
  expect(gh.json(REG).packages.find((p: any) => p.id === 'pp').version).toBe('1.0.1');
});

test('A7: Merge/Replace import keeps the ZIP version and the changelog of the server package.json', async ({ page }) => {
  const gh = new FakeGitHub(); seedOld(gh);
  const log = [{ version: '1.0.0', date: '2026-01-01', note: 'first' }, { version: '1.2.3', date: '2026-02-02', note: 'second' }];
  gh.setJson('packages/old/package.json', { id: 'old', name: 'Old Pack', version: '1.2.3', description: '', isDefault: false, changelog: log });
  await boot(page, gh);
  await page.waitForFunction(() => !!Packages.getEntry('old'));
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('Old_Tile', 'old', { spriteName: 'S1' })]);
  await pick(page, await packageZip('old', 'Old Pack', { hexes: [hexRec('Old_Two', 'old')], version: '2.0.0' }), 'old');
  await clickImport(page);
  await conflictModal(page).getByRole('button', { name: 'Merge' }).click();
  await waitForLastWrite(gh, REG);
  await settled(page);
  expect((await status(page)).status).toBe('ok');
  const pj = gh.json('packages/old/package.json');
  expect(pj.version).toBe('2.0.0');
  expect(pj.changelog).toEqual(log);
  expect(gh.json(REG).packages.find((p: any) => p.id === 'old').version).toBe('2.0.0');
});

test('A7: two tabs: saving details re-reads the stored copy, so another tab\'s edit to a different package survives', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'pp', name: 'PP' }, { id: 'qq', name: 'QQ' }]);
  await boot(page, gh);
  await page.waitForFunction(() => !!Packages.getEntry('qq'));
  await page.evaluate(() => { Packages.updateDetails('pp', { description: 'first' }); });          // loads the cache
  await page.evaluate(() => localStorage.setItem('pkg_details', JSON.stringify({ pp: { description: 'first' }, qq: { description: 'from the other tab' } })));
  await page.evaluate(() => { Packages.updateDetails('pp', { description: 'second' }); });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pkg_details')!))).toEqual({ pp: { description: 'second' }, qq: { description: 'from the other tab' } });
});

test('A7: Escape cannot close the publish dialog while a publish runs; it closes normally afterwards', async ({ page }) => {
  const gh = new FakeGitHub();
  await setupPp(page, gh, '1.0.0');
  await page.evaluate(() => {
    (window as any).__gate = new Promise(r => { (window as any).__open = r; });
    const o = GitHubSync._putText;
    GitHubSync._putText = async (...a: any[]) => { await (window as any).__gate; return o(...a); };
  });
  await page.evaluate(() => { Packages.openPublishConfirm('pp'); });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.locator('#pub-dialog')).toBeVisible();
  await page.getByRole('button', { name: /Publish (now|anyway)/ }).click();
  await expect(page.locator('#pub-status')).toContainText('Publishing');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pub-modal')).toBeVisible();                      // positive: still open mid-publish
  await page.evaluate(() => (window as any).__open());
  await expect(page.locator('#pub-modal')).toHaveCount(0);                     // closed by the successful publish
  expect(gh.json('packages/pp/package.json').version).toBe('1.0.1');
  // idle dialog: Escape still closes it
  await page.evaluate(() => { Packages.openPublishConfirm('pp'); });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.locator('#pub-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pub-modal')).toHaveCount(0);
});

test('A7: saving details is all-or-nothing: a failing preview store leaves the details unsaved and the dialog open', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'pp', name: 'PP' }]);
  await boot(page, gh);
  await page.waitForFunction(() => !!Packages.getEntry('pp'));
  await page.evaluate(() => Packages.openDetails('pp'));
  await page.fill('#pkg-det-desc', 'new description');
  await page.setInputFiles('#pkg-det-preview', { name: 'p.png', mimeType: 'image/png', buffer: TINY_PNG });
  await expect(page.locator('#pkg-det-preview-img')).toBeVisible();
  await page.evaluate(() => { SpriteStore.save = async () => { throw new Error('quota exceeded'); }; });
  await page.locator('#pkg-details-modal').getByRole('button', { name: 'Save details' }).click();
  await expect(page.locator('#pkg-det-error')).toContainText('quota exceeded');
  await expect(page.locator('#pkg-details-modal')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pkg_details'))).toBeNull();
  expect(await page.evaluate(() => Packages.getDetails('pp').description)).toBe('');
});

test('A7: publishing a local-only package refuses when the server gained that id after the id check', async ({ page }) => {
  const gh = await boot(page, new FakeGitHub(), false);
  await page.evaluate(() => Packages.openNewModal());
  await page.fill('#pkg-new-name', 'Loc Pack');
  await page.fill('#pkg-new-id', 'loc-pack');
  await page.locator('#pkg-new-modal').getByRole('button', { name: 'Create' }).click();
  await page.waitForFunction(() => !!Packages.getEntry('loc-pack'));
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('LocPack_A', 'loc-pack')]);
  await page.evaluate(() => GitHubSync.setPAT('test-token'));
  let seen = 0;
  gh.failGet = p => {
    if (p === 'packages/loc-pack/package.json' && ++seen === 2) {   // 1st = the id check, 2nd = the publish's own read
      gh.setJson(p, { id: 'loc-pack', name: 'Strangers', version: '9.0.0' });
      gh.setRegistry([{ id: 'loc-pack', name: 'Strangers', version: '9.0.0' }]);
    }
    return false;
  };
  const r = await page.evaluate(() => Packages.publishPackage('loc-pack', { bump: 'patch' }));
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/already exists/);
  expect(gh.writeLog).toEqual([]);
  expect(gh.json('packages/loc-pack/package.json').name).toBe('Strangers');
});

test('A7: the publish cycle check uses the server graph and only this package\'s local details (a local edit of ANOTHER package cannot block it)', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'aa', name: 'AA' }, { id: 'pp', name: 'PP' }]);
  gh.setJson('packages/pp/package.json', { id: 'pp', name: 'PP', version: '1.0.0', dependencies: ['aa'], isDefault: false });
  await boot(page, gh);
  await page.waitForFunction(() => !!Packages.getEntry('aa'));
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('Pp_A', 'pp')]);
  // local-only edit of the OTHER package: aa -> pp (valid locally: pp has no local dependencies)
  expect(await page.evaluate(() => Packages.updateDetails('aa', { dependencies: ['pp'] }))).toBe(true);
  const r = await page.evaluate(() => Packages.publishPackage('pp', { bump: 'patch' }));
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(gh.json('packages/pp/package.json').dependencies).toEqual(['aa']);
  // positive control: a cycle through the SERVER graph is still refused
  gh.setJson('packages/registry.json', { version: 1, packages: [...gh.json(REG).packages.filter((p: any) => p.id !== 'aa'), { id: 'aa', name: 'AA', isDefault: false, version: '1.0.0', dependencies: ['pp'] }] });
  await page.evaluate(() => Packages.refresh ? Packages.refresh() : null);
  const n = gh.writeLog.length;
  const r2 = await page.evaluate(() => Packages.publishPackage('pp', { bump: 'patch' }));
  expect(r2.ok).toBe(false);
  expect(r2.error).toMatch(/cycle/i);
  expect(gh.writeLog.length).toBe(n);
});
