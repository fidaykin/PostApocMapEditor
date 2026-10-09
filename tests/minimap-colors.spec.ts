import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { FakeGitHub, openEditor, ROOT, seedServerPackage } from './helpers';
import { freshEditor } from './editor-helpers';

// Minimap / flat-overview colours for tiles that have no entry in Terrain's explicit colour table.
// Owner report (2026-10-07): 72 of 90 base tiles and all 60 Decameroon tiles fell back to GREEN, so water and lakes were
// green on the minimap and in the zoomed-out overview. The fallback now derives the colour from the HexDB `type` and, once
// the sprite has loaded, from the sprite's dominant opaque colour. Explicit table entries are untouched.
// References are computed HERE from the sprite files (full-resolution mean of the fully opaque pixels in a fresh canvas),
// never from the editor's code. The perf specs run with the fallback switched off (tests/helpers.ts) so their pinned
// hashes stay valid; these specs run with the real-user default (on).

const SPRITE_DIR = path.join(ROOT, 'packages/postapoc/sprites/hex');

// ── a tiny PNG writer (RGBA 8-bit) ──
const CRC = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** 32x32: inner 24x24 opaque `fill`; the 4 px rim is a semi-transparent (alpha 100) pure-green decal that must NOT count. */
function solidPng(fill: [number, number, number]): Buffer {
  const N = 32, raw = Buffer.alloc(N * (N * 4 + 1));
  for (let y = 0; y < N; y++) {
    raw[y * (N * 4 + 1)] = 0;
    for (let x = 0; x < N; x++) {
      const inner = x >= 4 && x < N - 4 && y >= 4 && y < N - 4, o = y * (N * 4 + 1) + 1 + x * 4;
      if (inner) { raw[o] = fill[0]; raw[o + 1] = fill[1]; raw[o + 2] = fill[2]; raw[o + 3] = 255; }
      else { raw[o] = 0; raw[o + 1] = 255; raw[o + 2] = 0; raw[o + 3] = 100; }
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const ORANGE: [number, number, number] = [210, 90, 30];
const DEC_HEXES = [
  { id: 'Decameroon_Water_1', type: 'Water', spriteName: 'Decameroon_Water', package: 'decameroon' },
  { id: 'Decameroon_Lake_1', type: 'Rivers', spriteName: 'Decameroon_Lake_1', package: 'decameroon' },
  { id: 'Decameroon_Odd_1', type: 'Water', spriteName: 'Decameroon_Odd_1', package: 'decameroon' },   // water-typed, orange sprite
];
function decPackage(gh: FakeGitHub) {
  seedServerPackage(gh, 'decameroon', {
    hexes: DEC_HEXES,
    sprites: {
      'hex/Decameroon_Water.png': fs.readFileSync(path.join(SPRITE_DIR, 'Water.png')),
      'hex/Decameroon_Lake_1.png': fs.readFileSync(path.join(SPRITE_DIR, 'Lake_1.png')),
      'hex/Decameroon_Odd_1.png': solidPng(ORANGE),
    },
  });
}

const waitSettled = (page: Page) => page.waitForFunction(() => Terrain.pendingSprites() === 0);

/** Independent reference: mean RGB of the fully opaque pixels of a sprite file, full resolution, fresh canvas. */
const refColor = (page: Page, url: string) => page.evaluate(async (u) => {
  const img = new Image(); img.src = u; await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const g = cv.getContext('2d')!; g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
  if (!n) throw new Error('no opaque pixels in ' + u);
  return [r / n, gg / n, b / n];
}, url);

/** Paints a 9x9 block of `id` at (c0,r0) straight into mapData and returns the minimap pixel / overview pixel of its middle cell. */
const block = (page: Page, id: string, c0: number, r0: number) => page.evaluate(([i, c, r]) => {
  for (let dr = 0; dr < 9; dr++) for (let dc = 0; dc < 9; dc++) mapData[(r + dr) * MAP_WIDTH + (c + dc)] = i;
  return null;
}, [id, c0, r0] as const);
/** The block's colour on the drawn minimap: the most common pixel over its cells (block-grid lines cross a few of them). */
const mmPixel = (page: Page, col: number, row: number) => page.evaluate(([c, r]) => {
  Canvas.drawMinimap();
  const mc = document.getElementById('minimap') as HTMLCanvasElement, g = mc.getContext('2d')!;
  const counts = new Map<string, number>();
  for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
    const x = Math.floor((MAP_HEIGHT - 1 - (r + dr) + 0.5) / MAP_HEIGHT * mc.width), y = Math.floor((MAP_WIDTH - 1 - (c + dc) + 0.5) / MAP_WIDTH * mc.height);
    const k = Array.from(g.getImageData(x, y, 1, 1).data).slice(0, 3).join(',');
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
}, [col, row]);
/** Flat overview (LOD 2) layer pixel of a cell: documented flip px = MAP_HEIGHT-1-row, py = MAP_WIDTH-1-col. */
const ovPixel = (page: Page, col: number, row: number) => page.evaluate(([c, r]) => {
  const cv = Canvas._test.overviewLayer() as HTMLCanvasElement;
  return Array.from(cv.getContext('2d')!.getImageData(MAP_HEIGHT - 1 - r, MAP_WIDTH - 1 - c, 1, 1).data).slice(0, 3);
}, [col, row]);

const bluish = (c: number[]) => c[2] > c[0] + 15 && c[2] > c[1] + 5;
const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const stats = (page: Page) => page.evaluate(() => Terrain.spriteColorStats());

test.describe('minimap / overview fallback colours', () => {
  test('base water, lakes and rivers are blue-ish on the minimap and in the overview, close to their sprite colour; green is gone', async ({ page }) => {
    await freshEditor(page);
    await waitSettled(page);
    expect(await page.evaluate(() => Terrain.SPRITE_FALLBACK_COLORS)).toBe(true);
    const tiles: [string, string][] = [['Water_1', 'Water'], ['Water_Dirty_1', 'DirtyWater'], ['Lake_1', 'Lake_1'], ['Lake_4', 'Lake_4'], ['Lake_7', 'Lake_7']];
    let c0 = 20;
    for (const [id, sprite] of tiles) {
      await block(page, id, c0, 20);
      const want = await refColor(page, `packages/postapoc/sprites/hex/${sprite}.png`);
      const mm = await mmPixel(page, c0 + 4, 24), ov = await ovPixel(page, c0 + 4, 24);
      expect(bluish(mm), `${id} minimap ${mm} (sprite mean ${want.map(Math.round)})`).toBe(true);
      expect(bluish(ov), `${id} overview ${ov}`).toBe(true);
      expect(near(mm, want, 24), `${id} minimap ${mm} vs sprite mean ${want.map(Math.round)}`).toBe(true);
      expect(ov).toEqual(mm);   // same colour table feeds both
      c0 += 12;
    }
  });

  test('river pieces take their sprite colour (land banks included), not the old green', async ({ page }) => {
    await freshEditor(page);
    await waitSettled(page);
    let c0 = 20;
    for (const id of ['River_L_1', 'River_R_1', 'River_D_2', 'River_U_3']) {
      const sprite = await page.evaluate(i => HexDB.getAll().find((h: any) => h.id === i).spriteName, id);
      await block(page, id, c0, 60);
      const want = await refColor(page, `packages/postapoc/sprites/hex/${sprite}.png`);
      const mm = await mmPixel(page, c0 + 4, 64);
      expect(near(mm, want, 24), `${id} ${mm} vs sprite mean ${want.map(Math.round)}`).toBe(true);
      expect(near(mm, [120, 155, 85], 6), `${id} must not be the old fallback green`).toBe(false);
      c0 += 12;
    }
  });

  test('a lake drawn in the flat overview (LOD 2, the real canvas) is blue-ish, not green', async ({ page }) => {
    await freshEditor(page);
    await waitSettled(page);
    const px = await page.evaluate(() => {
      mapData.fill('Plain_1');
      for (let r = 200; r < 240; r++) for (let c = 200; c < 240; c++) mapData[r * MAP_WIDTH + c] = 'Lake_2';
      Canvas.fitToScreen(); Canvas.render();
      const lod = Canvas.getStats().lod;
      const p = Canvas.hexScreenPos(220, 220), cv = document.getElementById('map-canvas') as HTMLCanvasElement | null ?? document.querySelector('canvas') as HTMLCanvasElement;
      const d = cv.getContext('2d')!.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
      const plain = Canvas.hexScreenPos(100, 100), e = cv.getContext('2d')!.getImageData(Math.round(plain.x), Math.round(plain.y), 1, 1).data;
      return { lod, lake: Array.from(d).slice(0, 3), plain: Array.from(e).slice(0, 3) };
    });
    expect(px.lod).toBe(2);
    expect(bluish(px.lake), `lake ${px.lake}`).toBe(true);
    expect(px.plain).toEqual([120, 155, 85]);   // explicit-table tile in the same frame
  });

  test('Decameroon-shaped water tiles (no explicit entry, cross-origin Pages sprites) are blue-ish; a water-typed tile with an orange sprite shows the sprite colour', async ({ page }) => {
    const gh = new FakeGitHub();
    decPackage(gh);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openEditor(page, { gh });
    await waitSettled(page);
    await page.evaluate(() => { IO.newMap(true); });
    expect(await page.evaluate(() => HexDB.getAll().filter((h: any) => h.package === 'decameroon').length)).toBe(3);
    let c0 = 20;
    for (const [id, file] of [['Decameroon_Water_1', 'Water'], ['Decameroon_Lake_1', 'Lake_1']]) {
      await block(page, id, c0, 20);
      const want = await refColor(page, `packages/postapoc/sprites/hex/${file}.png`);
      const mm = await mmPixel(page, c0 + 4, 24);
      expect(bluish(mm), `${id} ${mm}`).toBe(true);
      expect(near(mm, want, 24), `${id} ${mm} vs ${want.map(Math.round)}`).toBe(true);
      c0 += 12;
    }
    // package sprites come from another origin (Pages): their pixels are read through a CORS request, once per file
    expect((await stats(page)).probes).toBeGreaterThanOrEqual(3);
    await block(page, 'Decameroon_Odd_1', c0, 20);
    const mm = await mmPixel(page, c0 + 4, 24), ov = await ovPixel(page, c0 + 4, 24);
    // exactly the opaque interior (the alpha-100 green rim is excluded)
    expect(near(mm, ORANGE, 3), `${mm}`).toBe(true);
    expect(near(ov, ORANGE, 3), `${ov}`).toBe(true);
  });

  test('explicit table tiles keep their exact colours; ids without an entry or a HexDB row keep the old green', async ({ page }) => {
    await freshEditor(page);
    await waitSettled(page);
    const got = await page.evaluate(() => ['Plain_1', 'Forest_1', 'Hills_1', 'Mountain_1', 'Rubble_1', 'Desert_1', 'Lava_Plain_1', 'Swamp_1', 'GoldVein_1', 'Oil_1', 'Rift_1', 'WATER_DARK', 'Not_A_Tile', 'x']
      .map(id => Terrain.color(id)));
    expect(got).toEqual([[120, 155, 85], [50, 115, 50], [100, 120, 90], [150, 150, 150], [100, 85, 65], [210, 185, 120], [170, 70, 20], [50, 80, 50], [200, 170, 25], [50, 50, 50], [35, 25, 25], [42, 70, 100], [120, 155, 85], [120, 155, 85]]);
    expect(await page.evaluate(() => Terrain.color(42 as any))).toEqual([120, 155, 85]);
    // switching the fallback off restores the old behaviour for every id
    const off = await page.evaluate(() => { Terrain.SPRITE_FALLBACK_COLORS = false; const r = [Terrain.color('Water_1'), Terrain.color('Lake_1')]; Terrain.SPRITE_FALLBACK_COLORS = true; return r; });
    expect(off).toEqual([[120, 155, 85], [120, 155, 85]]);
  });

  test('the sprite colour is computed once per sprite: redraws, repeated sprite loads and reads add no work', async ({ page }) => {
    await freshEditor(page);
    await waitSettled(page);
    const s0 = await stats(page);
    // an independent count: every HexDB tile with a sprite that loaded and that has no explicit colour (colour differs from green is not
    // required, so count through the explicit table by name list taken from the documented table keys)
    const explicit = ['water_dark', 'water_light', 'water_rock', 'rubble_1', 'rubble_2', 'rubble_3', 'plain_1', 'plain_2', 'brokenplane_1', 'forest_1', 'forest_2', 'forest_3',
      'hills_1', 'mountain_1', 'goldvein_1', 'oil_1', 'barren_1', 'desert_1', 'swamp_1', 'wetlands_1', 'lava_plain_1', 'lava_rift_1', 'rift_1'];
    const expected = await page.evaluate((ex) => {
      const ids = new Set<string>();
      for (const h of HexDB.getAll()) if (h.spriteName && Terrain.getSprite(h.id) && !ex.includes(h.id.toLowerCase())) ids.add(h.id.toLowerCase());
      return ids.size;
    }, explicit);
    expect(s0.computed).toBe(expected);
    expect(expected).toBeGreaterThan(60);
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) { Canvas.render(); Canvas.drawMinimap(); }
      for (const id of ['Water_1', 'Lake_1', 'Plain_1']) for (let i = 0; i < 50; i++) Terrain.color(id);
      await Terrain.applyHexDbOverrides(HexDB.getAll());   // the same sprites loaded a second time
    });
    await waitSettled(page);
    expect(await stats(page)).toEqual({ ...s0, flushes: s0.flushes + 0 });
  });

  test('a sprite that loads later repaints the minimap and the overview once, batched; overlays and layers are untouched', async ({ page }) => {
    await freshEditor(page);
    await waitSettled(page);
    await page.evaluate(() => { IO.newMap(true); });
    // a water-typed tile whose sprite is not loaded yet: type colour (blue)
    const fixture = { id: 'Late_Water_1', type: 'Water', spriteName: 'Late_Water_1', package: 'postapoc' };
    const url = 'data:image/png;base64,' + solidPng(ORANGE).toString('base64');
    await page.evaluate(([h]) => { HexDB.addEntries([h]); }, [fixture]);
    await block(page, 'Late_Water_1', 30, 30);
    const before = await mmPixel(page, 34, 34);
    expect(bluish(before), `type colour before the sprite loads: ${before}`).toBe(true);
    const ov0 = await page.evaluate(() => ({ ...Canvas.getStats() }));
    const layers0 = await page.evaluate(() => JSON.stringify(['terrain', 'objects', 'roads', 'settlements'].map(k => Layers.isVisible(k))));
    const f0 = (await stats(page)).flushes, c0 = (await stats(page)).computed;
    await page.evaluate(async ([u]) => {
      Terrain.registerUploadedUrls({ Late_Water_1: u });
      await Terrain.applyHexDbOverrides([HexDB.getAll().find((h: any) => h.id === 'Late_Water_1')]);
    }, [url]);
    // the repaint is driven by the load itself (no manual drawMinimap): poll the layer pixel the app drew
    await expect.poll(() => page.evaluate(() => {
      const mc = document.getElementById('minimap') as HTMLCanvasElement;
      const x = Math.floor((MAP_HEIGHT - 1 - 34 + 0.5) / MAP_HEIGHT * mc.width), y = Math.floor((MAP_WIDTH - 1 - 34 + 0.5) / MAP_WIDTH * mc.height);
      return Array.from(mc.getContext('2d')!.getImageData(x, y, 1, 1).data).slice(0, 3);
    })).toEqual(ORANGE);
    const s1 = await stats(page);
    expect(s1.computed - c0).toBe(1);
    expect(s1.flushes - f0).toBe(1);
    expect(near(await ovPixel(page, 34, 34), ORANGE, 0)).toBe(true);
    // minimap OVERLAY cache and layer visibility were not disturbed by the colour change
    const ov1 = await page.evaluate(() => ({ ...Canvas.getStats() }));
    expect(ov1.minimapOverlayRebuilds).toBe(ov0.minimapOverlayRebuilds);
    expect(await page.evaluate(() => JSON.stringify(['terrain', 'objects', 'roads', 'settlements'].map(k => Layers.isVisible(k))))).toBe(layers0);
  });

  test('toggling another layer does not change the terrain colours on the minimap', async ({ page }) => {
    await freshEditor(page);
    await waitSettled(page);
    await page.evaluate(() => { IO.newMap(true); });
    await block(page, 'Lake_1', 40, 40);
    const a = await mmPixel(page, 44, 44);
    await page.evaluate(() => { Layers.setVisible('roads', false); });
    const b = await mmPixel(page, 44, 44);
    await page.evaluate(() => { Layers.setVisible('roads', true); });
    expect(b).toEqual(a);
    expect(bluish(a)).toBe(true);
  });
});
