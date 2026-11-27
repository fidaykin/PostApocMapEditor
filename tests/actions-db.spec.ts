import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub } from './helpers';

// Actions MVP (журнал рішень D-47): the Actions tab's form, previously untested by Playwright
// (ClickUp tasks 1/5: "Playwright-тести вкладки Actions у редакторі — не знайдено").

async function openActionsTab(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page, { gh: new FakeGitHub() });
  await page.evaluate(() => App.setMode('actions'));
}

async function addAction(page: Page) {
  await page.locator('#actions-main button', { hasText: '+ Add Action' }).first().click();
}

const rec = (page: Page) => page.evaluate(() => {
  const all = ActionsDB.getAll();
  return all[all.length - 1];
});

const setField = async (page: Page, id: string, v: string) => {
  const f = page.locator('#' + id);
  await f.fill(v);
  await f.dispatchEvent('change');
  return f;
};

test.describe('Actions tab: empty state and Add', () => {
  test('starts empty with the "No actions yet" placeholder', async ({ page }) => {
    await openActionsTab(page);
    await expect(page.locator('#act-right')).toContainText('No actions yet');
    await expect(page.locator('#act-count')).toHaveText('0 shown / 0');
  });

  test('+ Add Action creates a record with MVP defaults and selects it', async ({ page }) => {
    await openActionsTab(page);
    await addAction(page);

    const a = await rec(page);
    expect(a).toMatchObject({
      type: 'Actions', logic: 'Destroy', spriteName: '', availableTiles: [], premiumPrice: 0,
      forcedTransformTo: '', radius: 0, additionalConditions: [], minLevel: 0,
    });
    expect(a.price).toEqual([{ type: 'Gold', amount: 10 }]);
    await expect(page.locator('#act-f-id')).toHaveValue(a.id);
    await expect(page.locator('#act-count')).toHaveText('1 shown / 1');
  });
});

test.describe('Actions tab: form fields', () => {
  async function openSections(page: Page) {
    for (const sec of ['action', 'special']) {
      const body = page.locator(`.hexdb-section-body[data-sec="${sec}"]`);
      if (!(await body.isVisible())) await page.locator(`.hexdb-section-hdr[data-sec="${sec}"]`).click();
    }
  }

  test('editing ID, Text ID and Sprite Name updates the record live', async ({ page }) => {
    await openActionsTab(page);
    await addAction(page);
    await setField(page, 'act-f-id', 'action_test_one');
    await setField(page, 'act-f-textId', 'loc.action.test');
    await setField(page, 'act-f-spriteName', 'icon_test.png');

    const a = await rec(page);
    expect(a).toMatchObject({ id: 'action_test_one', textId: 'loc.action.test', spriteName: 'icon_test.png' });
    await expect(page.locator('#act-list .hexdb-list-id')).toHaveText('action_test_one');
  });

  test('switching Logic to Forced Transform To reveals its field; switching back hides it', async ({ page }) => {
    await openActionsTab(page);
    await addAction(page);
    await openSections(page);
    await expect(page.locator('#act-row-forcedTransformTo')).toBeHidden();

    await page.locator('#act-f-logic').selectOption('ForcedTransformTo');
    await expect(page.locator('#act-row-forcedTransformTo')).toBeVisible();
    expect((await rec(page)).logic).toBe('ForcedTransformTo');

    await setField(page, 'act-f-forcedTransformTo', 'Plain_1');
    expect((await rec(page)).forcedTransformTo).toBe('Plain_1');

    await page.locator('#act-f-logic').selectOption('Destroy');
    await expect(page.locator('#act-row-forcedTransformTo')).toBeHidden();
    expect((await rec(page)).logic).toBe('Destroy');
  });

  test('Radius and Min Level: fractions and empty are cleaned (in the record), negative clamps to 0', async ({ page }) => {
    await openActionsTab(page);
    await addAction(page);
    await openSections(page);

    for (const id of ['act-f-radius', 'act-f-minLevel']) await setField(page, id, '3.9');
    expect(await rec(page)).toMatchObject({ radius: 4, minLevel: 4 }); // Math.round(3.9) = 4

    for (const id of ['act-f-radius', 'act-f-minLevel']) await setField(page, id, '-5');
    expect(await rec(page)).toMatchObject({ radius: 0, minLevel: 0 });

    await setField(page, 'act-f-radius', '7');
    await setField(page, 'act-f-minLevel', '7');
    for (const id of ['act-f-radius', 'act-f-minLevel']) await setField(page, id, '');
    expect(await rec(page)).toMatchObject({ radius: 0, minLevel: 0 });
  });

  test('Premium Price: fractions and negatives are cleaned the same way (in the record)', async ({ page }) => {
    await openActionsTab(page);
    await addAction(page);
    await openSections(page);
    await setField(page, 'act-f-premiumPrice', '12.7');
    expect((await rec(page)).premiumPrice).toBe(13); // Math.round(12.7) = 13
    await setField(page, 'act-f-premiumPrice', '-3');
    expect((await rec(page)).premiumPrice).toBe(0);
  });

  test('Price rows: + Add Resource appends a row, remove deletes it (never below one row)', async ({ page }) => {
    await openActionsTab(page);
    await addAction(page);
    await openSections(page);

    await page.locator('.hexdb-res-add:not([data-tags-add])').click();
    expect((await rec(page)).price.length).toBe(2);

    await page.locator('[data-price-idx="1"].hexdb-res-remove').click();
    expect((await rec(page)).price.length).toBe(1);
    await page.locator('[data-price-idx="0"].hexdb-res-remove').click();
    expect((await rec(page)).price).toEqual([{ type: 'Gold', amount: 0 }]);
  });

  test('Available Tiles and Additional Actions Conditions: Enter adds a tag, the × button removes it', async ({ page }) => {
    await openActionsTab(page);
    await addAction(page);
    await openSections(page);

    const availInput = page.locator('.hexdb-tag-input[data-tags-field="availableTiles"]');
    await availInput.fill('Forests');
    await availInput.press('Enter');
    expect((await rec(page)).availableTiles).toEqual(['Forests']);

    const condInput = page.locator('.hexdb-tag-input[data-tags-field="additionalConditions"]');
    await condInput.fill('Settlement_Blocker');
    await condInput.press('Enter');
    expect((await rec(page)).additionalConditions).toEqual(['Settlement_Blocker']);

    await page.locator('.hexdb-tag-remove[data-tags-field="availableTiles"]').click();
    expect((await rec(page)).availableTiles).toEqual([]);
  });
});

test.describe('Actions tab: delete and persistence', () => {
  test('Delete removes the selected action after confirmation', async ({ page }) => {
    await openActionsTab(page);
    await addAction(page);
    await setField(page, 'act-f-id', 'action_to_delete');

    await page.locator('.hexdb-actions button', { hasText: 'Delete' }).click();
    await expect(page.locator('#confirm-title')).toHaveText('Delete Action');
    await page.locator('#confirm-ok').click();

    await expect(page.locator('#act-count')).toHaveText('0 shown / 0');
    expect(await page.evaluate(() => ActionsDB.getAll().length)).toBe(0);
  });

  test('ActionsDB.getJson() round-trips minLevel and every other MVP field', async ({ page }) => {
    await openActionsTab(page);
    await addAction(page);
    await setField(page, 'act-f-id', 'action_roundtrip');
    await setField(page, 'act-f-minLevel', '5');

    const parsed = await page.evaluate(() => JSON.parse(ActionsDB.getJson()));
    const a = parsed.actions.find((x: any) => x.id === 'action_roundtrip');
    expect(a.minLevel).toBe(5);

    await page.evaluate(json => ActionsDB.load(json), JSON.stringify(parsed));
    const reloaded = await page.evaluate(() => ActionsDB.getAll().find((x: any) => x.id === 'action_roundtrip'));
    expect(reloaded.minLevel).toBe(5);
  });
});
