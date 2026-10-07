import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, seedHexes, seedBuildings, hexRec, bldRec } from './helpers';

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

test('clicking an entry reskins it: same id, active package, base entry untouched; one list entry more', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Zq_Alpha', 'postapoc', { spriteName: 'Zq_Sprite' })]);
  const n0 = await page.evaluate(() => HexDB.getAll().length);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await page.locator('#reskin-search').fill('zq_alpha');
  await items(page).first().click();
  await expect(picker(page)).toHaveCount(0);
  expect(await ownedBy(page, 'Zq_Alpha', 'postapoc')).toBe(1);
  expect(await ownedBy(page, 'Zq_Alpha', 'medieval')).toBe(1);
  expect(await page.evaluate(() => HexDB.getAll().length)).toBe(n0 + 1);
  expect(await page.evaluate(() => HexDB.getAll().find((h: any) => h.id === 'Zq_Alpha' && h.package === 'medieval').spriteName)).toBe('Zq_Sprite');   // copy of the base, as before
});

test('keyboard: arrows skip disabled entries, Enter picks, Escape closes without reskinning and returns focus', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Zq_A', 'postapoc'), hexRec('Zq_B', 'postapoc'), hexRec('Zq_C', 'postapoc'), hexRec('Zq_B', 'medieval')]);
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
  expect(await ownedBy(page, 'Zq_C', 'medieval')).toBe(1);
  expect(await ownedBy(page, 'Zq_A', 'medieval')).toBe(0);
});

test('an already reskinned entry cannot be picked by click or Enter (no duplicate)', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Zq_B', 'postapoc'), hexRec('Zq_B', 'medieval')]);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await page.locator('#reskin-search').fill('zq_b');
  await expect(items(page)).toHaveCount(1);
  await items(page).first().click({ force: true });
  await page.keyboard.press('Enter');
  await expect(picker(page)).toHaveCount(1);
  expect(await ownedBy(page, 'Zq_B', 'medieval')).toBe(1);
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
  expect(await page.evaluate(i => HexDB.getAll().filter((h: any) => h.id === i && h.package === 'medieval').length, evil)).toBe(1);
});

test('building reskin uses the same picker and keeps the id', async ({ page }) => {
  await open(page);
  await seedBuildings(page, [bldRec('Farm_X', 'postapoc', { buildingCategory: 'Standard', type: 'Ground Building' })]);
  await page.evaluate(() => { BldDB.promptReskin(); });
  await page.locator('#reskin-search').fill('farm_x');
  await expect(items(page)).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(picker(page)).toHaveCount(0);
  expect(await page.evaluate(() => BldDB.getAll().filter((b: any) => b.id === 'Farm_X').map((b: any) => b.package || 'postapoc').sort())).toEqual(['medieval', 'postapoc']);
});

test('with the default package active nothing opens and a toast explains', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { Packages.setActive('postapoc'); HexDB.promptReskin(); });
  await expect(picker(page)).toHaveCount(0);
  await expect(page.locator('#toast-container .toast', { hasText: 'non-default package' }).first()).toBeVisible();
});
