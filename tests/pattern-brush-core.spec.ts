// The pattern brush core (pattern-brush.js) is pure: patterns, sources, mappers, cellsFor. No browser.
import { test, expect } from '@playwright/test';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PB = require('../pattern-brush.js');

const P = (w: number, h: number, ids: (string | null)[]) => PB.makePattern(w, h, ids, 'p');
const cells = (pairs: [number, number][]) => pairs.map(([col, row]) => ({ col, row }));

test.describe('pattern brush core', () => {
  test('makePattern validates the size and the cell count, and turns empty values into null', () => {
    expect(() => PB.makePattern(0, 2, [], 'x')).toThrow(/at least 1x1/);
    expect(() => PB.makePattern(2, 2, ['a'], 'x')).toThrow(/expected 4 cells, got 1/);
    expect(() => PB.makePattern(2000, 2000, [], 'x')).toThrow(/too big/);
    expect(P(2, 1, ['a', '']).ids).toEqual(['a', null]);
    expect(P(2, 1, ['a', 7 as any]).ids).toEqual(['a', null]);
  });

  test('grid mapper: the pattern repeats on the map grid, whenever and wherever it is painted', () => {
    const p = P(2, 2, ['a', 'b', 'c', 'd']);   // row 0: a b   row 1: c d
    const out = PB.cellsFor(cells([[0, 0], [1, 0], [2, 0], [0, 1], [3, 1], [5, 3]]), p);
    expect(out.map((c: any) => c.id)).toEqual(['a', 'b', 'a', 'c', 'd', 'd']);
    // the same cell gets the same id from a different stroke: no seams between passes
    expect(PB.cellsFor(cells([[3, 1]]), p)[0].id).toBe('d');
    expect(PB.cellsFor(cells([[3, 1], [0, 0]]), p)[0].id).toBe('d');
  });

  test('grid mapper: negative coordinates and the offset', () => {
    const p = P(3, 1, ['a', 'b', 'c']);
    expect(PB.cellsFor(cells([[-1, 0], [-3, 0]]), p).map((c: any) => c.id)).toEqual(['c', 'a']);
    expect(PB.cellsFor(cells([[0, 0], [1, 0]]), p, { ox: 1 }).map((c: any) => c.id)).toEqual(['c', 'a']);
    expect(PB.cellsFor(cells([[0, 0]]), P(1, 3, ['x', 'y', 'z']), { oy: 1 })[0].id).toBe('z');
  });

  test('empty pattern cells and skipped ids are not drawn (case-insensitive); the rest keep their positions', () => {
    const p = P(3, 1, ['a', null, 'Plain_1']);
    const out = PB.cellsFor(cells([[0, 0], [1, 0], [2, 0]]), p, { skip: ['plain_1'] });
    expect(out).toEqual([{ col: 0, row: 0, id: 'a' }]);
  });

  test('an unknown mapper is an error, and a new mapper plugs in without touching the core', () => {
    expect(() => PB.cellsFor(cells([[0, 0]]), P(1, 1, ['a']), { mapper: 'nope' })).toThrow(/not registered/);
    PB.registerMapper('first-only', { label: 'Always the first cell', pick: (p: any) => p.ids[0] });
    expect(PB.cellsFor(cells([[4, 4]]), P(2, 1, ['q', 'r']), { mapper: 'first-only' })[0].id).toBe('q');
    expect(PB.listMappers().map((m: any) => m.key)).toEqual(expect.arrayContaining(['grid', 'first-only']));
    expect(() => PB.registerMapper('bad', {})).toThrow();
  });

  test('mapper options travel through: a mapper can read its own fields', () => {
    PB.registerMapper('every-nth', { label: 'x', pick: (p: any, col: number, _r: number, o: any) => (col % o.n === 0 ? p.ids[0] : null) });
    const out = PB.cellsFor(cells([[0, 0], [1, 0], [2, 0], [3, 0]]), P(1, 1, ['t']), { mapper: 'every-nth', n: 2 });
    expect(out.map((c: any) => c.col)).toEqual([0, 2]);
  });

  test('map source: a map file becomes a pattern of its tiles; malformed maps are refused', async () => {
    const json = { width: 3, height: 2, data: [['a', 'b', 'c'], ['d', 'e', 'f']] };
    const p = await PB.load('map', { json, name: 'M' });
    expect([p.w, p.h, p.name, p.ids.join('')]).toEqual([3, 2, 'M', 'abcdef']);
    await expect(PB.load('map', { json: {} })).rejects.toThrow(/Not a map/);
    await expect(PB.load('map', { json: { data: [['a'], ['b', 'c']] } })).rejects.toThrow(/different lengths/);
    await expect(PB.load('nope', {})).rejects.toThrow(/not registered/);
  });

  test('cells source: a rectangle of selected cells, gaps stay empty', async () => {
    const p = await PB.load('cells', { cells: [{ col: 5, row: 7, id: 'a' }, { col: 7, row: 8, id: 'b' }] });
    expect([p.w, p.h]).toEqual([3, 2]);
    expect(p.ids).toEqual(['a', null, null, null, null, 'b']);
    await expect(PB.load('cells', { cells: [] })).rejects.toThrow(/Nothing selected/);
  });

  test('a new source plugs in as one function', async () => {
    PB.registerSource('checker', { label: 'Checker', load: () => ({ name: 'c', w: 2, h: 2, ids: ['a', 'b', 'b', 'a'] }) });
    expect((await PB.load('checker')).ids).toEqual(['a', 'b', 'b', 'a']);
    expect(PB.listSources().map((s: any) => s.key)).toEqual(expect.arrayContaining(['map', 'cells', 'checker']));
  });

  test('a 50x50 map tiled over 450x450 reproduces the tiling we published for the full-size test map', async () => {
    const data = Array.from({ length: 50 }, (_, r) => Array.from({ length: 50 }, (_, c) => `T${r}_${c}`));
    const p = await PB.load('map', { json: { data } });
    const all: any[] = []; for (let r = 0; r < 450; r++) for (let c = 0; c < 450; c++) all.push({ col: c, row: r });
    const out = PB.cellsFor(all, p);
    expect(out.length).toBe(202500);
    expect(out[50 * 450 + 100].id).toBe('T0_0');   // row 50, col 100 is the origin of a copy: matches data[50][100] == data[0][0] of the tiled map
    expect(out[449 * 450 + 449].id).toBe('T49_49');
  });
});
