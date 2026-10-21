import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, seedServerPackage, seedHexes, seedBuildings } from './helpers';

// ClickUp (Buildings editor): integer-only numeric fields, id suggestions for Destroy / Tiles Type / Produce / Available
// Tiles, Parents hides the Tile ID field, unknown names are flagged.
const HEX = (id: string, type: string, pkg?: string) =>
  ({ id, type, biome: 'Summer', filterCategory: 'FilterTerrain', spriteName: id, terrainTypeId: -1, ...(pkg ? { package: pkg } : {}) });
const BLD = {
  id: 'FormTest_1', type: 'Ground Building', buildingCategory: 'Standard', canBuild: true, canDestroy: true,
  destroyTransformToMode: 'HexID', destroyTransformTo: '', availableTiles: [] as string[], additionalBuildCondition: true,
  tilesTypeMode: 'HexID', tilesTypeValue: '', canProduceEnabled: true, canProduce: [] as string[], availableTilesForProduce: [] as string[],
  price: [{ type: 'Gold', amount: 5 }], minLevel: 1, premiumPrice: 0, radius: 0, buildingRadius: 0, spriteName: 'FormTest_1',
};

async function setup(page: Page, extra: Partial<typeof BLD> = {}) {
  const gh = new FakeGitHub();
  seedServerPackage(gh, 'form-pkg', { name: 'Form Pkg' });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page, { gh });
  await seedHexes(page, [HEX('FormHex_Plain_1', 'Plains'), HEX('FormHex_Lake_1', 'Water'), HEX('FormOther_1', 'Rubble', 'form-pkg')]);
  await seedBuildings(page, [{ ...BLD, ...extra }, { ...BLD, id: 'FormOtherBld_1', package: 'form-pkg', spriteName: 'x' }]);
  await page.evaluate(() => App.setMode('buildings'));
  await page.locator('#bld-list .hexdb-list-row', { hasText: /^FormTest_1$/ }).first().click();
  await expect(page.locator('#bld-f-id')).toHaveValue('FormTest_1');
  await openSections(page);
}
// Sections start collapsed: open every one so the fields are reachable.
async function openSections(page: Page) {
  for (const sec of ['destroy', 'build', 'settings']) {
    const body = page.locator(`.hexdb-section-body[data-sec="${sec}"]`);
    if (!(await body.isVisible())) await page.locator(`.hexdb-section-hdr[data-sec="${sec}"]`).click();
  }
}
const rec = (page: Page) => page.evaluate(() => BldDB.getAll().find((b: any) => b.id === 'FormTest_1'));
const setNum = async (page: Page, id: string, v: string) => {
  const f = page.locator('#' + id);
  await f.fill(v);
  await f.dispatchEvent('change');
  return f;
};
const options = (page: Page, listId: string) =>
  page.evaluate(id => [...document.querySelectorAll(`#${id} option`)].map(o => (o as HTMLOptionElement).value), listId);

test.describe('Buildings form: integer fields', () => {
  for (const [id, key, def, max] of [['bld-f-premiumPrice', 'premiumPrice', '0', 1000000], ['bld-f-minLevel', 'minLevel', '1', 1000],
    ['bld-f-radius', 'radius', '0', 10000], ['bld-f-buildingRadius', 'buildingRadius', '0', 10000]] as const) {
    test(`${key}: fractions, signs, leading zeros and empty are cleaned`, async ({ page }) => {
      await setup(page);
      let f = await setNum(page, id, '007');
      await expect(f).toHaveValue('7');
      expect((await rec(page))[key]).toBe(7);
      f = await setNum(page, id, '3.9');
      await expect(page.locator('#' + id)).toHaveValue('3');
      f = await setNum(page, id, '-5');
      await expect(page.locator('#' + id)).toHaveValue(key === 'minLevel' ? '1' : '0');
      f = await setNum(page, id, '');
      await expect(page.locator('#' + id)).toHaveValue(def);
      f = await setNum(page, id, String(max + 500));
      await expect(page.locator('#' + id)).toHaveValue(String(max));
      expect((await rec(page))[key]).toBe(max);
    });
  }

  test('the keys . e + - , are blocked in the integer fields', async ({ page }) => {
    await setup(page);
    const f = page.locator('#bld-f-premiumPrice');
    await f.fill('');
    for (const k of ['.', 'e', '+', '-', ',']) await f.press(k);
    await f.press('4');
    await expect(f).toHaveValue('4');
  });

  test('a Price amount is cleaned the same way (already guarded)', async ({ page }) => {
    await setup(page);
    const amount = page.locator('input[data-res-field="price"][data-res-key="amount"]').first();
    await amount.fill('0012');
    await amount.dispatchEvent('change');
    await expect(amount).toHaveValue('12');
  });
});

test.describe('Buildings form: id suggestions and checks', () => {
  test('Destroy: Parents hides the Tile ID field, HexID shows it with tiles and buildings listed', async ({ page }) => {
    await setup(page);
    const tile = page.locator('#bld-f-destroyTransformTo');
    await expect(tile).toBeVisible();
    const ids = await options(page, 'blddb-ref-id-list');
    expect(ids).toEqual(expect.arrayContaining(['FormHex_Plain_1', 'FormHex_Lake_1', 'FormTest_1']));
    await page.locator('#bld-f-destroyTransformToMode').selectOption('Parents');
    await expect(page.locator('#bld-f-destroyTransformTo')).toBeHidden();
    await page.locator('#bld-f-destroyTransformToMode').selectOption('HexID');
    await expect(page.locator('#bld-f-destroyTransformTo')).toBeVisible();
  });

  test('the lists leave out ids of another package', async ({ page }) => {
    await setup(page);
    const ids = await options(page, 'blddb-ref-id-list');
    expect(ids).not.toContain('FormOther_1');
    expect(ids).not.toContain('FormOtherBld_1');
  });

  test('Tiles Type: HexID lists tile ids, Type lists tile types', async ({ page }) => {
    await setup(page);
    await expect(page.locator('#bld-f-tilesTypeValue')).toHaveAttribute('list', 'blddb-tile-id-list');
    expect(await options(page, 'blddb-tile-id-list')).toEqual(expect.arrayContaining(['FormHex_Plain_1']));
    await page.locator('#bld-f-tilesTypeMode').selectOption('Type');
    await expect(page.locator('#bld-f-tilesTypeValue')).toHaveAttribute('list', 'blddb-tile-type-list');
    expect(await options(page, 'blddb-tile-type-list')).toEqual(expect.arrayContaining(['Plains', 'Water']));
  });

  test('Available Tiles and Produce suggest ids; unknown names are flagged, known ones are not', async ({ page }) => {
    await setup(page, { availableTiles: ['FormHex_Plain_1', 'Plains', 'No_Such_Tile'], canProduce: ['FormTest_1', 'Ghost_1'] });
    await expect(page.locator('input.hexdb-tag-input[data-tags-field="availableTiles"]')).toHaveAttribute('list', 'blddb-tile-any-list');
    await expect(page.locator('input.hexdb-tag-input[data-tags-field="canProduce"]')).toHaveAttribute('list', 'blddb-ref-id-list');
    const flagged = (field: string) => page.evaluate(f => [...document.querySelectorAll(`.hexdb-tags[data-tags-field="${f}"] .hexdb-tag`)]
      .filter(t => (t as HTMLElement).style.border).map(t => t.firstChild!.textContent), field);
    expect(await flagged('availableTiles')).toEqual(['No_Such_Tile']);
    expect(await flagged('canProduce')).toEqual(['Ghost_1']);
  });

  test('autocorrecting spaces in the id adds nothing (no trailing dot)', async ({ page }) => {
    await setup(page);
    const f = page.locator('#bld-f-id');
    await f.fill('FormTest_1   ');
    await f.blur();
    await expect(f).toHaveValue('FormTest_1');
  });
});

test.describe('Buildings form: Pick… list', () => {
  test('Available Tiles: pick tile ids and types from the list, unknown typed names stay', async ({ page }) => {
    await setup(page, { availableTiles: ['Typed_Unknown'] });
    await page.locator('button.hexdb-tag-pick[data-tags-field="availableTiles"]').click();
    await expect(page.locator('#tag-picker-body')).toBeVisible();
    await page.locator('#tag-picker-search').fill('plain');
    await expect(page.locator('#tag-picker-body input[data-id="FormHex_Plain_1"]')).toBeVisible();
    await expect(page.locator('#tag-picker-body input[data-id="FormHex_Lake_1"]')).toBeHidden();
    await page.locator('#tag-picker-body input[data-id="FormHex_Plain_1"]').check();
    await page.locator('#tag-picker-search').fill('');
    await page.locator('#tag-picker-body input[data-id="Water"]').check();
    await page.locator('#tag-picker-modal button', { hasText: 'Apply' }).click();
    expect((await rec(page)).availableTiles).toEqual(['Typed_Unknown', 'FormHex_Plain_1', 'Water']);
  });

  test('Produce: lists buildings and tiles; unchecking removes the id', async ({ page }) => {
    await setup(page, { canProduce: ['FormTest_1'] });
    await page.locator('button.hexdb-tag-pick[data-tags-field="canProduce"]').click();
    await expect(page.locator('#tag-picker-body input[data-id="FormTest_1"]')).toBeChecked();
    await page.locator('#tag-picker-body input[data-id="FormTest_1"]').uncheck();
    await page.locator('#tag-picker-body input[data-id="FormHex_Lake_1"]').check();
    await page.locator('#tag-picker-modal button', { hasText: 'Apply' }).click();
    expect((await rec(page)).canProduce).toEqual(['FormHex_Lake_1']);
  });
});

test.describe('Buildings form: Tiles Type Pick…', () => {
  test('HexID mode picks a tile id, Type mode picks a type, Parents hides the button', async ({ page }) => {
    await setup(page);
    await page.locator('#bld-tilesType-pick').click();
    await page.locator('#value-picker-search').fill('lake');
    await expect(page.locator('#value-picker-body input[data-id="FormHex_Plain_1"]')).toBeHidden();
    await page.locator('#value-picker-body input[data-id="FormHex_Lake_1"]').check();
    await page.locator('#value-picker-modal button', { hasText: 'Apply' }).click();
    expect((await rec(page)).tilesTypeValue).toBe('FormHex_Lake_1');

    await page.locator('#bld-f-tilesTypeMode').selectOption('Type');
    await page.locator('#bld-tilesType-pick').click();
    await page.locator('#value-picker-body input[data-id="Plains"]').check();
    await page.locator('#value-picker-modal button', { hasText: 'Apply' }).click();
    expect((await rec(page)).tilesTypeValue).toBe('Plains');

    await page.locator('#bld-f-tilesTypeMode').selectOption('Parents');
    await expect(page.locator('#bld-tilesType-pick')).toBeHidden();
  });
});
