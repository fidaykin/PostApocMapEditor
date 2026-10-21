import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, seedServerPackage, seedHexes, seedBuildings } from './helpers';

// skinSlot: the base id a package record repaints (docs/contracts/skin-slots.md in the game repo). The key is absent when empty.
const PKG = 'skin-pkg';
const HEX = { id: 'SkinPkg_Plain_1', package: PKG, type: 'Plains', biome: 'Decameron', filterCategory: 'FilterTerrain', spriteName: 'SkinPkg_Plain_1', terrainTypeId: -1 };
const BLD = { id: 'SkinPkg_Farm_1', package: PKG, type: 'Ground Building', buildingCategory: 'Standard', canBuild: true, availableTiles: [] as string[], spriteName: 'SkinPkg_Farm_1' };

async function setup(page: Page) {
  const gh = new FakeGitHub();
  seedServerPackage(gh, PKG, { name: 'Skin Pkg' });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page, { gh });
  await seedHexes(page, [HEX]);
  await seedBuildings(page, [BLD]);
}
const hexRec = (page: Page) => page.evaluate(id => HexDB.getAll().find((h: any) => h.id === id), HEX.id);
const bldRec = (page: Page) => page.evaluate(id => BldDB.getAll().find((b: any) => b.id === id), BLD.id);

test.describe('skinSlot field', () => {
  test('HEX DB form saves the Skin Slot and removes the key when cleared', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => App.setMode('hexdb'));
    await page.locator('.hexdb-list-row', { hasText: new RegExp('^' + HEX.id + '$') }).click();
    const f = page.locator('#hexdb-right [data-field="skinSlot"]');
    await f.fill('  Plain_1 ');
    await f.dispatchEvent('change');
    expect((await hexRec(page)).skinSlot).toBe('Plain_1');
    await f.fill('');
    await f.dispatchEvent('change');
    expect('skinSlot' in (await hexRec(page))).toBe(false);
  });

  test('BUILDINGS form saves the Skin Slot and removes the key when cleared', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => App.setMode('buildings'));
    await page.locator('#bld-list .hexdb-list-row', { hasText: new RegExp('^' + BLD.id + '$') }).first().click();
    const f = page.locator('#bld-f-skinSlot');
    await f.fill('Farm_1');
    await f.dispatchEvent('change');
    expect((await bldRec(page)).skinSlot).toBe('Farm_1');
    await f.fill('');
    await f.dispatchEvent('change');
    expect('skinSlot' in (await bldRec(page))).toBe(false);
  });

  test('the field survives export for the package', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => HexDB.setSkinSlot('SkinPkg_Plain_1', 'skin-pkg', 'Plain_1'));
    const out = await page.evaluate(() => HexDB.exportFor({ pkg: 'skin-pkg', mode: 'off', hexes: HexDB.getAll(), local: true }));
    const rec = out.hexes.find((h: any) => h.id === 'SkinPkg_Plain_1');
    expect(rec.skinSlot).toBe('Plain_1');
  });
});
