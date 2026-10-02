import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene } from './perf-scene';

declare const History: any, mapData: string[], tileExtras: any, roadsData: any, objectsData: any,
  settlements: any[], bridgesData: any[], ZonePainter: any, IO: any, MAP_WIDTH: number, MAP_HEIGHT: number;
test.use({ viewport: VIEWPORT });

test('undo/redo restores every field exactly', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const r = await page.evaluate(() => {
    const sig = () => JSON.stringify([mapData.length, mapData.join(','), tileExtras, roadsData, objectsData]);
    History.clear();
    const s0 = sig();
    History.push();
    mapData[5] = 'Lava_Plain_1'; mapData[450 * 300 + 12] = 'Rift_1';
    tileExtras['7,7'] = { underTerrainId: 'Water_1' };
    delete roadsData[Object.keys(roadsData)[0]];
    const s1 = sig();
    History.push();
    mapData[9] = 'Oil_1';
    objectsData['1,1'] = 'x';
    const s2 = sig();
    History.undo(); const afterUndo1 = sig();
    History.undo(); const afterUndo2 = sig();
    History.redo(); const afterRedo1 = sig();
    History.redo(); const afterRedo2 = sig();
    return { s0, s1, s2, afterUndo1, afterUndo2, afterRedo1, afterRedo2 };
  });
  expect(r.afterUndo1).toBe(r.s1);
  expect(r.afterUndo2).toBe(r.s0);
  expect(r.afterRedo1).toBe(r.s1);
  expect(r.afterRedo2).toBe(r.s2);
});

test('50-step cap still evicts the oldest', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const size = await page.evaluate(() => {
    History.clear();
    for (let i = 0; i < 55; i++) { mapData[i] = 'Oil_1'; History.push(); }
    return History.undoSize();
  });
  expect(size).toBe(50);
});

test('50 one-tile edits share almost all row storage', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const rows = await page.evaluate(() => {
    History.clear();
    for (let i = 0; i < 50; i++) { mapData[(i * 7919) % mapData.length] = i % 2 ? 'Water_1' : 'Plain_1'; History.push(); }
    return { distinct: History.debugRowCount(), height: MAP_HEIGHT };
  });
  // grid: one full copy (450 rows) + at most 1 changed row per step; zone layer: one full copy (zone rows never change)
  expect(rows.distinct).toBeLessThanOrEqual(rows.height * 2 + 50 * 2 + 10);
});

test('snapshots never alias live data (live edits after push do not leak into older snapshots)', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const r = await page.evaluate(() => {
    const zl = ZonePainter.getZoneLayer();
    const sig = () => JSON.stringify([mapData.join(','), Array.from(zl).join(''), tileExtras, roadsData, objectsData, settlements, bridgesData]);
    History.clear();
    tileExtras['3,3'] = { note: 'a' };
    const s0 = sig();
    History.push();                       // snapshot of s0
    mapData[10] = 'Oil_1'; mapData[450 * 7 + 3] = 'Oil_1'; zl[10] = 1;
    tileExtras['3,3'].note = 'b';         // in-place mutation of a nested live value
    roadsData['9,9'] = { type: 'road_hex' };
    const s1 = sig();
    History.push();                       // snapshot of s1 (shares the unchanged rows)
    mapData[10] = 'Water_1'; mapData[11] = 'Water_1'; zl[10] = 2; tileExtras['3,3'].note = 'c';
    const sc = sig();
    History.undo();                       // back to s1; the live arrays must now be fresh copies
    const u1 = sig();
    mapData[10] = 'Hills_1'; zl[10] = 3; tileExtras['3,3'].note = 'd';   // live edit after restore must not touch any snapshot
    const sd = sig();
    History.undo();                       // back to s0
    const u0 = sig();
    History.redo(); const rd = sig();     // the state undone from (sd)
    History.redo(); const rc = sig();     // the state undone from first (sc)
    // shared-object scenario: two consecutive snapshots with an unchanged tileExtras entry share its object
    History.clear();
    tileExtras['5,5'] = { note: 'orig' };
    const t0 = sig();
    History.push(); History.push();       // P1, P2 (P2 shares P1's extras object)
    History.undo();                       // restore P2 into live
    tileExtras['5,5'].note = 'mutated';   // must not reach P1
    mapData[1] = 'Oil_1';
    History.undo();                       // restore P1
    const tp1 = sig();
    return { s0, s1, sd, sc, u1, u0, rd, rc, t0, tp1 };
  });
  expect(r.tp1).toBe(r.t0);
  expect(r.u1).toBe(r.s1);
  expect(r.u0).toBe(r.s0);
  expect(r.rd).toBe(r.sd);
  expect(r.rc).toBe(r.sc);
});

test('randomized undo/redo matches a full-copy reference over 300 mixed operations', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await setupScene(page);
  const res = await page.evaluate(() => {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const ri = (n: number) => Math.floor(rnd() * n);
    const ids = ['Plain_1', 'Water_1', 'Forest_1', 'Hills_1', 'Oil_1', 'Rubble_1'];
    const zlive = () => ZonePainter.getZoneLayer();
    const sig = () => JSON.stringify([MAP_WIDTH, MAP_HEIGHT, mapData.length, mapData.join(','), Array.from(zlive()).join(''),
      tileExtras, roadsData, objectsData, settlements, bridgesData]);
    const bld = Object.values(objectsData)[0] as string;
    IO.setNewMapSize(120, 120); IO.applyNewMap();   // smaller map so Expand Map (max 450) is possible
    History.clear();
    const refU: string[] = [], refR: string[] = [];
    const ops: string[] = [];
    const mismatches: string[] = [];
    const edit = () => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const k = ri(6);
      if (k === 0) { for (let i = ri(5) + 1; i > 0; i--) mapData[ri(mapData.length)] = ids[ri(ids.length)]; ops.push('paint'); }
      else if (k === 1) { const r = ri(H), id = ids[ri(ids.length)]; for (let c = 0; c < W; c++) mapData[r * W + c] = id; zlive()[r * W + 3] = 1 + ri(3); ops.push('fill'); }
      else if (k === 2) { if (rnd() < 0.5 || !Object.keys(roadsData).length) roadsData[ri(W) + ',' + ri(H)] = { type: 'road_hex' };
        else delete roadsData[Object.keys(roadsData)[ri(Object.keys(roadsData).length)]]; ops.push('road'); }
      else if (k === 3) { const key = ri(W) + ',' + ri(H); if (tileExtras[key] && rnd() < 0.5) tileExtras[key].note = 'n' + ri(9); else tileExtras[key] = { underTerrainId: 'Water_1', note: 'n' + ri(9) }; ops.push('extras'); }
      else if (k === 4) { if (rnd() < 0.6 || !settlements.length) settlements.push({ col: ri(W), row: ri(H), type: 'village' }); else settlements.splice(ri(settlements.length), 1); ops.push('settle'); }
      else { objectsData[ri(W) + ',' + ri(H)] = bld; ops.push('object'); }
    };
    let n = 0;
    while (n < 300) {
      const k = ri(10);
      if (k < 5) {                       // edit with push-before (real editor semantics)
        refU.push(sig()); if (refU.length > 50) refU.shift(); refR.length = 0;
        History.push(); edit(); n++;
      } else if (k < 7) {                // undo
        if (refU.length) { refR.push(sig()); const want = refU.pop()!; History.undo(); if (sig() !== want) mismatches.push('undo@' + n); }
        else History.undo();
        ops.push('undo'); n++;
      } else if (k < 9) {                // redo
        if (refR.length) { refU.push(sig()); const want = refR.pop()!; History.redo(); if (sig() !== want) mismatches.push('redo@' + n); }
        else History.redo();
        ops.push('redo'); n++;
      } else if (rnd() < 0.15) {         // expand map by 1 each side (History cleared by the real code)
        (document.getElementById('expandmap-amount') as HTMLInputElement).value = '1';
        IO.applyExpandMap(); refU.length = 0; refR.length = 0; refU.push(sig());   // applyExpandMap clears, then pushes the new state
        ops.push('expand'); n++;
      }
      if (History.undoSize() !== refU.length || History.redoSize() !== refR.length) { mismatches.push('stack@' + n); break; }
    }
    // drain everything back with undo and redo, comparing against the reference
    while (refU.length) { refR.push(sig()); const want = refU.pop()!; History.undo(); if (sig() !== want) mismatches.push('drain-undo'); }
    while (refR.length) { refU.push(sig()); const want = refR.pop()!; History.redo(); if (sig() !== want) mismatches.push('drain-redo'); }
    return { mismatches, expands: ops.filter(o => o === 'expand').length, kinds: Array.from(new Set(ops)).sort(), width: MAP_WIDTH };
  });
  expect(res.mismatches).toEqual([]);
  expect(res.expands).toBeGreaterThan(0);
  expect(res.kinds).toEqual(expect.arrayContaining(['paint', 'fill', 'road', 'extras', 'settle', 'object', 'undo', 'redo', 'expand']));
});
