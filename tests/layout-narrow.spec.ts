import { test, expect, Page } from '@playwright/test';
import { openEditor, reloadEditor } from './helpers';

// T4.11: collapsible right panel. Storage key `rightPanelMode`: auto | collapsed | expanded | classic.
const KEY = 'rightPanelMode';
const NARROW_BELOW = 1920;
// Recorded from the UNCHANGED layout (HEAD 725f8a5) before editing: the toolbar row forced a 1931.3 px page, so the
// canvas was 1491 wide at every viewport from 1100 to 1930, and the right panel started at x = 1711.3 (off-screen).
const OLD = { w1400: { cw: 1491, ch: 808 }, w1920: { cw: 1491, ch: 988, rpLeft: 1711.3 }, w2400: { cw: 1960, ch: 1108 } };
const PALETTE = 220, RAIL = 28;
const VIEWPORTS = [[1100, 700], [1280, 720], [1400, 900], [1920, 1080]] as const;

async function start(page: Page, w: number, h: number, mode: string | null = 'auto') {
  await page.setViewportSize({ width: w, height: h });
  await openEditor(page, mode === null ? {} : { storage: { [KEY]: mode } });
}
const canvasSize = (page: Page) => page.evaluate(() => { const c = document.getElementById('map-canvas') as HTMLCanvasElement; return [c.width, c.height]; });
const box = (page: Page, sel: string) => page.evaluate((s) => { const r = document.querySelector(s)!.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; }, sel);
// 1.5 px slack on the right: the 220 px minimap sits in a 220 px panel that has a 1 px left border (pre-existing: the old layout
// clipped that pixel too); everything else must be fully inside.
const inside = async (page: Page, sel: string) => {
  const b = await box(page, sel); const vp = page.viewportSize()!;
  return b.w > 0 && b.l >= -0.5 && b.r <= vp.width + 1.5 && b.t >= -0.5 && b.b <= vp.height + 0.5;
};

test.describe('no horizontal page overflow', () => {
  for (const [w, h] of VIEWPORTS) test(`${w}x${h}: page, #app and the right panel fit the viewport`, async ({ page }) => {
    await start(page, w, h);
    const r = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, bsw: document.body.scrollWidth, app: document.getElementById('app')!.scrollWidth,
      appW: document.getElementById('app')!.getBoundingClientRect().width, mainW: document.getElementById('main')!.getBoundingClientRect().width,
      iw: innerWidth, rpR: document.getElementById('right-panel')!.getBoundingClientRect().right,
    }));
    expect(r.sw).toBeLessThanOrEqual(r.iw);
    expect(r.bsw).toBeLessThanOrEqual(r.iw);
    expect(r.app).toBeLessThanOrEqual(r.iw);
    expect(r.appW).toBeLessThanOrEqual(r.iw);
    expect(r.mainW).toBeLessThanOrEqual(r.iw);
    expect(r.rpR).toBeLessThanOrEqual(r.iw + 0.5);   // the panel (or its rail) is never pushed off-screen
  });
});

test('1920x1080 auto: expanded inline, right panel fully on screen (the old layout clipped it at x=1711+220 > 1920)', async ({ page }) => {
  await start(page, 1920, 1080);
  expect(OLD.w1920.rpLeft + 220).toBeGreaterThan(1920);   // positive control: the recorded old layout overflowed
  const [cw, ch] = await canvasSize(page);
  expect(ch).toBe(OLD.w1920.ch);
  expect(cw).toBe(1920 - 2 * PALETTE);   // 1480: the page no longer widens past the viewport (old: 1491)
  expect(await box(page, '#right-panel').then(b => [b.l, b.w])).toEqual([1920 - PALETTE, PALETTE]);
  await expect(page.locator('#right-panel-toggle')).toHaveAttribute('aria-expanded', 'true');
  for (const s of ['#minimap', '#slot-panel', '#right-active-terrain']) expect(await inside(page, s)).toBe(true);
});

test('wide viewport 2400x1200 keeps the old canvas size (inline panel, width - 440)', async ({ page }) => {
  await start(page, 2400, 1200);
  expect(await canvasSize(page)).toEqual([OLD.w2400.cw, OLD.w2400.ch]);
});

for (const [w, h] of VIEWPORTS.slice(0, 3)) {
  test(`${w}x${h} auto: collapsed rail, canvas = width - palette - rail, height unchanged`, async ({ page }) => {
    await start(page, w, h);
    expect(w).toBeLessThan(NARROW_BELOW);
    const [cw, ch] = await canvasSize(page);
    expect(cw).toBe(w - PALETTE - RAIL);
    expect(ch).toBe(h - 92);   // menu 28 + toolbar 40 + status 24: the same vertical budget as before
    await expect(page.locator('#right-panel-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect((await box(page, '#right-panel')).w).toBe(RAIL);
    expect((await box(page, '#right-panel')).r).toBeLessThanOrEqual(w);
    await expect(page.locator('#minimap')).toBeHidden();
  });
}

for (const [w, h] of VIEWPORTS) {
  test(`${w}x${h}: minimap, brush panel and active terrain are reachable with the toggle (real clicks)`, async ({ page }) => {
    await start(page, w, h);
    const narrow = w < NARROW_BELOW;
    const before = await canvasSize(page);
    const tg = page.locator('#right-panel-toggle');
    if (narrow) {
      await tg.click();
      await expect(tg).toHaveAttribute('aria-expanded', 'true');
      expect(await canvasSize(page)).toEqual(before);   // overlay drawer: no reflow
    }
    for (const s of ['#minimap', '#slot-panel', '#right-active-terrain']) {
      await expect(page.locator(s)).toBeVisible();
      expect(await inside(page, s), s).toBe(true);
    }
    // the drawer is on top of the canvas: a real click on the minimap must reach the minimap
    const m = await box(page, '#minimap');
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)!.id, [m.l + 5, m.t + 5])).toBe('minimap');
    await page.locator('#brush-sizes .brush-btn[data-brush="2"]').click();
    expect(await page.evaluate(() => Brush.getSize())).toBe(2);
    if (narrow) {
      await tg.click();
      await expect(tg).toHaveAttribute('aria-expanded', 'false');
      expect(await canvasSize(page)).toEqual(before);
      await expect(page.locator('#minimap')).toBeHidden();
    }
  });
}

test('1100x700: every visible toolbar control can be scrolled into view; the toolbar scrolls inside itself', async ({ page }) => {
  await start(page, 1100, 700);
  const tb = await page.evaluate(() => { const t = document.getElementById('toolbar')!; return { sw: t.scrollWidth, cw: t.clientWidth, ox: getComputedStyle(t).overflowX, wrap: getComputedStyle(t).flexWrap }; });
  expect(tb.sw).toBeGreaterThan(tb.cw);   // positive control: it really overflows here
  expect(tb.ox).toBe('auto');
  expect(tb.wrap).toBe('nowrap');
  const ids = await page.evaluate(() => Array.from(document.querySelectorAll('#toolbar button, #toolbar select, #toolbar input'))
    .filter(e => (e as HTMLElement).offsetParent !== null).map((e, i) => { if (!e.id) e.id = '__tb' + i; return e.id; }));
  expect(ids.length).toBeGreaterThan(10);
  for (const id of ids) {
    await page.evaluate((i) => document.getElementById(i)!.scrollIntoView({ block: 'nearest', inline: 'nearest' }), id);
    const b = await page.evaluate((i) => { const r = document.getElementById(i)!.getBoundingClientRect(); return [r.left, r.right]; }, id);
    expect(b[0], id).toBeGreaterThanOrEqual(-0.5);
    expect(b[1], id).toBeLessThanOrEqual(1100.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollLeft + document.body.scrollLeft)).toBe(0);   // the page itself never scrolled
});

test('the MORE dropdown and a tool tooltip are not clipped by the scrolling toolbar', async ({ page }) => {
  await start(page, 1100, 700);
  await page.locator('#tab-more').scrollIntoViewIfNeeded();
  await page.locator('#tab-more').click();
  const dd = await box(page, '#more-dropdown');
  expect(dd.h).toBeGreaterThan(100);
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('#more-dropdown') !== null, [dd.l + 20, dd.b - 10]);
  expect(hit).toBe(true);   // the bottom of the list (below the 40 px toolbar) is really painted and hit-testable
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 300);
  const btn = page.locator('#map-tools .tool-btn').first();
  await btn.scrollIntoViewIfNeeded();
  await btn.hover();
  const tip = await page.evaluate(() => { const t = document.querySelector('#map-tools .tool-btn .tooltip') as HTMLElement; const r = t.getBoundingClientRect(); return { b: r.bottom, vis: getComputedStyle(t).display !== 'none', hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === t || t.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }; });
  expect(tip.vis).toBe(true);
  expect(tip.b).toBeGreaterThan(68 + 4);   // extends below the toolbar row (menu 28 + toolbar 40)
});

async function blankMap(page: Page) {
  await page.evaluate(() => { IO.newMap(true); UI.selectTerrain('Water_1'); Tools.setActive('paint'); Brush.setSize(0); Canvas.centerOnCity(); });
}
async function snapshot(page: Page) { return page.evaluate(() => mapData.slice()); }
async function clickCell(page: Page, col: number, row: number) {
  const p = await page.evaluate(([c, r]) => { const q = Canvas.hexScreenPos(c, r); const b = document.getElementById('map-canvas')!.getBoundingClientRect(); return { x: b.left + q.x, y: b.top + q.y }; }, [col, row]);
  await page.mouse.click(p.x, p.y);
  return p;
}

test('hit-testing: a real click paints exactly the cell under the cursor, collapsed and with the drawer open', async ({ page }) => {
  await start(page, 1100, 700);
  await blankMap(page);
  const W = await page.evaluate(() => MAP_WIDTH);
  const diff = async (base: string[]) => { const now = await snapshot(page); const d: number[] = []; now.forEach((v, i) => { if (v !== base[i]) d.push(i); }); return d; };
  let base = await snapshot(page);
  await clickCell(page, 227, 224);   // collapsed
  expect(await diff(base)).toEqual([224 * W + 227]);
  await page.locator('#right-panel-toggle').click();   // open the drawer: the canvas keeps its size and mapping
  base = await snapshot(page);
  await clickCell(page, 222, 226);
  expect(await diff(base)).toEqual([226 * W + 222]);
  // a click inside the drawer does not reach the map
  const m = await box(page, '#right-active-terrain');
  base = await snapshot(page);
  await page.mouse.click(m.l + 10, m.t + 10);
  expect(await diff(base)).toEqual([]);
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)!.closest('#right-panel'), [m.l + 10, m.t + 10])).toBe(true);
});

test('toggle: operable with Enter and Space, aria-expanded follows the state, blurs after a pointer click', async ({ page }) => {
  await start(page, 1280, 720);
  const tg = page.locator('#right-panel-toggle');
  expect(await tg.evaluate(b => b.tagName + ':' + (b as HTMLButtonElement).type)).toBe('BUTTON:button');
  expect(await tg.getAttribute('aria-controls')).toBeTruthy();
  await tg.focus();
  await page.keyboard.press('Enter');
  await expect(tg).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#minimap')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(tg).toHaveAttribute('aria-expanded', 'false');
  await tg.click();   // pointer click: focus goes back to the map shortcuts
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('right-panel-toggle');
  await tg.click();
  // a tool letter still works after the pointer click
  await page.evaluate(() => Tools.setActive('erase'));
  await page.keyboard.press('p');
  expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
});

test('the state persists across reload (auto -> expanded drawer), and collapsed widens the canvas on a wide window', async ({ page }) => {
  await start(page, 1280, 720);
  await page.locator('#right-panel-toggle').click();
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('expanded');
  await reloadEditor(page);
  await expect(page.locator('#right-panel-toggle')).toHaveAttribute('aria-expanded', 'true');
  expect((await canvasSize(page))[0]).toBe(1280 - PALETTE - RAIL);   // still the rail-width canvas under the drawer
  await page.locator('#right-panel-toggle').click();
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('collapsed');
  await page.setViewportSize({ width: 2400, height: 1200 });
  await page.evaluate(() => dispatchEvent(new Event('resize')));
  expect(await canvasSize(page)).toEqual([2400 - PALETTE - RAIL, 1108]);   // explicit collapse also frees the width on wide windows
  await page.locator('#right-panel-toggle').click();
  expect(await canvasSize(page)).toEqual([OLD.w2400.cw, OLD.w2400.ch]);
});

test('crossing the threshold on resize re-lays the page out once (auto)', async ({ page }) => {
  await start(page, 2400, 1200);
  await expect(page.locator('#right-panel-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.setViewportSize({ width: 1300, height: 800 });
  await expect(page.locator('#right-panel-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await canvasSize(page))[0]).toBe(1300 - PALETTE - RAIL);
});

test('localStorage that throws: the page starts, the toggle works for the session', async ({ page }) => {
  await page.addInitScript((k) => {
    const g = Storage.prototype.getItem, s = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key: string) { if (key === k) throw new DOMException('blocked', 'SecurityError'); return g.call(this, key); };
    Storage.prototype.setItem = function (key: string, v: string) { if (key === k) throw new DOMException('blocked', 'SecurityError'); return s.call(this, key, v); };
  }, KEY);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openEditor(page, { storage: {} });
  // classic is seeded by openEditor, but the read throws: the default (auto) applies
  await expect(page.locator('#right-panel-toggle')).toHaveAttribute('aria-expanded', 'false');
  expect((await canvasSize(page))[0]).toBe(1280 - PALETTE - RAIL);
  await page.locator('#right-panel-toggle').click();
  await expect(page.locator('#right-panel-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#minimap')).toBeVisible();
});

test('classic forces today\'s fixed layout at any viewport: 1491x808 at 1400x900, panel inline, no toggle', async ({ page }) => {
  await start(page, 1400, 900, 'classic');
  expect(await canvasSize(page)).toEqual([OLD.w1400.cw, OLD.w1400.ch]);
  expect((await box(page, '#right-panel')).l).toBeCloseTo(OLD.w1920.rpLeft, 0);
  await expect(page.locator('#right-panel-toggle')).toBeHidden();
});

test('openEditor seeds classic by default (the perf/hash specs rely on it)', async ({ page }) => {
  await start(page, 1400, 900, null);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('classic');
  expect(await canvasSize(page)).toEqual([OLD.w1400.cw, OLD.w1400.ch]);
});
