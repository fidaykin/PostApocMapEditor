import { test, expect, Page } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// T4.1 go-to coordinates. freshEditor = blank 450x450 map (classic layout, 1600x1000 viewport).
// Independent reference: the Unity-axis hex geometry written out here from the documented pitches (HEX_SIZE 40,
// COL_PITCH 60, ROW_PITCH 40*sqrt(3), STAGGER = ROW_PITCH/2; odd worldX is shifted UP), not read from Canvas.hexCenterWorld.
const W = 450, H = 450, HEX = 40, COLP = HEX * 1.5, ROWP = HEX * Math.sqrt(3), STAG = ROWP / 2;
function worldOf(col: number, row: number) {
  const wxi = H - 1 - row, wx = wxi - Math.floor(H / 2);
  return { x: wxi * COLP, y: (W - 1 - col) * ROWP + STAG - (Math.abs(wx) % 2 === 1 ? STAG : 0) };
}
// Unity app coordinates as the status bar prints them (hand-written inverse used for the expectations below).
const appOf = (col: number, row: number) => ({ x: (H - 1 - row) - Math.floor(H / 2), y: col - Math.floor(W / 2) });

const cam = (page: Page) => page.evaluate(() => Canvas.getCamera());
const canvasSize = (page: Page) => page.evaluate(() => { const c = document.getElementById('map-canvas') as HTMLCanvasElement; return { w: c.width, h: c.height }; });
const gotoType = async (page: Page, text: string) => { await page.fill('#goto-input', text); await page.press('#goto-input', 'Enter'); };

test.beforeEach(async ({ page }) => { await freshEditor(page); });

test('parseGoto: tile, app and block addresses; junk and out-of-bounds are null', async ({ page }) => {
  const r = await page.evaluate(() => ({
    tile: Canvas.parseGoto('120, 200'), tileSp: Canvas.parseGoto(' 120 200 '), edge0: Canvas.parseGoto('0,0'), edgeMax: Canvas.parseGoto('449,449'),
    app0: Canvas.parseGoto('app:0,0'), appNeg: Canvas.parseGoto('app:-10,7'), appUpper: Canvas.parseGoto('APP : 3 , -4'),
    blockA1: Canvas.parseGoto('A:1'), blockB4: Canvas.parseGoto('b:4'),
    bad: ['', '   ', 'hello', '1,2,3', '1.5,2', '120;200', '450,5', '5,450', '-1,0', '0,-1', 'app:999,0', 'app:0,999', 'Z:99', 'A:0', 'A:99', '1:A', 'app:1', null, undefined, 5]
      .map(t => Canvas.parseGoto(t as any)),
  }));
  expect(r.tile).toEqual({ col: 120, row: 200 });
  expect(r.tileSp).toEqual({ col: 120, row: 200 });
  expect(r.edge0).toEqual({ col: 0, row: 0 });
  expect(r.edgeMax).toEqual({ col: 449, row: 449 });
  expect(r.app0).toEqual({ col: 225, row: 224 });        // by hand: row = 449 - (0 + 225), col = 0 + 225
  expect(r.appNeg).toEqual({ col: 232, row: 234 });      // row = 449 - (-10 + 225) = 234, col = 7 + 225
  expect(r.appUpper).toEqual({ col: 221, row: 221 });    // row = 449 - (3 + 225), col = -4 + 225
  expect(r.blockA1).toEqual({ col: 440, row: 440 });     // block centre = size - 10 - index * 20 (same as the ruler jump)
  expect(r.blockB4).toEqual({ col: 380, row: 420 });     // letter B = 1 (row axis), 4 = index 3 (col axis)
  expect(r.bad).toEqual(r.bad.map(() => null));
  expect(r.bad.length).toBe(20);                         // positive control: the list was really evaluated
});

test('app: coordinates round-trip with the status bar (hover shows what was typed)', async ({ page }) => {
  const ap = appOf(232, 234);
  await gotoType(page, `app:${ap.x},${ap.y}`);
  const c = await canvasSize(page);
  const box = (await page.locator('#map-canvas').boundingBox())!;
  await page.mouse.move(box.x + c.w / 2, box.y + c.h / 2);
  await expect(page.locator('#st-app-coords')).toHaveText(`${ap.x}, ${ap.y}`);
  await expect(page.locator('#st-tile')).toHaveText('232, 234');
});

test('centerOnTile puts the tile under the canvas centre, for both stagger parities and two zooms', async ({ page }) => {
  for (const zoom of [100, 50]) {
    await page.evaluate(z => Canvas.setZoom(z), zoom);
    const { w, h } = await canvasSize(page);
    for (const [col, row] of [[120, 200], [121, 201], [300, 100], [301, 101]]) {   // rows 200/100 even worldX, 201/101 odd
      const ok = await page.evaluate(([c, r]) => Canvas.centerOnTile(c, r), [col, row]);
      expect(ok).toBe(true);
      const p = worldOf(col, row), s = zoom / 100;
      const c = await cam(page);
      expect(c.x).toBeCloseTo(p.x * s - w / 2, 4);
      expect(c.y).toBeCloseTo(p.y * s - h / 2, 4);
      expect(await page.evaluate(() => Canvas.getViewCenterTile())).toMatchObject({ col, row });
    }
  }
  // positive control for the parity: the two stagger rows really differ in y by one half pitch in the reference
  expect(Math.abs(worldOf(120, 200).y - worldOf(120, 201).y)).toBeCloseTo(STAG, 6);
});

test('hovering the canvas centre after a jump reports the tile (screen side, not Canvas.getViewCenterTile)', async ({ page }) => {
  await page.evaluate(() => Canvas.setZoom(100));
  await gotoType(page, '121,201');
  const { w, h } = await canvasSize(page);
  const box = (await page.locator('#map-canvas').boundingBox())!;
  await page.mouse.move(box.x + w / 2, box.y + h / 2);
  await expect(page.locator('#st-tile')).toHaveText('121, 201');
});

test('corner tiles: true, camera clamped, the tile stays on screen; invalid cells return false and do not move the view', async ({ page }) => {
  await page.evaluate(() => Canvas.setZoom(100));
  const { w, h } = await canvasSize(page);
  for (const [col, row] of [[0, 0], [449, 449], [0, 449], [449, 0]]) {
    expect(await page.evaluate(([c, r]) => Canvas.centerOnTile(c, r), [col, row])).toBe(true);
    const p = worldOf(col, row), c = await cam(page);
    const sx = p.x - c.x, sy = p.y - c.y;                  // zoom 100: world px = screen px + camera
    expect(sx).toBeGreaterThanOrEqual(0); expect(sx).toBeLessThanOrEqual(w);
    expect(sy).toBeGreaterThanOrEqual(0); expect(sy).toBeLessThanOrEqual(h);
  }
  await page.evaluate(() => Canvas.centerOnTile(120, 200));
  const before = await cam(page);
  const rets = await page.evaluate(() => [[-1, 0], [0, -1], [450, 0], [0, 450], [1.5, 2], [NaN, 3], [3, Infinity], ['a', 'b'], [null, 1]]
    .map(([c, r]) => Canvas.centerOnTile(c as any, r as any)));
  expect(rets).toEqual(rets.map(() => false));
  expect(rets.length).toBe(9);
  expect(await cam(page)).toEqual(before);
});

test('typing a tile address in the palette box centres the view, blurs the box and is not a map edit', async ({ page }) => {
  const hist = await page.evaluate(() => ({ u: History.undoSize(), r: History.redoSize(), m: mapData.join('|').length }));
  await gotoType(page, '120,200');
  expect(await page.evaluate(() => Canvas.getViewCenterTile())).toMatchObject({ col: 120, row: 200 });
  await expect(page.locator('#goto-input')).not.toBeFocused();
  await expect(page.locator('#goto-input')).not.toHaveClass(/invalid/);
  expect(await page.evaluate(() => ({ u: History.undoSize(), r: History.redoSize(), m: mapData.join('|').length }))).toEqual(hist);
  // the box lives in the LEFT palette
  expect(await page.evaluate(() => !!document.getElementById('palette-panel')!.contains(document.getElementById('goto-input')))).toBe(true);
});

test('bad input: flagged, toast (no native dialog), the view does not move; typing clears the flag', async ({ page }) => {
  await page.evaluate(() => Canvas.centerOnTile(120, 200));
  const before = await cam(page);
  for (const bad of ['9999,9999', 'hello', 'A:99']) {
    await gotoType(page, bad);
    await expect(page.locator('#goto-input')).toHaveClass(/invalid/);
    await expect(page.locator('#goto-input')).toHaveAttribute('aria-invalid', 'true');
    expect(await cam(page)).toEqual(before);
  }
  await expect(page.locator('.toast').filter({ hasText: /outside the map/i })).not.toHaveCount(0);   // bounds toast
  await expect(page.locator('.toast').filter({ hasText: /Use "col,row"|Use col,row/i })).not.toHaveCount(0);   // format toast
  await page.press('#goto-input', 'End');
  await page.keyboard.type('1');
  await expect(page.locator('#goto-input')).not.toHaveClass(/invalid/);
});

test('block addresses typed in the go-to box and in the existing Block box land on the same view', async ({ page }) => {
  await page.evaluate(() => Canvas.setZoom(100));
  const { w, h } = await canvasSize(page);
  await gotoType(page, 'B:4');
  const p = worldOf(380, 420), c = await cam(page);
  expect(c.x).toBeCloseTo(p.x - w / 2, 4);
  expect(c.y).toBeCloseTo(p.y - h / 2, 4);
  // existing #block-nav-input behaviour: still jumps, still reverts its text to the current block on blur
  await page.evaluate(() => Canvas.centerOnTile(10, 10));
  await page.fill('#block-nav-input', 'B:4');
  await page.press('#block-nav-input', 'Enter');
  expect(await cam(page)).toEqual(c);
  await expect(page.locator('#block-nav-input')).toHaveValue('B:4');
  await page.evaluate(() => Canvas.centerOnTile(10, 10));
  await page.focus('#block-nav-input'); await page.fill('#block-nav-input', 'Q:Q'); await page.press('#block-nav-input', 'Enter');
  await expect(page.locator('#block-nav-input')).toHaveValue(/^[A-Z]:\d+$/);
});

test('typing in the box never triggers tool shortcuts; Escape leaves the box', async ({ page }) => {
  await page.evaluate(() => Tools.setActive('paint'));
  await page.focus('#goto-input');
  await page.keyboard.type('e,l g');
  expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
  await page.press('#goto-input', 'Escape');
  await expect(page.locator('#goto-input')).not.toBeFocused();
});

test('the Go button works with the keyboard and a pointer click returns focus to the map', async ({ page }) => {
  await page.fill('#goto-input', '120,200');
  await page.focus('#goto-btn');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => Canvas.getViewCenterTile())).toMatchObject({ col: 120, row: 200 });
  await page.evaluate(() => Canvas.centerOnTile(10, 10));
  await page.fill('#goto-input', '121,201');
  await page.click('#goto-btn');
  expect(await page.evaluate(() => Canvas.getViewCenterTile())).toMatchObject({ col: 121, row: 201 });
  await expect(page.locator('#goto-btn')).not.toBeFocused();
});

test('jumping works while a stroke is active (no gate) and leaves the stroke intact', async ({ page }) => {
  const box = (await page.locator('#map-canvas').boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 330, box.y + 310, { steps: 3 });
  expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(true);
  expect(await page.evaluate(() => Canvas.centerOnTile(100, 100))).toBe(true);
  expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(true);
  await page.mouse.up();
});

test('layout: the box sits in the palette, the canvas stays 1491x808 at 1400x900 and the box is reachable at 1100x700', async ({ page }) => {
  for (const [vw, vh] of [[1400, 900], [1100, 700]] as const) {
    await page.setViewportSize({ width: vw, height: vh });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    if (vw === 1400) expect(await canvasSize(page)).toEqual({ w: 1491, h: 808 });
    const inp = page.locator('#goto-input');
    await inp.scrollIntoViewIfNeeded();
    await expect(inp).toBeInViewport({ ratio: 1 });
    await inp.fill('120,200'); await inp.press('Enter');
    expect(await page.evaluate(() => Canvas.getViewCenterTile())).toMatchObject({ col: 120, row: 200 });
  }
});
