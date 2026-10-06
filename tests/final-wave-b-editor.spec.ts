import { test, expect, Page } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// Final fix wave B (remaining Minor findings): validator (B3), History / PNG / layout (B4), generation (B5), UI (B6).

test.describe('B3 validator', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  // A settlement ringed by `wallId` (true hex adjacency) must be reported as unreachable from the city.
  const walled = (page: Page, wallId: string) => page.evaluate((id) => {
    const sc = 231, sr = 224;
    settlements.push({ col: sc, row: sr, type: 'settlement' } as any);
    for (const n of HexUtils.neighbors(sc, sr, MAP_WIDTH, MAP_HEIGHT)) mapData[n.row * MAP_WIDTH + n.col] = id;
    return MapValidator.run().issues.map((i: any) => i.id);
  }, wallId);

  test('Mountain_Kaiju_1 and _2 block like Mountain_1; Hills_1 does not (hand-written list)', async ({ page }) => {
    expect(await walled(page, 'Mountain_Kaiju_1')).toContain('unreachable-settlement');
    expect(await walled(page, 'Mountain_Kaiju_2')).toContain('unreachable-settlement');
    expect(await walled(page, 'Mountain_1')).toContain('unreachable-settlement');
    expect(await walled(page, 'Hills_1')).not.toContain('unreachable-settlement');       // positive control: the same ring of a passable tile
  });

  test('a HexDB entry whose TYPE is Volcanic/Rift or Rivers blocks without being in a hard-coded id list', async ({ page }) => {
    await page.evaluate(() => {
      HexDB.getAll().push({ id: 'Magma_Custom_1', type: 'Volcanic/Rift', spriteName: '' } as any, { id: 'Brook_Custom_1', type: 'Rivers', spriteName: '' } as any, { id: 'Grass_Custom_1', type: 'Plains', spriteName: '' } as any);
    });
    expect(await walled(page, 'Magma_Custom_1')).toContain('unreachable-settlement');
    expect(await walled(page, 'Brook_Custom_1')).toContain('unreachable-settlement');
    expect(await walled(page, 'Grass_Custom_1')).not.toContain('unreachable-settlement');
  });

  for (const db of ['HexDB', 'BldDB'] as const) {
    test(`an edit to ${db} marks the validator panel 'Results outdated'`, async ({ page }) => {
      await page.evaluate(() => { MapValidator.runPanel(); });
      const sum = page.locator('#val-summary');
      await expect(sum).not.toContainText('outdated');
      await page.evaluate((d) => {
        if (d === 'HexDB') HexDB.addEntries([{ id: 'Fresh_Hex_1', type: 'Plains', spriteName: '' }]);
        else BldDB.addEntries([{ id: 'Fresh_Bld_1', buildingCategory: 'Other' }]);
      }, db);
      await expect(sum).toContainText('outdated');
    });
  }
});
