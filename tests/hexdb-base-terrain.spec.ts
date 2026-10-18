import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, seedServerPackage, TINY_PNG } from './helpers';

// ClickUp 869fgny1h: a hex can declare the hex it sits on ("Base Terrain"): Fish_Dirty_1 is the fish sprite on the
// dirty-water sprite. A hex with a base terrain is a layered hex (the form has no isLayered control).
const BASE = 'ZZ_Dirty_1', FISH = 'ZZ_FishDirty_1';
const ENT = (id: string, type: string, extra: any = {}) => ({
  id, type, spriteName: id, biome: 'Decameron', filterCategory: 'FilterWater', terrainTypeId: -1,
  package: 'zz', category: '💧 WATER / RIVER', ...extra });
const HEXES = [ENT(BASE, 'Water'), ENT(FISH, 'Water')];

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
const field = (page: Page) => page.locator('#hexdb-right [data-field="baseTerrainId"]');
const rec = (page: Page, id: string) => page.evaluate((id) => HexDB.getAll().find((h: any) => h.id === id), id);

test.describe('HEX DB: Base Terrain', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('the form has a Base Terrain input that is saved on the record', async ({ page }) => {
    await select(page, FISH);
    await expect(field(page)).toBeVisible();
    await field(page).fill(BASE);
    await field(page).dispatchEvent('change');
    expect((await rec(page, FISH)).baseTerrainId).toBe(BASE);
  });

  test('a hex with a Base Terrain is layered, one without is not', async ({ page }) => {
    await select(page, FISH);
    await field(page).fill(BASE);
    await field(page).dispatchEvent('change');
    expect(await page.evaluate((id) => Terrain.isLayeredHex(HexDB.getAll().find((h: any) => h.id === id)), FISH)).toBe(true);
    expect(await page.evaluate((id) => Terrain.isLayeredHex(HexDB.getAll().find((h: any) => h.id === id)), BASE)).toBe(false);
  });

  test('layeredBaseSpriteFor returns the base sprite once loaded, null when unset or unknown', async ({ page }) => {
    await expect.poll(() => page.evaluate((id) => {
      const img = Terrain.layeredBaseSpriteFor({ baseTerrainId: id });
      return !!img && img.naturalWidth > 0;
    }, BASE)).toBe(true);
    expect(await page.evaluate(() => Terrain.layeredBaseSpriteFor({ baseTerrainId: '' }))).toBeNull();
    expect(await page.evaluate(() => Terrain.layeredBaseSpriteFor({}))).toBeNull();
    expect(await page.evaluate(() => Terrain.layeredBaseSpriteFor({ baseTerrainId: 'No_Such_Hex' }))).toBeNull();
    expect(await page.evaluate(() => Terrain.layeredBaseSpriteFor(null))).toBeNull();
  });
});
