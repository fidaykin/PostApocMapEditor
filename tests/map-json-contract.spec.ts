// Characterization of the map JSON the editor writes today (IO._buildJson, version 2).
// These tests describe EXISTING behaviour and pass immediately; any later format change must update them in the
// same commit (see docs/superpowers/decisions/2026-10-02-game-map-format.md).
import { test, expect } from '@playwright/test';
import { freshEditor } from './editor-helpers';

const ALWAYS = ['data', 'height', 'packages', 'settlement_priorities', 'settlements', 'version', 'width'];

test('a fresh map exports the minimal contract (version 2, no optional keys)', async ({ page }) => {
  await freshEditor(page);
  const json = await page.evaluate(() => JSON.parse(IO.getMapJson()));
  expect(json.version).toBe(2);
  expect(Object.keys(json).sort()).toEqual(ALWAYS);
  expect(json.width).toBe(450);
  expect(json.height).toBe(450);
  expect(json.data).toHaveLength(json.height);        // row-major: data[row][col]
  expect(json.data[0]).toHaveLength(json.width);
  expect(typeof json.data[0][0]).toBe('string');
  expect(json.settlements).toContainEqual({ col: 225, row: 224, type: 'city' });
  expect(json.settlement_priorities).toEqual({
    p1: ['Plain_1', 'Plain_2', 'Rubble_1', 'Rubble_2', 'Rubble_3'], p2: expect.any(Array) });
  expect(json.packages).toContain('postapoc');
});

test('every optional key appears with its exact shape once its layer is non-empty', async ({ page }) => {
  await freshEditor(page);
  const json = await page.evaluate(() => {
    mapData[3 * MAP_WIDTH + 4] = 'Rubble_1';
    Tools.moveCity(230, 220);
    bridgesData.push({ col: 10, row: 11, axis: 2 });
    objectsData['12,13'] = 'Artefact_Test_1';
    tileExtras['14,15'] = { underTerrainId: 'Plain_1' };
    roadsData['16,17'] = { type: 'road_hex' };
    settlementSlots.push({ minDist: 10, maxDist: 20, count: 1, type: 'settlement' });   // optional fields default on export
    const zid = ZonePainter.addZone('Z', '#ff0000');
    ZonePainter.getZoneLayer()[5 * MAP_WIDTH + 6] = zid;
    DistanceBands.fromJson([10, 20, 35]);
    return JSON.parse(IO.getMapJson());
  });
  expect(Object.keys(json).sort()).toEqual([...ALWAYS, '_zoneNextId', 'biomePresets', 'bridges', 'distance_bands',
    'objects', 'roads', 'settlement_slots', 'tileExtras', 'zoneMap', 'zones'].sort());
  expect(json.data[3][4]).toBe('Rubble_1');
  expect(json.settlements.filter((s: any) => s.type === 'city')).toEqual([{ col: 230, row: 220, type: 'city' }]);
  expect(json.bridges).toEqual([{ col: 10, row: 11, axis: 2 }]);   // axis is a number: the loader drops anything else
  expect(json.objects).toEqual([{ col: 12, row: 13, id: 'Artefact_Test_1' }]);
  expect(json.tileExtras).toEqual([{ col: 14, row: 15, underTerrainId: 'Plain_1' }]);
  expect(json.roads).toEqual([{ col: 16, row: 17, type: 'road_hex' }]);
  expect(json.settlement_slots).toEqual([{ minDist: 10, maxDist: 20, count: 1, type: 'settlement', tapMultiplier: 1, level: 1,
    minSpacing: 2, nearPct: 20, midPct: 30, farPct: 50 }]);
  expect(json.distance_bands).toEqual([10, 20, 35]);
  expect(json.zones).toHaveLength(1);
  expect(json.zones[0]).toMatchObject({ name: 'Z', color: '#ff0000' });
  expect(typeof json.zoneMap).toBe('string');
  expect(Array.isArray(json.biomePresets)).toBe(true);
  expect(json._zoneNextId).toBe(json.zones[0].id + 1);
});

test('load then save is a stable round trip of the full contract', async ({ page }) => {
  await freshEditor(page);
  const r = await page.evaluate(() => {
    mapData[3 * MAP_WIDTH + 4] = 'Rubble_1';
    Tools.moveCity(230, 220);
    bridgesData.push({ col: 10, row: 11, axis: 2 });
    objectsData['12,13'] = 'Artefact_Test_1';
    tileExtras['14,15'] = { underTerrainId: 'Plain_1' };
    roadsData['16,17'] = { type: 'road_hex' };
    const zid = ZonePainter.addZone('Z', '#ff0000');
    ZonePainter.getZoneLayer()[5 * MAP_WIDTH + 6] = zid;
    DistanceBands.fromJson([10, 20, 35]);
    const a = IO.getMapJson();
    IO.loadFromJSON(JSON.parse(a));
    const b = IO.getMapJson();
    const ja = JSON.parse(a), jb = JSON.parse(b);
    const diff = [...new Set([...Object.keys(ja), ...Object.keys(jb)])].filter(k => JSON.stringify(ja[k]) !== JSON.stringify(jb[k]));
    return { same: a === b, diff, len: a.length, keysA: Object.keys(ja).length };
  });
  expect(r.diff).toEqual([]);                 // names the differing keys instead of dumping the map
  expect(r.same).toBe(true);
  expect(r.keysA).toBe(16);                   // positive control: 7 always + 9 optional keys (all but settlement_slots) were compared
  expect(r.len).toBeGreaterThan(1000);
});
