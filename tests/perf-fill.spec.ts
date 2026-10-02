import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT } from './perf-scene';

declare const Canvas: any, UI: any, Tools: any, IO: any, History: any, HexDB: any, Terrain: any, mapData: string[], MAP_WIDTH: number, MAP_HEIGHT: number;
test.use({ viewport: VIEWPORT });

// Copy of the pre-T1.8 synchronous fill (Array.shift queue, Set of numeric keys); returns the resulting map.
const REF = `
window.__refFill = function (map, anchorOf, col, row, fillId) {
  const W = MAP_WIDTH, H = MAP_HEIGHT, out = map.slice();
  const targetId = out[row * W + col];
  if (targetId === fillId) return out;
  const visited = new Set(), queue = [[col, row]];
  const key = (c, r) => c * 10000 + r;
  visited.add(key(col, row));
  while (queue.length) {
    const [c, r] = queue.shift();
    if (anchorOf(c, r)) continue;
    out[r * W + c] = fillId;
    const even = c % 2 === 0;
    const nbrs = [[c, r-1], [c+1, even ? r-1 : r], [c+1, even ? r : r+1], [c, r+1], [c-1, even ? r : r+1], [c-1, even ? r-1 : r]];
    nbrs.forEach(([nc, nr]) => {
      if (nc < 0 || nc >= W || nr < 0 || nr >= H) return;
      const k = key(nc, nr);
      if (visited.has(k)) return;
      if (out[nr * W + nc] !== targetId) return;
      visited.add(k);
      queue.push([nc, nr]);
    });
  }
  return out;
};`;

test('matches the reference synchronous fill on random maps with multi-tile footprints and a uniform map', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(REF);
  const res = await page.evaluate(async () => {
    const entry = Terrain.byHexId('Hills_1');
    const saved = entry.occupiedOffsets;
    entry.occupiedOffsets = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];   // Hills_1 becomes a 7-tile footprint
    const out: any[] = [];
    try {
      const ids = ['Plain_1', 'Plain_2', 'Forest_1', 'Water_1', 'Hills_1', 'Rubble_1'];
      for (let seed = 1; seed <= 4; seed++) {
        IO.newMap(true);
        let s = seed * 2654435761 >>> 0;
        const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
        const k = seed === 4 ? 1 : 3;   // seed 4: only 'Plain_1' and speckles (one huge region)
        const blocks: Record<string, string> = {};
        for (let r = 0; r < MAP_HEIGHT; r++) for (let c = 0; c < MAP_WIDTH; c++) {
          const bk = (c >> 4) + ',' + (r >> 4);
          if (!(bk in blocks)) blocks[bk] = ids[Math.floor(rnd() * (seed === 4 ? 1 : 4))];
          mapData[r * MAP_WIDTH + c] = rnd() < 0.04 * k ? ids[Math.floor(rnd() * ids.length)] : blocks[bk];
        }
        Tools.setActive('fill');
        for (let t = 0; t < 3; t++) {
          const col = Math.floor(rnd() * MAP_WIDTH), row = Math.floor(rnd() * MAP_HEIGHT);
          const fillId = mapData[row * MAP_WIDTH + col] === 'Forest_2' ? 'Plain_2' : 'Forest_2';
          UI.selectTerrain(fillId);
          invalidateSat();
          const expected = (window as any).__refFill(mapData, getSatelliteAnchor, col, row, fillId);
          await Tools.fill(col, row);
          out.push({ seed, t, same: expected.length === mapData.length && expected.every((v: string, i: number) => v === mapData[i]), changed: expected.filter((v: string, i: number) => v !== 'x' && v === fillId).length });
        }
      }
      // whole uniform 450x450 map
      IO.newMap(true); mapData.fill('Plain_1');
      UI.selectTerrain('Forest_1'); Tools.setActive('fill');
      invalidateSat();
      const expected = (window as any).__refFill(mapData, getSatelliteAnchor, 225, 225, 'Forest_1');
      await Tools.fill(225, 225);
      out.push({ seed: 'uniform', same: expected.every((v: string, i: number) => v === mapData[i]), changed: mapData.filter(x => x === 'Forest_1').length });
    } finally { entry.occupiedOffsets = saved; if (saved === undefined) delete entry.occupiedOffsets; }
    return out;
    function invalidateSat() { (window as any).invalidateSatelliteMap?.(); try { invalidateSatelliteMap(); } catch {} }
  });
  for (const r of res) expect(r.same, JSON.stringify(r)).toBe(true);
  expect(res.filter(r => r.seed !== 'uniform' && r.changed > 1000).length).toBeGreaterThan(0);   // exercised real regions
  expect(res[res.length - 1].changed).toBeGreaterThan(200000);
});
declare const Generator: any, Satellite: any;
declare function autoPlaceSettlements(): void;
declare function invalidateSatelliteMap(): void;
declare function getSatelliteAnchor(c: number, r: number): any;

test('a long fill keeps the main thread responsive', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    IO.newMap(true); mapData.fill('Plain_1');
    UI.selectTerrain('Forest_1'); Tools.setActive('fill');
    let ticks = 0, maxGap = 0, last = performance.now();
    const iv = setInterval(() => { const n = performance.now(); ticks++; maxGap = Math.max(maxGap, n - last); last = n; }, 0);
    const t0 = performance.now();
    const p = Tools.fill(225, 225);
    const busy = Tools.isFillBusy();
    await p;
    const ticksDuring = ticks, gapDuring = maxGap;   // captured before any extra wait: only what happened DURING the fill
    const ms = performance.now() - t0;
    clearInterval(iv);
    return { ticksDuring, gapDuring, ms, busy, forest: mapData.filter(x => x === 'Forest_1').length, busyAfter: Tools.isFillBusy() };
  });
  console.log('fill 450x450 uniform: total ' + r.ms.toFixed(0) + ' ms, ' + r.ticksDuring + ' ticks, max main-thread gap ' + r.gapDuring.toFixed(1) + ' ms');
  expect(r.busy).toBe(true);
  expect(r.busyAfter).toBe(false);
  expect(r.forest).toBe(202500);
  expect(r.ticksDuring).toBeGreaterThanOrEqual(3);
  expect(r.gapDuring).toBeLessThan(60);
});

test('fill with the same id is a no-op and leaves the tools unlocked', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    IO.newMap(true); UI.selectTerrain('Plain_1');
    const p = Tools.fill(5, 5);
    const busy = Tools.isFillBusy();
    await p;
    return { busy, after: Tools.isFillBusy(), all: mapData.every(x => x === 'Plain_1') };
  });
  expect(r).toEqual({ busy: false, after: false, all: true });
});

test('input and undo are ignored while a fill runs; the fill is one undo step', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    IO.newMap(true); mapData.fill('Plain_1');
    UI.selectTerrain('Forest_1'); Tools.setActive('fill');
    const before = History.undoSize();
    History.push();
    const p = Tools.fill(225, 225);
    // second fill while busy: ignored
    UI.selectTerrain('Hills_1');
    const second = Tools.fill(10, 10);
    const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    Canvas.setZoom(100); Canvas.centerOnCity();
    const pos = Canvas.hexScreenPos(225, 225), rc = canvas.getBoundingClientRect();
    const ev = (t: string) => new MouseEvent(t, { clientX: rc.left + pos.x, clientY: rc.top + pos.y, button: 0, bubbles: true });
    canvas.dispatchEvent(ev('mousedown')); canvas.dispatchEvent(ev('mouseup'));
    const sizeBusy = History.undoSize();
    History.undo();                          // ignored while busy
    const sizeAfterUndoBusy = History.undoSize();
    await Promise.all([p, second]);
    const forest = mapData.filter(x => x === 'Forest_1').length, hills = mapData.filter(x => x === 'Hills_1').length;
    const sizeDone = History.undoSize();
    History.undo();
    return { before, sizeBusy, sizeAfterUndoBusy, sizeDone, forest, hills, restored: mapData.every(x => x === 'Plain_1'), busyAfter: Tools.isFillBusy() };
  });
  expect(r.sizeBusy).toBe(r.before + 1);           // the busy click did not push a snapshot
  expect(r.sizeAfterUndoBusy).toBe(r.before + 1);  // busy undo ignored
  expect(r.sizeDone).toBe(r.before + 1);
  expect(r.forest).toBe(202500);
  expect(r.hills).toBe(0);
  expect(r.restored).toBe(true);                   // one undo reverts the whole fill
  expect(r.busyAfter).toBe(false);
});

test('a fill aborts without writing when the map is replaced mid-fill', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    IO.newMap(true); mapData.fill('Plain_1');
    UI.selectTerrain('Forest_1'); Tools.setActive('fill');
    History.push();
    const p = Tools.fill(225, 225);
    const oldMap = mapData;
    IO.newMap(true);                         // replaces mapData, clears history, bumps the generation
    const fresh = mapData;
    await p;
    const filled = oldMap.filter(x => x === 'Forest_1').length;
    return { freshAllPlain: fresh.every(x => x === 'Plain_1'), sameFresh: fresh === mapData, filled, busy: Tools.isFillBusy(), undo: History.undoSize() };
  });
  expect(r.freshAllPlain).toBe(true);
  expect(r.sameFresh).toBe(true);
  expect(r.filled).toBeLessThan(202500);   // stopped after the first slice, did not complete
  expect(r.busy).toBe(false);
  expect(r.undo).toBe(1);                  // only newMap's own snapshot
  // a new fill works afterwards
  const again = await page.evaluate(async () => { UI.selectTerrain('Forest_1'); History.push(); await Tools.fill(5, 5); return mapData.filter(x => x === 'Forest_1').length; });
  expect(again).toBe(202500);
});

const readAutosave = (page: any) => page.evaluate(() => new Promise<string | null>(res => {
  const o = indexedDB.open('MapEditorPro', 1);
  o.onsuccess = () => {
    const g = o.result.transaction('kv').objectStore('kv').get('map_autosave');
    g.onsuccess = () => res(g.result ?? null);
  };
}));
const countForest = (json: string | null) => json ? JSON.parse(json).data.flat().filter((x: any) => x === 'Forest_1').length : -1;

test('autosave / flush triggers never persist a half-filled map; Save waits for the fill', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    IO.newMap(true); mapData.fill('Plain_1');
    IO.loadFromJSON(JSON.parse(IO.getMapJson()));   // marks it a user map (autosave is off for the startup placeholder)
    await IO.autoSave();
  });
  expect(await page.evaluate(() => IO.hasUserMap())).toBe(true);
  const before = await readAutosave(page);
  expect(before).not.toBeNull();
  expect(countForest(before)).toBe(0);
  const mid = await page.evaluate(async () => {
    UI.selectTerrain('Forest_1');
    const p = Tools.fill(225, 225);
    const busy = Tools.isFillBusy();
    const direct = await IO.autoSave();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    delete (document as any).hidden;
    // Save (Ctrl+S) mid-fill must wait for the finished map
    const saved: string[] = [];
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (b: any) => { saved.push('blob'); (window as any).__blob = b; return 'blob:x'; };
    HTMLAnchorElement.prototype.click = function () {};
    IO.saveMap();
    const savedMid = saved.length;
    await p;
    await new Promise(res => setTimeout(res, 50));
    URL.createObjectURL = origCreate;
    const text = await (window as any).__blob.text();
    return { busy, direct, savedMid, savedAfter: saved.length, blobForest: JSON.parse(text).data.flat().filter((x: any) => x === 'Forest_1').length };
  });
  expect(mid.busy).toBe(true);
  expect(mid.direct).toBe(false);
  expect(mid.savedMid).toBe(0);
  expect(mid.savedAfter).toBe(1);
  expect(mid.blobForest).toBe(202500);
  await page.waitForTimeout(300);   // let any in-flight flush from the hidden-tab events settle
  // nothing written mid-fill: the stored record is still the pre-fill one, or (after the fill) the finished map
  const after = await readAutosave(page);
  expect([0, 202500]).toContain(countForest(after));
  await page.evaluate(() => IO.autoSave());
  expect(countForest(await readAutosave(page))).toBe(202500);
});

test('in-place bulk writers are refused while a fill runs', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    IO.newMap(true); mapData.fill('Plain_1');
    UI.selectTerrain('Forest_1');
    const toasts: string[] = [];
    const origToast = UI.toast; UI.toast = (m: string) => { toasts.push(String(m)); };
    const undoBefore = History.undoSize();
    const p = Tools.fill(225, 225);
    Generator.apply();
    Satellite.apply();
    autoPlaceSettlements();
    const undoDuring = History.undoSize();
    await p;
    UI.toast = origToast;
    return { toasts, undoBefore, undoDuring, forest: mapData.filter(x => x === 'Forest_1').length };
  });
  expect(r.toasts.filter(m => m.startsWith('A fill is still running')).length).toBe(3);
  expect(r.undoDuring).toBe(r.undoBefore);
  expect(r.forest).toBe(202500);
});

test('a failing fill unlocks the tools, closes the progress bar and reports', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    IO.newMap(true); mapData.fill('Plain_1');
    UI.selectTerrain('Forest_1'); Tools.setActive('fill');
    const toasts: string[] = [];
    const origToast = UI.toast; UI.toast = (m: string) => { toasts.push(String(m)); };
    const origRender = Canvas.render; let thrown = false;
    Canvas.render = () => { if (!thrown) { thrown = true; throw new Error('boom'); } return origRender.call(Canvas); };
    const origErr = console.error; console.error = () => {};
    Canvas.setZoom(100); Canvas.centerOnCity();
    const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    const pos = Canvas.hexScreenPos(225, 225), rc = canvas.getBoundingClientRect();
    const ev = (t: string) => new MouseEvent(t, { clientX: rc.left + pos.x, clientY: rc.top + pos.y, button: 0, bubbles: true });
    thrown = false;   // the setZoom/centerOnCity renders above were already done
    canvas.dispatchEvent(ev('mousedown')); canvas.dispatchEvent(ev('mouseup'));
    await Tools.whenIdle().catch(() => {});
    await new Promise(res => setTimeout(res, 20));
    Canvas.render = origRender; console.error = origErr; UI.toast = origToast;
    return { toasts, thrown, busy: Tools.isFillBusy(), progressActive: document.getElementById('progress-wrap')!.classList.contains('active') };
  });
  expect(r.thrown).toBe(true);
  expect(r.toasts.some(m => m.startsWith('Fill failed'))).toBe(true);
  expect(r.busy).toBe(false);
  await page.waitForTimeout(800);   // progressDone hides the bar after 600 ms
  expect(await page.evaluate(() => document.getElementById('progress-wrap')!.classList.contains('active'))).toBe(false);
});
