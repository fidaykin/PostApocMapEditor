import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openEditor, FakeGitHub, ROOT } from './helpers';

// Blank out comments and string/template literals (keeping newlines so line numbers stay true).
function stripCommentsAndStrings(src: string): string {
  let out = '', i = 0;
  const blank = (t: string) => t.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; out += blank(src.slice(i, end)); i = end; }
    else if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; out += blank(src.slice(i, end)); i = end; }
    else if (c === '"' || c === "'" || c === '`') {
      let k = i + 1;
      while (k < src.length && src[k] !== c && !(c !== '`' && src[k] === '\n')) { if (src[k] === '\\') k++; k++; }
      out += blank(src.slice(i, k + 1)); i = k + 1;
    } else { out += c; i++; }
  }
  return out;
}

const NATIVE = /(^|[^.\w$])(alert|prompt)\s*\(|\b(window|globalThis|self)\s*\.\s*(alert|prompt)\s*\(/;
for (const file of ['MapEditorPro.html', 'zone-painter.js']) {
  test(`${file} contains no native alert()/prompt()`, () => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const orig = src.split('\n');
    const offenders = stripCommentsAndStrings(src).split('\n')
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(x => NATIVE.test(x.l))
      .map(x => `${file}:${x.n}: ${orig[x.n - 1].trim()}`);
    expect(offenders).toEqual([]);
  });
}

async function editorWithPackage() {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'rk', name: 'Rk' }]);
  return gh;
}

test('a non-JSON map file opens an in-page dialog, not a native alert', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  await page.setInputFiles('#file-input', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{not json') });
  await expect(page.locator('#dialog-title')).toHaveText('Could not read map file');
  await expect(page.locator('#dialog-msg')).toContainText('not valid JSON');
  expect(nativeDialogs).toEqual([]);
});

test('a structurally invalid map shows "Failed to load map"', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  await page.evaluate(() => IO.loadFromJSON({ width: 'x' }));
  await expect(page.locator('#dialog-title')).toHaveText('Failed to load map');
  await expect(page.locator('#dialog-msg')).toContainText('Invalid map file format: width is missing or not a number.');   // T6.3: MapFormat's reasons follow the old prefix
  expect(nativeDialogs).toEqual([]);
});

test('autosave folder without File System Access API shows a dialog', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  await page.evaluate(() => { (window as any).showDirectoryPicker = undefined; IO.setAutosaveFolder(); });
  await expect(page.locator('#dialog-title')).toHaveText('Autosave folder');
  await expect(page.locator('#dialog-msg')).toContainText('not supported');
  expect(nativeDialogs).toEqual([]);
});

test('a duplicate localization key toasts instead of alerting', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  await page.evaluate(() => { LocalizationKeys.add('dup_key', 'a', 'b'); LocalizationKeys.add('dup_key', 'c', 'd'); });
  await expect(page.locator('.toast', { hasText: 'Key "dup_key" already exists' })).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});

test('hex reskin picker is a searchable modal of postapoc ids and adds the reskin', async ({ page }) => {
  const gh = await editorWithPackage();
  const { nativeDialogs } = await openEditor(page, { gh });
  await page.waitForFunction(() => !!Packages.getEntry('rk'));
  await page.evaluate(() => { Packages.setActive('rk'); HexDB.promptReskin(); });
  await expect(page.locator('#reskin-search')).toBeVisible();
  await page.locator('#reskin-search').fill('Plain_2');
  await page.locator('.reskin-item[data-id="Plain_2"]').click();
  await expect.poll(() => page.evaluate(() => HexDB.getAll().some(h => h.id === 'Plain_2' && h.package === 'rk'))).toBe(true);
  expect(nativeDialogs).toEqual([]);
});

test('cancelling the hex reskin picker adds nothing', async ({ page }) => {
  const gh = await editorWithPackage();
  await openEditor(page, { gh });
  await page.waitForFunction(() => !!Packages.getEntry('rk'));
  const before = await page.evaluate(() => { Packages.setActive('rk'); return HexDB.getAll().length; });
  await page.evaluate(() => { HexDB.promptReskin(); });
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => HexDB.getAll().length)).toBe(before);
});

test('building reskin picker is a searchable modal of postapoc ids and adds the reskin', async ({ page }) => {
  const gh = await editorWithPackage();
  const { nativeDialogs } = await openEditor(page, { gh });
  await page.waitForFunction(() => !!Packages.getEntry('rk'));
  const id = await page.evaluate(() => { Packages.setActive('rk'); BldDB.promptReskin(); return BldDB.getAll()[0].id; });
  await expect(page.locator('#reskin-search')).toBeVisible();
  await page.locator('#reskin-search').fill(id);
  await page.locator('.reskin-item').filter({ has: page.locator('.reskin-id', { hasText: id }) }).first().click();
  await expect.poll(() => page.evaluate((i) => BldDB.getAll().some(b => b.id === i && b.package === 'rk'), id)).toBe(true);
  expect(nativeDialogs).toEqual([]);
});

test('Publish Map asks for the file name in a dialog', async ({ page }) => {
  const gh = new FakeGitHub();
  const { nativeDialogs } = await openEditor(page, { gh, pat: true });
  await page.evaluate(() => { GitHubSync.publishMap(); });
  await page.fill('#dialog-input', 'my_map');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(() => gh.putPaths()).toContain('maps/my_map.json');
  expect(nativeDialogs).toEqual([]);
});

test('cancelling the Publish Map dialog uploads nothing', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => { GitHubSync.publishMap(); });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  expect(gh.putPaths().filter(p => p.startsWith('maps/'))).toEqual([]);
  await expect(page.locator('#dialog-modal.open')).toHaveCount(0);
});

test('Save preset asks for the name in a dialog and confirms with a toast', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  await page.evaluate(() => { ZonePainter._uiSavePreset(); });
  await page.fill('#dialog-input', 'My Test Preset');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('.toast', { hasText: 'Preset "My Test Preset" saved' })).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});

test('cancelling the Save preset dialog saves nothing', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  await page.evaluate(() => { ZonePainter._uiSavePreset(); });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  await expect(page.locator('.toast', { hasText: 'saved' })).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).join('|') + JSON.stringify(ZonePainter.getPresets ? ZonePainter.getPresets() : ''))).not.toContain('user_');
  expect(nativeDialogs).toEqual([]);
});

test('Fill Zones with no zones toasts instead of alerting', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  await page.evaluate(() => { ZonePainter._fillAllZones(); });
  await expect(page.locator('.toast', { hasText: 'No zones defined' })).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});
