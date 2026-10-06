import { test, expect } from '@playwright/test';
import { openEditor, FakeGitHub, hexRec, dataUrl, TINY_PNG, waitForLastWrite } from './helpers';

const PKG = 'packages/pp/package.json';

async function setup(page: any, gh: FakeGitHub, opts: { pat?: boolean; pkg?: object } = {}) {
  gh.setRegistry([{ id: 'pp', name: 'PP', version: '1.0.0' }]);
  gh.setJson(PKG, { id: 'pp', name: 'PP', version: '1.2.3', description: 'd', preview: 'p.png', isDefault: false, ...(opts.pkg ?? {}) });
  await openEditor(page, { gh, pat: opts.pat !== false });
  await page.waitForFunction(() => !!Packages.getEntry('pp'));
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('Pp_A', 'pp', { spriteName: 'Have_1' }), hexRec('Pp_B', 'pp', { spriteName: 'Gone_1' }), hexRec('Pp_C', 'pp', { spriteName: 'Srv_1' })]);
  await page.evaluate(d => SpriteStore.save('Have_1', d, 'hex', 'pp'), dataUrl(TINY_PNG));
  gh.write('packages/postapoc/sprites/hex/Srv_1.png', TINY_PNG);
}

async function openDialog(page: any) {
  await page.evaluate(() => { Packages.openPublishConfirm('pp'); });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();     // step one (diff) -> step two
  await expect(page.locator('#pub-dialog')).toBeVisible();
}

test('nextVersion: bump table incl. padded, pre-release and odd versions never yields NaN/undefined', async ({ page }) => {
  await openEditor(page);
  const rows: [string, string, string | null][] = [
    ['1.2.3', 'patch', '1.2.4'], ['1.2.3', 'minor', '1.3.0'], ['1.2.3', 'major', '2.0.0'], ['1.2.3', 'none', '1.2.3'],
    ['1.0', 'patch', '1.0.1'], ['0.0.0', 'major', '1.0.0'], ['9.99.999', 'minor', '9.100.0'],
    ['1.2.3-beta.1', 'patch', null], ['1.2.3+b5', 'patch', null], ['v1.2.3', 'patch', null], ['01.2.3', 'patch', null],
    ['1', 'patch', null], ['1.2.3.4', 'patch', null], ['', 'patch', null], ['abc', 'patch', null], [' 1.2.3', 'patch', null],
    ['1.2.-3', 'patch', null], ['1.2.3', 'huge', null], ['9007199254740991.0.0', 'major', null], ['1.2.9007199254740991', 'patch', null],
  ];
  const got = await page.evaluate(r => r.map(([v, b]: any) => Packages.nextVersion(v, b)), rows);
  expect(got).toEqual(rows.map(r => r[2]));
  const odd = await page.evaluate(() => [null, undefined, 123, {}, ['1.2.3']].map(v => Packages.nextVersion(v as any, 'patch')));
  expect(odd).toEqual([null, null, null, null, null]);
});

test('findMissingSprites: package store and server pools count as present; hostile names are plain text', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.evaluate(() => HexDB.addEntries([{ id: 'Pp_X', type: 'Plains', package: 'pp', spriteName: 'x<img src=x onerror=window.__xss=1>' }]));
  const missing = await page.evaluate(() => Packages.findMissingSprites('pp'));
  expect(missing.map((m: any) => m.name).sort()).toEqual(['Gone_1', 'x<img src=x onerror=window.__xss=1>']);
  expect(missing.every((m: any) => m.category === 'hex')).toBe(true);
});

test('the diff stays step one; the options dialog then lists missing sprites and Cancel writes nothing', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.evaluate(() => HexDB.addEntries([{ id: 'Pp_X', type: 'Plains', package: 'pp', spriteName: 'x<img src=x onerror=window.__xss=1>' }]));
  await page.evaluate(() => { Packages.openPublishConfirm('pp'); });
  await expect(page.locator('#dialog-details')).toContainText('+ hex Pp_A');
  await expect(page.locator('#pub-dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.locator('#pub-dialog')).toBeVisible();
  const list = page.locator('#pub-missing');
  await expect(list).toContainText('hex/Gone_1.png');
  await expect(list).not.toContainText('Have_1');
  await expect(list).not.toContainText('Srv_1');
  await expect(list.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  await expect(page.locator('#pub-bump option')).toHaveText(['Patch: v1.2.4', 'Minor: v1.3.0', 'Major: v2.0.0', 'Keep: v1.2.3']);
  await page.locator('#pub-dialog').locator('xpath=ancestor::*[contains(@class,"modal-box")]').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#pub-dialog')).toHaveCount(0);
  expect(gh.writeLog).toEqual([]);
});

test('publish with a minor bump and a changelog: write order, version, changelog, sprites, modal closes', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh, { pkg: { changelog: [{ version: '1.2.3', date: '2026-01-01', note: 'old' }] } });
  await openDialog(page);
  await page.selectOption('#pub-bump', 'minor');
  await page.fill('#pub-changelog', '  Added <b>tiles</b>  ');
  await page.getByRole('button', { name: 'Publish anyway' }).click();
  await waitForLastWrite(gh, PKG);
  const order = gh.writeLog.map(w => w.path);
  expect(order.at(-1)).toBe(PKG);
  expect(order.indexOf('packages/pp/hex_database.json')).toBeLessThan(order.indexOf('packages/pp/sprites/hex/Have_1.png'));
  expect(order.indexOf('packages/pp/sprites/hex/Have_1.png')).toBeLessThan(order.indexOf('packages/registry.json'));
  expect(order.indexOf('packages/registry.json')).toBeLessThan(order.indexOf(PKG));
  expect(order.some(p => p.includes('Gone_1'))).toBe(false);
  const pkg = gh.json(PKG);
  expect(pkg.version).toBe('1.3.0');
  expect(pkg.description).toBe('d');
  expect(pkg.changelog).toEqual([
    { version: '1.2.3', date: '2026-01-01', note: 'old' },
    { version: '1.3.0', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), note: 'Added <b>tiles</b>' },
  ]);
  expect(gh.json('packages/registry.json').packages.filter((p: any) => p.id === 'pp').map((p: any) => p.version)).toEqual(['1.3.0']);
  await expect(page.locator('#pub-dialog')).toHaveCount(0);
});

test('bump "none" keeps the version; an overlong note is capped; a non-array server changelog is replaced', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh, { pkg: { changelog: 'garbage' } });
  const r = await page.evaluate(() => Packages.publishPackage('pp', { bump: 'none', changelog: 'x'.repeat(900) }));
  expect(r).toMatchObject({ ok: true, version: '1.2.3' });
  const pkg = gh.json(PKG);
  expect(pkg.version).toBe('1.2.3');
  expect(pkg.changelog).toHaveLength(1);
  expect(pkg.changelog[0].note).toHaveLength(500);
  // same version + same note again: no duplicate entry
  await page.evaluate(() => Packages.publishPackage('pp', { bump: 'none', changelog: 'x'.repeat(900) }));
  expect(gh.json(PKG).changelog).toHaveLength(1);
});

test('an invalid bump or an invalid server version aborts with zero writes and a result that says why', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  const r1 = await page.evaluate(() => Packages.publishPackage('pp', { bump: 'bogus' }));
  expect(r1.ok).toBe(false);
  gh.setJson(PKG, { id: 'pp', name: 'PP', version: '1.2.3-beta', description: 'd' });
  const r2 = await page.evaluate(() => Packages.publishPackage('pp'));
  expect(r2.ok).toBe(false);
  expect(r2.error).toContain('1.2.3-beta');
  expect(gh.writeLog).toEqual([]);
});

test('without a token the dialog says so, Publish is disabled, and publishPackage refuses with zero writes', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh, { pat: false });
  await page.evaluate(() => { Packages.openPublishConfirm('pp'); });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.locator('#pub-nopat')).toContainText('token');
  await expect(page.getByRole('button', { name: /^Publish (now|anyway)$/ })).toBeDisabled();
  const r = await page.evaluate(() => Packages.publishPackage('pp'));
  expect(r).toMatchObject({ ok: false });
  expect(r.error).toContain('token');
  expect(gh.writeLog).toEqual([]);
});

test('offline: publishPackage refuses with a clear message and zero writes', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.context().setOffline(true);
  const r = await page.evaluate(() => Packages.publishPackage('pp'));
  await page.context().setOffline(false);
  expect(r.ok).toBe(false);
  expect(r.error).toContain('offline');
  expect(gh.writeLog).toEqual([]);
});

test('a failed registry write shows the error in the modal, publishes nothing as success, and the retry converges', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await openDialog(page);
  gh.failPut = p => p === 'packages/registry.json';
  await page.fill('#pub-changelog', 'note');
  await page.getByRole('button', { name: 'Publish anyway' }).click();
  await expect(page.locator('#pub-error')).toContainText('500');
  await expect(page.locator('#pub-dialog')).toBeVisible();
  await expect(page.locator('#toast-container')).not.toContainText('published');
  expect(gh.json(PKG).version).toBe('1.2.3');                                     // commit marker untouched
  expect(gh.writeLog.some(w => w.path === 'packages/pp/hex_database.json')).toBe(true);   // earlier steps did land
  gh.failPut = () => false;
  await expect(page.getByRole('button', { name: 'Publish anyway' })).toBeEnabled();
  await page.getByRole('button', { name: 'Publish anyway' }).click();
  await waitForLastWrite(gh, PKG);
  expect(gh.json(PKG).version).toBe('1.2.4');                                     // not 1.2.5
  expect(gh.json(PKG).changelog).toHaveLength(1);
  expect(gh.json('packages/registry.json').packages.filter((p: any) => p.id === 'pp')).toHaveLength(1);
  await expect(page.locator('#pub-dialog')).toHaveCount(0);
});

test('a registry changed meanwhile (409) fails the attempt; the retry re-reads the sha and succeeds', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await openDialog(page);
  gh.failPut = p => {                                         // someone else edits the registry after our read
    if (p === 'packages/pp/hex_database.json') gh.setRegistry([{ id: 'pp', name: 'PP', version: '1.0.0' }, { id: 'other', name: 'Other' }]);
    return false;
  };
  await page.getByRole('button', { name: 'Publish anyway' }).click();
  await expect(page.locator('#pub-error')).toContainText('409');
  gh.failPut = () => false;
  await page.getByRole('button', { name: 'Publish anyway' }).click();
  await waitForLastWrite(gh, PKG);
  const ids = gh.json('packages/registry.json').packages.map((p: any) => p.id);
  expect(ids).toEqual(expect.arrayContaining(['other', 'pp']));
  expect(ids.filter((i: string) => i === 'pp')).toHaveLength(1);
});

test('publish cannot run twice concurrently', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  const rs = await page.evaluate(() => Promise.all([Packages.publishPackage('pp'), Packages.publishPackage('pp')]));
  expect(rs.filter((r: any) => r.ok)).toHaveLength(1);
  expect(rs.filter((r: any) => r.busy)).toHaveLength(1);
  expect(gh.writeLog.filter(w => w.path === PKG)).toHaveLength(1);
  expect(gh.json(PKG).version).toBe('1.2.4');
});

test('double-clicking Publish in the dialog publishes once', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await openDialog(page);
  await page.getByRole('button', { name: 'Publish anyway' }).dblclick();
  await waitForLastWrite(gh, PKG);
  expect(gh.writeLog.filter(w => w.path === PKG)).toHaveLength(1);
  expect(gh.json(PKG).version).toBe('1.2.4');
});
