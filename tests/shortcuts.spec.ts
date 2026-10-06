import { test, expect, Page } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// T4.4: one shortcut registry drives the new keys AND the help panel; the table must equal the real handlers.
// Every expectation below is hand-written (not derived from the registry).

const zoom = (page: Page) => page.evaluate(() => Canvas.getZoom());
const tool = (page: Page) => page.evaluate(() => Tools.getActive());
const opacity = (page: Page, id: string) => page.evaluate((i) => getComputedStyle(document.getElementById(i)!).opacity, id);
const ringsOn = (page: Page) => page.evaluate(() => document.getElementById('btn-zones')!.classList.contains('active'));
const press = (page: Page, k: string) => page.keyboard.press(k);

test.describe('registry keys', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('+ / = zoom in, - zooms out, 0 fits the map', async ({ page }) => {
    await page.evaluate(() => Canvas.setZoom(100));
    await press(page, '+');
    const a = await zoom(page); expect(a).toBeGreaterThan(100);
    await press(page, '=');
    const b = await zoom(page); expect(b).toBeGreaterThan(a);
    await press(page, '-');
    const c = await zoom(page); expect(c).toBeLessThan(b);
    await page.evaluate(() => Canvas.setZoom(150));
    const fit = await page.evaluate(() => { Canvas.fitToScreen(); const z = Canvas.getZoom(); Canvas.setZoom(150); return z; });
    expect(fit).not.toBe(150);                                   // positive control: the key must have something to change
    await press(page, '0');
    expect(await zoom(page)).toBe(fit);
  });

  test('1 / 2 / 3 toggle the distance rings, block rulers and coastline', async ({ page }) => {
    expect(await ringsOn(page)).toBe(false);
    await press(page, '1'); expect(await ringsOn(page)).toBe(true);
    await press(page, '1'); expect(await ringsOn(page)).toBe(false);
    const r0 = await opacity(page, 'btn-toggle-rulers'), c0 = await opacity(page, 'btn-toggle-coastline');
    await press(page, '2'); expect(await opacity(page, 'btn-toggle-rulers')).not.toBe(r0);
    await press(page, '2'); expect(await opacity(page, 'btn-toggle-rulers')).toBe(r0);
    await press(page, '3'); expect(await opacity(page, 'btn-toggle-coastline')).not.toBe(c0);
    await press(page, '3'); expect(await opacity(page, 'btn-toggle-coastline')).toBe(c0);
  });

  test('never while typing, with a modal open, with Ctrl / Alt / Meta, and a held 1 toggles once', async ({ page }) => {
    await page.evaluate(() => Canvas.setZoom(100));
    await page.focus('#goto-input');
    await page.keyboard.type('1+-0');                           // typed into the box
    expect(await ringsOn(page)).toBe(false);
    expect(await zoom(page)).toBe(100);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    for (const mod of ['Control', 'Alt', 'Meta']) { await press(page, `${mod}+1`); await press(page, `${mod}+-`); }
    expect(await ringsOn(page)).toBe(false);
    expect(await zoom(page)).toBe(100);
    // a held key (repeat) toggles only once
    await page.evaluate(() => {
      for (const rep of [false, true, true]) window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', repeat: rep, bubbles: true, cancelable: true }));
    });
    expect(await ringsOn(page)).toBe(true);
    await press(page, '1');
    // modal open
    await page.evaluate(() => UI.showModal({ title: 'x', body: 'y', actions: [{ label: 'Close', onClick: (c: any) => c() }] }));
    await press(page, '+'); await press(page, '1');
    expect(await zoom(page)).toBe(100);
    expect(await ringsOn(page)).toBe(false);
    // composition and key names
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', isComposing: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', code: 'Digit1', bubbles: true, cancelable: true }));
    });
    expect(await ringsOn(page)).toBe(false);
  });

  test('a registry key only runs in the map mode', async ({ page }) => {
    await page.evaluate(() => { Canvas.setZoom(100); App.setMode('hexdb'); });
    await press(page, '+');
    await page.evaluate(() => App.setMode('map'));
    expect(await zoom(page)).toBe(100);
  });

  test('[ and ] belong to the brush alone: one step per press, never registered as a runnable key', async ({ page }) => {
    await page.evaluate(() => Brush.setSize(3));
    await press(page, ']'); expect(await page.evaluate(() => Brush.getSize())).toBe(4);
    await press(page, '['); await press(page, '['); expect(await page.evaluate(() => Brush.getSize())).toBe(2);
    const bound = await page.evaluate(() => Shortcuts.getAll().filter((d: any) => d.bound).map((d: any) => d.display));
    expect(bound.length).toBeGreaterThan(3);                    // positive control
    expect(bound.join('|')).not.toMatch(/[\[\]]/);
  });

  test('a float transform key that types - (QWERTZ Slash) mirrors once and does not also zoom', async ({ page }) => {
    await page.evaluate(() => { Canvas.setZoom(100); Selection.selectAll(); Tools.copySelection(); });
    await page.evaluate(() => { Tools.beginPaste(Clipboard.get()); });
    expect(await page.evaluate(() => Tools.isPasting())).toBe(true);
    const t0 = await page.evaluate(() => JSON.stringify(Tools.getFloatTransform()));
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', code: 'Slash', bubbles: true, cancelable: true })));
    expect(await page.evaluate(() => JSON.stringify(Tools.getFloatTransform()))).not.toBe(t0);   // the mirror ran
    expect(await zoom(page)).toBe(100);                          // and the zoom did not
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', code: 'Minus', bubbles: true, cancelable: true })));
    expect(await zoom(page)).toBeLessThan(100);                  // the real minus key still zooms during a paste
  });
});

// ---- the table equals the handlers ------------------------------------------------------------------------------------
const TOOLS: Record<string, string> = { p: 'paint', f: 'fill', r: 'rect', e: 'eye', s: 'select', t: 'settlement', d: 'erase', z: 'zone', l: 'line', o: 'circle', g: 'polygon', x: 'eraser', a: 'scatter', m: 'marquee', h: 'replace', b: 'object', w: 'road', c: 'road-connect', q: 'erase-road', u: 'bridge' };

// id -> hand-written press + observable. A registry entry without a probe fails the coverage test (so a new entry must be proven here).
const PROBES: Record<string, (page: Page) => Promise<void>> = {
  'zoom-in': async p => { await p.evaluate(() => Canvas.setZoom(100)); await press(p, '+'); expect(await zoom(p)).toBeGreaterThan(100); },
  'zoom-out': async p => { await p.evaluate(() => Canvas.setZoom(100)); await press(p, '-'); expect(await zoom(p)).toBeLessThan(100); },
  'fit-map': async p => { await p.evaluate(() => Canvas.setZoom(150)); await press(p, '0'); expect(await zoom(p)).toBeLessThan(150); },
  'ov-rings': async p => { const a = await ringsOn(p); await press(p, '1'); expect(await ringsOn(p)).toBe(!a); },
  'ov-rulers': async p => { const a = await opacity(p, 'btn-toggle-rulers'); await press(p, '2'); expect(await opacity(p, 'btn-toggle-rulers')).not.toBe(a); },
  'ov-coast': async p => { const a = await opacity(p, 'btn-toggle-coastline'); await press(p, '3'); expect(await opacity(p, 'btn-toggle-coastline')).not.toBe(a); },
  'brush-smaller': async p => { await p.evaluate(() => Brush.setSize(3)); await press(p, '['); expect(await p.evaluate(() => Brush.getSize())).toBe(2); },
  'brush-larger': async p => { await p.evaluate(() => Brush.setSize(3)); await press(p, ']'); expect(await p.evaluate(() => Brush.getSize())).toBe(4); },
  'tool-symmetry': async p => { const a = await p.evaluate(() => Tools.getSymmetry()); await press(p, 'y'); expect(await p.evaluate(() => Tools.getSymmetry())).not.toBe(a); },
  undo: async p => { await p.evaluate(() => { History.push(); mapData[5] = 'Water_1'; }); const n = await p.evaluate(() => History.undoSize()); await press(p, 'Control+z'); expect(await p.evaluate(() => History.undoSize())).toBe(n - 1); },
  redo: async p => { await p.evaluate(() => { History.push(); mapData[5] = 'Water_1'; History.undo(); }); const n = await p.evaluate(() => History.redoSize()); expect(n).toBeGreaterThan(0); await press(p, 'Control+y'); expect(await p.evaluate(() => History.redoSize())).toBe(n - 1); },
  'select-all': async p => { await press(p, 'Control+a'); expect(await p.evaluate(() => Selection.isEmpty())).toBe(false); },
  deselect: async p => { await p.evaluate(() => Selection.selectAll()); await press(p, 'Control+d'); expect(await p.evaluate(() => Selection.isEmpty())).toBe(true); },
  copy: async p => { await p.evaluate(() => Selection.selectAll()); expect(await p.evaluate(() => !!Clipboard.get())).toBe(false); await press(p, 'Control+c'); expect(await p.evaluate(() => !!Clipboard.get())).toBe(true); },
  cut: async p => { await p.evaluate(() => { mapData.fill('Water_1'); Selection.selectAll(); }); const n = await p.evaluate(() => History.undoSize()); await press(p, 'Control+x'); expect(await p.evaluate(() => History.undoSize())).toBe(n + 1); },
  paste: async p => { await p.evaluate(() => { Selection.selectAll(); Tools.copySelection(); Selection.clear(); }); await press(p, 'Control+v'); expect(await p.evaluate(() => Tools.isPasting())).toBe(true); },
  'delete-selection': async p => { await p.evaluate(() => { mapData.fill('Water_1'); Selection.selectAll(); }); const n = await p.evaluate(() => History.undoSize()); await press(p, 'Delete'); expect(await p.evaluate(() => History.undoSize())).toBe(n + 1); },
  'move-selection': async p => { await p.evaluate(() => Selection.selectAll()); await press(p, 'Enter'); expect(await p.evaluate(() => Tools.isMoving())).toBe(true); },
  'cancel-selection': async p => { await p.evaluate(() => Selection.selectAll()); await press(p, 'Escape'); expect(await p.evaluate(() => Selection.isEmpty())).toBe(true); },
  'float-rotate-cw': async p => { await floatKey(p, 'Period'); },
  'float-rotate-ccw': async p => { await floatKey(p, 'Comma'); },
  'float-flip-h': async p => { await floatKey(p, 'Slash'); },
  'float-flip-v': async p => { await floatKey(p, 'Semicolon'); },
  'file-new': async p => { await press(p, 'Control+n'); await expect(p.locator('#newmap-modal')).toHaveClass(/open/); },
  'file-open': async p => { await p.evaluate(() => { (window as any).__fileClicks = 0; document.getElementById('file-input')!.addEventListener('click', e => { (window as any).__fileClicks++; e.preventDefault(); }); }); await press(p, 'Control+o'); expect(await p.evaluate(() => (window as any).__fileClicks)).toBe(1); },
  'file-save': async p => { const dl = p.waitForEvent('download'); await press(p, 'Control+s'); expect((await dl).suggestedFilename()).toMatch(/\.json$/); },
  'hexdb-save': async p => { await p.evaluate(() => App.setMode('hexdb')); const dl = p.waitForEvent('download'); await press(p, 'Control+Shift+S'); expect((await dl).suggestedFilename()).toBe('hex_database.json'); },
  'pan-space': async p => { await p.keyboard.down('Space'); expect(await p.evaluate(() => document.getElementById('map-canvas')!.style.cursor)).toBe('grab'); await p.keyboard.up('Space'); },
  'mode-tab': async p => { await press(p, 'Tab'); expect(await p.evaluate(() => document.body.classList.contains('mode-hexdb'))).toBe(true); },
};
for (const [l, t] of Object.entries(TOOLS)) PROBES['tool-' + t] = async p => {
  for (const sentinel of ['line', 'paint'].filter(s => s !== t)) {
    await p.evaluate((s) => Tools.setActive(s), sentinel);
    await press(p, l);
    expect(await tool(p), `${l} from ${sentinel}`).toBe(t);
  }
};
async function floatKey(page: Page, code: string) {
  await page.evaluate(() => { Selection.selectAll(); Tools.copySelection(); Tools.beginPaste(Clipboard.get()); });
  const t0 = await page.evaluate(() => JSON.stringify(Tools.getFloatTransform()));
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent('keydown', { key: c === 'Period' ? '.' : c === 'Comma' ? ',' : c === 'Slash' ? '/' : ';', code: c, bubbles: true, cancelable: true })), code);
  expect(await page.evaluate(() => JSON.stringify(Tools.getFloatTransform()))).not.toBe(t0);
}

test.describe('table equals handlers', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('every registered shortcut has a hand-written probe and every probe a registry entry (no drift in either direction)', async ({ page }) => {
    const ids: string[] = await page.evaluate(() => Shortcuts.getAll().map((d: any) => d.id));
    expect(ids.length).toBeGreaterThan(40);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter(i => !PROBES[i]), 'registered but never pressed by this spec').toEqual([]);
    expect(Object.keys(PROBES).filter(i => !ids.includes(i)), 'probe for a shortcut the registry does not list').toEqual([]);
  });

  // 'pan-space' / 'mode-tab' live in the same loop: each probe starts from a fresh editor.
  for (const id of Object.keys(PROBES)) {
    test(`pressing ${id} does what the table says`, async ({ page }) => { await PROBES[id](page); });
  }

  test('reverse scan: any plain key that changes editor state is in the registry', async ({ page }) => {
    const keys = [...'abcdefghijklmnopqrstuvwxyz0123456789+-=[],./;\'\\`?'];
    const reg: { display: string }[] = await page.evaluate(() => Shortcuts.getAll());
    const listed = new Set<string>();
    reg.forEach(d => d.display.split(' / ').forEach(s => { if (s.length === 1) listed.add(s.toLowerCase()); }));
    const changed = await page.evaluate((ks) => {
      const out: string[] = [];
      const state = () => [Tools.getActive(), Tools.getSymmetry(), Canvas.getZoom(), Brush.getSize(), document.getElementById('btn-zones')!.className,
        getComputedStyle(document.getElementById('btn-toggle-rulers')!).opacity, getComputedStyle(document.getElementById('btn-toggle-coastline')!).opacity].join('|');
      const typed = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: /^[a-z]$/.test(k) ? 'Key' + k.toUpperCase() : /^[0-9]$/.test(k) ? 'Digit' + k : '', bubbles: true, cancelable: true }));
      for (const k of ks) for (const sentinel of ['line', 'paint']) {
        Tools.setActive(sentinel); Canvas.setZoom(100); Brush.setSize(3);
        const s0 = state(), sym0 = Tools.getSymmetry();
        typed(k);
        if (state() !== s0 && !out.includes(k)) out.push(k);
        while (Tools.getSymmetry() !== sym0) Tools.cycleSymmetry();
        // undo toggles
        if (document.getElementById('btn-zones')!.className !== s0.split('|')[4]) Canvas.toggleZones();
        if (getComputedStyle(document.getElementById('btn-toggle-rulers')!).opacity !== s0.split('|')[5]) Canvas.toggleRulers();
        if (getComputedStyle(document.getElementById('btn-toggle-coastline')!).opacity !== s0.split('|')[6]) Canvas.toggleCoastline();
      }
      return out;
    }, keys);
    expect(changed.length).toBeGreaterThan(20);                  // positive control: tools, zoom, brush, overlays all changed something
    expect(changed.filter(k => !listed.has(k)), 'undocumented keys that do something').toEqual([]);
    // keys nothing handles stay out of the table
    for (const k of ['i', 'j', 'k', 'n', 'v', '4', '5', '`']) { expect(changed).not.toContain(k); expect(listed.has(k), k).toBe(false); }
  });
});

// ---- help panel ---------------------------------------------------------------------------------------------------------
test.describe('help panel', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('the left-palette button opens it; it lists every registered shortcut (generated from the registry); Escape closes it', async ({ page }) => {
    await page.click('#btn-shortcut-help');
    const help = page.locator('.shortcut-help-body');
    await expect(help).toBeVisible();
    const reg: { id: string; group: string; display: string; label: string }[] = await page.evaluate(() => Shortcuts.getAll());
    expect(reg.length).toBeGreaterThan(40);
    const rows: string[][] = await page.evaluate(() => Array.from(document.querySelectorAll('.shortcut-help-body tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent || '')));
    for (const d of reg) expect(rows.some(r => r[0] === d.display && r[1] === d.label), `${d.id} (${d.display} / ${d.label})`).toBe(true);
    expect(rows.length).toBe(reg.length);                        // nothing extra either
    const heads = await page.evaluate(() => Array.from(document.querySelectorAll('.shortcut-help-body h4')).map(h => h.textContent));
    expect(heads).toEqual([...new Set(reg.map(d => d.group))]);
    // tool keys are documented
    for (const l of Object.keys(TOOLS)) expect(rows.some(r => r[0] === l.toUpperCase()), `tool key ${l.toUpperCase()}`).toBe(true);
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    // keys work again afterwards
    await page.evaluate(() => Canvas.setZoom(100)); await press(page, '+');
    expect(await zoom(page)).toBeGreaterThan(100);
  });

  test('View menu entry opens the same panel; no key opens it (? and F1 are left alone)', async ({ page }) => {
    await press(page, '?'); await press(page, 'F1'); await press(page, 'Shift+Slash');
    await expect(page.locator('.shortcut-help-body')).toHaveCount(0);
    await page.evaluate(() => Shortcuts.showHelp());
    await expect(page.locator('.shortcut-help-body')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.click('#menu-view');
    await page.click('#menu-view button:has-text("Keyboard Shortcuts")');
    await expect(page.locator('.shortcut-help-body')).toBeVisible();
  });

  test('labels are text, never HTML', async ({ page }) => {
    await page.evaluate(() => Shortcuts.register({ id: 'evil', group: '<b>G</b>', keys: [], display: '<i>K</i>', label: '<img src=x onerror="window.__xss=1">L' }));
    await page.evaluate(() => Shortcuts.showHelp());
    const r = await page.evaluate(() => ({ imgs: document.querySelectorAll('.shortcut-help-body img, .shortcut-help-body b, .shortcut-help-body i').length, xss: (window as any).__xss ?? null,
      text: document.querySelector('.shortcut-help-body')!.textContent!.includes('<img src=x') }));
    expect(r).toEqual({ imgs: 0, xss: null, text: true });
  });

  test('the button sits in the left palette (not the toolbar or the right panel)', async ({ page }) => {
    const r = await page.evaluate(() => { const b = document.getElementById('btn-shortcut-help')!; return { left: !!b.closest('#palette-panel'), toolbar: !!b.closest('#toolbar'), right: !!b.closest('#right-panel'), tag: b.tagName, type: b.getAttribute('type') }; });
    expect(r).toEqual({ left: true, toolbar: false, right: false, tag: 'BUTTON', type: 'button' });
  });
});
