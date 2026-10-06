import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import { openEditor, FakeGitHub, packageZip, readZip, hexRec, bldRec, dataUrl, TINY_PNG, seedServerPackage, waitForLastWrite } from './helpers';

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
