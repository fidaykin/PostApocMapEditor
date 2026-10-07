import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import { openEditor, reloadEditor, FakeGitHub, readZip, packageZip, hexRec, dataUrl, TINY_PNG, seedServerPackage, waitForLastWrite } from './helpers';

// T5.10: package details (description, dependencies, 512x512 preview). The LOCAL description/dependencies override the
// server's; published as preview.png + package.json (written LAST); exported and imported; panel shows summary/warnings.

const REG = 'packages/registry.json';
const PJ = (id: string) => `packages/${id}/package.json`;

function fakeWith(pkgs: any[]) {
  const gh = new FakeGitHub();
  gh.setRegistry(pkgs as any);
  for (const p of pkgs) gh.setJson(PJ(p.id), { id: p.id, name: p.name, version: p.version ?? '1.0.0', description: p.srvDesc ?? '', isDefault: false });
  return gh;
}
async function boot(page: Page, gh: FakeGitHub, want = 'a') {
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.waitForFunction(id => !!Packages.getEntry(id), want);
  await page.evaluate(h => HexDB.addEntries(h), [hexRec('A_One', 'a', { spriteName: 'S1' })]);
  await page.evaluate(d => SpriteStore.save('S1', d, 'hex', 'a'), dataUrl(TINY_PNG));
}
const ABC = () => fakeWith([{ id: 'a', name: 'Alpha', version: '1.2.3', srvDesc: 'server words' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma', version: '2.0.0' }]);

async function png(page: Page, w: number, h: number): Promise<Buffer> {
  const d = await page.evaluate(([w, h]) => { const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d')!; x.fillStyle = '#f00'; x.fillRect(0, 0, w / 2, h); x.fillStyle = '#00f'; x.fillRect(w / 2, 0, w / 2, h); return c.toDataURL('image/png'); }, [w, h]);
  return Buffer.from(d.split(',')[1], 'base64');
}
async function dims(page: Page, dataUrlStr: string) {
  return page.evaluate(async u => { const b = await createImageBitmap(await (await fetch(u)).blob()); return [b.width, b.height]; }, dataUrlStr);
}

test('validateDetails table: ranges, self, duplicates, caps, prototype ids, cycles, unknown packages', async ({ page }) => {
  await boot(page, ABC());
  await page.evaluate(() => Packages.updateDetails('b', { dependencies: ['c'] }));
  const rows: [string, any, string[] | null][] = [
    // [label, details for 'a', expected normalized deps or null when rejected]
    ['plain', { dependencies: ['b'] }, ['b']],
    ['caret', { dependencies: ['b@^1.2.3'] }, ['b@^1.2.3']],
    ['exact', { dependencies: ['b@1.0.0'] }, ['b@1.0.0']],
    ['unknown allowed (warning)', { dependencies: ['zzz'] }, ['zzz']],
    ['self', { dependencies: ['a'] }, null],
    ['self with range', { dependencies: ['a@^1.0.0'] }, null],
    ['postapoc is implicit', { dependencies: ['postapoc'] }, null],
    ['duplicate', { dependencies: ['b', 'b@^1.0.0'] }, null],
    ['bad range ~', { dependencies: ['b@~1.2.3'] }, null],
    ['bad range x', { dependencies: ['b@1.x'] }, null],
    ['bad range empty', { dependencies: ['b@'] }, null],
    ['bad range wide', { dependencies: ['b@>=1.0.0'] }, null],
    ['bad range padded zero', { dependencies: ['b@^01.2.3'] }, null],
    ['uppercase id', { dependencies: ['Bee'] }, null],
    ['proto id', { dependencies: ['__proto__'] }, null],
    ['constructor id', { dependencies: ['constructor'] }, null],
    ['prototype id', { dependencies: ['prototype@^1.0.0'] }, null],
    ['not a string', { dependencies: [{ id: 'b' }] }, null],
    ['null item', { dependencies: [null] }, null],
    ['not an array', { dependencies: 'b' }, null],
    ['huge list', { dependencies: Array.from({ length: 21 }, (_, i) => 'p' + i) }, null],
    ['long id', { dependencies: ['x'.repeat(65)] }, null],
    ['cycle a->b->c->a', { dependencies: ['b'] }, ['b']],   // b->c already; c->a added below
    ['description too long', { description: 'x'.repeat(501), dependencies: [] }, null],
    ['description not text', { description: 42, dependencies: [] }, null],
  ];
  const got = await page.evaluate(rs => rs.map(([, d]: any) => { const r = Packages.validateDetails('a', d); return { ok: r.ok, deps: r.ok ? r.dependencies : null, errs: r.errors.length }; }), rows);
  rows.forEach(([label, , want], i) => {
    expect(got[i].ok, label).toBe(want !== null);
    if (want) expect(got[i].deps, label).toEqual(want);
    else expect(got[i].errs, label).toBeGreaterThan(0);
  });
  // a cycle needs the graph: c -> a makes a -> b -> c -> a
  await page.evaluate(() => Packages.updateDetails('c', { dependencies: ['a'] }));
  const cyc = await page.evaluate(() => Packages.validateDetails('a', { dependencies: ['b'] }));
  expect(cyc.ok).toBe(false);
  expect(cyc.errors.join(' ')).toContain('a → b → c → a');
  // warning for an unknown package, none for a known one
  const w = await page.evaluate(() => [Packages.validateDetails('b', { dependencies: ['zzz'] }).warnings.length, Packages.validateDetails('b', { dependencies: ['a'] }).warnings.length]);
  expect(w[0]).toBeGreaterThan(0);
  expect(w[1]).toBe(0);
  // the prototype was never polluted
  expect(await page.evaluate(() => ({} as any).polluted === undefined && Object.keys(Object.prototype).length === 0)).toBe(true);
});

test('cycle detection and dependency resolution; a rejected update leaves state unchanged', async ({ page }) => {
  await boot(page, ABC());
  const r = await page.evaluate(() => ({
    cycle: Packages.findDependencyCycle({ a: ['b'], b: ['c'], c: ['a'] }),
    none: Packages.findDependencyCycle({ a: ['b'], b: [], c: ['a'] }),
    selfLoop: Packages.findDependencyCycle({ a: ['a'] }),
    proto: Packages.findDependencyCycle(JSON.parse('{"__proto__": ["x"], "constructor": []}')),
  }));
  expect(r.cycle).toEqual(['a', 'b', 'c', 'a']);
  expect(r.none).toBeNull();
  expect(r.selfLoop).toEqual(['a', 'a']);
  expect(r.proto).toBeNull();

  expect(await page.evaluate(() => Packages.updateDetails('a', { description: 'Castles', dependencies: ['b@^1.0.0'] }))).toBe(true);
  expect(await page.evaluate(() => Packages.updateDetails('b', { dependencies: ['c'] }))).toBe(true);
  expect(await page.evaluate(() => Packages.updateDetails('c', { description: 'changed?', dependencies: ['a'] }))).toBe(false);   // c->a->b->c
  const after = await page.evaluate(() => ({ c: Packages.getDependencies('c'), desc: Packages.getDetails('c').description, order: Packages.resolveWithDependencies(['a']) }));
  expect(after.c).toEqual([]);
  expect(after.desc).toBe('');                       // the failed update changed nothing, description included
  expect(after.order).toEqual(['c', 'b', 'a']);       // dependencies first
  expect(await page.evaluate(() => Packages.updateDetails('postapoc', { description: 'x' }))).toBe(false);
});

test('details dialog: edit, validation message, persistence across reload, panel summary, XSS as text', async ({ page }) => {
  const gh = fakeWith([{ id: 'a', name: 'Alpha' }, { id: 'b', name: '<img src=x onerror=window.__xss=1>' }, { id: 'c', name: 'Gamma' }]);
  await boot(page, gh);
  await page.click('#tab-packages');
  await page.locator('tr[data-pkg="a"]').getByRole('button', { name: 'Details' }).click();
  await expect(page.locator('#pkg-details-modal')).toBeVisible();
  await page.fill('#pkg-det-desc', 'Castles <b>and</b> <img src=x onerror=window.__xss=1>');
  await page.locator('.pkg-det-dep[value="b"]').check();
  await page.locator('.pkg-det-range[data-dep="b"]').fill('^bad');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.locator('#pkg-det-error')).toContainText('range');
  await expect(page.locator('#pkg-details-modal')).toBeVisible();          // stays open on an error
  await page.locator('.pkg-det-range[data-dep="b"]').fill('^1.0.0');
  await page.fill('#pkg-det-extra', 'not-installed');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.locator('#pkg-details-modal')).toHaveCount(0);
  expect(await page.evaluate(() => Packages.getDependencies('a'))).toEqual(['b@^1.0.0', 'not-installed']);

  const row = page.locator('tr[data-pkg="a"]');
  await expect(row.locator('.pkg-desc')).toContainText('Castles <b>and</b>');
  await expect(row.locator('.pkg-desc img, .pkg-desc b')).toHaveCount(0);
  await expect(row.locator('.pkg-deps')).toContainText('not-installed');
  await expect(row.locator('.pkg-dep-warn')).toContainText('not-installed');          // missing dependency warning
  await expect(row.locator('.pkg-dep-warn')).not.toContainText('Beta');
  // the link to an installed dependency scrolls to / marks its row
  await row.locator('.pkg-dep-link[data-pkg-link="b"]').click();
  await expect(page.locator('tr[data-pkg="b"]')).toHaveClass(/pkg-flash/);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();

  await reloadEditor(page);
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.waitForFunction(() => !!Packages.getEntry('a'));
  expect(await page.evaluate(() => Packages.getDetails('a'))).toMatchObject({ description: 'Castles <b>and</b> <img src=x onerror=window.__xss=1>', dependencies: ['b@^1.0.0', 'not-installed'] });
  await page.click('#tab-packages');
  await expect(page.locator('tr[data-pkg="a"] .pkg-deps')).toContainText('not-installed');
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});

test('version range warning: an installed dependency that does not satisfy the range', async ({ page }) => {
  await boot(page, ABC());
  const r = await page.evaluate(() => ['^1.2.0', '^2.0.0', '1.0.0', '^0.1.0'].map(range => ({ range,
    w: Packages.validateDetails('a', { dependencies: ['c@' + range] }).warnings.length })));
  // c is 2.0.0
  expect(r.map(x => x.w > 0)).toEqual([true, false, true, true]);
});

test('preview: centre-crop to exactly 512x512, bad files rejected, stored per package', async ({ page }) => {
  await boot(page, ABC());
  const wide = await png(page, 800, 300);
  const out = await page.evaluate(async b64 => {
    const f = new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'wide.png', { type: 'image/png' });
    const blob = await Packages.makePreview512(f);
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d')!; x.drawImage(bmp, 0, 0);
    // 800x300 split red|blue at x=400; the centre crop is x in [250,550): red left of centre, blue right
    const px = (a: number, b: number) => Array.from(x.getImageData(a, b, 1, 1).data).slice(0, 3);
    return { w: bmp.width, h: bmp.height, type: blob.type, left: px(10, 256), right: px(500, 256) };
  }, wide.toString('base64'));
  expect(out).toMatchObject({ w: 512, h: 512, type: 'image/png' });
  expect(out.left[0]).toBeGreaterThan(200); expect(out.left[2]).toBeLessThan(60);
  expect(out.right[2]).toBeGreaterThan(200); expect(out.right[0]).toBeLessThan(60);

  const rej = await page.evaluate(async () => {
    const mk = (bytes: BlobPart, name: string, type: string) => new File([bytes], name, { type });
    return Promise.all([
      Packages.savePreview('a', mk('<svg xmlns="http://www.w3.org/2000/svg"/>', 'x.svg', 'image/svg+xml')),
      Packages.savePreview('a', mk('not an image', 'x.png', 'image/png')),
      Packages.savePreview('a', mk(new Uint8Array(5 * 1024 * 1024), 'big.png', 'image/png')),
      Packages.savePreview('postapoc', mk('x', 'x.png', 'image/png')),
    ]);
  });
  expect(rej.map((r: any) => r.ok)).toEqual([false, false, false, false]);
  expect(await page.evaluate(() => Packages.getPreview('a'))).toBeNull();

  const ok = await page.evaluate(async b64 => Packages.savePreview('a', new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'p.png', { type: 'image/png' })), wide.toString('base64'));
  expect(ok.ok).toBe(true);
  const url = await page.evaluate(() => Packages.getPreview('a'));
  expect(await dims(page, url)).toEqual([512, 512]);
  expect(await page.evaluate(() => Packages.getPreview('b'))).toBeNull();
  // JPEG is converted too (T5.4 converter)
  const jpeg = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 700; c.getContext('2d')!.fillRect(0, 0, 300, 700);
    const blob: Blob = await new Promise(r => c.toBlob(b => r(b!), 'image/jpeg')); return Packages.savePreview('b', new File([blob], 'p.jpg', { type: 'image/jpeg' })); });
  expect(jpeg.ok).toBe(true);
  expect(await dims(page, await page.evaluate(() => Packages.getPreview('b')))).toEqual([512, 512]);
});

test('details dialog uploads a preview and the panel row shows it', async ({ page }) => {
  await boot(page, ABC());
  await page.click('#tab-packages');
  await page.locator('tr[data-pkg="a"]').getByRole('button', { name: 'Details' }).click();
  await page.setInputFiles('#pkg-det-preview', { name: 'p.png', mimeType: 'image/png', buffer: await png(page, 640, 480) });
  await expect(page.locator('#pkg-det-preview-img')).toBeVisible();
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.locator('#pkg-details-modal')).toHaveCount(0);
  expect(await dims(page, await page.evaluate(() => Packages.getPreview('a')))).toEqual([512, 512]);
  await expect(page.locator('tr[data-pkg="a"] img.pkg-preview')).toBeVisible();
  // a bad file shows an error and stores nothing
  await page.locator('tr[data-pkg="b"]').getByRole('button', { name: 'Details' }).click();
  await page.setInputFiles('#pkg-det-preview', { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('nope') });
  await expect(page.locator('#pkg-det-error')).toContainText('not a PNG, JPEG or WebP');
  await page.getByRole('button', { name: 'Save details' }).click();
  expect(await page.evaluate(() => Packages.getPreview('b'))).toBeNull();
});

test('publish: preview.png before the registry, package.json LAST; local description/dependencies override the server; bump uses the server base', async ({ page }) => {
  const gh = ABC();
  await boot(page, gh);
  await page.evaluate(() => Packages.updateDetails('a', { description: 'local words', dependencies: ['b@^1.0.0'] }));
  await page.evaluate(async b64 => Packages.savePreview('a', new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'p.png', { type: 'image/png' })), (await png(page, 800, 300)).toString('base64'));
  const r = await page.evaluate(() => Packages.publishPackage('a', { bump: 'minor' }));
  expect(r).toMatchObject({ ok: true, version: '1.3.0' });
  await waitForLastWrite(gh, PJ('a'));
  const order = gh.writeLog.map(w => w.path);
  expect(order[order.length - 1]).toBe(PJ('a'));
  expect(order.indexOf('packages/a/preview.png')).toBeGreaterThan(order.indexOf('packages/a/sprites/hex/S1.png'));
  expect(order.indexOf('packages/a/preview.png')).toBeLessThan(order.indexOf(REG));
  expect(order.indexOf(REG)).toBeLessThan(order.indexOf(PJ('a')));
  const pj = gh.json(PJ('a'));
  expect(pj).toMatchObject({ id: 'a', version: '1.3.0', description: 'local words', dependencies: ['b@^1.0.0'], preview: 'preview.png' });
  const entry = gh.json(REG).packages.find((p: any) => p.id === 'a');
  expect(entry).toMatchObject({ version: '1.3.0', description: 'local words', dependencies: ['b@^1.0.0'] });
  const pv = gh.read('packages/a/preview.png')!;
  expect(pv.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
  expect(pv.readUInt32BE(16)).toBe(512); expect(pv.readUInt32BE(20)).toBe(512);
  // package b was not touched
  expect(gh.writeLog.some(w => w.path.startsWith('packages/b/'))).toBe(false);
});

test('publish refuses before the first write when the details would create a cycle with the SERVER registry', async ({ page }) => {
  const gh = ABC();
  await boot(page, gh);
  // after this editor loaded the registry, someone published b -> a: the local copy knows nothing about it
  const reg = gh.json(REG); reg.packages.find((p: any) => p.id === 'b').dependencies = ['a']; gh.setJson(REG, reg);
  expect(await page.evaluate(() => Packages.updateDetails('a', { dependencies: ['b'] }))).toBe(true);   // fine against the stale local view
  const before = gh.writeLog.length;
  const r = await page.evaluate(() => Packages.publishPackage('a', { bump: 'none' }));
  expect(r.ok).toBe(false);
  expect(r.error).toContain('→');
  expect(gh.writeLog.length).toBe(before);
});

test('publish dialog shows description, dependencies and the preview status as text', async ({ page }) => {
  const gh = ABC();
  await boot(page, gh);
  await page.evaluate(() => Packages.updateDetails('a', { description: '<img src=x onerror=window.__xss=1>', dependencies: ['b', 'nope'] }));
  await page.click('#tab-packages');
  await page.locator('tr[data-pkg="a"]').getByRole('button', { name: 'Publish', exact: true }).click();
  await page.locator('#dialog-modal').getByRole('button', { name: 'Publish', exact: true }).click();     // step one -> two
  const box = page.locator('#pub-details');
  await expect(box).toContainText('<img src=x onerror=window.__xss=1>');
  await expect(box).toContainText('b, nope');
  await expect(box).toContainText('no preview');
  await expect(box.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});

test('export includes preview.png and the details; the ZIP re-validates; import into a fresh editor keeps everything', async ({ page, browser }) => {
  const gh = ABC();
  await boot(page, gh);
  await page.evaluate(() => Packages.updateDetails('a', { description: 'local words', dependencies: ['b@^1.0.0', 'nope'] }));
  await page.evaluate(async b64 => Packages.savePreview('a', new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'p.png', { type: 'image/png' })), (await png(page, 800, 300)).toString('base64'));
  await page.click('#tab-packages');
  const exportBtn = page.locator('tr[data-pkg="a"]').getByRole('button', { name: /Export/ });
  await exportBtn.click();                                   // local entries differ from the server: the warning comes first
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export local' }).click()]);
  const buf = fs.readFileSync((await d.path())!);
  const zip = await readZip(buf);
  expect(Object.keys(zip.files)).toContain('preview.png');
  const pj = JSON.parse(await zip.file('package.json')!.async('text'));
  expect(pj).toMatchObject({ description: 'local words', dependencies: ['b@^1.0.0', 'nope'], preview: 'preview.png' });
  const pv = await zip.file('preview.png')!.async('nodebuffer');
  expect([pv.readUInt32BE(16), pv.readUInt32BE(20)]).toEqual([512, 512]);
  const v = await page.evaluate(async b64 => { const z = await (await Packages._loadJSZip()).loadAsync(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    const p = await Packages.validatePackageZip(z); return { ok: p.ok, errors: p.errors, deps: p.pkg.dependencies, preview: p.preview && [p.preview.width, p.preview.height], ignored: p.ignored }; }, buf.toString('base64'));
  expect(v.errors).toEqual([]);
  expect(v).toMatchObject({ ok: true, deps: ['b@^1.0.0', 'nope'], preview: [512, 512], ignored: [] });

  // fresh editor, empty server: import under a new id
  const ctx = await browser.newContext(); const p2 = await ctx.newPage();
  const gh2 = new FakeGitHub();
  await openEditor(p2, { gh: gh2, pat: true });
  await p2.evaluate(() => (window as any).__startupSyncDone);
  await p2.setInputFiles('#pkg-import-input', { name: 'a.zip', mimeType: 'application/zip', buffer: buf });
  await expect(p2.locator('#pkg-import-modal')).toBeVisible();
  await p2.fill('#pkg-import-id', 'a2');
  await p2.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  await waitForLastWrite(gh2, REG);
  expect(gh2.json(PJ('a2'))).toMatchObject({ id: 'a2', description: 'local words', dependencies: ['b@^1.0.0', 'nope'], preview: 'preview.png' });
  expect(gh2.read('packages/a2/preview.png')!.readUInt32BE(16)).toBe(512);
  expect(gh2.json(REG).packages.find((p: any) => p.id === 'a2')).toMatchObject({ description: 'local words', dependencies: ['b@^1.0.0', 'nope'] });
  await p2.waitForFunction(() => Packages.getDetails('a2').dependencies.length === 2);
  expect(await p2.evaluate(() => Packages.getDetails('a2'))).toMatchObject({ description: 'local words', dependencies: ['b@^1.0.0', 'nope'] });
  expect(await dims(p2, await p2.evaluate(() => Packages.getPreview('a2')))).toEqual([512, 512]);
  await ctx.close();
});

test('import validation: hostile dependencies, description and preview.png', async ({ page }) => {
  await boot(page, ABC());
  const mk = async (pkgExtra: object, extraFiles: Record<string, Buffer | string> = {}) => {
    const { buildZip } = await import('./helpers');
    return buildZip({ 'package.json': JSON.stringify({ id: 'zed', name: 'Zed', version: '1.0.0', ...pkgExtra }),
      'hex_database.json': JSON.stringify({ version: 1, package: 'zed', hexes: [] }), 'building_database.json': JSON.stringify({ version: 1, package: 'zed', buildings: [] }), ...extraFiles });
  };
  const check = (buf: Buffer) => page.evaluate(async b64 => { const z = await (await Packages._loadJSZip()).loadAsync(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    const p = await Packages.validatePackageZip(z); return { ok: p.ok, errors: p.errors.join(' | '), warnings: p.warnings.join(' | '), deps: p.pkg && p.pkg.dependencies, desc: p.pkg && p.pkg.description }; }, buf.toString('base64'));
  const bad = (await Promise.all([
    check(await mk({ dependencies: 'b' })),
    check(await mk({ dependencies: [1] })),
    check(await mk({ dependencies: ['zed'] })),
    check(await mk({ dependencies: ['b@~1.0.0'] })),
    check(await mk({ dependencies: ['__proto__'] })),
    check(await mk({ dependencies: Array.from({ length: 21 }, (_, i) => 'p' + i) })),
    check(await mk({ dependencies: ['b', 'b'] })),
  ]));
  bad.forEach((b, i) => { expect(b.ok, 'bad #' + i).toBe(false); expect(b.errors, 'bad #' + i).toContain('dependenc'); });
  // description longer than the cap is cut, not rejected; a non-text description is ignored with a warning
  const cut = await check(await mk({ description: 'y'.repeat(900) }));
  expect(cut.ok).toBe(true); expect(cut.desc.length).toBe(500);
  expect(await check(await mk({ description: { a: 1 } }))).toMatchObject({ ok: true, warnings: expect.stringContaining('description') });
  // a hostile prototype key inside package.json is still rejected (T5.7 rule)
  expect((await check(await mk(JSON.parse('{"dependencies": [], "__proto__": {"x": 1}}')))).ok).toBe(false);
  // preview.png: valid; not a PNG; too big a header; non-512 is scaled with a warning
  const good = await png(page, 512, 512);
  expect((await check(await mk({}, { 'preview.png': good }))).ok).toBe(true);
  const notPng = await check(await mk({}, { 'preview.png': 'GIF89a nope' }));
  expect(notPng.ok).toBe(false); expect(notPng.errors).toContain('preview.png');
  const huge = Buffer.from(good); huge.writeUInt32BE(5000, 16);
  const hugeR = await check(await mk({}, { 'preview.png': huge }));
  expect(hugeR.ok).toBe(false); expect(hugeR.errors).toContain('preview.png');
  const odd = await check(await mk({}, { 'preview.png': await png(page, 300, 200) }));
  expect(odd.ok).toBe(true); expect(odd.warnings).toContain('preview.png');
});

test('map JSON lists the dependencies of the used packages', async ({ page }) => {
  await boot(page, ABC());
  await page.evaluate(() => { Packages.updateDetails('a', { dependencies: ['b@^1.0.0', 'c'] }); });
  const pk = await page.evaluate(() => { mapData[0] = 'A_One'; const p = JSON.parse(IO.getMapJson()).packages; mapData[0] = null; return p; });
  expect(pk).toEqual(['a', 'b', 'c', 'postapoc']);
  const plain = await page.evaluate(() => JSON.parse(IO.getMapJson()).packages);
  expect(plain).toEqual(['postapoc']);
});
