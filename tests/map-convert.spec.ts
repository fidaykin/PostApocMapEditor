// MapConvert (map-convert.js): re-target a map to another content package. Pure, so no browser: the module is required directly.
import { test, expect } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const MapConvert = require('../map-convert.js');

const HEX = [
  { id: 'Plain_1', type: 'Plains', package: 'postapoc' },
  { id: 'Forest_1', type: 'Forests', package: 'postapoc' },
  { id: 'Lake_1', type: 'Water', package: 'postapoc' },
  { id: 'Decameroon_Plain_1', type: 'Plains', package: 'decameroon' },
  { id: 'Decameroon_Forest_1', type: 'Forests', package: 'decameroon' },
  { id: 'Decameroon_Lake_1', type: 'Water', package: 'decameroon' },
  { id: 'Decameroon_Grain_2', type: 'Plains', package: 'decameroon' },       // hs has no counterpart
  { id: 'Decameroon_Hills_1', type: 'Hills', package: 'decameroon' },        // hs counterpart has another type
  { id: 'Hs_Decameroon_Plain_1', type: 'Plains', package: 'hs' },
  { id: 'Hs_Decameroon_Forest_1', type: 'Forests', package: 'hs' },
  { id: 'Hs_Decameroon_Lake_1', type: 'Water', package: 'hs' },
  { id: 'Hs_Decameroon_Hills_1', type: 'Mountains', package: 'hs' },
  { id: 'Hs_Hills_2', type: 'Hills', package: 'hs', skinSlot: 'Hills_1' },   // overlay of a base id that does not exist: unused here
];
const BLD = [
  { id: 'road', type: 'Road', package: 'postapoc' },
  { id: 'Decameroon_GemMine_1', type: 'Ground Building', package: 'decameroon' },
  { id: 'Decameroon_Harbor_1', type: 'Water Building', package: 'decameroon' },
  { id: 'Decameroon_Abbey_1_TEST', type: 'Ground Building', package: 'decameroon' },
  { id: 'Hs_Decameroon_GemMine_1', type: 'Ground Building', package: 'hs' },
  { id: 'Hs_Decameroon_Harbor_1', type: 'Ground Building', package: 'hs' },   // water -> ground: rejected
];
const ctx = { target: 'hs', hex: HEX, bld: BLD };

function map() {
  return {
    version: 2, width: 3, height: 2,
    data: [['Decameroon_Plain_1', 'Forest_1', 'Decameroon_Lake_1'], ['Decameroon_Grain_2', 'Decameroon_Hills_1', 'Plain_1']],
    packages: ['decameroon', 'postapoc'],
    objects: [{ col: 0, row: 0, id: 'Decameroon_GemMine_1' }, { col: 1, row: 0, id: 'road' }, { col: 2, row: 1, id: 'Decameroon_Harbor_1' },
      { col: 0, row: 1, id: 'Decameroon_Abbey_1_TEST' }],
    tileExtras: [{ col: 2, row: 0, underTerrainId: 'Decameroon_Lake_1' }],
    settlements: [{ col: 1, row: 1, type: 'city' }],
    roads: [{ col: 1, row: 0, type: 'road' }],
  };
}

test.describe('MapConvert', () => {
  test('renames hex ids of the source package to the target counterpart (prefix rule)', () => {
    const r = MapConvert.convert(map(), ctx);
    expect(r.json.data[0][0]).toBe('Hs_Decameroon_Plain_1');
    expect(r.json.data[0][2]).toBe('Hs_Decameroon_Lake_1');
    expect(r.report.hex.mapping.Decameroon_Plain_1).toBe('Hs_Decameroon_Plain_1');
  });

  test('base ids without a counterpart stay (Forest_1, Plain_1) and are counted as kept', () => {
    const r = MapConvert.convert(map(), ctx);
    expect(r.json.data[0][1]).toBe('Forest_1');
    expect(r.json.data[1][2]).toBe('Plain_1');
    expect(r.report.hex.keptBase).toBe(2);
  });

  test('an id with no counterpart stays and is reported as missing', () => {
    const r = MapConvert.convert(map(), ctx);
    expect(r.json.data[1][0]).toBe('Decameroon_Grain_2');
    expect(r.report.hex.missing).toBe(1);
    expect(r.report.hex.notConverted.Decameroon_Grain_2).toEqual({ count: 1, how: 'missing' });
  });

  test('a counterpart with another type is not used and is reported', () => {
    const r = MapConvert.convert(map(), ctx);
    expect(r.json.data[1][1]).toBe('Decameroon_Hills_1');
    expect(r.report.hex.typeMismatch).toBe(1);
    expect(r.report.hex.notConverted.Decameroon_Hills_1).toEqual({ count: 1, how: 'typeMismatch', to: 'Hs_Decameroon_Hills_1' });
  });

  test('buildings: renamed, road kept, water-to-ground counterpart rejected, no counterpart reported', () => {
    const r = MapConvert.convert(map(), ctx);
    const ids = r.json.objects.map((o: any) => o.id);
    expect(ids).toEqual(['Hs_Decameroon_GemMine_1', 'road', 'Decameroon_Harbor_1', 'Decameroon_Abbey_1_TEST']);
    expect(r.report.bld.converted).toBe(1);
    expect(r.report.bld.keptBase).toBe(1);
    expect(r.report.bld.typeMismatch).toBe(1);
    expect(r.report.bld.missing).toBe(1);
  });

  test('tileExtras underTerrainId follows the hex rule', () => {
    const r = MapConvert.convert(map(), ctx);
    expect(r.json.tileExtras[0].underTerrainId).toBe('Hs_Decameroon_Lake_1');
  });

  test('everything else is copied: size, settlements, roads, coordinates', () => {
    const r = MapConvert.convert(map(), ctx);
    expect(r.json.width).toBe(3);
    expect(r.json.settlements).toEqual([{ col: 1, row: 1, type: 'city' }]);
    expect(r.json.roads).toEqual([{ col: 1, row: 0, type: 'road' }]);
    expect(r.json.objects[0]).toMatchObject({ col: 0, row: 0 });
  });

  test('the input map is not modified', () => {
    const m = map();
    const copy = JSON.stringify(m);
    MapConvert.convert(m, ctx);
    expect(JSON.stringify(m)).toBe(copy);
  });

  test('converting again changes nothing (idempotent)', () => {
    const once = MapConvert.convert(map(), ctx);
    const twice = MapConvert.convert(once.json, ctx);
    expect(twice.json).toEqual(once.json);
    expect(twice.report.hex.converted).toBe(0);
    expect(twice.report.hex.same).toBeGreaterThan(0);
  });

  test('a record with a matching skinSlot is chosen over the prefix rule (base id -> overlay)', () => {
    const hex = HEX.concat([{ id: 'Hs_Skin_Plains', type: 'Plains', package: 'hs', skinSlot: 'Plain_1' }]);
    const r = MapConvert.convert({ data: [['Plain_1', 'Decameroon_Plain_1']], packages: ['postapoc', 'decameroon'] }, { ...ctx, hex });
    expect(r.json.data[0][0]).toBe('Hs_Skin_Plains');
    expect(r.json.data[0][1]).toBe('Hs_Decameroon_Plain_1');   // no skinSlot on the Decameroon record: prefix rule
  });

  test('the source record skinSlot links a record to the target overlay of the same slot', () => {
    const hex = HEX.concat([
      { id: 'Medieval20_Plain_1', type: 'Plains', package: 'medieval-2-0', skinSlot: 'Plain_1' },
      { id: 'Hs_Skin_Plains', type: 'Plains', package: 'hs', skinSlot: 'Plain_1' }]);
    const r = MapConvert.convert({ data: [['Medieval20_Plain_1']] }, { ...ctx, hex });
    expect(r.json.data[0][0]).toBe('Hs_Skin_Plains');
  });

  test('ids match case-insensitively', () => {
    const r = MapConvert.convert({ data: [['decameroon_plain_1']] }, ctx);
    expect(r.json.data[0][0]).toBe('Hs_Decameroon_Plain_1');
  });

  test('unknown ids, empty cells and legacy integers are left alone', () => {
    const r = MapConvert.convert({ data: [['Nope_1', '', null, 15]] }, ctx);
    expect(r.json.data[0]).toEqual(['Nope_1', '', null, 15]);
    expect(r.report.hex.unknown).toBe(1);
  });

  test('packages: the source is dropped when no id of it is left, the target is added', () => {
    const m = { data: [['Decameroon_Plain_1', 'Plain_1']], packages: ['decameroon', 'postapoc'] };
    const r = MapConvert.convert(m, ctx);
    expect(r.packages.before).toEqual(['decameroon', 'postapoc']);
    expect(r.json.packages).toEqual(['hs', 'postapoc']);
  });

  test('packages: the source stays while some of its ids could not be converted', () => {
    const m = { data: [['Decameroon_Plain_1', 'Decameroon_Grain_2']], packages: ['decameroon', 'postapoc'] };
    const r = MapConvert.convert(m, ctx);
    expect(r.json.packages).toEqual(['decameroon', 'hs', 'postapoc']);
  });

  test('biome presets: weights keys are renamed and merged, forbidden terrain is renamed', () => {
    const m = { data: [], biomePresets: [{ name: 'p', terrainWeights: { Decameroon_Plain_1: 0.4, Hs_Decameroon_Plain_1: 0.1, Forest_1: 0.5 },
      forbiddenTerrain: ['Decameroon_Lake_1'] }] };
    const p = MapConvert.convert(m, ctx).json.biomePresets[0];
    expect(p.terrainWeights).toEqual({ Hs_Decameroon_Plain_1: 0.5, Forest_1: 0.5 });
    expect(p.forbiddenTerrain).toEqual(['Hs_Decameroon_Lake_1']);
  });

  test('the target must be a non-base package', () => {
    expect(() => MapConvert.convert(map(), { ...ctx, target: 'postapoc' })).toThrow();
    expect(() => MapConvert.convert(map(), { ...ctx, target: '' })).toThrow();
    expect(() => MapConvert.convert(null, ctx)).toThrow();
  });

  test('prefixOf follows the editor rule', () => {
    expect(MapConvert.prefixOf('medieval-2-0')).toBe('Medieval20_');
    expect(MapConvert.prefixOf('hs')).toBe('Hs_');
    expect(MapConvert.prefixOf('postapoc')).toBe('');
  });

  test('summary has one line per kind', () => {
    expect(MapConvert.summary(MapConvert.convert(map(), ctx).report).split('\n')).toHaveLength(2);
  });
});
