import { test, expect, Page } from '@playwright/test';
import { freshEditorAuto } from './editor-helpers';

// B7 (final wave): the Phase 4 flows (go to, bookmarks, validator jump, History panel) in the DEFAULT layout (`auto`, 1400x900: right
// panel collapsed to a rail, canvas 1152 px wide). The older specs seed the classic layout on purpose (perf hashes); a user gets this one.
// Reference geometry written out here (pitches 60 and 40*sqrt(3), odd worldX shifted up), as in nav-bookmarks.spec.ts.
const W = 450, H = 450, COLP = 60, ROWP = 40 * Math.sqrt(3), STAG = ROWP / 2;
function worldOf(col: number, row: number) {
  const wxi = H - 1 - row, wx = wxi - Math.floor(H / 2);
  return { x: wxi * COLP, y: (W - 1 - col) * ROWP + STAG - (Math.abs(wx) % 2 === 1 ? STAG : 0) };
}
const canvasSize = (page: Page) => page.evaluate(() => { const c = document.getElementById('map-canvas') as HTMLCanvasElement; return { w: c.width, h: c.height }; });
const cam = (page: Page) => page.evaluate(() => Canvas.getCamera());
async function expectCentred(page: Page, col: number, row: number, zoom: number, what: string) {
  const { w, h } = await canvasSize(page), p = worldOf(col, row), c = await cam(page), k = zoom / 100;
  expect(c.x, what + ' camera x').toBeCloseTo(p.x * k - w / 2, 3);
  expect(c.y, what + ' camera y').toBeCloseTo(p.y * k - h / 2, 3);
}
const inViewport = (page: Page, sel: string) => page.evaluate(s => {
  const r = document.querySelector(s)!.getBoundingClientRect();
  return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
}, sel);
const open = (page: Page, id: string) => page.evaluate(i => { (document.getElementById(i) as HTMLDetailsElement).open = true; }, id);

test.describe('Phase 4 flows in the default (auto) layout at 1400x900', () => {
  test.beforeEach(async ({ page }) => { await freshEditorAuto(page); });

  test('the layout really is the default one (positive control for everything below)', async ({ page }) => {
    expect(await page.evaluate(() => [RightPanel.getMode(), RightPanel.getEffective(), document.body.classList.contains('layout-classic')])).toEqual(['auto', 'rail', false]);
    expect(await canvasSize(page)).toMatchObject({ w: 1400 - 220 - 28 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('go to: typing a tile jumps and centres it in the narrower canvas; a bad input is flagged and the view stays', async ({ page }) => {
    expect(await inViewport(page, '#goto-input')).toBe(true);
    await page.fill('#goto-input', '240, 210');
    await page.press('#goto-input', 'Enter');
    await expectCentred(page, 240, 210, await page.evaluate(() => Canvas.getZoom()), 'go to 240,210');
    const before = await cam(page);
    await page.fill('#goto-input', 'nonsense');
    await page.press('#goto-input', 'Enter');
    await expect(page.locator('#goto-input')).toHaveAttribute('aria-invalid', 'true');
    expect(await cam(page)).toEqual(before);
  });

  test('bookmarks: add, move away, jump back restores zoom and centre; the controls are inside the viewport', async ({ page }) => {
    expect(await inViewport(page, '#bm-add-btn')).toBe(true);
    await page.evaluate(() => { Canvas.setZoom(50); Canvas.centerOnTile(120, 200); });
    await page.fill('#bm-name', 'north');
    await page.click('#bm-add-btn');
    await page.evaluate(() => { Canvas.setZoom(100); Canvas.centerOnTile(10, 10); });
    await page.locator('#bookmarks-list .bm-go').first().click();
    expect(await page.evaluate(() => Canvas.getZoom())).toBe(50);
    await expectCentred(page, 120, 200, 50, 'bookmark jump');
  });

  test('validator: Run lists the issue and clicking it centres the first cell and marks it', async ({ page }) => {
    await page.evaluate(() => { mapData[200 * MAP_WIDTH + 130] = 'Nope_1'; });          // col 130, row 200: one unknown id
    await open(page, 'validator-panel');
    await expect(page.locator('#val-run')).toBeVisible();                              // the palette scrolls: Playwright's click scrolls it into reach
    await page.click('#val-run');
    const row = page.locator('#val-list .val-row').first();
    await expect(row).toContainText('Nope_1');
    await page.evaluate(() => Canvas.setZoom(100));
    await row.click();
    await expectCentred(page, 130, 200, await page.evaluate(() => Canvas.getZoom()), 'validator jump');
    expect(await page.evaluate(() => Canvas.hasHighlight('validator'))).toBe(true);
  });

  test('History panel: rows jump back and forward through labelled steps', async ({ page }) => {
    await open(page, 'history-panel');
    await page.evaluate(() => { History.clear(); History.push('Open map'); History.push('Paint'); mapData[0] = 'Rubble_1'; History.push('Fill'); mapData[0] = 'Water_1'; });   // push BEFORE the write, like the tools
    const rows = page.locator('#history-list .hist-row');
    await expect(rows).toHaveText(['Fill', 'Paint', 'Open map']);
    await expect(rows.first()).toBeVisible();
    await rows.filter({ hasText: 'Open map' }).click();
    expect(await page.evaluate(() => mapData[0])).toBe('Plain_1');
    await rows.filter({ hasText: 'Fill' }).click();
    expect(await page.evaluate(() => mapData[0])).toBe('Water_1');
  });
});
