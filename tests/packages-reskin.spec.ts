import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import { openEditor, FakeGitHub, seedHexes, seedBuildings, hexRec, bldRec, readZip } from './helpers';

async function open(page: Page) {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'medieval', name: 'Medieval Kingdom' }]);
  const { nativeDialogs } = await openEditor(page, { gh, pat: true });
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.evaluate(() => Packages.setActive('medieval'));
  return nativeDialogs;
}
const picker = (page: Page) => page.locator('#reskin-picker-modal');
const items = (page: Page) => page.locator('#reskin-picker-modal .reskin-item');
const ids = (page: Page) => items(page).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.id));
const active = (page: Page) => page.locator('#reskin-picker-modal .reskin-item[aria-selected="true"]');
const modeRadio = (page: Page, m: 'prefix' | 'same') => page.locator(`#reskin-picker-modal [role="radio"][data-mode="${m}"]`);
const ownedBy = (page: Page, id: string, pkg: string) =>
  page.evaluate(([i, p]) => HexDB.getAll().filter((h: any) => h.id === i && (h.package || 'postapoc') === p).length, [id, pkg]);

test('hex reskin: searchable picker (no dialog), filter is case-insensitive, empty state, count', async ({ page }) => {
  const nativeDialogs = await open(page);
  await seedHexes(page, ['Zq_Alpha', 'Zq_Beta', 'Other_Tile'].map(i => hexRec(i, 'postapoc')));
  await page.evaluate(() => { HexDB.promptReskin(); });
  await expect(page.locator('#reskin-search')).toBeFocused();
  await expect(page.locator('#dialog-modal.open')).toHaveCount(0);          // not the shared prompt dialog
  const all = await page.evaluate(() => HexDB.getAll().filter((h: any) => (h.package || 'postapoc') === 'postapoc').length);
  await expect(page.locator('#reskin-count')).toContainText(String(all));

  await page.locator('#reskin-search').fill('ZQ_');
  expect(await ids(page)).toEqual(['Zq_Alpha', 'Zq_Beta']);                  // independent expectation: the seeded names
  await expect(page.locator('#reskin-empty')).toBeHidden();
  await page.locator('#reskin-search').fill('no_such_id_zzz');
  expect(await items(page).count()).toBe(0);
  await expect(page.locator('#reskin-empty')).toBeVisible();
  await page.locator('#reskin-search').fill('');
  expect(await items(page).count()).toBeGreaterThan(2);                      // positive control: clearing shows entries again
  await expect(page.locator('#reskin-empty')).toBeHidden();
  expect(nativeDialogs).toEqual([]);
});

test('clicking an entry makes a prefixed copy: Medieval_ id, active package, base entry untouched; one list entry more', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Zq_Alpha', 'postapoc', { spriteName: 'Zq_Sprite' })]);
  const n0 = await page.evaluate(() => HexDB.getAll().length);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await page.locator('#reskin-search').fill('zq_alpha');
  await items(page).first().click();
  await expect(picker(page)).toHaveCount(0);
  expect(await ownedBy(page, 'Zq_Alpha', 'postapoc')).toBe(1);
  expect(await ownedBy(page, 'Zq_Alpha', 'medieval')).toBe(0);
  expect(await ownedBy(page, 'Medieval_Zq_Alpha', 'medieval')).toBe(1);
  expect(await page.evaluate(() => HexDB.getAll().length)).toBe(n0 + 1);
  expect(await page.evaluate(() => HexDB.getAll().find((h: any) => h.id === 'Medieval_Zq_Alpha').spriteName)).toBe('Zq_Sprite');   // copy of the base
});

test('keyboard: arrows skip disabled entries, Enter picks, Escape closes without reskinning and returns focus', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Zq_A', 'postapoc'), hexRec('Zq_B', 'postapoc'), hexRec('Zq_C', 'postapoc'), hexRec('Medieval_Zq_B', 'medieval')]);
  await page.evaluate(() => App.setMode('hexdb'));
  await page.locator('#hexdb-add-reskin-btn').click();
  await page.locator('#reskin-search').fill('zq_');
  expect(await ids(page)).toEqual(['Zq_A', 'Zq_B', 'Zq_C']);
  await expect(page.locator('#reskin-picker-modal .reskin-item[data-id="Zq_B"]')).toBeDisabled();
  await expect(active(page)).toHaveAttribute('data-id', 'Zq_A');             // first enabled entry is active after a filter
  await page.keyboard.press('ArrowDown');
  await expect(active(page)).toHaveAttribute('data-id', 'Zq_C');             // Zq_B (already reskinned) is skipped
  await page.keyboard.press('ArrowUp');
  await expect(active(page)).toHaveAttribute('data-id', 'Zq_A');

  const n0 = await page.evaluate(() => HexDB.getAll().length);
  await page.keyboard.press('Escape');
  await expect(picker(page)).toHaveCount(0);
  expect(await page.evaluate(() => HexDB.getAll().length)).toBe(n0);
  await expect(page.locator('#hexdb-add-reskin-btn')).toBeFocused();

  await page.locator('#hexdb-add-reskin-btn').click();
  await page.locator('#reskin-search').fill('zq_');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(picker(page)).toHaveCount(0);
  expect(await ownedBy(page, 'Medieval_Zq_C', 'medieval')).toBe(1);
  expect(await ownedBy(page, 'Medieval_Zq_A', 'medieval')).toBe(0);
});

test('an already reskinned entry cannot be picked by click or Enter (no duplicate)', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Zq_B', 'postapoc'), hexRec('Medieval_Zq_B', 'medieval')]);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await page.locator('#reskin-search').fill('zq_b');
  await expect(items(page)).toHaveCount(1);
  await items(page).first().click({ force: true });
  await page.keyboard.press('Enter');
  await expect(picker(page)).toHaveCount(1);
  expect(await ownedBy(page, 'Medieval_Zq_B', 'medieval')).toBe(1);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(picker(page)).toHaveCount(0);
});

test('results are capped, previews load lazily for rendered entries only, narrowing reveals the rest', async ({ page }) => {
  await open(page);
  await seedHexes(page, Array.from({ length: 100 }, (_, i) => hexRec(`Cap_${String(i).padStart(3, '0')}`, 'postapoc')));
  await page.evaluate(() => { HexDB.promptReskin(); });
  await page.locator('#reskin-search').fill('cap_');
  await expect(items(page)).toHaveCount(60);
  await expect(page.locator('#reskin-count')).toContainText('60');
  await expect(page.locator('#reskin-count')).toContainText('100');
  expect(await page.locator('#reskin-picker-modal .reskin-item img[loading="lazy"]').count()).toBe(60);
  await page.locator('#reskin-search').fill('cap_09');
  expect(await ids(page)).toEqual(Array.from({ length: 10 }, (_, i) => `Cap_09${i}`));
});

test('previews show the real sprite (pixel check) and mark a missing sprite', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d')!; g.fillStyle = 'rgb(220,20,20)'; g.fillRect(0, 0, 8, 8);
    Terrain.registerUploadedUrls({ Red_Sp: c.toDataURL('image/png') });
  });
  await seedHexes(page, [hexRec('Zq_Red', 'postapoc', { spriteName: 'Red_Sp' }), hexRec('Zq_Gone', 'postapoc', { spriteName: 'does_not_exist_zz' })]);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await page.locator('#reskin-search').fill('zq_');
  const img = page.locator('.reskin-item[data-id="Zq_Red"] img');
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(8);
  const px = await img.evaluate((i: HTMLImageElement) => {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d')!; g.drawImage(i, 0, 0); return Array.from(g.getImageData(4, 4, 1, 1).data);
  });
  expect(px[0]).toBeGreaterThan(200); expect(px[1]).toBeLessThan(40); expect(px[2]).toBeLessThan(40);
  await expect(page.locator('.reskin-item[data-id="Zq_Gone"]')).toHaveClass(/no-sprite/);
  expect(await page.locator('.reskin-item[data-id="Zq_Red"]').getAttribute('class')).not.toMatch(/no-sprite/);   // negative control
});

test('hostile ids are shown as text only and picked verbatim', async ({ page }) => {
  await open(page);
  const evil = `<img src=x onerror="window.__pwn=1">"'\\`;
  await seedHexes(page, [hexRec(evil, 'postapoc', { spriteName: '' })]);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await page.locator('#reskin-search').fill('onerror');
  await expect(items(page)).toHaveCount(1);
  await expect(items(page).first()).toContainText(evil);
  expect(await page.locator('#reskin-picker-modal img[src="x"]').count()).toBe(0);
  expect(await page.evaluate(() => (window as any).__pwn)).toBeUndefined();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(i => HexDB.getAll().filter((h: any) => h.id === 'Medieval_' + i && h.package === 'medieval').length, evil)).toBe(1);
});

test('building reskin uses the same picker and creates a prefixed copy', async ({ page }) => {
  await open(page);
  await seedBuildings(page, [bldRec('Farm_X', 'postapoc', { buildingCategory: 'Standard', type: 'Ground Building' })]);
  await page.evaluate(() => { BldDB.promptReskin(); });
  await page.locator('#reskin-search').fill('farm_x');
  await expect(items(page)).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(picker(page)).toHaveCount(0);
  expect(await page.evaluate(() => BldDB.getAll().filter((b: any) => b.id === 'Farm_X' || b.id === 'Medieval_Farm_X').map((b: any) => b.id + '@' + (b.package || 'postapoc')).sort())).toEqual(['Farm_X@postapoc', 'Medieval_Farm_X@medieval']);
});

test('with the default package active nothing opens and a toast explains', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { Packages.setActive('postapoc'); HexDB.promptReskin(); });
  await expect(picker(page)).toHaveCount(0);
  await expect(page.locator('#toast-container .toast', { hasText: 'non-default package' }).first()).toBeVisible();
});

const pickFirst = async (page: Page, q: string) => { await page.locator('#reskin-search').fill(q); await page.locator(`#reskin-picker-modal .reskin-item[data-id="${q}"]`).click(); await expect(picker(page)).toHaveCount(0); };
const toastWith = (page: Page, t: string) => page.locator('#toast-container .toast', { hasText: t }).first();

test('Reskin+ default mode is preselected and explained; the prefixed copy is selected and toasted', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Plain_1', 'postapoc', { spriteName: 'Plain_Sp' })]);
  await page.evaluate(() => App.setMode('hexdb'));
  await page.locator('#hexdb-add-reskin-btn').click();
  await expect(page.locator('#reskin-picker-modal [role="radiogroup"]')).toHaveCount(1);
  await expect(modeRadio(page, 'prefix')).toHaveAttribute('aria-checked', 'true');
  await expect(modeRadio(page, 'same')).toHaveAttribute('aria-checked', 'false');
  await pickFirst(page, 'Plain_1');
  expect(await page.evaluate(() => HexDB.getAll().filter((h: any) => h.id === 'Medieval_Plain_1').map((h: any) => h.package))).toEqual(['medieval']);
  expect(await ownedBy(page, 'Plain_1', 'medieval')).toBe(0);
  await expect(toastWith(page, 'Medieval_Plain_1')).toContainText('prefixed copy');
  await expect(page.locator('#hexdb-list .selected, #hexdb-list .active').first()).toContainText('Medieval_Plain_1');
  // the copy keeps the base spriteName and resolves to the base sprite until the package uploads its own
  expect(await page.evaluate(() => {
    Terrain.registerUploadedUrls({ Plain_Sp: 'data:image/png;base64,AAAA' });
    const h = HexDB.getAll().find((x: any) => x.id === 'Medieval_Plain_1');
    return [h.spriteName, Packages.spriteSrc(h, 'hex')];
  })).toEqual(['Plain_Sp', 'data:image/png;base64,AAAA']);
});

test('prefix for a hyphenated package id is PascalCase without the hyphen', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'sci-fi', name: 'Sci Fi' }]);
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.evaluate(() => Packages.setActive('sci-fi'));
  await seedHexes(page, [hexRec('Plain_1', 'postapoc')]);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await pickFirst(page, 'Plain_1');
  expect(await page.evaluate(() => HexDB.getAll().filter((h: any) => h.id === 'SciFi_Plain_1').map((h: any) => h.package))).toEqual(['sci-fi']);
});

test('a base id that already carries the prefix is not prefixed twice', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Medieval_Keep', 'postapoc')]);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await pickFirst(page, 'Medieval_Keep');
  expect(await page.evaluate(() => HexDB.getAll().filter((h: any) => /^(Medieval_)+Medieval_Keep$/.test(h.id) && h.id !== 'Medieval_Keep').length)).toBe(0);
  expect(await ownedBy(page, 'Medieval_Keep', 'medieval')).toBe(1);
});

test('mode (a) collision: nothing is duplicated, a toast says it exists and that entry is selected', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Plain_1', 'postapoc'), hexRec('Medieval_Plain_1', 'medieval')]);
  const n0 = await page.evaluate(() => HexDB.getAll().length);
  await page.evaluate(() => { HexDB.addReskin('Plain_1'); });          // direct call: the picker would have disabled it
  expect(await page.evaluate(() => HexDB.getAll().length)).toBe(n0);
  await expect(toastWith(page, 'Medieval_Plain_1 already exists')).toBeVisible();
  await expect(page.locator('#hexdb-list .selected, #hexdb-list .active').first()).toContainText('Medieval_Plain_1');
});

test('picker: in mode (a) only the prefixed id disables an entry; in mode (b) only the same-id entry does', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Zq_A', 'postapoc'), hexRec('Zq_B', 'postapoc'), hexRec('Medieval_Zq_A', 'medieval'), hexRec('Zq_B', 'medieval')]);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await page.locator('#reskin-search').fill('zq_');
  await expect(page.locator('.reskin-item[data-id="Zq_A"]')).toBeDisabled();
  await expect(page.locator('.reskin-item[data-id="Zq_B"]')).toBeEnabled();
  await modeRadio(page, 'same').click();
  await expect(modeRadio(page, 'same')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.reskin-item[data-id="Zq_A"]')).toBeEnabled();
  await expect(page.locator('.reskin-item[data-id="Zq_B"]')).toBeDisabled();
});

test('mode (b) creates the identical id once, explains it, and refuses a second one', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Plain_1', 'postapoc', { spriteName: 'S' })]);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await expect(page.locator('#reskin-picker-modal')).toContainText('SAME id');
  await expect(page.locator('#reskin-picker-modal')).toContainText('the game will use it instead of the base tile when this package is active');
  await modeRadio(page, 'same').click();
  await pickFirst(page, 'Plain_1');
  expect(await ownedBy(page, 'Plain_1', 'medieval')).toBe(1);
  expect(await ownedBy(page, 'Plain_1', 'postapoc')).toBe(1);
  await expect(toastWith(page, 'same-id override')).toBeVisible();
  const n0 = await page.evaluate(() => HexDB.getAll().length);
  await page.evaluate(() => { HexDB.addReskin('Plain_1', 'same'); });
  expect(await page.evaluate(() => HexDB.getAll().length)).toBe(n0);
  await expect(toastWith(page, 'already exists')).toBeVisible();
  await page.evaluate(() => { HexDB.promptReskin(); });
  await modeRadio(page, 'same').click();
  await page.locator('#reskin-search').fill('Plain_1');
  await expect(page.locator('.reskin-item[data-id="Plain_1"]')).toBeDisabled();
});

test('radio group is keyboard accessible: arrows switch the mode; Escape creates nothing', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Plain_1', 'postapoc')]);
  const n0 = await page.evaluate(() => HexDB.getAll().length);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await modeRadio(page, 'prefix').focus();
  await page.keyboard.press('ArrowRight');
  await expect(modeRadio(page, 'same')).toHaveAttribute('aria-checked', 'true');
  await expect(modeRadio(page, 'same')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(modeRadio(page, 'prefix')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(modeRadio(page, 'same')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(picker(page)).toHaveCount(0);
  expect(await page.evaluate(() => HexDB.getAll().length)).toBe(n0);
});

test('building kind: default prefixed copy, same-id mode, collision', async ({ page }) => {
  await open(page);
  await seedBuildings(page, [bldRec('Farm_X', 'postapoc', { buildingCategory: 'Standard', type: 'Ground Building' })]);
  await page.evaluate(() => { BldDB.promptReskin(); });
  await pickFirst(page, 'Farm_X');
  expect(await page.evaluate(() => BldDB.getAll().filter((b: any) => b.id === 'Medieval_Farm_X').map((b: any) => b.package))).toEqual(['medieval']);
  const n0 = await page.evaluate(() => BldDB.getAll().length);
  await page.evaluate(() => { BldDB.addReskin('Farm_X'); });
  expect(await page.evaluate(() => BldDB.getAll().length)).toBe(n0);
  await expect(toastWith(page, 'Medieval_Farm_X already exists')).toBeVisible();
  await page.evaluate(() => { BldDB.addReskin('Farm_X', 'same'); });
  expect(await page.evaluate(() => BldDB.getAll().filter((b: any) => b.id === 'Farm_X' && b.package === 'medieval').length)).toBe(1);
  await page.evaluate(() => { BldDB.addReskin('Farm_X', 'same'); });
  expect(await page.evaluate(() => BldDB.getAll().filter((b: any) => b.id === 'Farm_X' && b.package === 'medieval').length)).toBe(1);
});

test('default package active: both modes refuse with the toast', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Plain_1', 'postapoc')]);
  const n0 = await page.evaluate(() => { Packages.setActive('postapoc'); return HexDB.getAll().length; });
  await page.evaluate(() => { HexDB.addReskin('Plain_1'); HexDB.addReskin('Plain_1', 'same'); });
  expect(await page.evaluate(() => HexDB.getAll().length)).toBe(n0);
  await expect(toastWith(page, 'non-default package')).toBeVisible();
});

test('a prefixed copy persists through autosave', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Plain_1', 'postapoc')]);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await pickFirst(page, 'Plain_1');
  await page.waitForTimeout(600);
  const stored = await page.evaluate(() => Object.keys(localStorage).map(k => localStorage.getItem(k) || '').some(v => v.includes('Medieval_Plain_1')));
  expect(stored).toBe(true);
});

test('export then import round-trip: a prefixed copy is re-prefixed with the new package id, a same-id reskin keeps its id', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Plain_1', 'postapoc'), hexRec('Plain_2', 'postapoc')]);
  await page.evaluate(() => { HexDB.addReskin('Plain_1'); HexDB.addReskin('Plain_2', 'same'); });
  await page.click('#tab-packages');
  await page.locator('tr[data-pkg="medieval"]').getByRole('button', { name: /Export/ }).click();   // never published: asks first
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export local' }).click()]);
  const buf = fs.readFileSync((await dl.path())!);
  const hexes = JSON.parse(await (await readZip(buf)).file('hex_database.json')!.async('text')).hexes;
  expect(hexes.map((h: any) => `${h.id}@${h.package}`).sort()).toEqual(['Medieval_Plain_1@medieval', 'Plain_2@medieval']);
  const v = await page.evaluate(async b64 => {
    const JSZip = await Packages._loadJSZip();
    const p = await Packages.validatePackageZip(await JSZip.loadAsync(Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
    return { ok: p.ok, errors: p.errors, reskinCount: p.summary.reskinCount };
  }, buf.toString('base64'));
  expect(v).toEqual({ ok: true, errors: [], reskinCount: 1 });   // only the same-id entry counts as a runtime override
  // import under another package id
  await page.setInputFiles('#pkg-import-input', { name: 'pkg.zip', mimeType: 'application/zip', buffer: buf });
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
  await page.fill('#pkg-import-id', 'castle-pack');
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  await expect.poll(async () => (await page.evaluate(() => (Packages as any).getImportResult()))?.status).toBe('ok');
  expect(await page.evaluate(() => HexDB.getAll().filter((h: any) => h.package === 'castle-pack').map((h: any) => h.id).sort())).toEqual(['CastlePack_Plain_1', 'Plain_2']);
});
