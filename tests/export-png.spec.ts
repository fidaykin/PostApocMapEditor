import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import { openEditor } from './helpers';
import { freshEditor, clickCell } from './editor-helpers';

// T4.8: File > Export PNG / left-palette button render the WHOLE map (flat colour hexagons, markers for the visible layers)
// into an offscreen canvas and download it. The live canvas, camera, zoom and LOD are never touched.
// References: hex geometry written out here (pitch 60 / 40*sqrt(3); Canvas.hexCenterWorld is the geometry oracle, the pixel
// of a cell centre is (world + HEX_SIZE) * scale) and the literal terrain colours of the static colour table.
const PLAIN = [120, 155, 85], MOUNTAIN = [150, 150, 150], LAVA = [170, 70, 20], BG = [17, 17, 17];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function exportPng(page: Page, arg?: any) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(a => { IO.exportPNG(a); }, arg)]);
  return { dl, buf: fs.readFileSync((await dl.path())!) };
}
/** Pixels of a PNG decoded by the browser (independent of the exporter). */
async function pixels(page: Page, buf: Buffer, pts: [number, number][]) {
  return page.evaluate(async ([b64, p]) => {
    const bin = atob(b64 as string), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d')!; g.drawImage(bmp, 0, 0);
    return (p as [number, number][]).map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data));
  }, [buf.toString('base64'), pts] as const);
}
const centre = (page: Page, col: number, row: number, s: number) =>
  page.evaluate(([c, r, k]) => { const w = Canvas.hexCenterWorld(c, r); return [Math.round((w.x + HEX_SIZE) * k), Math.round((w.y + HEX_SIZE) * k)]; }, [col, row, s] as const) as Promise<[number, number]>;

test.describe('30x30 map at scale 1', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
    await page.waitForFunction(() => HexDB.getAll().length > 0);
    await page.evaluate(() => {
      mapData[5 * MAP_WIDTH + 7] = 'Mountain_1';     // col 7,row 5
      mapData[20 * MAP_WIDTH + 12] = 'Lava_Plain_1'; // col 12,row 20
      mapData[0] = 'Plain_1';
    });
  });

  test('a valid PNG of the right size; cell colours at the hex centres; background outside the map', async ({ page }) => {
    const { dl, buf } = await exportPng(page, { scale: 1 });
    expect([...buf.subarray(0, 8)]).toEqual(PNG_SIG);
    expect(buf.readUInt32BE(16)).toBe(29 * 60 + 80);                                            // (H-1)*COL_PITCH + 2*HEX_SIZE
    expect(buf.readUInt32BE(20)).toBe(Math.round(29 * 40 * Math.sqrt(3) + 40 * Math.sqrt(3) / 2 + 80));
    const pts = await Promise.all([centre(page, 7, 5, 1), centre(page, 12, 20, 1), centre(page, 3, 3, 1)]);
    const px = await pixels(page, buf, [...pts, [0, 0]]);
    expect(px[0].slice(0, 3)).toEqual(MOUNTAIN);
    expect(px[1].slice(0, 3)).toEqual(LAVA);
    expect(px[2].slice(0, 3)).toEqual(PLAIN);
    expect(px[3].slice(0, 3)).toEqual(BG);
    expect(px[0][3]).toBe(255);
    expect(dl.suggestedFilename()).toMatch(/^map-\d{4}-\d{2}-\d{2}\.png$/);
  });

  test('layers: hidden layers are not exported, visible markers are', async ({ page }) => {
    const cityCell = await page.evaluate(() => { const c = settlements.find(s => s.type === 'city')!; return { col: c.col, row: c.row }; });
    await page.evaluate(() => { objectsData['6,10'] = 'AnyBuilding'; roadsData['15,15'] = {}; });
    const pt = (c: number, r: number) => centre(page, c, r, 1);
    const [cityP, objP, roadP] = await Promise.all([pt(cityCell.col, cityCell.row), pt(6, 10), pt(15, 15)]);
    let { buf } = await exportPng(page, { scale: 1 });
    const on = await pixels(page, buf, [cityP, objP, roadP]);
    await page.evaluate(() => { Layers.setVisible('settlements', false); Layers.setVisible('objects', false); Layers.setVisible('roads', false); });
    ({ buf } = await exportPng(page, { scale: 1 }));
    const off = await pixels(page, buf, [cityP, objP, roadP]);
    for (let i = 0; i < 3; i++) expect(on[i]).not.toEqual(off[i]);          // each marker is drawn when its layer is visible
    for (let i = 0; i < 3; i++) expect(off[i].slice(0, 3)).toEqual(PLAIN);  // and gone when hidden (terrain shows through)
    await page.evaluate(() => { Layers.setVisible('terrain', false); });
    ({ buf } = await exportPng(page, { scale: 1 }));
    const noTerrain = await pixels(page, buf, [await pt(7, 5)]);
    expect(noTerrain[0].slice(0, 3)).toEqual(BG);
    await expect(page.locator('.toast', { hasText: /hidden layers/i }).first()).toBeVisible();
  });

  test('the live canvas, camera, zoom and DOM are untouched', async ({ page }) => {
    await page.evaluate(() => { Canvas.render(); });
    const snap = () => page.evaluate(() => {
      const c = document.getElementById('map-canvas') as HTMLCanvasElement;
      return { w: c.width, h: c.height, url: c.toDataURL(), zoom: Canvas.getZoom(), cam: Canvas.getCamera(), canvases: document.querySelectorAll('canvas').length,
        undo: History.undoSize(), css: c.style.cssText };
    });
    const before = await snap();
    await exportPng(page, { scale: 0.5 });
    expect(await snap()).toEqual(before);
  });

  test('the download is a Blob anchor with a local-date name and the object URL is revoked', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 11, 31, 23, 59, 0));
    await page.evaluate(() => {
      const w = window as any; w.__urls = []; w.__revoked = [];
      const c = URL.createObjectURL.bind(URL), r = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (b: any) => { const u = c(b); w.__urls.push([u, b instanceof Blob ? b.type : '']); return u; };
      URL.revokeObjectURL = (u: string) => { w.__revoked.push(u); r(u); };
    });
    const { dl } = await exportPng(page, { scale: 0.1 });
    expect(dl.suggestedFilename()).toBe('map-2026-12-31.png');
    await expect.poll(() => page.evaluate(() => (window as any).__revoked.length)).toBe(1);
    const info = await page.evaluate(() => ({ urls: (window as any).__urls, revoked: (window as any).__revoked }));
    expect(info.urls).toHaveLength(1);
    expect(info.urls[0][1]).toBe('image/png');
    expect(info.revoked).toEqual([info.urls[0][0]]);
  });

  test('busy state: the control is disabled while rendering, a second request is ignored, and it recovers', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const btn = document.getElementById('png-export-btn') as HTMLButtonElement;
      const first = IO.exportPNG({ scale: 0.1 });
      const during = { disabled: btn.disabled, text: btn.textContent };
      const second = IO.exportPNG({ scale: 0.1 });         // refused while busy
      await Promise.all([first, second]);
      return { during, after: { disabled: btn.disabled, text: btn.textContent } };
    });
    expect(r.during.disabled).toBe(true);
    expect(r.during.text).toMatch(/Rendering/);
    expect(r.after.disabled).toBe(false);
    expect(r.after.text).toBe('Export PNG');
  });

  test('an encoding failure shows a toast, downloads nothing and re-enables the control', async ({ page }) => {
    let downloads = 0; page.on('download', () => downloads++);
    await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function (cb: any) { cb(null); }; });
    await page.evaluate(() => IO.exportPNG({ scale: 0.1 }));
    await expect(page.locator('.toast', { hasText: /PNG export failed/ }).first()).toBeVisible();
    await page.waitForTimeout(200);
    expect(downloads).toBe(0);
    expect(await page.evaluate(() => (document.getElementById('png-export-btn') as HTMLButtonElement).disabled)).toBe(false);
  });

  test('controls: File menu item and left-palette section only; no shortcut; canvas size unchanged at 1400x900', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const info = await page.evaluate(() => {
      const c = document.getElementById('map-canvas') as HTMLCanvasElement;
      return { w: c.width, h: c.height,
        menu: !!document.querySelector('#menu-file button[onclick*="exportPNG"]'),
        inLeft: !!document.getElementById('palette-panel')?.contains(document.getElementById('png-export-btn')),
        inToolbar: !!document.getElementById('toolbar')?.contains(document.getElementById('png-export-btn')) };
    });
    expect(info).toEqual({ w: 1491, h: 808, menu: true, inLeft: true, inToolbar: false });
    // the File menu item exports
    await page.click('#menu-file');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#menu-file button', { hasText: 'Export PNG' }).click()]);
    expect(dl.suggestedFilename()).toMatch(/\.png$/);
  });

  test('the palette button uses the selected scale', async ({ page }) => {
    await page.evaluate(() => { (document.getElementById('png-export-panel') as HTMLDetailsElement).open = true; });
    await page.selectOption('#png-scale', '0.2');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#png-export-btn')]);
    const buf = fs.readFileSync((await dl.path())!);
    expect(buf.readUInt32BE(16)).toBe(Math.round((29 * 60 + 80) * 0.2));
  });
});

test.describe('refusals and caps', () => {
  test('refused while a fill runs: toast, no download, no validator-style side effects', async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(() => { Tools.setActive('fill'); UI.selectTerrain('Water_1'); });
    await clickCell(page, 225, 224);
    expect(await page.evaluate(() => Tools.isFillBusy())).toBe(true);
    let downloads = 0; page.on('download', () => downloads++);
    const refused = await page.evaluate(async () => { const t0 = Tools.isFillBusy(); await IO.exportPNG({ scale: 0.1 }); return t0 && Tools.isFillBusy(); });
    expect(refused).toBe(true);                                   // still filling when the export call returned: nothing waited for it
    await expect(page.locator('.toast', { hasText: /fill/i }).first()).toBeVisible();
    expect(downloads).toBe(0);
    await page.evaluate(() => Tools.whenIdle());
  });

  test('a 450x450 map at scale 1 is clamped to the size cap and the toast says so', async ({ page }) => {
    test.setTimeout(90_000);
    await freshEditor(page);
    const { buf } = await exportPng(page, { scale: 1 });
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    expect(w).toBeLessThanOrEqual(8192);
    expect(h).toBeLessThanOrEqual(8192);
    expect(w * h).toBeLessThanOrEqual(36_000_000);
    expect(w * h).toBeGreaterThan(20_000_000);                      // clamped, not collapsed
    await expect(page.locator('.toast', { hasText: /reduced/i }).first()).toBeVisible();
    const [p] = await pixels(page, buf, [[w >> 1, h >> 1]]);
    expect(p[3]).toBe(255);
  });

  // B7: the real behaviour, not "it did not throw". Two paths: no map at the call (nothing starts), and the map vanishing while the
  // export waits for its paint yield (the progress bar was already started and must not stay on 'Rendering PNG...').
  test('no map: no download, no progress bar left, the control stays enabled', async ({ page }) => {
    await openEditor(page);
    let downloads = 0; page.on('download', () => downloads++);
    await page.evaluate(async () => { const m = mapData; mapData = null as any; try { await IO.exportPNG({ scale: 0.1 }); } finally { mapData = m; } });
    expect(downloads).toBe(0);
    await expect(page.locator('#progress-wrap')).not.toHaveClass(/active/);
    await page.evaluate(async () => { const m = mapData; const p = IO.exportPNG({ scale: 0.1 }); mapData = null as any; try { await p; } finally { mapData = m; } });
    await expect(page.locator('#progress-wrap')).not.toHaveClass(/active/);            // RED before B4: stuck at 10 % 'Rendering PNG...'
    expect(downloads).toBe(0);
    expect(await page.evaluate(() => (document.getElementById('png-export-btn') as HTMLButtonElement).disabled)).toBe(false);
  });

  test("'Largest allowed' stays within the 36 MP cap and the 8192 px side limit (rounding included)", async ({ page }) => {
    test.setTimeout(90_000);
    await freshEditor(page);
    const { buf } = await exportPng(page, { scale: 'max' });
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    expect(Math.max(w, h)).toBeLessThanOrEqual(8192);
    expect(w * h).toBeLessThanOrEqual(36_000_000);                  // RED before B4: 5582 x 6450 = 36,003,900 (rounded past the cap)
    expect(w * h).toBeGreaterThan(30_000_000);                      // the largest, not a collapsed image
    await expect(page.locator('.toast', { hasText: /PNG exported/ }).first()).toBeVisible();
  });

  test('a canvas that cannot be created (getContext null) gives a size message, no download, no stuck progress', async ({ page }) => {
    await openEditor(page);
    let downloads = 0; page.on('download', () => downloads++);
    await page.evaluate(async () => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...a: any[]) { return this.id === 'map-canvas' ? (orig as any).apply(this, a) : null; } as any;
      try { await IO.exportPNG({ scale: 1 }); } finally { HTMLCanvasElement.prototype.getContext = orig; }
    });
    await expect(page.locator('.toast', { hasText: /smaller size/i }).first()).toBeVisible();
    await expect(page.locator('.toast', { hasText: /smaller size/i }).first()).toContainText(/\d+ x \d+ px/);
    expect(downloads).toBe(0);
    await expect(page.locator('#progress-wrap')).not.toHaveClass(/active/);
    expect(await page.evaluate(() => (document.getElementById('png-export-btn') as HTMLButtonElement).disabled)).toBe(false);
  });
});
