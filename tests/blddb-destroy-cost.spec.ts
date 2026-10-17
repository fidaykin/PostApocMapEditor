import { test, expect, Page } from '@playwright/test';
import { openEditor } from './helpers';

// Building DB: "Destroy Cost" = resources the player PAYS to destroy a building (Destroy Income is the reward).
async function addAndSelect(page: Page) {
  await page.evaluate(() => App.setMode('buildings'));
  await page.evaluate(() => BldDB.add());
  await expect(page.locator('#bld-f-id')).toBeVisible();
  await page.locator('.hexdb-section-hdr[data-sec="destroy"]').click(); // collapsed by default
  await expect(page.locator('#bld-f-canDestroy')).toBeVisible();
}
const cur = (page: Page) => page.evaluate(() => { const a = BldDB.getAll(); return a[a.length - 1]; });

test.describe('Building DB: Destroy Cost', () => {
  test('a new building has an empty destroyCost, and an old record gets one on load', async ({ page }) => {
    await openEditor(page);
    await addAndSelect(page);
    expect((await cur(page)).destroyCost).toEqual([]);
    await page.evaluate(() => BldDB.load(JSON.stringify({ buildings: [{ id: 'Old_1', package: 'postapoc' }] })));
    expect(await page.evaluate(() => BldDB.getAll().find((b: any) => b.id === 'Old_1').destroyCost)).toEqual([]);
  });

  test('resources can be added, edited and removed in the Destroy Cost block', async ({ page }) => {
    await openEditor(page);
    await addAndSelect(page);
    const add = page.locator('.hexdb-res-add[data-res-field="destroyCost"]');
    await add.click();
    await page.locator('[data-res-field="destroyCost"][data-res-key="amount"]').first().fill('75');
    expect((await cur(page)).destroyCost).toHaveLength(1);
    expect((await cur(page)).destroyCost[0].amount).toBe(75);
    await page.locator('.hexdb-res-remove[data-res-field="destroyCost"]').first().click();
    expect((await cur(page)).destroyCost).toEqual([]);
  });

  test('Destroy Cost and Destroy Income are independent lists', async ({ page }) => {
    await openEditor(page);
    await addAndSelect(page);
    await page.locator('.hexdb-res-add[data-res-field="destroyCost"]').click();
    await page.locator('.hexdb-res-add[data-res-field="destroyIncome"]').click();
    const b = await cur(page);
    expect(b.destroyCost).toHaveLength(1);
    expect(b.destroyIncome).toHaveLength(1);
  });

  test('the block is disabled when the building cannot be destroyed', async ({ page }) => {
    await openEditor(page);
    await addAndSelect(page);
    await page.locator('#bld-f-canDestroy').uncheck();
    await expect(page.locator('.hexdb-res-add[data-res-field="destroyCost"]')).toBeDisabled();
  });
});
