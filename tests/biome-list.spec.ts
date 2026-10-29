import { test, expect, Page } from '@playwright/test';
import { openEditor, seedHexes, seedBuildings } from './helpers';

// ClickUp 869fm23zy: the biome list lives in each browser's localStorage, so on another laptop a record whose biome is not in
// the list (Decameron) showed the first default (Summer) in its form, and saving would have overwritten it.
const BLD = {
  id: 'Biome_Bld_1', type: 'Ground Building', buildingCategory: 'Standard', canBuild: true, canDestroy: true,
  destroyTransformToMode: 'HexID', destroyTransformTo: '', availableTiles: [] as string[], additionalBuildCondition: true,
  tilesTypeMode: 'HexID', tilesTypeValue: '', canProduceEnabled: true, canProduce: [] as string[], availableTilesForProduce: [] as string[],
  price: [{ type: 'Gold', amount: 5 }], minLevel: 1, premiumPrice: 0, radius: 0, buildingRadius: 0, spriteName: 'x',
  biome: 'Decameron',
};

async function setup(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page);
  await seedBuildings(page, [BLD]);
  await page.evaluate(() => App.setMode('buildings'));
}

test.describe('Biome list', () => {
  test('a biome used by a record is listed even when this browser does not know it', async ({ page }) => {
    await setup(page);
    expect(await page.evaluate(() => BiomeManager.getNames())).toContain('Decameron');
    expect(await page.evaluate(() => BiomeManager.getNames().slice(0, 4))).toEqual(['Summer', 'Winter', 'Desert', 'Radioactive']);
  });

  test('the building form keeps the record biome instead of the first default', async ({ page }) => {
    await setup(page);
    await page.locator('#bld-list .hexdb-list-row', { hasText: /^Biome_Bld_1$/ }).first().click();
    await expect(page.locator('#bld-f-id')).toHaveValue('Biome_Bld_1');
    await expect(page.locator('#bld-f-biome')).toHaveValue('Decameron');
  });

  test('the biome filter offers the biome after the DBs have loaded', async ({ page }) => {
    await setup(page);
    await page.locator('#bld-filter-biome').dispatchEvent('mousedown');
    await expect(page.locator('#bld-filter-biome option', { hasText: 'Decameron' })).toHaveCount(1);
  });

  test('optionsFor adds a record biome that is in no list', async ({ page }) => {
    await setup(page);
    expect(await page.evaluate(() => BiomeManager.optionsFor('Nowhere')[0])).toBe('Nowhere');
    expect(await page.evaluate(() => BiomeManager.optionsFor('Summer')[0])).toBe('Summer');
  });
});
