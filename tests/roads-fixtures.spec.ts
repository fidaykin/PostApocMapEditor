import { test, expect } from '@playwright/test';
import { DEC_HEXES, SPEC8, SPEC8_EXCLUDED_RIVERS, ROAD_IDS, bldRoads, BASE_HEXES } from './roads-fixtures';

// Guards the shared Roads V1 fixture against typos (every roads spec leans on it). Pure data, no page.
test.describe('roads fixture', () => {
  const byId = new Map(DEC_HEXES.map(h => [h.id, h]));

  test('Decameroon has the 60 live tiles with unique ids', () => {
    expect(DEC_HEXES.length).toBe(60);
    expect(byId.size).toBe(60);
    expect(DEC_HEXES.filter(h => h.type === 'Rivers').length).toBe(29);
    expect(DEC_HEXES.filter(h => h.type === 'Water').length).toBe(5);
  });

  test('SPEC8 lists have 7 / 3 / 15 / 3 entries, all existing ids', () => {
    expect(SPEC8[ROAD_IDS.road].length).toBe(7);
    expect(SPEC8[ROAD_IDS.road2].length).toBe(3);
    expect(SPEC8[ROAD_IDS.bridge].length).toBe(15);
    expect(SPEC8[ROAD_IDS.bridge2].length).toBe(3);
    for (const list of Object.values(SPEC8)) {
      expect(new Set(list).size).toBe(list.length);
      for (const id of list) expect(byId.has(id), id).toBe(true);
    }
  });

  test('Bridge_1 ids are all Rivers, Bridge_2 ids all Water (positive control: a land id is neither)', () => {
    for (const id of SPEC8[ROAD_IDS.bridge]) expect(byId.get(id)!.type).toBe('Rivers');
    for (const id of SPEC8[ROAD_IDS.bridge2]) expect(byId.get(id)!.type).toBe('Water');
    expect(byId.get('Decameroon_Plain_1')!.type).toBe('Plains');
  });

  test('the excluded rivers, WaterStones_1 and Lake_1..7 are in no list; BrokenShip_1 and DestroyedBuilding_1 are unmentioned', () => {
    const all = new Set(Object.values(SPEC8).flat());
    expect(SPEC8_EXCLUDED_RIVERS.length).toBe(15);
    for (const id of SPEC8_EXCLUDED_RIVERS) { expect(byId.has(id), id).toBe(true); expect(all.has(id), id).toBe(false); }
    expect(all.has('Decameroon_BrokenShip_1')).toBe(false);
    expect(all.has('Decameroon_DestroyedBuilding_1')).toBe(false);
    // 7 excluded rivers + 15 bridge rivers + 7 lakes = 29 Rivers
    const rivers = new Set([...SPEC8[ROAD_IDS.bridge], ...SPEC8_EXCLUDED_RIVERS].filter(i => byId.get(i)!.type === 'Rivers'));
    expect(rivers.size).toBe(29);
  });

  test('road and bridge building records exist with the right flags; base set carries the legacy ids', () => {
    const b = bldRoads();
    expect(b.map(x => x.id)).toEqual([ROAD_IDS.road, ROAD_IDS.road2, ROAD_IDS.bridge, ROAD_IDS.bridge2]);
    expect(b.filter(x => x.isRoad).map(x => x.id)).toEqual([ROAD_IDS.road, ROAD_IDS.road2]);
    expect(b.filter(x => x.buildingCategory === 'Bridge').map(x => x.id)).toEqual([ROAD_IDS.bridge, ROAD_IDS.bridge2]);
    expect(b.find(x => x.id === ROAD_IDS.bridge2)!.underTerrainId).toBe('Decameroon_Water_1');
    expect(BASE_HEXES.find(h => h.id === 'Plain_Kaiju_1')).toMatchObject({ terrainTypeId: 12, roadAllowed: true });
  });
});
