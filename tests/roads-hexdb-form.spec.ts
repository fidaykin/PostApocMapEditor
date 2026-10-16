import { test, expect } from '@playwright/test';
import { FakeGitHub } from './helpers';
import { seedRoadsWorld, seedRoadsServer, BASE_HEXES, bldRoads } from './roads-fixtures';

// Roads/Bridges V1, editor phase E: the data model (E2) and the Hex DB form block (E3).
test.describe('allowedRoads data model', () => {
  test('HexDB.add() creates a record with allowedRoads [] and roadAllowed false', async ({ page }) => {
    await seedRoadsWorld(page);
    const rec = await page.evaluate(() => { HexDB.add(); const all = HexDB.getAll(); return all[all.length - 1]; });
    expect(rec.allowedRoads).toEqual([]);
    expect(rec.roadAllowed).toBe(false);
  });

  test('a record loaded WITHOUT allowedRoads keeps no such property (load and mergeFromServer); positive control: with it, it stays', async ({ page }) => {
    await seedRoadsWorld(page);
    const r = await page.evaluate(({ hexes }) => {
      const mk = (id: string, extra: object = {}) => ({ id, type: 'Plains', spriteName: id, ...extra });
      HexDB.load(JSON.stringify({ version: 1, hexes: [mk('NoField'), mk('WithField', { allowedRoads: ['road'] })] }));
      const viaLoad = HexDB.getAll().map((h: any) => ({ id: h.id, has: 'allowedRoads' in h, ar: h.allowedRoads }));
      HexDB.mergeFromServer('postapoc', { version: 1, hexes: [mk('SrvNo'), mk('SrvWith', { allowedRoads: ['bridge'] })] });
      const viaMerge = HexDB.getAll().filter((h: any) => h.id.startsWith('Srv')).map((h: any) => ({ id: h.id, has: 'allowedRoads' in h }));
      return { viaLoad, viaMerge };
    }, { hexes: BASE_HEXES });
    expect(r.viaLoad.find((x: any) => x.id === 'NoField')!.has).toBe(false);
    expect(r.viaLoad.find((x: any) => x.id === 'WithField')).toMatchObject({ has: true, ar: ['road'] });
    expect(r.viaMerge.find((x: any) => x.id === 'SrvNo')!.has).toBe(false);
    expect(r.viaMerge.find((x: any) => x.id === 'SrvWith')!.has).toBe(true);
  });

  test('migration normalises a list (dedupe, non-strings out) and removes a non-array value instead of turning it into []', async ({ page }) => {
    await seedRoadsWorld(page);
    const r = await page.evaluate(() => {
      const mk = (id: string, ar: any) => ({ id, type: 'Plains', spriteName: id, allowedRoads: ar });
      HexDB.load(JSON.stringify({ version: 1, hexes: [mk('A', ['road', 'road', 7, '']), mk('B', 'road'), mk('C', {}), mk('D', null), mk('E', [])] }));
      return Object.fromEntries(HexDB.getAll().map((h: any) => [h.id, 'allowedRoads' in h ? h.allowedRoads : 'ABSENT']));
    });
    expect(r).toEqual({ A: ['road'], B: 'ABSENT', C: 'ABSENT', D: 'ABSENT', E: [] });
  });

  test('roadAllowed is re-derived from the list when the field is an array (D2), and keeps the boolean normalisation when absent', async ({ page }) => {
    await seedRoadsWorld(page);
    const r = await page.evaluate(() => {
      const mk = (id: string, extra: object) => ({ id, type: 'Plains', spriteName: id, ...extra });
      HexDB.load(JSON.stringify({ version: 1, hexes: [
        mk('Road', { allowedRoads: ['road'], roadAllowed: false }), mk('BridgeOnly', { allowedRoads: ['bridge'], roadAllowed: true }),
        mk('Empty', { allowedRoads: [], roadAllowed: true }), mk('Unknown', { allowedRoads: ['road_old'], roadAllowed: true }),
        mk('LegacyTrue', { roadAllowed: true }), mk('LegacyJunk', { roadAllowed: 'yes' })] }));
      return Object.fromEntries(HexDB.getAll().map((h: any) => [h.id, h.roadAllowed]));
    });
    expect(r).toEqual({ Road: true, BridgeOnly: false, Empty: false, Unknown: false, LegacyTrue: true, LegacyJunk: false });
  });

  test('autosave restore with a wrong derived flag: after startup the flag follows the list', async ({ page }) => {
    const gh = new FakeGitHub();
    seedRoadsServer(gh);
    // the stored session has a tile listing "road" with a wrong derived flag; the stale checkout Building DB has no "road" record
    const stored = { version: 1, dbVersion: 5, common: { goldPerTap: 10 }, hexes: [{ ...BASE_HEXES[0], allowedRoads: ['road'], roadAllowed: false }, ...BASE_HEXES.slice(1)] };
    const { openEditor } = await import('./helpers');
    await openEditor(page, { gh, pat: true, storage: { hexdb_autosave: JSON.stringify(stored) } });
    await expect.poll(() => page.evaluate(() => BldDB.getAll().some((b: any) => b.id === 'road'))).toBe(true);
    await expect.poll(() => page.evaluate(() => HexDB.getAll().find((h: any) => h.id === 'Plain_1').roadAllowed)).toBe(true);
    expect(await page.evaluate(() => HexDB.getAll().find((h: any) => h.id === 'Plain_1').allowedRoads)).toEqual(['road']);
  });

  test('refreshDerived corrects the legacy flag once the Building DB knows the road types (load-order guard)', async ({ page }) => {
    await seedRoadsWorld(page);
    const r = await page.evaluate((blds) => {
      const mk = (id: string, ar: string[]) => ({ id, type: 'Plains', spriteName: id, allowedRoads: ar });
      // Building DB without the road types yet (only a bridge): "road" is unknown, the flag derives to false
      BldDB.load(JSON.stringify({ version: 2, buildings: blds.filter((b: any) => b.id === 'bridge') }));
      HexDB.load(JSON.stringify({ version: 1, hexes: [mk('R', ['road']), mk('B', ['bridge'])] }));
      const before = Object.fromEntries(HexDB.getAll().map((h: any) => [h.id, h.roadAllowed]));
      BldDB.load(JSON.stringify({ version: 2, buildings: blds }));
      const rev0 = HexDB.getRev();
      const changed = HexDB.refreshDerived();
      const after = Object.fromEntries(HexDB.getAll().map((h: any) => [h.id, h.roadAllowed]));
      return { before, changed, after, revDelta: HexDB.getRev() - rev0, again: HexDB.refreshDerived() };
    }, bldRoads());
    expect(r.before).toEqual({ R: false, B: false });
    expect(r.changed).toBe(1);
    expect(r.after).toEqual({ R: true, B: false });
    expect(r.revDelta).toBe(1);
    expect(r.again).toBe(0);
  });

  test('setAllowedRoads / getAllowedRoads: sorts by Building DB order, dedupes, derives roadAllowed, one autosave; accepts record, index and key', async ({ page }) => {
    await seedRoadsWorld(page);
    const r = await page.evaluate(() => {
      const all = HexDB.getAll();
      const rec = all.find((h: any) => h.id === 'Decameroon_Plain_1');
      const rev0 = HexDB.getRev();
      HexDB.setAllowedRoads(rec, ['bridge_2', 'road_2', 'road', 'road', 'zzz']);
      const rev1 = HexDB.getRev();
      const afterRec = { ar: rec.allowedRoads, ra: rec.roadAllowed, get: HexDB.getAllowedRoads(rec) };
      const idx = all.indexOf(all.find((h: any) => h.id === 'Decameroon_Water_1'));
      HexDB.setAllowedRoads(idx, ['bridge_2']);
      const byIdx = { ar: all[idx].allowedRoads, ra: all[idx].roadAllowed };
      HexDB.setAllowedRoads('decameroon::Decameroon_Rubble_1', ['road']);
      const byKey = HexDB.getAllowedRoads('decameroon::Decameroon_Rubble_1');
      HexDB.setAllowedRoads('Plain_1', ['road']);
      const byBare = HexDB.getAllowedRoads('postapoc::Plain_1');
      return { d: rev1 - rev0, afterRec, byIdx, byKey, byBare, missing: HexDB.getAllowedRoads('Nope') };
    });
    expect(r.d).toBe(1);
    expect(r.afterRec).toEqual({ ar: ['road', 'road_2', 'bridge_2', 'zzz'], ra: true, get: ['road', 'road_2', 'bridge_2', 'zzz'] });
    expect(r.byIdx).toEqual({ ar: ['bridge_2'], ra: false });
    expect(r.byKey).toEqual(['road']);
    expect(r.byBare).toEqual(['road']);
    expect(r.missing).toBeNull();
  });
});
