import { test, expect, Page } from '@playwright/test';
import { freshEditor, cellPoint, clickCell, idAt } from './editor-helpers';

// T4.6 validator panel (left palette): explicit Run, severity filter, click an issue = centre + highlight (view only),
// textContent-only rendering, stale results flagged instead of cleared. freshEditor = blank 450x450, city at 225,224.
// Independent camera reference: Unity-axis hex geometry written out here (pitches 60 and 40*sqrt(3); odd worldX up).
const W = 450, H = 450, COLP = 60, ROWP = 40 * Math.sqrt(3), STAG = ROWP / 2;
function worldOf(col: number, row: number) {
  const wxi = H - 1 - row, wx = wxi - Math.floor(H / 2);
  return { x: wxi * COLP, y: (W - 1 - col) * ROWP + STAG - (Math.abs(wx) % 2 === 1 ? STAG : 0) };
}

const rows = (page: Page) => page.locator('#val-list .val-row');
const summary = (page: Page) => page.locator('#val-summary');
async function openPanel(page: Page) { await page.evaluate(() => { (document.getElementById('validator-panel') as HTMLDetailsElement).open = true; }); }
// A map with 2 errors (unknown tile id x2 cells, unknown object) and 2 warnings (orphan road, unreachable settlement).
async function brokenMap(page: Page) {
  await page.evaluate(() => {
    mapData[60 * MAP_WIDTH + 50] = 'Nope_1'; mapData[61 * MAP_WIDTH + 50] = 'Nope_1';
    objectsData['70,80'] = 'Ghost_Bld';
    roadsData['300,300'] = {};
    settlements.push({ col: 400, row: 100, type: 'settlement' });
    for (const [c, r] of HexUtils.neighbors(400, 100, MAP_WIDTH, MAP_HEIGHT).map((n: any) => [n.col, n.row])) mapData[r * MAP_WIDTH + c] = 'Water_1';
  });
}
const camCentre = (page: Page) => page.evaluate(() => Canvas.getViewCenterTile());

test.beforeEach(async ({ page }) => { await freshEditor(page); });

test('the panel is a collapsed section of the LEFT palette; the canvas keeps its size at 1400x900; nothing runs on open', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  const info = await page.evaluate(() => {
    const p = document.getElementById('validator-panel') as HTMLDetailsElement, c = document.getElementById('map-canvas') as HTMLCanvasElement;
    return { inLeft: document.getElementById('palette-panel')!.contains(p), tag: p.tagName, open: p.open, w: c.width, h: c.height,
      inToolbar: !!document.getElementById('toolbar')?.contains(p) };
  });
  expect(info).toMatchObject({ inLeft: true, tag: 'DETAILS', open: false, w: 1491, h: 808, inToolbar: false });
  await expect(summary(page)).toContainText('Not run');
  await expect(rows(page)).toHaveCount(0);
});

test('Run lists the problems by severity (errors first) with a summary; rows are real buttons', async ({ page }) => {
  await brokenMap(page);
  await openPanel(page);
  await page.click('#val-run');
  await expect(summary(page)).toContainText('2 errors, 2 warnings');
  const info = await page.evaluate(() => [...document.querySelectorAll('#val-list .val-row')].map(b => ({
    tag: b.tagName, type: (b as HTMLButtonElement).type, sev: b.classList.contains('error') ? 'error' : 'warning', text: b.textContent })));
  expect(info.map(i => i.sev)).toEqual(['error', 'error', 'warning', 'warning']);
  expect(info.every(i => i.tag === 'BUTTON' && i.type === 'button')).toBe(true);
  expect(info[0].text).toContain('Nope_1');
  expect(info[0].text).toContain('2');
  expect(info[1].text).toContain('Ghost_Bld');
  expect(await page.evaluate(() => document.getElementById('val-summary')!.getAttribute('aria-live'))).toBe('polite');
});

test('a clean map says so', async ({ page }) => {
  await openPanel(page);
  await page.click('#val-run');
  await expect(summary(page)).toContainText('No problems');
  await expect(rows(page)).toHaveCount(0);
});

test('ids from the map are shown as text only (no markup, no script)', async ({ page }) => {
  const evil = '<img src=x onerror="window.__xss=1">';
  await page.evaluate((e) => { mapData[10 * MAP_WIDTH + 10] = e; objectsData['20,20'] = e + 'b'; }, evil);
  await openPanel(page);
  await page.click('#val-run');
  await expect(rows(page)).toHaveCount(2);
  const r = await page.evaluate(() => ({ imgs: document.querySelectorAll('#validator-panel img').length, xss: (window as any).__xss,
    text: [...document.querySelectorAll('#val-list .val-row')].map(b => b.textContent), title: document.querySelector('#val-list .val-row')!.getAttribute('title') }));
  expect(r.imgs).toBe(0);
  expect(r.xss).toBeUndefined();
  expect(r.text[0]).toContain(evil);
  expect(r.title).toContain(evil);
});

test('severity filter shows errors, warnings or all', async ({ page }) => {
  await brokenMap(page);
  await openPanel(page);
  await page.click('#val-run');
  await page.selectOption('#val-filter', 'error');
  await expect(rows(page)).toHaveCount(2);
  expect(await rows(page).evaluateAll(l => l.every(b => b.classList.contains('error')))).toBe(true);
  await page.selectOption('#val-filter', 'warning');
  await expect(rows(page)).toHaveCount(2);
  expect(await rows(page).evaluateAll(l => l.every(b => b.classList.contains('warning')))).toBe(true);
  await page.selectOption('#val-filter', 'all');
  await expect(rows(page)).toHaveCount(4);
  // the filter is view-only: the summary still counts everything
  await expect(summary(page)).toContainText('2 errors, 2 warnings');
});

test('clicking an issue centres its first cell and highlights its cells; no map edit, no History step, focus back to the map', async ({ page }) => {
  await brokenMap(page);
  await openPanel(page);
  await page.click('#val-run');
  const before = await page.evaluate(() => ({ u: History.undoSize(), r: History.redoSize(), md: mapData.join('|').length, seq: Canvas.getCamera() }));
  await rows(page).first().click();
  const c = await camCentre(page);
  expect(c).toMatchObject({ col: 50, row: 60 });
  const hl = await page.evaluate(() => Canvas.getHighlightPoints('validator'));
  expect(hl!.n).toBe(2);
  const ref = [worldOf(50, 60), worldOf(50, 61)];
  hl!.xs.forEach((x: number, i: number) => { expect(x).toBeCloseTo(ref[i].x, 3); expect(hl!.ys[i]).toBeCloseTo(ref[i].y, 3); });
  const after = await page.evaluate(() => ({ u: History.undoSize(), r: History.redoSize(), md: mapData.join('|').length, active: document.activeElement === document.body }));
  expect(after).toMatchObject({ u: before.u, r: before.r, md: before.md, active: true });
  // a second issue moves the highlight (one layer, not stacked)
  await rows(page).nth(1).click();
  expect(await camCentre(page)).toMatchObject({ col: 70, row: 80 });
  expect((await page.evaluate(() => Canvas.getHighlightPoints('validator')))!.n).toBe(1);
  // the jump itself does not make the results stale
  await expect(summary(page)).not.toContainText('outdated');
  await page.click('#val-clear');
  expect(await page.evaluate(() => Canvas.hasHighlight('validator'))).toBe(false);
});

test('keyboard: Run and the rows work from the keyboard and keep focus; Space is not a pan key here', async ({ page }) => {
  await brokenMap(page);
  await openPanel(page);
  await page.focus('#val-run');
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(4);
  await page.locator('#val-list .val-row').nth(2).focus();
  await page.keyboard.press('Space');
  // third row = unreachable settlement at 400,100
  expect(await camCentre(page)).toMatchObject({ col: 400, row: 100 });
  expect(await page.evaluate(() => document.activeElement!.classList.contains('val-row'))).toBe(true);
  await page.locator('#val-list .val-row').nth(3).focus();
  await page.keyboard.press('Enter');
  expect(await camCentre(page)).toMatchObject({ col: 300, row: 300 });
  expect(await page.evaluate(() => document.activeElement!.classList.contains('val-row'))).toBe(true);
  expect(await page.evaluate(() => Tools.isStroking())).toBe(false);
});

test('jumping works in the middle of a stroke and adds no History step of its own', async ({ page }) => {
  await brokenMap(page);
  await page.evaluate(() => { Tools.setActive('eraser'); for (let c = 220; c < 232; c++) mapData[224 * MAP_WIDTH + c] = 'Forest_1'; Canvas.render(); });
  await openPanel(page);
  await page.click('#val-run');
  await page.evaluate(() => Canvas.centerOnTile(225, 224));
  const p = await cellPoint(page, 225, 224);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 20, p.y + 10, { steps: 3 });
  const mid = await page.evaluate(() => {
    const stroking = Tools.isStroking(), u = History.undoSize();
    (document.querySelector('#val-list .val-row') as HTMLElement).click();      // programmatic click: the pointer stays down on the canvas
    return { stroking, u, u2: History.undoSize(), still: Tools.isStroking(), c: Canvas.getViewCenterTile(), hl: Canvas.hasHighlight('validator') };
  });
  await page.mouse.up();
  expect(mid.stroking).toBe(true);                    // positive control: a real stroke was active
  expect(mid.still).toBe(true);
  expect(mid.u2).toBe(mid.u);
  expect(mid.c).toMatchObject({ col: 50, row: 60 });
  expect(mid.hl).toBe(true);
});

test('results go stale (not silently cleared) on edits, undo and a new map; there is no auto-run', async ({ page }) => {
  await page.evaluate(() => { (window as any).__runs = 0; const f = IO.analyzeMap; IO.analyzeMap = (...a: any[]) => { (window as any).__runs++; return f(...a); }; });
  const runs = () => page.evaluate(() => (window as any).__runs);
  await brokenMap(page);
  await openPanel(page);
  await page.click('#val-run');
  expect(await runs()).toBe(1);
  await expect(rows(page)).toHaveCount(4);
  await page.evaluate(() => { UI.selectTerrain('Forest_1'); Canvas.centerOnTile(100, 100); });
  await clickCell(page, 100, 100);                                  // paint tool: an edit (Forest_1 over Plain_1)
  expect(await idAt(page, 100, 100)).toBe('Forest_1');
  await expect(summary(page)).toContainText('outdated');
  await expect(rows(page)).toHaveCount(4);                          // still listed
  expect(await runs()).toBe(1);                                     // and nothing re-ran by itself
  await page.click('#val-run');
  await expect(summary(page)).not.toContainText('outdated');
  expect(await runs()).toBe(2);
  await page.evaluate(() => History.undo());
  await expect(summary(page)).toContainText('outdated');
  await page.click('#val-run');
  await page.evaluate(() => IO.newMap(true));
  await expect(summary(page)).toContainText('outdated');
  expect(await runs()).toBe(3);
  await page.click('#val-run');
  await expect(summary(page)).toContainText('No problems');
  expect(await runs()).toBe(4);
});
