import { test, expect, Page } from '@playwright/test';
import { freshEditor, clickCell, cellPoint } from './editor-helpers';

// Final fix wave B (remaining Minor findings): validator (B3), History / PNG / layout (B4), generation (B5), UI (B6).

test.describe('B3 validator', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  // A settlement ringed by `wallId` (true hex adjacency) must be reported as unreachable from the city.
  const walled = (page: Page, wallId: string) => page.evaluate((id) => {
    const sc = 231, sr = 224;
    settlements.push({ col: sc, row: sr, type: 'settlement' } as any);
    for (const n of HexUtils.neighbors(sc, sr, MAP_WIDTH, MAP_HEIGHT)) mapData[n.row * MAP_WIDTH + n.col] = id;
    return MapValidator.run().issues.map((i: any) => i.id);
  }, wallId);

  test('Mountain_Kaiju_1 and _2 block like Mountain_1; Hills_1 does not (hand-written list)', async ({ page }) => {
    expect(await walled(page, 'Mountain_Kaiju_1')).toContain('unreachable-settlement');
    expect(await walled(page, 'Mountain_Kaiju_2')).toContain('unreachable-settlement');
    expect(await walled(page, 'Mountain_1')).toContain('unreachable-settlement');
    expect(await walled(page, 'Hills_1')).not.toContain('unreachable-settlement');       // positive control: the same ring of a passable tile
  });

  test('a HexDB entry whose TYPE is Volcanic/Rift or Rivers blocks without being in a hard-coded id list', async ({ page }) => {
    await page.evaluate(() => {
      HexDB.getAll().push({ id: 'Magma_Custom_1', type: 'Volcanic/Rift', spriteName: '' } as any, { id: 'Brook_Custom_1', type: 'Rivers', spriteName: '' } as any, { id: 'Grass_Custom_1', type: 'Plains', spriteName: '' } as any);
    });
    expect(await walled(page, 'Magma_Custom_1')).toContain('unreachable-settlement');
    expect(await walled(page, 'Brook_Custom_1')).toContain('unreachable-settlement');
    expect(await walled(page, 'Grass_Custom_1')).not.toContain('unreachable-settlement');
  });

  for (const db of ['HexDB', 'BldDB'] as const) {
    test(`an edit to ${db} marks the validator panel 'Results outdated'`, async ({ page }) => {
      await page.evaluate(() => { MapValidator.runPanel(); });
      const sum = page.locator('#val-summary');
      await expect(sum).not.toContainText('outdated');
      await page.evaluate((d) => {
        if (d === 'HexDB') HexDB.addEntries([{ id: 'Fresh_Hex_1', type: 'Plains', spriteName: '' }]);
        else BldDB.addEntries([{ id: 'Fresh_Bld_1', buildingCategory: 'Other' }]);
      }, db);
      await expect(sum).toContainText('outdated');
    });
  }
});

// ---- B4: layout ----
import { openEditor } from './helpers';

test.describe('B4 layout', () => {
  async function start(page: Page, w: number, h: number) {
    await page.setViewportSize({ width: w, height: h });
    await openEditor(page, { storage: { rightPanelMode: 'auto' } });
    await page.evaluate(() => {
      // every Canvas.resize() assigns canvas.width exactly once: count those assignments (the instance setter delegates to the real one)
      const c = document.getElementById('map-canvas') as HTMLCanvasElement;
      const desc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')!;
      (window as any).__resizes = 0;
      Object.defineProperty(c, 'width', { configurable: true, get() { return desc.get!.call(c); }, set(v) { (window as any).__resizes++; desc.set!.call(c, v); } });
    });
  }
  const resizes = (page: Page) => page.evaluate(() => (window as any).__resizes as number);

  test('a window resize across the 1920 px threshold re-measures the canvas ONCE (not once per listener)', async ({ page }) => {
    await start(page, 1800, 900);
    expect(await page.evaluate(() => RightPanel.getEffective())).toBe('rail');
    await page.setViewportSize({ width: 2000, height: 900 });                       // rail -> inline: the layout class changes
    await expect.poll(() => page.evaluate(() => RightPanel.getEffective())).toBe('inline');
    await page.waitForTimeout(100);
    expect(await resizes(page)).toBe(1);
    const w = await page.evaluate(() => (document.getElementById('map-canvas') as HTMLCanvasElement).width);
    expect(w).toBe(2000 - 2 * 220);                                                   // and the canvas really follows the new layout
  });

  test('positive controls: a resize that stays on one side of the threshold, and the panel toggle, each re-measure once', async ({ page }) => {
    await start(page, 1800, 900);
    await page.setViewportSize({ width: 1700, height: 900 });
    await page.waitForTimeout(100);
    expect(await resizes(page)).toBe(1);
    await page.evaluate(() => { (window as any).__resizes = 0; RightPanel.toggle(); });
    expect(await resizes(page)).toBe(1);
  });

  test('scrolling the toolbar closes the open MORE dropdown and re-places the hovered tooltip', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 700 });
    await openEditor(page, { storage: { rightPanelMode: 'auto' } });
    expect(await page.evaluate(() => { const t = document.getElementById('toolbar')!; return t.scrollWidth > t.clientWidth + 100; })).toBe(true);   // there is something to scroll
    // MORE dropdown
    await page.locator('#tab-more').scrollIntoViewIfNeeded();
    await page.locator('#tab-more').click();
    await expect(page.locator('#more-dropdown')).toHaveClass(/open/);
    await page.evaluate(() => { const t = document.getElementById('toolbar')!; t.scrollLeft += t.scrollLeft > 150 ? -120 : 120; });
    await expect(page.locator('#more-dropdown')).not.toHaveClass(/open/);                 // RED before B4: it stayed open, detached from its tab
    // tooltip: hover a button, scroll 8 px (the pointer stays on it), the tooltip must follow the button
    await page.evaluate(() => { document.getElementById('toolbar')!.scrollLeft = 0; });
    const btn = page.locator('#map-tools .tool-btn').first();
    await btn.scrollIntoViewIfNeeded();
    await btn.hover();
    await page.evaluate(() => { const t = document.getElementById('toolbar')!; t.scrollLeft += t.scrollLeft + 8 < t.scrollWidth - t.clientWidth ? 8 : -8; });   // the pointer stays on the same button
    await expect.poll(() => page.evaluate(() => {
      const hov = document.querySelector('#toolbar .tool-btn:hover');
      const tip = hov && (hov.querySelector('.tooltip') as HTMLElement | null);
      if (!tip) return 'no hovered tooltip';
      const r = hov!.getBoundingClientRect(), t = tip.getBoundingClientRect();
      return Math.abs((t.left + t.width / 2) - (r.left + r.width / 2)) < 2 && Math.abs(t.top - (r.bottom + 6)) < 2 ? 'ok' : `off by ${Math.round(t.left + t.width / 2 - (r.left + r.width / 2))},${Math.round(t.top - r.bottom)}`;
    })).toBe('ok');
  });

  test('the minimap buttons are disabled with an explanation while the right panel is collapsed, and work again when it opens', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openEditor(page, { storage: { rightPanelMode: 'auto' } });
    const info = () => page.evaluate(() => ['mm-size-btn', 'mm-zones-btn', 'mm-settle-btn'].map(id => { const b = document.getElementById(id) as HTMLButtonElement; return [b.disabled, b.title]; }));
    expect(await page.evaluate(() => RightPanel.getEffective())).toBe('rail');
    const collapsed = await info();
    for (const [dis, title] of collapsed) { expect(dis).toBe(true); expect(title).toBe('Expand the right panel to see the minimap'); }
    const before = await page.evaluate(() => Canvas.isMinimapBig());
    await page.locator('#mm-size-btn').click({ force: true });                             // a disabled button changes nothing
    expect(await page.evaluate(() => Canvas.isMinimapBig())).toBe(before);
    await page.evaluate(() => RightPanel.toggle());                                       // expanded (drawer on this narrow window)
    expect(await page.evaluate(() => RightPanel.getEffective())).toBe('drawer');
    const open = await info();
    for (const [dis, title] of open) { expect(dis).toBe(false); expect(title).not.toMatch(/Expand the right panel/); expect(title.length).toBeGreaterThan(10); }
    await page.locator('#mm-size-btn').click();
    expect(await page.evaluate(() => Canvas.isMinimapBig())).toBe(!before);               // positive control: it works when the minimap is visible
    await page.evaluate(() => RightPanel.toggle());                                       // collapse again: disabled again, original titles restored on the next open
    expect((await info()).every(([d]) => d === true)).toBe(true);
  });
});

// ---- B5: generation and placement ----
test.describe('B5 generate into selection, placement, edge resolver', () => {
  const MARK = 'BrokenRails_1';
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  for (const [kind, tweak] of [['water', 'p.mThr = 9; p.hThr = 8; p.wThr = 2; p.rivers = 0; p.gold = false; p.oil = false;'], ['mountain', 'p.mThr = -1; p.rivers = 0; p.gold = false; p.oil = false;']] as const) {
    test(`a selection covering the city never changes the city cell (generated ${kind} everywhere else)`, async ({ page }) => {
      const r = await page.evaluate(async ([MARK, tweak]) => {
        mapData.fill(MARK);
        const cc = getCityCol(), cr = getCityRow();
        const p = Generator._buildJob().p;
        new Function('p', tweak as string)(p);
        const all = new Uint8Array(MAP_WIDTH * MAP_HEIGHT).fill(1);
        const n = await Generator.applyToRegion(all, p, 0);
        const around = HexUtils.neighbors(cc, cr, MAP_WIDTH, MAP_HEIGHT).map((q: any) => mapData[q.row * MAP_WIDTH + q.col]);
        let changed = 0; for (const x of mapData) if (x !== MARK) changed++;
        return { n, city: mapData[cr * MAP_WIDTH + cc], around, changed };
      }, [MARK, tweak]);
      expect(r.n).toBeGreaterThan(0);
      expect(r.changed).toBeGreaterThan(100000);              // positive control: the rest of the selection really was generated
      expect(r.around.every((x: string) => x !== MARK)).toBe(true);   // the neighbours of the city were generated too
      expect(r.city).toBe(MARK);                               // RED before B5: the city cell took the generated terrain
    });
  }

  test('Placement.place refuses while Satellite classification runs (no write, no History step); works once it ends', async ({ page }) => {
    const r = await page.evaluate(() => {
      const cfg = Placement.defaults(); cfg.bunkers.count = 5; cfg.megaCities.count = 0; cfg.artifacts.count = 0; cfg.ores.forEach((o: any) => { o.clusters = 0; });
      const real = Satellite.isBusy;
      (Satellite as any).isBusy = () => true;
      const u0 = History.undoSize(), s0 = settlements.length;
      const refused = Placement.place(cfg, 3);
      const out: any = { refused, steps: History.undoSize() - u0, added: settlements.length - s0 };
      (Satellite as any).isBusy = real;
      const ok = Placement.place(cfg, 3);
      out.okAdded = settlements.length - s0; out.ok = !!ok;
      return out;
    });
    expect(r).toEqual({ refused: false, steps: 0, added: 0, okAdded: 5, ok: true });
    await expect(page.locator('.toast', { hasText: /Satellite/ }).first()).toBeVisible();
  });

  test('artifacts keep their distance from mega cities (spreadPick honours the taken points)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const cfg = Placement.defaults(); cfg.bunkers.count = 0; cfg.ores.forEach((o: any) => { o.clusters = 0; });
      cfg.megaCities.count = 3; cfg.artifacts.count = 1;
      const plan = Placement.plan(cfg, 11);
      const cube = (c: any) => HexUtils.toCube(c.col, c.row, MAP_WIDTH, MAP_HEIGHT);
      const megas = plan.settlements.filter((s: any) => s.type === 'megacity').map(cube);
      const art = plan.objects[0];
      const dMin = (c: any) => Math.min(...megas.map((m: any) => HexUtils.cubeDistance(cube(c), m)));
      // independent reference: the best any admissible cell could do (>= 25 from the city, not a mega city cell)
      const cc = HexUtils.toCube(getCityCol(), getCityRow(), MAP_WIDTH, MAP_HEIGHT);
      let best = 0;
      for (let row = 0; row < MAP_HEIGHT; row++) for (let col = 0; col < MAP_WIDTH; col++) {
        const c = { col, row }; if (HexUtils.cubeDistance(cube(c), cc) < 25) continue;
        best = Math.max(best, dMin(c));
      }
      return { got: dMin(art), best, megas: megas.length };
    });
    expect(r.megas).toBe(3);
    expect(r.got).toBe(r.best);          // RED before B5: a random first pick, blind to the mega cities
  });

  test('bunker spacing counts settlements already on the map (earlier runs, other tools), not only this run', async ({ page }) => {
    const r = await page.evaluate(() => {
      const cfg = Placement.defaults(); cfg.megaCities.count = 0; cfg.artifacts.count = 0; cfg.ores.forEach((o: any) => { o.clusters = 0; });
      cfg.bunkers.count = 30;                                    // spacing = floor(sqrt(land / 30) * 0.7) = 57 on an empty 450x450 map
      settlements.push({ col: 150, row: 150, type: 'settlement' } as any);
      const cube = (c: any) => HexUtils.toCube(c.col, c.row, MAP_WIDTH, MAP_HEIGHT), ex = cube({ col: 150, row: 150 });
      let nearest = Infinity, picks = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const plan = Placement.plan(cfg, seed);
        for (const b of plan.settlements) { picks++; nearest = Math.min(nearest, HexUtils.cubeDistance(cube(b), ex)); }
      }
      return { nearest, picks };
    });
    expect(r.picks).toBeGreaterThan(200);                        // positive control: bunkers were really planned
    expect(r.nearest).toBeGreaterThanOrEqual(55);                // RED before B5: a bunker landed right next to the existing settlement
  });

  test('the edge resolver of region generation takes its flat-water fallbacks from the tile-class roles, not from fixed ids', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const all = HexDB.getAll();
      const i = all.findIndex((h: any) => h.id === 'Water_Dirty_1');
      all.splice(i, 1);                                           // the stock dark water is gone from the Hex DB
      const roles = HexDB.getRoles();
      // isolated directional tiles in open land: no mask matches, so every one takes a fallback
      const cells: any[] = [];
      for (let k = 0; k < 60; k++) { const col = 100 + (k % 10) * 5, row = 100 + Math.floor(k / 10) * 5; mapData[row * MAP_WIDTH + col] = 'River_L_1'; cells.push({ col, row, prev: 'Plain_1' }); }
      Tools.autoResolveEdgesAround(cells);
      const got = new Set(cells.map(c => mapData[c.row * MAP_WIDTH + c.col]));
      const known = (id: string) => HexDB.getAll().some((h: any) => h.id === id);
      return { got: [...got], dark: roles.WATER_DARK, allKnown: [...got].every(known) };
    });
    expect(r.got).not.toContain('Water_Dirty_1');                 // RED before B5: the fixed id came back although the DB no longer has it
    expect(r.allKnown).toBe(true);
    expect(r.got.length).toBeGreaterThan(0);
  });

  test('region generation with the stock dark water removed writes only ids the Hex DB knows', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const all = HexDB.getAll();
      all.splice(all.findIndex((h: any) => h.id === 'Water_Dirty_1'), 1);
      const p = Generator._buildJob().p; p.rivers = 25;
      const cells = HexUtils.discCells(225, 225, 60, MAP_WIDTH, MAP_HEIGHT);
      const n = await Generator.applyToRegion(cells, p, 3);
      const used = new Set<string>(mapData);
      const unknown = [...used].filter(id => !HexDB.getAll().some((h: any) => h.id === id));
      return { n, unknown, water: [...used].filter(id => /^Water/.test(id)) };
    });
    expect(r.n).toBeGreaterThan(1000);
    expect(r.unknown).toEqual([]);
    expect(r.water.length).toBeGreaterThan(0);                    // positive control: the generation produced water
  });
});

// ---- B6: Ctrl+Shift+S, zone rename, polygon preview ----
test.describe('B6 Ctrl+Shift+S', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });
  const settle = (page: Page) => page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 150))));   // lets an async map save (validator gate) finish if one was started

  test('on the HEX DB tab Ctrl+Shift+S saves the Hex DB ONLY; on the MAP tab it saves the map', async ({ page }) => {
    const names: string[] = [];
    page.on('download', d => names.push(d.suggestedFilename()));
    await page.evaluate(() => App.setMode('hexdb'));
    await page.keyboard.press('Control+Shift+S');
    await expect.poll(() => names.length).toBeGreaterThan(0);
    await settle(page);
    expect(names).toEqual(['hex_database.json']);                 // RED before B6: a second download, map_export.json, followed
    names.length = 0;
    await page.evaluate(() => App.setMode('map'));
    await page.keyboard.press('Control+Shift+S');
    await expect.poll(() => names.length).toBeGreaterThan(0);
    await settle(page);
    expect(names).toEqual(['map_export.json']);
  });
});

test.describe('B6 zone rename', () => {
  test('clicking inside the name while renaming keeps the editor, the typed text and the caret; Enter commits what was typed', async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(() => { const id = ZonePainter.addZone('Original'); ZonePainter.setSelectedZoneId(id); ZonePainter._uiRebuildZoneList(); });
    const name = page.locator('#zone-list .zone-name').first();
    await name.dblclick();
    await expect(name).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.type('Bridgehead');                                          // replaces the selected text
    await page.evaluate(() => { (window as any).__span = document.querySelector('#zone-list .zone-name'); });
    await name.click({ position: { x: 4, y: 4 } });                                  // a click INSIDE the name while editing
    expect(await page.evaluate(() => (window as any).__span === document.querySelector('#zone-list .zone-name') && (window as any).__span.isConnected),
      'the same element is still in the list (RED before B6: the list was rebuilt)').toBe(true);
    expect(await page.evaluate(() => (document.querySelector('#zone-list .zone-name') as HTMLElement).contentEditable)).toBe('true');
    expect(await name.textContent()).toBe('Bridgehead');
    await page.keyboard.type('X');                                                   // typing continues in the same editor
    await page.keyboard.press('Enter');
    const stored = await page.evaluate(() => ZonePainter.getZones().map((z: any) => z.name));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toContain('Bridgehead');
    expect(stored[0]).toContain('X');
    expect(stored[0]).not.toBe('Original');
    // positive control: a click on a row that is NOT being edited still selects the zone and rebuilds the list
    await page.evaluate(() => { ZonePainter.addZone('Second'); ZonePainter._uiRebuildZoneList(); });
    await page.locator('#zone-list .zone-item').nth(1).click({ position: { x: 100, y: 4 } });
    expect(await page.evaluate(() => ZonePainter.getSelectedZoneId() === ZonePainter.getZones()[1].id)).toBe(true);
  });
});

test.describe('B6 polygon preview', () => {
  test('a polygon preview update computes the polygon cells ONCE, and the preview shows the same cells as before', async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(() => { Tools.setActive('polygon'); });
    await clickCell(page, 221, 220); await clickCell(page, 228, 222); await clickCell(page, 225, 229);
    const p = await cellPoint(page, 222, 226);
    await page.evaluate(() => {
      const w = window as any; w.__calls = 0;
      const orig = HexUtils.polygonCells;
      HexUtils.polygonCells = function (...a: any[]) { w.__calls++; return (orig as any).apply(this, a); } as any;
    });
    const calls = () => page.evaluate(() => (window as any).__calls as number);
    await page.mouse.move(p.x - 60, p.y - 40);                                       // another cell: one preview update
    const afterOne = await calls();
    await page.mouse.move(p.x, p.y);                                                 // and another: a second update
    const afterTwo = await calls();
    expect(await page.evaluate(() => Canvas.hasHighlight('shape'))).toBe(true);       // positive control: a preview really was drawn
    expect(afterOne).toBeGreaterThanOrEqual(1);                                       // ...by a real polygon computation
    expect(afterOne, 'one update, one computation (RED before B6: two)').toBe(1);
    expect(afterTwo - afterOne).toBe(1);
  });
});
