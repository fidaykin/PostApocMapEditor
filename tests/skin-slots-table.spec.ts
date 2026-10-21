import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, seedServerPackage, seedHexes, seedBuildings } from './helpers';

const PKG = 'skin-pkg';
const H = (id: string, type: string, pkg?: string, extra: any = {}) =>
  ({ id, type, biome: 'Decameron', filterCategory: 'FilterTerrain', spriteName: id, terrainTypeId: -1, ...(pkg ? { package: pkg } : {}), ...extra });
const B = (id: string, type: string, pkg?: string, extra: any = {}) =>
  ({ id, type, buildingCategory: 'Standard', canBuild: true, availableTiles: [] as string[], spriteName: id, ...(pkg ? { package: pkg } : {}), ...extra });

async function setup(page: Page, hexes: object[], blds: object[] = []) {
  const gh = new FakeGitHub();
  seedServerPackage(gh, PKG, { name: 'Skin Pkg' });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page, { gh, pat: true });
  await seedHexes(page, hexes);
  await seedBuildings(page, blds);
  await page.evaluate(() => App.setMode('packages'));
}
const baseHexes = [H('SkBase_Plain_1', 'Plains', 'postapoc'), H('SkBase_Lake_1', 'Water', 'postapoc')];
const rec = (page: Page, id: string) => page.evaluate(i => HexDB.getAll().find((h: any) => h.id === i), id);
const rulesCheck = (page: Page, own: any[], base: any[], kind = 'hex') =>
  page.evaluate(([k, o, b]) => SkinSlotRules.check(k, o, b), [kind, own, base] as const);

test.describe('SkinSlotRules (pure)', () => {
  test.beforeEach(async ({ page }) => { await setup(page, []); });

  test('suggest strips the package prefix and finds the base record, case-insensitively', async ({ page }) => {
    const r = await page.evaluate(() => SkinSlotRules.suggest({ id: 'SkinPkg_plain_1' }, 'SkinPkg_', [{ id: 'Plain_1' }, { id: 'Forest_1' }]));
    expect(r.id).toBe('Plain_1');
    expect(await page.evaluate(() => SkinSlotRules.suggest({ id: 'SkinPkg_Nope_1' }, 'SkinPkg_', [{ id: 'Plain_1' }]))).toBeNull();
  });

  test('check: type mismatch, missing base and a duplicate slot are reported, a valid one is not', async ({ page }) => {
    const base = [{ id: 'Plain_1', type: 'Plains' }, { id: 'Lake_1', type: 'Water' }];
    const own = [
      { id: 'P_Plain_1', type: 'Plains', skinSlot: 'Plain_1' },
      { id: 'P_Plain_2', type: 'Plains', skinSlot: 'plain_1' },
      { id: 'P_Lake_1', type: 'Rubble', skinSlot: 'Lake_1' },
      { id: 'P_Ghost', type: 'Plains', skinSlot: 'Ghost' },
      { id: 'P_Addition', type: 'Plains' },
    ];
    const kinds = (await rulesCheck(page, own, base)).map((i: any) => `${i.id}:${i.kind}`).sort();
    expect(kinds).toEqual(['P_Ghost:nobase', 'P_Lake_1:type', 'P_Plain_2:dup']);
  });

  test('buildings: only water versus ground has to match', async ({ page }) => {
    const base = [{ id: 'Farm_1', type: 'Ground Building' }];
    const ok = await rulesCheck(page, [{ id: 'P_Farm', type: 'Artefact', skinSlot: 'Farm_1' }], base, 'bld');
    const bad = await rulesCheck(page, [{ id: 'P_Farm', type: 'Water Building', skinSlot: 'Farm_1' }], base, 'bld');
    expect(ok).toEqual([]);
    expect(bad.map((i: any) => i.kind)).toEqual(['type']);
  });

  test('coverage counts valid slots only', async ({ page }) => {
    const base = [{ id: 'A', type: 'Plains' }, { id: 'B', type: 'Plains' }];
    const own = [{ id: 'P_A', type: 'Plains', skinSlot: 'A' }, { id: 'P_B', type: 'Rubble', skinSlot: 'B' }];
    expect(await page.evaluate(([o, b]) => SkinSlotRules.coverage('hex', o, b), [own, base] as const)).toEqual({ covered: 1, total: 2 });
  });
});

test.describe('Skin slots dialog', () => {
  test('lists base records, choosing a record writes its skinSlot, choosing base used clears it', async ({ page }) => {
    await setup(page, [...baseHexes, H('SkinPkg_Plain_1', 'Plains', PKG), H('SkinPkg_Lake_1', 'Water', PKG)]);
    await page.evaluate(() => Packages.openSkinSlots('skin-pkg'));
    const row = page.locator('#skin-table-hex tr[data-slot="SkBase_Plain_1"]');
    await expect(row).toBeVisible();
    await row.locator('select.skin-pick').selectOption('SkinPkg_Plain_1');
    expect((await rec(page, 'SkinPkg_Plain_1')).skinSlot).toBe('SkBase_Plain_1');
    await expect(page.locator('#skin-cov')).toContainText('tiles 1 of');
    await page.locator('#skin-table-hex tr[data-slot="SkBase_Plain_1"] select.skin-pick').selectOption('');
    expect('skinSlot' in (await rec(page, 'SkinPkg_Plain_1'))).toBe(false);
  });

  test('moving a record to another slot frees the old one (one record per slot)', async ({ page }) => {
    await setup(page, [...baseHexes, H('SkinPkg_A', 'Plains', PKG), H('SkinPkg_B', 'Plains', PKG)]);
    await page.evaluate(() => Packages.openSkinSlots('skin-pkg'));
    const sel = page.locator('#skin-table-hex tr[data-slot="SkBase_Plain_1"] select.skin-pick');
    await sel.selectOption('SkinPkg_A');
    await page.locator('#skin-table-hex tr[data-slot="SkBase_Plain_1"] select.skin-pick').selectOption('SkinPkg_B');
    expect('skinSlot' in (await rec(page, 'SkinPkg_A'))).toBe(false);
    expect((await rec(page, 'SkinPkg_B')).skinSlot).toBe('SkBase_Plain_1');
  });

  test('suggestion by id prefix is offered and applied in one click', async ({ page }) => {
    // Package prefix of "skin-pkg" is "SkinPkg_"; ids without it name the base records.
    await setup(page, [H('Plain_1', 'Plains', 'postapoc'), H('SkinPkg_Plain_1', 'Plains', PKG)]);
    await page.evaluate(() => Packages.openSkinSlots('skin-pkg'));
    await expect(page.locator('#skin-suggest-all')).toContainText('Apply 1 suggestion');
    await page.locator('#skin-suggest-all').click();
    expect((await rec(page, 'SkinPkg_Plain_1')).skinSlot).toBe('Plain_1');
  });

  test('problems are listed', async ({ page }) => {
    await setup(page, [...baseHexes, H('SkinPkg_Bad', 'Rubble', PKG, { skinSlot: 'SkBase_Plain_1' })]);
    await page.evaluate(() => Packages.openSkinSlots('skin-pkg'));
    await expect(page.locator('#skin-issues')).toContainText('SkinPkg_Bad');
  });
});

test.describe('Publish gate', () => {
  test('a package with a Skin Slot problem cannot be published', async ({ page }) => {
    await setup(page, [...baseHexes, H('SkinPkg_Bad', 'Rubble', PKG, { skinSlot: 'SkBase_Plain_1' })]);
    expect(await page.evaluate(() => Packages.skinSlotProblems('skin-pkg'))).toHaveLength(1);
    await page.evaluate(() => Packages.openPublishConfirm('skin-pkg'));
    await expect(page.locator('.toast, #toast-host, [role="status"]').filter({ hasText: 'Skin Slot problem' }).first()).toBeVisible();
    await expect(page.locator('#publish-dialog, .modal-title:has-text("Publish Package")')).toHaveCount(0);
  });

  test('a clean package passes the gate', async ({ page }) => {
    await setup(page, [...baseHexes, H('SkinPkg_Plain_1', 'Plains', PKG, { skinSlot: 'SkBase_Plain_1' })]);
    expect(await page.evaluate(() => Packages.skinSlotProblems('skin-pkg'))).toEqual([]);
  });
});
