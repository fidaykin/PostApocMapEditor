import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

async function breakStorage(page: any) {
  await page.evaluate(() => {
    (window as any).__origSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
}
async function fixStorage(page: any) {
  await page.evaluate(() => { Storage.prototype.setItem = (window as any).__origSetItem; });
}

test('a full localStorage produces one sticky warning per saved thing', async ({ page }) => {
  await openEditor(page);
  await breakStorage(page);
  await page.evaluate(() => { HexDB.add(); HexDB.add(); BldDB.add(); });
  const hexToast = page.locator('.toast.sticky', { hasText: 'Hex DB autosave not saved: browser storage is full' });
  await expect(hexToast).toHaveCount(1);
  await expect(page.locator('.toast.sticky', { hasText: 'Buildings DB autosave not saved' })).toHaveCount(1);
  await expect(hexToast.locator('.toast-detail')).toContainText('Export your work');
});

test('a failing save never throws into the caller and returns false', async ({ page }) => {
  await openEditor(page);
  await breakStorage(page);
  const r = await page.evaluate(() => {
    let threw = false, ret: any;
    try { ret = StorageGuard.setItem('k', 'v', 'Thing'); } catch { threw = true; }
    let threw2 = false;
    try { HexDB.add(); } catch { threw2 = true; }
    return { threw, ret, threw2 };
  });
  expect(r).toEqual({ threw: false, ret: false, threw2: false });
});

test('non-quota errors get a generic title; warning survives a broken toast UI', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = function () { throw new Error('SecurityError denied'); };
  });
  await page.evaluate(() => StorageGuard.setItem('k', 'v', 'Foo'));
  const t = page.locator('.toast.sticky', { hasText: '⚠ Foo not saved' });
  await expect(t).toHaveCount(1);
  await expect(t).not.toContainText('storage is full');
  await expect(t.locator('.toast-detail')).toContainText('SecurityError denied');
  const threw = await page.evaluate(() => {
    const orig = UI.toast; UI.toast = () => { throw new Error('ui broken'); };
    try { StorageGuard._warn('Bar', new Error('x')); return false; } catch { return true; }
    finally { UI.toast = orig; }
  });
  expect(threw).toBe(false);
});

test('warns again after the 60 s window and clears state after a successful save', async ({ page }) => {
  await openEditor(page);
  await breakStorage(page);
  const warn = page.locator('.toast.sticky', { hasText: 'Foo not saved' });
  await page.evaluate(() => StorageGuard.setItem('k', 'v', 'Foo'));
  await page.evaluate(() => StorageGuard.setItem('k', 'v', 'Foo'));
  await expect(warn).toHaveCount(1);
  // 61 s later the same label warns again, replacing (not stacking on) the old toast
  await page.evaluate(() => { const n = Date.now(); Date.now = () => n + 61000; });
  await page.evaluate(() => StorageGuard.setItem('k', 'v', 'Foo'));
  await expect(warn).toHaveCount(1);
  // a successful save removes the warning and resets the throttle
  await fixStorage(page);
  expect(await page.evaluate(() => StorageGuard.setItem('k', 'v', 'Foo'))).toBe(true);
  await expect(warn).toHaveCount(0);
  await breakStorage(page);
  await page.evaluate(() => StorageGuard.setItem('k', 'v', 'Foo'));
  await expect(warn).toHaveCount(1);   // immediately warns again: throttle was reset
});

test('map autosave failure is surfaced', async ({ page }) => {
  await openEditor(page);
  await breakStorage(page);
  // IndexedDB is the primary store now, so the warning only appears when it fails too
  await page.evaluate(() => { IDBObjectStore.prototype.put = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
  await page.evaluate(() => IO.scheduleAutoSave());
  await expect(page.locator('.toast.sticky', { hasText: 'Map autosave not saved' })).toHaveCount(1);
});

// ── T0.12: map autosave in IndexedDB ─────────────────────────────────────────
import { reloadEditor, FakeGitHub } from './helpers';

const readIdb = (page: any) => page.evaluate(() => new Promise<string | null>(res => {
  const r = indexedDB.open('MapEditorPro', 1);
  r.onsuccess = () => {
    const g = r.result.transaction('kv').objectStore('kv').get('map_autosave');
    g.onsuccess = () => res(g.result ?? null);
  };
}));
const writeIdb = (page: any, v: any) => page.evaluate((val: any) => new Promise<void>(res => {
  const r = indexedDB.open('MapEditorPro', 1);
  r.onsuccess = () => {
    const tx = r.result.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, 'map_autosave');
    tx.oncomplete = () => res();
  };
}), v);
const noFlush = (page: any) => page.evaluate(() => { IO.autoSave = () => Promise.resolve(); });   // reload fires pagehide, which would re-save the live map
const mapJson = (gh: FakeGitHub, tweak: (j: any) => void = () => {}) => {
  const j: any = gh.json('maps/current_map.json');
  tweak(j);
  return JSON.stringify(j);
};

test('the map autosave lives in IndexedDB, not localStorage, and survives a reload', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => { mapData[5] = 'Rubble_1'; await IO.autoSave(); });
  expect(await page.evaluate(() => localStorage.getItem('map_autosave'))).toBeNull();
  const stored = await readIdb(page);
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored!).data[0][5]).toBe('Rubble_1');
  await reloadEditor(page);
  expect(await page.evaluate(() => [MAP_WIDTH, mapData[5]])).toEqual([30, 'Rubble_1']);
});

test('a legacy localStorage map autosave is restored and then retired', async ({ page }) => {
  const legacy = new FakeGitHub().json('maps/current_map.json');
  await openEditor(page, { storage: { map_autosave: JSON.stringify(legacy) } });
  expect(await page.evaluate(() => [MAP_WIDTH, MAP_HEIGHT])).toEqual([20, 20]);
  // restoring alone does not touch the legacy copy
  expect(await page.evaluate(() => localStorage.getItem('map_autosave'))).not.toBeNull();
  await page.evaluate(() => IO.autoSave());
  expect(await page.evaluate(() => localStorage.getItem('map_autosave'))).toBeNull();
  expect(await readIdb(page)).not.toBeNull();
});

test('migration keeps the legacy key when the IndexedDB write fails (quota) and warns only if localStorage fails too', async ({ page }) => {
  const legacy = new FakeGitHub().json('maps/current_map.json');
  await openEditor(page, { storage: { map_autosave: JSON.stringify(legacy) } });
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException('quota', 'QuotaExceededError'); };
    mapData[3] = 'Rubble_2';
  });
  await page.evaluate(() => IO.autoSave());
  // fallback: the fresh map went to localStorage, replacing the legacy copy with the NEWER one
  const ls = await page.evaluate(() => localStorage.getItem('map_autosave'));
  expect(ls).not.toBeNull();
  expect(JSON.parse(ls!).data[0][3]).toBe('Rubble_2');
  await expect(page.locator('.toast.sticky', { hasText: 'Map autosave not saved' })).toHaveCount(0);
  // now localStorage fails as well: the user is warned and the old copy is still there
  await breakStorage(page);
  await page.evaluate(() => IO.autoSave());
  await expect(page.locator('.toast.sticky', { hasText: 'Map autosave not saved' })).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('map_autosave'))).toBe(ls);
});

test('an aborted IndexedDB transaction does not retire the legacy copy and falls back', async ({ page }) => {
  const legacy = new FakeGitHub().json('maps/current_map.json');
  await openEditor(page, { storage: { map_autosave: JSON.stringify(legacy) } });
  await page.evaluate(() => {
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...a: any[]) {
      const r = orig.apply(this, a as any); this.transaction.abort(); return r;
    };
  });
  await page.evaluate(() => IO.autoSave());
  const ls = await page.evaluate(() => localStorage.getItem('map_autosave'));
  expect(ls).not.toBeNull();                           // never lost
  expect(JSON.parse(ls!)._autosavedAt).toBeGreaterThan(0);   // and it is the fresh fallback copy
  expect(await readIdb(page)).toBeNull();
});

test('IndexedDB unavailable at startup: the map still restores from localStorage and saves there', async ({ page }) => {
  const legacy = new FakeGitHub().json('maps/current_map.json');
  await page.addInitScript(() => { indexedDB.open = () => { throw new Error('IndexedDB blocked'); }; });
  await openEditor(page, { storage: { map_autosave: JSON.stringify(legacy) } });
  expect(await page.evaluate(() => [MAP_WIDTH, MAP_HEIGHT])).toEqual([20, 20]);
  await page.evaluate(() => IO.autoSave());
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('map_autosave')))!)._autosavedAt).toBeGreaterThan(0);
});

test('a hanging IndexedDB read does not freeze startup', async ({ page }) => {
  test.setTimeout(60000);
  const legacy = new FakeGitHub().json('maps/current_map.json');
  await page.addInitScript(() => {   // the autosave read never answers
    const orig = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (k: any) { return k === 'map_autosave' ? ({} as any) : orig.call(this, k); };
  });
  await openEditor(page, { storage: { map_autosave: JSON.stringify(legacy) } });
  expect(await page.evaluate(() => [MAP_WIDTH, MAP_HEIGHT])).toEqual([20, 20]);
});

test('with both copies present the newest wins (either direction)', async ({ page }) => {
  const gh = new FakeGitHub();
  const older = mapJson(gh, j => { j._autosavedAt = 1000; j.data[0][0] = 'Rubble_1'; });
  const newer = mapJson(gh, j => { j._autosavedAt = 2000; j.data[0][0] = 'Rubble_2'; });
  await openEditor(page);
  await writeIdb(page, older);
  await page.evaluate((v: string) => localStorage.setItem('map_autosave', v), newer);   // LS fallback was newer
  await noFlush(page);
  await reloadEditor(page);
  expect(await page.evaluate(() => mapData[0])).toBe('Rubble_2');
  await writeIdb(page, newer);
  await page.evaluate((v: string) => localStorage.setItem('map_autosave', v), older);   // stale legacy left behind
  await noFlush(page);
  await reloadEditor(page);
  expect(await page.evaluate(() => mapData[0])).toBe('Rubble_2');
});

test('a corrupt stored record is skipped: the other copy loads, or a blank map plus a warning', async ({ page }) => {
  const gh = new FakeGitHub();
  const good = mapJson(gh, j => { j._autosavedAt = 1000; j.data[0][0] = 'Rubble_3'; });
  await openEditor(page);
  // corrupt IndexedDB (newer-looking, truncated JSON) + good legacy copy
  await writeIdb(page, good.slice(0, 200));
  await page.evaluate((v: string) => localStorage.setItem('map_autosave', v), good);
  await noFlush(page);
  await reloadEditor(page);
  expect(await page.evaluate(() => mapData[0])).toBe('Rubble_3');
  // valid JSON but wrong shape, nothing else to fall back to
  await writeIdb(page, JSON.stringify({ width: 30, height: 30, data: ['garbage', 5] }));
  await page.evaluate(() => localStorage.removeItem('map_autosave'));
  await noFlush(page);
  await reloadEditor(page);
  expect(await page.evaluate(() => mapData.every((t: any) => typeof t === 'string' && t.length < 40))).toBe(true);
  await expect(page.locator('.toast.sticky', { hasText: 'unreadable' })).toHaveCount(1);
  // a non-string record is also ignored
  await writeIdb(page, { not: 'a string' });
  await noFlush(page);
  await reloadEditor(page);
  expect(await page.evaluate(() => mapData.length > 0)).toBe(true);
});

test('a map opened while the restore is still pending is not overwritten by it', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page);
  await writeIdb(page, mapJson(gh, j => { j._autosavedAt = 5; }));
  const r = await page.evaluate(async () => {
    const before = mapData;
    const p = IO.tryRestoreAutosave();                  // read is pending...
    mapData = new Array(MAP_WIDTH * MAP_HEIGHT).fill('Barren_1');   // ...user installs another map
    const restored = await p;
    return { restored, tile: mapData[0] };
  });
  expect(r).toEqual({ restored: false, tile: 'Barren_1' });
});

test('flush handlers never throw and the last overlapping write wins', async ({ page }) => {
  const { pageErrors } = await openEditor(page);
  await page.evaluate(async () => {
    mapData[0] = 'Rubble_1'; IO.autoSave();             // in flight
    mapData[0] = 'Rubble_2';
    window.dispatchEvent(new Event('pagehide'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 500));
  });
  expect(JSON.parse((await readIdb(page))!).data[0][0]).toBe('Rubble_2');
  // a failing build must not throw out of the flush handlers either
  await page.evaluate(() => { IO.autoSave = () => { throw new Error('boom'); }; });
  await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('beforeunload')); });
  expect(pageErrors).toEqual([]);
});
