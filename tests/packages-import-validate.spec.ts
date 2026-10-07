import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openEditor, buildZip, packageZip, hexRec, bldRec, TINY_PNG, FakeGitHub, waitForLastWrite, seedHexes, seedServerPackage } from './helpers';

// T5.7: the ZIP is untrusted. It is validated (structure, sizes BEFORE inflating, names, JSON shapes, keys) into a plan
// before anything is written; nothing touches state until the user confirms.

const PICK = (page: Page, buffer: Buffer, name = 'pkg.zip') => {
  if (buffer.length <= 40 * 1024 * 1024) return page.setInputFiles('#pkg-import-input', { name, mimeType: 'application/zip', buffer });
  const f = test.info().outputPath(name);   // Playwright refuses in-memory buffers above 50 MB
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buffer);
  return page.setInputFiles('#pkg-import-input', f);
};

async function boot(page: Page) {
  const gh = new FakeGitHub();
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => (window as any).__startupSyncDone);
  const writes0 = gh.writeLog.length;
  const hex0 = await page.evaluate(() => HexDB.getAll().length);
  const noChange = async () => {
    expect(gh.writeLog.length).toBe(writes0);
    expect(await page.evaluate(() => HexDB.getAll().length)).toBe(hex0);
    expect(await page.evaluate(() => (Packages as any).getImportPlan())).toBeNull();
    await expect(page.locator('#pkg-import-modal')).toBeHidden();
  };
  return { gh, noChange };
}

const errorsText = async (page: Page) => (await page.locator('#pkg-import-errors').innerText());

test('a ZIP without package.json is rejected with the reason and nothing changes', async ({ page }) => {
  const { noChange } = await boot(page);
  await PICK(page, await buildZip({ 'hex_database.json': '{"hexes":[]}' }));
  await expect(page.locator('#pkg-import-errors')).toContainText('missing package.json');
  await noChange();
});

test('empty, corrupted and nested ZIPs', async ({ page }) => {
  const { noChange } = await boot(page);
  await PICK(page, await buildZip({}));
  await expect(page.locator('#pkg-import-errors')).toContainText('missing package.json');
  await page.keyboard.press('Escape');
  await PICK(page, Buffer.from('this is definitely not a zip file'.repeat(20)));
  await expect(page.locator('#pkg-import-errors')).toContainText('not a valid ZIP');
  await page.keyboard.press('Escape');
  // a nested ZIP is never opened: it is ignored and counted
  const inner = await buildZip({ 'package.json': '{}' });
  await PICK(page, await packageZip('nest', 'Nest', {}).then(async b => {
    const JSZip = require('jszip'); const z = await JSZip.loadAsync(b); z.file('inner.zip', inner);
    return z.generateAsync({ type: 'nodebuffer' });
  }));
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
  const plan = await page.evaluate(() => (Packages as any).getImportPlan());
  expect(plan.ignored).toEqual(['inner.zip']);
  await page.evaluate(() => Packages.closeImportModal());
  expect(await page.evaluate(() => (Packages as any).getImportPlan())).toBeNull();
  void noChange;
});

test('unsafe paths, backslashes, odd names and duplicate ids are rejected', async ({ page }) => {
  const { noChange } = await boot(page);
  const cases: Record<string, string> = {
    '../evil.png': 'Unsafe path',
    '/abs.png': 'Unsafe path',
    'sprites\\hex\\x.png': 'Unsafe path',
    'sprites/hex/../../x.png': 'Unsafe path',
    'C:/win.png': 'Unsafe path',
    'sprites/hex/bad\uFFFDname.png': 'Unsafe path',
    'sprites/hex/tab\u0001.png': 'Unsafe path',
  };
  for (const [name, msg] of Object.entries(cases)) {
    await PICK(page, await packageZip('old', 'Old', {}).then(async b => {
      const JSZip = require('jszip'); const z = await JSZip.loadAsync(b); z.file(name, TINY_PNG);
      return z.generateAsync({ type: 'nodebuffer' });
    }));
    await expect(page.locator('#pkg-import-errors'), name).toContainText(msg);
    await page.keyboard.press('Escape');
  }
  await PICK(page, await packageZip('old', 'Old', { hexes: [hexRec('Old_A', 'old'), hexRec('Old_A', 'old')] }));
  expect(await errorsText(page)).toContain('Duplicate entry id "Old_A"');
  await noChange();
});

test('prototype pollution keys at any depth are rejected', async ({ page }) => {
  const { noChange } = await boot(page);
  const payloads = [
    '{"version":1,"hexes":[{"id":"Old_A","__proto__":{"polluted":"yes"}}]}',
    '{"version":1,"hexes":[{"id":"Old_A","meta":{"deep":[{"constructor":{"prototype":{"polluted":"yes"}}}]}}]}',
    '{"version":1,"hexes":[{"id":"Old_A","prototype":1}]}',
  ];
  for (const p of payloads) {
    await PICK(page, await buildZip({ 'package.json': '{"id":"old","name":"Old","version":"1.0.0"}', 'hex_database.json': p }));
    await expect(page.locator('#pkg-import-errors')).toContainText('forbidden key');
    await page.keyboard.press('Escape');
  }
  // a pollution key in package.json is rejected too
  await PICK(page, await buildZip({ 'package.json': '{"id":"old","name":"Old","version":"1.0.0","__proto__":{"polluted":1}}' }));
  await expect(page.locator('#pkg-import-errors')).toContainText('forbidden key');
  expect(await page.evaluate(() => ({} as any).polluted)).toBeUndefined();
  await noChange();
});

test('hostile names are shown as text only; nothing executes', async ({ page }) => {
  await boot(page);
  const evil = '<img src=x onerror="window.__xss=1">';
  await PICK(page, await buildZip({
    'package.json': JSON.stringify({ id: 'old', name: evil, version: '1.0.0', description: evil }),
    'hex_database.json': JSON.stringify({ hexes: [hexRec('Old_A', 'old', { spriteName: 'Missing_1' })] }),   // a hostile spriteName itself is refused (final-wave-a-packages)
    [`sprites/hex/${evil}.txt`]: 'x',
  }));
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
  const s = page.locator('#pkg-import-summary');
  await expect(s).toContainText(evil);                       // literally, as text (ignored file warning)
  expect(await s.locator('img').count()).toBe(0);
  await expect(page.locator('#pkg-import-name')).toHaveValue(evil);
  await page.evaluate(() => Packages.closeImportModal());
  // and the rejection list renders errors as text as well
  const evil2 = '<img src=x onerror=window.__xss=1>';
  await PICK(page, await buildZip({ 'package.json': '{"id":"old","name":"x","version":"1.0.0"}', 'hex_database.json': JSON.stringify({ hexes: [hexRec(evil2, 'old')] }) }));
  await expect(page.locator('#pkg-import-errors')).toContainText(evil2);
  expect(await page.locator('#pkg-import-errors img').count()).toBe(0);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});

test('size caps: oversize claims are refused before inflating, the file cap before reading', async ({ page }) => {
  const { noChange } = await boot(page);
  // a real 5 MB sprite (compresses to a few KB) exceeds the per-sprite cap
  await PICK(page, await packageZip('old', 'Old', { hexes: [hexRec('Old_A', 'old')], sprites: { 'hex/Old_A.png': Buffer.concat([TINY_PNG.subarray(0, 24), Buffer.alloc(5 * 1024 * 1024)]) } }));
  await expect(page.locator('#pkg-import-errors')).toContainText('too large');
  await page.keyboard.press('Escape');
  // a central directory that CLAIMS 1 GB for a small entry (no inflation can have happened to learn that)
  const small = await buildZip({ 'package.json': '{"id":"old","name":"Old","version":"1.0.0"}', 'hex_database.json': '{"hexes":[]}' });
  const sig = small.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  small.writeUInt32LE(0x40000000, sig + 24);
  await PICK(page, small);
  await expect(page.locator('#pkg-import-errors')).toContainText('too large');
  await page.keyboard.press('Escape');
  // total uncompressed size cap: 20 sprites of 3.5 MB each (each under the sprite cap)
  const sprites: Record<string, Buffer> = {};
  const body = Buffer.concat([TINY_PNG.subarray(0, 24), Buffer.alloc(3.5 * 1024 * 1024)]);
  for (let i = 0; i < 20; i++) sprites[`hex/S${i}.png`] = body;
  const JSZip = require('jszip'); const zz = new JSZip();
  zz.file('package.json', '{"id":"old","name":"Old","version":"1.0.0"}');
  for (const [k, v] of Object.entries(sprites)) zz.file('sprites/' + k, v);
  const deflated = await zz.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  expect(deflated.length).toBeLessThan(5 * 1024 * 1024);                 // positive control: the file itself is small
  await PICK(page, deflated);
  await expect(page.locator('#pkg-import-errors')).toContainText('in total');
  await page.keyboard.press('Escape');
  // the file-size cap is applied to the File itself
  await PICK(page, Buffer.alloc(51 * 1024 * 1024), 'huge.zip');
  await expect(page.locator('#pkg-import-errors')).toContainText('too large');
  await page.keyboard.press('Escape');
  await noChange();
});

test('too many files are rejected', async ({ page }) => {
  const { noChange } = await boot(page);
  const files: Record<string, string> = { 'package.json': '{"id":"old","name":"Old","version":"1.0.0"}' };
  for (let i = 0; i < 3001; i++) files[`junk/f${i}.txt`] = '';
  await PICK(page, await buildZip(files));
  await expect(page.locator('#pkg-import-errors')).toContainText('files (limit 3000)');
  await noChange();
});

test('entry and package shape problems are reported', async ({ page }) => {
  const { noChange } = await boot(page);
  await PICK(page, await buildZip({
    'package.json': '{"id":"old","name":"Old","version":"v1"}',
    'hex_database.json': '{"hexes":[{"id":""},[],null,{"id":5},{"id":"Old_A","spriteName":7}]}',
    'building_database.json': '{"buildings":"nope"}',
  }));
  const t = await errorsText(page);
  expect(t).toContain('version');
  expect(t).toContain('no "buildings" array');
  expect(t.match(/not a valid entry|no usable "id"|spriteName/g)!.length).toBeGreaterThanOrEqual(4);
  await page.keyboard.press('Escape');
  await PICK(page, await buildZip({ 'package.json': '{broken', 'hex_database.json': 'also broken' }));
  await expect(page.locator('#pkg-import-errors')).toContainText('not valid JSON');
  await noChange();
});

test('a sprite entry that is not a PNG is rejected', async ({ page }) => {
  await boot(page);
  await PICK(page, await packageZip('old', 'Old', { hexes: [hexRec('Old_A', 'old')], sprites: { 'hex/Old_A.png': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') } }));
  await expect(page.locator('#pkg-import-errors')).toContainText('not a PNG');
});

test('a valid ZIP shows a summary; Cancel writes nothing; Import writes package.json first and the registry last', async ({ page }) => {
  const { gh } = await boot(page);
  const zip = await packageZip('old', 'Old', {
    hexes: [hexRec('Old_A', 'old', { spriteName: 'Spr_A' }), hexRec('Old_B', 'old', { spriteName: 'Gone_1' })],
    buildings: [bldRec('Old_Farm', 'old', { spriteName: 'Farm_Spr' })],
    sprites: { 'hex/Spr_A.png': TINY_PNG, 'buildings/Farm_Spr.png': TINY_PNG },
  });
  const JSZip = require('jszip'); const z = await JSZip.loadAsync(zip); z.file('sprites/hex/notes.txt', 'x');
  const buf = await z.generateAsync({ type: 'nodebuffer' });
  const w0 = gh.writeLog.length;
  await PICK(page, buf);
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
  const s = page.locator('#pkg-import-summary');
  await expect(s).toContainText('2 hex tiles');
  await expect(s).toContainText('1 building');
  await expect(s).toContainText('2 sprites');
  await expect(s).toContainText('Sprite "Gone_1" is referenced but not in the ZIP');
  await expect(s).toContainText('Ignoring unsupported file sprites/hex/notes.txt');
  await expect(page.locator('#pkg-import-id')).toHaveValue('old');
  const plan = await page.evaluate(() => (Packages as any).getImportPlan());
  expect(plan).toMatchObject({ ok: true, errors: [], pkg: { id: 'old', name: 'Old', version: '1.0.0' },
    summary: { hexCount: 2, bldCount: 1, spriteCount: 2, missingSprites: ['Gone_1'], ignoredCount: 1 }, conflict: null });
  expect(plan.sprites.map((x: any) => x.path).sort()).toEqual(['sprites/buildings/Farm_Spr.png', 'sprites/hex/Spr_A.png']);
  // Cancel: nothing written, plan dropped
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Cancel' }).click();
  expect(gh.writeLog.length).toBe(w0);
  expect(await page.evaluate(() => (Packages as any).getImportPlan())).toBeNull();
  // Import
  await PICK(page, buf);
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  await waitForLastWrite(gh, 'packages/registry.json');
  const order = gh.writeLog.slice(w0).map(w => w.path);
  expect(order[0]).toBe('packages/old/package.json');
  expect(order.at(-1)).toBe('packages/registry.json');
  expect(order).toContain('packages/old/sprites/hex/Spr_A.png');
  expect(order.some(p => /notes\.txt/.test(p))).toBe(false);
  expect(await page.evaluate(() => HexDB.getAll().filter(h => h.package === 'old').length)).toBe(2);
});

test('an existing package with the same id is reported as a conflict with new/changed counts', async ({ page }) => {
  const gh = new FakeGitHub();
  seedServerPackage(gh, 'old', { hexes: [hexRec('Old_A', 'old')] });
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => (window as any).__startupSyncDone);
  await seedHexes(page, [hexRec('Old_A', 'old', { type: 'Forest' })]);
  await PICK(page, await packageZip('old', 'Old', { hexes: [hexRec('Old_A', 'old'), hexRec('Old_B', 'old')] }));
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
  await expect(page.locator('#pkg-import-summary')).toContainText('already exists');
  const plan = await page.evaluate(() => (Packages as any).getImportPlan());
  expect(plan.conflict).toMatchObject({ packageId: 'old', hex: { new: 1, changed: 1, same: 0 }, bld: { new: 0, changed: 0, same: 0 } });
});

test('a second ZIP is refused while one is being read or its summary is open', async ({ page }) => {
  await boot(page);
  const b64 = (await packageZip('old', 'Old', { hexes: [hexRec('Old_A', 'old')] })).toString('base64');
  const res = await page.evaluate(async (b) => {
    const mk = () => new File([Uint8Array.from(atob(b), c => c.charCodeAt(0))], 'p.zip');
    const a = Packages._onImportFilePicked(mk());
    const c = Packages._onImportFilePicked(mk());     // while the first is still validating
    await Promise.all([a, c]);
    await Packages._onImportFilePicked(mk());         // while the summary is open
    return document.querySelectorAll('.toast').length;
  }, b64);
  expect(res).toBeGreaterThanOrEqual(1);
  await expect(page.locator('.toast', { hasText: 'already' }).first()).toBeVisible();
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
});
