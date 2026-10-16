import { Page, expect } from '@playwright/test';
import { FakeGitHub, openEditor, seedServerPackage } from './helpers';

// Shared fixture of the Roads/Bridges V1 specs (plan 2026-10-15-roads-v1-editor-e-f.md). The checkout's root
// hex_database.json / building_database.json are stale, so no roads spec may rely on them: every spec seeds this world.
// Live ids and types verified by GET of packages/decameroon/hex_database.json and packages/postapoc/*.json (2026-10-15).

/** Decision D3: the ONLY place that names the road/bridge building ids. */
export const ROAD_IDS = { road: 'road', road2: 'road_2', bridge: 'bridge', bridge2: 'bridge_2' };

const gold = (n: number) => [{ type: 'Gold', amount: n }];

/** The four launch types, as Building DB records (Building DB order: road, road_2, bridge, bridge_2). */
export function bldRoads(): any[] {
  const base = { package: 'postapoc', textId: '', canBuild: true, availableTiles: [] as string[], premiumPrice: 0 };
  return [
    { ...base, id: ROAD_IDS.road, spriteName: 'road_hex_36_NS', buildingCategory: 'Standard', isRoad: true, price: gold(50), textId: 'building_road' },
    { ...base, id: ROAD_IDS.road2, spriteName: 'road_hex_36_NS', buildingCategory: 'Standard', isRoad: true, price: gold(75) },
    { ...base, id: ROAD_IDS.bridge, spriteName: 'Road_Bridge_NEWS_1', buildingCategory: 'Bridge', isRoad: false, price: gold(6500) },
    { ...base, id: ROAD_IDS.bridge2, spriteName: 'Road_Bridge_NEWS_1', buildingCategory: 'Bridge', isRoad: false, price: gold(9000), underTerrainId: 'Decameroon_Water_1' },
  ];
}

const DEC_RAW: [string, string][] = [
  ['SettementsBig_1', 'Special'], ['Settlements_1', 'Special'], ['Forest_1', 'Forests'], ['Plain_1', 'Plains'], ['Plain_2', 'Plains'],
  ['Forest_2', 'Forests'], ['Forest_3', 'Forests'], ['Hills_1', 'Hills/Mountains'], ['Mountain_1', 'Hills/Mountains'],
  ['Rubble_1', 'Rubble'], ['Rubble_2', 'Rubble'], ['Rubble_3', 'Rubble'], ['GoldVein_1', 'Resources'], ['Grain_1', 'Resources'],
  ['Herbs_1', 'Resources'], ['Desert_1', 'Barren/Desert'], ['Barren_1', 'Barren/Desert'], ['Mountain_2', 'Hills/Mountains'],
  ['Water_1', 'Water'], ['DirtyWater_1', 'Water'], ['SilverVein_1', 'Resources'], ['GemField_1', 'Resources'],
  ['DestroyedBuilding_1', 'Rubble'], ['WaterStones_1', 'Water'], ['BrokenShip_1', 'Water'], ['Fish_1', 'Water'],
  ['Lake_1', 'Rivers'], ['Lake_2', 'Rivers'], ['Lake_3', 'Rivers'], ['Lake_4', 'Rivers'], ['Lake_5', 'Rivers'], ['Lake_6', 'Rivers'], ['Lake_7', 'Rivers'],
  ['Lava_Plain_1', 'Volcanic/Rift'], ['Lava_Rift_1', 'Volcanic/Rift'], ['Swamp_1', 'Swamp'], ['RockySwamp_1', 'Swamp'],
  ['River_D_2', 'Rivers'], ['River_D_3', 'Rivers'], ['River_D_4', 'Rivers'], ['River_D_L_EE_2', 'Rivers'], ['River_D_L_RE_2', 'Rivers'],
  ['River_L_1', 'Rivers'], ['River_L_4', 'Rivers'], ['River_L_5', 'Rivers'], ['River_L_D_E_1', 'Rivers'], ['River_L_L_E_5', 'Rivers'],
  ['River_L_R_E_5', 'Rivers'], ['River_L_U_E_1', 'Rivers'], ['River_R_1', 'Rivers'], ['River_R_4', 'Rivers'], ['River_R_5', 'Rivers'],
  ['River_U_2', 'Rivers'], ['River_U_3', 'Rivers'], ['River_U_4', 'Rivers'], ['River_U_D_E_4', 'Rivers'], ['River_U_L_EE_2', 'Rivers'],
  ['River_U_R_EE_2', 'Rivers'], ['River_U_U_E_4', 'Rivers'], ['Rift_1', 'Volcanic/Rift'],
];

const CATEGORY: Record<string, string> = {
  Water: '💧 WATER / RIVER', Rivers: '💧 WATER / RIVER', Plains: '🌾 PLAINS', Rubble: '🏚️ RUBBLE/WASTELAND', Forests: '🌲 FOREST',
  'Hills/Mountains': '⛰️ ROCKY/MOUNTAIN', Resources: '💎 RESOURCES', 'Barren/Desert': '🏜️ BARREN/DESERT', Swamp: '🟫 SWAMP', 'Volcanic/Rift': '🌋 VOLCANIC/RIFT',
};

const hexBase = (id: string, type: string, extra: object = {}) => ({
  id, textId: '', type, biome: 'Summer', filterCategory: 'FilterTerrain', spriteName: id, category: CATEGORY[type] ?? '',
  terrainTypeId: -1, fallback: false, roadAllowed: false, edgeFaces: [], ...extra,
});

/** The 60 live Decameroon tiles (full ids, terrainTypeId -1, roadAllowed false, package decameroon). */
export const DEC_HEXES: any[] = DEC_RAW.map(([n, t]) =>
  hexBase('Decameroon_' + n, t, { biome: 'Decameron', package: 'decameroon' }));

/** Trimmed live base set (real terrainTypeId: Rubble_1..3 = 9..11, Plain_1/2 = 12/13). */
export const BASE_HEXES: any[] = [
  hexBase('Plain_1', 'Plains', { terrainTypeId: 12 }), hexBase('Plain_2', 'Plains', { terrainTypeId: 13 }),
  hexBase('Rubble_1', 'Rubble', { terrainTypeId: 9 }), hexBase('Rubble_2', 'Rubble', { terrainTypeId: 10 }), hexBase('Rubble_3', 'Rubble', { terrainTypeId: 11 }),
  hexBase('Plain_Kaiju_1', 'Plains', { terrainTypeId: 12, roadAllowed: true }),
  hexBase('Hills_1', 'Hills/Mountains', { terrainTypeId: 18 }), hexBase('Mountain_1', 'Hills/Mountains', { terrainTypeId: 19 }),
  hexBase('Swamp_1', 'Swamp', { terrainTypeId: 24 }),
  hexBase('River_L_1', 'Rivers', { terrainTypeId: 40 }), hexBase('Lake_1', 'Rivers', { terrainTypeId: 41 }),
  hexBase('Water_1', 'Water', { terrainTypeId: 30 }),
];

/** Spec section 8, item 6 (the authors' lists), as full ids. */
const dec = (names: string[]) => names.map(n => 'Decameroon_' + n);
export const SPEC8: Record<string, string[]> = {
  [ROAD_IDS.road]: dec(['Plain_1', 'Plain_2', 'Rubble_1', 'Rubble_2', 'Rubble_3', 'Desert_1', 'Barren_1']),
  [ROAD_IDS.road2]: dec(['Plain_1', 'Plain_2', 'Rubble_1']),
  [ROAD_IDS.bridge]: dec(['River_L_1', 'River_L_4', 'River_D_2', 'River_D_4', 'River_L_5', 'River_L_D_E_1', 'River_L_L_E_5', 'River_L_R_E_5',
    'River_L_U_E_1', 'River_R_1', 'River_R_4', 'River_R_5', 'River_U_2', 'River_U_4', 'River_U_D_E_4']),
  [ROAD_IDS.bridge2]: dec(['Water_1', 'Fish_1', 'DirtyWater_1']),
};
/** Explicitly in no bridge (spec section 8.6, owner to confirm). */
export const SPEC8_EXCLUDED_RIVERS = dec(['River_D_3', 'River_D_L_EE_2', 'River_D_L_RE_2', 'River_U_3', 'River_U_L_EE_2', 'River_U_R_EE_2', 'River_U_U_E_4', 'WaterStones_1',
  'Lake_1', 'Lake_2', 'Lake_3', 'Lake_4', 'Lake_5', 'Lake_6', 'Lake_7']);

export const baseHexFile = () => ({ version: 1, package: 'postapoc', dbVersion: 5, common: { goldPerTap: 10 }, hexes: BASE_HEXES });
export const baseBldFile = () => ({ version: 2, package: 'postapoc', buildings: bldRoads() });

/** Put the fixture on the fake server (base files at both paths, Decameroon as a package). Never touches a real server. */
export function seedRoadsServer(gh: FakeGitHub) {
  for (const p of ['packages/postapoc/hex_database.json', 'hex_database.json']) gh.setJson(p, baseHexFile());
  for (const p of ['packages/postapoc/building_database.json', 'building_database.json']) gh.setJson(p, baseBldFile());
  seedServerPackage(gh, 'decameroon', { name: 'Decameroon', hexes: DEC_HEXES });
}

/**
 * Opens the editor on the fixture world. The editor boots from the checkout's (stale) root files; the local DBs are then
 * replaced by the fixture (base + Decameroon) so every roads spec starts from exactly the same data.
 */
export async function seedRoadsWorld(page: Page, gh: FakeGitHub = new FakeGitHub(), opts: { storage?: Record<string, string> } = {}) {
  seedRoadsServer(gh);
  const res = await openEditor(page, { gh, pat: true, storage: opts.storage });
  await page.evaluate(({ hexes, blds }) => {
    HexDB.loadFromObject({ version: 1, package: 'postapoc', dbVersion: 5, common: { goldPerTap: 10 }, hexes });
    BldDB.load(JSON.stringify({ version: 2, buildings: blds }));
  }, { hexes: [...BASE_HEXES, ...DEC_HEXES], blds: bldRoads() });
  await expect.poll(() => page.evaluate(() => HexDB.getAll().length)).toBe(BASE_HEXES.length + DEC_HEXES.length);
  return { gh, ...res };
}

/** Sets the spec section 8 state on the Decameroon records through the real API (HexDB.setAllowedRoads, task E2). */
export async function applySpec8(page: Page) {
  await page.evaluate((spec) => {
    for (const h of HexDB.getAll()) if (h.package === 'decameroon') {
      const list = Object.keys(spec).filter(t => spec[t].includes(h.id));
      HexDB.setAllowedRoads(h, list);
    }
  }, SPEC8);
}
