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
    await useTool(page, 'object');
    await page.evaluate(() => Tools.selectBuilding(null as any));
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
});
