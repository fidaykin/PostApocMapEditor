import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { seedRoadsWorld, SPEC8 } from './roads-fixtures';

// Roads V1, E7: the contract document and the record keys the editor may write. The editor-side twin of the game
// repository's scripts/check-building-schema-sync.js: a new record key that is not in the live set fails here first.
const DOC = path.resolve(__dirname, '..', 'docs', 'contracts', 'roads-hex-db.md');

// Keys of a live hex record (union over packages/postapoc and packages/decameroon hex_database.json, GET 2026-10-15) ...
const LIVE_RECORD_KEYS = ['baseCostTaps', 'biome', 'bonusDrop', 'bonusTrigger', 'bonuses', 'booster', 'buildAvailableTiles', 'buildMinLevel', 'buildPlacementRule',
  'buildPremiumPrice', 'buildPrice', 'buildRequiresRoad', 'canBuild', 'canDestroy', 'canStored', 'category', 'descriptionBuildId', 'descriptionIdleId', 'destroyIncome',
  'destroyIncomeEnabled', 'destroySource', 'destroyTransformTo', 'destroyable', 'edgeFaces', 'effects', 'fallback', 'filterCategory', 'id', 'incomeCapacity',
  'incomeConstant', 'incomeGetPerTap', 'incomeIdle', 'incomePerTurn', 'incomeTransformTo', 'isLayered', 'occupiedOffsets', 'package', 'roadAllowed', 'spendConstant',
  'spriteName', 'tapIncomeEnabled', 'terrainTypeId', 'textId', 'type'];
// ... plus the one new key of Roads V1.
const KNOWN_RECORD_KEYS = new Set([...LIVE_RECORD_KEYS, 'allowedRoads']);

/** The rules of the document, as a small checker over a parsed hex file. Returns the violations. */
function checkFile(f: any): string[] {
  const bad: string[] = [];
  if ('roadsSchema' in f && f.roadsSchema !== 1) bad.push('roadsSchema must be absent or 1');
  if ('roadsSchema' in f && Object.keys(f)[1] !== 'roadsSchema' && Object.keys(f)[0] !== 'roadsSchema') bad.push('roadsSchema must follow version');
  for (const h of f.hexes ?? []) {
    if ('allowedRoads' in h) {
      if (!Array.isArray(h.allowedRoads) || h.allowedRoads.some((x: any) => typeof x !== 'string' || !x)) bad.push(`${h.id}: allowedRoads must be a list of non-empty strings`);
      else if (new Set(h.allowedRoads).size !== h.allowedRoads.length) bad.push(`${h.id}: duplicate ids`);
    }
    if (typeof h.roadAllowed !== 'boolean') bad.push(`${h.id}: roadAllowed must be a boolean`);
    for (const k of Object.keys(h)) if (!KNOWN_RECORD_KEYS.has(k)) bad.push(`${h.id}: unknown record key ${k}`);
  }
  return bad;
}

test.describe('roads contract document', () => {
  const doc = fs.readFileSync(DOC, 'utf8');
  const samples = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map(m => m[1].trim().split('\n').map(l => JSON.parse(l)));

  test('the document exists, names the fields, the modes and the key set', () => {
    for (const s of ['allowedRoads', 'roadAllowed', 'roadsSchema', 'common.roadDefaults', '`off`', '`stage`', '`active`', 'check-building-schema-sync.js', 'only** new record key'])
      expect(doc, s).toContain(s);
  });

  test('the JSON samples of the document obey the rules the document states (positive and negative control for the checker)', () => {
    const recs = samples.flat();
    expect(recs.length).toBe(3);
    expect(checkFile({ version: 1, hexes: recs })).toEqual([]);
    expect(checkFile({ version: 1, roadsSchema: 1, hexes: recs })).toEqual([]);
    expect(checkFile({ version: 1, hexes: [{ id: 'A', roadAllowed: true, allowedRoads: ['road', 'road'] }] })).toEqual(['A: duplicate ids']);
    expect(checkFile({ version: 1, hexes: [{ id: 'A', roadAllowed: true, roads: { road: true } }] })).toEqual(['A: unknown record key roads']);
    expect(checkFile({ version: 1, roadsSchema: 2, hexes: [] })).toEqual(['roadsSchema must be absent or 1']);
    // derived flag in the samples: true iff a listed id is a road
    for (const r of recs) expect(r.roadAllowed).toBe(r.allowedRoads.some((id: string) => id.startsWith('road')));
  });
});

test.describe('records written by the editor use only the known keys', () => {
  for (const mode of ['off', 'stage', 'active']) {
    test(`mode ${mode}: base and package files pass the checker, and a stray key is caught`, async ({ page }) => {
      await seedRoadsWorld(page);
      await page.evaluate((spec) => {
        for (const h of HexDB.getAll()) HexDB.setAllowedRoads(h, h.package === 'decameroon' ? Object.keys(spec).filter((t: string) => spec[t].includes(h.id)) : (h.type === 'Plains' ? ['road'] : []));
      }, SPEC8);
      const files = await page.evaluate((mode) => ({ base: HexDB.exportFor({ pkg: 'postapoc', mode }), dec: HexDB.exportFor({ pkg: 'decameroon', mode }) }), mode);
      expect(checkFile(files.base)).toEqual([]);
      expect(checkFile(files.dec)).toEqual([]);
      expect(files.base.hexes.length).toBe(12);
      expect(files.dec.hexes.length).toBe(60);
      expect(files.base.hexes.some((h: any) => 'allowedRoads' in h)).toBe(mode !== 'off');
      expect('roadsSchema' in files.base).toBe(mode === 'active');
      // positive control: a record with a stray key is rejected by the same checker
      files.base.hexes[0].roads = { road: true };
      expect(checkFile(files.base).length).toBe(1);
    });
  }
});
