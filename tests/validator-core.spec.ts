import { test, expect, Page } from '@playwright/test';
import { openEditor } from './helpers';
import { freshEditor } from './editor-helpers';

// T4.5 MapValidator core. validate(state, stats?) is pure: snapshot in, issues out.
// issue = { id, key, severity, message, cells: [{col,row}] (first 200), total }.
// Synthetic tests use an injected 4-neighbour grid so the logic is checked without hex geometry; the real-geometry
// tests below derive adjacency independently from Canvas.hexCenterWorld distances.

const run = (page: Page, tweak: string, W = 5, H = 5) => page.evaluate(([src, W, H]) => {
  const mk = (id: string, type: string, spriteName = id) => ({ id, type, spriteName });
  const st: any = {
    width: W, height: H, data: new Array(W * H).fill('Plain_1'),
    settlements: [{ col: 2, row: 2, type: 'city' }], roads: {}, objects: {}, bridges: [],
    hexById: new Map([['plain_1', mk('Plain_1', 'Plains')], ['water_1', mk('Water_1', 'Water')], ['river_1', mk('River_1', 'Rivers')],
      ['mountain_1', mk('Mountain_1', 'Hills/Mountains')], ['lava_plain_1', mk('Lava_Plain_1', 'Volcanic/Rift')],
      ['lava_rift_1', mk('Lava_Rift_1', 'Volcanic/Rift')], ['rift_1', mk('Rift_1', 'Volcanic/Rift')],
      ['hills_1', mk('Hills_1', 'Hills/Mountains')], ['forest_1', mk('Forest_1', 'Forests')], ['nosprite_1', { id: 'NoSprite_1', type: 'Plains' }]]),
    bldById: new Map([['farm_1', { id: 'Farm_1', needRoad: true }]]), needRoad: new Set(['farm_1']),
    cityCol: 2, cityRow: 2, spriteState: () => 'loaded',
    neighbors: (c: number, r: number) => [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]
      .filter(([x, y]) => x >= 0 && x < W && y >= 0 && y < H).map(([col, row]) => ({ col, row })),
  };
  new Function('st', src as string)(st);
  const stats: any = {};
  const before = JSON.stringify([st.data, st.settlements, st.roads, st.objects, st.bridges]);
  const issues = MapValidator.validate(st, stats);
  const after = JSON.stringify([st.data, st.settlements, st.roads, st.objects, st.bridges]);
  return { issues, stats, mutated: before !== after, again: JSON.stringify(MapValidator.validate(st)) === JSON.stringify(issues) };
}, [tweak, W, H] as const);
const ids = (r: any) => r.issues.map((i: any) => i.id);

test.describe('MapValidator.validate (synthetic grid)', () => {
  test.beforeEach(async ({ page }) => { await openEditor(page); });

  test('a clean map has no issues, does not mutate its input and is deterministic', async ({ page }) => {
    const r = await run(page, '');
    expect(r.issues).toEqual([]);
    expect(r.mutated).toBe(false);
    expect(r.again).toBe(true);
  });

  test('unknown tile and object ids: aggregated per id, errors, cells and totals; counts agree with IO.analyzeMap', async ({ page }) => {
    const r = await run(page, "st.data[0]='Nope_1'; st.data[7]='Nope_1'; st.data[8]='nope_2'; st.objects['4,4']='Ghost_B'; st.objects['1,1']='Farm_1';");
    expect(ids(r)).toEqual(['unknown-id', 'unknown-id', 'unknown-object']);
    const [a, b, o] = r.issues;
    expect(a).toMatchObject({ severity: 'error', total: 2, cells: [{ col: 0, row: 0 }, { col: 2, row: 1 }] });
    expect(a.message).toContain('Nope_1');
    expect(b).toMatchObject({ severity: 'error', total: 1, cells: [{ col: 3, row: 1 }] });
    expect(o).toMatchObject({ severity: 'error', total: 1, cells: [{ col: 4, row: 4 }] });
    expect(o.message).toContain('Ghost_B');
    // shared helper: the same count analyzeMap reports for the same snapshot (no second implementation of the id check)
    const n = await page.evaluate(() => {
      const known = ['plain_1', 'farm_1'];
      const rows = [['Nope_1', 'Plain_1', 'Plain_1', 'Plain_1', 'Plain_1'], ['Plain_1', 'Plain_1', 'Nope_1', 'nope_2', 'Plain_1']];
      return IO.analyzeMap({ width: 5, height: 5, data: rows, objects: [{ col: 4, row: 4, id: 'Ghost_B' }] }, { knownIds: known }).unknownCount;
    });
    expect(n).toBe(r.issues.reduce((s: number, i: any) => s + i.total, 0));
  });

  test('issue cells are capped at 200 with the true total; many distinct ids are bounded too', async ({ page }) => {
    const r = await run(page, "st.data.fill('Nope_1');", 20, 20);   // 400 unknown cells; the city settlement still at 2,2
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].total).toBe(400);
    expect(r.issues[0].cells).toHaveLength(200);
    expect(r.issues[0].cells[199]).toEqual({ col: 19, row: 9 });   // first 200 in row-major order
    const d = await run(page, "for (let i=0;i<400;i++) st.data[i]='X_'+i;", 20, 20);
    expect(d.issues.length).toBeLessThanOrEqual(51);
    expect(d.issues.reduce((s: number, i: any) => s + i.total, 0)).toBe(400);
    expect(d.issues.every((i: any) => i.cells.length <= 200)).toBe(true);
  });

  test('missing city is an error and suppresses the reachability rule', async ({ page }) => {
    const r = await run(page, "st.settlements = [{col:4,row:4,type:'settlement'}]; st.data[3*5+4]='Water_1'; st.data[4*5+3]='Water_1';");
    expect(r.issues).toEqual([expect.objectContaining({ id: 'missing-city', severity: 'error', cells: [{ col: 2, row: 2 }] })]);
  });

  test('a settlement walled in by water is unreachable (warning); every wall type counts, a bridge opens it', async ({ page }) => {
    const wall = (id: string) => `st.settlements.push({col:4,row:4,type:'settlement'}); st.data[3*5+4]='${id}'; st.data[4*5+3]='${id}';`;
    const r = await run(page, wall('Water_1'));
    expect(r.issues).toEqual([expect.objectContaining({ id: 'unreachable-settlement', severity: 'warning', total: 1, cells: [{ col: 4, row: 4 }] })]);
    // hand-written impassable list (independent of MapValidator.IMPASSABLE): these block, these do not
    for (const id of ['Water_1', 'River_1', 'Mountain_1', 'Lava_Plain_1', 'Lava_Rift_1', 'Rift_1']) expect(ids(await run(page, wall(id))), id).toEqual(['unreachable-settlement']);
    for (const id of ['Hills_1', 'Forest_1', 'Plain_1', 'Unknown_Tile']) expect(ids(await run(page, wall(id))), id).not.toContain('unreachable-settlement');
    expect(ids(await run(page, wall('Water_1') + " st.bridges=[{col:4,row:3,axis:0}];"))).toEqual([]);
    // the settlement standing on water itself is unreachable too (its own cell is impassable and not bridged)
    expect(ids(await run(page, "st.settlements.push({col:4,row:0,type:'settlement'}); st.data[4]='Water_1';"))).toEqual(['unreachable-settlement']);
  });

  test('reachability needs a full cut: a river wall with one gap is passable; settlements off the map are unreachable', async ({ page }) => {
    const wall = "st.settlements.push({col:4,row:2,type:'settlement'}); for (let r=0;r<5;r++) st.data[r*5+3]='River_1';";
    expect(ids(await run(page, wall))).toEqual(['unreachable-settlement']);
    expect(ids(await run(page, wall + ' st.data[4*5+3]="Plain_1";'))).toEqual([]);
    expect(ids(await run(page, "st.settlements.push({col:9,row:9,type:'settlement'});"))).toEqual(['unreachable-settlement']);
  });

  test('orphan roads: touching nothing is reported; road, settlement, city or needRoad building neighbours connect', async ({ page }) => {
    const r = await run(page, "st.roads['0,0']={}; st.roads['2,1']={}; st.roads['4,4']={}; st.roads['4,3']={}; st.roads['0,4']={}; st.objects['1,4']='Farm_1'; st.roads['4,0']={}; st.objects['3,0']='Plain_1';");
    // 2,1 touches the city; 4,4+4,3 touch each other; 0,4 touches a needRoad farm; 0,0 and 4,0 touch nothing (a non-needRoad object does not count)
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ id: 'orphan-road', severity: 'warning', total: 2 });
    expect(r.issues[0].cells).toEqual([{ col: 0, row: 0 }, { col: 4, row: 0 }]);
    expect(ids(await run(page, "st.settlements.push({col:0,row:0,type:'settlement'}); st.roads['0,1']={};"))).toEqual([]);
  });

  test('missing sprites: only a FAILED load counts; pending, loaded and spriteless entries do not', async ({ page }) => {
    const r = await run(page, "st.spriteState = id => ({ forest_1: 'failed', plain_1: 'pending' })[id.toLowerCase()] || 'loaded'; st.data[6]='Forest_1'; st.data[12]='Forest_1'; st.data[0]='NoSprite_1';");
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ id: 'missing-sprite', severity: 'warning', total: 2, cells: [{ col: 1, row: 1 }, { col: 2, row: 2 }] });
    expect(r.issues[0].message).toContain('Forest_1');
    expect(r.stats.spriteScanCells).toBe(25);                                   // the cell pass runs because one sprite failed...
    expect((await run(page, '')).stats.spriteScanCells).toBe(0);                // ...and is skipped when none did
    // everything pending (right after startup) is NOT a problem, and is reported through the state, not as an issue
    expect(ids(await run(page, "st.spriteState = () => 'pending';"))).toEqual([]);
    expect(ids(await run(page, "st.spriteState = () => 'unknown';"))).toEqual([]);
  });

  test('ordering: errors first, then rule order, then by count descending and id', async ({ page }) => {
    const r = await run(page, "st.settlements.push({col:4,row:4,type:'settlement'}); st.data[3*5+4]='Water_1'; st.data[4*5+3]='Water_1'; st.roads['0,0']={};" +
      "st.data[1]='B_1'; st.data[2]='A_1'; st.data[3]='A_1'; st.data[4]='C_1'; st.data[5]='C_1';");
    expect(r.issues.map((i: any) => i.id + ':' + (i.message.match(/"([^"]+)"/) || ['', ''])[1])).toEqual(
      ['unknown-id:A_1', 'unknown-id:C_1', 'unknown-id:B_1', 'unreachable-settlement:', 'orphan-road:']);
    expect(r.issues.map((i: any) => i.severity)).toEqual(['error', 'error', 'error', 'warning', 'warning']);
  });

  test('work counters: one scan of the cells, BFS visits each cell at most once and stops when every settlement is found', async ({ page }) => {
    const base = "st.settlements.push({col:4,row:2,type:'settlement'});";
    const r = await run(page, base, 30, 30);
    expect(r.stats.cellsScanned).toBe(900);
    expect(r.stats.bfsPops).toBeLessThanOrEqual(900);
    expect(r.stats.neighborCalls).toBe(r.stats.bfsPops);
    // positive control: the settlement is 2 cells from the city, so the early exit keeps the BFS tiny...
    expect(r.stats.bfsPops).toBeLessThan(40);
    // ...while an unreachable one forces the full flood but never more than once per cell
    const w = await run(page, "st.settlements.push({col:29,row:29,type:'settlement'}); st.data[28*30+29]='Water_1'; st.data[29*30+28]='Water_1';", 30, 30);
    expect(w.stats.bfsPops).toBeGreaterThan(800);
    expect(w.stats.bfsPops).toBeLessThanOrEqual(900);
    // ten more reachable settlements add no BFS work beyond the first target set
    const many = await run(page, "for (let i=0;i<10;i++) st.settlements.push({col:3,row:i,type:'settlement'});", 30, 30);
    expect(many.stats.cellsScanned).toBe(900);
    expect(many.stats.bfsPops).toBeLessThanOrEqual(900);
  });
});

test.describe('MapValidator on the live map (real HexUtils geometry)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  // Independent adjacency: two cells touch when their centres are one pitch apart (Canvas.hexCenterWorld), not via HexUtils.
  async function touching(page: Page, col: number, row: number) {
    return page.evaluate(([c, r]) => {
      const p = Canvas.hexCenterWorld(c, r), out: { col: number; row: number }[] = [];
      let min = Infinity;
      const all: any[] = [];
      for (let dc = -2; dc <= 2; dc++) for (let dr = -2; dr <= 2; dr++) {
        if (!dc && !dr) continue;
        const q = Canvas.hexCenterWorld(c + dc, r + dr), d = Math.hypot(q.x - p.x, q.y - p.y);
        all.push({ col: c + dc, row: r + dr, d }); min = Math.min(min, d);
      }
      all.forEach(a => { if (a.d < min * 1.1) out.push({ col: a.col, row: a.row }); });
      return out;
    }, [col, row]);
  }

  test('the independent neighbour reference has six cells, and walling all six cuts a settlement off (five do not)', async ({ page }) => {
    const nb = await touching(page, 100, 100);
    expect(nb).toHaveLength(6);
    const wall = (cells: { col: number; row: number }[]) => page.evaluate((cs) => {
      const ct = settlements.find((s: any) => s.type === 'city'); settlements = [ct, { col: 100, row: 100, type: 'settlement' }];
      cs.forEach(c => { mapData[c.row * MAP_WIDTH + c.col] = 'Water_1'; });
      return MapValidator.run().issues.map((i: any) => i.id);
    }, cells);
    expect(await wall(nb.slice(0, 5))).toEqual([]);
    expect(await wall(nb)).toEqual(['unreachable-settlement']);
  });

  test('a blank map with a stray road and a bare settlement; unknown ids come from the live tile databases', async ({ page }) => {
    const r = await page.evaluate(() => {
      settlements = [{ col: 225, row: 224, type: 'city' }, { col: 10, row: 10, type: 'settlement' }];
      roadsData['300,300'] = {};
      mapData[5 * MAP_WIDTH + 5] = 'Totally_Unknown';
      const rep = MapValidator.run();
      return { ids: rep.issues.map((i: any) => i.id), errors: rep.errors, warnings: rep.warnings, pending: rep.pendingSprites, md: mapData[5 * MAP_WIDTH + 5] };
    });
    expect(r.ids).toEqual(['unknown-id', 'orphan-road']);
    expect(r.errors).toBe(1);
    expect(r.warnings).toBe(1);
    expect(r.md).toBe('Totally_Unknown');   // read-only
  });

  test('the city is whatever the city entry says: a moved city is not reported, a missing one is', async ({ page }) => {
    const r = await page.evaluate(() => {
      Tools.moveCity(100, 120);
      const moved = MapValidator.run().issues.map((i: any) => i.id);
      settlements = settlements.filter((s: any) => s.type !== 'city');
      return { moved, gone: MapValidator.run().issues.map((i: any) => i.id) };
    });
    expect(r.moved).toEqual([]);
    expect(r.gone).toEqual(['missing-city']);
  });

  test('full-size run: one scan of 202500 cells, no DOM writes, early-exit BFS, bounded output', async ({ page }) => {
    const r = await page.evaluate(() => {
      for (let i = 0; i < 300; i++) settlements.push({ col: 226 + (i % 20), row: 224 + ((i / 20) | 0), type: 'settlement' });
      let muts = 0; const mo = new MutationObserver(l => { muts += l.length; }); mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      const stats: any = {};
      const issues = MapValidator.validate(MapValidator.collectState(), stats);
      return new Promise(res => setTimeout(() => { mo.disconnect(); res({ issues: issues.length, stats, muts }); }, 50));
    }) as any;
    expect(r.issues).toBe(0);
    expect(r.stats.cellsScanned).toBe(450 * 450);
    expect(r.stats.bfsPops).toBeGreaterThan(300);        // positive control: the flood really ran
    expect(r.stats.bfsPops).toBeLessThan(5000);          // ...and stopped once the 300 targets were found
    expect(r.muts).toBe(0);
  });

  test('IMPASSABLE is one exported list the BFS actually uses', async ({ page }) => {
    const r = await page.evaluate(() => ({ t: [...MapValidator.IMPASSABLE.types].sort(), i: [...MapValidator.IMPASSABLE.ids].sort(), p: [...(MapValidator.IMPASSABLE as any).prefixes] }));
    expect(r.t).toEqual(['rivers', 'volcanic/rift', 'water']);    // from the HexDB type
    expect(r.p).toEqual(['mountain_']);                            // Hills/Mountains share a type with the passable Hills_1
    expect(r.i).toEqual(['lava_plain_1', 'lava_rift_1', 'rift_1']);   // fallback for ids missing from the HexDB
  });
});

test.describe('Terrain sprite state (loaded or failed)', () => {
  test('pending then failed for a missing file, loaded for a real one; the validator reports only the failed id', async ({ page }) => {
    await freshEditor(page);
    const r = await page.evaluate(async () => {
      const states: string[] = [Terrain.spriteState('Plain_1')];
      HexDB.getAll().push({ id: 'Broken_Spr_1', type: 'Plains', spriteName: 'does_not_exist_zz' });
      const p = Terrain.applyHexDbOverrides([{ id: 'Broken_Spr_1', type: 'Plains', spriteName: 'does_not_exist_zz' }]);
      states.push(Terrain.spriteState('Broken_Spr_1'), String(Terrain.pendingSprites() >= 1));
      await p;
      states.push(Terrain.spriteState('Broken_Spr_1'), Terrain.spriteState('Never_Heard_Of'));
      mapData[3 * MAP_WIDTH + 4] = 'Broken_Spr_1';
      const rep = MapValidator.run();
      return { states, issues: rep.issues.map((i: any) => [i.id, i.total, i.cells[0]]) };
    });
    expect(r.states).toEqual(['loaded', 'pending', 'true', 'failed', 'unknown']);
    expect(r.issues).toEqual([['missing-sprite', 1, { col: 4, row: 3 }]]);
  });
});
