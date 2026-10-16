import { test, expect } from '@playwright/test';
import { seedRoadsWorld, BASE_HEXES, DEC_HEXES, bldRoads } from './roads-fixtures';

// Roads/Bridges V1, editor phase F2/F3: the tiles x types matrix modal, its own undo stack (RoadsHistory) and the bulk actions.
const M = '#roads-matrix-modal';
async function openMatrix(page: any) {
  await page.evaluate(() => App.setMode('hexdb'));
  await page.locator('#hexdb-roads-matrix-btn').click();
  await expect(page.locator(M)).toBeVisible();
  await expect.poll(() => page.locator(`${M} tbody tr`).count()).toBeGreaterThan(0);
}
const rowCount = (page: any) => page.locator(`${M} tbody tr[data-key]`).count();
async function setPkg(page: any, pkg: string, n?: number) {
  await page.locator(`${M} #rm-pkg`).selectOption(pkg);
  if (n !== undefined) await expect.poll(() => rowCount(page)).toBe(n);
}
const rec = (page: any, id: string) => page.evaluate((id: string) => { const h = HexDB.getAll().find((h: any) => h.id === id); return { has: 'allowedRoads' in h, ar: h.allowedRoads, ra: h.roadAllowed }; }, id);
const cellOf = (page: any, id: string, type: string) => page.locator(`${M} tr[data-key$="::${id}"] td[data-type-id="${type}"]`);
const depth = (page: any) => page.evaluate(() => RoadsHistory.depth());

test.describe('roads matrix modal: view, filter, per-cell edit', () => {
  test('one row per filtered tile and one column per type; the package filter shows the 60 Decameroon tiles; type filter narrows', async ({ page }) => {
    await seedRoadsWorld(page);
    await openMatrix(page);
    await expect.poll(() => rowCount(page)).toBe(BASE_HEXES.length + DEC_HEXES.length);
    expect(await page.locator(`${M} thead th[data-type-id]`).evaluateAll((e: any[]) => e.map(x => x.dataset.typeId))).toEqual(['road', 'road_2', 'bridge', 'bridge_2']);
    await setPkg(page, 'decameroon', 60);
    await page.locator(`${M} #rm-type`).selectOption('Rivers');
    await expect.poll(() => rowCount(page)).toBe(DEC_HEXES.filter(h => h.type === 'Rivers').length);
    await page.locator(`${M} #rm-search`).fill('Lake_');
    await expect.poll(() => rowCount(page)).toBe(7);
  });

  test('an unset cell first click sets [id]; toggling is one RoadsHistory step and one autosave; the map History is untouched', async ({ page }) => {
    await seedRoadsWorld(page);
    await openMatrix(page);
    await setPkg(page, 'decameroon', 60);
    const h0 = await page.evaluate(() => ({ undo: History.undoSize(), rev: HexDB.getRev() }));
    expect(await depth(page)).toBe(0);
    await cellOf(page, 'Decameroon_Plain_1', 'road').locator('button.rm-unset').click();
    expect(await rec(page, 'Decameroon_Plain_1')).toEqual({ has: true, ar: ['road'], ra: true });
    expect(await depth(page)).toBe(1);
    expect(await page.evaluate(() => HexDB.getRev())).toBe(h0.rev + 1);
    await cellOf(page, 'Decameroon_Plain_1', 'bridge').locator('input').check();
    expect(await rec(page, 'Decameroon_Plain_1')).toEqual({ has: true, ar: ['road', 'bridge'], ra: true });
    await cellOf(page, 'Decameroon_Plain_1', 'road').locator('input').uncheck();
    expect(await rec(page, 'Decameroon_Plain_1')).toEqual({ has: true, ar: ['bridge'], ra: false });
    expect(await depth(page)).toBe(3);
    expect((await page.evaluate(() => ({ undo: History.undoSize(), rev: HexDB.getRev() }))).undo).toBe(h0.undo);
    // positive control: the other tiles stay unset
    expect((await rec(page, 'Decameroon_Plain_2')).has).toBe(false);
    await expect(cellOf(page, 'Decameroon_Plain_2', 'road').locator('button.rm-unset')).toBeVisible();
  });

  test('Undo restores exactly the previous value including "unset"; Redo re-applies; Ctrl+Z / Ctrl+Y work inside the modal', async ({ page }) => {
    await seedRoadsWorld(page);
    await openMatrix(page);
    await setPkg(page, 'decameroon', 60);
    const mapUndo0 = await page.evaluate(() => History.undoSize());
    const before = await page.evaluate(() => structuredClone(HexDB.getAll().find((h: any) => h.id === 'Decameroon_Plain_1')));
    await cellOf(page, 'Decameroon_Plain_1', 'road').locator('button.rm-unset').click();
    await cellOf(page, 'Decameroon_Plain_1', 'bridge').locator('input').check();
    await page.locator(`${M} #rm-undo`).click();
    expect(await rec(page, 'Decameroon_Plain_1')).toEqual({ has: true, ar: ['road'], ra: true });
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => structuredClone(HexDB.getAll().find((h: any) => h.id === 'Decameroon_Plain_1')))).toEqual(before);   // deep-equal: no property left behind
    await expect(cellOf(page, 'Decameroon_Plain_1', 'road').locator('button.rm-unset')).toBeVisible();
    await page.locator(`${M} #rm-redo`).click();
    expect(await rec(page, 'Decameroon_Plain_1')).toEqual({ has: true, ar: ['road'], ra: true });
    await page.keyboard.press('Control+y');
    expect(await rec(page, 'Decameroon_Plain_1')).toEqual({ has: true, ar: ['road', 'bridge'], ra: true });
    await expect(cellOf(page, 'Decameroon_Plain_1', 'bridge').locator('input')).toBeChecked();
    // the global map shortcut did not run under the modal
    expect(await page.evaluate(() => History.undoSize())).toBe(mapUndo0);
  });

  test('51 steps evict the oldest', async ({ page }) => {
    await seedRoadsWorld(page);
    await openMatrix(page);
    await setPkg(page, 'decameroon', 60);
    await cellOf(page, 'Decameroon_Plain_1', 'road').locator('button.rm-unset').click();      // the oldest step
    await cellOf(page, 'Decameroon_Plain_2', 'road').locator('button.rm-unset').click();
    for (let i = 0; i < 49; i++) await cellOf(page, 'Decameroon_Plain_2', 'bridge').locator('input').click();
    expect(await depth(page)).toBe(50);
    for (let i = 0; i < 60; i++) await page.locator(`${M} #rm-undo`).click({ force: true });
    expect(await depth(page)).toBe(0);
    expect(await rec(page, 'Decameroon_Plain_1')).toEqual({ has: true, ar: ['road'], ra: true });   // evicted: cannot be undone
    expect((await rec(page, 'Decameroon_Plain_2')).has).toBe(false);
  });

  test('closing the modal clears the history', async ({ page }) => {
    await seedRoadsWorld(page);
    await openMatrix(page);
    await cellOf(page, 'Plain_1', 'road').locator('button.rm-unset').click();
    expect(await depth(page)).toBe(1);
    await page.locator(M).getByRole('button', { name: 'Close' }).click();
    await expect(page.locator(M)).toHaveCount(0);
    expect(await depth(page)).toBe(0);
    expect((await rec(page, 'Plain_1')).ar).toEqual(['road']);
  });

  test('600 tiles: the first chunk renders at once, the rest follow in chunks', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => {
      const hexes = Array.from({ length: 600 }, (_, i) => ({ id: 'Bulk_' + i, type: 'Plains', biome: 'Summer', spriteName: 'Plain_1', allowedRoads: [] }));
      HexDB.loadFromObject({ version: 1, common: { goldPerTap: 10 }, hexes });
    });
    const first = await page.evaluate(() => { HexDB.openRoadsMatrix(); return document.querySelectorAll('#roads-matrix-modal tbody tr[data-key]').length; });
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(100);
    await expect.poll(() => rowCount(page)).toBe(600);
  });
});
