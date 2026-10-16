import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { bldRoads, BASE_HEXES, DEC_HEXES, SPEC8, ROAD_IDS } from './roads-fixtures';

// RoadPerms: the pure helpers of Roads/Bridges V1 (no DOM, no HexDB/BldDB state). Driven through page.evaluate on a bare editor.
test.describe('RoadPerms pure helpers', () => {
  test.beforeEach(async ({ page }) => { await openEditor(page); });

  test('typesFrom: base-package roads and bridges in Building DB order; a both-flags entry is listed under roads only', async ({ page }) => {
    const r = await page.evaluate((b) => {
      const mixed = [{ id: 'house', package: 'postapoc' }, b[2], b[0], { id: 'both', isRoad: true, buildingCategory: 'Bridge' }, { id: 'pkg_road', isRoad: true, package: 'decameroon' }, b[1], b[3]];
      const t = RoadPerms.typesFrom(mixed);
      return { roads: t.roads.map((x: any) => x.id), bridges: t.bridges.map((x: any) => x.id), order: t.order };
    }, bldRoads());
    expect(r.roads).toEqual(['road', 'both', 'road_2']);
    expect(r.bridges).toEqual(['bridge', 'bridge_2']);
    expect(r.order).toEqual(['bridge', 'road', 'both', 'road_2', 'bridge_2']);
  });

  test('normalize: trims, dedupes, keeps order; non-arrays mean "not set" (null)', async ({ page }) => {
    const r = await page.evaluate(() => ({
      a: RoadPerms.normalize(['road', 'road', ' bridge ']),
      b: RoadPerms.normalize(null), c: RoadPerms.normalize('road'), d: RoadPerms.normalize({}), e: RoadPerms.normalize([]),
      f: RoadPerms.normalize(['road', 'road', 7, '']),
    }));
    expect(r).toEqual({ a: ['road', 'bridge'], b: null, c: null, d: null, e: [], f: ['road'] });
  });

  test('sortLike: Building DB order, unknown ids last in their original order', async ({ page }) => {
    const r = await page.evaluate((b) => {
      const t = RoadPerms.typesFrom(b);
      return { s: RoadPerms.sortLike(['bridge_2', 'zzz', 'road_2', 'aaa', 'road'], t), same: RoadPerms.sortLike(['road'], t) };
    }, bldRoads());
    expect(r.s).toEqual(['road', 'road_2', 'bridge_2', 'zzz', 'aaa']);
    expect(r.same).toEqual(['road']);
  });

  test('deriveRoadAllowed: true iff a listed id is a road (bridges and unknown ids do not count)', async ({ page }) => {
    const r = await page.evaluate((b) => {
      const t = RoadPerms.typesFrom(b), d = (l: string[]) => RoadPerms.deriveRoadAllowed(l, t);
      return { bridgeOnly: d(['bridge']), mixed: d(['bridge', 'road_2']), empty: d([]), unknown: d(['road_old']), road: d(['road']), water: d(['bridge_2']),
        noTypesYet: RoadPerms.deriveRoadAllowed(['road'], RoadPerms.typesFrom([])), noTypesEmpty: RoadPerms.deriveRoadAllowed([], RoadPerms.typesFrom([])) };
    }, bldRoads());
    expect(r).toEqual({ bridgeOnly: false, mixed: true, empty: false, unknown: false, road: true, water: false, noTypesYet: true, noTypesEmpty: false });
  });

  test('isWaterLike and stateOf', async ({ page }) => {
    const r = await page.evaluate(() => ({
      w: ['Rivers', 'Water', 'Plains'].map(type => RoadPerms.isWaterLike({ type })),
      s: [{}, { allowedRoads: null }, { allowedRoads: 'road' }, { allowedRoads: [] }, { allowedRoads: ['road'] }].map(h => RoadPerms.stateOf(h)),
      legacy: [RoadPerms.LEGACY_ROAD_ENUM_IDS, RoadPerms.LEGACY_ROAD_TERRAIN_IDS],
    }));
    expect(r.w).toEqual([true, true, false]);
    expect(r.s).toEqual(['unset', 'unset', 'unset', 'none', 'some']);
    expect(r.legacy).toEqual([['Plain_1', 'Plain_2', 'Rubble_1', 'Rubble_2', 'Rubble_3'], [9, 10, 11, 12, 13]]);
  });

  // validate: each rule fires on a minimal input and not on the control
  const run = (page: any, hexes: any[], buildings: any[], scope?: any) =>
    page.evaluate(({ hexes, buildings, scope }: any) => {
      const v = RoadPerms.validate({ hexes, buildings, scope });
      return { errors: v.errors.map((x: any) => x.rule + ':' + x.hexId), warnings: v.warnings.map((x: any) => x.rule + ':' + x.hexId), all: [...v.errors, ...v.warnings] };
    }, { hexes, buildings, scope });
  const H = (id: string, type: string, allowedRoads?: any, extra: object = {}) => ({ id, type, ...(allowedRoads === undefined ? {} : { allowedRoads }), ...extra });

  test('unknown-id (error) fires for road_old, not for a known id', async ({ page }) => {
    expect((await run(page, [H('A', 'Plains', ['road_old'])], bldRoads())).errors).toEqual(['unknown-id:A']);
    expect((await run(page, [H('A', 'Plains', ['road'])], bldRoads())).errors).toEqual([]);
  });

  test('duplicate (error, fix dedupe) fires for a repeated id only', async ({ page }) => {
    const r = await run(page, [H('A', 'Plains', ['road', 'road'])], bldRoads());
    expect(r.errors).toEqual(['duplicate:A']);
    expect(r.all[0].fix).toBe('dedupe');
    expect((await run(page, [H('A', 'Plains', ['road', 'road_2'])], bldRoads())).errors).toEqual([]);
  });

  test('bridge-on-land and road-on-water are warnings (decision D6), not errors; controls are clean', async ({ page }) => {
    const land = await run(page, [H('A', 'Plains', ['bridge'])], bldRoads());
    expect(land.warnings).toEqual(['bridge-on-land:A']); expect(land.errors).toEqual([]);
    const wet = await run(page, [H('A', 'Rivers', ['road'])], bldRoads());
    expect(wet.warnings).toEqual(['road-on-water:A']); expect(wet.errors).toEqual([]);
    const ok = await run(page, [H('A', 'Rivers', ['bridge']), H('B', 'Plains', ['road'])], bldRoads());
    expect(ok.warnings).toEqual([]);
  });

  test('both-flags (error) fires for isRoad + Bridge, not for a plain road', async ({ page }) => {
    const both = { id: 'x', isRoad: true, buildingCategory: 'Bridge', package: 'postapoc' };
    expect((await run(page, [], [...bldRoads(), both])).errors).toEqual(['both-flags:x']);
    expect((await run(page, [], bldRoads())).errors).toEqual([]);
  });

  test('road-in-package-bld (error) fires for a road or bridge in a non-base package', async ({ page }) => {
    const r = await run(page, [], [...bldRoads(), { id: 'pr', isRoad: true, package: 'decameroon' }, { id: 'pb', buildingCategory: 'Bridge', package: 'decameroon' }, { id: 'house', package: 'decameroon' }]);
    expect(r.errors.sort()).toEqual(['road-in-package-bld:pb', 'road-in-package-bld:pr']);
  });

  test('tiles-not-empty (warning, fix clear-tiles) fires for a road with availableTiles, not for a house', async ({ page }) => {
    const b = bldRoads(); b[0].availableTiles = ['Plain_1'];
    const r = await run(page, [], [...b, { id: 'house', availableTiles: ['Plain_1'] }]);
    expect(r.warnings).toEqual(['tiles-not-empty:road']);
    expect(r.all[0].fix).toBe('clear-tiles');
  });

  test('water-bridge-no-under (warning) fires for a bridge on Water without underTerrainId; bridge_2 with it is clean', async ({ page }) => {
    const r = await run(page, [H('W', 'Water', ['bridge'])], bldRoads());
    expect(r.warnings).toEqual(['water-bridge-no-under:W']);
    expect((await run(page, [H('W', 'Water', ['bridge_2'])], bldRoads())).warnings).toEqual([]);
  });

  test('unset (error) fires only with scope.requireField', async ({ page }) => {
    expect((await run(page, [H('A', 'Plains')], bldRoads())).errors).toEqual([]);
    expect((await run(page, [H('A', 'Plains')], bldRoads(), { requireField: true })).errors).toEqual(['unset:A']);
    expect((await run(page, [H('A', 'Plains', [])], bldRoads(), { requireField: true })).errors).toEqual([]);
  });

  test('scope.pkg limits hex and building rules to that package', async ({ page }) => {
    const hexes = [H('A', 'Plains', ['road_old']), H('Decameroon_A', 'Plains', ['road_old'], { package: 'decameroon' })];
    expect((await run(page, hexes, bldRoads(), { pkg: 'decameroon' })).errors).toEqual(['unknown-id:Decameroon_A']);
    expect((await run(page, hexes, bldRoads(), { pkg: 'postapoc' })).errors).toEqual(['unknown-id:A']);
  });

  test('override-differs (warning, fix take-base) fires when a package same-id record differs from the base one', async ({ page }) => {
    const base = H('Plain_1', 'Plains', ['road']);
    const diff = H('Plain_1', 'Plains', ['road_2'], { package: 'decameroon' });
    const same = H('Plain_1', 'Plains', ['road'], { package: 'decameroon' });
    const r = await run(page, [base, diff], bldRoads());
    expect(r.warnings).toEqual(['override-differs:Plain_1']); expect(r.all[0].fix).toBe('take-base');
    expect((await run(page, [base, same], bldRoads())).warnings).toEqual([]);
  });

  test('the spec section 8 world validates with zero errors and zero warnings (positive control: a broken copy does not)', async ({ page }) => {
    const hexes = [...BASE_HEXES, ...DEC_HEXES].map(h => ({ ...h }));
    for (const h of hexes) if (h.package === 'decameroon') h.allowedRoads = Object.keys(SPEC8).filter(t => SPEC8[t].includes(h.id));
    for (const h of hexes) if (h.package !== 'decameroon') h.allowedRoads = [];
    const clean = await run(page, hexes, bldRoads(), { requireField: true });
    expect(clean.errors).toEqual([]); expect(clean.warnings).toEqual([]);
    hexes.find(h => h.id === 'Decameroon_Plain_1')!.allowedRoads.push(ROAD_IDS.bridge);
    expect((await run(page, hexes, bldRoads(), { requireField: true })).warnings).toEqual(['bridge-on-land:Decameroon_Plain_1']);
  });
});
