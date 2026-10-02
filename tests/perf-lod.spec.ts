import { test, expect, type Page } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, hashCanvas, checkBaseline } from './perf-scene';

declare const Canvas: any, Terrain: any, IO: any, History: any, Tools: any, UI: any, Generator: any;
declare let mapData: string[], MAP_WIDTH: number, MAP_HEIGHT: number;
declare const roadsData: any, objectsData: any, settlements: any[], bridgesData: any[];
test.use({ viewport: VIEWPORT });

// Cheap bare 450x450 map: the overview paths never need sprites.
const bigMap = (page: Page) => page.evaluate(() => IO.newMap(true));

// In-page helper: render, then count the tiles whose centre pixel is not the colour table colour of their id.
// Tiles with overlays (roads, objects, settlements, bridges) and tiles near `near` (the brush cursor) are skipped.
const DEFINE_CHECK = `window.__viewBad = (near) => {
  Canvas.render();
  const cv = document.getElementById('map-canvas'), W = cv.width, H = cv.height;
  const d = Canvas.getCtx().getImageData(0, 0, W, H).data;
  const skip = new Set([...Object.keys(roadsData), ...Object.keys(objectsData),
    ...settlements.map(s => s.col + ',' + s.row), ...bridgesData.map(b => b.col + ',' + b.row)]);
  let bad = 0, n = 0;
  for (let row = 0; row < MAP_HEIGHT; row++) for (let col = 0; col < MAP_WIDTH; col++) {
    if (near && Math.abs(col - near[0]) <= 3 && Math.abs(row - near[1]) <= 3) continue;
    if (skip.has(col + ',' + row)) continue;
    const p = Canvas.hexScreenPos(col, row), x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 32 || x >= W - 4 || y < 24 || y >= H - 4) continue;   // outside the free area (ruler strips)
    const c = Terrain.color(mapData[row * MAP_WIDTH + col]), o = (y * W + x) * 4;
    n++;
    if (d[o] !== c[0] || d[o + 1] !== c[1] || d[o + 2] !== c[2]) bad++;
  }
  return { bad, n };
};`;
// Overview checks run at zoom 9 (just below the threshold; tiles are ~5 px wide so centre sampling is exact).
async function overviewPrep(page: Page, zoom = 9) {
  await openEditor(page);
  await bigMap(page);
  await page.evaluate(DEFINE_CHECK);
  await page.evaluate(z => { Canvas.toggleRulers(); Canvas.setZoom(z); Canvas.centerOnCity(); }, zoom);   // no block grid / strips over the tiles
}
const view = (page: Page, near?: number[]) => page.evaluate(n => (window as any).__viewBad(n), near ?? null);
// Screen position (page coordinates) of a tile.
const tilePos = (page: Page, col: number, row: number) => page.evaluate(([c, r]) => {
  const p = Canvas.hexScreenPos(c, r), b = document.getElementById('map-canvas')!.getBoundingClientRect();
  return { x: b.left + p.x, y: b.top + p.y };
}, [col, row]);
const cityTile = (page: Page) => page.evaluate(() => ({ cc: Math.floor(MAP_WIDTH / 2), cr: Math.floor((MAP_HEIGHT - 1) / 2) }));

// Fresh page per zoom, exactly like perf-equivalence: the raster output depends on the preceding render history.
for (const z of [25, 60, 100, 200]) {
  test(`zoom ${z}% stays pixel-identical (LOD 0)`, async ({ page }) => {
    await openEditor(page);
    await setupScene(page);
    await frame(page, z);
    expect(await page.evaluate(() => Canvas.getStats().lod)).toBe(0);
    checkBaseline(`render_${z}`, await hashCanvas(page, '#map-canvas'));
  });
}

test('LOD level is a pure function of zoom and switches off again when zooming back in', async ({ page }) => {
  await openEditor(page);
  await bigMap(page);
  const r = await page.evaluate(() => {
    const out: any[] = [];
    const floor = Canvas.minZoom();
    for (const z of [30, 25, 24, 10, 9, floor, 9, 10, 24, 25, 30]) {
      Canvas.setZoom(z); Canvas.render();
      out.push([Canvas.getZoom(), Canvas.getStats().lod]);
    }
    return { out, floor };
  });
  expect(r.floor).toBeLessThan(9);
  expect(r.out.map((o: number[]) => o[1])).toEqual([0, 0, 1, 1, 2, 2, 2, 1, 1, 0, 0]);
  expect(r.out.map((o: number[]) => o[0])).toEqual([30, 25, 24, 10, 9, r.floor, 9, 10, 24, 25, 30]);
});

test('flat overview: every tile pixel equals the colour table colour, odd and even columns alike', async ({ page }) => {
  await overviewPrep(page);
  const info = await page.evaluate(() => {
    const seen = new Set<string>(), ids: string[] = [];
    for (const i of ['Plain_1', 'Forest_1', 'Water_1', 'Mountain_1', 'Hills_1', 'Rubble_1', 'Swamp_1', 'Lava_Plain_1', 'Rift_1', 'Barren_1', 'Water_Dirty_1'])
      if (!seen.has(Terrain.color(i).join())) { seen.add(Terrain.color(i).join()); ids.push(i); }
    ids.length = Math.min(ids.length, 6);
    const cols = new Set(ids.map(i => Terrain.color(i).join()));
    for (let r = 0; r < MAP_HEIGHT; r++) for (let c = 0; c < MAP_WIDTH; c++) mapData[r * MAP_WIDTH + c] = ids[(c * 7 + r * 3) % ids.length];
    return { distinct: cols.size };
  });
  expect(info.distinct).toBe(6);   // the pattern below would hide a misregistration if colours repeated
  const res = await view(page);
  expect(res.n).toBeGreaterThan(2000);
  expect(res.bad).toBe(0);
});

test('flat overview at the floor: block of known tiles sits where the hexes are', async ({ page }) => {
  await openEditor(page);
  await bigMap(page);
  const r = await page.evaluate(() => {
    mapData.fill('Water_1');
    const cc = Math.floor(MAP_WIDTH / 2), cr = Math.floor((MAP_HEIGHT - 1) / 2);
    for (let dr = -20; dr <= 20; dr++) for (let dc = -20; dc <= 20; dc++) mapData[(cr + dr) * MAP_WIDTH + cc + dc] = 'Forest_1';
    Canvas.fitToScreen(); Canvas.render();
    const ctx = Canvas.getCtx();
    const px = (col: number, row: number) => {
      const p = Canvas.hexScreenPos(col, row);
      return Array.from(ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data.slice(0, 3));
    };
    return { zoom: Canvas.getZoom(), lod: Canvas.getStats().lod, inside: px(cc + 10, cr + 10), outside: px(cc + 120, cr + 120),
             edgeIn: px(cc + 20, cr), edgeOut: px(cc + 24, cr),
             forest: Terrain.color('Forest_1'), water: Terrain.color('Water_1') };
  });
  expect(r.lod).toBe(2);
  expect(r.zoom).toBeLessThan(5);
  expect(r.inside).toEqual(r.forest);
  expect(r.outside).toEqual(r.water);
  expect(r.edgeIn).toEqual(r.forest);
  expect(r.edgeOut).toEqual(r.water);
});

test('overview is incremental: unchanged frame recolours nothing, one edited tile recolours one pixel', async ({ page }) => {
  await openEditor(page);
  await bigMap(page);
  const r = await page.evaluate(() => {
    Canvas.fitToScreen();   // first overview frame: full build
    const first = Canvas.getStats().overviewRecolored;
    Canvas.render(); const none = Canvas.getStats().overviewRecolored;
    mapData[1000] = 'Lava_Plain_1';
    Canvas.render(); const one = Canvas.getStats().overviewRecolored;
    const s = Canvas.getStats();
    return { first, none, one, drawn: s.tilesDrawn, visited: s.tilesVisited, lod: s.lod, mm: s.minimapRecolored };
  });
  expect(r.lod).toBe(2);
  expect(r.first).toBe(202500);
  expect(r.none).toBe(0);
  expect(r.one).toBe(1);
  expect(r.drawn).toBe(0);     // no per-tile sprite work in the flat overview
  expect(r.visited).toBe(0);
});

test('overview follows in-place writes and bulk fills', async ({ page }) => {
  await overviewPrep(page);
  expect((await view(page)).bad).toBe(0);
  const { cc, cr } = await cityTile(page);
  await page.evaluate(([c, r]) => { mapData[(r + 5) * MAP_WIDTH + c + 7] = 'Lava_Plain_1'; mapData[(r - 9) * MAP_WIDTH + c - 3] = 'Rift_1'; }, [cc, cr]);
  expect((await view(page)).bad).toBe(0);
  await page.evaluate(() => mapData.fill('Water_1'));
  expect((await view(page)).bad).toBe(0);
  await page.evaluate(() => { for (let i = 0; i < mapData.length; i += 3) mapData[i] = 'Rift_1'; });
  expect((await view(page)).bad).toBe(0);
});

test('a real click paints one tile at the floor and the overview shows it', async ({ page }) => {
  await openEditor(page);
  await bigMap(page);
  await page.evaluate(DEFINE_CHECK);
  await page.evaluate(() => { Canvas.toggleRulers(); Canvas.fitToScreen(); Tools.setActive('paint'); UI.selectTerrain('Forest_1'); });
  const { cc, cr } = await cityTile(page);
  // mouse events carry whole pixels and a tile is ~1 px at 2%: derive the expected tile from the pixel actually clicked
  const t = await page.evaluate(([c, r]) => {
    const p = Canvas.hexScreenPos(c, r), b = document.getElementById('map-canvas')!.getBoundingClientRect();
    const x = Math.round(b.left + p.x), y = Math.round(b.top + p.y);
    return { x, y, tile: Canvas.screenToHex(x - b.left, y - b.top), zoom: Canvas.getZoom() };
  }, [cc + 30, cr + 20]);
  expect(t.zoom).toBeLessThan(5);
  expect(Math.abs(t.tile.col - (cc + 30))).toBeLessThanOrEqual(2);   // the hit-test lands on (about) the tile under the pixel
  await page.mouse.click(t.x, t.y);
  const r = await page.evaluate(([c, r]) => ({
    painted: mapData[r * MAP_WIDTH + c], forest: mapData.filter(x => x === 'Forest_1').length,
  }), [t.tile.col, t.tile.row]);
  expect(r.painted).toBe('Forest_1');
  expect(r.forest).toBe(1);   // the default brush paints exactly one tile
  // at a zoom where a tile is several pixels wide the painted tile shows its colour (cursor parked far away)
  await page.evaluate(() => { Canvas.setZoom(9); Canvas.centerOnCity(); });
  const far = await tilePos(page, cc - 40, cr - 30);
  await page.mouse.move(far.x, far.y);
  expect((await view(page, [cc - 40, cr - 30])).bad).toBe(0);
  const px = await page.evaluate(([c, r]) => {
    const p = Canvas.hexScreenPos(c, r);
    return Array.from(Canvas.getCtx().getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data.slice(0, 3));
  }, [t.tile.col, t.tile.row]);
  expect(px).toEqual(await page.evaluate(() => Terrain.color('Forest_1')));
});

test('Fill and Rectangle tools update the overview', async ({ page }) => {
  await overviewPrep(page);
  const { cc, cr } = await cityTile(page);
  await page.evaluate(() => { UI.selectTerrain('Forest_1'); Tools.setActive('rect'); });
  const a = await tilePos(page, cc - 10, cr - 5), b = await tilePos(page, cc + 10, cr + 5);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2); await page.mouse.move(b.x, b.y);
  // while dragging at lod 2 the preview is one outline: the frame still renders
  expect(await page.evaluate(() => { Canvas.render(); return Canvas.getStats().lod; })).toBe(2);
  await page.mouse.up();
  const inside = await page.evaluate(([c, r]) => mapData[(r + 2) * MAP_WIDTH + c + 3], [cc, cr]);
  expect(inside).toBe('Forest_1');
  expect((await view(page, [cc + 10, cr + 5])).bad).toBe(0);
  // fill
  await page.evaluate(() => { UI.selectTerrain('Water_1'); });
  await page.evaluate(async ([c, r]) => { Tools.setActive('fill'); await Tools.fill(c, r); }, [cc, cr]);
  expect(await page.evaluate(([c, r]) => mapData[r * MAP_WIDTH + c], [cc, cr])).toBe('Water_1');
  expect((await view(page, [cc + 10, cr + 5])).bad).toBe(0);   // the hover ring still sits on the last mouse tile
});

test('overview follows undo and redo', async ({ page }) => {
  await overviewPrep(page);
  await page.evaluate(() => { History.push(); mapData.fill('Lava_Plain_1'); });
  expect((await view(page)).bad).toBe(0);
  await page.evaluate(() => History.undo());
  expect((await view(page)).bad).toBe(0);
  expect(await page.evaluate(() => mapData[0])).not.toBe('Lava_Plain_1');
  await page.evaluate(() => History.redo());
  expect((await view(page)).bad).toBe(0);
  expect(await page.evaluate(() => mapData[0])).toBe('Lava_Plain_1');
});

test('overview follows New Map, Load, Expand, autosave restore and reassigned map data', async ({ page }) => {
  await overviewPrep(page);
  await page.evaluate(() => { mapData.fill('Water_1'); });
  expect((await view(page)).bad).toBe(0);
  // reassign (same size)
  await page.evaluate(() => { mapData = mapData.map((id, i) => (i % 5 ? id : 'Lava_Plain_1')); });
  expect((await view(page)).bad).toBe(0);
  // Load
  await page.evaluate(() => {
    const j = JSON.parse(IO.getMapJson());
    j.data = j.data.map((row: string[]) => row.map((x: string, i: number) => (i % 3 ? x : 'Rift_1')));
    IO.loadFromJSON(j);
  });
  expect((await view(page)).bad).toBe(0);
  // autosave restore
  const restored = await page.evaluate(async () => {
    const j = JSON.parse(IO.getMapJson());
    j.data = j.data.map((row: string[]) => row.map((x: string, i: number) => (i % 4 ? x : 'Forest_1')));
    return await IO.tryRestoreAutosave(JSON.stringify(j));
  });
  expect(restored).toBeTruthy();
  expect((await view(page)).bad).toBe(0);
  // New Map (a smaller size changes the layer key and re-clamps the zoom, so force the flat overview)
  await page.evaluate(() => { Canvas._test.setLod(2); IO.setNewMapSize(100, 100); IO.applyNewMap(); mapData.fill('Mountain_1'); });
  expect(await page.evaluate(() => Canvas.getStats().lod)).toBe(2);
  const r2 = await view(page);
  expect(r2.n).toBeGreaterThan(500);
  expect(r2.bad).toBe(0);
  // Expand (adds tiles on all four sides: another size change)
  await page.evaluate(() => { mapData[5 * MAP_WIDTH + 5] = 'Lava_Plain_1'; IO.openExpandMap(); IO.applyExpandMap(); });
  expect(await page.evaluate(() => MAP_WIDTH)).toBeGreaterThan(100);
  expect((await view(page)).bad).toBe(0);
});

test('overview follows Generator apply', async ({ page }) => {
  test.setTimeout(120000);
  await openEditor(page);
  await page.evaluate(() => { IO.setNewMapSize(100, 100); IO.applyNewMap(); });
  await page.evaluate(DEFINE_CHECK);
  await page.evaluate(() => { Canvas.toggleRulers(); Canvas._test.setLod(2); Canvas.fitToScreen(); });
  const before = await page.evaluate(() => mapData.join().length);
  await page.evaluate(async () => { await Generator.apply(); });
  const changed = await page.evaluate(() => {
    for (const k of Object.keys(roadsData)) delete roadsData[k];       // overlays are not under test here
    for (const k of Object.keys(objectsData)) delete objectsData[k];
    bridgesData.length = 0;
    return new Set(mapData).size;
  });
  expect(changed).toBeGreaterThan(2);
  expect(before).toBeGreaterThan(0);
  const r = await view(page);
  expect(r.n).toBeGreaterThan(500);
  expect(r.bad).toBe(0);
});

test('edge tiles can be panned clear of the ruler strips at the floor', async ({ page }) => {
  await openEditor(page);
  await bigMap(page);
  const r = await page.evaluate(() => {
    const cv = document.getElementById('map-canvas') as HTMLCanvasElement;
    const out: any = {};
    for (const z of ['floor']) {
      Canvas.setZoom(Canvas.minZoom());
      const rad = 40 * Canvas.getZoom() / 100;
      const ext = (cx: number, cy: number) => {
        Canvas._test.setCamera(cx, cy); Canvas.clampCamera();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [c, r] of [[0, 0], [MAP_WIDTH - 1, 0], [0, MAP_HEIGHT - 1], [MAP_WIDTH - 1, MAP_HEIGHT - 1], [MAP_WIDTH - 1, 1], [MAP_WIDTH - 1, 2], [1, MAP_HEIGHT - 1], [2, MAP_HEIGHT - 1]]) {
          const p = Canvas.hexScreenPos(c, r);
          minX = Math.min(minX, p.x - rad); minY = Math.min(minY, p.y - rad);
          maxX = Math.max(maxX, p.x + rad); maxY = Math.max(maxY, p.y + rad);
        }
        return { minX, minY, maxX, maxY };
      };
      out[z] = { tl: ext(-1e7, -1e7), br: ext(1e7, 1e7), cw: cv.width, ch: cv.height };
    }
    return out;
  });
  for (const z of ['floor']) {
    const o = r[z];
    // top-left: the outermost tile box clears the strips (RULER_LEFT 28, RULER_TOP 20)
    expect(o.tl.minX, `${z}: left`).toBeGreaterThanOrEqual(28);
    expect(o.tl.minY, `${z}: top`).toBeGreaterThanOrEqual(20);
    // bottom-right: inside the canvas
    expect(o.br.maxX, `${z}: right`).toBeLessThanOrEqual(o.cw);
    expect(o.br.maxY, `${z}: bottom`).toBeLessThanOrEqual(o.ch);
  }
});

test('performance: flat overview is >= 5x faster than the full sprite path at the floor, edits stay cheap', async ({ page }) => {
  test.setTimeout(180000);
  await openEditor(page);
  await setupScene(page);
  const r = await page.evaluate(() => {
    Canvas.fitToScreen();
    const time = (n: number) => {
      const t: number[] = [];
      for (let i = 0; i < n; i++) { const s = performance.now(); Canvas.render(); Canvas.getCtx().getImageData(0, 0, 1, 1); t.push(performance.now() - s); }
      return t.sort((a, b) => a - b);
    };
    Canvas.render();   // warm: builds the layer
    const lodT = time(15), lodMs = lodT[7], lodStats = Canvas.getStats();
    // paint-then-render latency: one edited tile per frame
    const edit: number[] = [];
    for (let i = 0; i < 15; i++) {
      mapData[2000 + i * 37] = mapData[2000 + i * 37] === 'Lava_Plain_1' ? 'Rift_1' : 'Lava_Plain_1';
      const s = performance.now(); Canvas.render(); Canvas.getCtx().getImageData(0, 0, 1, 1); edit.push(performance.now() - s);
    }
    edit.sort((a, b) => a - b);
    const editStats = Canvas.getStats();
    Canvas._test.setLod(false);
    const fullT = time(2), fullMs = fullT[0];   // two ~1 s renders; the faster one is compared (conservative)
    const fullStats = Canvas.getStats();
    Canvas._test.setLod(null);
    return { zoom: Canvas.getZoom(), lodMs, editMs: edit[7], fullMs, lodStats, editStats, fullStats };
  });
  console.log(`floor ${r.zoom}%: lod ${r.lodMs.toFixed(1)} ms, edit+render ${r.editMs.toFixed(1)} ms, full sprite path ${r.fullMs.toFixed(0)} ms`);
  // deterministic work counters
  expect(r.lodStats.lod).toBe(2);
  expect(r.lodStats.tilesDrawn).toBe(0);
  expect(r.lodStats.tilesVisited).toBe(0);
  expect(r.editStats.overviewRecolored).toBe(1);
  expect(r.fullStats.lod).toBe(0);
  expect(r.fullStats.tilesDrawn).toBe(202500);
  // machine-independent ratios
  expect(r.lodMs * 5, `lod ${r.lodMs} vs full ${r.fullMs}`).toBeLessThanOrEqual(r.fullMs);
  expect(r.editMs * 5, `edit ${r.editMs} vs full ${r.fullMs}`).toBeLessThanOrEqual(r.fullMs);
});

test('performance: simple sprites (LOD 1) draw the same tiles faster than the full path', async ({ page }) => {
  test.setTimeout(120000);
  await openEditor(page);
  await setupScene(page);
  await frame(page, 12);
  const r = await page.evaluate(() => {
    const time = (n: number) => {
      const t: number[] = [];
      for (let i = 0; i < n; i++) { const s = performance.now(); Canvas.render(); Canvas.getCtx().getImageData(0, 0, 1, 1); t.push(performance.now() - s); }
      return t.sort((a, b) => a - b)[n >> 1];
    };
    time(3);
    const lod1 = time(9), s1 = Canvas.getStats();
    Canvas._test.setLod(false);
    const full = time(9), s0 = Canvas.getStats();
    Canvas._test.setLod(null);
    return { lod1, full, s1, s0 };
  });
  expect(r.s1.lod).toBe(1);
  expect(r.s0.lod).toBe(0);
  expect(r.s1.tilesDrawn).toBe(r.s0.tilesDrawn);   // same visible tile set, cheaper per tile
  expect(r.s1.tilesDrawn).toBeGreaterThan(1000);
  expect(r.lod1 * 1.5, `lod1 ${r.lod1} vs full ${r.full}`).toBeLessThanOrEqual(r.full);
});
