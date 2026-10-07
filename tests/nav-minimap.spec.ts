import { test, expect, Page } from '@playwright/test';
import { openEditor, reloadEditor } from './helpers';
import { freshEditor } from './editor-helpers';

// T4.3: bigger minimap (opt-in, persisted) with cached zone / settlement overlays.
// Pixel references are computed here from the documented axis flip (px -> row flipped, py -> col flipped), never from the editor's code.
const MM_KEY = 'minimapBig';

const px = (page: Page, col: number, row: number) => page.evaluate(([c, r]) => {
  const mc = document.getElementById('minimap') as HTMLCanvasElement;
  const x = Math.floor((MAP_HEIGHT - 1 - r + 0.5) / MAP_HEIGHT * mc.width);
  const y = Math.floor((MAP_WIDTH - 1 - c + 0.5) / MAP_WIDTH * mc.height);
  return Array.from(mc.getContext('2d')!.getImageData(x, y, 1, 1).data);
}, [col, row]);
// FNV-1a over every minimap pixel (computed in the page: 340*340*4 numbers are not worth shipping).
const hash = (page: Page) => page.evaluate(() => {
  const mc = document.getElementById('minimap') as HTMLCanvasElement;
  const d = mc.getContext('2d')!.getImageData(0, 0, mc.width, mc.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); }
  return h >>> 0;
});
const rebuilds = (page: Page) => page.evaluate(() => Canvas.getStats().minimapOverlayRebuilds);
// A cell whose minimap pixel shows its plain terrain colour (not under a block grid line, ruler strip or the viewport rectangle),
// so blends can be compared against the baseline pixel. Scans diagonally from (c0, c0); the colour reference is Terrain.color.
const plainCell = (page: Page, c0: number) => page.evaluate((start) => {
  const mc = document.getElementById('minimap') as HTMLCanvasElement, g = mc.getContext('2d')!;
  for (let k = 0; k < 40; k++) {
    const c = start + k, r = start + k;
    const x = Math.floor((MAP_HEIGHT - 1 - r + 0.5) / MAP_HEIGHT * mc.width), y = Math.floor((MAP_WIDTH - 1 - c + 0.5) / MAP_WIDTH * mc.height);
    const got = g.getImageData(x, y, 1, 1).data, want = Terrain.color(mapData[r * MAP_WIDTH + c]);
    if (got[0] === want[0] && got[1] === want[1] && got[2] === want[2]) return [c, r];
  }
  throw new Error('no plain minimap pixel found');
}, c0);
const addZoneBlock = (page: Page, color = '#ff0000') => page.evaluate((col) => {
  const id = ZonePainter.addZone('Red', col);
  const zl = ZonePainter.getZoneLayer();
  for (let r = 100; r < 160; r++) for (let c = 100; c < 160; c++) zl[r * MAP_WIDTH + c] = id;
  Canvas.drawMinimap();
  return id;
}, color);

test.describe('minimap size', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('default is 220; the toggle switches 220 <-> 340, persists and survives a reload', async ({ page }) => {
    expect(await page.evaluate(() => [Canvas.isMinimapBig(), (document.getElementById('minimap') as HTMLCanvasElement).width])).toEqual([false, 220]);
    await page.click('#mm-size-btn');
    await expect(page.locator('body')).toHaveClass(/minimap-big/);
    expect(await page.evaluate(() => { const m = document.getElementById('minimap') as HTMLCanvasElement; return [m.width, m.height, Canvas.isMinimapBig(), m.getBoundingClientRect().width]; })).toEqual([340, 340, true, 340]);
    await expect(page.locator('#mm-size-btn')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate((k) => localStorage.getItem(k), MM_KEY)).toBe('1');
    await reloadEditor(page);
    expect(await page.evaluate(() => [Canvas.isMinimapBig(), (document.getElementById('minimap') as HTMLCanvasElement).width])).toEqual([true, 340]);
    await page.click('#mm-size-btn');
    expect(await page.evaluate(() => [Canvas.isMinimapBig(), (document.getElementById('minimap') as HTMLCanvasElement).width])).toEqual([false, 220]);
    expect(await page.evaluate((k) => localStorage.getItem(k), MM_KEY)).toBe('0');
  });

  test('blocked storage: the toggle still works for the session', async ({ page }) => {
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('blocked'); }; });
    await page.evaluate(() => Canvas.toggleMinimapSize());
    expect(await page.evaluate(() => (document.getElementById('minimap') as HTMLCanvasElement).width)).toBe(340);
    expect(await page.evaluate(() => Canvas.isMinimapBig())).toBe(true);
  });

  test('classic layout default is untouched (220 px minimap, 220 px panel)', async ({ page }) => {
    const r = await page.evaluate(() => ({ mm: (document.getElementById('minimap') as HTMLCanvasElement).width, rp: document.getElementById('right-panel')!.getBoundingClientRect().width, classic: document.body.classList.contains('layout-classic') }));
    expect(r).toEqual({ mm: 220, rp: 220, classic: true });
  });
});

test.describe('overlays', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  for (const big of [false, true]) {
    test(`${big ? '340' : '220'} px: non-city settlement dot, zone tint, and both toggles`, async ({ page }) => {
      if (big) await page.evaluate(() => Canvas.toggleMinimapSize());
      const [zc, zr] = await plainCell(page, 110), [sc, sr] = await plainCell(page, 300);
      const base = await px(page, zc, zr), baseDot = await px(page, sc, sr);
      const h0 = await hash(page);
      await addZoneBlock(page);
      await page.evaluate(([c, r]) => { settlements.push({ col: c, row: r, type: 'settlement' }); Canvas.drawMinimap(); }, [sc, sr]);
      // zone: terrain blended 35 % with pure red
      const z = await px(page, zc, zr);
      const want = [Math.round(base[0] * 0.65 + 255 * 0.35), Math.round(base[1] * 0.65), Math.round(base[2] * 0.65)];
      for (let i = 0; i < 3; i++) expect(Math.abs(z[i] - want[i]), `channel ${i}: got ${z} want ${want}`).toBeLessThanOrEqual(3);
      // settlement: yellow dot (#ffd54f) on the centre pixel, and it was not there before
      const dot = await px(page, sc, sr);
      expect([dot[0], dot[1], dot[2]]).toEqual([0xff, 0xd5, 0x4f]);
      expect([baseDot[0], baseDot[1], baseDot[2]]).not.toEqual([0xff, 0xd5, 0x4f]);
      expect(await hash(page)).not.toBe(h0);               // positive control
      // toggles
      await page.click('#mm-zones-btn');
      expect(await px(page, zc, zr)).toEqual(base);
      expect([(await px(page, sc, sr))[0]]).toEqual([0xff]);   // the dot stays
      await page.click('#mm-settle-btn');
      expect(await px(page, sc, sr)).toEqual(baseDot);
      expect(await hash(page)).toBe(h0);                   // overlays off = the minimap without any zone or settlement
      await expect(page.locator('#mm-zones-btn')).toHaveAttribute('aria-pressed', 'false');
      await page.click('#mm-zones-btn');
      expect((await px(page, zc, zr))[0]).toBeGreaterThan(base[0]);
    });
  }

  test('hidden Layers are not drawn on the minimap (and the minimap redraws by itself)', async ({ page }) => {
    const base = await px(page, 130, 130), baseDot = await px(page, 300, 300);
    const h0 = await hash(page);
    await addZoneBlock(page);
    await page.evaluate(() => { settlements.push({ col: 300, row: 300, type: 'settlement' }); Canvas.drawMinimap(); });
    const h1 = await hash(page);
    expect(h1).not.toBe(h0);
    await page.evaluate(() => Layers.setVisible('settlements', false));
    expect(await px(page, 300, 300)).toEqual(baseDot);
    expect((await px(page, 130, 130))[0]).toBeGreaterThan(base[0]);
    await page.evaluate(() => Layers.setVisible('zones', false));
    expect(await hash(page)).toBe(h0);
    await page.evaluate(() => { Layers.setVisible('zones', true); Layers.setVisible('settlements', true); });
    expect(await hash(page)).toBe(h1);
    // the "show settlements" toolbar switch too
    await page.evaluate(() => UI.toggleSettlements());
    expect(await px(page, 300, 300)).toEqual(baseDot);
  });

  test('New Map clears the overlays', async ({ page }) => {
    const h0 = await hash(page);
    await addZoneBlock(page);
    await page.evaluate(() => { settlements.push({ col: 300, row: 300, type: 'settlement' }); Canvas.drawMinimap(); });
    expect(await hash(page)).not.toBe(h0);
    await page.evaluate(() => { IO.newMap(true); Canvas.drawMinimap(); });
    expect(await hash(page)).toBe(h0);
  });
});

test.describe('overlay layer is cached (work counters)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('rebuilt only when zone / settlement data, visibility, size or colours change', async ({ page }) => {
    await addZoneBlock(page);
    await page.evaluate(() => { settlements.push({ col: 300, row: 300, type: 'settlement' }); Canvas.drawMinimap(); });
    const r0 = await rebuilds(page);
    expect(r0).toBeGreaterThan(0);
    await page.evaluate(() => { for (let i = 0; i < 25; i++) Canvas.drawMinimap(); });   // pan / zoom style redraws
    expect(await rebuilds(page)).toBe(r0);
    // one sampled zone cell
    await page.evaluate(() => { ZonePainter.getZoneLayer()[130 * MAP_WIDTH + 130] = 0; Canvas.drawMinimap(); });
    expect(await rebuilds(page)).toBe(r0 + 1);
    await page.evaluate(() => { for (let i = 0; i < 5; i++) Canvas.drawMinimap(); });
    expect(await rebuilds(page)).toBe(r0 + 1);
    // settlement added, then moved in place, then removed
    await page.evaluate(() => { settlements.push({ col: 310, row: 310, type: 'settlement' }); Canvas.drawMinimap(); });
    expect(await rebuilds(page)).toBe(r0 + 2);
    await page.evaluate(() => { settlements[settlements.length - 1].col = 320; Canvas.drawMinimap(); });
    expect(await rebuilds(page)).toBe(r0 + 3);
    await page.evaluate(() => { settlements.pop(); Canvas.drawMinimap(); });
    expect(await rebuilds(page)).toBe(r0 + 4);
    // zone colour change
    await page.evaluate(() => { ZonePainter.getZones()[0].color = '#00ff00'; Canvas.drawMinimap(); });
    expect(await rebuilds(page)).toBe(r0 + 5);
    // size change
    await page.evaluate(() => Canvas.toggleMinimapSize());
    expect(await rebuilds(page)).toBe(r0 + 6);
    // both overlays off: no rebuild per call, however data changes
    await page.evaluate(() => { Canvas.toggleMinimapOverlay('zones'); Canvas.toggleMinimapOverlay('settlements'); });
    const off = await rebuilds(page);
    await page.evaluate(() => { ZonePainter.getZoneLayer()[130 * MAP_WIDTH + 131] = 1; settlements.push({ col: 5, row: 5, type: 'settlement' }); for (let i = 0; i < 10; i++) Canvas.drawMinimap(); });
    expect(await rebuilds(page)).toBe(off);
  });

  test('no zones and no extra settlements: nothing is ever built', async ({ page }) => {
    expect(await rebuilds(page)).toBe(0);   // a real number, not undefined
    await page.evaluate(() => { for (let i = 0; i < 10; i++) Canvas.drawMinimap(); });
    expect(await rebuilds(page)).toBe(0);
  });

  test('zone edits through the Zone Painter tool reach the minimap without a manual redraw', async ({ page }) => {
    const base = await px(page, 225, 100);
    await page.evaluate(() => {
      const id = ZonePainter.addZone('Blue', '#0000ff');
      ZonePainter.setSelectedZoneId(id);
      Canvas.centerOnTile(225, 100);
    });
    await page.evaluate(() => { Tools.setActive('zone'); Brush.setSize(5); });
    const p = await page.evaluate(() => { const s = Canvas.hexScreenPos(225, 100), b = document.getElementById('map-canvas')!.getBoundingClientRect(); return { x: b.left + s.x, y: b.top + s.y }; });
    await page.mouse.click(p.x, p.y);
    const z = await px(page, 225, 100);
    expect(z[2] - z[0], `blue minus red: ${z} vs base ${base}`).toBeGreaterThan(base[2] - base[0] + 20);
  });
});

test.describe('minimap click pans to the clicked tile at both sizes', () => {
  for (const big of [false, true]) {
    test(`${big ? '340' : '220'} px`, async ({ page }) => {
      await page.setViewportSize({ width: 2100, height: 1100 });
      await openEditor(page, { storage: { rightPanelMode: 'auto', ...(big ? { [MM_KEY]: '1' } : {}) } });
      await page.waitForFunction(() => HexDB.getAll().length > 0);
      await page.evaluate(() => { IO.newMap(true); window.dispatchEvent(new Event('resize')); });
      expect(await page.evaluate(() => (document.getElementById('minimap') as HTMLCanvasElement).width)).toBe(big ? 340 : 220);
      for (const [col, row] of [[120, 330], [330, 120]]) {
        const pt = await page.evaluate(([c, r]) => {
          const mc = document.getElementById('minimap') as HTMLCanvasElement, b = mc.getBoundingClientRect();
          return { x: b.left + (MAP_HEIGHT - 1 - r + 0.5) / MAP_HEIGHT * b.width, y: b.top + (MAP_WIDTH - 1 - c + 0.5) / MAP_WIDTH * b.height };
        }, [col, row]);
        await page.mouse.click(pt.x, pt.y);
        const v = await page.evaluate(() => Canvas.getViewCenterTile());
        expect(Math.abs(v.col - col), `col ${v.col} vs ${col}`).toBeLessThanOrEqual(5);
        expect(Math.abs(v.row - row), `row ${v.row} vs ${row}`).toBeLessThanOrEqual(5);
      }
    });
  }

  test('narrow window, expanded drawer, big minimap: fully on screen and the canvas keeps its size', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openEditor(page, { storage: { rightPanelMode: 'expanded' } });
    const size = () => page.evaluate(() => { const c = document.getElementById('map-canvas') as HTMLCanvasElement; return [c.width, c.height]; });
    const before = await size();
    await page.evaluate(() => Canvas.toggleMinimapSize());
    expect(await size()).toEqual(before);
    const r = await page.evaluate(() => { const b = document.getElementById('minimap')!.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, iw: innerWidth, ih: innerHeight }; });
    expect(r.r).toBeLessThanOrEqual(r.iw + 1.5);
    expect(r.l).toBeGreaterThanOrEqual(0);
    expect(r.b).toBeLessThanOrEqual(r.ih);
    expect(r.r - r.l).toBeGreaterThanOrEqual(338);
  });
});
