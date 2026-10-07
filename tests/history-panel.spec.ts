import { test, expect, Page } from '@playwright/test';
import { freshEditor, clickCell, dragCells } from './editor-helpers';
import { openSection } from './helpers';

// T4.10 History panel (left palette, collapsible). History is EXTENDED, not replaced: the token return, rollback,
// fill/stroke gating, structural row sharing and the Ctrl+Z/Y behaviour stay as they were (perf-history and
// phase1-cleanup specs cover those); this file covers labels, entries, jump, the meta lockstep and the panel.
const rows = (page: Page) => page.locator('#history-list .hist-row');
const labels = (page: Page) => rows(page).allTextContents();
async function openPanel(page: Page) { await openSection(page, 'history'); }
const cell = (page: Page, i = 0) => page.evaluate(i => mapData[i], i);

test.beforeEach(async ({ page }) => { await freshEditor(page); await openPanel(page); });

test('the panel is a collapsed section of the LEFT palette and the canvas keeps its size', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.locator('.pal-acc-btn[data-acc="history"]').click();      // the beforeEach opened it: the header closes it again
  const info = await page.evaluate(() => {
    const p = document.getElementById('history-panel')!, c = document.getElementById('map-canvas') as HTMLCanvasElement;
    const h = document.querySelector('.pal-acc-btn[aria-controls="history-panel"]')!;
    return { inLeft: document.getElementById('palette-panel')!.contains(p), collapsed: p.hidden && h.getAttribute('aria-expanded') === 'false', header: h.tagName, w: c.width, h: c.height,
      inToolbar: !!document.getElementById('toolbar')?.contains(p) };
  });
  expect(info).toMatchObject({ inLeft: true, collapsed: true, header: 'BUTTON', w: 1491, h: 808, inToolbar: false });
});

test('lists labelled steps newest first, marks the current one and jumps through them', async ({ page }) => {
  await page.evaluate(() => {
    History.clear();
    History.push('Open map');
    History.push('Paint');  mapData[0] = 'Rubble_1';
    History.push('Fill');   mapData[0] = 'Water_1';
  });
  expect(await labels(page)).toEqual(['Fill', 'Paint', 'Open map']);
  await expect(page.locator('#history-list .hist-row.current')).toHaveText('Fill');
  await expect(page.locator('#history-list .hist-row.current')).toHaveAttribute('aria-current', 'true');

  await rows(page).filter({ hasText: 'Paint' }).click();
  expect(await cell(page)).toBe('Rubble_1');
  expect(await labels(page)).toEqual(['Fill', 'Paint', 'Open map']);               // undone steps stay listed
  await expect(page.locator('#history-list .hist-row.current')).toHaveText('Paint');
  await expect(page.locator('#history-list .hist-row.undone')).toHaveText('Fill');
  await rows(page).filter({ hasText: 'Open map' }).click();
  expect(await cell(page)).toBe('Plain_1');
  await rows(page).filter({ hasText: 'Fill' }).click();                             // redo two steps
  expect(await cell(page)).toBe('Water_1');
  await expect(page.locator('#history-list .hist-row.current')).toHaveText('Fill');
});

test('a new action after jumping back drops the undone entries', async ({ page }) => {
  await page.evaluate(() => { History.clear(); History.push('Open map'); History.push('Paint'); mapData[0] = 'Rubble_1'; });
  await rows(page).filter({ hasText: 'Open map' }).click();
  await page.evaluate(() => { History.push('Erase'); mapData[0] = 'Water_1'; });
  expect(await labels(page)).toEqual(['Erase', 'Open map']);
});

test('meta arrays stay in lockstep with the snapshot stacks after every kind of operation (eviction and rollback tokens included)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const out: any = { bad: [] as string[] };
    const chk = (tag: string) => {
      const e = History.getEntries();
      if (e.done.length !== History.undoSize() || e.undone.length !== History.redoSize()) out.bad.push(`${tag}: ${e.done.length}/${History.undoSize()} ${e.undone.length}/${History.redoSize()}`);
      if (e.done.some((m: any) => typeof m.label !== 'string' || !m.label) || e.undone.some((m: any) => typeof m.label !== 'string' || !m.label)) out.bad.push(tag + ': label');
    };
    const L = () => History.getEntries().done.map((m: any) => m.label).join('|');
    const U = () => History.getEntries().undone.map((m: any) => m.label).join('|');
    History.clear(); chk('clear');
    History.push('a'); chk('push'); History.push('b'); History.push(); chk('push default');
    out.dflt = History.getEntries().done[2].label;
    History.undo(); chk('undo'); History.undo(); chk('undo2');
    out.afterUndo = [L(), U()];
    History.redo(); chk('redo');
    // rollback with a redo stack: the step, the redo entries and their labels all come back
    History.undo(); History.undo();                                  // done: none ; undone (redo order): a, b, Edit
    const before = [L(), U(), History.undoSize(), History.redoSize()];
    const tok = History.push('x'); chk('push over redo');
    out.afterPush = [L(), U()];
    out.rolled = History.rollback(tok); chk('rollback');
    out.afterRollback = [L(), U(), History.undoSize(), History.redoSize()]; out.before = before;
    out.rollbackAgain = History.rollback(tok); chk('rollback again');   // stale token: refused, nothing moves
    // eviction past the cap: 60 pushes keep 50 entries, the oldest labels fall off
    History.clear();
    for (let i = 0; i < 60; i++) { History.push('s' + i); if (i % 7 === 0) chk('push ' + i); }
    chk('after cap');
    out.capped = [History.undoSize(), History.getEntries().done[0].label, History.getEntries().done[49].label];
    // rollback of a push that EVICTED the oldest entry restores it with its label
    const t2 = History.push('over'); chk('evicting push');
    out.evictOldest = History.getEntries().done[0].label;
    History.rollback(t2); chk('rollback evicting');
    out.restoredOldest = History.getEntries().done[0].label;
    History.undo(); History.undo(); chk('undo again');
    out.redoLabels = U();
    return out;
  });
  expect(r.bad).toEqual([]);
  expect(r.dflt).toBe('Edit');
  expect(r.afterUndo).toEqual(['a', 'b|Edit']);                     // undone listed in redo order (next redo first)
  expect(r.before).toEqual(['', 'a|b|Edit', 0, 3]);
  expect(r.afterPush).toEqual(['x', '']);
  expect(r.rolled).toBe(true);
  expect(r.afterRollback).toEqual(r.before);
  expect(r.rollbackAgain).toBe(false);
  expect(r.capped).toEqual([50, 's10', 's59']);
  expect(r.evictOldest).toBe('s11');
  expect(r.restoredOldest).toBe('s10');                             // positive control: the evicted label came back
  expect(r.redoLabels).toBe('s58|s59');
});

test('jumpBy: bounded work (N restores, ONE render, ONE toast), clamped to the available steps, refused while a stroke runs', async ({ page }) => {
  const r = await page.evaluate(() => {
    History.clear();
    for (let i = 0; i < 8; i++) { History.push('s' + i); mapData[i] = 'Rubble_1'; }
    const cnt = { render: 0, toast: 0 };
    const rr = Canvas.render, tt = UI.toast;
    Canvas.render = function (...a: any[]) { cnt.render++; return rr.apply(this, a); };
    UI.toast = function (...a: any[]) { cnt.toast++; return tt.apply(this, a); };
    const r0 = History.debugRestoreCount();
    const n1 = History.jumpBy(-5);
    const o: any = { n1, restores: History.debugRestoreCount() - r0, renders: cnt.render, toasts: cnt.toast, undo: History.undoSize(), redo: History.redoSize() };
    const r1 = History.debugRestoreCount();
    o.n2 = History.jumpBy(-1000);                                     // clamped to what is left (3), never an unbounded loop
    o.restores2 = History.debugRestoreCount() - r1;
    o.n3 = History.jumpBy(1000);
    o.n4 = History.jumpBy(0); o.n5 = History.jumpBy(NaN); o.n6 = History.jumpBy(1.5);
    o.after = [History.undoSize(), History.redoSize(), mapData[7]];
    Canvas.render = rr; UI.toast = tt;
    return o;
  });
  expect(r).toMatchObject({ n1: -5, restores: 5, renders: 1, toasts: 1, undo: 3, redo: 5, n2: -3, restores2: 3, n3: 8, n4: 0, n5: 0, n6: 0 });
  expect(r.after).toEqual([8, 0, 'Rubble_1']);

  // refused while a stroke is active: nothing moves, a toast explains
  await page.evaluate(() => { History.clear(); History.push('one'); mapData[0] = 'Rubble_1'; Tools.setActive('paint'); });
  await page.evaluate(() => { Canvas.centerOnTile(100, 100); });
  const q = await page.evaluate(() => { const b = Canvas.hexScreenPos(100, 100), r = document.getElementById('map-canvas')!.getBoundingClientRect(); return { x: r.left + b.x, y: r.top + b.y }; });
  await page.mouse.move(q.x, q.y); await page.mouse.down();
  const g = await page.evaluate(() => ({ stroking: Tools.isStrokeActive(), n: History.jumpBy(-1), size: History.undoSize() }));
  await page.mouse.up();
  expect(g.stroking).toBe(true);
  expect(g.n).toBe(0);
  expect(g.size).toBe(2);                                           // the stroke's own step; the jump did not undo it
});

test('labels are rendered as text, the list is capped, the panel follows History through onChange (no polling)', async ({ page }) => {
  const r = await page.evaluate(() => {
    History.clear();
    History.push('<img src=x onerror="window.__xss=1"><b>bold</b>');
    const calls = { n: 0 };
    History.onChange(() => { calls.n++; });
    History.push('two');
    const list = document.getElementById('history-list')!;
    return { imgs: list.querySelectorAll('img, b').length, text: list.textContent, calls: calls.n, xss: (window as any).__xss };
  });
  expect(r.imgs).toBe(0);
  expect(r.text).toContain('<img src=x');
  expect(r.xss).toBeUndefined();
  expect(r.calls).toBe(1);
  await page.evaluate(() => { History.clear(); for (let i = 0; i < 60; i++) History.push('s' + i); });
  expect(await rows(page).count()).toBe(51);                         // MAX undo steps (the display cap) + the 'Earlier state' row (state before the oldest kept step)
  await page.evaluate(() => { for (let i = 0; i < 40; i++) History.undo(); });
  const t = await labels(page);
  expect(t).toHaveLength(36);                                        // 25 nearest undone + the 10 done steps left + the 'Earlier state' row (eviction happened)
  expect(t[35]).toMatch(/^Earlier state/);
  expect(t[0]).toBe('s44');                                          // furthest SHOWN undone step on top, the nearest (s20) just above current
  expect(t[24]).toBe('s20');
  expect(t[25]).toBe('s19');
  expect(await page.locator('#history-list .hist-row.current').count()).toBe(1);
});

test('rows are real buttons: keyboard Enter jumps and keeps focus on the panel; a pointer click returns focus to the map', async ({ page }) => {
  await page.evaluate(() => { History.clear(); History.push('Open map'); History.push('Paint'); mapData[0] = 'Rubble_1'; History.push('Fill'); mapData[0] = 'Water_1'; });
  expect(await page.evaluate(() => [...document.querySelectorAll('#history-list .hist-row')].every(b => b.tagName === 'BUTTON' && (b as HTMLButtonElement).type === 'button'))).toBe(true);
  await rows(page).nth(1).focus();                                   // 'Paint'
  await page.keyboard.press('Enter');
  expect(await cell(page)).toBe('Rubble_1');
  expect(await page.evaluate(() => document.activeElement?.closest('#history-list') !== null)).toBe(true);   // focus not lost to the re-render
  await rows(page).filter({ hasText: 'Fill' }).click();
  expect(await cell(page)).toBe('Water_1');
  expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement?.id === 'map-canvas')).toBe(true);
  // Ctrl+Z / Ctrl+Y unchanged
  await page.keyboard.press('Control+z');
  expect(await cell(page)).toBe('Rubble_1');
  await page.keyboard.press('Control+y');
  expect(await cell(page)).toBe('Water_1');
});

test('the main tools label their History step (behaviour unchanged)', async ({ page }) => {
  const last = () => page.evaluate(() => { const d = History.getEntries().done; return d[d.length - 1].label; });
  await page.evaluate(() => { History.clear(); UI.selectTerrain('Rubble_1'); });
  await clickCell(page, 225, 230);                                   // paint
  expect(await last()).toBe('Paint');
  await page.evaluate(() => Tools.setActive('rect'));
  await dragCells(page, { col: 220, row: 220 }, { col: 222, row: 222 });
  expect(await last()).toBe('Rectangle');
  await page.evaluate(() => Tools.setActive('eraser'));
  await clickCell(page, 225, 230);
  expect(await last()).toBe('Eraser');
  await page.evaluate(() => { Tools.moveCity(230, 220); });
  expect(await last()).toBe('Move City');
  const before = await page.evaluate(() => History.undoSize());
  await page.evaluate(() => IO.clearMap());
  await page.click('#confirm-ok');
  expect(await page.evaluate(() => History.undoSize())).toBe(before + 1);   // positive control: the clear really pushed a step
  expect(await last()).toBe('Clear map');
});

test('after eviction the bottom row reaches the oldest retained snapshot (_undo[0]); without eviction there is no extra row', async ({ page }) => {
  // a marker per snapshot: push AFTER writing it, so snapshot i holds 'T<i>'
  await page.evaluate(() => { History.clear(); for (let i = 0; i < 60; i++) { mapData[0] = 'T' + i; History.push('s' + i); } mapData[0] = 'LIVE'; History.push('last'); });
  const last = rows(page).last();
  await expect(last).toHaveText(/Earlier state/);
  await last.click();
  expect(await cell(page)).toBe('T11');           // 61 pushes: T0..T10 evicted, _undo[0] holds T11: the oldest state still held
  expect(await page.evaluate(() => [History.undoSize(), History.redoSize()])).toEqual([0, 50]);
  await rows(page).first().click(); await rows(page).first().click();   // the panel shows at most 25 redo rows: two clicks redo everything, back at LIVE
  expect(await cell(page)).toBe('LIVE');
  // positive control: no eviction -> the bottom row is the oldest action, no 'Earlier state' row
  await page.evaluate(() => { History.clear(); History.push('Open map'); History.push('Paint'); });
  expect(await labels(page)).toEqual(['Paint', 'Open map']);
});
