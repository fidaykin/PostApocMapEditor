import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, seedServerPackage, seedHexes, seedBuildings } from './helpers';

// "Convert to package…" (Map design): preview of MapConvert on the current map, then download or open the converted copy.
const H = (id: string, type: string, pkg: string) =>
  ({ id, type, biome: 'Decameron', filterCategory: 'FilterTerrain', spriteName: id, terrainTypeId: -1, package: pkg });
const B = (id: string, type: string, pkg: string) =>
  ({ id, type, buildingCategory: 'Standard', canBuild: true, availableTiles: [] as string[], spriteName: id, package: pkg });

async function setup(page: Page) {
  const gh = new FakeGitHub();
  seedServerPackage(gh, 'decameroon', { name: 'Decameroon' });
  seedServerPackage(gh, 'hs', { name: 'HS' });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page, { gh, pat: true });
  await seedHexes(page, [H('CvBase_Plain_1', 'Plains', 'postapoc'),
    H('Decameroon_Plain_1', 'Plains', 'decameroon'), H('Decameroon_Grain_2', 'Plains', 'decameroon'),
    H('Hs_Decameroon_Plain_1', 'Plains', 'hs')]);
  await seedBuildings(page, [B('Decameroon_Mill_1', 'Ground Building', 'decameroon'), B('Hs_Decameroon_Mill_1', 'Ground Building', 'hs')]);
  await page.evaluate(() => {
    mapData[0] = 'Decameroon_Plain_1'; mapData[1] = 'Decameroon_Plain_1'; mapData[2] = 'Decameroon_Grain_2';
    objectsData['5,5'] = 'Decameroon_Mill_1';
  });
}
const open = (page: Page) => page.evaluate(() => { ConvertMap.open(); });
const cell = (page: Page, kind: string, cls: string) => page.locator(`#convert-map-summary tr[data-kind="${kind}"] td.cv-${cls}`).innerText();

test.describe('Convert map to package', () => {
  test('the button is in Map design and opens the dialog with the targets', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { document.getElementById('acc-btn-design').click(); });
    await page.locator('#btn-convert-map').click();
    await expect(page.locator('#convert-map-modal')).toBeVisible();
    const opts = await page.locator('#convert-map-target option').evaluateAll(o => o.map(x => (x as HTMLOptionElement).value));
    expect(opts).toContain('hs');
    expect(opts).not.toContain('postapoc');
  });

  test('the preview counts converted ids and lists what stays', async ({ page }) => {
    await setup(page);
    await open(page);
    await page.locator('#convert-map-target').selectOption('hs');
    expect(await cell(page, 'hex', 'converted')).toBe('2');
    expect(await cell(page, 'hex', 'missing')).toBe('1');
    expect(await cell(page, 'bld', 'converted')).toBe('1');
    await expect(page.locator('#convert-map-left')).toContainText('Decameroon_Grain_2');
    await expect(page.locator('#convert-map-packages')).toContainText('hs');
  });

  test('the preview does not change the current map', async ({ page }) => {
    await setup(page);
    const before = await page.evaluate(() => IO.getMapJson());
    await open(page);
    await page.locator('#convert-map-target').selectOption('hs');
    expect(await page.evaluate(() => IO.getMapJson())).toBe(before);
  });

  test('a package with nothing to convert says so', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { mapData.fill('CvBase_Plain_1'); delete objectsData['5,5']; });
    await open(page);
    await page.locator('#convert-map-target').selectOption('hs');
    await expect(page.locator('#convert-map-packages')).toContainText('Nothing to convert');
  });

  test('Download gives the converted file named after the map and package', async ({ page }) => {
    await setup(page);
    await open(page);
    await page.locator('#convert-map-target').selectOption('hs');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download converted map' }).click()]);
    expect(dl.suggestedFilename()).toBe('map_hs.json');
    const text = require('fs').readFileSync(await dl.path(), 'utf8');
    const j = JSON.parse(text);
    expect(j.data[0][0]).toBe('Hs_Decameroon_Plain_1');
    expect(j.data[0][2]).toBe('Decameroon_Grain_2');
    expect(j.objects[0].id).toBe('Hs_Decameroon_Mill_1');
  });

  test('Open in editor replaces the map with the converted copy after confirmation', async ({ page }) => {
    await setup(page);
    await open(page);
    await page.locator('#convert-map-target').selectOption('hs');
    await page.getByRole('button', { name: 'Open in editor' }).click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.locator('#convert-map-modal')).toHaveCount(0);
    expect(await page.evaluate(() => mapData[0])).toBe('Hs_Decameroon_Plain_1');
    expect(await page.evaluate(() => document.getElementById('map-file-label')!.textContent)).toBe('map_hs');
  });

  test('declining the confirmation keeps the current map', async ({ page }) => {
    await setup(page);
    await open(page);
    await page.locator('#convert-map-target').selectOption('hs');
    await page.getByRole('button', { name: 'Open in editor' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(await page.evaluate(() => mapData[0])).toBe('Decameroon_Plain_1');
  });
});
