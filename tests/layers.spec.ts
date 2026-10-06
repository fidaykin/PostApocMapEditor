import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { freshEditor, clickCell, dragCells, cellPoint } from './editor-helpers';

declare let settlementSlots: any[];

// ── Layer visibility (T2.17) ───────────────────────────────────────────────────────────────────────
// Reference method: a layer hidden must render EXACTLY like a map that never had that layer's data,
// compared on the canvas pixels (toDataURL), at every level of detail. A visible render with the data is
// asserted to DIFFER from the reference so the comparison cannot pass by drawing nothing.

const LEVELS = [0, 1, 2];

/** In-page: render with the given level of detail and return the canvas pixels as a string. */
const SNAP = `window.__snap = (lod) => { Canvas._test.setLod(lod); Canvas.render(); return document.getElementById('map-canvas').toDataURL(); };`;

async function prep(page: any) {
  await freshEditor(page);
  await page.evaluate(SNAP);
  // sprites are loaded asynchronously: wait until every road/bridge image is complete so renders are stable
  await page.waitForFunction(() => UI._bridgeSprites.every((i: any) => i.complete));
  await page.evaluate(() => { Canvas.centerOnCity(); });
}

test.describe('layers: visibility (T2.17)', () => {
  test.beforeEach(async ({ page }) => { await prep(page); });

  test('defaults: five layers, all visible and unlocked; unknown names are visible and ignored', async ({ page }) => {
    const r = await page.evaluate(() => {
      Layers.setVisible('nope', false); Layers.setLocked('nope', true);
      return { names: Layers.NAMES.slice(), vis: Layers.NAMES.map((n: string) => Layers.isVisible(n)),
               lock: Layers.NAMES.map((n: string) => Layers.isLocked(n)), unknown: [Layers.isVisible('nope'), Layers.isLocked('nope')],
               stored: localStorage.getItem('layer_state_v1') };
    });
    expect(r.names).toEqual(['terrain', 'objects', 'roads', 'settlements', 'zones']);
    expect(r.vis).toEqual([true, true, true, true, true]);
    expect(r.lock).toEqual([false, false, false, false, false]);
    expect(r.unknown).toEqual([true, false]);
    expect(r.stored === null || !r.stored.includes('nope')).toBe(true);
  });

  // one scene per layer: add that layer's data
  const SCENES: Record<string, string> = {
    roads: `roadsData['226,224'] = { type: 'road_hex' }; roadsData['227,224'] = { type: 'road_hex' }; roadsData['227,225'] = { type: 'road_hex' };`,
    objects: `objectsData['226,225'] = 'Grain_1'; bridgesData.push({ col: 228, row: 224, axis: 0 });`,
    settlements: ``,   // handled in the test body: settlements is a top-level let
    zones: `const id = ZonePainter.addZone('t', '#ff0000'); const zl = ZonePainter.getZoneLayer(); zl[224 * MAP_WIDTH + 226] = id; zl[225 * MAP_WIDTH + 226] = id;`,
  };
  const REMOVE: Record<string, string> = {
    roads: `delete roadsData['226,224']; delete roadsData['227,224']; delete roadsData['227,225'];`,
    objects: `delete objectsData['226,225']; bridgesData.length = 0;`,
    settlements: ``,
    zones: `ZonePainter.getZoneLayer().fill(0);`,
  };

  for (const layer of Object.keys(SCENES)) {
    test(`hiding "${layer}" renders exactly like a map without that data (lod 0, 1, 2)`, async ({ page }) => {
      const r = await page.evaluate(([name, add, rm, levels]) => {
        const run = (code: string) => new Function('roadsData', 'objectsData', 'bridgesData', 'ZonePainter', 'MAP_WIDTH', code)
          (roadsData, objectsData, bridgesData, ZonePainter, MAP_WIDTH);
        const out: any[] = [];
        for (const lod of levels as number[]) {
          let reference: string, shown: string, hidden: string, restored: string;
          if (name === 'settlements') {
            // the city marker is a settlement: the reference is a map with no settlements at all
            const full = settlements.slice(); settlements.push({ col: 224, row: 226, type: 'settlement' });
            const withAll = settlements.slice();
            settlements.length = 0; reference = (window as any).__snap(lod);
            withAll.forEach(x => settlements.push(x)); shown = (window as any).__snap(lod);
            Layers.setVisible(name, false); hidden = (window as any).__snap(lod);
            Layers.setVisible(name, true); restored = (window as any).__snap(lod);
            settlements.length = 0; full.forEach(x => settlements.push(x));
            out.push({ lod, shownDiffers: shown !== reference, hiddenEqualsReference: hidden === reference, restored: restored === shown });
            continue;
          }
          reference = (window as any).__snap(lod);        // the layer's data never existed
          run(add as string);
          shown = (window as any).__snap(lod);
          Layers.setVisible(name, false);
          hidden = (window as any).__snap(lod);
          Layers.setVisible(name, true);
          run(rm as string);
          out.push({ lod, shownDiffers: shown !== reference, hiddenEqualsReference: hidden === reference, restored: (window as any).__snap(lod) === reference });
        }
        return out;
      }, [layer, SCENES[layer], REMOVE[layer], LEVELS]);
      // every level of detail must show a difference when the layer is visible (a vacuous 'nothing drawn' pass is impossible)
      for (const x of r) {
        expect(x.hiddenEqualsReference, `lod ${x.lod} hidden`).toBe(true);
        expect(x.restored, `lod ${x.lod} restored`).toBe(true);
        expect(x.shownDiffers, `lod ${x.lod} visible differs`).toBe(true);
      }
    });
  }

  test('hiding "settlements" also hides the slot distance rings (lod 0, 1, 2)', async ({ page }) => {
    const r = await page.evaluate((levels) => {
      const savedSlots = settlementSlots, savedSettlements = settlements.slice();
      settlements.length = 0;
      const out: any[] = [];
      for (const lod of levels as number[]) {
        settlementSlots = [];
        const reference = (window as any).__snap(lod);
        settlementSlots = [{ minDist: 4, maxDist: 6, count: 1, type: 'settlement' }];
        const shown = (window as any).__snap(lod);
        Layers.setVisible('settlements', false);
        const hidden = (window as any).__snap(lod);
        Layers.setVisible('settlements', true);
        out.push({ lod, shownDiffers: shown !== reference, hiddenEqualsReference: hidden === reference });
      }
      settlementSlots = savedSlots; savedSettlements.forEach(x => settlements.push(x));
      return out;
    }, LEVELS);
    for (const x of r) expect(x, `lod ${x.lod}`).toEqual({ lod: x.lod, shownDiffers: true, hiddenEqualsReference: true });
  });

  test('hiding "terrain" renders the same whatever the terrain is (lod 0, 1, 2) and differs when shown', async ({ page }) => {
    const r = await page.evaluate((levels) => {
      const out: any[] = [];
      for (const lod of levels as number[]) {
        mapData.fill('Plain_1');
        for (let c = 222; c < 232; c++) for (let rw = 220; rw < 230; rw++) mapData[rw * MAP_WIDTH + c] = (c + rw) % 3 ? 'Water_1' : 'Forest_1';
        const shownA = (window as any).__snap(lod);
        Layers.setVisible('terrain', false);
        const hiddenA = (window as any).__snap(lod);
        Layers.setVisible('terrain', true);
        mapData.fill('Plain_1');
        const shownB = (window as any).__snap(lod);
        Layers.setVisible('terrain', false);
        const hiddenB = (window as any).__snap(lod);
        Layers.setVisible('terrain', true);
        out.push({ lod, shownDiffers: shownA !== shownB, hiddenSame: hiddenA === hiddenB, hiddenDiffersFromShown: hiddenA !== shownA });
      }
      return out;
    }, LEVELS);
    for (const x of r) expect(x, `lod ${x.lod}`).toEqual({ lod: x.lod, shownDiffers: true, hiddenSame: true, hiddenDiffersFromShown: true });
  });

  test('hidden terrain keeps the other layers: a road still draws over the flat fill', async ({ page }) => {
    const r = await page.evaluate(() => {
      Layers.setVisible('terrain', false);
      const bare = (window as any).__snap(0);
      roadsData['226,224'] = { type: 'road_hex' };
      const withRoad = (window as any).__snap(0);
      delete roadsData['226,224'];
      Layers.setVisible('terrain', true);
      return withRoad !== bare;
    });
    expect(r).toBe(true);
  });

  test('every layer hidden at once equals an empty map; showing them all restores the original frame', async ({ page }) => {
    const r = await page.evaluate(() => {
      roadsData['226,224'] = { type: 'road_hex' }; objectsData['226,225'] = 'Grain_1';
      const original = (window as any).__snap(0);
      Layers.NAMES.forEach((n: string) => Layers.setVisible(n, false));
      const allHidden = (window as any).__snap(0);
      delete roadsData['226,224']; delete objectsData['226,225'];
      const emptyHidden = (window as any).__snap(0);
      Layers.NAMES.forEach((n: string) => Layers.setVisible(n, true));
      roadsData['226,224'] = { type: 'road_hex' }; objectsData['226,225'] = 'Grain_1';
      return { hiddenSame: allHidden === emptyHidden, restored: (window as any).__snap(0) === original, differs: original !== allHidden };
    });
    expect(r).toEqual({ hiddenSame: true, restored: true, differs: true });
  });

  test('rendering cost: with every layer visible one frame asks Layers a handful of times, never per cell', async ({ page }) => {
    const r = await page.evaluate(() => {
      const orig = Layers.isVisible;
      let n = 0;
      Layers.isVisible = (x: string) => { n++; return orig(x); };
      Canvas.render(); const near = n; const tilesNear = Canvas.getStats().tilesDrawn;
      Canvas.setZoom(30); n = 0; Canvas.render(); const far = n; const tilesFar = Canvas.getStats().tilesDrawn;
      Layers.isVisible = orig;
      return { near, far, tilesNear, tilesFar };
    });
    expect(r.tilesFar).toBeGreaterThan(r.tilesNear * 3);   // more cells in view, same number of layer checks
    expect(r.near).toBeLessThanOrEqual(8);
    expect(r.far).toBe(r.near);
  });

  test('the minimap does not depend on layer visibility (it is a terrain overview)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const mm = () => { Canvas.drawMinimap(); return (document.getElementById('minimap') as HTMLCanvasElement).toDataURL(); };
      const a = mm();
      Layers.NAMES.forEach((n: string) => Layers.setVisible(n, false));
      const b = mm();
      Layers.NAMES.forEach((n: string) => Layers.setVisible(n, true));
      return a === b;
    });
    expect(r).toBe(true);
  });

  test('toggling is a view setting: no history step, no autosave, not in the map data', async ({ page }) => {
    const r = await page.evaluate(() => {
      let saves = 0;
      const orig = IO.scheduleAutoSave;
      IO.scheduleAutoSave = (...a: any[]) => { saves++; return orig(...a); };
      const steps = History.undoSize(), redo = History.redoSize();
      const md = mapData, mdCopy = mapData.slice();
      Layers.NAMES.forEach((n: string) => { Layers.setVisible(n, false); Layers.setVisible(n, true); Layers.setLocked(n, true); Layers.setLocked(n, false); });
      Layers.setVisible('roads', false);
      const out = { stepsSame: History.undoSize() === steps, redoSame: History.redoSize() === redo, saves, sameArray: md === mapData,
                    sameData: mapData.every((v: string, i: number) => v === mdCopy[i]),
                    inAutosaveKeys: Object.keys(localStorage).filter(k => k !== 'layer_state_v1').some(k => (localStorage.getItem(k) || '').includes('layer_state')) };
      IO.scheduleAutoSave = orig;
      Layers.setVisible('roads', true);
      return out;
    });
    expect(r).toEqual({ stepsSame: true, redoSame: true, saves: 0, sameArray: true, sameData: true, inAutosaveKeys: false });
  });

  test('hover shows only coordinates, so hidden layers leak nothing through the status bar', async ({ page }) => {
    await page.evaluate(() => { roadsData['226,224'] = { type: 'road_hex' }; Layers.setVisible('roads', false); Canvas.render(); });
    const box = await page.evaluate(() => { const p = Canvas.hexScreenPos(226, 224); const b = document.getElementById('map-canvas')!.getBoundingClientRect(); return { x: b.left + p.x, y: b.top + p.y }; });
    await page.mouse.move(box.x, box.y);
    const status = () => page.evaluate(() => document.getElementById('statusbar')!.textContent || '');
    expect(await page.evaluate(() => document.getElementById('st-tile')!.textContent)).toBe('226, 224');
    const hidden = await status();
    // positive control: the status bar text really is read (it contains the hovered coordinates) ...
    expect(hidden).toContain('226, 224');
    // ... and with the road layer visible again the very same text comes out, so nothing depends on layer content
    await page.evaluate(() => { Layers.setVisible('roads', true); });
    await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.move(box.x, box.y);
    expect(await status()).toBe(hidden);
  });
});

test.describe('layers: persistence (T2.17)', () => {
  test('panel eye buttons toggle layers and the state survives a reload', async ({ page }) => {
    await freshEditor(page);
    await page.click('.layer-row[data-layer="objects"] .layer-eye');
    expect(await page.evaluate(() => Layers.isVisible('objects'))).toBe(false);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('layer_state_v1')!).objects.visible)).toBe(false);
    await page.reload();
    await openEditor(page);
    expect(await page.evaluate(() => Layers.isVisible('objects'))).toBe(false);
    expect(await page.evaluate(() => Layers.isVisible('terrain'))).toBe(true);
    await expect(page.locator('.layer-row[data-layer="objects"] .layer-eye')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.layer-row[data-layer="terrain"] .layer-eye')).toHaveAttribute('aria-pressed', 'true');
  });

  test('lock state is stored too (enforcement belongs to T2.18)', async ({ page }) => {
    await freshEditor(page);
    await page.click('.layer-row[data-layer="roads"] .layer-lock');
    expect(await page.evaluate(() => Layers.isLocked('roads'))).toBe(true);
    await expect(page.locator('.layer-row[data-layer="roads"] .layer-lock')).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await openEditor(page);
    expect(await page.evaluate(() => Layers.isLocked('roads'))).toBe(true);
    expect(await page.evaluate(() => Layers.isLocked('terrain'))).toBe(false);
  });

  const BAD: Record<string, string> = {
    'corrupt JSON': '{not json',
    'JSON null': 'null',
    'an array': '[1,2,3]',
    'a number': '42',
    'wrong value types': JSON.stringify({ terrain: 5, objects: 'x', roads: [], settlements: null }),
  };
  for (const [label, raw] of Object.entries(BAD)) {
    test(`saved state that is ${label} is ignored: everything visible, nothing locked`, async ({ page }) => {
      await page.addInitScript((v) => { localStorage.setItem('layer_state_v1', v); }, raw);
      await openEditor(page);
      const r = await page.evaluate(() => ({ vis: Layers.NAMES.map((n: string) => Layers.isVisible(n)), lock: Layers.NAMES.map((n: string) => Layers.isLocked(n)) }));
      expect(r.vis).toEqual([true, true, true, true, true]);
      expect(r.lock).toEqual([false, false, false, false, false]);
    });
  }

  test('unknown layer names in storage are ignored, known ones are kept', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('layer_state_v1', JSON.stringify({ roads: { visible: false, locked: true }, ghosts: { visible: false, locked: true }, terrain: { visible: true }, objects: { locked: true } }));
    });
    await openEditor(page);
    const r = await page.evaluate(() => ({ roads: [Layers.isVisible('roads'), Layers.isLocked('roads')], terrain: Layers.isVisible('terrain'), objects: [Layers.isVisible('objects'), Layers.isLocked('objects')],
                                           names: Layers.NAMES.slice(), rows: document.querySelectorAll('#layers-panel .layer-row').length }));
    expect(r).toEqual({ roads: [false, true], terrain: true, objects: [true, true], names: ['terrain', 'objects', 'roads', 'settlements', 'zones'], rows: 5 });
  });

  test('blocked storage: the page still starts with every layer visible and toggling does not throw', async ({ page }) => {
    await page.addInitScript(() => {
      const boom = () => { throw new DOMException('blocked', 'SecurityError'); };
      const realSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) { if (k === 'layer_state_v1') boom(); return realSet.call(this, k, v); } as any;
      const realGet = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k: string) { if (k === 'layer_state_v1') boom(); return realGet.call(this, k); } as any;
    });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await openEditor(page);
    expect(await page.evaluate(() => Layers.NAMES.map((n: string) => Layers.isVisible(n)))).toEqual([true, true, true, true, true]);
    await page.click('.layer-row[data-layer="roads"] .layer-eye');
    expect(await page.evaluate(() => Layers.isVisible('roads'))).toBe(false);   // works in memory for this session
    expect(errors).toEqual([]);
  });
});

test.describe('layers: panel (T2.17)', () => {
  test.beforeEach(async ({ page }) => { await prep(page); });

  test('five rows in the left palette with real buttons, aria-pressed and tooltips', async ({ page }) => {
    const r = await page.evaluate(() => {
      const panel = document.getElementById('layers-panel')!;
      return { inPalette: !!panel.closest('#palette-panel'), inRight: !!panel.closest('#right-panel'),
               rows: Array.from(panel.querySelectorAll('.layer-row')).map((row: any) => ({
                 layer: row.dataset.layer,
                 eye: [row.querySelector('.layer-eye').tagName, row.querySelector('.layer-eye').getAttribute('aria-pressed'), !!row.querySelector('.layer-eye').title, !!row.querySelector('.layer-eye').getAttribute('aria-label')],
                 lock: [row.querySelector('.layer-lock').tagName, row.querySelector('.layer-lock').getAttribute('aria-pressed'), !!row.querySelector('.layer-lock').title, !!row.querySelector('.layer-lock').getAttribute('aria-label')] })) };
    });
    expect(r.inPalette).toBe(true);
    expect(r.inRight).toBe(false);
    expect(r.rows.map((x: any) => x.layer)).toEqual(['terrain', 'objects', 'roads', 'settlements', 'zones']);
    for (const x of r.rows) {
      expect(x.eye).toEqual(['BUTTON', 'true', true, true]);
      expect(x.lock).toEqual(['BUTTON', 'false', true, true]);
    }
  });

  test('keyboard: Space and Enter on a focused eye toggle it, keep focus and do not pan or lift', async ({ page }) => {
    const eye = page.locator('.layer-row[data-layer="roads"] .layer-eye');
    const cursor = () => page.evaluate(() => (document.getElementById('map-canvas') as HTMLElement).style.cursor);
    await page.evaluate(() => { Selection.setCells([{ col: 225, row: 224 }]); });
    await eye.focus();
    await page.keyboard.down('Space');
    expect(await cursor()).not.toBe('grab');          // the global Space-pan handler never saw the key
    await page.keyboard.up('Space');
    expect(await page.evaluate(() => Layers.isVisible('roads'))).toBe(false);
    await expect(eye).toHaveAttribute('aria-pressed', 'false');
    await expect(eye).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => Layers.isVisible('roads'))).toBe(true);
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => Tools.isPasting() || Tools.isMoving())).toBe(false);   // Enter did not lift the selection
  });

  for (const which of ['eye', 'lock']) {
    test(`a pointer click on the ${which} button hands the focus back: Space pans again`, async ({ page }) => {
      await page.click(`.layer-row[data-layer="roads"] .layer-${which}`);
      expect(await page.evaluate(() => !document.activeElement!.closest('#layers-panel'))).toBe(true);
      await page.keyboard.down('Space');
      expect(await page.evaluate(() => (document.getElementById('map-canvas') as HTMLElement).style.cursor)).toBe('grab');
      await page.keyboard.up('Space');
      await page.keyboard.press('KeyF');
      expect(await page.evaluate(() => Tools.getActive())).toBe('fill');
    });
  }

  test('toggling during a stroke does not disturb it; the stroke still ends as one step', async ({ page }) => {
    const r = await page.evaluate(async () => {
      UI.selectTerrain('Water_1'); Tools.setActive('eraser'); Tools.setActive('paint');
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect();
      const fire = (t: string, c: number, rw: number) => { const p = Canvas.hexScreenPos(c, rw); cv.dispatchEvent(new MouseEvent(t, { clientX: rc.left + p.x, clientY: rc.top + p.y, button: 0, buttons: t === 'mouseup' ? 0 : 1, bubbles: true })); };
      const before = History.undoSize();
      fire('mousedown', 226, 224);
      const active1 = Tools.isStrokeActive();
      Layers.setVisible('roads', false); Layers.setVisible('terrain', false); Layers.setVisible('terrain', true);
      const active2 = Tools.isStrokeActive();
      fire('mousemove', 227, 224); fire('mousemove', 228, 224);
      fire('mouseup', 228, 224);
      Layers.setVisible('roads', true);
      return { active1, active2, steps: History.undoSize() - before, painted: ['226,224', '227,224', '228,224'].map(k => { const [c, rw] = k.split(',').map(Number); return mapData[rw * MAP_WIDTH + c]; }) };
    });
    expect(r.active1).toBe(true);
    expect(r.active2).toBe(true);
    expect(r.steps).toBe(1);
    expect(r.painted).toEqual(['Water_1', 'Water_1', 'Water_1']);
  });

  test('toggling while a fill runs works and the fill still completes', async ({ page }) => {
    const r = await page.evaluate(async () => {
      mapData.fill('Plain_1');
      UI.selectTerrain('Forest_1'); Tools.setActive('fill');
      const p = Tools.fill(225, 225);
      const busy = Tools.isFillBusy();
      Layers.setVisible('roads', false); Layers.setVisible('terrain', false);
      const stillBusy = Tools.isFillBusy();
      Layers.setVisible('terrain', true); Layers.setVisible('roads', true);
      await p;
      return { busy, stillBusy, forest: mapData.filter((x: string) => x === 'Forest_1').length, busyAfter: Tools.isFillBusy() };
    });
    expect(r.busy).toBe(true);
    expect(r.stillBusy).toBe(true);
    expect(r.forest).toBe(450 * 450);
    expect(r.busyAfter).toBe(false);
  });

  test('no new keyboard shortcuts: letters and brackets still do what they did', async ({ page }) => {
    const before = await page.evaluate(() => Layers.NAMES.map((n: string) => Layers.isVisible(n) + ':' + Layers.isLocked(n)).join());
    for (const k of ['KeyL', 'KeyV', 'KeyI', 'KeyK', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']) await page.keyboard.press(k);
    expect(await page.evaluate(() => Layers.NAMES.map((n: string) => Layers.isVisible(n) + ':' + Layers.isLocked(n)).join())).toBe(before);
  });
});

test.describe('layers: zone overlay stays in sync with the Zone Painter control (T2.17)', () => {
  test.beforeEach(async ({ page }) => { await prep(page); });

  test('the panel eye drives ZonePainter and its own button', async ({ page }) => {
    await page.click('.layer-row[data-layer="zones"] .layer-eye');
    const r = await page.evaluate(() => ({ painter: ZonePainter.isOverlayVisible(), layer: Layers.isVisible('zones'), btn: document.getElementById('btn-zone-overlay')!.style.opacity }));
    expect(r).toEqual({ painter: false, layer: false, btn: '0.4' });
    await page.click('.layer-row[data-layer="zones"] .layer-eye');
    expect(await page.evaluate(() => ({ painter: ZonePainter.isOverlayVisible(), layer: Layers.isVisible('zones'), btn: document.getElementById('btn-zone-overlay')!.style.opacity }))).toEqual({ painter: true, layer: true, btn: '1' });
  });

  test('the Zone Painter overlay button drives the panel row and the persisted state', async ({ page }) => {
    await page.click('#btn-zone-overlay');
    expect(await page.evaluate(() => Layers.isVisible('zones'))).toBe(false);
    await expect(page.locator('.layer-row[data-layer="zones"] .layer-eye')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('layer_state_v1')!).zones.visible)).toBe(false);
    await page.click('#btn-zone-overlay');
    expect(await page.evaluate(() => Layers.isVisible('zones'))).toBe(true);
    await expect(page.locator('.layer-row[data-layer="zones"] .layer-eye')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Layers.setVisible("zones") and ZonePainter.toggleOverlay() agree after any sequence', async ({ page }) => {
    const r = await page.evaluate(() => {
      const seq: boolean[] = [];
      const snap = () => seq.push(Layers.isVisible('zones') === ZonePainter.isOverlayVisible());
      Layers.setVisible('zones', false); snap();
      Layers.setVisible('zones', false); snap();
      ZonePainter.toggleOverlay(); Layers.sync(); snap();
      Layers.setVisible('zones', true); snap();
      return { seq, final: Layers.isVisible('zones') };
    });
    expect(r.seq).toEqual([true, true, true, true]);
    expect(r.final).toBe(true);
  });

  test('a persisted hidden zone overlay is applied to the painter after a reload', async ({ page }) => {
    await page.click('.layer-row[data-layer="zones"] .layer-eye');
    await page.reload();
    await openEditor(page);
    const r = await page.evaluate(() => ({ painter: ZonePainter.isOverlayVisible(), layer: Layers.isVisible('zones'), btn: document.getElementById('btn-zone-overlay')!.style.opacity }));
    expect(r).toEqual({ painter: false, layer: false, btn: '0.4' });
  });
});

test.describe('layers: the palette stays reachable (T2.17)', () => {
  for (const vp of [{ width: 1400, height: 900 }, { width: 1100, height: 700 }]) {
    test(`at ${vp.width}x${vp.height} every palette control can be scrolled into view and the canvas keeps its size`, async ({ page }) => {
      await page.setViewportSize(vp);
      await openEditor(page);
      for (const sel of ['#btn-add-zone', '#stamp-save-btn', '#stamp-export-btn', '#stamp-import-btn', '#layers-panel .layer-row[data-layer="terrain"] .layer-eye',
                         '#layers-panel .layer-row[data-layer="zones"] .layer-lock']) {
        await page.locator(sel).scrollIntoViewIfNeeded();
        const ok = await page.evaluate((s) => {
          const e = document.querySelector(s)!.getBoundingClientRect(), p = document.getElementById('palette-panel')!.getBoundingClientRect();
          return e.width > 0 && e.top >= p.top - 0.5 && e.bottom <= p.bottom + 0.5;
        }, sel);
        expect(ok, sel).toBe(true);
      }
      if (vp.width === 1400) {
        const size = await page.evaluate(() => { const c = document.getElementById('map-canvas') as HTMLCanvasElement; return [c.width, c.height]; });
        expect(size).toEqual([1491, 808]);
      }
    });
  }
});

// ── T2.17 review follow-ups ────────────────────────────────────────────────────────────────────────
test.describe('layers: review fixes after T2.17', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('picking the Settlement tool while the Settlements layer is hidden shows the layer, so a placed settlement is visible', async ({ page }) => {
    await page.evaluate(() => { Layers.setVisible('settlements', false); });
    expect(await page.evaluate(() => Layers.isVisible('settlements'))).toBe(false);
    await page.evaluate(() => Tools.setActive('settlement'));
    expect(await page.evaluate(() => Layers.isVisible('settlements'))).toBe(true);
    await expect(page.locator('#toast-container')).toContainText('Settlements layer shown');
    await clickCell(page, 230, 224);
    expect(await page.evaluate(() => settlements.some((s: any) => s.col === 230 && s.row === 224))).toBe(true);
    // the marker is really drawn: the cell centre differs from the same render with the layer hidden
    const px = await page.evaluate(() => {
      const p = Canvas.hexScreenPos(230, 224), c = (document.getElementById('map-canvas') as HTMLCanvasElement).getContext('2d')!;
      const grab = () => Array.from(c.getImageData(Math.round(p.x) - 12, Math.round(p.y) - 12, 24, 24).data).join(',');
      Canvas.render(); const shown = grab();
      Layers.setVisible('settlements', false); Canvas.render(); const hid = grab();
      Layers.setVisible('settlements', true);
      return shown !== hid;
    });
    expect(px).toBe(true);
  });

  test('Auto-place settlements while the Settlements layer is hidden shows the layer', async ({ page }) => {
    await page.evaluate(() => {
      settlementSlots.length = 0;
      settlementSlots.push({ minDist: 10, maxDist: 20, count: 1, type: 'settlement', tapMultiplier: 1, level: 1, minSpacing: 2, nearPct: 20, midPct: 30, farPct: 50 });
      Layers.setVisible('settlements', false);
      autoPlaceSettlements();
    });
    expect(await page.evaluate(() => settlements.filter((s: any) => s.type !== 'city').length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => Layers.isVisible('settlements'))).toBe(true);
    await expect(page.locator('#toast-container')).toContainText('Settlements layer shown');
  });

  test('a visible Settlements layer is left alone by the Settlement tool (no toast)', async ({ page }) => {
    await page.evaluate(() => { Tools.setActive('settlement'); });
    await expect(page.locator('#toast-container')).not.toContainText('Settlements layer shown');
  });

  test('the zone-painter random fill keeps the Layers row and the stored state in step', async ({ page }) => {
    await page.evaluate(() => { Layers.setVisible('zones', false); });
    await expect(page.locator('.layer-row[data-layer="zones"] .layer-eye')).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => ZonePainter._randomizeFillUI());
    expect(await page.evaluate(() => Layers.isVisible('zones'))).toBe(true);
    await expect(page.locator('.layer-row[data-layer="zones"] .layer-eye')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('layer_state_v1')!).zones.visible)).toBe(true);
  });
});

// ── Layer locks (T2.18) ────────────────────────────────────────────────────────────────────────────
// A locked layer is never written by any user-facing writer. Reference method: the WHOLE map state (terrain, buildings, roads,
// bridges, extras, zones, settlements, slots, zone list) is serialised before and after; a refused action must leave it
// string-equal, push no History step and leave no stroke state. Every refusal has a positive control (the same gesture with the
// layer unlocked changes the map by exactly one step) and a wrong-layer control (every OTHER layer locked: it still works).

const SNAPFN = `window.__lockSnap = () => JSON.stringify({ m: mapData.join('|'), o: objectsData, r: roadsData, b: bridgesData, x: tileExtras,
  z: Array.from(ZonePainter.getZoneLayer()).join(''), s: settlements, sl: settlementSlots, zs: ZonePainter.getZones() });`;
const SPY = `window.__toasts = []; if (!UI.__spied) { UI.__spied = true; const t = UI.toast; UI.toast = (m, o) => { window.__toasts.push(String(m)); return t.call(UI, m, o); }; }`;

async function lockEditor(page: any) {
  await freshEditor(page);
  await page.evaluate(SNAPFN);
  await page.evaluate(SPY);
  await page.waitForFunction(() => UI._bridgeSprites.every((i: any) => i.complete));
}
const snap = (page: any): Promise<string> => page.evaluate(() => (window as any).__lockSnap());
const steps = (page: any): Promise<number> => page.evaluate(() => History.undoSize());
const toastLog = (page: any): Promise<string[]> => page.evaluate(() => (window as any).__toasts.slice());
const lockedToasts = async (page: any) => (await toastLog(page)).filter(t => /locked/i.test(t));
const unlockAll = (page: any) => page.evaluate(() => Layers.NAMES.forEach((n: string) => Layers.setLocked(n, false)));
const setLocks = (page: any, names: string[], on = true) => page.evaluate(([n, v]: any) => n.forEach((x: string) => Layers.setLocked(x, v)), [names, on]);
/** A fresh blank map with no locks, the Paint tool and a clean toast log (History is cleared by New Map). */
async function resetMap(page: any) {
  await page.evaluate(() => {
    Layers.NAMES.forEach((n: string) => Layers.setLocked(n, false));
    IO.newMap(true); Tools.setActive('paint'); Brush.setSize(0); UI.selectTerrain('Plain_1'); Canvas.centerOnCity();
    (window as any).__toasts = [];
  });
}
const cellId = (page: any, c: number, r: number): Promise<string> => page.evaluate(([c, r]: any) => mapData[r * MAP_WIDTH + c], [c, r]);
const hidePickerL = (page: any) => page.evaluate(() => { document.getElementById('obj-building-picker')!.style.display = 'none'; });

type Scenario = { name: string; tool: string; layer: string; prep: string; act: (p: any) => Promise<void> };
const CELL = { col: 228, row: 224 };
const click = (p: any, c = CELL) => clickCell(p, c.col, c.row);
const SCENARIOS: Scenario[] = [
  { name: 'Paint', tool: 'paint', layer: 'terrain', prep: `UI.selectTerrain('Water_1'); Tools.setActive('paint');`, act: p => click(p) },
  { name: 'Paint in bridge mode (edits the bridge overlay)', tool: 'paint', layer: 'objects', prep: `mapData[224 * MAP_WIDTH + 228] = 'River_L_1'; UI.selectBridge(0); Tools.setActive('paint');`, act: p => click(p) },
  { name: 'Fill', tool: 'fill', layer: 'terrain', prep: `UI.selectTerrain('Water_1'); Tools.setActive('fill');`, act: async p => { await click(p); await p.evaluate(() => Tools.whenIdle()); } },
  { name: 'Rectangle', tool: 'rect', layer: 'terrain', prep: `UI.selectTerrain('Water_1'); Tools.setActive('rect');`, act: p => dragCells(p, CELL, { col: 230, row: 226 }) },
  { name: 'Line', tool: 'line', layer: 'terrain', prep: `UI.selectTerrain('Water_1'); Tools.setActive('line');`, act: p => dragCells(p, CELL, { col: 230, row: 225 }) },
  { name: 'Circle', tool: 'circle', layer: 'terrain', prep: `UI.selectTerrain('Water_1'); Tools.setActive('circle');`, act: p => dragCells(p, CELL, { col: 230, row: 224 }) },
  { name: 'Polygon', tool: 'polygon', layer: 'terrain', prep: `UI.selectTerrain('Water_1'); Tools.setActive('polygon');`, act: async p => {
      for (const v of [{ col: 228, row: 224 }, { col: 230, row: 224 }, { col: 229, row: 227 }]) await click(p, v);
      await p.keyboard.press('Enter'); } },
  { name: 'Scatter', tool: 'scatter', layer: 'terrain', prep: `UI.selectTerrain('Forest_1'); Tools.setActive('scatter'); document.getElementById('scatter-density').value = '100'; document.getElementById('scatter-seed').value = '4242';`, act: p => click(p) },
  { name: 'Eraser', tool: 'eraser', layer: 'terrain', prep: `mapData[224 * MAP_WIDTH + 228] = 'Water_1'; Tools.setActive('eraser');`, act: p => click(p) },
  { name: 'Replace tool', tool: 'replace', layer: 'terrain', prep: `mapData[224 * MAP_WIDTH + 228] = 'Water_1'; UI.selectTerrain('Plain_1'); Tools.setActive('replace');`, act: p => click(p) },
  { name: 'Place Building', tool: 'object', layer: 'objects', prep: `Tools.setActive('object'); Tools.selectBuilding('Artefact_Test_1');`, act: async p => { await hidePickerL(p); await click(p); } },
  { name: 'Erase Building', tool: 'erase-object', layer: 'objects', prep: `objectsData['228,224'] = 'Artefact_Test_1'; Tools.setActive('erase-object');`, act: p => click(p) },
  { name: 'Place Bridge', tool: 'bridge', layer: 'objects', prep: `mapData[224 * MAP_WIDTH + 228] = 'River_L_1'; Tools.setActive('bridge'); Tools.selectBuilding('Road_Bridge_NEWS_1');`, act: async p => { await hidePickerL(p); await click(p); } },
  { name: 'Draw Road', tool: 'road', layer: 'roads', prep: `Tools.setActive('road');`, act: async p => { const n = await p.evaluate(() => Roads.getNeighbors(225, 224)[0]); await clickCell(p, n.col, n.row); } },
  { name: 'Connect Road', tool: 'road-connect', layer: 'roads', prep: `Tools.setActive('road-connect');`, act: async p => { await click(p); await click(p, { col: 230, row: 224 }); } },
  { name: 'Erase Road', tool: 'erase-road', layer: 'roads', prep: `roadsData['228,224'] = { type: 'road_hex' }; Tools.setActive('erase-road');`, act: p => click(p) },
  { name: 'Place Settlement', tool: 'settlement', layer: 'settlements', prep: `Tools.setActive('settlement');`, act: p => click(p) },
  { name: 'Erase Settlement', tool: 'erase', layer: 'settlements', prep: `settlements.push({ col: 228, row: 224, type: 'settlement' }); Tools.setActive('erase');`, act: p => click(p) },
  { name: 'Zone Painter', tool: 'zone', layer: 'zones', prep: `const zid = ZonePainter.addZone('Z'); ZonePainter.setSelectedZoneId(zid); Tools.setActive('zone');`, act: p => click(p) },
];

test.describe('layers: locks gate every tool (T2.18)', () => {
  test.beforeEach(async ({ page }) => { await lockEditor(page); });

  test('inventory: every registered tool is a writer with a layer or an explicit non-writer; no tool is in both', async ({ page }) => {
    const inv = await page.evaluate(() => {
      const t = Tools.toolLayers();
      const dom = Array.from(document.querySelectorAll('.tool-btn[data-tool]')).map((b: any) => b.dataset.tool);
      return { map: t.map, non: t.nonWriting, names: t.registered, dom, code: t.codeTools, layers: Layers.NAMES };
    });
    const all = new Set<string>([...inv.names, ...inv.dom, ...inv.code]);
    expect(all.size).toBeGreaterThan(20);                                        // the registry is really read
    for (const name of all) {
      const writer = name in inv.map, non = inv.non.includes(name);
      expect(writer !== non, `tool "${name}" must be in exactly one of TOOL_LAYER / NON_WRITING_TOOLS`).toBe(true);
    }
    for (const [tool, layer] of Object.entries(inv.map)) expect(inv.layers, `layer of ${tool}`).toContain(layer as string);
    for (const name of inv.non) expect(all.has(name), `non-writer ${name} is a registered tool`).toBe(true);
    // every writer is exercised by the behaviour matrix below (a new writer must add a scenario)
    for (const tool of Object.keys(inv.map)) expect(SCENARIOS.some(s => s.tool === tool), `a scenario for ${tool}`).toBe(true);
    for (const s of SCENARIOS) expect(inv.map[s.tool] === s.layer || s.tool === 'paint', `scenario ${s.name} layer`).toBe(true);
  });

  test('the non-writing tools never refuse and never write, even with every layer locked', async ({ page }) => {
    await setLocks(page, ['terrain', 'objects', 'roads', 'settlements', 'zones']);
    const before = await snap(page), s0 = await steps(page);
    for (const tool of ['eye', 'select', 'marquee']) {
      await page.evaluate((t: string) => Tools.setActive(t), tool);
      await click(page);
      await dragCells(page, CELL, { col: 230, row: 226 });
    }
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect(await lockedToasts(page)).toEqual([]);
    // the same gesture with a writer: refused (positive control that the locks are really on)
    await page.evaluate(() => { UI.selectTerrain('Water_1'); Tools.setActive('paint'); });
    await click(page);
    expect((await lockedToasts(page)).length).toBe(1);
  });

  for (const sc of SCENARIOS) {
    test(`${sc.name}: refused on a locked ${sc.layer} layer, works with it unlocked, unaffected by every other lock`, async ({ page }) => {
      const run = async (locked: string[]) => {
        await resetMap(page);
        await page.evaluate(`(() => { ${sc.prep} })()`);
        await setLocks(page, locked);
        const before = await snap(page), s0 = await steps(page);
        await sc.act(page);
        return await page.evaluate(([b, s]: any) => ({
          same: (window as any).__lockSnap() === b, steps: History.undoSize() - s, stroke: Tools.isStrokeActive(), shape: Canvas.hasHighlight('shape'),
          start: Tools.getRoadConnectStart(), locked: (window as any).__toasts.filter((t: string) => /locked/i.test(t)).length,
        }), [before, s0]);
      };
      const refused = await run([sc.layer]);
      expect(refused.same, 'whole map unchanged').toBe(true);
      expect(refused.steps, 'no History step').toBe(0);
      expect([refused.stroke, refused.shape, refused.start], 'no stroke state left behind').toEqual([false, false, null]);
      expect(refused.locked, 'a lock toast').toBeGreaterThanOrEqual(1);
      const control = await run([]);
      expect(control.same, 'positive control: the same gesture changes the map').toBe(false);
      expect(control.steps).toBe(1);
      expect(control.locked).toBe(0);
      const others = await run(Layers_NAMES.filter(n => n !== sc.layer));
      expect(others.same, 'locking the OTHER layers does not stop it').toBe(false);
      expect(others.steps).toBe(1);
      expect(others.locked).toBe(0);
    });
  }
});
const Layers_NAMES = ['terrain', 'objects', 'roads', 'settlements', 'zones'];

// ── secondary layers: eraser, paste, stamp, cut, delete, move, replace ─────────────────────────────
const W_ = 450;
const idx = (c: number, r: number) => r * W_ + c;
const S_ = { col: 226, row: 224 }, D_ = { col: 229, row: 226 };

/** Cell (c,r) with a distinct value on every layer; the fabricated satellite spawner is registered once per page. */
const fill = (page: any, c: number, r: number, v: { t?: string; o?: string; rd?: string; b?: number; x?: string; z?: number }) => page.evaluate(([c, r, v]: any) => {
  const k = c + ',' + r, zl = ZonePainter.getZoneLayer();
  if (v.t) mapData[r * MAP_WIDTH + c] = v.t;
  if (v.o) objectsData[k] = v.o;
  if (v.rd) roadsData[k] = { type: v.rd };
  if (v.b !== undefined) bridgesData.push({ col: c, row: r, axis: v.b });
  if (v.x) tileExtras[k] = { underTerrainId: v.x };
  if (v.z) zl[r * MAP_WIDTH + c] = v.z;
}, [c, r, v]);
const read = (page: any, c: number, r: number) => page.evaluate(([c, r]: any) => {
  const k = c + ',' + r;
  return { t: mapData[r * MAP_WIDTH + c], o: objectsData[k] || null, rd: roadsData[k] ? roadsData[k].type : null,
           b: bridgesData.some((b: any) => b.col === c && b.row === r), x: tileExtras[k] ? tileExtras[k].underTerrainId : null, z: ZonePainter.getZoneLayer()[r * MAP_WIDTH + c] };
}, [c, r]);
const FULL = { t: 'Water_1', o: 'Grain_1', rd: 'road_hex', b: 1, x: 'Water_1', z: 3 };
const PLAIN = { t: 'Plain_1', o: null, rd: null, b: false, x: null, z: 0 };
const CONTENT = (c: number, r: number) => ({ t: 'Water_1', o: 'Grain_1', rd: 'road_hex', b: true, x: 'Water_1', z: 3, c, r });

test.describe('layers: locks on eraser, selection commands, paste and replace (T2.18)', () => {
  test.beforeEach(async ({ page }) => { await lockEditor(page); });

  test('the Eraser skips a locked buildings layer (and bridges, satellites) but resets terrain, roads and extras, in one step', async ({ page }) => {
    // fabricated spawner with one satellite ring (same technique as the building tests)
    await page.evaluate(() => {
      const o = BldDB.getAll;
      BldDB.getAll = () => o.call(BldDB).concat([{ id: 'T_A', spawnsSatellites: [{ buildingId: 'T_S', radius: 1, maxCount: 0 }] }, { id: 'T_S', canBuild: false }] as any);
    });
    for (const [locked, want] of [
      [['objects'], { t: 'Plain_1', o: 'T_A', rd: null, b: true, x: null, z: 3, ring: true }],
      [['roads'], { t: 'Plain_1', o: null, rd: 'road_hex', b: false, x: null, z: 3, ring: false }],
      [['zones'], { t: 'Plain_1', o: null, rd: null, b: false, x: null, z: 3, ring: false }],    // the eraser never touches zones
      [[], { t: 'Plain_1', o: null, rd: null, b: false, x: null, z: 3, ring: false }],
    ] as any[]) {
      await resetMap(page);
      await fill(page, 226, 224, { ...FULL, o: 'T_A' });
      const ring = await page.evaluate(() => { const ns = HexUtils.neighbors(226, 224, MAP_WIDTH, MAP_HEIGHT).slice(1, 4); ns.forEach((n: any) => { objectsData[n.col + ',' + n.row] = 'T_S'; }); return ns; });
      await setLocks(page, locked);
      await page.evaluate(() => Tools.setActive('eraser'));
      const s0 = await steps(page), before = await snap(page);
      await clickCell(page, 226, 224);
      const r: any = await read(page, 226, 224);
      const ringLeft = await page.evaluate((ns: any) => ns.every((n: any) => objectsData[n.col + ',' + n.row] === 'T_S'), ring);
      expect({ t: r.t, o: r.o, rd: r.rd, b: r.b, x: r.x, z: r.z, ring: ringLeft }, 'locked: ' + locked.join('+')).toEqual(want);
      expect(await steps(page)).toBe(s0 + 1);
      await page.evaluate(() => History.undo());
      expect(await snap(page), 'one undo restores the whole map').toBe(before);
    }
  });

  test('the Eraser on a locked terrain layer is refused even when buildings and roads are unlocked', async ({ page }) => {
    await fill(page, 226, 224, FULL);
    await setLocks(page, ['terrain']);
    await page.evaluate(() => Tools.setActive('eraser'));
    const before = await snap(page), s0 = await steps(page);
    await clickCell(page, 226, 224);
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect((await lockedToasts(page)).length).toBe(1);
  });

  test('Paint and Fill over a legacy bridge: a locked buildings layer keeps the bridge, an unlocked one drops it', async ({ page }) => {
    for (const mode of ['paint', 'fill']) for (const locked of [true, false]) {
      await resetMap(page);
      await fill(page, 228, 224, { t: 'River_L_1', b: 0 });
      await page.evaluate((m: string) => { UI.selectTerrain('Water_1'); Tools.setActive(m); }, mode);
      await setLocks(page, locked ? ['objects'] : []);
      await clickCell(page, 228, 224);
      await page.evaluate(() => Tools.whenIdle());
      expect((await read(page, 228, 224)).t, mode + ' wrote the terrain').not.toBe('River_L_1');
      expect((await read(page, 228, 224)).b, `${mode} locked=${locked}`).toBe(locked);
    }
  });

  test('a locked terrain layer refuses multi-tile terrain (no anchor, no footprint); building satellites follow the buildings lock only', async ({ page }) => {
    const foot = () => page.evaluate(() => { const a = (getSatelliteAnchor as any); const ns = HexUtils.neighbors(228, 224, MAP_WIDTH, MAP_HEIGHT); return { id: mapData[224 * MAP_WIDTH + 228], fp: ns.filter((n: any) => a(n.col, n.row)).length }; });
    await page.evaluate(() => { UI.selectTerrain('Rabbit_Flat_1'); });
    await setLocks(page, ['terrain']);
    await clickCell(page, 228, 224);
    expect(await foot()).toEqual({ id: 'Plain_1', fp: 0 });
    await unlockAll(page);
    await clickCell(page, 228, 224);
    const placed = await foot();
    expect(placed.id).toBe('Rabbit_Flat_1');
    expect(placed.fp, 'positive control: the footprint exists').toBeGreaterThan(0);
    // satellites of a building are OBJECTS: terrain locked does not stop them, buildings locked does
    await page.evaluate(() => {
      const o = BldDB.getAll;
      BldDB.getAll = () => o.call(BldDB).concat([{ id: 'T_A', spawnsSatellites: [{ buildingId: 'T_S', radius: 1, maxCount: 0 }] }, { id: 'T_S', canBuild: false }] as any);
      Tools.setActive('object'); Tools.selectBuilding('T_A'); document.getElementById('obj-building-picker')!.style.display = 'none';
    });
    await setLocks(page, ['terrain']);
    await clickCell(page, 226, 222);
    expect(await page.evaluate(() => Object.values(objectsData).filter(v => v === 'T_S').length), 'terrain lock does not stop satellite objects').toBeGreaterThan(0);
    await resetMap(page);
    await page.evaluate(() => { Tools.setActive('object'); Tools.selectBuilding('T_A'); document.getElementById('obj-building-picker')!.style.display = 'none'; });
    await setLocks(page, ['objects']);
    await clickCell(page, 226, 222);
    expect(await page.evaluate(() => Object.keys(objectsData).length)).toBe(0);
  });

  // ── paste and stamps ─────────────────────────────────────────────────────────────────────────
  const pasteCases: [string, string[], any][] = [
    ['nothing locked', [], { t: 'Water_1', o: 'Grain_1', rd: 'road_hex', z: 3 }],
    ['terrain locked', ['terrain'], { t: 'Mountain_1', o: 'Grain_1', rd: 'road_hex', z: 3 }],
    ['buildings locked', ['objects'], { t: 'Water_1', o: 'Old_Obj', rd: 'road_hex', z: 3 }],
    ['roads locked', ['roads'], { t: 'Water_1', o: 'Grain_1', rd: 'road_alt', z: 3 }],
    ['zones locked', ['zones'], { t: 'Water_1', o: 'Grain_1', rd: 'road_hex', z: 9 }],
  ];
  for (const [label, locked, want] of pasteCases) {
    test(`paste with ${label}: only the unlocked layers are written, in one step; undo restores the whole map`, async ({ page }) => {
      await fill(page, S_.col, S_.row, { t: 'Water_1', o: 'Grain_1', rd: 'road_hex', z: 3 });
      await fill(page, D_.col, D_.row, { t: 'Mountain_1', o: 'Old_Obj', rd: 'road_alt', z: 9 });
      await page.evaluate((s: any) => { Selection.setCells([s]); Tools.copySelection(); Tools.beginPaste(Clipboard.get()); }, S_);
      await setLocks(page, locked);
      const before = await snap(page), s0 = await steps(page);
      await clickCell(page, D_.col, D_.row);
      const r: any = await read(page, D_.col, D_.row);
      expect({ t: r.t, o: r.o, rd: r.rd, z: r.z }).toEqual(want);
      expect(await steps(page)).toBe(s0 + 1);
      expect(await snap(page)).not.toBe(before);
      await page.evaluate(() => { Layers.NAMES.forEach((n: string) => Layers.setLocked(n, false)); History.undo(); });
      expect(await snap(page)).toBe(before);
    });
  }

  test('paste with every paste layer locked: refused with a toast, no step, the float stays; a locked-layer paste of terrain-only content is refused too', async ({ page }) => {
    await fill(page, S_.col, S_.row, { t: 'Water_1', o: 'Grain_1', rd: 'road_hex', z: 3 });
    await page.evaluate((s: any) => { Selection.setCells([s]); Tools.copySelection(); Tools.beginPaste(Clipboard.get()); }, S_);
    await setLocks(page, ['terrain', 'objects', 'roads', 'zones']);
    const before = await snap(page), s0 = await steps(page);
    await clickCell(page, D_.col, D_.row);
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect((await toastLog(page)).some(t => /Nothing pasted/.test(t))).toBe(true);
    expect(await page.evaluate(() => Tools.isPasting())).toBe(true);
    // terrain-only buffer, terrain locked, the other layers unlocked: nothing to write, so no empty step
    await page.evaluate(() => { Tools.setActive('paint'); Layers.setLocked('objects', false); Layers.setLocked('roads', false); Layers.setLocked('zones', false); mapData[224 * MAP_WIDTH + 227] = 'Forest_1'; Selection.setCells([{ col: 227, row: 224 }]); Tools.copySelection(); Tools.beginPaste(Clipboard.get()); });
    const b2 = await snap(page), s1 = await steps(page);
    await clickCell(page, D_.col, D_.row);
    expect(await snap(page)).toBe(b2);
    expect(await steps(page)).toBe(s1);
  });

  test('a stamp placed from the Stamps panel obeys the locks; saving a stamp and Copy work on locked layers', async ({ page }) => {
    await fill(page, S_.col, S_.row, { t: 'Water_1', o: 'Grain_1', rd: 'road_hex', z: 3 });
    await setLocks(page, ['terrain', 'objects', 'roads', 'zones']);
    // reading is fine on locked layers
    await page.evaluate(async (s: any) => { Selection.setCells([s]); await Stamps.save('locked', Clipboard.capture(Selection.getCells())); await Stamps.refresh(); }, S_);
    expect(await page.evaluate(() => Tools.copySelection())).toBe(true);
    expect(await page.evaluate(() => Clipboard.get().cells[0].t)).toBe('Water_1');
    expect(await lockedToasts(page)).toEqual([]);
    const before = await snap(page), s0 = await steps(page);
    await page.locator('.stamp-row .stamp-place').first().click();
    await clickCell(page, D_.col, D_.row);
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect((await toastLog(page)).some(t => /Nothing pasted/.test(t))).toBe(true);
    await unlockAll(page);
    await setLocks(page, ['zones', 'roads', 'objects']);       // terrain unlocked: the stamp's terrain lands, nothing else
    await clickCell(page, D_.col, D_.row);
    expect(await read(page, D_.col, D_.row)).toMatchObject({ t: 'Water_1', o: null, rd: null, z: 0 });
    expect(await steps(page)).toBe(s0 + 1);
  });

  test('Clipboard.place itself applies the live locks: no caller can write a locked layer', async ({ page }) => {
    await fill(page, S_.col, S_.row, { t: 'Water_1', o: 'Grain_1', rd: 'road_hex', z: 3 });
    await setLocks(page, ['terrain', 'roads']);
    const n = await page.evaluate(([s, d]: any) => Clipboard.place(Clipboard.capture([s]), d, null, {}), [S_, D_]);
    expect(n).toBeGreaterThan(0);
    expect(await read(page, D_.col, D_.row)).toMatchObject({ t: 'Plain_1', o: 'Grain_1', rd: null, z: 3 });
  });

  // ── cut and delete ───────────────────────────────────────────────────────────────────────────
  const sel3 = [{ col: 226, row: 224 }, { col: 227, row: 224 }, { col: 228, row: 224 }];
  const seed3 = async (page: any) => {
    await resetMap(page);
    for (const c of sel3) await fill(page, c.col, c.row, FULL);
    await page.evaluate((c: any) => { Selection.setCells(c); Tools.setActive('marquee'); }, sel3);
  };
  test('Delete and Cut refuse on a locked terrain layer (no step, map and clipboard untouched); Copy still works', async ({ page }) => {
    await seed3(page);
    await setLocks(page, ['terrain']);
    const before = await snap(page), s0 = await steps(page);
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+x');
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect(await page.evaluate(() => Clipboard.get())).toBe(null);
    expect((await lockedToasts(page)).length).toBe(2);
    await page.keyboard.press('Control+c');
    expect(await page.evaluate(() => Clipboard.get().cells.length)).toBe(3);
    await unlockAll(page);
    await page.keyboard.press('Delete');                         // positive control
    expect(await read(page, 226, 224)).toMatchObject(PLAIN);
    expect(await steps(page)).toBe(s0 + 1);
  });

  for (const [label, locked] of [['buildings', ['objects']], ['roads', ['roads']], ['zones', ['zones']], ['roads and zones', ['roads', 'zones']]] as [string, string[]][]) {
    test(`Delete with ${label} locked removes the rest in ONE step, keeps the locked content and says so`, async ({ page }) => {
      await seed3(page);
      await setLocks(page, locked);
      const before = await snap(page), s0 = await steps(page);
      await page.keyboard.press('Delete');
      for (const c of sel3) {
        const r: any = await read(page, c.col, c.row);
        expect({ t: r.t, o: r.o, rd: r.rd, b: r.b, x: r.x, z: r.z }).toEqual({
          t: 'Plain_1', x: null,
          o: locked.includes('objects') ? 'Grain_1' : null, b: locked.includes('objects'),
          rd: locked.includes('roads') ? 'road_hex' : null, z: locked.includes('zones') ? 3 : 0 });
      }
      expect(await steps(page)).toBe(s0 + 1);
      expect((await toastLog(page)).some(t => /locked layers were kept/.test(t))).toBe(true);
      await page.evaluate(() => History.undo());
      expect(await snap(page)).toBe(before);
    });
    test(`Cut with ${label} locked copies everything but removes only the unlocked layers, in ONE step`, async ({ page }) => {
      await seed3(page);
      await setLocks(page, locked);
      const before = await snap(page), s0 = await steps(page);
      await page.keyboard.press('Control+x');
      const clip = await page.evaluate(() => Clipboard.get().cells.map((e: any) => ({ t: e.t, o: e.o, rd: e.rd && e.rd.type, z: e.z })));
      expect(clip, 'the clipboard holds every layer (reading a locked layer is allowed)').toEqual(sel3.map(() => ({ t: 'Water_1', o: 'Grain_1', rd: 'road_hex', z: 3 })));
      const r: any = await read(page, 226, 224);
      expect(r.o === 'Grain_1').toBe(locked.includes('objects'));
      expect(r.rd === 'road_hex').toBe(locked.includes('roads'));
      expect(r.z === 3).toBe(locked.includes('zones'));
      expect(r.t).toBe('Plain_1');
      expect(await steps(page)).toBe(s0 + 1);
      expect((await toastLog(page)).some(t => /copied but not removed/.test(t))).toBe(true);
      await page.evaluate(() => History.undo());
      expect(await snap(page)).toBe(before);
    });
  }

  test('Delete where only locked content exists: no empty step, a toast explains', async ({ page }) => {
    await resetMap(page);
    await fill(page, 226, 224, { o: 'Grain_1' });
    await page.evaluate(() => { Selection.setCells([{ col: 226, row: 224 }]); });
    await setLocks(page, ['objects']);
    const s0 = await steps(page);
    await page.keyboard.press('Delete');
    expect(await steps(page)).toBe(s0);
    expect((await toastLog(page)).some(t => /Nothing deleted/.test(t))).toBe(true);
    expect((await read(page, 226, 224)).o).toBe('Grain_1');
  });

  // ── move (lift + drop) ───────────────────────────────────────────────────────────────────────
  const lift = (page: any) => page.evaluate((c: any) => { Selection.setCells([c]); return Tools.beginMove(); }, S_);
  const MOVE_SRC = { t: 'Water_1', o: 'Grain_1', rd: 'road_hex', z: 3 };
  const seedMove = async (page: any) => {
    await resetMap(page);
    await fill(page, S_.col, S_.row, MOVE_SRC);
    await fill(page, D_.col, D_.row, { t: 'Mountain_1', o: 'Old_Obj', rd: 'road_alt', z: 9 });
  };
  const rd = async (page: any) => ({ s: (await read(page, S_.col, S_.row)) as any, d: (await read(page, D_.col, D_.row)) as any });

  test('move with nothing locked: the source is cleared and every layer arrives (positive control)', async ({ page }) => {
    await seedMove(page);
    expect(await lift(page)).toBe(true);
    const s0 = await steps(page);
    await page.evaluate((d: any) => Tools.dropFloat(d.col, d.row), D_);
    const r = await rd(page);
    expect([r.s.t, r.s.o, r.s.rd, r.s.z]).toEqual(['Plain_1', null, null, 0]);
    expect([r.d.t, r.d.o, r.d.rd, r.d.z]).toEqual(['Water_1', 'Grain_1', 'road_hex', 3]);
    expect(await steps(page)).toBe(s0 + 1);
  });

  test('move on a locked terrain layer: the lift is refused (nothing floats)', async ({ page }) => {
    await seedMove(page);
    await setLocks(page, ['terrain']);
    expect(await lift(page)).toBe(false);
    expect(await page.evaluate(() => [Tools.isPasting(), Tools.isMoving()])).toEqual([false, false]);
    expect((await lockedToasts(page)).length).toBe(1);
  });

  for (const [label, when] of [['at lift time', 'lift'], ['between lift and drop', 'drop']] as const) {
    test(`move with the buildings layer locked ${label}: the building stays at the source, is not duplicated and the destination building is untouched; the rest moves`, async ({ page }) => {
      await seedMove(page);
      if (when === 'lift') await setLocks(page, ['objects']);
      expect(await lift(page)).toBe(true);
      // what floats (and is previewed) does not hold a layer that was locked at the lift
      expect(await page.evaluate(() => Tools.getFloatBuffer().cells.some((e: any) => e.o !== undefined))).toBe(when === 'drop');
      if (when === 'drop') await setLocks(page, ['objects']);
      const s0 = await steps(page);
      await page.evaluate((d: any) => Tools.dropFloat(d.col, d.row), D_);
      const r = await rd(page);
      expect([r.s.t, r.s.o, r.s.b, r.s.rd, r.s.z], 'source').toEqual(['Plain_1', 'Grain_1', false, null, 0]);
      expect([r.d.t, r.d.o, r.d.rd, r.d.z], 'destination').toEqual(['Water_1', 'Old_Obj', 'road_hex', 3]);
      expect(await page.evaluate(() => Object.values(objectsData).filter(v => v === 'Grain_1').length), 'not duplicated').toBe(1);
      expect(await steps(page)).toBe(s0 + 1);
    });
  }

  test('move with roads locked at lift and unlocked before the drop: the road is never removed without being carried', async ({ page }) => {
    await seedMove(page);
    await setLocks(page, ['roads']);
    expect(await lift(page)).toBe(true);
    await setLocks(page, ['roads'], false);
    await page.evaluate((d: any) => Tools.dropFloat(d.col, d.row), D_);
    const r = await rd(page);
    expect(r.s.rd, 'the source road stays').toBe('road_hex');
    expect(r.d.rd, 'the destination road is untouched').toBe('road_alt');
    expect([r.d.t, r.d.o, r.d.z]).toEqual(['Water_1', 'Grain_1', 3]);
    expect(r.s.t).toBe('Plain_1');
  });

  test('move with the zones layer locked between lift and drop: the zone stays at the source and is not copied', async ({ page }) => {
    await seedMove(page);
    expect(await lift(page)).toBe(true);
    await setLocks(page, ['zones']);
    await page.evaluate((d: any) => Tools.dropFloat(d.col, d.row), D_);
    const r = await rd(page);
    expect([r.s.z, r.d.z]).toEqual([3, 9]);
    expect([r.d.t, r.d.o, r.d.rd]).toEqual(['Water_1', 'Grain_1', 'road_hex']);
  });

  test('terrain locked between lift and drop: the drop is refused, no step, the float stays, and dropping after unlocking works', async ({ page }) => {
    await seedMove(page);
    expect(await lift(page)).toBe(true);
    await setLocks(page, ['terrain']);
    const before = await snap(page), s0 = await steps(page);
    expect(await page.evaluate((d: any) => Tools.dropFloat(d.col, d.row), D_)).toBe(0);
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect(await page.evaluate(() => [Tools.isPasting(), Tools.isMoving()])).toEqual([true, true]);
    expect((await lockedToasts(page)).length).toBe(1);
    await setLocks(page, ['terrain'], false);
    expect(await page.evaluate((d: any) => Tools.dropFloat(d.col, d.row), D_)).toBeGreaterThan(0);
    expect((await read(page, D_.col, D_.row)).t).toBe('Water_1');
    expect(await steps(page)).toBe(s0 + 1);
  });

  // ── replace ──────────────────────────────────────────────────────────────────────────────────
  test('the Replace dialog and API refuse on a locked terrain layer (no step, the dialog stays open); a locked buildings layer keeps bridges', async ({ page }) => {
    await fill(page, 228, 224, { t: 'Water_1' });
    await fill(page, 230, 224, { t: 'Water_1', b: 0 });
    await page.evaluate(() => { Tools.openReplace(); (document.getElementById('replace-from') as HTMLInputElement).value = 'Water_1'; (document.getElementById('replace-to') as HTMLInputElement).value = 'Plain_1'; (document.getElementById('replace-sel-only') as HTMLInputElement).checked = false; });
    await setLocks(page, ['terrain']);
    const before = await snap(page), s0 = await steps(page);
    await page.evaluate(() => Tools.applyReplace());
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect(await page.evaluate(() => document.getElementById('replace-modal')!.classList.contains('open'))).toBe(true);
    expect((await lockedToasts(page)).length).toBe(1);
    expect(await page.evaluate(() => Tools.replaceTerrain('Water_1', 'Plain_1', null))).toBe(0);
    expect(await snap(page)).toBe(before);
    await setLocks(page, ['terrain'], false);
    await setLocks(page, ['objects']);                           // buildings locked: terrain replaced, bridge overlay kept
    await page.evaluate(() => Tools.applyReplace());
    expect([(await read(page, 228, 224)).t, (await read(page, 230, 224)).t]).toEqual(['Plain_1', 'Plain_1']);
    expect((await read(page, 230, 224)).b).toBe(true);
    expect(await steps(page)).toBe(s0 + 1);
  });
});

// ── bulk operations and panels ─────────────────────────────────────────────────────────────────────
const SLOT = { minDist: 10, maxDist: 20, count: 1, type: 'settlement', tapMultiplier: 1, level: 1, minSpacing: 2, nearPct: 20, midPct: 30, farPct: 50 };
const confirmOpen = (page: any) => page.evaluate(() => document.getElementById('confirm-modal')!.classList.contains('open'));

test.describe('layers: locks on bulk operations and panels (T2.18)', () => {
  test.beforeEach(async ({ page }) => { await lockEditor(page); });

  test('Fill Map is refused on a locked terrain layer without opening the dialog; unlocked it fills (control)', async ({ page }) => {
    await page.evaluate(() => UI.selectTerrain('Water_1'));
    await setLocks(page, ['terrain']);
    const before = await snap(page), s0 = await steps(page);
    await page.evaluate(() => IO.fillMap());
    expect(await confirmOpen(page)).toBe(false);
    expect(await snap(page)).toBe(before);
    expect((await lockedToasts(page)).length).toBe(1);
    await unlockAll(page);
    await page.evaluate(() => IO.fillMap());
    expect(await confirmOpen(page)).toBe(true);
    await page.click('#confirm-ok');
    expect(await page.evaluate(() => mapData.every((x: string) => x === 'Water_1'))).toBe(true);
    expect(await steps(page)).toBe(s0 + 1);
  });

  test('Fill Map: a lock toggled while the dialog is open is honoured at confirm time (no step, no write)', async ({ page }) => {
    await page.evaluate(() => UI.selectTerrain('Water_1'));
    await page.evaluate(() => IO.fillMap());
    expect(await confirmOpen(page)).toBe(true);
    await setLocks(page, ['terrain']);
    const before = await snap(page), s0 = await steps(page);
    await page.click('#confirm-ok');
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
  });

  const clearSeed = async (page: any) => {
    await resetMap(page);
    await fill(page, 226, 224, { t: 'Water_1', b: 1 });
    await page.evaluate(() => { settlements.push({ col: 230, row: 224, type: 'settlement' }); });
  };
  const clearState = (page: any) => page.evaluate(() => ({ water: mapData.filter((x: string) => x === 'Water_1').length, bridges: bridgesData.length,
    sett: settlements.filter((s: any) => s.type !== 'city').length, city: settlements.filter((s: any) => s.type === 'city').length }));
  for (const [label, locked, want] of [
    ['nothing locked', [], { water: 0, bridges: 0, sett: 0, city: 1 }],
    ['terrain locked', ['terrain'], { water: 1, bridges: 1, sett: 0, city: 1 }],
    ['buildings locked', ['objects'], { water: 0, bridges: 1, sett: 0, city: 1 }],
    ['settlements locked', ['settlements'], { water: 0, bridges: 0, sett: 1, city: 1 }],
  ] as [string, string[], any][]) {
    test(`Clear Map with ${label}: locked layers are skipped, one step, undo restores`, async ({ page }) => {
      await clearSeed(page);
      await setLocks(page, locked);
      const before = await snap(page), s0 = await steps(page);
      await page.evaluate(() => IO.clearMap());
      await page.click('#confirm-ok');
      expect(await clearState(page)).toEqual(want);
      expect(await steps(page)).toBe(s0 + 1);
      await unlockAll(page);
      await page.evaluate(() => History.undo());
      expect(await snap(page)).toBe(before);
    });
  }
  test('Clear Map with every layer locked has nothing it may clear: no dialog, no step', async ({ page }) => {
    await clearSeed(page);
    await setLocks(page, Layers_NAMES);
    const before = await snap(page), s0 = await steps(page);
    await page.evaluate(() => IO.clearMap());
    expect(await confirmOpen(page)).toBe(false);
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect((await lockedToasts(page)).length).toBe(1);
  });

  test('Generate map: refused on a locked terrain layer; discarded when the lock is set while it generates; a locked settlements layer is not rewritten', async ({ page }) => {
    await setLocks(page, ['terrain']);
    let before = await snap(page), s0 = await steps(page);
    await page.evaluate(() => { (window as any).__prog = 0; const p = UI.progress; UI.progress = (...a: any[]) => { (window as any).__prog++; return p.apply(UI, a); }; });
    await page.evaluate(async () => { await Generator.apply(); });
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect((await lockedToasts(page)).length).toBe(1);
    expect(await page.evaluate(() => (window as any).__prog), 'refused up front: no generation work was started').toBe(0);
    expect((await toastLog(page)).some(t => /result discarded/.test(t))).toBe(false);
    // lock set while the (asynchronous) generation runs: the result is discarded
    await unlockAll(page);
    await page.evaluate(async () => { const p = Generator.apply(); Layers.setLocked('terrain', true); await p; });
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect((await toastLog(page)).some(t => /result discarded/.test(t))).toBe(true);
    // control: unlocked, it generates (one step); settlements array rewritten
    await unlockAll(page);
    const same = await page.evaluate(async () => { const ref = settlements; await Generator.apply(); return ref === settlements; });
    expect(same).toBe(false);
    expect(await snap(page)).not.toBe(before);
    expect(await steps(page)).toBe(s0 + 1);
    // settlements locked: terrain is generated, the settlements array is left alone
    await resetMap(page);
    await setLocks(page, ['settlements']);
    const kept = await page.evaluate(async () => { const ref = settlements; await Generator.apply(); return ref === settlements; });
    expect(kept).toBe(true);
    expect(await page.evaluate(() => mapData.some((x: string) => x !== 'Plain_1'))).toBe(true);
  });

  test('Satellite apply is refused on a locked terrain layer (modal stays, no step); unlocked it applies', async ({ page }) => {
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d')!;
      for (let j = 0; j < 64; j += 8) for (let i = 0; i < 64; i += 8) { x.fillStyle = `hsl(${(i * 7 + j * 3) % 360},50%,${20 + (j % 5) * 12}%)`; x.fillRect(i, j, 8, 8); }
      return c.toDataURL('image/png');
    });
    await page.evaluate(() => Satellite.open());
    await page.locator('#sat-modal input[type=file]').setInputFiles({ name: 'sat.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
    await page.waitForFunction(() => !(document.getElementById('sat-apply-btn') as HTMLButtonElement).disabled);
    await setLocks(page, ['terrain']);
    const before = await snap(page), s0 = await steps(page);
    await page.evaluate(() => Satellite.apply());
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect(await page.evaluate(() => document.getElementById('sat-modal')!.classList.contains('open'))).toBe(true);
    expect((await lockedToasts(page)).length).toBe(1);
    await unlockAll(page);
    await page.evaluate(() => Satellite.apply());
    expect(await snap(page)).not.toBe(before);
    expect(await steps(page)).toBe(s0 + 1);
  });

  test('the QA placer is refused on a locked terrain layer; unlocked it places the tiles', async ({ page }) => {
    await setLocks(page, ['terrain']);
    const before = await snap(page), s0 = await steps(page);
    await page.evaluate(() => Dev.qaPlaceAllTiles());
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect((await lockedToasts(page)).length).toBe(1);
    await unlockAll(page);
    await page.evaluate(() => Dev.qaPlaceAllTiles());
    expect(await snap(page)).not.toBe(before);
    expect(await steps(page)).toBe(s0 + 1);
  });

  test('Auto-place settlements is refused on a locked settlements layer (no step); unlocked it places', async ({ page }) => {
    await page.evaluate((sl: any) => { settlementSlots.length = 0; settlementSlots.push(Object.assign({}, sl)); }, SLOT);
    await setLocks(page, ['settlements']);
    const before = await snap(page), s0 = await steps(page);
    await page.evaluate(() => autoPlaceSettlements());
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect((await lockedToasts(page)).length).toBe(1);
    await unlockAll(page);
    await page.evaluate(() => autoPlaceSettlements());
    expect(await page.evaluate(() => settlements.filter((s: any) => s.type !== 'city').length)).toBeGreaterThan(0);
    expect(await steps(page)).toBe(s0 + 1);
  });

  test('settlement slots (add, remove, field edits) are refused on a locked settlements layer', async ({ page }) => {
    await page.evaluate((sl: any) => { settlementSlots.length = 0; settlementSlots.push(Object.assign({}, sl)); UI.rebuildSlotPanel(); }, SLOT);
    await setLocks(page, ['settlements']);
    const before = await snap(page), s0 = await steps(page);
    await page.evaluate(() => { (document.getElementById('slot-add') as HTMLElement).click(); (document.querySelector('.slot-remove') as HTMLElement).click(); });
    const edit = () => page.evaluate(() => { const el = document.querySelector('.slot-min') as HTMLInputElement; el.value = '77'; el.dispatchEvent(new Event('change', { bubbles: true })); return (document.querySelector('.slot-min') as HTMLInputElement).value; });
    expect(await edit(), 'the field is put back').toBe('10');
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect((await lockedToasts(page)).length).toBe(3);
    await unlockAll(page);                                      // controls
    expect(await edit()).toBe('77');
    expect(await page.evaluate(() => settlementSlots[0].minDist)).toBe(77);
    await page.evaluate(() => (document.getElementById('slot-add') as HTMLElement).click());
    expect(await page.evaluate(() => settlementSlots.length)).toBe(2);
    await page.evaluate(() => (document.querySelector('.slot-remove') as HTMLElement).click());
    expect(await page.evaluate(() => settlementSlots.length)).toBe(1);
    expect(await steps(page)).toBe(s0 + 2);
  });

  test('the tile inspector under-terrain editors (extras) are refused on a locked terrain layer', async ({ page }) => {
    await page.evaluate(() => { Canvas.selectTile(228, 224); (document.getElementById('tile-insp-under') as HTMLInputElement).value = 'Water_1'; });
    await setLocks(page, ['terrain']);
    const before = await snap(page);
    await page.evaluate(() => Canvas.applyTileInspectorUnder());
    await page.evaluate(() => { IO.openBridgeTerrainModal(228, 224); (document.getElementById('bridge-terrain-input') as HTMLInputElement).value = 'Water_1'; IO.applyBridgeTileUnder(); });
    expect(await snap(page)).toBe(before);
    expect((await lockedToasts(page)).length).toBe(2);
    expect(await page.evaluate(() => document.getElementById('bridge-terrain-modal')!.classList.contains('open'))).toBe(false);
    await unlockAll(page);
    await page.evaluate(() => Canvas.applyTileInspectorUnder());
    expect(await page.evaluate(() => tileExtras['228,224'])).toEqual({ underTerrainId: 'Water_1' });
    await setLocks(page, ['terrain']);
    await page.evaluate(() => Canvas.clearTileInspectorUnder());
    expect(await page.evaluate(() => tileExtras['228,224'])).toEqual({ underTerrainId: 'Water_1' });
  });
});

// ── Zone Painter ───────────────────────────────────────────────────────────────────────────────────
test.describe('layers: locks on the Zone Painter actions (T2.18)', () => {
  test.beforeEach(async ({ page }) => {
    await lockEditor(page);
    await page.evaluate(() => { window.confirm = () => true; });
  });
  const zoneSeed = async (page: any) => {
    await resetMap(page);
    await page.evaluate(() => {
      const id = ZonePainter.addZone('Z'); ZonePainter.setSelectedZoneId(id);
      const zl = ZonePainter.getZoneLayer();
      for (let r = 215; r < 235; r++) for (let c = 215; c < 235; c++) zl[r * MAP_WIDTH + c] = id;
    });
  };
  const terrainKinds = (page: any) => page.evaluate(() => new Set(mapData).size);
  const zoneCells = (page: any) => page.evaluate(() => { let n = 0; for (const v of ZonePainter.getZoneLayer()) if (v) n++; return n; });

  for (const action of ['_fillAllZones', '_uiFillThisZone']) {
    test(`${action}: terrain locked keeps the terrain, terrain AND settlements locked is refused with no step; unlocked it writes (control)`, async ({ page }) => {
      await zoneSeed(page);
      await setLocks(page, ['terrain']);
      const s0 = await steps(page);
      await page.evaluate((a: string) => (ZonePainter as any)[a](), action);
      expect(await terrainKinds(page), 'terrain untouched').toBe(1);
      await unlockAll(page);
      await setLocks(page, ['terrain', 'settlements']);
      const before = await snap(page), s1 = await steps(page);
      await page.evaluate((a: string) => (ZonePainter as any)[a](), action);
      expect(await snap(page)).toBe(before);
      expect(await steps(page)).toBe(s1);
      await unlockAll(page);
      await page.evaluate((a: string) => (ZonePainter as any)[a](), action);
      expect(await terrainKinds(page), 'positive control: the zone fill writes terrain').toBeGreaterThan(1);
      expect(await steps(page)).toBe(s1 + 1);
      expect(s1).toBe(s0 + 1);                                  // the terrain-locked run still took its (settlement) step
    });
  }

  test('random fill: a locked zones layer refuses it entirely; a locked terrain layer still randomizes the zones but keeps the terrain', async ({ page }) => {
    await resetMap(page);
    await setLocks(page, ['zones']);
    const before = await snap(page), s0 = await steps(page);
    await page.evaluate(() => ZonePainter._randomizeFillUI());
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect((await lockedToasts(page)).length).toBe(1);
    await unlockAll(page);
    await setLocks(page, ['terrain']);
    await page.evaluate(() => ZonePainter._randomizeFillUI());
    expect(await zoneCells(page), 'zones randomized').toBeGreaterThan(1000);
    expect(await terrainKinds(page), 'terrain untouched').toBe(1);
    await resetMap(page);
    await page.evaluate(() => ZonePainter._randomizeFillUI());
    expect(await terrainKinds(page), 'control: unlocked it also fills terrain').toBeGreaterThan(1);
  });

  test('Clear zone assignments and Delete zone are refused on a locked zones layer; unlocked they work', async ({ page }) => {
    await zoneSeed(page);
    await setLocks(page, ['zones']);
    const before = await snap(page);
    await page.evaluate(() => { ZonePainter._clearZonesUI(); ZonePainter._uiDeleteZone(ZonePainter.getSelectedZoneId()); });
    expect(await snap(page)).toBe(before);
    expect((await lockedToasts(page)).length).toBe(2);
    await unlockAll(page);
    await page.evaluate(() => ZonePainter._uiDeleteZone(ZonePainter.getSelectedZoneId()));
    expect(await zoneCells(page)).toBe(0);
    await zoneSeed(page);
    await page.evaluate(() => ZonePainter._clearZonesUI());
    expect(await zoneCells(page)).toBe(0);
  });
});

// ── persistence, undo, mid-stroke, UI ──────────────────────────────────────────────────────────────
test.describe('layers: lock state, undo and strokes (T2.18)', () => {
  test.beforeEach(async ({ page }) => { await lockEditor(page); });

  test('a locked layer stays locked after a reload and still refuses; locking is editor-only state (no map change, no step, no autosave)', async ({ page }) => {
    const r = await page.evaluate(() => {
      let saves = 0; const orig = IO.scheduleAutoSave; IO.scheduleAutoSave = (...a: any[]) => { saves++; return orig(...a); };
      const b = (window as any).__lockSnap(), s = History.undoSize();
      Layers.setLocked('terrain', true); Layers.setLocked('roads', true);
      const out = { same: (window as any).__lockSnap() === b, steps: History.undoSize() === s, saves, stored: JSON.parse(localStorage.getItem('layer_state_v1')!) };
      IO.scheduleAutoSave = orig;
      return out;
    });
    expect(r).toMatchObject({ same: true, steps: true, saves: 0 });
    expect([r.stored.terrain.locked, r.stored.roads.locked, r.stored.objects.locked]).toEqual([true, true, false]);
    await lockEditor(page);                                      // a full reload
    expect(await page.evaluate(() => Layers.NAMES.map((n: string) => Layers.isLocked(n)))).toEqual([true, false, true, false, false]);
    await expect(page.locator('.layer-row[data-layer="terrain"] .layer-lock')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => { UI.selectTerrain('Water_1'); Tools.setActive('paint'); });
    const before = await snap(page);
    await clickCell(page, 228, 224);
    expect(await snap(page)).toBe(before);
    expect((await lockedToasts(page)).length).toBe(1);
  });

  test('undo and redo are not blocked by locks', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Water_1'); });
    await clickCell(page, 228, 224);
    expect(await cellId(page, 228, 224)).toBe('Water_1');
    await setLocks(page, ['terrain', 'objects', 'roads', 'settlements', 'zones']);
    await page.keyboard.press('Control+z');
    expect(await cellId(page, 228, 224)).toBe('Plain_1');
    await page.keyboard.press('Control+y');
    expect(await cellId(page, 228, 224)).toBe('Water_1');
    expect(await lockedToasts(page)).toEqual([]);
  });

  test('the lock buttons say what a lock does (tooltip), keep their markup, and the layout is unchanged', async ({ page }) => {
    const r = await page.evaluate(() => {
      const b = document.querySelector('.layer-row[data-layer="roads"] .layer-lock') as HTMLButtonElement;
      const before = b.title; Layers.setLocked('roads', true); const after = b.title; Layers.setLocked('roads', false);
      const cv = document.getElementById('map-canvas')!.getBoundingClientRect();
      return { before, after, type: b.type, pressed: b.getAttribute('aria-pressed'), label: !!b.getAttribute('aria-label') };
    });
    expect(r.before).toMatch(/will not change/);
    expect(r.before).toMatch(/Roads/);
    expect(r.after).toMatch(/^Unlock Roads/);
    expect([r.type, r.pressed, r.label]).toEqual(['button', 'false', true]);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const box = await page.evaluate(() => { const c = document.getElementById('map-canvas') as HTMLCanvasElement; return [c.width, c.height]; });
    expect(box).toEqual([1491, 808]);
  });

  const pt = (page: any, c: number, r: number) => cellPoint(page, c, r);
  const downAt = async (page: any, c: number, r: number) => { const p = await pt(page, c, r); await page.mouse.move(p.x, p.y); await page.mouse.down(); };
  const moveTo = async (page: any, c: number, r: number) => { const p = await pt(page, c, r); await page.mouse.move(p.x, p.y, { steps: 3 }); };

  test('Paint: a lock set mid-stroke stops the next writes, one toast, ONE step that undo reverts, no stuck state', async ({ page }) => {
    await page.evaluate(() => UI.selectTerrain('Water_1'));
    const before = await snap(page), s0 = await steps(page);
    await downAt(page, 226, 224);
    await setLocks(page, ['terrain']);
    await moveTo(page, 227, 224); await moveTo(page, 228, 224); await moveTo(page, 229, 224);
    await page.mouse.up();
    expect(await page.evaluate(() => [226, 227, 228, 229].map(c => mapData[224 * MAP_WIDTH + c]))).toEqual(['Water_1', 'Plain_1', 'Plain_1', 'Plain_1']);
    expect(await steps(page)).toBe(s0 + 1);
    expect((await lockedToasts(page)).length, 'one toast for the whole stroke').toBe(1);
    expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(false);
    await page.evaluate(() => History.undo());
    expect(await snap(page)).toBe(before);
    await unlockAll(page);                                       // the next stroke works
    await downAt(page, 226, 225); await moveTo(page, 227, 225); await page.mouse.up();
    expect(await page.evaluate(() => [226, 227].map(c => mapData[225 * MAP_WIDTH + c]))).toEqual(['Water_1', 'Water_1']);
  });

  test('Eraser: a lock set mid-stroke keeps the cells not yet reached; one step', async ({ page }) => {
    await page.evaluate(() => { for (const c of [226, 227, 228]) mapData[224 * MAP_WIDTH + c] = 'Water_1'; Tools.setActive('eraser'); });
    const before = await snap(page), s0 = await steps(page);
    await downAt(page, 226, 224);
    await setLocks(page, ['terrain']);
    await moveTo(page, 227, 224); await moveTo(page, 228, 224);
    await page.mouse.up();
    expect(await page.evaluate(() => [226, 227, 228].map(c => mapData[224 * MAP_WIDTH + c]))).toEqual(['Plain_1', 'Water_1', 'Water_1']);
    expect(await steps(page)).toBe(s0 + 1);
    await page.evaluate(() => History.undo());
    expect(await snap(page)).toBe(before);
  });

  test('Place Building: locking before the stroke wrote anything leaves NO empty step', async ({ page }) => {
    await page.evaluate(() => { objectsData['226,224'] = 'Artefact_Test_1'; Tools.setActive('object'); Tools.selectBuilding('Artefact_Test_1'); document.getElementById('obj-building-picker')!.style.display = 'none'; });
    const before = await snap(page), s0 = await steps(page);
    await downAt(page, 226, 224);                                // same building: nothing to write, no step yet
    await setLocks(page, ['objects']);
    await moveTo(page, 227, 224); await moveTo(page, 228, 224);
    await page.mouse.up();
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
    expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(false);
    expect((await lockedToasts(page)).length).toBe(1);
    await unlockAll(page);                                       // positive control: the same drag places buildings
    await downAt(page, 226, 224); await moveTo(page, 227, 224); await page.mouse.up();
    expect(await page.evaluate(() => Object.keys(objectsData).sort())).toEqual(['226,224', '227,224']);
    expect(await steps(page)).toBe(s0 + 1);
  });

  test('Zone Painter brush: a lock set mid-stroke stops the next cells', async ({ page }) => {
    await page.evaluate(() => { const id = ZonePainter.addZone('Z'); ZonePainter.setSelectedZoneId(id); Tools.setActive('zone'); });
    await downAt(page, 226, 224);
    await setLocks(page, ['zones']);
    await moveTo(page, 227, 224); await moveTo(page, 228, 224);
    await page.mouse.up();
    expect(await page.evaluate(() => [226, 227, 228].map(c => ZonePainter.getZoneLayer()[224 * MAP_WIDTH + c] > 0))).toEqual([true, false, false]);
  });

  for (const tool of ['rect', 'line']) {
    test(`${tool}: a lock set during the drag refuses the commit (no write, no step, the preview is cleared)`, async ({ page }) => {
      await page.evaluate((t: string) => { UI.selectTerrain('Water_1'); Tools.setActive(t); }, tool);
      const before = await snap(page), s0 = await steps(page);
      await downAt(page, 226, 224);
      await moveTo(page, 229, 225);
      if (tool === 'line') expect(await page.evaluate(() => Canvas.hasHighlight('shape')), 'the line preview is showing').toBe(true);
      await setLocks(page, ['terrain']);
      await page.mouse.up();
      expect(await snap(page)).toBe(before);
      expect(await steps(page)).toBe(s0);
      expect(await page.evaluate(() => Canvas.hasHighlight('shape'))).toBe(false);
      expect((await lockedToasts(page)).length).toBe(1);
      expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(false);
      await unlockAll(page);                                     // positive control: the same drag now writes
      await downAt(page, 226, 224); await moveTo(page, 229, 225); await page.mouse.up();
      expect(await snap(page)).not.toBe(before);
      expect(await steps(page)).toBe(s0 + 1);
    });
  }
});

// ── Clear Map clears every layer (T2.19) ───────────────────────────────────────────────────────────
// Reference method: the WHOLE map state is serialised (lockSnap). The expected state after a clear is built independently:
// the snapshot of a freshly created blank map, with the parts of every LOCKED layer taken from the seeded snapshot.
const seedEverything = (page: any) => page.evaluate(() => {
  mapData[224 * MAP_WIDTH + 226] = 'Water_1'; mapData[226 * MAP_WIDTH + 228] = 'Forest_1';
  objectsData['226,224'] = 'Grain_1'; roadsData['227,224'] = { type: 'road_hex' };
  tileExtras['226,224'] = { underTerrainId: 'Water_1' };
  bridgesData.push({ col: 228, row: 226, axis: 1 });
  const zl = ZonePainter.getZoneLayer(); zl[224 * MAP_WIDTH + 228] = 1; zl[225 * MAP_WIDTH + 228] = 2;
  settlements.push({ col: 230, row: 224, type: 'settlement' });
});
const canvasPx = (page: any) => page.evaluate(() => { Canvas.render(); return document.getElementById('map-canvas')!.toDataURL(); });
const confirmMsg = (page: any) => page.evaluate(() => document.getElementById('confirm-msg')!.textContent || '');
const clearOk = async (page: any) => { await page.evaluate(() => IO.clearMap()); await page.click('#confirm-ok'); };
const closeConfirmDlg = (page: any) => page.evaluate(() => UI.closeConfirm());
/** The expected post-clear state: blank, except that every locked layer keeps its seeded data (bridges also stay when terrain is locked). */
function expectedAfter(blank: string, seeded: string, locked: string[]) {
  const b = JSON.parse(blank), s = JSON.parse(seeded), out = Object.assign({}, b);
  const L = (n: string) => locked.includes(n);
  if (L('terrain')) { out.m = s.m; out.x = s.x; }
  if (L('objects')) out.o = s.o;
  if (L('terrain') || L('objects')) out.b = s.b;
  if (L('roads')) out.r = s.r;
  if (L('zones')) out.z = s.z;
  if (L('settlements')) out.s = s.s;
  return JSON.stringify(out);
}

test.describe('Clear Map clears every layer (T2.19)', () => {
  let blank = '', blankPx = '';
  test.beforeEach(async ({ page }) => {
    await lockEditor(page);
    await resetMap(page);
    blank = await snap(page); blankPx = await canvasPx(page);
    await seedEverything(page);
  });

  test('unlocked: every layer is cleared to the blank-map state in ONE step; undo restores the seeded state exactly, redo clears again', async ({ page }) => {
    const seeded = await snap(page), s0 = await steps(page);
    expect(seeded).not.toBe(blank);
    expect(await canvasPx(page)).not.toBe(blankPx);
    await clearOk(page);
    expect(await snap(page)).toBe(blank);
    expect(await steps(page)).toBe(s0 + 1);
    expect(await canvasPx(page), 'overlay and satellite caches follow: same pixels as a blank map').toBe(blankPx);
    await page.evaluate(() => History.undo());
    expect(await snap(page)).toBe(seeded);
    expect(await canvasPx(page)).not.toBe(blankPx);
    await page.evaluate(() => History.redo());
    expect(await snap(page)).toBe(blank);
    expect(await canvasPx(page)).toBe(blankPx);
  });

  for (const layer of Layers_NAMES) {
    test(`${layer} locked: only that layer is kept (positive control: the others are cleared), one step, undo restores`, async ({ page }) => {
      const seeded = await snap(page), s0 = await steps(page);
      await setLocks(page, [layer]);
      await clearOk(page);
      const after = await snap(page);
      expect(after).toBe(expectedAfter(blank, seeded, [layer]));
      expect(after).not.toBe(blank);          // the locked layer really kept something
      expect(after).not.toBe(seeded);         // and the rest really went
      expect(await steps(page)).toBe(s0 + 1);
      await unlockAll(page);
      await page.evaluate(() => History.undo());
      expect(await snap(page)).toBe(seeded);
    });
  }

  test('terrain locked keeps the under-terrain extras with it; buildings locked do NOT keep them (extras follow the terrain lock)', async ({ page }) => {
    await setLocks(page, ['objects']);
    await clearOk(page);
    expect(await page.evaluate(() => Object.keys(tileExtras).length)).toBe(0);
    expect(await page.evaluate(() => Object.keys(objectsData).length)).toBe(1);
    await page.evaluate(() => History.undo());
    await setLocks(page, ['objects'], false); await setLocks(page, ['terrain']);
    await clearOk(page);
    expect(await page.evaluate(() => Object.keys(tileExtras).length)).toBe(1);
    expect(await page.evaluate(() => Object.keys(objectsData).length)).toBe(0);
  });

  test('every layer locked: refused with a toast, no dialog, no step', async ({ page }) => {
    const seeded = await snap(page), s0 = await steps(page);
    await setLocks(page, Layers_NAMES);
    await page.evaluate(() => IO.clearMap());
    expect(await confirmOpen(page)).toBe(false);
    expect(await snap(page)).toBe(seeded);
    expect(await steps(page)).toBe(s0);
    expect((await lockedToasts(page)).length).toBe(1);
    expect((await toastLog(page)).some(t => /Nothing to clear/.test(t)), 'the lock refusal, not the nothing-to-clear toast').toBe(false);
  });

  test('clearing twice: the second is a no-op with a toast, no dialog and no History step', async ({ page }) => {
    await clearOk(page);
    const s1 = await steps(page), after = await snap(page);
    await page.evaluate(() => { (window as any).__toasts = []; IO.clearMap(); });
    expect(await confirmOpen(page)).toBe(false);
    expect(await steps(page)).toBe(s1);
    expect(await snap(page)).toBe(after);
    expect((await toastLog(page)).some(t => /Nothing to clear/.test(t))).toBe(true);
  });

  test('only locked layers hold content: no-op naming the kept layers, no step', async ({ page }) => {
    await setLocks(page, ['terrain', 'objects', 'roads', 'settlements']);   // zones free: clear them
    await clearOk(page);
    expect(await page.evaluate(() => ZonePainter.getZoneLayer().every((v: number) => v === 0))).toBe(true);
    const s1 = await steps(page);
    await page.evaluate(() => { (window as any).__toasts = []; IO.clearMap(); });
    expect(await confirmOpen(page)).toBe(false);
    expect(await steps(page)).toBe(s1);
    expect((await toastLog(page)).some(t => /Nothing to clear.*Terrain/.test(t))).toBe(true);
  });

  test('the dialog text lists what will be cleared and what is kept because locked', async ({ page }) => {
    await page.evaluate(() => IO.clearMap());
    let m = await confirmMsg(page);
    for (const w of ['Terrain', 'Buildings', 'Bridges', 'Roads', 'Zones', 'Settlements']) expect(m).toContain(w);
    expect(m).not.toContain('Kept (locked)');
    await closeConfirmDlg(page);
    await setLocks(page, ['terrain']);            // terrain locked, settlements free (the misleading T2.18 case)
    await page.evaluate(() => IO.clearMap());
    m = await confirmMsg(page);
    expect(m).not.toMatch(/Clear all terrain/);
    expect(m).toMatch(/Clear: Buildings, Roads, Zones, Settlements\./);
    expect(m).toMatch(/Kept \(locked\): Terrain, Bridges\./);
    await closeConfirmDlg(page);
  });

  test('the confirm callback re-reads the locks: a layer locked while the dialog is open is kept; all locked: nothing happens', async ({ page }) => {
    const seeded = await snap(page), s0 = await steps(page);
    await page.evaluate(() => IO.clearMap());
    await setLocks(page, ['roads']);
    await page.click('#confirm-ok');
    expect(await snap(page)).toBe(expectedAfter(blank, seeded, ['roads']));
    expect(await steps(page)).toBe(s0 + 1);
    await page.evaluate(() => History.undo());
    await unlockAll(page);
    await page.evaluate(() => IO.clearMap());
    await setLocks(page, Layers_NAMES);
    const before = await snap(page), s1 = await steps(page);
    await page.click('#confirm-ok');
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s1);
  });

  test('the map replaced while the dialog is open: confirming clears nothing and adds no step', async ({ page }) => {
    await page.evaluate(() => IO.clearMap());
    await page.evaluate(() => { IO.newMap(true); });
    const before = await snap(page), s0 = await steps(page);
    await page.click('#confirm-ok');
    expect(await snap(page)).toBe(before);
    expect(await steps(page)).toBe(s0);
  });

  test('refused while a stroke is in progress (no dialog), works after the stroke ends', async ({ page }) => {
    const p = await cellPoint(page, 228, 224);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    expect(await page.evaluate(() => Tools.isStrokeActive()), 'the press started a stroke').toBe(true);
    await page.evaluate(() => IO.clearMap());
    expect(await confirmOpen(page)).toBe(false);
    await page.mouse.up();
    const painted = await snap(page);
    expect(painted).not.toBe(blank);
    await clearOk(page);
    expect(await snap(page)).toBe(blank);
  });

  test('a lifted region is cancelled; the selection is kept', async ({ page }) => {
    const cells = await page.evaluate(() => { Selection.setCells(Tools._rectCells(225, 223, 229, 227)); return Selection.size(); });
    expect(cells).toBeGreaterThan(0);
    expect(await page.evaluate(() => Tools.beginMove())).toBe(true);
    expect(await page.evaluate(() => Tools.isMoving())).toBe(true);
    await clearOk(page);
    expect(await page.evaluate(() => Tools.isMoving())).toBe(false);
    expect(await page.evaluate(() => Selection.size())).toBe(cells);
    expect(await snap(page)).toBe(blank);
  });

  test('slots and zone definitions are not touched', async ({ page }) => {
    await page.evaluate((slot) => { settlementSlots.push(Object.assign({}, slot)); ZonePainter.addZone('keep', '#ff0000'); }, SLOT);
    const slots = await page.evaluate(() => JSON.stringify(settlementSlots)), zones = await page.evaluate(() => JSON.stringify(ZonePainter.getZones()));
    await clearOk(page);
    expect(await page.evaluate(() => JSON.stringify(settlementSlots))).toBe(slots);
    expect(await page.evaluate(() => JSON.stringify(ZonePainter.getZones()))).toBe(zones);
  });

  test('refused while a fill runs (entry): no dialog; the fill still completes', async ({ page }) => {
    const r = await page.evaluate(async () => {
      UI.selectTerrain('Forest_1'); Tools.setActive('fill');
      const p = Tools.fill(240, 240);
      const busy = Tools.isFillBusy();
      IO.clearMap();
      const open = document.getElementById('confirm-modal')!.classList.contains('open');
      await p;
      return { busy, open };
    });
    expect(r.busy, 'positive control: the fill was running').toBe(true);
    expect(r.open).toBe(false);
  });

  test('a fill started while the dialog is open: confirming clears nothing', async ({ page }) => {
    const r = await page.evaluate(async () => {
      IO.clearMap();
      const open = document.getElementById('confirm-modal')!.classList.contains('open');
      UI.selectTerrain('Forest_1'); Tools.setActive('fill');
      const p = Tools.fill(240, 240);
      const busy = Tools.isFillBusy();
      document.getElementById('confirm-ok')!.click();
      const kept = Object.keys(objectsData).length + Object.keys(roadsData).length + Object.keys(tileExtras).length;
      await p;
      return { open, busy, kept };
    });
    expect(r.open).toBe(true);
    expect(r.busy).toBe(true);
    expect(r.kept).toBe(3);
  });

  test('a stroke started while the dialog is open: confirming clears nothing', async ({ page }) => {
    const p = await cellPoint(page, 228, 224);
    await page.evaluate(() => IO.clearMap());
    const r = await page.evaluate((pt) => {
      const cv = document.getElementById('map-canvas')!;
      cv.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true }));
      const active = Tools.isStrokeActive();
      document.getElementById('confirm-ok')!.click();
      return { active, kept: Object.keys(objectsData).length + Object.keys(roadsData).length };
    }, p);
    expect(r.active, 'positive control: the stroke started').toBe(true);
    expect(r.kept).toBe(2);
    await page.mouse.up();
  });

  test('the satellite-footprint cache is invalidated: no stale anchors after the clear', async ({ page }) => {
    const r = await page.evaluate(() => {
      const entry = (Terrain as any).byHexId('Water_1'), saved = entry.occupiedOffsets;
      entry.occupiedOffsets = ['N', 'S'];
      try {
        invalidateSatelliteMap();
        const fp = footprintCells(226, 224, entry).filter((f: any) => getSatelliteAnchor(f.col, f.row));
        IO.clearMap(); document.getElementById('confirm-ok')!.click();
        const after = footprintCells(226, 224, entry).filter((f: any) => getSatelliteAnchor(f.col, f.row));
        return { before: fp.length, after: after.length };
      } finally { if (saved === undefined) delete entry.occupiedOffsets; else entry.occupiedOffsets = saved; invalidateSatelliteMap(); }
    });
    expect(r.before, 'positive control').toBe(2);
    expect(r.after).toBe(0);
  });
});

// ── cleanup A5: lock gaps ───────────────────────────────────────────────────────────────────────────
const typeInto = (page: any, id: string, v: string) => page.evaluate(([i, val]: any) => { const el = document.getElementById(i) as HTMLInputElement; el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
test.describe('layers: lock gaps (cleanup A5)', () => {
  test.beforeEach(async ({ page }) => { await lockEditor(page); await page.evaluate(() => { window.confirm = () => true; }); });

  test('the settlement priority inputs revert and toast once while Settlements is locked; unlocked they save (control)', async ({ page }) => {
    await resetMap(page);
    const stored = await page.evaluate(() => [settlementPriority1.join(', '), settlementPriority2.join(', ')]);
    await setLocks(page, ['settlements']);
    for (const [id, i] of [['priority-p1', 0], ['priority-p2', 1]] as const) {
      await page.evaluate(() => { (window as any).__toasts = []; });
      await typeInto(page, id, 'Water_1, Forest_1');
      expect(await page.evaluate((x) => (document.getElementById(x) as HTMLInputElement).value, id)).toBe(stored[i]);
      expect((await lockedToasts(page)).length).toBe(1);
    }
    expect(await page.evaluate(() => [settlementPriority1.join(', '), settlementPriority2.join(', ')])).toEqual(stored);
    await unlockAll(page);
    await typeInto(page, 'priority-p1', 'Water_1, Forest_1');
    expect(await page.evaluate(() => settlementPriority1)).toEqual(['Water_1', 'Forest_1']);
  });
});
