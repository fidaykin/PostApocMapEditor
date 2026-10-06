import { test, expect } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// T3.9: generator + satellite roles resolved through HexDB tile classes; the table refreshes when HexDB changes (K5).
// Expected stock ids are written out by hand (independent of ROLE_SPEC).
const STOCK: Record<string, string> = {
  WATER_DARK: 'Water_Dirty_1', WATER_LIGHT: 'Water_1', WATER_ROCK: 'Water_Rock_1',
  RUBBLE_1: 'Rubble_1', RUBBLE_2: 'Rubble_2', RUBBLE_3: 'Rubble_3',
  PLAIN_1: 'Plain_1', PLAIN_2: 'Plain_2', BROKEN_PLAIN: 'BrokenPlane_1',
  FOREST_1: 'Forest_1', FOREST_2: 'Forest_2', FOREST_3: 'Forest_3',
  HILLS: 'Hills_1', MOUNTAIN: 'Mountain_1', GOLD: 'GoldVein_1', OIL: 'Oil_1',
  BARREN: 'Barren_1', DESERT: 'Desert_1', SWAMP: 'Swamp_1',
  LAVA: 'Lava_Plain_1', LAVA_RIFT: 'Lava_Rift_1', RIFT: 'Rift_1',
};

test.describe('tile classes (T3.9)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('resolveRoles falls back to same-class tiles when preferred ids are missing', async ({ page }) => {
    const t = await page.evaluate(() => GenUtils.resolveRoles([
      { id: 'Tree_A', type: 'Forests' }, { id: 'Tree_B', type: 'Forests' },
      { id: 'Grass_A', type: 'Plains' }, { id: 'Plain_2', type: 'Plains' },
    ]));
    expect(t.FOREST_1).toBe('Tree_A');
    expect(t.FOREST_2).toBe('Tree_B');
    expect(t.FOREST_3).toBe('Tree_A');           // two tiles for three roles: cycles
    expect(t.PLAIN_2).toBe('Plain_2');           // exact id wins
    expect(t.PLAIN_1).toBe('Grass_A');           // missing id -> unused same-class tile
    expect(t.BROKEN_PLAIN).toBe('Plain_2');      // follows PLAIN_2, never a random Special tile
    expect(t.WATER_LIGHT).toBe('Water_1');       // no entries at all -> raw preferred id
    expect(Object.keys(t).sort()).toEqual(Object.keys(STOCK).sort());
  });

  test('with the stock HexDB every one of the 22 roles keeps its original id', async ({ page }) => {
    const t = await page.evaluate(() => GenUtils.resolveRoles(HexDB.getAll()));
    expect(t).toEqual(STOCK);
  });

  test('exact-id match is case-insensitive and returns the canonical id', async ({ page }) => {
    const t = await page.evaluate(() => GenUtils.resolveRoles([{ id: 'forest_2', type: 'Forests' }, { id: 'Forest_9', type: 'Forests' }]));
    expect(t.FOREST_2).toBe('forest_2');
    expect(t.FOREST_1).toBe('Forest_9');          // the only unused plain Forests tile
  });

  test('unknown-class edge cases never throw and never pick excluded tiles', async ({ page }) => {
    const r = await page.evaluate(() => {
      const junk: any[] = [null, undefined, {}, { id: 5, type: 'Forests' }, { id: 'X' }, { id: 'Y', type: null }];
      const excluded = [
        { id: 'Multi', type: 'Forests', occupiedOffsets: [[0, 0], [1, 0]] },
        { id: 'Layer', type: 'Forests', isLayered: true },
        { id: 'Dir', type: 'Forests', edgeFaces: ['N'] },
        { id: 'Forest_test', type: 'Forests' }, { id: 'Kaiju_Tree', type: 'Forests' },
        { id: 'Chicken_Tree', type: 'Forests' }, { id: 'Settlement_Tree', type: 'Forests' },
      ];
      const out: any = {};
      out.junk = GenUtils.resolveRoles(junk);
      out.excluded = GenUtils.resolveRoles(excluded);
      out.empty = GenUtils.resolveRoles([]);
      out.wrongClass = GenUtils.resolveRoles([{ id: 'Lonely', type: 'NoSuchClass' }]);
      return out;
    });
    expect(r.empty).toEqual(STOCK);                       // nothing at all -> raw preferred ids
    expect(r.junk).toEqual(STOCK);
    expect(r.excluded.FOREST_1).toBe('Forest_1');         // every Forests candidate is excluded -> raw id
    expect(r.wrongClass).toEqual(STOCK);                  // an unknown class never feeds a role
  });

  test('the table is deterministic (sorted candidates) and ignores Math.random and input order', async ({ page }) => {
    const r = await page.evaluate(() => {
      const mk = () => ['Tree_C', 'Tree_A', 'tree_b', 'Tree_D'].map(id => ({ id, type: 'Forests' }));
      const a = GenUtils.resolveRoles(mk());
      const orig = Math.random; Math.random = () => { throw new Error('Math.random used'); };
      let b, c;
      try { b = GenUtils.resolveRoles(mk().reverse()); c = GenUtils.resolveRoles(mk().sort(() => 0)); }
      finally { Math.random = orig; }
      return { a, b, c };
    });
    expect(r.a.FOREST_1).toBe('Tree_A');                  // case-insensitive sort: Tree_A, tree_b, Tree_C, Tree_D
    expect(r.a.FOREST_2).toBe('tree_b');
    expect(r.a.FOREST_3).toBe('Tree_C');
    expect(r.b).toEqual(r.a);
    expect(r.c).toEqual(r.a);
  });

  test('removing Forest_2 from the page HexDB: generator and satellite use a same-class fallback, re-adding refreshes (no reload)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const names = () => ({ gen: Generator._buildJob().T, sat: Satellite._getT() });
      const before = names();
      const data = HexDB.getData();
      const f2 = structuredClone(data.hexes.find((h: any) => h.id === 'Forest_2'));
      const stockForests = data.hexes.filter((h: any) => h.type === 'Forests').map((h: any) => h.id);
      // as a package removal would: the entry leaves the list, HexDB's own load path rebuilds state
      HexDB.loadFromObject({ ...data, hexes: data.hexes.filter((h: any) => h.id !== 'Forest_2') });
      const removed = names();
      // re-add through a package (addEntries), then remove that package again (removeByPackage)
      HexDB.addEntries([{ ...f2, package: 'tc-pkg' }]);
      const readded = names();
      HexDB.removeByPackage('tc-pkg');
      const removedAgain = names();
      // generation still works and no longer writes the missing id
      (document.getElementById('gen-seed') as HTMLInputElement).value = '42';
      await Generator.apply();
      const used = [...new Set(mapData as string[])];
      return { before, removed, readded, removedAgain, used, stockForests, hasF2: HexDB.getAll().some((h: any) => h.id === 'Forest_2') };
    });
    expect(r.before.gen.FOREST_2).toBe('Forest_2');
    for (const k of ['gen', 'sat'] as const) {
      expect(r.removed[k].FOREST_2).not.toBe('Forest_2');
      expect(r.removed[k].FOREST_2).toMatch(/^Forest_[13]$/);          // a plain Forests tile still in the DB
      expect(r.readded[k].FOREST_2).toBe('Forest_2');
      expect(r.removedAgain[k].FOREST_2).toBe(r.removed[k].FOREST_2);
    }
    expect(r.hasF2).toBe(false);
    expect(r.used).not.toContain('Forest_2');
    expect(r.used).toContain(r.removed.gen.FOREST_2);
    expect(r.used.length).toBeGreaterThan(5);
  });

  test('renaming Forest_1..3 to Tree_1..3 switches the generated ids (K5: no stale table)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const run = async () => { (document.getElementById('gen-seed') as HTMLInputElement).value = '3'; await Generator.apply(); return [...new Set(mapData as string[])]; };
      const before = await run();
      const data = HexDB.getData();
      HexDB.loadFromObject({ ...data, hexes: data.hexes.map((h: any) => /^Forest_[123]$/.test(h.id) ? { ...h, id: h.id.replace('Forest', 'Tree') } : h) });
      const after = await run();
      return { bf: before.filter(id => /^Forest_[123]$/.test(id)), af: after.filter(id => /^Forest_[123]$/.test(id)), at: after.filter(id => /^Tree_[123]$/.test(id)) };
    });
    expect(r.bf.length).toBeGreaterThan(0);
    expect(r.af).toEqual([]);
    expect(r.at.length).toBeGreaterThan(0);
  });

  test('a role with no tile of its class does not crash generation: toast lists the missing roles', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const data = HexDB.getData();
      HexDB.loadFromObject({ ...data, hexes: data.hexes.filter((h: any) => h.type !== 'Water') });
      (document.getElementById('gen-seed') as HTMLInputElement).value = '42';
      let err = '';
      try { await Generator.apply(); } catch (e: any) { err = String(e && e.message || e); }
      const toasts = [...document.querySelectorAll('#toast-container .toast')].map(t => t.textContent || '');
      return { err, toasts, n: mapData.length, W: MAP_WIDTH * MAP_HEIGHT, missing: GenUtils.missingRoles(HexDB.getAll(), HexDB.getRoles()) };
    });
    expect(r.err).toBe('');
    expect(r.n).toBe(r.W);
    expect(r.missing.sort()).toEqual(['WATER_DARK', 'WATER_LIGHT', 'WATER_ROCK']);
    const t = r.toasts.find(x => /has no tile for/i.test(x)) || '';
    expect(t).toContain('WATER_DARK');
    expect(t).toContain('WATER_LIGHT');
    expect(t).toContain('WATER_ROCK');
    expect(t).not.toContain('FOREST_2');
  });

  test('an in-place edit of an entry (same array, same length) refreshes the table through the rev', async ({ page }) => {
    const r = await page.evaluate(() => {
      const e = HexDB.getAll().find((h: any) => h.id === 'Forest_2');
      const a = HexDB.getRoles().FOREST_2;
      e.id = 'Tree_2';                         // the editor mutates entries in place, then persists (bumps the rev)
      const stale = HexDB.getRoles().FOREST_2;  // no persist yet: the contract is 'mutate, then _autoSave'
      HexDB.setCommonGoldPerTap(10);           // any persisted edit
      const b = HexDB.getRoles().FOREST_2;
      return { a, stale, b };
    });
    expect(r.a).toBe('Forest_2');
    expect(r.stale).toBe('Forest_2');
    expect(r.b).not.toBe('Forest_2');
  });

  test('missingRoles is empty for the stock HexDB (positive control for the toast)', async ({ page }) => {
    const r = await page.evaluate(() => GenUtils.missingRoles(HexDB.getAll(), HexDB.getRoles()));
    expect(r).toEqual([]);
    const toasts = await page.evaluate(() => [...document.querySelectorAll('#toast-container .toast')].map(t => t.textContent || ''));
    expect(toasts.filter(x => /has no tile for/i.test(x))).toEqual([]);
  });
});
