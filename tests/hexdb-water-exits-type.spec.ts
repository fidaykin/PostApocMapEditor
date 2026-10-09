import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, seedServerPackage, TINY_PNG } from './helpers';

// ClickUp 869fckzrn: the WATER EXITS block of a HEX DB record was built only when the record was rendered, so changing
// Type away from Rivers neither hid it nor removed the exits (a Water tile with edgeFaces counts as a directional piece).
const RIVER = 'ZZ_River_1', PLAIN = 'ZZ_Plain_1', OTHER = 'ZZ_Forest_1', OTHER_RIVER = 'ZZ_River_2';

const ENT = (id: string, type: string, edgeFaces: string[]) => ({
  id, type, spriteName: id, biome: 'Decameron', filterCategory: type === 'Rivers' ? 'FilterWater' : 'FilterTerrain', terrainTypeId: -1,
  package: 'zz', edgeFaces, category: type === 'Rivers' ? '💧 WATER / RIVER' : '🌾 PLAINS' });
const HEXES = [ENT(RIVER, 'Rivers', ['N', 'S']), ENT(PLAIN, 'Plains', []), ENT(OTHER, 'Forests', ['E']), ENT(OTHER_RIVER, 'Rivers', ['NE'])];

async function setup(page: Page) {
  const gh = new FakeGitHub();
  const sprites: Record<string, Buffer> = {};
  for (const h of HEXES) sprites['hex/' + h.spriteName + '.png'] = TINY_PNG;
  seedServerPackage(gh, 'zz', { name: 'ZZ', hexes: HEXES, sprites });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page, { gh });
  await page.evaluate(() => App.setMode('hexdb'));
}
const select = (page: Page, id: string) => page.locator('.hexdb-list-row', { hasText: new RegExp('^' + id + '$') }).click();
const block = (page: Page) => page.locator('#hex-rosette');
const faces = (page: Page, id: string) => page.evaluate((id) => HexDB.getAll().find((h: any) => h.id === id).edgeFaces, id);
const type = (page: Page) => page.locator('#hexdb-right [data-field="type"]');

test.describe('HEX DB: the Water Exits block follows the Type field', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('Rivers shows the block; a non-Rivers type removes it and clears the exits; Rivers again shows it', async ({ page }) => {
    await select(page, RIVER);
    await expect(block(page)).toHaveCount(1);
    expect(await faces(page, RIVER)).toEqual(['N', 'S']);

    await type(page).selectOption('Water');
    await expect(block(page)).toHaveCount(0);
    await expect(page.getByText('WATER EXITS')).toHaveCount(0);
    expect(await faces(page, RIVER)).toEqual([]);

    await type(page).selectOption('Rivers');
    await expect(block(page)).toHaveCount(1);
    expect(await faces(page, RIVER)).toEqual([]);
  });

  test('other fields edited before the type change keep their value', async ({ page }) => {
    await select(page, RIVER);
    await page.locator('#hexdb-right [data-field="textId"]').fill('keep_me_key');
    await type(page).selectOption('Water');
    await expect(block(page)).toHaveCount(0);
    await expect(page.locator('#hexdb-right [data-field="textId"]')).toHaveValue('keep_me_key');
    expect(await page.evaluate((id) => HexDB.getAll().find((h: any) => h.id === id).textId, RIVER)).toBe('keep_me_key');
  });

  test('a record that was never Rivers shows no block; non-Rivers to non-Rivers leaves other records alone', async ({ page }) => {
    await select(page, PLAIN);
    await expect(block(page)).toHaveCount(0);
    await type(page).selectOption('Forests');
    await expect(block(page)).toHaveCount(0);
    expect(await faces(page, PLAIN)).toEqual([]);
    expect(await faces(page, RIVER)).toEqual(['N', 'S']);
    expect(await faces(page, OTHER)).toEqual(['E']);
    expect(await faces(page, OTHER_RIVER)).toEqual(['NE']);
  });
});
