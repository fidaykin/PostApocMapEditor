// T6.1: characterization tests for existing pure logic that had no direct spec (id prefixing, edge-mask table and
// resolver, legacy integer-map migration). They describe EXISTING behaviour and pass on first run; see the sanity
// mutations in task-T6.1-report.md. History snapshot/cap/undo-redo and HexUtils adjacency are already covered by
// perf-history.spec.ts and hex-utils.spec.ts and are deliberately not repeated here.
import { test, expect } from '@playwright/test';
import { openEditor } from '../helpers';
import '../editor-globals.d';

test.beforeEach(async ({ page }) => { await openEditor(page); });

test('Packages.idPrefix: PascalCase per dash-separated word, empty for the default package', async ({ page }) => {
  const r = await page.evaluate(() => ({
    def: Packages.idPrefix('postapoc'), empty: Packages.idPrefix(''), nul: Packages.idPrefix(null),
    one: Packages.idPrefix('medieval'), two: Packages.idPrefix('dark-age'), three: Packages.idPrefix('a-bc-def'),
  }));
  expect(r).toEqual({ def: '', empty: '', nul: '', one: 'Medieval_', two: 'DarkAge_', three: 'ABcDef_' });
});

test('Packages._rewriteEntries re-prefixes, keeps other fields, never mutates the input', async ({ page }) => {
  const r = await page.evaluate(() => {
    const input = [{ id: 'Old_A', type: 'Plain' }, { id: 'Bare', type: 'Hills' }, { id: 'Older_B' }];
    const before = JSON.stringify(input);
    return {
      out: Packages._rewriteEntries(input, 'old', 'new-pack'),
      untouched: JSON.stringify(input) === before,
      fromDefault: Packages._rewriteEntries([{ id: 'Plain_1' }], 'postapoc', 'medieval').map((e: any) => e.id),
      toDefault: Packages._rewriteEntries([{ id: 'Medieval_Plain_1' }], 'medieval', 'postapoc').map((e: any) => e.id),
      nothing: Packages._rewriteEntries(undefined, 'a', 'b'),
    };
  });
  expect(r.out).toEqual([
    { id: 'NewPack_A', type: 'Plain', package: 'new-pack' },
    { id: 'NewPack_Bare', type: 'Hills', package: 'new-pack' },   // lacks the old prefix: gets the new one
    { id: 'NewPack_Older_B', package: 'new-pack' },               // 'Older_' does not start with 'Old_'
  ]);
  expect(r.untouched).toBe(true);
  expect(r.fromDefault).toEqual(['Medieval_Plain_1']);            // default package has an empty old prefix
  expect(r.toDefault).toEqual(['Plain_1']);                       // and an empty new prefix
  expect(r.nothing).toEqual([]);
});

test('EdgeTiling.getMaskTable: one bit per face in SE,NE,N,NW,SW,S order, only family types with faces', async ({ page }) => {
  const r = await page.evaluate(() => {
    const d = HexDB.getData();
    HexDB.loadFromObject({ ...d, hexes: [...d.hexes.filter((h: any) => h.type !== 'Swamp' && h.type !== 'Volcanic/Rift'),
      { id: 'T_N', type: 'Swamp', spriteName: 'T_N', edgeFaces: ['N'] },
      { id: 'T_SE_S', type: 'Swamp', spriteName: 'T_SE_S', edgeFaces: ['S', 'SE', 'bogus'] },   // unknown face names are ignored
      { id: 'T_N_dup', type: 'Swamp', spriteName: 'T_N_dup', edgeFaces: ['N'] },
      { id: 'T_nofaces', type: 'Swamp', spriteName: 'T_nofaces' },
      { id: 'T_other', type: 'Volcanic/Rift', spriteName: 'T_other', edgeFaces: ['NE'] }] });
    EdgeTiling.clearCache();
    return { table: EdgeTiling.getMaskTable(['Swamp']), names: EdgeTiling.FACE_NAMES,
             same: EdgeTiling.getMaskTable(['Swamp']) === EdgeTiling.getMaskTable(['Swamp']) };
  });
  expect(r.names).toEqual(['SE', 'NE', 'N', 'NW', 'SW', 'S']);
  // N = bit 2 = 4; SE|S = bit 0 | bit 5 = 33. Entries without faces and of other types are absent.
  expect(r.table).toEqual({ 4: ['T_N', 'T_N_dup'], 33: ['T_SE_S'] });
  expect(r.same).toBe(true);   // memoised per family set until clearCache()
});

test('EdgeTiling.resolveEdgeTile: full ring picks the all-faces tile, no family neighbours the fallback, unknown ids and out-of-bounds count as dry', async ({ page }) => {
  const r = await page.evaluate(() => {
    const d = HexDB.getData();
    const faces = ['SE', 'NE', 'N', 'NW', 'SW', 'S'];
    HexDB.loadFromObject({ ...d, hexes: [...d.hexes.filter((h: any) => h.type !== 'Swamp' && h.type !== 'Volcanic/Rift'),
      { id: 'WT_ALL', type: 'Swamp', spriteName: 'WT_ALL', edgeFaces: faces },
      { id: 'WT_NONE', type: 'Swamp', spriteName: 'WT_NONE', edgeFaces: ['N'] }] });
    EdgeTiling.clearCache();
    const W = 7, H = 7, rng = () => 0, fam = ['Swamp'], fb = ['FALLBACK'];
    const wet = new Array(W * H).fill('WT_ALL');
    const dry = new Array(W * H).fill('Plain_1');
    const unknown = new Array(W * H).fill('NoSuchTile_9');
    let calls = 0;
    const counting = () => { calls++; return 0.99; };
    const two = EdgeTiling.resolveEdgeTile(3, 3, W, H, wet, fam, counting, fb);
    return {
      wet: EdgeTiling.resolveEdgeTile(3, 3, W, H, wet, fam, rng, fb),
      dry: EdgeTiling.resolveEdgeTile(3, 3, W, H, dry, fam, rng, fb),
      unknown: EdgeTiling.resolveEdgeTile(3, 3, W, H, unknown, fam, rng, fb),
      // corner of an all-wet grid: out-of-bounds faces are missing, so the mask is NOT the full one
      corner: EdgeTiling.resolveEdgeTile(0, 0, W, H, wet, fam, rng, fb),
      rngCalls: calls, two,
    };
  });
  expect(r.wet).toBe('WT_ALL');
  expect(r.dry).toBe('FALLBACK');
  expect(r.unknown).toBe('FALLBACK');
  expect(r.corner).toBe('FALLBACK');   // positive control for the line above: the interior cell of the same grid did match
  expect(r.rngCalls).toBe(1);          // exactly one rng draw per resolve
  expect(r.two).toBe('WT_ALL');        // rng 0.99 over a one-element list still picks it (floor(0.99*1)=0)
});

test('EdgeTiling.resolveEdgeTile reads each face through the legacy tables (K1): single wet neighbour selects the matching face tile', async ({ page }) => {
  // K1: EdgeTiling still uses the legacy _DIRS_EVEN/_DIRS_ODD tables (their "N" is col+1), so these literal offsets pin
  // TODAY's behaviour. When K1 is fixed this test must be updated together with the tables (expected values below are
  // the literal table entries, not read from the code under test).
  const r = await page.evaluate(() => {
    const d = HexDB.getData();
    const names = ['SE', 'NE', 'N', 'NW', 'SW', 'S'];
    HexDB.loadFromObject({ ...d, hexes: [...d.hexes.filter((h: any) => h.type !== 'Swamp' && h.type !== 'Volcanic/Rift'), ...names.map(n => ({ id: 'F_' + n, type: 'Swamp', spriteName: 'F_' + n, edgeFaces: [n] }))] });
    EdgeTiling.clearCache();
    const W = 9, H = 9;
    const want: Record<string, [number, number]> = {};
    // row 4 of H=9: (H-1-row)=4 even -> _DIRS_ODD ; row 3: 5 odd -> _DIRS_EVEN
    const ODD:  Record<string, [number, number]> = { N: [1, 0], S: [-1, 0], NE: [-1, -1], SE: [0, -1], NW: [-1, 1], SW: [0, 1] };
    const EVEN: Record<string, [number, number]> = { N: [1, 0], S: [-1, 0], NE: [0, -1], SE: [1, -1], NW: [0, 1], SW: [1, 1] };
    const out: Record<string, string> = {};
    for (const [row, tab] of [[4, ODD], [3, EVEN]] as const) {
      for (const n of names) {
        const grid = new Array(W * H).fill('Plain_1');
        const [dc, dr] = (tab as any)[n];
        grid[(row + dr) * W + (4 + dc)] = 'F_' + n;          // the neighbour on face n is "wet" (same type as the tile)
        out[row + ':' + n] = EdgeTiling.resolveEdgeTile(4, row, W, H, grid, ['Swamp'], () => 0, ['FALLBACK']);
      }
    }
    return out;
  });
  const exp: Record<string, string> = {};
  for (const row of [4, 3]) for (const n of ['SE', 'NE', 'N', 'NW', 'SW', 'S']) exp[row + ':' + n] = 'F_' + n;
  expect(r).toEqual(exp);
});

test('a legacy integer map is migrated to id strings on load (table, unknown ints, custom_terrain, falsy cells)', async ({ page }) => {
  const r = await page.evaluate(() => {
    // 12 wide x 11 high, non-square so a row/column mix-up shows. Row 0 holds known legacy ints, the rest is 12 (Plain_1).
    const W = 12, H = 11;
    const data = Array.from({ length: H }, () => new Array(W).fill(12));
    data[0][0] = 12; data[0][1] = 19; data[0][2] = 21; data[0][3] = 1; data[0][4] = 999; data[0][5] = 15;
    IO.loadFromJSON({ width: W, height: H, data, settlements: [],
      custom_terrain: [{ x: 7, y: 3, id: 'Forest_2' }, { x: -1, y: 2, id: 'Oil_1' }, { x: 2, y: 2 }] });
    return { w: MAP_WIDTH, h: MAP_HEIGHT, len: mapData.length, row0: mapData.slice(0, 6),
             allStrings: mapData.every(c => typeof c === 'string'), overlay: mapData[3 * W + 7], rest: mapData[5 * W + 5],
             negCell: mapData[2 * W + 2] };
  });
  expect(r.w).toBe(12); expect(r.h).toBe(11); expect(r.len).toBe(132);
  expect(r.row0).toEqual(['Plain_1', 'Mountain_1', 'Oil_1', 'Water_1', 'Plain_1', 'Forest_1']);   // 999 -> default
  expect(r.allStrings).toBe(true);
  expect(r.overlay).toBe('Forest_2');   // custom_terrain overlays only apply with the legacy format; col=x, row=y
  expect(r.rest).toBe('Plain_1');
  expect(r.negCell).toBe('Plain_1');    // overlays at x<0 or without an id are ignored
});

test('a string map keeps its ids; null/empty cells load as Plain_1 and short rows are tolerated', async ({ page }) => {
  const r = await page.evaluate(() => {
    IO.loadFromJSON({ width: 10, height: 10, settlements: [],
      data: [['Water_1', null, '', 'Oil_1'], undefined, ['Rubble_1']] });
    return { a: mapData.slice(0, 5), r2: mapData[2 * MAP_WIDTH], r1: mapData[MAP_WIDTH], len: mapData.length };
  });
  expect(r).toEqual({ a: ['Water_1', 'Plain_1', 'Plain_1', 'Oil_1', 'Plain_1'], r2: 'Rubble_1', r1: 'Plain_1', len: 100 });
});
