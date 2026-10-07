import { test, expect, Page } from '@playwright/test';
import { openEditor } from './helpers';

test.beforeEach(async ({ page }) => { await openEditor(page); });

const open = (page: Page, src: string) => page.evaluate(src);
const count = (page: Page) => page.locator('.ui-modal').count();

test('open and close: structure, aria, button types, id suffix, double close', async ({ page }) => {
  await page.evaluate(() => {
    const w = window as any;
    w.__closed = [];
    w.__m = UI.showModal({
      title: 'Hello', body: 'plain body', id: 'hello',
      actions: [{ label: 'Cancel', onClick: (c: any) => c() }, { label: 'Go', primary: true, onClick: () => {} }, { label: 'Del', danger: true, onClick: () => {} }],
      onClose: (r: any) => w.__closed.push(r),
    });
  });
  const m = page.locator('.ui-modal');
  await expect(m).toHaveCount(1);
  expect(await m.getAttribute('id')).toMatch(/-modal$/);
  const dlg = m.locator('[role=dialog]');
  await expect(dlg).toHaveAttribute('aria-modal', 'true');
  const labelId = await dlg.getAttribute('aria-labelledby');
  await expect(page.locator('#' + labelId)).toHaveText('Hello');
  await expect(m).toContainText('plain body');
  const btns = m.locator('.modal-actions button');
  expect(await btns.evaluateAll(bs => bs.map(b => (b as HTMLButtonElement).type + ':' + b.className))).toEqual([
    'button:btn btn-cancel', 'button:btn btn-primary', 'button:btn btn-danger']);
  // the shared dialog is untouched
  await expect(page.locator('#dialog-modal.open')).toHaveCount(0);
  await m.getByRole('button', { name: 'Cancel' }).click();
  await expect(m).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__closed)).toEqual(['close']);
  // second close is a no-op: no throw, no second onClose
  expect(await page.evaluate(() => { const w = window as any; w.__m.close(); w.__m.close(); return w.__closed.length; })).toBe(1);
  // close() returns only after the DOM removal
  expect(await page.evaluate(() => { const r = UI.showModal({ title: 't', body: 'b' }); r.close(); return document.body.contains(r.el); })).toBe(false);
});

test('stacking: later modals on top, Escape closes only the topmost, shared dialog not superseded', async ({ page }) => {
  await page.evaluate(() => {
    const w = window as any; w.__log = [];
    w.__a = UI.showModal({ title: 'A', body: 'a', id: 'a', onClose: (r: any) => w.__log.push('A:' + r) });
    w.__b = UI.showModal({ title: 'B', body: 'b', id: 'b', onClose: (r: any) => w.__log.push('B:' + r) });
    w.__d = UI.showDialog({ title: 'Shared', message: 'x' });
  });
  await expect(page.locator('.ui-modal')).toHaveCount(2);
  const z = await page.evaluate(() => ['a', 'b'].map(i => +getComputedStyle(document.getElementById(i + '-modal')!).zIndex));
  expect(z[1]).toBeGreaterThan(z[0]);
  // both modals and the shared dialog coexist
  await expect(page.locator('#dialog-modal.open')).toHaveCount(1);
  await page.evaluate(() => UI.closeDialog());
  await page.locator('#b-modal button, #b-modal [tabindex]').first().focus().catch(() => {});
  await page.keyboard.press('Escape');
  await expect(page.locator('#b-modal')).toHaveCount(0);
  await expect(page.locator('#a-modal')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#a-modal')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__log)).toEqual(['B:escape', 'A:escape']);
});

test('two simultaneous modals keep independent actions and bodies', async ({ page }) => {
  await page.evaluate(() => {
    const w = window as any; w.__hits = [];
    UI.showModal({ title: 'One', body: 'first', id: 'one', actions: [{ label: 'Hit1', onClick: () => w.__hits.push(1) }] });
    UI.showModal({ title: 'Two', body: 'second', id: 'two', actions: [{ label: 'Hit2', onClick: (c: any) => { w.__hits.push(2); c(); } }] });
  });
  await page.locator('#two-modal').getByRole('button', { name: 'Hit2' }).click();
  await expect(page.locator('#two-modal')).toHaveCount(0);
  await expect(page.locator('#one-modal')).toContainText('first');
  await page.locator('#one-modal').getByRole('button', { name: 'Hit1' }).click();
  expect(await page.evaluate(() => (window as any).__hits)).toEqual([2, 1]);
  await expect(page.locator('#one-modal')).toHaveCount(1);   // an action that does not call close keeps it open
});

test('focus moves in, Tab/Shift+Tab cycle inside, focus returns on close', async ({ page }) => {
  await page.evaluate(() => { const b = document.getElementById('menu-undo') as HTMLElement; (document.getElementById('palette-selected-id') as any); document.body.insertAdjacentHTML('beforeend', '<button id="outside-btn">o</button>'); (document.getElementById('outside-btn') as HTMLElement).focus(); });
  await page.evaluate(() => {
    (window as any).__m = UI.showModal({ title: 'F', body: 'x', id: 'f', actions: [{ label: 'One', onClick: () => {} }, { label: 'Two', onClick: () => {} }] });
  });
  const active = () => page.evaluate(() => document.activeElement?.textContent);
  expect(await active()).toBe('One');
  await page.keyboard.press('Tab'); expect(await active()).toBe('Two');
  await page.keyboard.press('Tab'); expect(await active()).toBe('One');
  await page.keyboard.press('Shift+Tab'); expect(await active()).toBe('Two');
  await page.keyboard.press('Shift+Tab'); expect(await active()).toBe('One');
  expect(await page.evaluate(() => document.activeElement!.closest('.ui-modal') !== null)).toBe(true);
  await page.evaluate(() => (window as any).__m.close());
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('outside-btn');
});

test('autofocus option focuses a node in the body', async ({ page }) => {
  await page.evaluate(() => {
    const inp = document.createElement('input'); inp.id = 'mine';
    UI.showModal({ title: 'In', body: inp, id: 'in', autofocus: inp, actions: [{ label: 'OK', onClick: () => {} }] });
  });
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('mine');
});

test('backdrop closes with reason backdrop; blocking modal ignores it', async ({ page }) => {
  await page.evaluate(() => {
    const w = window as any; w.__log = [];
    UI.showModal({ title: 'soft', body: 's', id: 'soft', onClose: (r: any) => w.__log.push(r) });
  });
  await page.locator('#soft-modal').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#soft-modal')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__log)).toEqual(['backdrop']);
  await page.evaluate(() => { UI.showModal({ title: 'hard', body: 'h', id: 'hard', modal: true }); });
  await page.locator('#hard-modal').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#hard-modal')).toHaveCount(1);
  // a click inside the box never closes it
  await page.locator('#hard-modal .modal-box').click();
  await expect(page.locator('#hard-modal')).toHaveCount(1);
  // Escape still closes a blocking modal
  await page.keyboard.press('Escape');
  await expect(page.locator('#hard-modal')).toHaveCount(0);
});

test('mousedown inside + release on the backdrop does not close', async ({ page }) => {
  await page.evaluate(() => { const i = document.createElement('input'); i.id = 'drag'; UI.showModal({ title: 'd', body: i, id: 'drag' }); });
  const box = (await page.locator('#drag-modal .modal-box').boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height - 10);
  await page.mouse.down();
  await page.mouse.move(3, 3);
  await page.mouse.up();
  await expect(page.locator('#drag-modal')).toHaveCount(1);
});

test('everything is rendered as text: no element is created from title, body or labels', async ({ page }) => {
  const evil = '<img src=x onerror="window.__pwned=1" id="evil">';
  await page.evaluate((s) => {
    UI.showModal({ title: s, body: s, id: 'xss', actions: [{ label: s, onClick: () => {} }] });
    UI.showModal({ title: 't', body: s + '<b>', id: 'xss2' });
  }, evil);
  expect(await page.locator('#evil, .ui-modal img, .ui-modal b').count()).toBe(0);
  await expect(page.locator('#xss-modal h3')).toHaveText(evil);
  await expect(page.locator('#xss-modal .modal-actions button')).toHaveText(evil);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  // a DOM node body is inserted as is (callers build nodes)
  await page.evaluate(() => { const b = document.createElement('b'); b.id = 'mine'; b.textContent = 'ok'; UI.showModal({ title: 'n', body: b, id: 'node' }); });
  await expect(page.locator('#node-modal #mine')).toHaveText('ok');
});

test('an action that throws (sync or async) does not leave an overlay behind', async ({ page }) => {
  await page.evaluate(() => {
    UI.showModal({ title: 'e1', body: 'x', id: 'e1', actions: [{ label: 'Boom', onClick: () => { throw new Error('boom'); } }] });
  });
  const errs: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.locator('#e1-modal').getByRole('button', { name: 'Boom' }).click();
  await expect(page.locator('.ui-modal')).toHaveCount(0);
  await expect(page.locator('.toast').first()).toBeVisible();
  expect(errs.join('\n')).toContain('boom');
  await page.evaluate(() => {
    UI.showModal({ title: 'e2', body: 'x', id: 'e2', actions: [{ label: 'Rej', onClick: async () => { throw new Error('rejected'); } }] });
  });
  await page.locator('#e2-modal').getByRole('button', { name: 'Rej' }).click();
  await expect(page.locator('.ui-modal')).toHaveCount(0);
  // the editor is still usable
  expect(await page.evaluate(() => typeof UI.showModal)).toBe('function');
});

test('map shortcuts do not fire while a modal is open, and fire again after', async ({ page }) => {
  await page.evaluate(() => { Tools.setActive('erase'); (window as any).__k = UI.showModal({ title: 'k', body: 'x', id: 'k', actions: [{ label: 'OK', onClick: () => {} }] }); });
  await page.keyboard.press('p');
  await page.keyboard.press('f');
  expect(await page.evaluate(() => Tools.getActive())).toBe('erase');
  await page.evaluate(() => (window as any).__k.close());
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('p');
  expect(await page.evaluate(() => Tools.getActive())).not.toBe('erase');
});

test('Escape that something already handled (defaultPrevented) does not close the modal', async ({ page }) => {
  await page.evaluate(() => {
    const inp = document.createElement('input'); inp.id = 'own';
    inp.addEventListener('keydown', e => { if (e.key === 'Escape') e.preventDefault(); });
    UI.showModal({ title: 'p', body: inp, id: 'prev', autofocus: inp });
  });
  await page.keyboard.press('Escape');
  await expect(page.locator('#prev-modal')).toHaveCount(1);
  await page.locator('#own').evaluate(el => (el as HTMLElement).blur());
  await page.keyboard.press('Escape');
  await expect(page.locator('#prev-modal')).toHaveCount(0);
});

test('canvas input is ignored while a modal is open (mouse, wheel, keys)', async ({ page }) => {
  const snap = () => page.evaluate(() => ({ z: Canvas.getZoom ? Canvas.getZoom() : 0, map: mapData.join('|') }));
  await page.evaluate(() => { Tools.setActive('paint'); UI.showModal({ title: 'c', body: 'x', id: 'c' }); });
  const before = await snap();
  // events dispatched straight at the canvas (the overlay would normally intercept real ones)
  await page.evaluate(() => {
    const c = document.getElementById('map-canvas')!;
    const r = c.getBoundingClientRect();
    const o = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1 };
    c.dispatchEvent(new MouseEvent('mousedown', o));
    c.dispatchEvent(new MouseEvent('mousemove', o));
    c.dispatchEvent(new WheelEvent('wheel', { ...o, deltaY: -300 }));
  });
  expect(await snap()).toEqual(before);
  expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(false);
});

test('the modal has no fill gate: opens and closes whatever Tools.isFillBusy says', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const res = UI.showModal({ title: 'fill', body: 'x', id: 'fill' });
    const open = !!document.getElementById('fill-modal');
    res.close();
    return { open, gone: !document.getElementById('fill-modal'), busy: Tools.isFillBusy() };
  });
  expect(r.open && r.gone).toBe(true);
});
