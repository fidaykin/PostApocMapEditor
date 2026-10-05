import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { freshEditor } from './editor-helpers';

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
    const txt = await page.evaluate(() => document.getElementById('st-tile')!.textContent);
    expect(txt).toBe('226, 224');
    expect(await page.evaluate(() => /road/i.test(document.getElementById('statusbar')?.textContent || document.body.querySelector('.status-item')?.parentElement?.textContent || ''))).toBe(false);
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

  test('a pointer click on a panel button hands the focus back: Space pans again', async ({ page }) => {
    await page.click('.layer-row[data-layer="roads"] .layer-eye');
    await page.click('.layer-row[data-layer="roads"] .layer-lock');
    expect(await page.evaluate(() => document.activeElement === document.body || !document.activeElement!.closest('#layers-panel'))).toBe(true);
    await page.keyboard.down('Space');
    expect(await page.evaluate(() => (document.getElementById('map-canvas') as HTMLElement).style.cursor)).toBe('grab');
    await page.keyboard.up('Space');
    await page.keyboard.press('KeyF');
    expect(await page.evaluate(() => Tools.getActive())).toBe('fill');
  });

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
