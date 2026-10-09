import { test, expect, Page } from '@playwright/test';
import { openEditor, reloadEditor, openSection, PALETTE_SECTIONS } from './helpers';

// Left palette accordion: the terrain/tile picker gets the remaining height, every secondary panel is a collapsible section
// (single-open, collapsed by default, last open section remembered in this browser).
declare const Bookmarks: any, MapValidator: any;

const SECTIONS: [string, string, string][] = [   // key, body id (kept from before), header label; grouped View / Edit / Check & share
  ['minimap', 'minimap-panel', 'Minimap'], ['goto', 'goto-panel', 'Go to'], ['bookmarks', 'bookmarks-panel', 'Bookmarks'],
  ['zones', 'zone-panel', 'Zones'], ['stamps', 'stamp-panel', 'Stamps'], ['layers', 'layers-panel', 'Layers'], ['history', 'history-panel', 'History'],
  ['validator', 'validator-panel', 'Validate map'], ['export', 'png-export-panel', 'Export image'],
  ['design', 'map-design', 'Map design'], ['help', 'shortcuts-panel', 'Help'],
];
const TILES_MIN = 320;   // owner: the picker keeps at least ~320 px
const ITEMS_VISIBLE_MIN = 8;   // tile cells + category headers fully visible with the default categories (only PLAINS is expanded)
const TILES_VISIBLE_MIN = 8;   // tile cells fully visible once a big category (the first one, WATER) is expanded too

const header = (page: Page, key: string) => page.locator(`.pal-acc-btn[data-acc="${key}"]`);
const state = (page: Page) => page.evaluate(() => [...document.querySelectorAll('.pal-acc-btn')].map(b => {
  const body = document.getElementById(b.getAttribute('aria-controls')!)!;
  return { key: (b as HTMLElement).dataset.acc, expanded: b.getAttribute('aria-expanded'), hidden: body.hidden, shown: getComputedStyle(body).display !== 'none' };
}));
const openKeys = async (page: Page) => (await state(page)).filter(s => s.expanded === 'true').map(s => s.key);

// Geometry of the tile region, measured from the DOM: its height, and how many tile cells are FULLY visible on screen
// (inside the picker's scroll box, inside the palette box and inside the window) with the palette not scrolled.
const tileGeo = (page: Page) => page.evaluate(() => {
  const pal = document.getElementById('palette-panel')!, reg = document.getElementById('palette-tiles')!, sc = document.getElementById('palette-scroll')!;
  const P = pal.getBoundingClientRect(), S = sc.getBoundingClientRect();
  const inside = (b: DOMRect, o: DOMRect) => b.top >= o.top - 0.5 && b.bottom <= o.bottom + 0.5 && b.left >= o.left - 0.5 && b.right <= o.right + 0.5;
  const win = new DOMRect(0, 0, innerWidth, innerHeight);
  const cells = [...sc.querySelectorAll('.tile-btn')].map(t => t.getBoundingClientRect()).filter(b => b.height > 0);
  const vis = cells.filter(b => inside(b, S) && inside(b, P) && inside(b, win)).length;
  const cats = [...sc.querySelectorAll('.cat-header')].map(t => t.getBoundingClientRect()).filter(b => b.height > 0 && inside(b, S) && inside(b, win)).length;
  return { region: reg.getBoundingClientRect().height, scrollBox: sc.clientHeight, visibleTiles: vis, visibleCats: cats, paletteH: pal.clientHeight, paletteScrollTop: pal.scrollTop,
           regionScrolls: getComputedStyle(sc).overflowY, selRowH: document.getElementById('palette-selected')!.getBoundingClientRect().height };
});

async function start(page: Page, w: number, h: number, storage: Record<string, string> = {}) {
  await page.setViewportSize({ width: w, height: h });
  await openEditor(page, { storage: { rightPanelMode: 'auto', ...storage } });
  await page.waitForFunction(() => document.querySelectorAll('#palette-scroll .tile-btn').length > 20);
}

test('default: every secondary section is a collapsed accordion section with a real button header (aria-expanded, aria-controls, chevron, label)', async ({ page }) => {
  await start(page, 1400, 900);
  expect(PALETTE_SECTIONS).toEqual(SECTIONS.map(s => s[0]));
  const r = await page.evaluate(() => [...document.querySelectorAll('#palette-acc .pal-acc-btn')].map(b => {
    const body = document.getElementById(b.getAttribute('aria-controls')!);
    return { tag: b.tagName, type: b.getAttribute('type'), key: (b as HTMLElement).dataset.acc, controls: b.getAttribute('aria-controls'), expanded: b.getAttribute('aria-expanded'),
             label: b.querySelector('.pal-acc-label')!.textContent, chevron: !!b.querySelector('.pal-acc-chev') && getComputedStyle(b.querySelector('.pal-acc-chev')!).display !== 'none',
             bodyHidden: !!body && body.hidden && getComputedStyle(body).display === 'none', labelledBy: body && body.getAttribute('aria-labelledby') === b.id && !!b.id,
             inPalette: !!b.closest('#palette-panel') && !b.closest('#toolbar') };
  }));
  expect(r).toEqual(SECTIONS.map(([key, id, label]) => ({ tag: 'BUTTON', type: 'button', key, controls: id, expanded: 'false', label, chevron: true, bodyHidden: true, labelledBy: true, inPalette: true })));
  // the content ids are kept, and no old <details> panel is left in the palette
  expect(await page.evaluate(() => document.querySelectorAll('#palette-panel details').length)).toBe(0);
  for (const id of ['stamp-name', 'stamp-list', 'layers-list', 'val-run', 'history-list', 'goto-input', 'bm-name', 'mm-size-btn', 'zone-list', 'ring-bounds', 'pl-apply', 'png-export-btn', 'btn-shortcut-help'])
    expect(await page.evaluate(i => !!document.getElementById(i), id), id).toBe(true);
  // the zone list's '+' stays reachable while the section is collapsed (it is in the section header row)
  await expect(page.locator('#btn-add-zone')).toBeVisible();
});

for (const [w, h] of [[1400, 900], [1100, 700]] as const) {
  test(`${w}x${h}: the tile picker gets the remaining height, several category rows and at least ${TILES_VISIBLE_MIN} tiles are fully visible without scrolling the palette, the active terrain is one compact row`, async ({ page }) => {
    await start(page, w, h);
    const g = await tileGeo(page);
    expect(g.paletteScrollTop).toBe(0);
    expect(g.region).toBeGreaterThanOrEqual(TILES_MIN);
    const plains = await page.evaluate(() => document.querySelectorAll('#palette-scroll .cat-items:not(.collapsed) .tile-btn').length);
    expect(g.visibleTiles).toBe(plains);                               // the whole expanded default category is on screen
    expect(g.visibleCats).toBeGreaterThanOrEqual(4);
    expect(g.visibleTiles + g.visibleCats).toBeGreaterThanOrEqual(ITEMS_VISIBLE_MIN);
    // expand the first category (WATER, many tiles) like a user: the picker shows at least TILES_VISIBLE_MIN whole tiles
    await page.locator('#palette-scroll .cat-header').first().click();
    const g2 = await tileGeo(page);
    expect(g2.paletteScrollTop).toBe(0);
    expect(g2.visibleTiles).toBeGreaterThanOrEqual(TILES_VISIBLE_MIN);
    expect(g.regionScrolls).toBe('auto');
    expect(g.selRowH).toBeLessThanOrEqual(40);                         // was ~101 px with an 80 px preview
    // positive control on the measurement: the scroll box really holds more tiles than it shows
    expect(await page.evaluate(() => document.querySelectorAll('#palette-scroll .cat-items:not(.collapsed) .tile-btn').length)).toBeGreaterThan(g2.visibleTiles);
    // collapsed headers are compact
    const hs = await page.evaluate(() => [...document.querySelectorAll('.pal-acc-btn')].map(b => b.getBoundingClientRect().height));
    expect(hs).toHaveLength(SECTIONS.length);
    for (const x of hs) expect(x).toBeLessThanOrEqual(26);
    if (w === 1400) {
      // all collapsed at 1400x900: everything fits, nothing to scroll in the palette
      expect(await page.evaluate(() => { const p = document.getElementById('palette-panel')!; return p.scrollHeight - p.clientHeight; })).toBeLessThanOrEqual(1);
    }
  });
}

test('opening a section collapses the previous one; every open section is capped and scrolls inside itself, the tile region never drops below its minimum', async ({ page }) => {
  await start(page, 1400, 900);
  await header(page, 'stamps').click();
  expect(await openKeys(page)).toEqual(['stamps']);
  await header(page, 'layers').click();
  expect(await openKeys(page)).toEqual(['layers']);
  const st = await state(page);
  expect(st.find(s => s.key === 'stamps')).toMatchObject({ expanded: 'false', hidden: true, shown: false });
  expect(st.find(s => s.key === 'layers')).toMatchObject({ expanded: 'true', hidden: false, shown: true });
  await header(page, 'layers').click();                                // the open header closes its section
  expect(await openKeys(page)).toEqual([]);
  for (const [w, h] of [[1400, 900], [1100, 700]] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const [key, id] of SECTIONS) {
      await openSection(page, key);
      expect(await openKeys(page)).toEqual([key]);
      const g = await page.evaluate(i => {
        const b = document.getElementById(i)!, pal = document.getElementById('palette-panel')!;
        return { bodyH: b.getBoundingClientRect().height, cap: pal.clientHeight * 0.45, ov: getComputedStyle(b).overflowY, region: document.getElementById('palette-tiles')!.getBoundingClientRect().height };
      }, id);
      expect(g.bodyH, key).toBeLessThanOrEqual(g.cap + 1);
      expect(g.ov, key).toBe('auto');
      expect(g.region, `${key} at ${w}x${h}`).toBeGreaterThanOrEqual(TILES_MIN);
    }
  }
  // a section with more content than its cap scrolls inside itself (12 stamps at 1100x700)
  await page.evaluate(async () => {
    const stamps = Array.from({ length: 12 }, (_, i) => ({ name: 's' + i, created: 1000 + i, v: 1, cells: [{ dq: 0, dr: 0, t: 'Forest_1' }] }));
    await Stamps.importJson(JSON.stringify({ format: 'mapeditor-stamps', version: 1, stamps }));
    await Stamps.refresh();
  });
  await openSection(page, 'stamps');
  await expect(page.locator('.stamp-row')).toHaveCount(12);
  const s = await page.evaluate(() => { const b = document.getElementById('stamp-panel')!, l = document.getElementById('stamp-list')!; return { body: [b.scrollHeight, b.clientHeight], list: [l.scrollHeight, l.clientHeight] }; });
  expect(s.body[0] > s.body[1] + 1 || s.list[0] > s.list[1] + 1).toBe(true);
  expect((await tileGeo(page)).region).toBeGreaterThanOrEqual(TILES_MIN);
});

test('keyboard: Enter and Space toggle the focused header and keep focus on it; ArrowDown/ArrowUp move between headers; a pointer click does not keep focus', async ({ page }) => {
  await start(page, 1400, 900);
  await header(page, 'stamps').focus();
  await page.keyboard.press('Enter');
  expect(await openKeys(page)).toEqual(['stamps']);
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.acc)).toBe('stamps');
  await page.keyboard.down('Space');
  expect(await page.evaluate(() => (document.getElementById('map-canvas') as HTMLElement).style.cursor)).not.toBe('grab');   // the global Space-pan handler never saw the key
  await page.keyboard.up('Space');
  expect(await openKeys(page)).toEqual([]);
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.acc)).toBe('stamps');
  // (the global Space-pan handler calls preventDefault on Space: the toggle above proves the header keeps the key to itself)
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.acc)).toBe('layers');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.acc)).toBe('bookmarks');   // across the View / Edit group heading
  expect(await openKeys(page)).toEqual([]);                            // arrows only move focus
  // pointer click: opens, and the header does not keep focus (Space goes back to panning the map)
  await header(page, 'history').click();
  expect(await openKeys(page)).toEqual(['history']);
  expect(await page.evaluate(() => document.activeElement === document.querySelector('.pal-acc-btn[data-acc="history"]'))).toBe(false);
  await page.keyboard.down('Space');
  expect(await page.evaluate(() => (document.getElementById('map-canvas') as HTMLElement).style.cursor)).toBe('grab');          // Space pans the map again
  await page.keyboard.up('Space');
  expect(await openKeys(page)).toEqual(['history']);
});

// Tab itself is the editor's mode-cycle shortcut outside text fields (pre-existing), so focusability is checked directly: a collapsed
// body takes no focus (display:none), and Tab from a text field in an open section moves on natively and never lands in a collapsed one.
test('collapsed content is not focusable; Tab from a text field never lands in a collapsed section', async ({ page }) => {
  await start(page, 1400, 900);
  await page.evaluate(() => Bookmarks.add('one'));                       // a bookmark row: more buttons in a collapsed body
  const focusable = (open: boolean) => page.evaluate(want => {
    const out: Record<string, [number, number]> = {};
    for (const b of document.querySelectorAll<HTMLElement>('.pal-acc-btn')) {
      const body = document.getElementById(b.getAttribute('aria-controls')!)!;
      if ((b.getAttribute('aria-expanded') === 'true') !== want) continue;
      const els = [...body.querySelectorAll<HTMLElement>('button, input:not([type=file]), select, [tabindex]')];
      let took = 0;
      for (const el of els) { (document.activeElement as HTMLElement | null)?.blur(); el.focus(); if (document.activeElement === el) took++; }
      out[b.dataset.acc!] = [els.length, took];
    }
    return out;
  }, open);
  const closed = await focusable(false);
  expect(Object.keys(closed)).toHaveLength(SECTIONS.length);
  for (const [k, [n, took]] of Object.entries(closed)) { if (k !== 'zones') expect(n, k).toBeGreaterThan(0); expect(took, k).toBe(0); }
  // positive control: the same controls take focus once their section is open
  await openSection(page, 'bookmarks');
  const opened = await focusable(true);
  expect(opened.bookmarks[0]).toBeGreaterThan(2);
  expect(opened.bookmarks[1]).toBe(opened.bookmarks[0]);
  // Tab from the go-to field (a text field: native Tab) reaches its Go button; Shift+Tab goes back to its own header,
  // never into the collapsed Minimap section before it
  await openSection(page, 'goto');
  await page.locator('#goto-input').focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement!.id)).toBe('goto-btn');
  await page.locator('#goto-input').focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => document.activeElement!.id)).toBe('acc-btn-goto');
});

test('the open section is remembered across a reload (default: none open), and closing it is remembered too', async ({ page }) => {
  await start(page, 1400, 900);
  expect(await openKeys(page)).toEqual([]);
  await header(page, 'layers').click();
  await reloadEditor(page);
  expect(await openKeys(page)).toEqual(['layers']);
  await expect(page.locator('#layers-panel .layer-row').first()).toBeVisible();
  await header(page, 'layers').click();
  await reloadEditor(page);
  expect(await openKeys(page)).toEqual([]);
});

test('storage blocked: the accordion starts all collapsed and still opens and closes, no page error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const g = Storage.prototype.getItem, s = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key: string) { if (key === 'paletteOpenSection') throw new DOMException('denied', 'SecurityError'); return g.call(this, key); };
    Storage.prototype.setItem = function (key: string, v: string) { if (key === 'paletteOpenSection') throw new DOMException('denied', 'SecurityError'); return s.call(this, key, v); };
  });
  await start(page, 1400, 900);
  expect(await openKeys(page)).toEqual([]);
  await header(page, 'bookmarks').click();
  expect(await openKeys(page)).toEqual(['bookmarks']);
  await header(page, 'goto').click();
  expect(await openKeys(page)).toEqual(['goto']);
  await header(page, 'goto').click();
  expect(await openKeys(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('badges: Layers shows the hidden/locked count (the status-bar summary stays), Bookmarks and Stamps show their counts', async ({ page }) => {
  await start(page, 1400, 900);
  const badge = (key: string) => page.locator(`.pal-acc-btn[data-acc="${key}"] .pal-acc-badge`);
  await expect(badge('layers')).toHaveText('');
  await expect(badge('bookmarks')).toHaveText('');
  await page.evaluate(() => { Layers.setVisible('roads', false); Layers.setLocked('terrain', true); Layers.setLocked('objects', true); });
  await expect(badge('layers')).toHaveText('1 hidden · 2 locked');
  await expect(page.locator('#st-layers')).toHaveText('Hidden: Roads · Locked: Terrain, Buildings & bridges');
  await page.evaluate(() => { Layers.setVisible('roads', true); Layers.setLocked('terrain', false); Layers.setLocked('objects', false); });
  await expect(badge('layers')).toHaveText('');
  await page.evaluate(() => { Bookmarks.add('a'); Bookmarks.add('b'); });
  await expect(badge('bookmarks')).toHaveText('2');
  await page.evaluate(async () => {
    const stamps = Array.from({ length: 3 }, (_, i) => ({ name: 's' + i, created: 1000 + i, v: 1, cells: [{ dq: 0, dr: 0, t: 'Forest_1' }] }));
    await Stamps.importJson(JSON.stringify({ format: 'mapeditor-stamps', version: 1, stamps }));
    await Stamps.refresh();
  });
  await expect(badge('stamps')).toHaveText('3');
  // the validator shows its last result, and marks it outdated after a map change
  await page.evaluate(() => MapValidator.runPanel());
  await expect(badge('validator')).not.toHaveText('');
  const before = await badge('validator').textContent();
  await page.evaluate(() => MapValidator.invalidate());
  await expect(badge('validator')).toHaveText(before + ' (old)');
});

test('the canvas size is unchanged (classic 1491x808 at 1400x900, palette 220 px); no accordion header in the toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page);                                               // classic layout (seeded by the helper)
  const r = await page.evaluate(() => ({
    canvas: [(document.getElementById('map-canvas') as HTMLCanvasElement).width, (document.getElementById('map-canvas') as HTMLCanvasElement).height],
    palette: Math.round(document.getElementById('palette-panel')!.getBoundingClientRect().width),
    toolbarControls: document.querySelectorAll('#toolbar button, #toolbar select, #toolbar input').length,
    accInToolbar: document.querySelectorAll('#toolbar .pal-acc-btn').length,
  }));
  // 57 toolbar controls before the UI-structure task; 44 after it: the 8 tool buttons moved to the palette tool rows and the
  // 5 zone-painter controls (Randomize & Fill, its patch slider, Fill Zones, Overlay, Clear Zones) moved to the Zones section.
  expect(r).toEqual({ canvas: [1491, 808], palette: 220, toolbarControls: 44, accInToolbar: 0 });
  await openSection(page, 'stamps');
  expect(await page.evaluate(() => [(document.getElementById('map-canvas') as HTMLCanvasElement).width, (document.getElementById('map-canvas') as HTMLCanvasElement).height])).toEqual([1491, 808]);
});
