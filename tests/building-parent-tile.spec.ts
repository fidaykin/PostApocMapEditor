import { test, expect, Page } from '@playwright/test';
import { openEditor } from './helpers';

// ClickUp 869fgny1h: a building painted into a map cell remembers the tile it replaced (tileExtras underTerrainId), so
// the game shows that tile under a Boat / Fish Trap instead of always Water_1.
const BOAT = 'Pb_Boat_1', BOAT2 = 'Pb_Boat_2', COL = 5, ROW = 5;
const key = `${COL},${ROW}`;

async function setup(page: Page) {
  await openEditor(page);
  await page.evaluate(([a, b]) => BldDB.addEntries([
    { id: a, package: 'postapoc', spriteName: a, buildingCategory: 'Standard' },
    { id: b, package: 'postapoc', spriteName: b, buildingCategory: 'Standard' }]), [BOAT, BOAT2]);
}
const set = (page: Page, id: string) => page.evaluate(([c, r, id]) => { mapData[r as number * MAP_WIDTH + (c as number)] = id as string; }, [COL, ROW, id]);
const paint = (page: Page, id: string) => page.evaluate(([c, r, id]) => Tools.paintCells([{ col: c, row: r }], id), [COL, ROW, id] as any);
const under = (page: Page) => page.evaluate((k) => (tileExtras[k] || {}).underTerrainId, key);

test.describe('A building painted on a tile remembers that tile', () => {
  test('painting a building over Water_Dirty_1 stores Water_Dirty_1, and it reaches the exported map', async ({ page }) => {
    await setup(page);
    await set(page, 'Water_Dirty_1');
    await paint(page, BOAT);
    expect(await under(page)).toBe('Water_Dirty_1');
    const json = await page.evaluate(() => IO.getMapJson());
    expect(JSON.parse(json).tileExtras).toContainEqual({ col: COL, row: ROW, underTerrainId: 'Water_Dirty_1' });
  });

  test('replacing a building with another keeps the remembered tile', async ({ page }) => {
    await setup(page);
    await set(page, 'Fish_1');
    await paint(page, BOAT);
    await paint(page, BOAT2);
    expect(await under(page)).toBe('Fish_1');
  });

  test('painting a tile over the building forgets it', async ({ page }) => {
    await setup(page);
    await set(page, 'Water_1');
    await paint(page, BOAT);
    expect(await under(page)).toBe('Water_1');
    await paint(page, 'Plain_1');
    expect(await under(page)).toBeUndefined();
  });

  test('a bridge id gets no automatic value (its own Under terrain rules stay)', async ({ page }) => {
    await setup(page);
    await set(page, 'River_1');
    await paint(page, 'Road_Bridge_NS_1');
    expect(await under(page)).toBeUndefined();
  });

  test('undo restores the previous tileExtras', async ({ page }) => {
    await setup(page);
    await set(page, 'Water_Dirty_1');
    await page.evaluate(() => History.push());
    await paint(page, BOAT);
    expect(await under(page)).toBe('Water_Dirty_1');
    await page.evaluate(() => History.undo());
    expect(await under(page)).toBeUndefined();
  });

  test('selecting a building cell shows the Under terrain field and editing it changes the stored tile', async ({ page }) => {
    await setup(page);
    await set(page, 'Water_1');
    await paint(page, BOAT);
    await page.evaluate(([c, r]) => Canvas.selectTile(c, r), [COL, ROW]);
    const input = page.locator('#tile-insp-under');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('Water_1');
    await input.fill('Water_Dirty_1');
    await input.dispatchEvent('change');
    await page.evaluate(() => Canvas.applyTileInspectorUnder());
    expect(await under(page)).toBe('Water_Dirty_1');
  });
});
