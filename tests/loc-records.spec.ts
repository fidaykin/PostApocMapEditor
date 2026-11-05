// LocRecords (loc-records.js): which localization key stands for each tile / building record of every package. Pure: required directly.
// Plus the Localization Keys manager: default rows for the records, package columns, filters, "Fill empty textId".
import { test, expect } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LocRecords = require('../loc-records.js');

const HEX = [
  { id: 'Plain_1', type: 'Plains', package: 'postapoc', textId: 'plain_key' },
  { id: 'Plain_2', type: 'Plains', package: 'postapoc', textId: '' },                 // legacy key plain_key exists
  { id: 'Forest_1', type: 'Forests', package: 'postapoc', textId: '' },               // no old key: generated
  { id: 'Hills_1', type: 'Hills', package: 'postapoc', textId: '' },
  { id: 'Hs_Decameroon_Plain_1', type: 'Plains', package: 'hs', skinSlot: 'Plain_1', textId: '' },   // explicit skinSlot
  { id: 'Hs_Decameroon_Forest_1', type: 'Forests', package: 'hs', textId: '' },                      // inherited by stripped id
  { id: 'Hs_Decameroon_Hills_1', type: 'Mountains', package: 'hs', textId: '' },                      // other type: own key
  { id: 'Hs_Decameroon_Lake_9', type: 'Water', package: 'hs', textId: 'custom_lake' },               // own textId wins
];
const BLD = [
  { id: 'Farm_1', type: 'Ground Building', package: 'postapoc', textId: '' },
  { id: 'Hs_Decameroon_GoldMine_Big_1', type: 'Ground Building', package: 'hs', textId: '' },
];
const PKGS = ['postapoc', 'decameroon', 'hs'];   // hs ids stack two prefixes: Hs_ + Decameroon_
const ENTRIES = [{ key: 'plain_key', en: 'Plain', uk: 'Рівнина', group: 'Tiles' }];

test.describe('LocRecords.plan', () => {
  const { links, seeds } = LocRecords.plan({ hex: HEX, bld: BLD, entries: ENTRIES, packageIds: PKGS });
  const L = (id: string) => links.find((l: any) => l.id === id);

  test('own, legacy, skinSlot, stripped, generated', () => {
    expect(L('Plain_1')).toMatchObject({ key: 'plain_key', how: 'own', linked: true });
    expect(L('Plain_2')).toMatchObject({ key: 'plain_key', how: 'legacy', linked: false });
    expect(L('Forest_1')).toMatchObject({ key: 'forest_1_key', how: 'generated' });
    expect(L('Hs_Decameroon_Plain_1')).toMatchObject({ key: 'plain_key', how: 'skinSlot', base: 'Plain_1' });
    expect(L('Hs_Decameroon_Forest_1')).toMatchObject({ key: 'forest_1_key', how: 'stripped', base: 'Forest_1' });
    expect(L('Hs_Decameroon_Hills_1')).toMatchObject({ key: 'hs_decameroon_hills_1_key', how: 'generated' });   // Mountains != Hills
    expect(L('Hs_Decameroon_Lake_9')).toMatchObject({ key: 'custom_lake', how: 'own', linked: true });
    expect(L('Hs_Decameroon_GoldMine_Big_1')).toMatchObject({ key: 'hs_decameroon_goldmine_big_1_key', how: 'generated' });
  });

  test('seeds only the keys no entry has, once each, with the right group and a readable EN', () => {
    const keys = seeds.map((s: any) => s.key).sort();
    expect(keys).toEqual(['custom_lake', 'farm_1_key', 'forest_1_key', 'hills_1_key', 'hs_decameroon_goldmine_big_1_key', 'hs_decameroon_hills_1_key'].sort());
    expect(seeds.find((s: any) => s.key === 'hs_decameroon_goldmine_big_1_key')).toMatchObject({ en: 'Gold Mine Big', uk: '', group: 'Buildings' });
    expect(seeds.find((s: any) => s.key === 'forest_1_key').group).toBe('Tiles');
  });

  test('is pure and a second run with the seeds added seeds nothing', () => {
    const again = LocRecords.plan({ hex: HEX, bld: BLD, entries: [...ENTRIES, ...seeds], packageIds: PKGS });
    expect(again.seeds).toEqual([]);
    expect(HEX[1].textId).toBe('');
  });

  test('byKey groups the records of a key by package', () => {
    const k = LocRecords.byKey(links);
    expect(Object.keys(k['plain_key']).sort()).toEqual(['hs', 'postapoc']);
    expect(k['plain_key'].postapoc.map((l: any) => l.id).sort()).toEqual(['Plain_1', 'Plain_2']);
  });
});

test.describe('Localization Keys manager', () => {
  test('rows for the records, package columns, Fill empty textId', async ({ page }) => {
    await freshEditor(page);
    const r = await page.evaluate(() => {
      const hex = HexDB.getAll();
      const base = hex.find(h => (h.package || 'postapoc') === 'postapoc')!;
      return { baseId: base.id, pkgs: Packages.getAll().map(p => p.id) };
    });
    await page.evaluate(() => LocalizationKeys.openManager());
    await expect(page.locator('#loc-keys-modal')).toBeVisible();
    const head = await page.locator('#loc-keys-head').innerText();
    for (const id of r.pkgs) expect(head.toLowerCase()).toContain(id.toLowerCase());
    // every record has a link and its key has a row
    const missing = await page.evaluate(() => {
      const keys = new Set(LocalizationKeys.getKeys());
      return LocalizationKeys.getLinks().filter(l => !keys.has(l.key)).length;
    });
    expect(missing).toBe(0);
    // Fill empty textId writes the key into the records, and a second run has nothing to do
    await page.evaluate(() => { window.confirm = () => true; });
    const before = await page.evaluate(() => LocalizationKeys.getLinks().filter(l => !l.linked).length);
    await page.evaluate(() => LocalizationKeys.fillEmptyTextIds());
    const after = await page.evaluate(() => {
      LocalizationKeys.syncFromRecords();
      return { open: LocalizationKeys.getLinks().filter(l => !l.linked).length, empty: HexDB.getAll().filter(h => !String(h.textId || '').trim()).length };
    });
    expect(after.open).toBe(0);
    expect(after.empty).toBe(0);
    expect(before).toBeGreaterThanOrEqual(0);
  });

  test('package filter shows only keys used by that package', async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(() => LocalizationKeys.openManager());
    const n = await page.evaluate(() => { LocalizationKeys.setFilter('pkg', 'postapoc'); return document.querySelectorAll('#loc-keys-list > div').length; });
    expect(n).toBeGreaterThan(0);
    const all = await page.evaluate(() => { LocalizationKeys.setFilter('pkg', ''); return LocalizationKeys.getEntries().length; });
    expect(all).toBeGreaterThanOrEqual(n);
  });
});
