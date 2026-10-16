import { test, expect } from '@playwright/test';
import { seedRoadsWorld, BASE_HEXES, DEC_HEXES } from './roads-fixtures';

// Roads/Bridges V1, editor phase F4: Backfill roads (explicit, never automatic; fills only the missing lists).
const M = '#roads-matrix-modal';

/** Live-like base: the trimmed base set with the 29 live rivers (no Lake_1/River_L_1 duplicates), 6 road tiles. */
const LIVE_RIVERS = DEC_HEXES.filter(h => h.type === 'Rivers').map(h => ({ ...h, id: h.id.replace('Decameroon_', ''), package: undefined, biome: 'Summer', spriteName: h.id.replace('Decameroon_', '') }));
const liveBase = () => [...BASE_HEXES.filter(h => h.type !== 'Rivers'), ...LIVE_RIVERS].map(h => { const c: any = { ...h }; if (c.package === undefined) delete c.package; return c; });
async function loadBase(page: any, hexes: any[]) {
  await page.evaluate((hexes: any[]) => HexDB.loadFromObject({ version: 1, common: { goldPerTap: 10 }, hexes }), hexes);
}
const listsById = (page: any, pkg = 'postapoc') => page.evaluate((pkg: string) => Object.fromEntries(HexDB.getAll().filter((h: any) => (h.package || 'postapoc') === pkg).map((h: any) => [h.id, 'allowedRoads' in h ? h.allowedRoads : 'UNSET'])), pkg);

test.describe('RoadPerms.backfillPlan (the rule)', () => {
  test('enum ids (case-insensitive) get road, the flag counts only for terrainTypeId < 0 or 9..13, Rivers get bridge, the rest []; an existing list is untouched', async ({ page }) => {
    await seedRoadsWorld(page);
    const r = await page.evaluate(() => {
      const mk = (id: string, type: string, extra: object = {}) => ({ id, type, terrainTypeId: -1, roadAllowed: false, ...extra });
      const hs = [
        mk('Plain_1', 'Plains', { terrainTypeId: 12 }), mk('plain_2', 'Plains', { terrainTypeId: 13 }), mk('Rubble_3', 'Rubble', { terrainTypeId: 11 }),
        mk('Plain_Kaiju_1', 'Plains', { terrainTypeId: 12, roadAllowed: true }),
        mk('Custom_Flag', 'Plains', { roadAllowed: true }),                         // flag, no terrain id yet: counts
        mk('Hills_1', 'Hills/Mountains', { terrainTypeId: 18 }),
        mk('Custom_OtherTerrain', 'Plains', { terrainTypeId: 18, roadAllowed: true }),   // flag but a terrain outside 9..13: no
        mk('Plain_X', 'Plains', { terrainTypeId: 12 }),                             // 12 but not an enum id and flag false: no
        mk('River_1', 'Rivers'), mk('Water_1', 'Water'),
        mk('Plain_Has', 'Plains', { allowedRoads: ['bridge_2'] }),                  // existing list: never touched
        mk('Plain_1', 'Plains', { allowedRoads: [] }),
      ];
      return RoadPerms.backfillPlan(hs).map((c: any) => [c.hex.id, c.list]);
    });
    expect(r).toEqual([
      ['Plain_1', ['road']], ['plain_2', ['road']], ['Rubble_3', ['road']], ['Plain_Kaiju_1', ['road']], ['Custom_Flag', ['road']],
      ['Hills_1', []], ['Custom_OtherTerrain', []], ['Plain_X', []], ['River_1', ['bridge']], ['Water_1', []],
    ]);
  });
});

test.describe('Backfill on the live-like data', () => {
  test('nothing is filled at load; Backfill gives road to exactly 6 base tiles and bridge to the 29 rivers; a second run changes nothing; one undo step', async ({ page }) => {
    await seedRoadsWorld(page);
    await loadBase(page, liveBase());
    expect(await page.evaluate(() => HexDB.getAll().filter((h: any) => 'allowedRoads' in h).length)).toBe(0);   // never automatic
    expect(await page.evaluate(() => RoadPerms.writeMode())).toBe('off');
    const before = await page.evaluate(() => JSON.stringify(HexDB.getAll()));
    const s0 = await page.evaluate(() => ({ d: RoadsHistory.depth(), rev: HexDB.getRev() }));
    const res = await page.evaluate(() => HexDB.backfillRoads({ pkg: 'postapoc' }));
    expect(res).toMatchObject({ changed: liveBase().length, road: 6, bridge: 29 });
    const l = await listsById(page);
    expect(Object.entries(l).filter(([, v]) => (v as string[]).includes('road')).map(([k]) => k).sort())
      .toEqual(['Plain_1', 'Plain_2', 'Plain_Kaiju_1', 'Rubble_1', 'Rubble_2', 'Rubble_3']);
    expect(Object.entries(l).filter(([, v]) => (v as string[]).includes('bridge')).length).toBe(29);
    for (const id of ['Hills_1', 'Mountain_1', 'Swamp_1', 'Water_1']) expect(l[id]).toEqual([]);
    expect(await page.evaluate(() => ({ d: RoadsHistory.depth(), rev: HexDB.getRev() }))).toEqual({ d: s0.d + 1, rev: s0.rev + 1 });
    // derived legacy flag follows (Plain_Kaiju_1 stays true, bridges do not turn it on)
    expect(await page.evaluate(() => HexDB.getAll().filter((h: any) => h.roadAllowed).length)).toBe(6);
    // second run: nothing
    const again = await page.evaluate(() => HexDB.backfillRoads({ pkg: 'postapoc' }));
    expect(again.changed).toBe(0);
    expect(await page.evaluate(() => RoadsHistory.depth())).toBe(s0.d + 1);
    expect(await page.evaluate(() => RoadPerms.coverage(HexDB.getAll()))).toMatchObject({ unset: 0 });
    await page.evaluate(() => RoadsHistory.undo());
    expect(await page.evaluate(() => JSON.stringify(HexDB.getAll()))).toBe(before);
  });

  test('Decameroon after spec step 0 (7 tiles with roadAllowed true): road on exactly those 7, bridge on all 29 rivers; other packages are not touched', async ({ page }) => {
    await seedRoadsWorld(page);
    const seven = ['Plain_1', 'Plain_2', 'Rubble_1', 'Rubble_2', 'Rubble_3', 'Desert_1', 'Barren_1'].map(n => 'Decameroon_' + n);
    await page.evaluate((seven: string[]) => { HexDB.getAll().forEach((h: any) => { if (seven.includes(h.id)) h.roadAllowed = true; }); }, seven);
    const baseBefore = await page.evaluate(() => JSON.stringify(HexDB.getAll().filter((h: any) => !h.package)));
    const res = await page.evaluate(() => HexDB.backfillRoads({ pkg: 'decameroon' }));
    expect(res).toMatchObject({ changed: 60, road: 7, bridge: 29 });
    const l = await listsById(page, 'decameroon');
    expect(Object.entries(l).filter(([, v]) => (v as string[]).includes('road')).map(([k]) => k).sort()).toEqual([...seven].sort());
    expect(await page.evaluate(() => JSON.stringify(HexDB.getAll().filter((h: any) => !h.package)))).toBe(baseBefore);
  });

  test('records with a list are never touched, even if the rule would say otherwise (positive control: the unset one is filled)', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => HexDB.setAllowedRoads('decameroon::Decameroon_Plain_1', ['bridge_2']));
    await page.evaluate(() => { HexDB.getAll().find((h: any) => h.id === 'Decameroon_Plain_1').roadAllowed = true; HexDB.getAll().find((h: any) => h.id === 'Decameroon_Plain_2').roadAllowed = true; });
    await page.evaluate(() => HexDB.backfillRoads({ pkg: 'decameroon' }));
    const l = await listsById(page, 'decameroon');
    expect(l['Decameroon_Plain_1']).toEqual(['bridge_2']);
    expect(l['Decameroon_Plain_2']).toEqual(['road']);
  });
});

test.describe('Backfill dialog in the matrix', () => {
  test('preview shows counts and the tiles getting road; Cancel changes nothing; Apply is one undo step', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => App.setMode('hexdb'));
    await page.locator('#hexdb-roads-matrix-btn').click();
    await expect.poll(() => page.locator(`${M} tbody tr`).count()).toBeGreaterThan(0);
    await page.locator(`${M} #rm-backfill`).click();
    const dlg = page.locator('#roads-backfill-modal');
    await expect(dlg).toBeVisible();
    await dlg.locator('#rb-scope').selectOption('postapoc');
    await expect(dlg.locator('#rb-summary')).toContainText('bridge');
    await expect(dlg.locator('#rb-road-list')).toContainText('Plain_1');
    const before = await page.evaluate(() => JSON.stringify(HexDB.getAll()));
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(dlg).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify(HexDB.getAll()))).toBe(before);
    expect(await page.evaluate(() => RoadsHistory.depth())).toBe(0);
    await page.locator(`${M} #rm-backfill`).click();
    await page.locator('#roads-backfill-modal #rb-scope').selectOption('decameroon');
    await page.locator('#roads-backfill-modal').getByRole('button', { name: 'Backfill' }).click();
    await expect(page.locator('#roads-backfill-modal')).toHaveCount(0);
    expect(await page.evaluate(() => RoadsHistory.depth())).toBe(1);
    expect(await page.evaluate(() => HexDB.getAll().filter((h: any) => h.package === 'decameroon' && !Array.isArray(h.allowedRoads)).length)).toBe(0);
    expect(await page.evaluate(() => HexDB.getAll().filter((h: any) => !h.package && 'allowedRoads' in h).length)).toBe(0);   // scope respected
    await page.locator(`${M} #rm-undo`).click();
    expect(await page.evaluate(() => JSON.stringify(HexDB.getAll()))).toBe(before);
  });
});
