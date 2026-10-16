import { test, expect, Page } from '@playwright/test';
import { seedRoadsWorld } from './roads-fixtures';

// Roads/Bridges V1, E4: Available Tiles is locked for road and bridge buildings (permissions live in the Hex DB), and
// roads stay in the base package.
async function selectBld(page: Page, id: string) {
  await page.evaluate(() => App.setMode('buildings'));
  await page.evaluate(() => { const t = document.getElementById('bld-search') as HTMLInputElement | null; if (t) { t.value = ''; t.dispatchEvent(new Event('input')); } });
  await page.locator('#bld-list .hexdb-list-row', { hasText: new RegExp('^' + id + '$') }).first().click();
  await expect(page.locator('#bld-f-id')).toHaveValue(id);
}
const tagsInput = (page: Page) => page.locator('#bld-right .hexdb-tag-input[data-tags-field="availableTiles"]');
const lockHint = (page: Page) => page.locator('#bld-right .bld-roads-lock-hint');
const bld = (page: Page, id: string, pkg = 'postapoc') => page.evaluate(([i, p]) => BldDB.getAll().find((b: any) => b.id === i && (b.package || 'postapoc') === p), [id, pkg]);

test.describe('Building DB: roads and bridges', () => {
  test('Available Tiles is locked for a road and for a bridge, editable for a house (positive control)', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => BldDB.addEntries([{ id: 'house_1', package: 'postapoc', buildingCategory: 'Standard', canBuild: true, availableTiles: ['Plain_1'], spriteName: 'x' }]));
    for (const id of ['road', 'bridge']) {
      await selectBld(page, id);
      await expect(tagsInput(page)).toBeDisabled();
      await expect(lockHint(page)).toContainText('Set in Hex DB > Roads/Bridges');
    }
    await selectBld(page, 'house_1');
    await expect(tagsInput(page)).toBeEnabled();
    await expect(page.locator('#bld-right .hexdb-tag-remove[data-tags-field="availableTiles"]').first()).toBeEnabled();
    await expect(lockHint(page)).toHaveCount(0);
  });

  test('ticking Is Road or switching Category to Bridge locks the row at once, without selecting another record', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => BldDB.addEntries([{ id: 'house_1', package: 'postapoc', buildingCategory: 'Standard', canBuild: true, availableTiles: [], spriteName: 'x' }]));
    await selectBld(page, 'house_1');
    await expect(tagsInput(page)).toBeEnabled();
    await page.locator('#bld-f-isRoad').check();
    await expect(tagsInput(page)).toBeDisabled();
    await page.locator('#bld-f-isRoad').uncheck();
    await expect(tagsInput(page)).toBeEnabled();
    await page.locator('#bld-f-buildingCategory').selectOption('Bridge');
    await expect(tagsInput(page)).toBeDisabled();
    await page.locator('#bld-f-buildingCategory').selectOption('Standard');
    await expect(tagsInput(page)).toBeEnabled();
    // the stored data was not rewritten by the lock
    expect(await page.evaluate(() => BldDB.getAll().find((b: any) => b.id === 'house_1').buildingCategory)).toBe('Standard');
  });

  test('a road with Available Tiles shows a warning and Clear empties it in one autosave; a clean road shows no warning', async ({ page }) => {
    await seedRoadsWorld(page);
    await selectBld(page, 'road');
    await expect(page.locator('#bld-right .bld-roads-msg')).toHaveCount(0);
    await page.evaluate(() => { BldDB.getAll().find((b: any) => b.id === 'road').availableTiles = ['Plain_1', 'Plain_2']; });
    await selectBld(page, 'road_2');
    await selectBld(page, 'road');
    await expect(page.locator('#bld-right .bld-roads-msg')).toContainText('Available Tiles is ignored');
    const saves = await page.evaluate(() => {
      (window as any).__saves = 0;
      const orig = StorageGuard.setItem;
      (window as any).__origSet = orig;
      StorageGuard.setItem = function (k: string, ...a: any[]) { if (k === 'blddb_autosave') (window as any).__saves++; return orig.call(StorageGuard, k, ...a); };
      return 0;
    });
    try {
      await page.getByRole('button', { name: 'Clear (permissions are set in Hex DB)' }).click();
      expect(await page.evaluate(() => (window as any).__saves)).toBe(1);
    } finally {
      await page.evaluate(() => { StorageGuard.setItem = (window as any).__origSet; });
    }
    expect((await bld(page, 'road')).availableTiles).toEqual([]);
    await expect(page.locator('#bld-right .bld-roads-msg')).toHaveCount(0);
    void saves;
  });

  test('non-base package: Reskin+ of road and bridge refuses; a house reskins (positive control)', async ({ page }) => {
    const { gh } = await seedRoadsWorld(page);
    gh.setRegistry([{ id: 'medieval', name: 'Medieval' }]);
    await page.evaluate(() => { BldDB.addEntries([{ id: 'house_1', package: 'postapoc', buildingCategory: 'Standard', spriteName: 'x' }]); Packages.setActive('decameroon'); });
    const n0 = await page.evaluate(() => BldDB.getAll().length);
    await page.evaluate(() => { BldDB.addReskin('road'); BldDB.addReskin('bridge', 'same'); });
    expect(await page.evaluate(() => BldDB.getAll().length)).toBe(n0);
    await expect(page.locator('.toast, #toast').last()).toContainText(/global|base package/i);
    await page.evaluate(() => BldDB.addReskin('house_1'));
    expect(await page.evaluate(() => BldDB.getAll().length)).toBe(n0 + 1);
  });

  test('non-base package: a new building made a road or a bridge shows a road-in-package error line; a base road shows none', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => { Packages.setActive('decameroon'); BldDB.add(); });
    await page.evaluate(() => App.setMode('buildings'));
    await expect(page.locator('#bld-right .bld-roads-msg')).toHaveCount(0);
    await page.locator('#bld-f-isRoad').check();
    await expect(page.locator('#bld-right .bld-roads-msg')).toContainText('global');
    await page.locator('#bld-f-isRoad').uncheck();
    await expect(page.locator('#bld-right .bld-roads-msg')).toHaveCount(0);
    await page.locator('#bld-f-buildingCategory').selectOption('Bridge');
    await expect(page.locator('#bld-right .bld-roads-msg')).toContainText('global');
    // positive control: the base road has no such line
    await page.evaluate(() => Packages.setActive('postapoc'));
    await selectBld(page, 'road');
    await expect(page.locator('#bld-right .bld-roads-msg')).toHaveCount(0);
  });

  test('Paste of a road or bridge into a non-base active package refuses; into the base package it works', async ({ page }) => {
    await seedRoadsWorld(page);
    await selectBld(page, 'road');
    await page.evaluate(() => BldDB.copy());
    await page.evaluate(() => Packages.setActive('decameroon'));
    const n0 = await page.evaluate(() => BldDB.getAll().length);
    await page.evaluate(() => BldDB.paste());
    expect(await page.evaluate(() => BldDB.getAll().length)).toBe(n0);
    await page.evaluate(() => Packages.setActive('postapoc'));
    await page.evaluate(() => BldDB.paste());
    expect(await page.evaluate(() => BldDB.getAll().length)).toBe(n0 + 1);
    expect(await bld(page, 'road_copy')).toMatchObject({ isRoad: true });
  });
});
