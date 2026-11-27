import { test, expect, Page } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// The package chips above the Place Building list (and the Place Bridge list) hid a package's tiles in the left palette only: the
// list itself did not change. Now the open list follows the same filter.

const cards = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('#obj-building-picker-grid .bld-card')).map(c => (c as HTMLElement).dataset.bldId));

test.describe('building picker follows the package filter', () => {
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(() => {
      BldDB.addEntries([
        { id: 'Pa_House_1', package: 'pkga', buildingCategory: 'Standard', canBuild: true, availableTiles: [], spriteName: 'x' },
        { id: 'Pb_House_1', package: 'pkgb', buildingCategory: 'Standard', canBuild: true, availableTiles: [], spriteName: 'y' },
        { id: 'Pa_Bridge_1', package: 'pkga', buildingCategory: 'Bridge', canBuild: true, availableTiles: [], spriteName: 'z' },
        { id: 'Pb_Bridge_1', package: 'pkgb', buildingCategory: 'Bridge', canBuild: true, availableTiles: [], spriteName: 'w' },
      ]);
    });
  });

  test('hiding a package removes its buildings from the open list and showing it brings them back', async ({ page }) => {
    await page.evaluate(() => Tools.setActive('object'));
    expect(await cards(page)).toEqual(expect.arrayContaining(['Pa_House_1', 'Pb_House_1']));
    await page.evaluate(() => Packages.togglePkgFilter('pkga'));
    const hidden = await cards(page);
    expect(hidden).toContain('Pb_House_1');
    expect(hidden).not.toContain('Pa_House_1');
    await page.evaluate(() => Packages.togglePkgFilter('pkga'));
    expect(await cards(page)).toContain('Pa_House_1');
  });

  test('the Bridge list follows the filter too', async ({ page }) => {
    await page.evaluate(() => Tools.setActive('bridge'));
    await page.evaluate(() => Packages.togglePkgFilter('pkgb'));
    const ids = await cards(page);
    expect(ids).toContain('Pa_Bridge_1');
    expect(ids).not.toContain('Pb_Bridge_1');
  });

  test('toggling the filter while the picker is closed changes nothing until the tool is chosen, then the list is filtered', async ({ page }) => {
    await page.evaluate(() => Packages.togglePkgFilter('pkga'));
    await page.evaluate(() => Tools.setActive('object'));
    const ids = await cards(page);
    expect(ids).toContain('Pb_House_1');
    expect(ids).not.toContain('Pa_House_1');
  });
});
