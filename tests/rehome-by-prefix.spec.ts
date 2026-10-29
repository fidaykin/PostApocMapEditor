import { test, expect, Page } from '@playwright/test';
import { FakeGitHub, seedServerPackage } from './helpers';
import { seedRoadsWorld, seedRoadsServer } from './roads-fixtures';

// ClickUp 869fjygem: buildings made before the id decided the package (Copy, Paste, Change ID) sit in Decameroon with a
// Medieval20_ id. "Fix packages by id prefix" re-homes them in one confirmed step.
const MED = 'medieval-2-0';
const bld = (id: string, pkg: string, extra: object = {}) => ({ id, package: pkg, buildingCategory: 'Standard', canBuild: true, availableTiles: [] as string[], spriteName: id, ...extra });

async function world(page: Page) {
  const gh = new FakeGitHub();
  seedRoadsServer(gh);
  seedServerPackage(gh, MED, { name: 'Medieval 2.0' });
  await seedRoadsWorld(page, gh);
  await page.evaluate(b => BldDB.addEntries(b), [
    bld('Medieval20_Farm_1', 'decameroon'), bld('Medieval20_Mill_1', 'decameroon'), bld('Decameroon_Quarry_1', 'decameroon'),
    bld('Medieval20_Boat_1', 'decameroon'), bld('Medieval20_Boat_1', MED),                    // a clash: stays
    bld('Medieval20_road', 'postapoc', { isRoad: true }),                                     // a road: stays in the base package
  ]);
}
const pkgOf = (page: Page, id: string) => page.evaluate(i => BldDB.getAll().filter((b: any) => b.id === i).map((b: any) => b.package || 'postapoc').sort(), id);
async function openDialog(page: Page) {
  await page.evaluate(() => App.setMode('packages'));
  await page.locator('#rehome-btn').click();
  await expect(page.locator('#rehome-modal')).toBeVisible();
}

test.describe('Fix packages by id prefix', () => {
  test('the dialog lists the moves and the records that cannot move; nothing changes until the confirm', async ({ page }) => {
    await world(page);
    await openDialog(page);
    await expect(page.locator('#rehome-summary')).toContainText('2 record(s) will move');
    await expect(page.locator('#rehome-list')).toContainText('Medieval20_Farm_1: decameroon → medieval-2-0');
    await expect(page.locator('#rehome-list')).toContainText('Medieval20_Mill_1');
    await expect(page.locator('#rehome-problems')).toContainText('already has an entry "Medieval20_Boat_1"');
    await expect(page.locator('#rehome-problems')).toContainText('is a road or bridge');
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(await pkgOf(page, 'Medieval20_Farm_1')).toEqual(['decameroon']);
  });

  test('the confirm moves them; the clash and the road stay; ids and other records are untouched', async ({ page }) => {
    await world(page);
    await openDialog(page);
    await page.getByRole('button', { name: /^Move 2 record/ }).click();
    expect(await pkgOf(page, 'Medieval20_Farm_1')).toEqual([MED]);
    expect(await pkgOf(page, 'Medieval20_Mill_1')).toEqual([MED]);
    expect(await pkgOf(page, 'Medieval20_Boat_1')).toEqual(['decameroon', MED]);
    expect(await pkgOf(page, 'Medieval20_road')).toEqual(['postapoc']);
    expect(await pkgOf(page, 'Decameroon_Quarry_1')).toEqual(['decameroon']);
  });

  test('a second run finds nothing more to move', async ({ page }) => {
    await world(page);
    await openDialog(page);
    await page.getByRole('button', { name: /^Move 2 record/ }).click();
    await page.locator('#rehome-btn').click();
    await expect(page.locator('#rehome-summary')).toHaveCount(0);
    await expect(page.locator('#rehome-problems')).toBeVisible();   // the two that cannot move are still reported
  });

  test('tiles move too', async ({ page }) => {
    await world(page);
    await page.evaluate(() => HexDB.addEntries([{ id: 'Medieval20_Plain_9', type: 'Plains', biome: 'Summer', spriteName: 'Medieval20_Plain_9', package: 'decameroon', filterCategory: 'FilterTerrain', terrainTypeId: -1, edgeFaces: [] }]));
    await openDialog(page);
    await expect(page.locator('#rehome-list')).toContainText('tile Medieval20_Plain_9: decameroon → medieval-2-0');
    await page.getByRole('button', { name: /^Move \d+ record/ }).click();
    expect(await page.evaluate(() => HexDB.getAll().find((h: any) => h.id === 'Medieval20_Plain_9').package)).toBe(MED);

  });

  test('with nothing to fix the dialog says so and offers only Close', async ({ page }) => {
    await seedRoadsWorld(page);
    await openDialog(page);
    await expect(page.locator('#rehome-none')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Move/ })).toHaveCount(0);
  });
});
