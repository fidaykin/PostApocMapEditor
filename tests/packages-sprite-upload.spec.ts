import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, seedHexes, hexRec } from './helpers';

async function open(page: Page, gh = new FakeGitHub()) {
  gh.setRegistry([{ id: 'medieval', name: 'Medieval Kingdom' }]);
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => (window as any).__startupSyncDone);
  return gh;
}

/** A solid-colour image encoded by the browser: [r,g,b] at WxH, as PNG or JPEG bytes. */
async function imgBytes(page: Page, w: number, h: number, type: string, rgb = [200, 30, 30]): Promise<Buffer> {
  const b64 = await page.evaluate(([w, h, type, rgb]) => {
    const c = document.createElement('canvas'); c.width = w as number; c.height = h as number;
    const g = c.getContext('2d')!; g.fillStyle = `rgb(${(rgb as number[]).join(',')})`; g.fillRect(0, 0, w as number, h as number);
    return c.toDataURL(type as string, 1).split(',')[1];
  }, [w, h, type, rgb] as const);
  return Buffer.from(b64, 'base64');
}
const upload = (page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) =>
  page.setInputFiles('#sprite-upload-input', files);
const stored = (page: Page, pkg: string) => page.evaluate(p => SpriteStore.loadForPackage(p).then((l: any[]) => l.map(e => e.name).sort()), pkg);
const modal = (page: Page) => page.locator('.ui-modal');
const toasts = (page: Page) => page.locator('#toast-container .toast');

test('normalizeSpriteFile: PNG kept untouched, JPEG converted (pixels checked), junk and oversize rejected before reading', async ({ page }) => {
  await open(page);
  const png = await imgBytes(page, 512, 512, 'image/png');
  const jpg = await imgBytes(page, 64, 64, 'image/jpeg', [200, 30, 30]);
  const r = await page.evaluate(async ([pngB, jpgB]) => {
    const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const mk = (b: Uint8Array, name: string, type: string) => new File([b], name, { type });
    const pngFile = mk(fromB64(pngB as string), 'a.png', 'image/png');
    const nPng = await Packages.normalizeSpriteFile(pngFile);
    const nJpg = await Packages.normalizeSpriteFile(mk(fromB64(jpgB as string), 'b.jpg', 'image/jpeg'));
    const head = new Uint8Array(await nJpg.file.slice(0, 8).arrayBuffer());
    const bmp = await createImageBitmap(nJpg.file);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d')!; g.drawImage(bmp, 0, 0);
    const px = Array.from(g.getImageData(32, 32, 1, 1).data);
    const svg = await Packages.normalizeSpriteFile(mk(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'), 's.png', 'image/png'));
    const svgAsSvg = await Packages.normalizeSpriteFile(mk(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'), 's.svg', 'image/svg+xml'));
    const txt = await Packages.normalizeSpriteFile(mk(new TextEncoder().encode('hello'), 'c.png', 'image/png'));
    const trunc = await Packages.normalizeSpriteFile(mk(fromB64(pngB as string).slice(0, 40), 't.png', 'image/png'));
    // oversize: must be refused from file.size alone, without touching the content
    const big = mk(new Uint8Array(1024), 'big.png', 'image/png');
    Object.defineProperty(big, 'size', { value: 50 * 1024 * 1024 });
    let touched = 0; for (const m of ['arrayBuffer', 'slice', 'stream', 'text']) (big as any)[m] = () => { touched++; throw new Error('read'); };
    const nBig = await Packages.normalizeSpriteFile(big);
    return { nPng: { ok: nPng.ok, converted: nPng.converted, same: nPng.file === pngFile, warnings: nPng.warnings },
      nJpg: { ok: nJpg.ok, converted: nJpg.converted, name: nJpg.file.name, type: nJpg.file.type, head: Array.from(head), warnings: nJpg.warnings, px },
      svg, svgAsSvg, txt, trunc, nBig: { ok: nBig.ok, error: nBig.error, touched } };
  }, [png.toString('base64'), jpg.toString('base64')]);
  expect(r.nPng).toEqual({ ok: true, converted: false, same: true, warnings: [] });
  expect(r.nJpg).toMatchObject({ ok: true, converted: true, name: 'b.png', type: 'image/png' });
  expect(r.nJpg.head).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  expect(r.nJpg.warnings.join(' ')).toContain('512');
  expect(r.nJpg.px[0]).toBeGreaterThan(180); expect(r.nJpg.px[1]).toBeLessThan(60);   // still the red we drew
  for (const k of ['svg', 'svgAsSvg', 'txt', 'trunc'] as const) { expect(r[k].ok, k).toBe(false); expect(r[k].error, k).toBeTruthy(); }
  expect(r.svgAsSvg.error).toContain('SVG');
  expect(r.nBig.ok).toBe(false);
  expect(r.nBig.error).toMatch(/too large/i);
  expect(r.nBig.touched).toBe(0);
});

test('normalizeSpriteFile: dimension cap is read from the PNG header (no decode of a huge bitmap)', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    // minimal PNG header claiming 60000 x 60000 followed by garbage: must be refused on IHDR alone
    const b = new Uint8Array(64);
    b.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, 60000); new DataView(b.buffer).setUint32(20, 60000);
    const orig = window.createImageBitmap; let decoded = 0;
    (window as any).createImageBitmap = (...a: any[]) => { decoded++; return (orig as any)(...a); };
    const res = await Packages.normalizeSpriteFile(new File([b], 'huge.png', { type: 'image/png' }));
    (window as any).createImageBitmap = orig;
    return { ok: res.ok, error: res.error, decoded };
  });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/too large|dimension/i);
  expect(r.decoded).toBe(0);
});

test('sanitizeSpriteName strips paths, dots-dots, control chars, forces a length cap and yields null for nothing', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => ({
    plain: Packages.sanitizeSpriteName('Plain_1.png'),
    path: Packages.sanitizeSpriteName('../../etc/passwd.png'),
    win: Packages.sanitizeSpriteName('C:\\x\\y\\Tile 2.PNG'),
    ctrl: Packages.sanitizeSpriteName('a\u0000b\u001fc\n.png'),
    dots: Packages.sanitizeSpriteName('a..b.png'),
    bad: Packages.sanitizeSpriteName('a<b>:"|?*#%.png'),
    long: Packages.sanitizeSpriteName('x'.repeat(300) + '.png').length,
    empty: Packages.sanitizeSpriteName('...png'),
    onlyExt: Packages.sanitizeSpriteName('.png'),
    nothing: Packages.sanitizeSpriteName('///'),
  }));
  expect(r).toEqual({ plain: 'Plain_1', path: 'passwd', win: 'Tile 2', ctrl: 'abc', dots: 'ab', bad: 'a_b________', long: 64, empty: null, onlyExt: null, nothing: null });
});

test('valid PNG in the default package: stored, registered, pushed once; a bad file stores nothing and says why', async ({ page }) => {
  const gh = await open(page);
  const ok = await imgBytes(page, 512, 512, 'image/png');
  await upload(page, [{ name: 'Fresh_One.png', mimeType: 'image/png', buffer: ok }]);
  await expect.poll(() => stored(page, 'postapoc')).toEqual(['Fresh_One']);
  const rec = await page.evaluate(async () => (await SpriteStore.loadForPackage('postapoc'))[0]);
  expect(rec.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  expect(await page.evaluate(() => Terrain.getUploadedUrl('Fresh_One', 'postapoc'))).toBe(rec.dataUrl);
  await expect.poll(() => gh.putPaths()).toContain('packages/postapoc/sprites/hex/Fresh_One.png');
  const puts = gh.putPaths().filter(p => p.includes('Fresh_One')).length;

  await upload(page, [{ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not an image at all') }]);
  await expect(toasts(page).filter({ hasText: 'notes' }).first()).toBeVisible();
  expect(await stored(page, 'postapoc')).toEqual(['Fresh_One']);           // nothing from the bad file
  expect(gh.putPaths().filter(p => p.includes('Fresh_One')).length).toBe(puts);
  expect(gh.putPaths().some(p => p.includes('notes'))).toBe(false);
});

test('upload while a package is active: JPEG converted to PNG, stored under that package, not pushed', async ({ page }) => {
  const gh = await open(page);
  await page.evaluate(() => Packages.setActive('medieval'));
  const jpg = await imgBytes(page, 64, 64, 'image/jpeg');
  await upload(page, [{ name: 'tile_conv.jpg', mimeType: 'image/jpeg', buffer: jpg }]);
  await expect.poll(() => stored(page, 'medieval')).toEqual(['tile_conv']);
  const rec = await page.evaluate(async () => (await SpriteStore.loadForPackage('medieval'))[0]);
  expect(rec.dataUrl.startsWith('data:image/png')).toBe(true);
  expect(await page.evaluate(() => Terrain.getUploadedUrl('tile_conv', 'medieval'))).toBe(rec.dataUrl);
  expect(await stored(page, 'postapoc')).toEqual([]);
  expect(gh.putPaths().filter(p => p.includes('tile_conv'))).toEqual([]);
});

test.describe('collisions', () => {
  const seed = (page: Page, pkg: string, name = 'Dup', data = 'data:image/png;base64,OLD') =>
    page.evaluate(async ([p, n, d]) => { await SpriteStore.save(n, d, 'hex', p); Terrain.registerUploadedUrls({ [SpriteStore.keyFor(p, n)]: d }); }, [pkg, name, data]);
  const dataOf = (page: Page, pkg: string, name: string) =>
    page.evaluate(async ([p, n]) => (await SpriteStore.loadForPackage(p)).find((e: any) => e.name === n)?.dataUrl ?? null, [pkg, name]);

  test('same name in the target package asks; Cancel and Escape keep the old sprite, Replace replaces, Keep both adds a suffix', async ({ page }) => {
    const gh = await open(page);
    await page.evaluate(() => Packages.setActive('medieval'));
    await seed(page, 'medieval');
    const png = await imgBytes(page, 512, 512, 'image/png');
    const f = [{ name: 'Dup.png', mimeType: 'image/png', buffer: png }];

    await upload(page, f);
    await expect(modal(page)).toHaveCount(1);
    await expect(modal(page)).toContainText('Dup');
    await expect(modal(page).getByRole('button')).toHaveText(['Replace', 'Keep both', 'Cancel']);
    expect(await dataOf(page, 'medieval', 'Dup')).toBe('data:image/png;base64,OLD');          // nothing written while asking
    await modal(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(await dataOf(page, 'medieval', 'Dup')).toBe('data:image/png;base64,OLD');

    await upload(page, f);
    await expect(modal(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);
    expect(await stored(page, 'medieval')).toEqual(['Dup']);
    expect(await dataOf(page, 'medieval', 'Dup')).toBe('data:image/png;base64,OLD');

    await upload(page, f);
    await modal(page).getByRole('button', { name: 'Keep both' }).click();
    await expect.poll(() => stored(page, 'medieval')).toEqual(['Dup', 'Dup_2']);
    expect(await dataOf(page, 'medieval', 'Dup')).toBe('data:image/png;base64,OLD');
    expect((await dataOf(page, 'medieval', 'Dup_2'))!.startsWith('data:image/png;base64,iVBOR')).toBe(true);

    await upload(page, f);
    await modal(page).getByRole('button', { name: 'Replace' }).click();
    await expect.poll(async () => (await dataOf(page, 'medieval', 'Dup'))!.startsWith('data:image/png;base64,iVBOR')).toBe(true);
    expect(await stored(page, 'medieval')).toEqual(['Dup', 'Dup_2']);
    expect(gh.putPaths().filter(p => p.includes('Dup'))).toEqual([]);                        // package uploads are never pushed
  });

  test('a base sprite referenced only by the database (not in IndexedDB) also counts as existing in the default package', async ({ page }) => {
    await open(page);
    await seedHexes(page, [hexRec('Base_1', 'postapoc', { spriteName: 'Base_Sprite' })]);
    const r = await page.evaluate(async () => ({
      db: await Packages.checkSpriteName('postapoc', 'Base_Sprite', 'hex'),
      otherCat: await Packages.checkSpriteName('postapoc', 'Base_Sprite', 'buildings'),
      fresh: await Packages.checkSpriteName('postapoc', 'Brand_New', 'hex'),
    }));
    expect(r.db).toEqual({ collides: 'self' });
    expect(r.otherCat).toEqual({ collides: null });
    expect(r.fresh).toEqual({ collides: null });
  });

  test('a package upload named like a base sprite is allowed, warned, and does not touch the base copy', async ({ page }) => {
    await open(page);
    await seed(page, 'postapoc', 'Base_1', 'data:image/png;base64,BASE');
    expect(await page.evaluate(() => Packages.checkSpriteName('medieval', 'Base_1', 'hex'))).toEqual({ collides: 'postapoc' });
    await page.evaluate(() => Packages.setActive('medieval'));
    await upload(page, [{ name: 'Base_1.png', mimeType: 'image/png', buffer: await imgBytes(page, 512, 512, 'image/png') }]);
    await expect.poll(() => stored(page, 'medieval')).toEqual(['Base_1']);
    expect(await dataOf(page, 'postapoc', 'Base_1')).toBe('data:image/png;base64,BASE');
    await expect(toasts(page).filter({ hasText: 'postapoc' }).first()).toBeVisible();
  });
});

test('multi-file upload is sequential and ends with one summary toast (good, bad, converted)', async ({ page }) => {
  await open(page);
  await page.evaluate(() => Packages.setActive('medieval'));
  await upload(page, [
    { name: 'm_a.png', mimeType: 'image/png', buffer: await imgBytes(page, 512, 512, 'image/png') },
    { name: 'm_bad.png', mimeType: 'image/png', buffer: Buffer.from('nope') },
    { name: 'm_c.jpg', mimeType: 'image/jpeg', buffer: await imgBytes(page, 512, 512, 'image/jpeg') },
  ]);
  await expect.poll(() => stored(page, 'medieval')).toEqual(['m_a', 'm_c']);
  await expect(toasts(page).filter({ hasText: /2 uploaded.*1 (skipped|failed)/ })).toHaveCount(1);
});

test('migrate hex to building keeps the sprite in the hex package namespace', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    Packages.setActive('medieval');
    await SpriteStore.save('Mig_Sprite', 'data:image/png;base64,MIG', 'hex', 'medieval');
    HexDB.add();
    const h = HexDB.getData().hexes[HexDB.getData().hexes.length - 1];
    h.spriteName = 'Mig_Sprite';
    UI.showConfirm = (_t: string, _m: string, cb: () => void) => cb();
    HexDB.migrateToBuilding();
  });
  // the store key is the name alone (no category), so the building copy replaces the hex copy: one record
  await expect.poll(async () => (await page.evaluate(async () => (await SpriteStore.loadForPackage('medieval')).map((e: any) => e.category).join()))).toBe('buildings');
  const r = await page.evaluate(async () => ({
    med: (await SpriteStore.loadForPackage('medieval')).map((e: any) => `${e.category}:${e.dataUrl}`).sort(),
    base: (await SpriteStore.loadForPackage('postapoc')).length,
  }));
  expect(r.med).toEqual(['buildings:data:image/png;base64,MIG']);
  expect(r.base).toBe(0);
  expect(await page.evaluate(() => BldDB.getAll().filter((b: any) => b.spriteName === 'Mig_Sprite').map((b: any) => b.package))).toEqual(['medieval']);
});
