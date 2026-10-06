import { test, expect, Page } from '@playwright/test';
import { freshEditor, clickCell, dragCells, cellPoint } from './editor-helpers';

// T2.14: Place Building (B) and Erase Building, lazy undo, satellites. Satellite positions are checked against an
// independent PIXEL geometry reference (Canvas.hexScreenPos distances), never against HexUtils/_satelliteTilesInRadius.

const hidePicker = (page: Page) => page.evaluate(() => { document.getElementById('obj-building-picker')!.style.display = 'none'; });
const useTool = async (page: Page, tool: string, bld?: string) => {
  await page.evaluate(([t, b]) => { Tools.setActive(t as string); if (b) Tools.selectBuilding(b as string); }, [tool, bld || '']);
  await hidePicker(page);
};
const spyToasts = (page: Page) => page.evaluate(() => { (window as any).__toasts = []; const t = UI.toast; UI.toast = (m: string) => { (window as any).__toasts.push(m); return t.call(UI, m); }; });
const toasts = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__toasts);
const undoSize = (page: Page) => page.evaluate(() => History.undoSize());
const objs = (page: Page): Promise<Record<string, string>> => page.evaluate(() => Object.assign({}, objectsData));

/** Cells of the pixel ring: every cell whose centre is within R * (nearest-neighbour distance) * 1.01 of (col,row). */
const pixelDisc = (page: Page, col: number, row: number, R: number): Promise<string[]> => page.evaluate(([c0, r0, rad]) => {
  const p0 = Canvas.hexScreenPos(c0, r0), cand: { k: string; d: number }[] = [];
  for (let dc = -5; dc <= 5; dc++) for (let dr = -6; dr <= 6; dr++) {
    if (!dc && !dr) continue;
    const c = c0 + dc, r = r0 + dr;
    if (c < 0 || r < 0 || c >= MAP_WIDTH || r >= MAP_HEIGHT) continue;
    const p = Canvas.hexScreenPos(c, r);
    cand.push({ k: c + ',' + r, d: Math.hypot(p.x - p0.x, p.y - p0.y) });
  }
  const dmin = Math.min(...cand.map(x => x.d));
  return cand.filter(x => x.d <= dmin * rad * 1.01).map(x => x.k).sort();
}, [col, row, R]);

const ev = (page: Page, type: string, col: number, row: number, init: any = {}) => page.evaluate(([t, c, r, i]) => {
  const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), p = Canvas.hexScreenPos(c as number, r as number);
  cv.dispatchEvent(new MouseEvent(t as string, Object.assign({ clientX: rc.left + p.x, clientY: rc.top + p.y, button: 0, bubbles: true }, i)));
}, [type, col, row, init]);

test.describe('building tools (T2.14)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('B places a building, one undo removes it, redo restores it; erase-object removes it and undo restores it', async ({ page }) => {
    await page.keyboard.press('b');
    expect(await page.evaluate(() => Tools.getActive())).toBe('object');
    await page.evaluate(() => Tools.selectBuilding('Artefact_Test_1'));
    await hidePicker(page);
    const s0 = await undoSize(page);
    await clickCell(page, 227, 224);
    expect(await page.evaluate(() => objectsData['227,224'])).toBe('Artefact_Test_1');
    expect(await undoSize(page)).toBe(s0 + 1);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => '227,224' in objectsData)).toBe(false);
    await page.evaluate(() => History.redo());
    expect(await page.evaluate(() => objectsData['227,224'])).toBe('Artefact_Test_1');
    await page.evaluate(() => History.undo());

    await page.evaluate(() => { objectsData['227,224'] = 'Artefact_Test_1'; Tools.setActive('erase-object'); });
    const s1 = await undoSize(page);
    await clickCell(page, 227, 224);
    expect(await page.evaluate(() => '227,224' in objectsData)).toBe(false);
    expect(await undoSize(page)).toBe(s1 + 1);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => objectsData['227,224'])).toBe('Artefact_Test_1');
  });

  test('the two tool buttons live in the left palette (not the top toolbar) and the canvas keeps its 1491 px width at 1400x900', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const r = await page.evaluate(() => {
      const q = (t: string) => document.querySelector('.tool-btn[data-tool="' + t + '"]') as HTMLElement | null;
      const o = q('object'), e = q('erase-object');
      const vis = (b: HTMLElement | null) => !!b && b.getBoundingClientRect().width > 0;
      return { inPalette: !!o && !!e && !!o.closest('#palette-panel') && !!e.closest('#palette-panel'), vis: vis(o) && vis(e),
               titles: [o && o.title, e && e.title], cw: (document.getElementById('map-canvas') as HTMLCanvasElement).width };
    });
    expect(r.inPalette).toBe(true);
    expect(r.vis).toBe(true);
    expect(r.titles[0]).toContain('Place Building (B)');
    expect(r.titles[1]).toContain('Erase Building');
    expect(r.cw).toBe(1491);
  });

  test('the buttons activate their tools; the picker follows the tool; picking a card selects the building', async ({ page }) => {
    await page.click('.tool-btn[data-tool="object"]');
    expect(await page.evaluate(() => ({ a: Tools.getActive(), shown: getComputedStyle(document.getElementById('obj-building-picker')!).display }))).toEqual({ a: 'object', shown: 'block' });
    await page.click('#obj-building-picker-grid .bld-card[data-bld-id="Artefact_Test_1"]');
    expect(await page.evaluate(() => Tools.getSelectedBuildingId())).toBe('Artefact_Test_1');
    expect(await page.evaluate(() => document.getElementById('obj-building-label')!.textContent)).toBe('Artefact_Test_1');
    // the picker must not cover the map canvas centre (the user clicks there next)
    const box = await page.evaluate(() => { const p = document.getElementById('obj-building-picker')!.getBoundingClientRect(), c = document.getElementById('map-canvas')!.getBoundingClientRect(); return { pr: p.right, cl: c.left, cx: c.left + c.width / 2 }; });
    expect(box.pr).toBeLessThan(box.cx);
    await page.click('.tool-btn[data-tool="erase-object"]');
    expect(await page.evaluate(() => ({ a: Tools.getActive(), shown: getComputedStyle(document.getElementById('obj-building-picker')!).display }))).toEqual({ a: 'erase-object', shown: 'none' });
  });

  test('B is a physical-key shortcut: not in text fields, not with Shift/Alt/Ctrl; erase-object has no hotkey; other tool keys unchanged', async ({ page }) => {
    await page.keyboard.press('KeyB');
    expect(await page.evaluate(() => Tools.getActive())).toBe('object');
    for (const mod of ['Shift', 'Alt', 'Control']) {
      await page.evaluate(() => Tools.setActive('paint'));
      await page.keyboard.down(mod); await page.keyboard.press('KeyB'); await page.keyboard.up(mod);
      expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    }
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-text'; i.type = 'text'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press('KeyB');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await page.evaluate(() => document.getElementById('tmp-text')!.remove());
    // a key event whose TARGET is a text field (focus already gone) is typing too
    await page.evaluate(() => { const i = document.createElement('input'); i.type = 'text'; document.body.appendChild(i); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', bubbles: true })); i.remove(); });
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    // a modal open: no switch
    await page.evaluate(() => { const m = document.createElement('div'); m.id = 'tmp-modal'; document.body.appendChild(m); });
    await page.keyboard.press('KeyB');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await page.evaluate(() => document.getElementById('tmp-modal')!.remove());
    // no letter reaches erase-object, and the old keys still map where they did
    const seen: string[] = [];
    for (const k of 'abcdefghijklmnopqrstuvwxyz') {
      await page.evaluate(() => Tools.setActive('paint'));
      await page.keyboard.press('Key' + k.toUpperCase());
      seen.push(await page.evaluate(() => Tools.getActive()));
    }
    expect(seen.filter(t => t === 'erase-object')).toEqual([]);
    const map: Record<string, string> = {}; 'abcdefghijklmnopqrstuvwxyz'.split('').forEach((k, i) => { map[k] = seen[i]; });
    expect(map).toMatchObject({ b: 'object', p: 'paint', f: 'fill', r: 'rect', e: 'eye', s: 'select', t: 'settlement', d: 'erase', z: 'zone', l: 'line', o: 'circle', g: 'polygon', x: 'eraser', a: 'scatter', m: 'marquee', h: 'replace' });
  });

  test('clicks that change nothing create no undo step (erase on empty, same building again)', async ({ page }) => {
    await useTool(page, 'erase-object');
    const before = await undoSize(page);
    await clickCell(page, 228, 224);
    expect(await undoSize(page)).toBe(before);
    await useTool(page, 'object', 'Artefact_Test_1');
    await clickCell(page, 228, 224);
    expect(await undoSize(page)).toBe(before + 1);
    await clickCell(page, 228, 224);                      // same id on the same cell: nothing to change
    expect(await undoSize(page)).toBe(before + 1);
  });

  test('a building with satellites (Farm_Test_1 -> Grain_1, radius 1) places without a page error and fills exactly the 6 pixel-geometry neighbours, in ONE undo step', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await useTool(page, 'object', 'Farm_Test_1');
    const s0 = await undoSize(page);
    await clickCell(page, 227, 224);
    expect(errors).toEqual([]);
    const ring = await pixelDisc(page, 227, 224, 1);
    expect(ring.length).toBe(6);
    const o = await objs(page);
    expect(Object.keys(o).filter(k => o[k] === 'Grain_1').sort()).toEqual(ring);
    expect(o['227,224']).toBe('Farm_Test_1');
    expect(Object.keys(o).length).toBe(7);
    expect(await undoSize(page)).toBe(s0 + 1);
    await page.evaluate(() => History.undo());
    expect(await objs(page)).toEqual({});
    await page.evaluate(() => History.redo());
    expect(Object.keys(await objs(page)).length).toBe(7);
  });

  for (const [col, row] of [[227, 224], [228, 224], [227, 225], [228, 225], [226, 223]]) {
    test(`radius-1 satellites are the true 6 neighbours at (${col},${row}) (both column and row parities)`, async ({ page }) => {
      await useTool(page, 'object', 'Farm_Test_1');
      await clickCell(page, col, row);
      const ring = await pixelDisc(page, col, row, 1);
      const o = await objs(page);
      expect(ring.length).toBe(6);
      expect(Object.keys(o).filter(k => o[k] === 'Grain_1').sort()).toEqual(ring);
    });
  }

  test('erase-object on the anchor removes its satellites in ONE step; undo restores all; erasing only a satellite removes only it', async ({ page }) => {
    await useTool(page, 'object', 'Farm_Test_1');
    await clickCell(page, 227, 224);
    const full = await objs(page);
    expect(Object.keys(full).length).toBe(7);
    await useTool(page, 'erase-object');
    const s0 = await undoSize(page);
    const ring = await pixelDisc(page, 227, 224, 1);
    const [c, r] = ring[0].split(',').map(Number);
    await clickCell(page, c, r);                                  // just one satellite
    expect(Object.keys(await objs(page)).length).toBe(6);
    expect((await objs(page))['227,224']).toBe('Farm_Test_1');
    expect(await undoSize(page)).toBe(s0 + 1);
    await clickCell(page, 227, 224);                              // the anchor takes the rest of its ring
    expect(await objs(page)).toEqual({});
    expect(await undoSize(page)).toBe(s0 + 2);
    await page.evaluate(() => History.undo());
    expect(Object.keys(await objs(page)).length).toBe(6);
    await page.evaluate(() => History.undo());
    expect(await objs(page)).toEqual(full);
  });

  test('placing over an existing building replaces it: the old building\'s satellites go first, the new one spawns its own, one step', async ({ page }) => {
    await useTool(page, 'object', 'Farm_Test_1');
    await clickCell(page, 227, 224);
    const s0 = await undoSize(page);
    await page.evaluate(() => Tools.selectBuilding('Artefact_Test_1'));
    await clickCell(page, 227, 224);
    expect(await objs(page)).toEqual({ '227,224': 'Artefact_Test_1' });
    expect(await undoSize(page)).toBe(s0 + 1);
    await page.evaluate(() => History.undo());
    expect(Object.keys(await objs(page)).length).toBe(7);
    // farm over farm on the same cell is a no-op (same id): no step
    await page.evaluate(() => Tools.selectBuilding('Farm_Test_1'));
    const s1 = await undoSize(page);
    await clickCell(page, 227, 224);
    expect(await undoSize(page)).toBe(s1);
  });

  test('spawning never overwrites an existing building and never writes outside the map', async ({ page }) => {
    await page.evaluate(() => { objectsData['228,224'] = 'Artefact_Test_1'; });
    await useTool(page, 'object', 'Farm_Test_1');
    await clickCell(page, 227, 224);
    const ring = await pixelDisc(page, 227, 224, 1);
    expect(ring).toContain('228,224');
    const o = await objs(page);
    expect(o['228,224']).toBe('Artefact_Test_1');
    expect(Object.keys(o).filter(k => o[k] === 'Grain_1').sort()).toEqual(ring.filter(k => k !== '228,224'));
    // at the map corner the ring is clipped to the map
    await page.evaluate(() => { objectsData = {}; });
    await ev(page, 'mousedown', 0, 0); await ev(page, 'mouseup', 0, 0);
    const o2 = await objs(page);
    expect(o2['0,0']).toBe('Farm_Test_1');
    const inMap = (k: string) => { const [c, r] = k.split(',').map(Number); return c >= 0 && r >= 0 && c < 450 && r < 450; };
    expect(Object.keys(o2).every(inMap)).toBe(true);
    expect(Object.keys(o2).length).toBeGreaterThan(1);
    expect(Object.keys(o2).length).toBeLessThan(7);
  });

  test('a spawned satellite skips cells under another multi-tile terrain footprint; placing ON a footprint cell is refused with a toast and no step', async ({ page }) => {
    await spyToasts(page);
    const geo = await page.evaluate(() => {
      mapData[224 * MAP_WIDTH + 228] = 'Rabbit_Flat_1'; invalidateSatelliteMap();
      const fp: string[] = [];
      for (let c = 225; c <= 231; c++) for (let r = 221; r <= 227; r++) if (getSatelliteAnchor(c, r)) fp.push(c + ',' + r);
      return fp;
    });
    expect(geo.length).toBeGreaterThan(0);
    // refused: footprint cell
    await useTool(page, 'object', 'Artefact_Test_1');
    const s0 = await undoSize(page);
    const [fc, fr] = geo[0].split(',').map(Number);
    await clickCell(page, fc, fr);
    expect(await objs(page)).toEqual({});
    expect(await undoSize(page)).toBe(s0);
    expect((await toasts(page)).some(t => /multi-tile|footprint/i.test(t))).toBe(true);
    // a farm next to the footprint: no Grain_1 on footprint cells; the rest of the ring is filled
    await page.evaluate(() => { Tools.selectBuilding('Farm_Test_1'); });
    let farm = '';
    for (let c = 225; c <= 231 && !farm; c++) for (let r = 221; r <= 227 && !farm; r++) {
      if (geo.includes(c + ',' + r) || (c === 228 && r === 224)) continue;
      const ring = await pixelDisc(page, c, r, 1);
      if (ring.some(k => geo.includes(k))) farm = c + ',' + r;
    }
    expect(farm).not.toBe('');
    const [c, r] = farm.split(',').map(Number);
    const ring = await pixelDisc(page, c, r, 1);
    await clickCell(page, c, r);
    const o = await objs(page);
    expect(Object.keys(o).filter(k => o[k] === 'Grain_1').sort()).toEqual(ring.filter(k => !geo.includes(k)));
    expect(ring.filter(k => geo.includes(k)).length).toBeGreaterThan(0);
  });

  test('radius 2 and maxCount follow the rule (fabricated building entries): 18 cells at radius 2; maxCount 7 = the 6 nearest plus one at distance 2', async ({ page }) => {
    await page.evaluate(() => {
      const o = BldDB.getAll;
      BldDB.getAll = () => o.call(BldDB).concat([
        { id: 'T_R2', spawnsSatellites: [{ buildingId: 'T_S', radius: 2, maxCount: 0 }] },
        { id: 'T_M7', spawnsSatellites: [{ buildingId: 'T_S', radius: 2, maxCount: 7 }] },
        { id: 'T_S', canBuild: false }] as any);
    });
    await useTool(page, 'object', 'T_R2');
    await clickCell(page, 227, 224);
    const r2 = await pixelDisc(page, 227, 224, 2);
    expect(r2.length).toBe(18);
    let o = await objs(page);
    expect(Object.keys(o).filter(k => o[k] === 'T_S').sort()).toEqual(r2);
    await page.evaluate(() => { objectsData = {}; });
    await page.evaluate(() => Tools.selectBuilding('T_M7'));
    await clickCell(page, 227, 224);
    const r1 = await pixelDisc(page, 227, 224, 1);
    o = await objs(page);
    const got = Object.keys(o).filter(k => o[k] === 'T_S').sort();
    expect(got.length).toBe(7);
    expect(r1.every(k => got.includes(k))).toBe(true);
    expect(got.every(k => r2.includes(k))).toBe(true);
    // erase of the radius-2 spawner removes ring 2 too
    await page.evaluate(() => { objectsData = {}; Tools.selectBuilding('T_R2'); });
    await clickCell(page, 227, 224);
    await page.evaluate(() => Tools.setActive('erase-object'));
    await hidePicker(page);
    await clickCell(page, 227, 224);
    expect(await objs(page)).toEqual({});
  });

  test('dragging places many buildings in ONE undo step; dragging the eraser over them is one step; a drag that erases nothing leaves no step', async ({ page }) => {
    await useTool(page, 'object', 'Artefact_Test_1');
    const s0 = await undoSize(page);
    await dragCells(page, { col: 226, row: 224 }, { col: 230, row: 224 });
    const n = Object.keys(await objs(page)).length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(await undoSize(page)).toBe(s0 + 1);
    await useTool(page, 'erase-object');
    await dragCells(page, { col: 226, row: 224 }, { col: 230, row: 224 });
    expect(await objs(page)).toEqual({});
    expect(await undoSize(page)).toBe(s0 + 2);
    await dragCells(page, { col: 226, row: 224 }, { col: 230, row: 224 });          // nothing left
    expect(await undoSize(page)).toBe(s0 + 2);
    await page.evaluate(() => History.undo());
    expect(Object.keys(await objs(page)).length).toBe(n);
    await page.evaluate(() => History.undo());
    expect(await objs(page)).toEqual({});
  });

  test('no building selected: a click toasts "Pick a building first" and changes nothing', async ({ page }) => {
    await spyToasts(page);
    // nothing placeable in the database -> nothing is auto-selected (selectBuilding now refuses unknown ids, so this is the way in)
    await page.evaluate(() => { const o = BldDB.getAll; BldDB.getAll = () => []; try { Tools.setActive('object'); } finally { BldDB.getAll = o; } });
    expect(await page.evaluate(() => Tools.getSelectedBuildingId())).toBe(null);
    await hidePicker(page);
    const s0 = await undoSize(page);
    await clickCell(page, 227, 224);
    expect(await objs(page)).toEqual({});
    expect(await undoSize(page)).toBe(s0);
    expect(await toasts(page)).toContain('Pick a building first');
  });

  test('only the left button acts: right, middle and side buttons place nothing', async ({ page }) => {
    await useTool(page, 'object', 'Artefact_Test_1');
    const s0 = await undoSize(page);
    const p = await cellPoint(page, 227, 224);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await page.mouse.down({ button: 'middle' }); await page.mouse.up({ button: 'middle' });
    await ev(page, 'mousedown', 227, 224, { button: 3 }); await ev(page, 'mouseup', 227, 224, { button: 3 });
    await ev(page, 'mousedown', 227, 224, { button: 4 }); await ev(page, 'mouseup', 227, 224, { button: 4 });
    expect(await objs(page)).toEqual({});
    await useTool(page, 'erase-object');
    await page.evaluate(() => { objectsData['227,224'] = 'Artefact_Test_1'; });
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await ev(page, 'mousedown', 227, 224, { button: 3 }); await ev(page, 'mouseup', 227, 224, { button: 3 });
    expect(await objs(page)).toEqual({ '227,224': 'Artefact_Test_1' });
    expect(await undoSize(page)).toBe(s0);
  });

  test('a right/middle release during a left drag does not end it', async ({ page }) => {
    await useTool(page, 'object', 'Artefact_Test_1');
    const a = await cellPoint(page, 226, 224), b = await cellPoint(page, 229, 224);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await ev(page, 'mouseup', 226, 224, { button: 2 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    expect(Object.keys(await objs(page)).includes('229,224')).toBe(true);
  });

  test('switching tool mid-stroke stops the stroke (no more writes, the step stays)', async ({ page }) => {
    await useTool(page, 'object', 'Artefact_Test_1');
    const s0 = await undoSize(page);
    const a = await cellPoint(page, 226, 224), b = await cellPoint(page, 229, 224);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.evaluate(() => Tools.setActive('paint'));
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    expect(await objs(page)).toEqual({ '226,224': 'Artefact_Test_1' });
    expect(await page.evaluate(() => Array.from(new Set(mapData)).length)).toBe(1);   // paint did not write either (no mouse down for it)
    expect(await undoSize(page)).toBe(s0 + 1);
  });

  test('a lost mouse-up (move with no button held) ends the stroke', async ({ page }) => {
    await useTool(page, 'object', 'Artefact_Test_1');
    const s0 = await undoSize(page);
    const a = await cellPoint(page, 226, 224);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await ev(page, 'mousemove', 228, 224, { buttons: 0 });
    await ev(page, 'mousemove', 230, 224, { buttons: 1 });      // a stale "pressed" move afterwards must not write either
    await page.mouse.up();
    expect(Object.keys(await objs(page))).toEqual(['226,224']);
    expect(await undoSize(page)).toBe(s0 + 1);
  });

  test('leaving the canvas ends the stroke; re-entering with the button still down places nothing', async ({ page }) => {
    await useTool(page, 'object', 'Artefact_Test_1');
    const a = await cellPoint(page, 226, 224), b = await cellPoint(page, 229, 224);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(2, 2);                                  // outside the canvas (over the palette/toolbar)
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
    expect(Object.keys(await objs(page))).toEqual(['226,224']);
  });

  test('window blur ends the stroke cleanly', async ({ page }) => {
    await useTool(page, 'object', 'Artefact_Test_1');
    const s0 = await undoSize(page);
    const a = await cellPoint(page, 226, 224), b = await cellPoint(page, 229, 224);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
    expect(Object.keys(await objs(page))).toEqual(['226,224']);
    expect(await undoSize(page)).toBe(s0 + 1);
  });

  test('Escape mid-stroke cancels it WITHOUT a History step (objects restored, redo stack kept)', async ({ page }) => {
    // an earlier undone action leaves a redo entry that a cancelled stroke must not destroy
    await page.evaluate(() => { History.push(); objectsData['300,300'] = 'Artefact_Test_1'; History.undo(); });
    const before = await page.evaluate(() => ({ u: History.undoSize(), r: History.redoSize() }));
    expect(before.r).toBe(1);
    await useTool(page, 'object', 'Farm_Test_1');
    const a = await cellPoint(page, 226, 224), b = await cellPoint(page, 230, 224);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    expect(Object.keys(await objs(page)).length).toBe(7);
    await page.keyboard.press('Escape');
    expect(await objs(page)).toEqual({});
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
    expect(await objs(page)).toEqual({});
    expect(await page.evaluate(() => ({ u: History.undoSize(), r: History.redoSize() }))).toEqual(before);
  });

  test('undo is ignored while a stroke is in progress', async ({ page }) => {
    await page.evaluate(() => { History.push(); objectsData['300,300'] = 'Artefact_Test_1'; });
    await useTool(page, 'object', 'Artefact_Test_1');
    const a = await cellPoint(page, 226, 224);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => objectsData['300,300'])).toBe('Artefact_Test_1');
    expect(await page.evaluate(() => objectsData['226,224'])).toBe('Artefact_Test_1');
    await page.mouse.up();
  });

  test('a map replaced mid-stroke stops the stroke with a toast; nothing is written to the new map', async ({ page }) => {
    await spyToasts(page);
    await useTool(page, 'object', 'Artefact_Test_1');
    const a = await cellPoint(page, 226, 224), b = await cellPoint(page, 229, 224);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.evaluate(() => { IO.newMap(true); Canvas.centerOnCity(); });
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
    expect(await objs(page)).toEqual({});
    expect((await toasts(page)).some(t => /map changed/i.test(t))).toBe(true);
  });

  test('both tools ignore input while a fill runs', async ({ page }) => {
    const r = await page.evaluate(async () => {
      UI.selectTerrain('Forest_1');
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect();
      const fire = (t: string, c: number, rw: number) => { const p = Canvas.hexScreenPos(c, rw); cv.dispatchEvent(new MouseEvent(t, { clientX: rc.left + p.x, clientY: rc.top + p.y, button: 0, bubbles: true })); };
      objectsData['227,225'] = 'Artefact_Test_1';
      const p = Tools.fill(225, 225);
      const busy = Tools.isFillBusy();
      const before = History.undoSize();
      Tools.setActive('object'); Tools.selectBuilding('Artefact_Test_1'); document.getElementById('obj-building-picker')!.style.display = 'none';
      fire('mousedown', 227, 224); fire('mouseup', 227, 224);
      Tools.setActive('erase-object');
      fire('mousedown', 227, 225); fire('mouseup', 227, 225);
      const out = { busy, placed: '227,224' in objectsData, erasedKept: objectsData['227,225'], steps: History.undoSize() - before };
      await p;
      return out;
    });
    expect(r).toEqual({ busy: true, placed: false, erasedKept: 'Artefact_Test_1', steps: 0 });
  });

  test('clicks outside the map (above the first row) do nothing', async ({ page }) => {
    await useTool(page, 'object', 'Artefact_Test_1');
    const s0 = await undoSize(page);
    await ev(page, 'mousedown', 225, -3); await ev(page, 'mouseup', 225, -3);
    await ev(page, 'mousedown', 225, 453); await ev(page, 'mouseup', 225, 453);
    expect(await objs(page)).toEqual({});
    expect(await undoSize(page)).toBe(s0);
  });

  test('autosave is scheduled after a change and the placed building is drawn (canvas differs from the empty map)', async ({ page }) => {
    const hash = () => page.evaluate(() => { const cv = document.getElementById('map-canvas') as HTMLCanvasElement; const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h; });
    await page.evaluate(() => { (window as any).__saves = 0; const o = IO.scheduleAutoSave; IO.scheduleAutoSave = () => { (window as any).__saves++; return o.call(IO); }; });
    const h0 = await hash();
    await useTool(page, 'object', 'Artefact_Test_1');
    await clickCell(page, 227, 224);
    expect(await page.evaluate(() => (window as any).__saves)).toBeGreaterThan(0);
    expect(await hash()).not.toBe(h0);
  });

  // ---------- fix round 1 ----------------------------------------------------------------------------------

  // A keyboard / menu action that would push its own History step mid-stroke must be refused: the stroke's step stays
  // on top, so Escape rolls the whole stroke back and exactly one step existed.
  const STROKE_OPS: Record<string, (page: Page) => Promise<void>> = {
    'Delete': async p => { await p.keyboard.press('Delete'); },
    'Ctrl+X': async p => { await p.keyboard.press('Control+x'); },
    'Ctrl+V': async p => { await p.keyboard.press('Control+v'); },
    'Clear Map': async p => { await p.evaluate(() => { IO.clearMap(); }); await p.evaluate(() => { const b = document.getElementById('confirm-ok') as HTMLElement; if (document.getElementById('confirm-modal')!.classList.contains('open')) b.click(); }); },
    'Fill Map': async p => { await p.evaluate(() => { UI.selectTerrain('Forest_1'); IO.fillMap(); }); await p.evaluate(() => { const b = document.getElementById('confirm-ok') as HTMLElement; if (document.getElementById('confirm-modal')!.classList.contains('open')) b.click(); }); },
    'Replace apply': async p => { await p.evaluate(() => { Tools.openReplace(); (document.getElementById('replace-from') as HTMLInputElement).value = 'Plain_1'; (document.getElementById('replace-to') as HTMLInputElement).value = 'Forest_1'; (document.getElementById('replace-sel-only') as HTMLInputElement).checked = false; Tools.applyReplace(); }); },
    'QA placer': async p => { await p.evaluate(() => { Dev.qaPlaceAllTiles(); }); },
    'Auto-place settlements': async p => { await p.evaluate(() => { if (!settlementSlots.length) settlementSlots.push({ minDist: 10, maxDist: 20, count: 1, type: 'settlement', tapMultiplier: 1, level: 1, minSpacing: 2, nearPct: 20, midPct: 30, farPct: 50 } as any); autoPlaceSettlements(); }); },
  };
  for (const [name, op] of Object.entries(STROKE_OPS)) {
    test(`${name} is refused mid-stroke; Escape then rolls the whole stroke back (exactly one step)`, async ({ page }) => {
      await page.evaluate(() => { objectsData['200,200'] = 'Grain_1'; Selection.setCells([{ col: 200, row: 200 }]); Tools.copySelection(); });
      await useTool(page, 'object', 'Artefact_Test_1');
      const mapSig = () => page.evaluate(() => { let h = 0; for (let i = 0; i < mapData.length; i += 211) h = (h * 31 + mapData[i].length + mapData[i].charCodeAt(0)) | 0; return h + ':' + settlements.length; });
      const sig0 = await mapSig(), s0 = await undoSize(page);
      const a = await cellPoint(page, 226, 224), b = await cellPoint(page, 228, 224), c = await cellPoint(page, 230, 224);
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 3 });
      await op(page);
      await page.mouse.move(c.x, c.y, { steps: 3 });
      expect(await undoSize(page)).toBe(s0 + 1);                       // only the stroke's own step
      expect(await mapSig()).toBe(sig0);
      expect(await page.evaluate(() => ({ a: Tools.getActive(), p: Tools.isPasting(), st: Tools.isStroking(), g: objectsData['200,200'] }))).toEqual({ a: 'object', p: false, st: true, g: 'Grain_1' });
      expect(Object.keys(await objs(page)).length).toBeGreaterThan(2);  // the stroke kept writing
      await page.keyboard.press('Escape');
      await page.mouse.up();
      expect(await objs(page)).toEqual({ '200,200': 'Grain_1' });
      expect(await undoSize(page)).toBe(s0);
      expect(await mapSig()).toBe(sig0);
    });
  }

  test('selectBuilding refuses an id unknown to BldDB with a toast and keeps the previous selection', async ({ page }) => {
    await spyToasts(page);
    await page.evaluate(() => Tools.selectBuilding('Artefact_Test_1'));
    await page.evaluate(() => Tools.selectBuilding('No_Such_Building'));
    expect(await page.evaluate(() => Tools.getSelectedBuildingId())).toBe('Artefact_Test_1');
    expect((await toasts(page)).some(t => /unknown building/i.test(t))).toBe(true);
    await page.evaluate(() => Tools.selectBuilding(''));
    expect(await page.evaluate(() => Tools.getSelectedBuildingId())).toBe('Artefact_Test_1');
  });

  test('the picker stays fully inside a 1100x700 viewport, follows a resize, closes on Escape and on an outside click (tool stays), cards are keyboard-operable', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.click('.tool-btn[data-tool="object"]');
    const inside = () => page.evaluate(() => { const r = document.getElementById('obj-building-picker')!.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; });
    let r = await inside();
    expect(r.l).toBeGreaterThanOrEqual(0); expect(r.t).toBeGreaterThanOrEqual(0); expect(r.r).toBeLessThanOrEqual(r.w); expect(r.b).toBeLessThanOrEqual(r.h);
    await page.setViewportSize({ width: 1100, height: 340 });          // the real resize event repositions and re-caps the picker
    await page.waitForFunction(() => document.getElementById('obj-building-picker')!.getBoundingClientRect().bottom <= innerHeight, null, { timeout: 3000 }).catch(() => {});
    r = await inside();
    expect(r.b).toBeLessThanOrEqual(r.h);
    expect(r.t).toBeGreaterThanOrEqual(0);
    // cards: focusable, Enter and Space select
    const cards = await page.evaluate(() => { const c = Array.from(document.querySelectorAll('#obj-building-picker-grid .bld-card')) as HTMLElement[]; return { n: c.length, tab: c.every(x => x.tabIndex === 0) }; });
    expect(cards.n).toBeGreaterThan(2);
    expect(cards.tab).toBe(true);
    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('#obj-building-picker-grid .bld-card')).slice(0, 2).map(c => (c as HTMLElement).dataset.bldId));
    await page.focus(`#obj-building-picker-grid .bld-card[data-bld-id="${ids[1]}"]`);
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => Tools.getSelectedBuildingId())).toBe(ids[1]);
    await page.focus(`#obj-building-picker-grid .bld-card[data-bld-id="${ids[0]}"]`);
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => Tools.getSelectedBuildingId())).toBe(ids[0]);
    // Escape closes the picker only: the tool and the selection stay
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => ({ d: getComputedStyle(document.getElementById('obj-building-picker')!).display, a: Tools.getActive() }))).toEqual({ d: 'none', a: 'object' });
    // reopen by the tool button, then an outside click closes it again
    await page.click('.tool-btn[data-tool="object"]');
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('obj-building-picker')!).display)).toBe('block');
    await page.mouse.click(5, 5);
    expect(await page.evaluate(() => ({ d: getComputedStyle(document.getElementById('obj-building-picker')!).display, a: Tools.getActive() }))).toEqual({ d: 'none', a: 'object' });
  });

  test('registering a tool in the lazy-stroke set gives it the stale-map check and the blur handler; a stroke cannot start without _beginLazyStroke (pushOnce is a no-op outside a stroke)', async ({ page }) => {
    await spyToasts(page);
    const r = await page.evaluate(() => {
      const out: any = {};
      const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
      const s0 = History.undoSize();
      Tools._pushOnce();                                    // outside a stroke: refused, nothing pushed
      out.noStroke = { u: History.undoSize() - s0, warned };
      console.warn = warn;
      Tools._lazyStrokeTools.add('fake-lazy');
      Tools.setActive('fake-lazy');
      Tools._beginLazyStroke();
      Tools._pushOnce(); Tools._pushOnce();                 // once per stroke
      out.pushed = History.undoSize() - s0;
      out.stroking = Tools.isStroking();
      window.dispatchEvent(new Event('blur'));
      out.afterBlur = Tools.isStroking();
      Tools._beginLazyStroke();
      IO.newMap(true); Canvas.centerOnCity();
      document.getElementById('map-canvas')!.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 300, bubbles: true }));
      out.afterStale = Tools.isStroking();
      Tools._lazyStrokeTools.delete('fake-lazy');
      return out;
    });
    expect(r.noStroke).toEqual({ u: 0, warned: 1 });
    expect(r.pushed).toBe(1);
    expect(r.stroking).toBe(true);
    expect(r.afterBlur).toBe(false);
    expect(r.afterStale).toBe(false);
    expect((await toasts(page)).some(t => /map changed/i.test(t))).toBe(true);
  });
});

// T2.14 re-review findings N1 / N3 (landed with T2.15 as its own first commit)
test.describe('building picker keyboard hygiene (N1, N3)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });
  const pickerDisplay = (page: Page) => page.evaluate(() => getComputedStyle(document.getElementById('obj-building-picker')!).display);

  test('N1: Enter on a focused building card selects the building and does NOT lift the active selection', async ({ page }) => {
    await page.evaluate(() => { Selection.setCells([{ col: 224, row: 224 }, { col: 225, row: 224 }, { col: 226, row: 224 }], 'replace'); Tools.setActive('object'); });
    const target = await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('#obj-building-picker-grid .bld-card')).map(c => (c as HTMLElement).dataset.bldId!);
      return ids.find(i => i !== Tools.getSelectedBuildingId())!;
    });
    await page.focus(`#obj-building-picker-grid .bld-card[data-bld-id="${target}"]`);
    await page.keyboard.press('Enter');
    const r = await page.evaluate(() => ({ sel: Tools.getSelectedBuildingId(), moving: Tools.isMoving(), pasting: Tools.isPasting(), n: Selection.size(), tool: Tools.getActive() }));
    expect(r).toEqual({ sel: target, moving: false, pasting: false, n: 3, tool: 'object' });
  });

  test('N1: Enter on the map (no focused control) still lifts the selection', async ({ page }) => {
    await page.evaluate(() => { Selection.setCells([{ col: 224, row: 224 }, { col: 225, row: 224 }], 'replace'); Tools.setActive('paint'); (document.activeElement as HTMLElement | null)?.blur(); });
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => Tools.isMoving())).toBe(true);
  });

  test('N1: a keydown the page already handled (defaultPrevented) or aimed at a role=button element does not lift', async ({ page }) => {
    await page.evaluate(() => { Selection.setCells([{ col: 224, row: 224 }, { col: 225, row: 224 }], 'replace'); Tools.setActive('paint'); (document.activeElement as HTMLElement | null)?.blur(); });
    await page.evaluate(() => {
      const d = document.createElement('div'); d.id = 'tmp-rb'; d.setAttribute('role', 'button'); d.tabIndex = 0; document.body.appendChild(d);
      d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      d.remove();
      const h = (e: KeyboardEvent) => { if (e.key === 'Enter') e.preventDefault(); };
      document.addEventListener('keydown', h, { once: true });
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(await page.evaluate(() => Tools.isMoving())).toBe(false);
  });

  test('N3: an Escape that closes an open menu, a modal or a text field does not also close the picker', async ({ page }) => {
    await page.click('.tool-btn[data-tool="object"]');
    expect(await pickerDisplay(page)).toBe('block');
    // an open menu: the menu handler closes it and marks the event handled
    await page.evaluate(() => { document.querySelector('.menu-item')!.classList.add('open'); });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.querySelectorAll('.menu-item.open').length)).toBe(0);
    expect(await pickerDisplay(page)).toBe('block');
    // a modal overlay on screen
    await page.evaluate(() => { const m = document.createElement('div'); m.id = 'tmp-modal'; document.body.appendChild(m); });
    await page.keyboard.press('Escape');
    expect(await pickerDisplay(page)).toBe('block');
    await page.evaluate(() => document.getElementById('tmp-modal')!.remove());
    // a focused text field
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-text'; i.type = 'text'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press('Escape');
    expect(await pickerDisplay(page)).toBe('block');
    await page.evaluate(() => document.getElementById('tmp-text')!.remove());
    // with nothing else open, Escape closes it
    await page.keyboard.press('Escape');
    expect(await pickerDisplay(page)).toBe('none');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════
// T2.15: Draw Road (W), Connect Road (C), Erase Road (Q). Adjacency references are PIXEL geometry (pixelDisc), not
// Roads.getNeighbors; the gate itself (which uses Roads.getNeighbors, K1) is exercised through a cell that both agree on.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test.describe('road tools (T2.15)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); await spyToasts(page); });
  const CITY = { col: 225, row: 224 };
  const roadKeys = (page: Page): Promise<string[]> => page.evaluate(() => Object.keys(roadsData).sort());
  const roadSnap = (page: Page) => page.evaluate(() => JSON.stringify(roadsData));
  const startOf = (page: Page) => page.evaluate(() => Tools.getRoadConnectStart());

  /** A cell that is (a) pixel-adjacent to the city (independent reference) and (b) accepted by the game gate both ways. */
  const goodNeighbour = async (page: Page): Promise<{ col: number; row: number }> => {
    const ring = await pixelDisc(page, CITY.col, CITY.row, 1);
    expect(ring.length).toBe(6);
    const nb = await page.evaluate(([ringKeys]) => {
      const sym = (c: number, r: number) => Roads.getNeighbors(c, r).some((m: any) => m.col === 225 && m.row === 224) && Roads.getNeighbors(225, 224).some((m: any) => m.col === c && m.row === r);
      const k = (ringKeys as string[]).find(x => { const [c, r] = x.split(',').map(Number); return sym(c, r); });
      return k ? { col: Number(k.split(',')[0]), row: Number(k.split(',')[1]) } : null;
    }, [ring]);
    expect(nb).not.toBeNull();
    return nb!;
  };
  const roadTool = (page: Page, t: string) => page.evaluate((tool) => { Tools.setActive(tool); }, t);

  test('the three buttons live in the left palette (not the top toolbar); the canvas keeps its 1491 px width at 1400x900', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const r = await page.evaluate(() => {
      const q = (t: string) => document.querySelector('.tool-btn[data-tool="' + t + '"]') as HTMLElement | null;
      const bs = ['road', 'road-connect', 'erase-road'].map(q);
      return { all: bs.every(b => !!b), inPalette: bs.every(b => !!b && !!b.closest('#palette-panel') && !b.closest('#toolbar') && b.getBoundingClientRect().width > 0),
               titles: bs.map(b => b && b.title), cw: (document.getElementById('map-canvas') as HTMLCanvasElement).width };
    });
    expect(r.all).toBe(true);
    expect(r.inPalette).toBe(true);
    expect(r.titles[0]).toContain('Draw Road (W)');
    expect(r.titles[1]).toContain('Connect Road');
    expect(r.titles[1]).toContain('(C)');
    expect(r.titles[2]).toContain('Erase Road (Q)');
    expect(r.cw).toBe(1491);
    for (const [t, name] of [['road', 'Draw Road'], ['road-connect', 'Connect Road'], ['erase-road', 'Erase Road']]) {
      await page.click(`.tool-btn[data-tool="${t}"]`);
      expect(await page.evaluate(() => Tools.getActive())).toBe(t);
      expect(await page.evaluate(() => document.getElementById('st-tool')!.textContent)).toContain(name);
    }
  });

  test('the three road tools are registered as lazy-stroke tools', async ({ page }) => {
    expect(await page.evaluate(() => ['road', 'road-connect', 'erase-road'].map(t => Tools._lazyStrokeTools.has(t)))).toEqual([true, true, true]);
  });

  test('W / C / Q are physical-key shortcuts: not with Shift/Alt/Ctrl/Meta (Cmd+C/W/Q), not while typing or in a modal, no other key changed', async ({ page }) => {
    for (const [code, tool] of [['KeyW', 'road'], ['KeyC', 'road-connect'], ['KeyQ', 'erase-road']]) {
      await page.evaluate(() => Tools.setActive('paint'));
      await page.keyboard.press(code);
      expect(await page.evaluate(() => Tools.getActive())).toBe(tool);
      for (const mod of ['Shift', 'Alt', 'Control', 'Meta']) {
        await page.evaluate(() => Tools.setActive('paint'));
        await page.keyboard.down(mod); await page.keyboard.press(code); await page.keyboard.up(mod);
        expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
      }
    }
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-text'; i.type = 'text'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press('KeyW');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await page.evaluate(() => document.getElementById('tmp-text')!.remove());
    await page.evaluate(() => { const m = document.createElement('div'); m.id = 'tmp-modal'; document.body.appendChild(m); });
    await page.keyboard.press('KeyQ');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await page.evaluate(() => document.getElementById('tmp-modal')!.remove());
    // a held key (auto-repeat) does not switch
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', repeat: true, bubbles: true })));
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    // every other letter still maps where it did
    const map: Record<string, string> = {};
    for (const k of 'abcdefghijklmnopqrstuvwxyz') { await page.evaluate(() => Tools.setActive('paint')); await page.keyboard.press('Key' + k.toUpperCase()); map[k] = await page.evaluate(() => Tools.getActive()); }
    expect(map).toMatchObject({ w: 'road', c: 'road-connect', q: 'erase-road', b: 'object', p: 'paint', f: 'fill', r: 'rect', e: 'eye', s: 'select', t: 'settlement', d: 'erase', z: 'zone', l: 'line', o: 'circle', g: 'polygon', x: 'eraser', a: 'scatter', m: 'marquee', h: 'replace' });
  });

  test('W draws a connected road tile in ONE undo step, redo restores it, and a floating tile is refused with a toast and no step', async ({ page }) => {
    const nb = await goodNeighbour(page);
    await page.keyboard.press('KeyW');
    const s0 = await undoSize(page);
    await clickCell(page, nb.col, nb.row);
    expect(await roadKeys(page)).toEqual([nb.col + ',' + nb.row]);
    expect(await page.evaluate(() => Object.values(roadsData)[0])).toEqual({ type: 'road_hex' });
    expect(await undoSize(page)).toBe(s0 + 1);
    // 4 cells from the city along the row: far outside the network (and not within pixel distance 2 of the city)
    expect((await pixelDisc(page, CITY.col, CITY.row, 2)).includes('225,228')).toBe(false);
    await clickCell(page, 225, 228);
    expect(await roadKeys(page)).toEqual([nb.col + ',' + nb.row]);
    expect(await undoSize(page)).toBe(s0 + 1);
    expect((await toasts(page)).some(t => /must connect/i.test(t))).toBe(true);
    await page.evaluate(() => History.undo());
    expect(await roadKeys(page)).toEqual([]);
    await page.evaluate(() => History.redo());
    expect(await roadKeys(page)).toEqual([nb.col + ',' + nb.row]);
  });

  test('W grows the network tile by tile (each click one step); a click on an existing road tile changes nothing (no step)', async ({ page }) => {
    const nb = await goodNeighbour(page);
    await roadTool(page, 'road');
    await clickCell(page, nb.col, nb.row);
    const s1 = await undoSize(page);
    await clickCell(page, nb.col, nb.row);
    expect(await undoSize(page)).toBe(s1);
    // a second tile adjacent (pixel geometry) to the first and accepted by the gate
    const ring = await pixelDisc(page, nb.col, nb.row, 1);
    const next = await page.evaluate(([ringKeys]) => (ringKeys as string[]).map(k => k.split(',').map(Number)).find(([c, r]) => !roadsData[c + ',' + r] && !(c === 225 && r === 224) && Roads.getNeighbors(c, r).some((m: any) => roadsData[m.col + ',' + m.row])), [ring]);
    expect(next).toBeTruthy();
    await clickCell(page, next![0], next![1]);
    expect(await undoSize(page)).toBe(s1 + 1);
    expect((await roadKeys(page)).length).toBe(2);
  });

  test('a drag with Draw Road places only the tile under the press (roads go one tap at a time) in one step', async ({ page }) => {
    const nb = await goodNeighbour(page);
    await roadTool(page, 'road');
    const s0 = await undoSize(page);
    await dragCells(page, nb, { col: nb.col + 3, row: nb.row });
    expect(await roadKeys(page)).toEqual([nb.col + ',' + nb.row]);
    expect(await undoSize(page)).toBe(s0 + 1);
  });

  test('Q erases ONLY the road: terrain, building and zone on the cell stay; one undo step; undo restores the road; erasing an empty cell adds no step', async ({ page }) => {
    const nb = await goodNeighbour(page);
    const k = nb.col + ',' + nb.row;
    await page.evaluate(([c, r]) => {
      roadsData[c + ',' + r] = { type: 'road_hex' }; roadsData['300,300'] = { type: 'road_hex' };
      mapData[(r as number) * MAP_WIDTH + (c as number)] = 'Forest_1'; objectsData[c + ',' + r] = 'Artefact_Test_1';
    }, [nb.col, nb.row]);
    await page.keyboard.press('KeyQ');
    const s0 = await undoSize(page);
    await clickCell(page, nb.col, nb.row);
    const after = await page.evaluate(([c, r]) => ({ road: (c + ',' + r) in roadsData, other: '300,300' in roadsData, id: mapData[(r as number) * MAP_WIDTH + (c as number)], obj: objectsData[c + ',' + r] }), [nb.col, nb.row]);
    expect(after).toEqual({ road: false, other: true, id: 'Forest_1', obj: 'Artefact_Test_1' });
    expect(await undoSize(page)).toBe(s0 + 1);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate((key) => roadsData[key], k)).toEqual({ type: 'road_hex' });
    await clickCell(page, 240, 230);                     // no road there
    expect(await undoSize(page)).toBe(s0);
  });

  test('the road overlay follows draw, undo and redo (canvas pixels change and return)', async ({ page }) => {
    const nb = await goodNeighbour(page);
    await roadTool(page, 'road');
    // full-canvas pixel snapshots with the cursor off the canvas (no hover outline), taken once two consecutive frames agree
    // (sprites decode asynchronously after load / after a history restore); diff counts differing pixels
    const frame = (n: string) => page.evaluate((name) => new Promise<void>(r => { Canvas.render(); requestAnimationFrame(() => { const cv = document.getElementById('map-canvas') as HTMLCanvasElement; (window as any)['__' + name] = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data; r(); }); }), n);
    // differing pixels inside / outside the hex of (col,row) (a box of one cell pitch around its centre)
    const diff = (a: string, b: string, c: number, r: number) => page.evaluate(([x, y, cc, rr]) => {
      const A = (window as any)['__' + x], B = (window as any)['__' + y], W = (document.getElementById('map-canvas') as HTMLCanvasElement).width;
      const p = Canvas.hexScreenPos(cc as number, rr as number), R = 40; let inside = 0, outside = 0;
      for (let i = 0; i < A.length; i += 4) {
        if (A[i] === B[i] && A[i + 1] === B[i + 1] && A[i + 2] === B[i + 2]) continue;
        const px = (i / 4) % W, py = Math.floor(i / 4 / W);
        if (Math.abs(px - p.x) <= R && Math.abs(py - p.y) <= R) inside++; else outside++;
      }
      return { inside, outside };
    }, [a, b, c, r]);
    const snap = async (name: string) => {
      await page.mouse.move(2, 2);
      await frame('tmp');
      for (let i = 0; i < 60; i++) { await frame(name); const d = await diff('tmp', name, 0, 0); if (d.inside + d.outside === 0) return; await frame('tmp'); const e = await diff('tmp', name, 0, 0); if (e.inside + e.outside === 0) return; }
      throw new Error('canvas never settled');
    };
    await snap('first');
    await clickCell(page, nb.col, nb.row);
    await snap('road');
    await page.evaluate(() => History.undo());
    await snap('undone');
    await page.evaluate(() => History.redo());
    await snap('redone');
    await page.evaluate(() => History.undo());
    await snap('undone2');
    const drawn = await diff('road', 'undone', nb.col, nb.row);
    expect(drawn.inside).toBeGreaterThan(200);                       // undo removes the road: a hex-sized area changes
    expect(drawn.outside).toBe(0);                                   // and nothing else on the canvas
    expect(await diff('road', 'redone', nb.col, nb.row)).toEqual({ inside: 0, outside: 0 });     // redo draws exactly the same pixels
    expect(await diff('undone', 'undone2', nb.col, nb.row)).toEqual({ inside: 0, outside: 0 });  // and undo removes exactly the same
  });

  test('only the left button acts: right, middle and side buttons draw / erase / connect nothing', async ({ page }) => {
    const nb = await goodNeighbour(page);
    const s0 = await undoSize(page);
    for (const tool of ['road', 'road-connect', 'erase-road']) {
      await page.evaluate(([t, c, r]) => { Tools.setActive(t as string); if (t === 'erase-road') roadsData[c + ',' + r] = { type: 'road_hex' }; }, [tool, nb.col, nb.row]);
      const p = await cellPoint(page, nb.col, nb.row);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
      await page.mouse.down({ button: 'middle' }); await page.mouse.up({ button: 'middle' });
      await ev(page, 'mousedown', nb.col, nb.row, { button: 3 }); await ev(page, 'mouseup', nb.col, nb.row, { button: 3 });
      await ev(page, 'mousedown', nb.col, nb.row, { button: 4 }); await ev(page, 'mouseup', nb.col, nb.row, { button: 4 });
      expect(await startOf(page)).toBe(null);
    }
    expect(await roadKeys(page)).toEqual([nb.col + ',' + nb.row]);   // only the one seeded for the erase check, still there
    expect(await undoSize(page)).toBe(s0);
  });

  test('Escape while the button is still down rolls the road back without a step (redo stack kept)', async ({ page }) => {
    await page.evaluate(() => { History.push(); roadsData['400,400'] = { type: 'road_hex' }; History.undo(); roadsData = {}; });
    const nb = await goodNeighbour(page);
    const before = await page.evaluate(() => ({ u: History.undoSize(), r: History.redoSize() }));
    expect(before.r).toBe(1);
    await roadTool(page, 'road');
    const p = await cellPoint(page, nb.col, nb.row);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    expect(await roadKeys(page)).toEqual([nb.col + ',' + nb.row]);
    await page.keyboard.press('Escape');
    expect(await roadKeys(page)).toEqual([]);
    await page.mouse.up();
    expect(await roadKeys(page)).toEqual([]);
    expect(await page.evaluate(() => ({ u: History.undoSize(), r: History.redoSize() }))).toEqual(before);
  });

  test('Escape while erasing rolls the erase back; undo is ignored mid-stroke', async ({ page }) => {
    const nb = await goodNeighbour(page);
    await page.evaluate(([c, r]) => { roadsData[c + ',' + r] = { type: 'road_hex' }; }, [nb.col, nb.row]);
    await roadTool(page, 'erase-road');
    const s0 = await undoSize(page);
    const p = await cellPoint(page, nb.col, nb.row);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    expect(await roadKeys(page)).toEqual([]);
    await page.evaluate(() => History.undo());                               // refused mid-stroke
    expect(await undoSize(page)).toBe(s0 + 1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await roadKeys(page)).toEqual([nb.col + ',' + nb.row]);
    expect(await undoSize(page)).toBe(s0);
  });

  test('a lost mouse-up and a window blur end the gesture cleanly; the step stays', async ({ page }) => {
    const nb = await goodNeighbour(page);
    await roadTool(page, 'road');
    const s0 = await undoSize(page);
    const p = await cellPoint(page, nb.col, nb.row);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await ev(page, 'mousemove', nb.col + 1, nb.row, { buttons: 0 });
    expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(false);
    await page.mouse.up();
    expect(await undoSize(page)).toBe(s0 + 1);
    // Second gesture on a NEW tile next to the first road: a blur while the button is down must END it with the step kept
    // (commit). A rollback would remove the tile and the step, which this version of the test can tell apart.
    const n2 = await page.evaluate(([c, r]) => Roads.getNeighbors(c as number, r as number).find((m: any) => !(m.col === 225 && m.row === 224) && !((m.col + ',' + m.row) in roadsData)), [nb.col, nb.row]);
    expect(n2).toBeTruthy();
    const q = await cellPoint(page, n2!.col, n2!.row);
    await page.mouse.move(q.x, q.y); await page.mouse.down();
    expect(await roadKeys(page)).toContain(n2!.col + ',' + n2!.row);             // the press drew it
    expect(await undoSize(page)).toBe(s0 + 2);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(false);
    await page.mouse.up();
    expect(await undoSize(page)).toBe(s0 + 2);                                  // blur kept the step
    expect(await roadKeys(page)).toEqual([nb.col + ',' + nb.row, n2!.col + ',' + n2!.row].sort());   // and the tile
  });

  test('a map replaced mid-gesture stops the road tool with a road-specific toast and writes nothing to the new map', async ({ page }) => {
    const nb = await goodNeighbour(page);
    await roadTool(page, 'road');
    const p = await cellPoint(page, nb.col, nb.row);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.evaluate(() => { IO.newMap(true); Canvas.centerOnCity(); });
    await page.mouse.move(p.x + 3, p.y + 3, { steps: 2 });
    await page.mouse.up();
    expect(await roadKeys(page)).toEqual([]);
    expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(false);
    const t = await toasts(page);
    expect(t.some(x => /road tool stopped/i.test(x))).toBe(true);
    expect(t.some(x => /building tool stopped/i.test(x))).toBe(false);
  });

  test('all three tools ignore input while a fill runs', async ({ page }) => {
    const nb = await goodNeighbour(page);
    const r = await page.evaluate(async ([c, rw]) => {
      UI.selectTerrain('Forest_1');
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect();
      const fire = (t: string, cc: number, rr: number) => { const p = Canvas.hexScreenPos(cc, rr); cv.dispatchEvent(new MouseEvent(t, { clientX: rc.left + p.x, clientY: rc.top + p.y, button: 0, bubbles: true })); };
      const p = Tools.fill(240, 240);
      const busy = Tools.isFillBusy();
      const before = History.undoSize();
      Tools.setActive('road'); fire('mousedown', c as number, rw as number); fire('mouseup', c as number, rw as number);
      const drawn = Object.keys(roadsData).length;
      Tools.setActive('road-connect'); fire('mousedown', c as number, rw as number); fire('mouseup', c as number, rw as number);
      const start = Tools.getRoadConnectStart();
      roadsData[c + ',' + rw] = { type: 'road_hex' };
      Tools.setActive('erase-road'); fire('mousedown', c as number, rw as number); fire('mouseup', c as number, rw as number);
      const out = { busy, drawn, start, kept: (c + ',' + rw) in roadsData, steps: History.undoSize() - before };
      await p;
      return out;
    }, [nb.col, nb.row]);
    expect(r).toEqual({ busy: true, drawn: 0, start: null, kept: true, steps: 0 });
  });

  // ── Connect Road (click, click) ──────────────────────────────────────────────────────────────────────────
  test('Connect Road: the first click only sets a visible start (no road, no step); the second click connects in ONE step; undo removes all of it', async ({ page }) => {
    await page.keyboard.press('KeyC');
    const s0 = await undoSize(page), r0 = await roadSnap(page);
    await clickCell(page, 222, 224);
    expect(await startOf(page)).toEqual({ col: 222, row: 224 });
    expect(await page.evaluate(() => Canvas.hasHighlight('road-start'))).toBe(true);
    expect(await roadSnap(page)).toBe(r0);
    expect(await undoSize(page)).toBe(s0);
    expect((await toasts(page)).some(t => /road start set/i.test(t))).toBe(true);
    await clickCell(page, 228, 224);
    const keys = await roadKeys(page);
    // the N axis (same row, col 222..228) is the one straight line of 7 cells; it is the shortest path in true AND legacy adjacency
    expect(keys).toEqual([222, 223, 224, 225, 226, 227, 228].map(c => c + ',224').sort());
    expect(await page.evaluate(() => HexUtils.lineCells({ col: 222, row: 224 }, { col: 228, row: 224 }, MAP_WIDTH, MAP_HEIGHT).map((c: any) => c.col + ',' + c.row).sort())).toEqual(keys);   // independent reference
    expect(await undoSize(page)).toBe(s0 + 1);
    expect(await startOf(page)).toEqual({ col: 228, row: 224 });             // chaining: the destination is the next start
    await page.evaluate(() => History.undo());
    expect(await roadSnap(page)).toBe(r0);
    await page.evaluate(() => History.redo());
    expect(await roadKeys(page)).toEqual(keys);
  });

  test('Connect Road chains: a third click continues from the destination as one more step; clicking the start again does nothing', async ({ page }) => {
    await roadTool(page, 'road-connect');
    const s0 = await undoSize(page);
    await clickCell(page, 222, 224);
    await clickCell(page, 222, 224);                                           // same cell: nothing
    expect(await undoSize(page)).toBe(s0);
    expect(await startOf(page)).toEqual({ col: 222, row: 224 });
    await clickCell(page, 226, 224);
    const n1 = (await roadKeys(page)).length;
    await clickCell(page, 230, 224);
    expect(await undoSize(page)).toBe(s0 + 2);
    expect((await roadKeys(page)).length).toBeGreaterThan(n1);
    await page.evaluate(() => History.undo());
    expect((await roadKeys(page)).length).toBe(n1);
  });

  test('Connect Road over a path that already exists is no change: no step, the start still moves to the destination', async ({ page }) => {
    await roadTool(page, 'road-connect');
    await clickCell(page, 222, 224);
    await clickCell(page, 228, 224);                                           // builds it (step 1), start is now 228
    const s1 = await undoSize(page), r1 = await roadSnap(page);
    await clickCell(page, 222, 224);                                           // the way back is already road
    expect(await roadSnap(page)).toBe(r1);
    expect(await undoSize(page)).toBe(s1);
    expect(await startOf(page)).toEqual({ col: 222, row: 224 });
  });

  test('Connect Road: a destination that cannot be reached toasts, keeps the start, and changes nothing', async ({ page }) => {
    await roadTool(page, 'road-connect');
    const s0 = await undoSize(page);
    await page.evaluate(() => { Canvas.setZoom(25); Canvas.centerOnCity(); });
    const far = await page.evaluate(() => { const b = document.getElementById('map-canvas')!.getBoundingClientRect(); return [205, 245].map(c => { const p = Canvas.hexScreenPos(c, 224); return p.y > 40 && p.y < b.height - 10 && p.x > 40 && p.x < b.width; }); });
    expect(far).toEqual([true, true]);                                         // both ends are on screen at 25% zoom
    await clickCell(page, 205, 224);
    await clickCell(page, 245, 224);                                           // 40 cells away: beyond the 4000-node path search cap
    expect((await toasts(page)).some(t => /too far/i.test(t))).toBe(true);
    expect(await startOf(page)).toEqual({ col: 205, row: 224 });
    expect(await roadKeys(page)).toEqual([]);
    expect(await undoSize(page)).toBe(s0);
  });

  test('Connect Road: Escape between the clicks cancels the start (no step, highlight gone); the next click starts afresh', async ({ page }) => {
    await roadTool(page, 'road-connect');
    const s0 = await undoSize(page);
    await clickCell(page, 222, 224);
    await page.keyboard.press('Escape');
    expect(await startOf(page)).toBe(null);
    expect(await page.evaluate(() => Canvas.hasHighlight('road-start'))).toBe(false);
    expect(await undoSize(page)).toBe(s0);
    expect(await page.evaluate(() => Tools.getActive())).toBe('road-connect');
    await clickCell(page, 228, 224);                                           // a fresh start, not a connection
    expect(await startOf(page)).toEqual({ col: 228, row: 224 });
    expect(await roadKeys(page)).toEqual([]);
    expect(await undoSize(page)).toBe(s0);
  });

  test('Connect Road: Escape while the second click is held rolls the whole connection back and leaves no start', async ({ page }) => {
    await roadTool(page, 'road-connect');
    const s0 = await undoSize(page);
    await clickCell(page, 222, 224);
    const p = await cellPoint(page, 228, 224);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    expect((await roadKeys(page)).length).toBeGreaterThanOrEqual(3);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await roadKeys(page)).toEqual([]);
    expect(await undoSize(page)).toBe(s0);
    expect(await startOf(page)).toBe(null);
    expect(await page.evaluate(() => Canvas.hasHighlight('road-start'))).toBe(false);
  });

  test('Connect Road: a tool switch clears the pending start and its highlight (even switching back)', async ({ page }) => {
    await roadTool(page, 'road-connect');
    await clickCell(page, 222, 224);
    expect(await startOf(page)).not.toBe(null);
    await page.evaluate(() => Tools.setActive('paint'));
    expect(await startOf(page)).toBe(null);
    expect(await page.evaluate(() => Canvas.hasHighlight('road-start'))).toBe(false);
    await roadTool(page, 'road-connect');
    await clickCell(page, 228, 224);
    expect(await startOf(page)).toEqual({ col: 228, row: 224 });              // a start, not a connection
    expect(await roadKeys(page)).toEqual([]);
    await page.evaluate(() => Tools.setActive('road'));
    expect(await startOf(page)).toBe(null);
  });

  test('Connect Road: a map replaced between the clicks clears the start with a toast (on the next move) and a click never connects across maps', async ({ page }) => {
    await roadTool(page, 'road-connect');
    await clickCell(page, 222, 224);
    await page.evaluate(() => { IO.newMap(true); Canvas.centerOnCity(); });
    const p = await cellPoint(page, 226, 224);
    await page.mouse.move(p.x, p.y);
    expect(await startOf(page)).toBe(null);
    expect((await toasts(page)).some(t => /road start cleared/i.test(t))).toBe(true);
    // and with no move in between (raw press and release events): the click itself is a fresh start
    await clickCell(page, 222, 224);
    await page.evaluate(() => { IO.newMap(true); Canvas.centerOnCity(); });
    await ev(page, 'mousedown', 228, 224); await ev(page, 'mouseup', 228, 224);
    expect(await startOf(page)).toEqual({ col: 228, row: 224 });
    expect(await roadKeys(page)).toEqual([]);
  });

  test('Connect Road ignores right/middle/side buttons for both clicks', async ({ page }) => {
    await roadTool(page, 'road-connect');
    const p = await cellPoint(page, 222, 224);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await ev(page, 'mousedown', 222, 224, { button: 3 }); await ev(page, 'mouseup', 222, 224, { button: 3 });
    expect(await startOf(page)).toBe(null);
  });

  // ── cleanup A3: the pending start must not survive in-place rewrites of the map ──
  const setStart = async (page: Page) => { await roadTool(page, 'road-connect'); await clickCell(page, 222, 224); expect(await startOf(page)).toEqual({ col: 222, row: 224 }); };
  const noStart = async (page: Page, what: string) => {
    expect(await startOf(page), what).toBe(null);
    expect(await page.evaluate(() => Canvas.hasHighlight('road-start')), what + ' highlight').toBe(false);
  };

  test('Connect Road: undo and redo drop a pending start (history restores rewrite the map in place)', async ({ page }) => {
    await page.evaluate(() => { History.push(); mapData[1] = 'Water_1'; });          // something to undo, then redo
    await setStart(page);
    await page.evaluate(() => History.undo());
    await noStart(page, 'undo');
    await page.evaluate(() => { Tools.setActive('road-connect'); });
    await clickCell(page, 222, 224);
    await page.evaluate(() => History.redo());
    await noStart(page, 'redo');
  });

  test('Connect Road: Clear Map and Fill Map drop a pending start', async ({ page }) => {
    await page.evaluate(() => { roadsData['230,224'] = { type: 'road_hex' }; });
    await setStart(page);
    await page.evaluate(() => IO.fillMap()); await page.click('#confirm-ok');
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 100])).toBe('Plain_1');
    await noStart(page, 'Fill Map');
    await page.evaluate(() => { Tools.setActive('road-connect'); });
    await clickCell(page, 222, 224);
    await page.evaluate(() => IO.clearMap()); await page.click('#confirm-ok');
    expect(await page.evaluate(() => Object.keys(roadsData).length)).toBe(0);
    await noStart(page, 'Clear Map');
  });

  test('Connect Road: Escape with only a pending start is consumed (preventDefault) and keeps the tool', async ({ page }) => {
    await setStart(page);
    const prevented = await page.evaluate(() => { const ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; });
    expect(prevented).toBe(true);
    await noStart(page, 'Escape');
  });
});

// ── T2.16: Bridge tool (U) ───────────────────────────────────────────────────────────────────────────────────────
// Bridges are the Road_Bridge_* buildings (category Bridge) placed in objectsData on river tiles (type 'Rivers').
// Reference data is independent of the code under test: river / non-river hex ids come from hex_database.json (checked by
// hand: River_*, Lake_1.. are type Rivers; Water_1, Plain_1 are not) and the three bridge ids from building_database.json.
test.describe('bridge tool (T2.16)', () => {
  // The shipped package has ONE bridge building (Road_Bridge_NEWS_1); two more Bridge-category entries are fabricated so that
  // choosing, replacing and per-tool selections can be exercised (same technique as the satellite radius test).
  test.beforeEach(async ({ page }) => {
    await freshEditor(page); await spyToasts(page);
    await page.evaluate(() => {
      const o = BldDB.getAll;
      BldDB.getAll = () => o.call(BldDB).concat(['Road_Bridge_NS_1', 'Road_Bridge_SENW_1'].map(id => ({ id, buildingCategory: 'Bridge', spriteName: id })) as any);
    });
  });
  const BRIDGES = ['Road_Bridge_NEWS_1', 'Road_Bridge_NS_1', 'Road_Bridge_SENW_1'];
  const river = (page: Page, col = 227, row = 224, id = 'River_L_1') => page.evaluate(([c, r, h]) => { mapData[(r as number) * MAP_WIDTH + (c as number)] = h as string; }, [col, row, id]);
  const bridgeTool = async (page: Page, id?: string) => {
    await page.evaluate((b) => { Tools.setActive('bridge'); if (b) Tools.selectBuilding(b); }, id || '');
    await hidePicker(page);
  };
  const obj = (page: Page, k: string) => page.evaluate((key) => objectsData[key] || null, k);
  const display = (page: Page) => page.evaluate(() => getComputedStyle(document.getElementById('obj-building-picker')!).display);

  // ── cleanup A4 ──
  test('a bridge standing on non-river land can be toggled off by the bridge tool in one step; placing on land is still refused', async ({ page }) => {
    await page.evaluate(() => { objectsData['228,224'] = 'Road_Bridge_NS_1'; });
    await bridgeTool(page, 'Road_Bridge_NS_1');
    const s0 = await undoSize(page);
    await clickCell(page, 228, 224);                                  // Plain_1 with the SAME bridge: removal
    expect(await obj(page, '228,224')).toBe(null);
    expect(await undoSize(page)).toBe(s0 + 1);
    expect((await toasts(page)).filter(t => t === 'Bridges can only be built on river tiles').length).toBe(0);
    await page.evaluate(() => { objectsData['229,224'] = 'Road_Bridge_SENW_1'; });
    await clickCell(page, 229, 224);                                  // a DIFFERENT bridge on land is a replace: still refused
    expect(await obj(page, '229,224')).toBe('Road_Bridge_SENW_1');
    await clickCell(page, 230, 224);                                  // empty land: refused
    expect(await obj(page, '230,224')).toBe(null);
    expect((await toasts(page)).filter(t => t === 'Bridges can only be built on river tiles').length).toBe(2);
    expect(await undoSize(page)).toBe(s0 + 1);
  });

  test('a selected bridge that no longer exists in BldDB is refused with "Pick a bridge first" and writes nothing', async ({ page }) => {
    await river(page);
    await bridgeTool(page, 'Road_Bridge_NS_1');
    await page.evaluate(() => { const o = BldDB.getAll; BldDB.getAll = () => o.call(BldDB).filter((b: any) => b.id !== 'Road_Bridge_NS_1'); });
    const s0 = await undoSize(page);
    await clickCell(page, 227, 224);
    expect(await obj(page, '227,224')).toBe(null);
    expect(await undoSize(page)).toBe(s0);
    expect((await toasts(page)).filter(t => t === 'Pick a bridge first').length).toBe(1);
  });

  test('object mode refuses Bridge-category ids in selectBuilding', async ({ page }) => {
    await page.evaluate(() => { Tools.setActive('object'); Tools.selectBuilding('Artefact_Test_1'); });
    await page.evaluate(() => Tools.selectBuilding('Road_Bridge_NS_1'));
    expect(await page.evaluate(() => Tools.getSelectedBuildingId())).toBe('Artefact_Test_1');
    expect((await toasts(page)).filter(t => t === 'Not a building for this tool').length).toBe(1);
  });

  test('with no Bridge buildings loaded the bridge button is disabled with an explaining tooltip, and enables again', async ({ page }) => {
    const state = () => page.evaluate(() => { const b = document.querySelector('.tool-btn[data-tool="bridge"]') as HTMLButtonElement; return { disabled: b.disabled, title: b.title }; });
    expect((await state()).disabled).toBe(false);
    await page.evaluate(() => { (window as any).__o = BldDB.getAll; BldDB.getAll = () => (window as any).__o.call(BldDB).filter((b: any) => b.buildingCategory !== 'Bridge'); UI.buildPalette(); });
    const off = await state();
    expect(off.disabled).toBe(true);
    expect(off.title).toContain('No bridge buildings');
    await page.evaluate(() => { BldDB.getAll = (window as any).__o; UI.buildPalette(); });
    expect((await state()).disabled).toBe(false);
    expect((await state()).title).toContain('Place Bridge');
  });

  test('U places a bridge on a river tile, the same bridge again removes it, land is refused with a toast and no step', async ({ page }) => {
    await river(page);
    await page.keyboard.press('u');
    expect(await page.evaluate(() => Tools.getActive())).toBe('bridge');
    await page.evaluate(() => Tools.selectBuilding('Road_Bridge_NS_1'));
    await hidePicker(page);
    expect(await page.evaluate(() => Tools.getSelectedBridgeId())).toBe('Road_Bridge_NS_1');
    const s0 = await undoSize(page);
    await clickCell(page, 227, 224);
    expect(await obj(page, '227,224')).toBe('Road_Bridge_NS_1');
    expect(await undoSize(page)).toBe(s0 + 1);
    await clickCell(page, 227, 224);
    expect(await obj(page, '227,224')).toBe(null);
    expect(await undoSize(page)).toBe(s0 + 2);
    const s1 = await undoSize(page);
    await clickCell(page, 228, 224);                                  // Plain_1
    expect((await toasts(page)).filter(t => t === 'Bridges can only be built on river tiles').length).toBe(1);
    expect(await objs(page)).toEqual({});
    expect(await undoSize(page)).toBe(s1);
    // undo / redo
    await clickCell(page, 227, 224);
    await page.evaluate(() => History.undo());
    expect(await obj(page, '227,224')).toBe(null);
    await page.evaluate(() => History.redo());
    expect(await obj(page, '227,224')).toBe('Road_Bridge_NS_1');
  });

  test('a different bridge replaces the one on the tile in ONE step; undo brings the old one back; the object tool selection is untouched', async ({ page }) => {
    await river(page);
    await page.evaluate(() => Tools.selectBuilding('Artefact_Test_1'));   // object-tool selection
    await bridgeTool(page, 'Road_Bridge_NS_1');
    await clickCell(page, 227, 224);
    const s0 = await undoSize(page);
    await page.evaluate(() => Tools.selectBuilding('Road_Bridge_SENW_1'));
    await clickCell(page, 227, 224);
    expect(await obj(page, '227,224')).toBe('Road_Bridge_SENW_1');
    expect(await undoSize(page)).toBe(s0 + 1);
    await page.evaluate(() => History.undo());
    expect(await obj(page, '227,224')).toBe('Road_Bridge_NS_1');
    expect(await page.evaluate(() => Tools.getSelectedBuildingId())).toBe('Artefact_Test_1');
    expect(await page.evaluate(() => Tools.getSelectedBridgeId())).toBe('Road_Bridge_SENW_1');
  });

  test('river-type tiles accept a bridge (River_R_1, River_D_2, Lake_1); other terrain refuses (Water_1, Plain_1, Forest_1)', async ({ page }) => {
    await bridgeTool(page, 'Road_Bridge_NS_1');
    const cells: [number, number, string, boolean][] = [[226, 224, 'River_R_1', true], [227, 224, 'River_D_2', true], [228, 224, 'Lake_1', true], [229, 224, 'Water_1', false], [230, 224, 'Plain_1', false], [231, 224, 'Forest_1', false]];
    for (const [c, r, h] of cells) await river(page, c, r, h);
    for (const [c, r] of cells) await clickCell(page, c, r);
    expect(Object.keys(await objs(page)).sort()).toEqual(cells.filter(x => x[3]).map(x => x[0] + ',' + x[1]).sort());
  });

  test('a bridge on a river tile has no satellites; replacing a building that has them removes them', async ({ page }) => {
    await river(page);
    await bridgeTool(page, 'Road_Bridge_NS_1');
    await clickCell(page, 227, 224);
    expect(await objs(page)).toEqual({ '227,224': 'Road_Bridge_NS_1' });
    expect(await page.evaluate(() => BldDB.getAll().filter((b: any) => b.buildingCategory === 'Bridge').every((b: any) => !b.satelliteId))).toBe(true);
    await page.evaluate(() => { History.undo(); });
    await useTool(page, 'object', 'Farm_Test_1');
    await clickCell(page, 227, 224);
    expect(Object.values(await objs(page)).filter(v => v === 'Grain_1').length).toBe(6);
    const s0 = await undoSize(page);
    await bridgeTool(page, 'Road_Bridge_NS_1');
    await clickCell(page, 227, 224);
    expect(await objs(page)).toEqual({ '227,224': 'Road_Bridge_NS_1' });
    expect(await undoSize(page)).toBe(s0 + 1);
    await page.evaluate(() => History.undo());
    expect(Object.values(await objs(page)).filter(v => v === 'Grain_1').length).toBe(6);
  });

  test('a river tile that lies under another multi-tile terrain footprint is refused with a toast and no step', async ({ page }) => {
    const fp = await page.evaluate(() => {
      mapData[224 * MAP_WIDTH + 228] = 'Rabbit_Flat_1'; invalidateSatelliteMap();
      const out: string[] = [];
      for (let c = 225; c <= 231; c++) for (let r = 221; r <= 227; r++) if (getSatelliteAnchor(c, r)) out.push(c + ',' + r);
      return out;
    });
    expect(fp.length).toBeGreaterThan(0);
    const [fc, fr] = fp[0].split(',').map(Number);
    await river(page, fc, fr);
    await bridgeTool(page, 'Road_Bridge_NS_1');
    const s0 = await undoSize(page);
    await clickCell(page, fc, fr);
    expect(await objs(page)).toEqual({});
    expect(await undoSize(page)).toBe(s0);
    expect((await toasts(page)).some(t => /multi-tile|footprint/i.test(t))).toBe(true);
  });

  test('the button lives in the left palette (not the top toolbar); canvas keeps 1491 px at 1400x900; registered as a lazy stroke tool', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const r = await page.evaluate(() => {
      const b = document.querySelector('.tool-btn[data-tool="bridge"]') as HTMLElement | null;
      return { has: !!b, inPalette: !!b && !!b.closest('#palette-panel') && !b.closest('#toolbar') && b.getBoundingClientRect().width > 0, title: b && b.title,
               cw: (document.getElementById('map-canvas') as HTMLCanvasElement).width, lazy: Tools._lazyStrokeTools.has('bridge') };
    });
    expect(r.has).toBe(true);
    expect(r.inPalette).toBe(true);
    expect(r.title).toContain('(U)');
    expect(r.cw).toBe(1491);
    expect(r.lazy).toBe(true);
    await page.click('.tool-btn[data-tool="bridge"]');
    expect(await page.evaluate(() => Tools.getActive())).toBe('bridge');
    expect(await page.evaluate(() => document.getElementById('st-tool')!.textContent)).toContain('Bridge');
  });

  test('U is a physical-key shortcut: not with Shift/Alt/Ctrl, not while typing, in a modal or on auto-repeat; no other letter changed', async ({ page }) => {
    await page.keyboard.press('KeyU');
    expect(await page.evaluate(() => Tools.getActive())).toBe('bridge');
    for (const mod of ['Shift', 'Alt', 'Control']) {
      await page.evaluate(() => Tools.setActive('paint'));
      await page.keyboard.down(mod); await page.keyboard.press('KeyU'); await page.keyboard.up(mod);
      expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    }
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-text'; i.type = 'text'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press('KeyU');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await page.evaluate(() => document.getElementById('tmp-text')!.remove());
    await page.evaluate(() => { const m = document.createElement('div'); m.id = 'tmp-modal'; document.body.appendChild(m); });
    await page.keyboard.press('KeyU');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await page.evaluate(() => document.getElementById('tmp-modal')!.remove());
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', code: 'KeyU', repeat: true, bubbles: true })));
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    const map: Record<string, string> = {};
    for (const k of 'abcdefghijklmnopqrstuvwxyz') { await page.evaluate(() => Tools.setActive('paint')); await page.keyboard.press('Key' + k.toUpperCase()); map[k] = await page.evaluate(() => Tools.getActive()); }
    expect(map).toMatchObject({ u: 'bridge', w: 'road', c: 'road-connect', q: 'erase-road', b: 'object', p: 'paint', f: 'fill', r: 'rect', e: 'eye', s: 'select', t: 'settlement', d: 'erase', z: 'zone', l: 'line', o: 'circle', g: 'polygon', x: 'eraser', a: 'scatter', m: 'marquee', h: 'replace' });
  });

  test('the bridge picker lists exactly the Bridge-category buildings; the object picker lists none of them; each tool keeps its own selection', async ({ page }) => {
    await page.evaluate(() => Tools.setActive('bridge'));
    const ids = () => page.evaluate(() => Array.from(document.querySelectorAll('#obj-building-picker-grid .bld-card')).map(c => (c as HTMLElement).dataset.bldId).sort());
    expect(await ids()).toEqual(BRIDGES);
    expect(await display(page)).toBe('block');
    expect(await page.evaluate(() => Tools.getSelectedBridgeId())).toBe(BRIDGES[0]);       // first one is pre-selected
    await page.click('#obj-building-picker-grid .bld-card[data-bld-id="Road_Bridge_SENW_1"]');
    expect(await page.evaluate(() => [Tools.getSelectedBridgeId(), document.getElementById('obj-building-label')!.textContent])).toEqual(['Road_Bridge_SENW_1', 'Road_Bridge_SENW_1']);
    expect(await page.evaluate(() => document.querySelector('#obj-building-picker-grid .bld-card.selected')!.getAttribute('data-bld-id'))).toBe('Road_Bridge_SENW_1');
    await page.evaluate(() => Tools.setActive('object'));
    const objIds = await ids();
    expect(objIds.length).toBeGreaterThan(2);
    expect(objIds.some(i => i.startsWith('Road_Bridge_'))).toBe(false);
    const objSel = await page.evaluate(() => Tools.getSelectedBuildingId());
    expect(BRIDGES.includes(objSel as string)).toBe(false);
    await page.evaluate(() => Tools.selectBuilding('Artefact_Test_1'));
    await page.evaluate(() => Tools.setActive('bridge'));
    expect(await page.evaluate(() => Tools.getSelectedBridgeId())).toBe('Road_Bridge_SENW_1');
    expect(await page.evaluate(() => Tools.getSelectedBuildingId())).toBe('Artefact_Test_1');
    expect(await page.evaluate(() => document.getElementById('obj-building-label')!.textContent)).toBe('Road_Bridge_SENW_1');
  });

  test('selectBuilding in bridge mode refuses unknown ids and non-bridge buildings (selection kept); the picker label hides for other tools', async ({ page }) => {
    await bridgeTool(page, 'Road_Bridge_NS_1');
    await page.evaluate(() => { Tools.selectBuilding('No_Such_Building'); Tools.selectBuilding('Artefact_Test_1'); Tools.selectBuilding(''); });
    expect(await page.evaluate(() => Tools.getSelectedBridgeId())).toBe('Road_Bridge_NS_1');
    expect(await page.evaluate(() => Tools.getSelectedBuildingId())).not.toBe('Artefact_Test_1');
    expect((await toasts(page)).filter(t => /unknown building|not a bridge/i.test(t)).length).toBe(3);
    await page.evaluate(() => Tools.setActive('paint'));
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('obj-building-label')!).display)).toBe('none');
    await page.evaluate(() => Tools.selectBuilding('Artefact_Test_1'));   // paint is active: this is the object selection, not the bridge one
    expect(await page.evaluate(() => [Tools.getSelectedBuildingId(), Tools.getSelectedBridgeId()])).toEqual(['Artefact_Test_1', 'Road_Bridge_NS_1']);
  });

  test('with no bridge building in the database the tool does not activate: toast, previous tool and picker unchanged', async ({ page }) => {
    await page.evaluate(() => Tools.setActive('zone'));
    await page.evaluate(() => { const o = BldDB.getAll; BldDB.getAll = () => []; try { Tools.setActive('bridge'); } finally { BldDB.getAll = o; } });
    expect(await page.evaluate(() => Tools.getActive())).toBe('zone');
    expect((await toasts(page)).some(t => /no bridge/i.test(t))).toBe(true);
    expect(await display(page)).toBe('none');
    expect(await page.evaluate(() => document.querySelector('.tool-btn[data-tool="bridge"]')!.classList.contains('active'))).toBe(false);
  });

  test('bridge picker: stays inside a 1100x340 viewport, Escape and an outside click close it (tool and selection stay), cards are keyboard-operable and do not lift a selection', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 340 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.click('.tool-btn[data-tool="bridge"]');
    const r = await page.evaluate(() => { const b = document.getElementById('obj-building-picker')!.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: innerWidth, h: innerHeight }; });
    expect(r.l).toBeGreaterThanOrEqual(0); expect(r.t).toBeGreaterThanOrEqual(0); expect(r.r).toBeLessThanOrEqual(r.w); expect(r.b).toBeLessThanOrEqual(r.h);
    // the bridge button is the anchor: the picker is level with it (or clamped), not with the object button
    const anchor = await page.evaluate(() => { const bb = document.querySelector('.tool-btn[data-tool="bridge"]')!.getBoundingClientRect(), pt = document.getElementById('obj-building-picker')!.getBoundingClientRect(); return { dy: Math.abs(pt.top - Math.max(4, Math.min(bb.top, innerHeight - 120))) }; });
    expect(anchor.dy).toBeLessThan(2);
    await page.focus('#obj-building-picker-grid .bld-card[data-bld-id="Road_Bridge_SENW_1"]');
    await page.evaluate(() => { Selection.setCells([{ col: 225, row: 224 }, { col: 226, row: 224 }, { col: 227, row: 224 }]); });
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => [Tools.getSelectedBridgeId(), Tools.isMoving(), Tools.getActive()])).toEqual(['Road_Bridge_SENW_1', false, 'bridge']);
    expect(await page.evaluate(() => Selection.size())).toBe(3);
    await page.focus('#obj-building-picker-grid .bld-card[data-bld-id="Road_Bridge_NEWS_1"]');
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => Tools.getSelectedBridgeId())).toBe('Road_Bridge_NEWS_1');
    await page.keyboard.press('Escape');
    expect(await display(page)).toBe('none');
    expect(await page.evaluate(() => [Tools.getActive(), Tools.getSelectedBridgeId()])).toEqual(['bridge', 'Road_Bridge_NEWS_1']);
    await page.click('.tool-btn[data-tool="bridge"]');
    expect(await display(page)).toBe('block');
    await page.mouse.click(5, 5);
    expect(await display(page)).toBe('none');
    expect(await page.evaluate(() => Tools.getActive())).toBe('bridge');
  });

  test('Erase Building and the Eraser remove bridge buildings like any object; one step each, undo restores', async ({ page }) => {
    await river(page); await river(page, 230, 224);
    await page.evaluate(() => { objectsData['227,224'] = 'Road_Bridge_NS_1'; objectsData['230,224'] = 'Road_Bridge_NEWS_1'; });
    await useTool(page, 'erase-object');
    let s0 = await undoSize(page);
    await clickCell(page, 227, 224);
    expect(await objs(page)).toEqual({ '230,224': 'Road_Bridge_NEWS_1' });
    expect(await undoSize(page)).toBe(s0 + 1);
    await page.evaluate(() => History.undo());
    expect(await obj(page, '227,224')).toBe('Road_Bridge_NS_1');
    await page.evaluate(() => { Tools.setActive('eraser'); });
    s0 = await undoSize(page);
    await clickCell(page, 230, 224);
    expect(await obj(page, '230,224')).toBe(null);
    expect(await obj(page, '227,224')).toBe('Road_Bridge_NS_1');
    expect(await undoSize(page)).toBe(s0 + 1);
    await page.evaluate(() => History.undo());
    expect(await obj(page, '230,224')).toBe('Road_Bridge_NEWS_1');
  });

  test('a bridge that sits on a non-river tile (stamped / pasted / legacy) renders, survives copy-paste with its id, cannot receive a new bridge from the bridge tool (it can toggle it off) and is removable by Erase Building', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(() => { objectsData['227,224'] = 'Road_Bridge_NS_1'; Canvas.render(); });
    await bridgeTool(page, 'Road_Bridge_NS_1');
    const s0 = await undoSize(page);
    await clickCell(page, 228, 224);                                   // empty land: placing is refused
    expect(await obj(page, '228,224')).toBe(null);
    expect(await undoSize(page)).toBe(s0);
    expect((await toasts(page)).some(t => /river tiles/.test(t))).toBe(true);
    await clickCell(page, 227, 224);                                   // cleanup A4: the same bridge on land is toggled OFF (one step)
    expect(await obj(page, '227,224')).toBe(null);
    expect(await undoSize(page)).toBe(s0 + 1);
    await page.evaluate(() => History.undo());
    expect(await obj(page, '227,224')).toBe('Road_Bridge_NS_1');
    // copy + paste to another land cell keeps the id
    await page.evaluate(() => { Tools.setActive('paint'); Selection.setCells([{ col: 227, row: 224 }]); Tools.copySelection(); Tools.beginPaste(Clipboard.get()); });
    await clickCell(page, 231, 224);
    expect(await obj(page, '231,224')).toBe('Road_Bridge_NS_1');
    expect(await obj(page, '227,224')).toBe('Road_Bridge_NS_1');
    await useTool(page, 'erase-object');
    await clickCell(page, 231, 224);
    expect(await obj(page, '231,224')).toBe(null);
    expect(errors).toEqual([]);
  });

  test('only the left button acts: right, middle and side buttons place nothing', async ({ page }) => {
    await river(page);
    await bridgeTool(page, 'Road_Bridge_NS_1');
    const s0 = await undoSize(page);
    const p = await cellPoint(page, 227, 224);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await page.mouse.down({ button: 'middle' }); await page.mouse.up({ button: 'middle' });
    await ev(page, 'mousedown', 227, 224, { button: 3 }); await ev(page, 'mouseup', 227, 224, { button: 3 });
    await ev(page, 'mousedown', 227, 224, { button: 4 }); await ev(page, 'mouseup', 227, 224, { button: 4 });
    expect(await objs(page)).toEqual({});
    expect(await undoSize(page)).toBe(s0);
    await page.mouse.down(); await page.mouse.up();                    // control: the left button does place it
    expect(await objs(page)).toEqual({ '227,224': 'Road_Bridge_NS_1' });
  });

  test('a bridge goes one tap at a time: dragging from a river tile to another river tile places only the pressed one, in one step', async ({ page }) => {
    await river(page, 227, 224); await river(page, 230, 224);
    await bridgeTool(page, 'Road_Bridge_NS_1');
    const s0 = await undoSize(page);
    await dragCells(page, { col: 227, row: 224 }, { col: 230, row: 224 });
    expect(await objs(page)).toEqual({ '227,224': 'Road_Bridge_NS_1' });
    expect(await undoSize(page)).toBe(s0 + 1);
  });

  test('refusing a land press then dragging over more land toasts once (one refusal per stroke), no step', async ({ page }) => {
    await bridgeTool(page, 'Road_Bridge_NS_1');
    const s0 = await undoSize(page);
    await dragCells(page, { col: 227, row: 224 }, { col: 230, row: 224 });
    expect((await toasts(page)).filter(t => /river tiles/.test(t)).length).toBe(1);
    expect(await undoSize(page)).toBe(s0);
  });

  test('the press is a stroke: isStroking is true while the button is held (undo ignored), Escape rolls the bridge back without a step and keeps the redo stack', async ({ page }) => {
    await river(page);
    await page.evaluate(() => { History.push(); objectsData['300,300'] = 'Artefact_Test_1'; History.undo(); });
    const before = await page.evaluate(() => ({ u: History.undoSize(), r: History.redoSize() }));
    expect(before.r).toBe(1);
    await bridgeTool(page, 'Road_Bridge_NS_1');
    const p = await cellPoint(page, 227, 224);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    expect(await obj(page, '227,224')).toBe('Road_Bridge_NS_1');
    expect(await page.evaluate(() => Tools.isStroking())).toBe(true);
    expect(await page.evaluate(() => History.undoSize())).toBe(before.u + 1);
    await page.evaluate(() => History.undo());                       // ignored mid-stroke
    expect(await obj(page, '227,224')).toBe('Road_Bridge_NS_1');
    await page.keyboard.press('Escape');
    expect(await obj(page, '227,224')).toBe(null);
    expect(await page.evaluate(() => Tools.isStroking())).toBe(false);
    await page.mouse.up();
    expect(await page.evaluate(() => ({ u: History.undoSize(), r: History.redoSize() }))).toEqual(before);
    // and a normal press releases the stroke
    await page.mouse.down(); await page.mouse.up();
    expect(await page.evaluate(() => Tools.isStroking())).toBe(false);
  });

  test('a lost mouse-up, a window blur and a tool switch end the gesture; the step stays', async ({ page }) => {
    await river(page); await river(page, 230, 224);
    await bridgeTool(page, 'Road_Bridge_NS_1');
    const s0 = await undoSize(page);
    const p = await cellPoint(page, 227, 224);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await ev(page, 'mousemove', 228, 224, { buttons: 0 });
    expect(await page.evaluate(() => [Tools.isStrokeActive(), Tools.isStroking()])).toEqual([false, false]);
    await page.mouse.up();
    expect(await undoSize(page)).toBe(s0 + 1);
    const p2 = await cellPoint(page, 230, 224);
    await page.mouse.move(p2.x, p2.y); await page.mouse.down();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect(await page.evaluate(() => [Tools.isStrokeActive(), Tools.isStroking()])).toEqual([false, false]);
    await page.mouse.up();
    expect(await undoSize(page)).toBe(s0 + 2);
    await river(page, 222, 224);
    const p3 = await cellPoint(page, 222, 224);
    await page.mouse.move(p3.x, p3.y); await page.mouse.down();
    expect(await page.evaluate(() => Tools.isStroking())).toBe(true);
    await page.evaluate(() => Tools.setActive('paint'));
    expect(await page.evaluate(() => [Tools.isStrokeActive(), Tools.isStroking()])).toEqual([false, false]);
    await page.mouse.up();
    expect(await undoSize(page)).toBe(s0 + 3);                                  // the press's step stays after the switch
    expect(await objs(page)).toEqual({ '227,224': 'Road_Bridge_NS_1', '230,224': 'Road_Bridge_NS_1', '222,224': 'Road_Bridge_NS_1' });
  });

  test('a map replaced mid-gesture stops the bridge tool with a bridge-specific toast and writes nothing to the new map', async ({ page }) => {
    await river(page);
    await bridgeTool(page, 'Road_Bridge_NS_1');
    const p = await cellPoint(page, 227, 224);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.evaluate(() => { IO.newMap(true); Canvas.centerOnCity(); });
    await page.mouse.move(p.x + 3, p.y + 3, { steps: 2 });
    await page.mouse.up();
    expect(await objs(page)).toEqual({});
    expect(await page.evaluate(() => Tools.isStroking())).toBe(false);
    const t = await toasts(page);
    expect(t.some(x => /bridge tool stopped/i.test(x))).toBe(true);
    expect(t.some(x => /(building|road) tool stopped/i.test(x))).toBe(false);
  });

  test('the tool ignores input while a fill runs', async ({ page }) => {
    await river(page);
    const r = await page.evaluate(async () => {
      UI.selectTerrain('Forest_1');
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect();
      const fire = (t: string, c: number, rw: number) => { const p = Canvas.hexScreenPos(c, rw); cv.dispatchEvent(new MouseEvent(t, { clientX: rc.left + p.x, clientY: rc.top + p.y, button: 0, bubbles: true })); };
      const p = Tools.fill(240, 240);
      const busy = Tools.isFillBusy();
      const before = History.undoSize();
      Tools.setActive('bridge'); Tools.selectBuilding('Road_Bridge_NS_1'); document.getElementById('obj-building-picker')!.style.display = 'none';
      fire('mousedown', 227, 224); fire('mouseup', 227, 224);
      const out = { busy, placed: '227,224' in objectsData, steps: History.undoSize() - before };
      await p;
      return out;
    });
    expect(r).toEqual({ busy: true, placed: false, steps: 0 });
    await clickCell(page, 227, 224);                                   // control: once the fill is done the same click places it
    expect(await obj(page, '227,224')).toBe('Road_Bridge_NS_1');
  });

  test('the bridge is drawn: the canvas differs with and without it; undo and redo are repeatable', async ({ page }) => {
    await river(page);
    await page.evaluate(() => { History.push(); History.undo(); });   // a restore rebuilds every cache from the live river tile
    await bridgeTool(page, 'Road_Bridge_NEWS_1');
    await page.mouse.move(5, 500);
    const raw = () => page.evaluate(() => { Canvas.render(); const cv = document.getElementById('map-canvas') as HTMLCanvasElement; const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data; let h = 0; for (let i = 0; i < d.length; i += 53) h = (h * 31 + d[i]) | 0; return h; });
    // the sprite may still be loading: read until two consecutive renders agree (a count of renders, not a wall-clock wait)
    const hash = async () => { let a = await raw(); for (let n = 0; n < 200; n++) { const b = await raw(); if (a === b) return a; a = b; } throw new Error('canvas never settled'); };
    await clickCell(page, 227, 224);
    await page.mouse.move(5, 500);
    expect(await obj(page, '227,224')).toBe('Road_Bridge_NEWS_1');
    const withBridge = await hash();
    await page.evaluate(() => History.undo());
    const without = await hash();
    expect(without).not.toBe(withBridge);
    await page.evaluate(() => History.redo());
    const redone = await hash();
    expect(redone).not.toBe(without);                 // (the first render after a restore can differ from the live one in unrelated pixels, so compare against `without` only)
    await page.evaluate(() => History.undo());
    expect(await hash()).toBe(without);
    await page.evaluate(() => History.redo());
    expect(await hash()).toBe(redone);
  });
});
