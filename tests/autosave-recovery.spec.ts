import { test, expect } from '@playwright/test';
import { openEditor, reloadEditor, FakeGitHub } from './helpers';

// T0.12 round 4: side copies written while the autosave is unreadable are per-session snapshots
// (`map_side_<session>`), never deleted automatically and never judged stale.

const idbOpen = `new Promise(res => { const r = indexedDB.open('MapEditorPro', 1); r.onsuccess = () => res(r.result); })`;

const readIdbKey = (page: any, key: string) => page.evaluate(async ([k, o]: string[]) => {
  const db: any = await eval(o);
  return new Promise<any>(res => {
    const st = db.transaction('kv').objectStore('kv');
    const g = ((window as any).__origGet || IDBObjectStore.prototype.get).call(st, k);
    g.onsuccess = () => res(g.result ?? null);
  });
}, [key, idbOpen]);
const writeIdbKey = (page: any, key: string, v: any) => page.evaluate(async ([k, val, o]: any[]) => {
  const db: any = await eval(o);
  return new Promise<void>(res => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, k);
    tx.oncomplete = () => res();
  });
}, [key, v, idbOpen]);
// all side copies in IndexedDB: { key: value }
const idbSides = (page: any) => page.evaluate(async (o: string) => {
  const db: any = await eval(o);
  return new Promise<Record<string, string>>(res => {
    const st = db.transaction('kv').objectStore('kv');
    const range = IDBKeyRange.bound('map_side_', 'map_side_￿');
    const kq = st.getAllKeys(range);
    kq.onsuccess = () => {
      const vq = st.getAll(range);
      vq.onsuccess = () => { const out: any = {}; kq.result.forEach((k: any, i: number) => { out[k] = vq.result[i]; }); res(out); };
    };
  });
}, idbOpen);
const lsSides = (page: any) => page.evaluate(() => {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith('map_side_') || k.startsWith('map_autosave_pending')) out[k] = localStorage.getItem(k)!;
  }
  return out;
});
const noFlush = (page: any) => page.evaluate(() => { IO.autoSave = () => Promise.resolve(false); });
const mapJson = (tweak: (j: any) => void = () => {}) => {
  const j: any = new FakeGitHub().json('maps/current_map.json');
  tweak(j);
  return JSON.stringify(j);
};
const mapHash = (page: any) => page.evaluate(() => JSON.stringify([MAP_WIDTH, MAP_HEIGHT, mapData.join('|'), bridgesData, objectsData, tileExtras, settlements]));

// The IndexedDB read of `map_autosave` fails while localStorage.__failGet is set (so a test can switch it off).
const FAIL_GET_IF_FLAG = () => {
  const orig = IDBObjectStore.prototype.get; (window as any).__origGet = orig;
  IDBObjectStore.prototype.get = function (k: any) {
    if (k !== 'map_autosave' || !localStorage.getItem('__failGet')) return orig.call(this, k);
    const req: any = {};
    setTimeout(() => { Object.defineProperty(req, 'error', { value: new Error('read boom') }); req.onerror && req.onerror(); }, 0);
    return req;
  };
};

const dialog = (page: any) => page.locator('#dialog-modal.open');
const rows = (page: any) => page.locator('#dialog-modal.open .recovery-row');
const rowFor = (page: any, key: string) => page.locator(`#dialog-modal.open .recovery-row[data-key="${key}"]`);
const decideLater = (page: any) => page.locator('#dialog-actions').getByRole('button', { name: 'Decide later' }).click();
const createFromModal = (page: any) => page.locator('#newmap-modal .btn-primary', { hasText: 'Create' }).click();

// A valid main record, then the IndexedDB read starts failing (protected mode on the next reload).
async function setupProtected(page: any) {
  await page.addInitScript(FAIL_GET_IF_FLAG as any);
  await openEditor(page);
  const original = mapJson(j => { j._autosavedAt = 777; j.data[0][0] = 'Rubble_3'; });
  await writeIdbKey(page, 'map_autosave', original);
  await page.evaluate(() => { localStorage.removeItem('map_autosave'); localStorage.setItem('__failGet', '1'); });
  await noFlush(page);
  return original;
}
// One protected page load: (Decide later on an offer), Create from the startup modal, paint `tile`, flush.
async function protectedSession(page: any, tile: string) {
  await reloadEditor(page);
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(true);
  // the placeholder is never saved, whatever flushes run before a map exists
  await page.evaluate(async () => { await IO.autoSave(); window.dispatchEvent(new Event('pagehide')); });
  if (await dialog(page).count()) await decideLater(page);
  await expect(page.locator('#newmap-modal')).toHaveClass(/open/);
  await createFromModal(page);
  await page.evaluate(async (t: string) => { mapData[0] = t; await IO.autoSave(); window.dispatchEvent(new Event('pagehide')); }, tile);
  await page.waitForTimeout(200);
  await noFlush(page);
}
const sideTile = (v: string) => JSON.parse(v).data[0][0];

test('two protected sessions keep separate copies; both are listed; restoring one removes only it', async ({ page }) => {
  const original = await setupProtected(page);
  await protectedSession(page, 'Barren_1');
  const s1 = await idbSides(page);
  expect(Object.keys(s1)).toHaveLength(1);
  const [keyA] = Object.keys(s1);
  expect(sideTile(s1[keyA])).toBe('Barren_1');
  await protectedSession(page, 'Swamp_1');
  const s2 = await idbSides(page);
  expect(Object.keys(s2)).toHaveLength(2);
  expect(s2[keyA]).toBe(s1[keyA]);                                    // earlier session never overwritten
  const keyB = Object.keys(s2).find(k => k !== keyA)!;
  expect(sideTile(s2[keyB])).toBe('Swamp_1');
  expect(await readIdbKey(page, 'map_autosave')).toBe(original);
  // clean startup: one dialog listing both copies
  await page.evaluate(() => localStorage.removeItem('__failGet'));
  await reloadEditor(page);
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(false);
  await expect(rows(page)).toHaveCount(2);
  await expect(rowFor(page, keyA)).toContainText('KB');
  await rowFor(page, keyA).getByRole('button', { name: 'Restore' }).click();
  await expect.poll(() => page.evaluate(() => mapData[0])).toBe('Barren_1');
  await expect.poll(async () => sideTile((await readIdbKey(page, 'map_autosave')) || '{"data":[[0]]}')).toBe('Barren_1');
  await expect.poll(async () => Object.keys(await idbSides(page))).toEqual([keyB]);
  await expect(rows(page)).toHaveCount(1);                            // dialog stays open for the rest
  await expect(rowFor(page, keyB)).toHaveCount(1);
});

test('Decide later / Escape leave every copy; File>New and a reload still offer it (no staleness)', async ({ page }) => {
  await setupProtected(page);
  await protectedSession(page, 'Barren_1');
  const before = await idbSides(page);
  await page.evaluate(() => localStorage.removeItem('__failGet'));
  await reloadEditor(page);
  await expect(rows(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(await idbSides(page)).toEqual(before);
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(false);
  // explicit File>New: main slot gets a newer stamp than the copy
  await page.evaluate(() => IO.newMap());
  await createFromModal(page);
  await page.evaluate(async () => { mapData[2] = 'Rubble_1'; await IO.autoSave(); });
  expect(JSON.parse((await readIdbKey(page, 'map_autosave'))!).data[0][2]).toBe('Rubble_1');
  expect(await idbSides(page)).toEqual(before);
  // the menu entry reopens the same list on demand
  await page.evaluate(() => (document.querySelector('#menu-file button[onclick*="openRecoveryDialog"]') as HTMLElement).click());
  await expect(rows(page)).toHaveCount(1);
  await decideLater(page);
  await reloadEditor(page);
  await expect(rows(page)).toHaveCount(1);
  expect(await idbSides(page)).toEqual(before);
});

test('Discard removes only the clicked copy and the dialog stays open', async ({ page }) => {
  await openEditor(page);
  const a = mapJson(j => { j._autosavedAt = 2000; j.data[0][0] = 'Barren_1'; });
  const b = mapJson(j => { j._autosavedAt = 3000; j.data[0][0] = 'Swamp_1'; });
  await writeIdbKey(page, 'map_side_2000', a);
  await writeIdbKey(page, 'map_side_3000', b);
  await noFlush(page);
  await reloadEditor(page);
  await expect(rows(page)).toHaveCount(2);
  await rowFor(page, 'map_side_2000').getByRole('button', { name: /Discard/ }).click();
  await expect(rows(page)).toHaveCount(1);
  expect(await idbSides(page)).toEqual({ map_side_3000: b });
  await rowFor(page, 'map_side_3000').getByRole('button', { name: /Discard/ }).click();
  await expect(dialog(page)).toHaveCount(0);                         // all rows handled
  expect(await idbSides(page)).toEqual({});
});

test('a failed override restore leaves the map exactly as before, keeps the copy, autosave keeps working', async ({ page }) => {
  await openEditor(page);
  await writeIdbKey(page, 'map_autosave', mapJson(j => { j._autosavedAt = 1000; j.data[0][0] = 'Rubble_1'; }));
  const bad = mapJson(j => { j._autosavedAt = 2000; j.width = 25; j.data[0][0] = 'Swamp_1'; j.tileExtras = [null]; });
  await writeIdbKey(page, 'map_side_2000', bad);
  await noFlush(page);
  await reloadEditor(page);
  await expect(rows(page)).toHaveCount(1);
  const before = await mapHash(page);
  await rowFor(page, 'map_side_2000').getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.toast.sticky', { hasText: 'Could not restore' })).toContainText('Nothing was changed');
  expect(await mapHash(page)).toBe(before);
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(false);
  expect(await readIdbKey(page, 'map_side_2000')).toBe(bad);
  await decideLater(page);
  // autosave still works afterwards (the noFlush stub was installed on the previous page only)
  await page.evaluate(async () => { mapData[1] = 'Barren_1'; await IO.autoSave(); });
  expect(JSON.parse((await readIdbKey(page, 'map_autosave'))!).data[0][1]).toBe('Barren_1');
  expect(await readIdbKey(page, 'map_side_2000')).toBe(bad);
});

test('a failed override restore with no previous map still leads to the new-map prompt', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => new Promise<void>(res => {
    const r = indexedDB.open('MapEditorPro', 1);
    r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').delete('map_autosave'); tx.oncomplete = () => res(); };
  }));
  const bad = mapJson(j => { j._autosavedAt = 2000; j.tileExtras = [null]; });
  await writeIdbKey(page, 'map_side_2000', bad);
  await noFlush(page);
  await reloadEditor(page);
  const before = await mapHash(page);
  await rowFor(page, 'map_side_2000').getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.toast.sticky', { hasText: 'Could not restore' })).toHaveCount(1);
  expect(await mapHash(page)).toBe(before);
  await decideLater(page);
  await expect(page.locator('#newmap-modal')).toHaveClass(/open/);
  expect(await readIdbKey(page, 'map_side_2000')).toBe(bad);
});

test('legacy map_autosave_pending / _prev are listed as separate copies and survive', async ({ page }) => {
  const p = mapJson(j => { j._autosavedAt = 3000; j.data[0][0] = 'Swamp_1'; });
  const pp = mapJson(j => { j._autosavedAt = 2000; j.data[0][0] = 'Barren_1'; });
  await openEditor(page);
  await page.evaluate(([a, b]: string[]) => { localStorage.setItem('map_autosave_pending', a); localStorage.setItem('map_autosave_pending_prev', b); }, [p, pp]);
  await noFlush(page);
  await reloadEditor(page);
  await expect(rows(page)).toHaveCount(2);
  await decideLater(page);
  await page.evaluate(async () => { mapData[3] = 'Rubble_2'; await IO.autoSave(); });
  await noFlush(page);
  await reloadEditor(page);
  await expect(rows(page)).toHaveCount(2);
  expect(await lsSides(page)).toEqual({ map_autosave_pending: p, map_autosave_pending_prev: pp });
});

test('an 11th copy is refused with a warning and nothing is deleted', async ({ page }) => {
  await setupProtected(page);
  const seeded: Record<string, string> = {};
  for (let i = 1; i <= 10; i++) {
    seeded['map_side_' + (100 + i)] = mapJson(j => { j._autosavedAt = 100 + i; });
    await writeIdbKey(page, 'map_side_' + (100 + i), seeded['map_side_' + (100 + i)]);
  }
  await reloadEditor(page);
  await expect(rows(page)).toHaveCount(10);
  await decideLater(page);
  await createFromModal(page);
  await page.evaluate(async () => { mapData[0] = 'Barren_1'; await IO.autoSave(); await IO.autoSave(); });
  await expect(page.locator('.toast.sticky', { hasText: 'Too many unrecovered autosave copies' })).toHaveCount(1);
  expect(await idbSides(page)).toEqual(seeded);
  expect(await lsSides(page)).toEqual({});
});

test('IndexedDB unavailable: the side copy goes to localStorage under its own session key', async ({ page }) => {
  const legacy = mapJson();
  const earlier = mapJson(j => { j._autosavedAt = 50; j.data[0][0] = 'Swamp_1'; });
  await page.addInitScript(() => { indexedDB.open = () => { throw new Error('IndexedDB blocked'); }; });
  await openEditor(page, { storage: { map_autosave: legacy, map_side_50: earlier } });
  await expect(rows(page)).toHaveCount(1);
  await decideLater(page);
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(true);
  await page.evaluate(async () => { mapData[0] = 'Barren_1'; await IO.autoSave(); mapData[0] = 'Hills_1'; await IO.autoSave(); });
  const ls = await lsSides(page);
  expect(ls.map_side_50).toBe(earlier);
  const mine = Object.keys(ls).filter(k => k !== 'map_side_50');
  expect(mine).toHaveLength(1);                                       // later flushes overwrite this session's key only
  expect(sideTile(ls[mine[0]])).toBe('Hills_1');
  expect(await page.evaluate(() => localStorage.getItem('map_autosave'))).toBe(legacy);
});

test('while the recovery dialog is open no autosave write happens', async ({ page }) => {
  await openEditor(page);
  const main = mapJson(j => { j._autosavedAt = 1000; j.data[0][0] = 'Rubble_1'; });
  await writeIdbKey(page, 'map_autosave', main);
  await writeIdbKey(page, 'map_side_2000', mapJson(j => { j._autosavedAt = 2000; }));
  await noFlush(page);
  await reloadEditor(page);
  await expect(rows(page)).toHaveCount(1);
  await page.evaluate(async () => { mapData[0] = 'Barren_1'; await IO.autoSave(); window.dispatchEvent(new Event('pagehide')); });
  await page.waitForTimeout(200);
  expect(await readIdbKey(page, 'map_autosave')).toBe(main);
  expect(Object.keys(await idbSides(page))).toEqual(['map_side_2000']);
  await decideLater(page);
  await page.evaluate(() => IO.autoSave());
  expect(JSON.parse((await readIdbKey(page, 'map_autosave'))!).data[0][0]).toBe('Barren_1');
});

test('protected startup: Restore shows the copy, protection stays on, the copy and the main slot are kept', async ({ page }) => {
  const original = await setupProtected(page);
  const side = mapJson(j => { j._autosavedAt = 900; j.data[0][0] = 'Rubble_2'; });
  await writeIdbKey(page, 'map_side_900', side);
  await reloadEditor(page);
  await rowFor(page, 'map_side_900').getByRole('button', { name: 'Restore' }).click();
  await expect.poll(() => page.evaluate(() => mapData[0])).toBe('Rubble_2');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.toast.sticky', { hasText: 'Autosave copy restored' })).toContainText('kept in browser storage');
  await expect(page.locator('#newmap-modal')).not.toHaveClass(/open/);
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(true);
  await page.evaluate(async () => { await IO.autoSave(); });
  expect(await idbSides(page)).toEqual({ map_side_900: side });      // unchanged map: no duplicate copy
  await page.evaluate(async () => { mapData[1] = 'Barren_1'; await IO.autoSave(); });
  const all = await idbSides(page);
  expect(all.map_side_900).toBe(side);
  expect(Object.keys(all)).toHaveLength(2);
  expect(await readIdbKey(page, 'map_autosave')).toBe(original);
});

test('protected: discarding the restored (on screen) copy makes the next flush save the map again', async ({ page }) => {
  await setupProtected(page);
  const side = mapJson(j => { j._autosavedAt = 900; j.data[0][0] = 'Rubble_2'; });
  await writeIdbKey(page, 'map_side_900', side);
  await reloadEditor(page);
  await rowFor(page, 'map_side_900').getByRole('button', { name: 'Restore' }).click();
  await expect.poll(() => page.evaluate(() => mapData[0])).toBe('Rubble_2');
  await page.evaluate(() => (document.querySelector('#menu-file button[onclick*="openRecoveryDialog"]') as HTMLElement).click());
  await expect(rowFor(page, 'map_side_900')).toContainText('(on screen)');
  await rowFor(page, 'map_side_900').getByRole('button', { name: /Discard/ }).click();
  // an extra confirmation step for the copy that is on screen
  await expect(rowFor(page, 'map_side_900')).toContainText('currently on screen and will be saved again as a new recovery copy');
  expect(await readIdbKey(page, 'map_side_900')).toBe(side);
  await rowFor(page, 'map_side_900').getByRole('button', { name: /Discard anyway/ }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.evaluate(() => IO.autoSave());
  const all = await idbSides(page);
  const keys = Object.keys(all);
  expect(keys).toHaveLength(1);
  expect(keys[0]).not.toBe('map_side_900');
  expect(sideTile(all[keys[0]])).toBe('Rubble_2');                 // the on-screen map is saved again
});

test('a failed side-copy listing is reported instead of "No autosave copies to recover"', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { IDBObjectStore.prototype.getAllKeys = function () { throw new Error('list boom'); }; });
  await page.evaluate(() => (document.querySelector('#menu-file button[onclick*="openRecoveryDialog"]') as HTMLElement).click());
  const t = page.locator('.toast', { hasText: 'could not be listed' });
  await expect(t).toHaveCount(1);
  await expect(t).toContainText('reload to retry');
});

test('the recovery dialog says when some copies could not be listed', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => localStorage.setItem('map_side_5', JSON.stringify({ width: 10, height: 1, data: [[]], _autosavedAt: 5 })));
  await page.evaluate(() => { IDBObjectStore.prototype.getAllKeys = function () { throw new Error('list boom'); }; });
  await page.evaluate(() => { IO.openRecoveryDialog(true); });
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#dialog-msg')).toContainText('Some copies could not be listed (browser storage did not respond); reload to retry.');
});
