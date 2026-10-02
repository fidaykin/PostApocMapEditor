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
    const st = r.result.transaction('kv').objectStore('kv');
    const g = ((window as any).__origGet || IDBObjectStore.prototype.get).call(st, 'map_autosave');   // bypass test stubs
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
  // the read failed, so saves go to the side copy and the restored legacy copy is untouched
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('map_autosave_pending')))!)._autosavedAt).toBeGreaterThan(0);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('map_autosave')))!)._autosavedAt).toBeUndefined();
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
  await expect(page.locator('.toast.sticky', { hasText: 'could not be read' })).toHaveCount(1);
  // a non-string record is also ignored
  await writeIdb(page, { not: 'a string' });
  await noFlush(page);
  await reloadEditor(page);
  expect(await page.evaluate(() => mapData.length > 0)).toBe(true);
});

test('startup ordering: nothing is initialised or synced while the autosave read is pending', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    (window as any).__autosaveIdbTimeoutMs = 2500;
    const orig = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (k: any) {
      if (k !== 'map_autosave') return orig.call(this, k);
      setTimeout(() => {
        (window as any).__during = { map: typeof mapData === 'undefined' ? null : mapData, sync: !!(window as any).__startupSyncDone, hex: HexDB.getAll().length };
      }, 800);
      return {} as any;   // never answers
    };
  });
  await openEditor(page);
  const during = await page.evaluate(() => (window as any).__during);
  expect(during).toEqual({ map: null, sync: false, hex: 0 });
});

const FAIL_GET = () => {
  const orig = IDBObjectStore.prototype.get; (window as any).__origGet = orig;
  IDBObjectStore.prototype.get = function (k: any) {
    if (k !== 'map_autosave') return orig.call(this, k);
    const req: any = {};
    setTimeout(() => { Object.defineProperty(req, 'error', { value: new Error('read boom') }); req.onerror && req.onerror(); }, 0);
    return req;
  };
};
const HANG_GET = () => {
  (window as any).__autosaveIdbTimeoutMs = 400;
  const orig = IDBObjectStore.prototype.get; (window as any).__origGet = orig;
  IDBObjectStore.prototype.get = function (k: any) { return k === 'map_autosave' ? ({} as any) : orig.call(this, k); };
};

for (const [name, stub] of [['rejects', FAIL_GET], ['hangs past the timeout', HANG_GET]] as const) {
  test(`protected mode: an IndexedDB read that ${name} never lets a flush overwrite the stored autosave`, async ({ page }) => {
    const gh = new FakeGitHub();
    const original = mapJson(gh, j => { j._autosavedAt = 777; j.data[0][0] = 'Rubble_3'; });
    await openEditor(page);
    await writeIdb(page, original);
    await noFlush(page);
    await page.addInitScript(stub as any);
    await reloadEditor(page);
    expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(true);
    await expect(page.locator('.toast.sticky', { hasText: 'could not be read' })).toHaveCount(1);
    await page.locator('#newmap-modal .btn-primary', { hasText: 'Create' }).click();
    await page.evaluate(async () => { mapData[0] = 'Barren_1'; await IO.autoSave(); window.dispatchEvent(new Event('pagehide')); });
    await page.waitForTimeout(300);
    expect(await readIdb(page)).toBe(original);                                       // byte-identical
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('map_autosave_pending')))!).data[0][0]).toBe('Barren_1');
  });
}

test('protected mode: a wrong-shape record is not overwritten by a flush; opening/creating a map ends it', async ({ page }) => {
  await openEditor(page);
  const bad = JSON.stringify({ width: 30, height: 30, data: ['garbage', 5] });
  await writeIdb(page, bad);
  await noFlush(page);
  await reloadEditor(page);
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(true);
  await expect(page.locator('.toast.sticky', { hasText: 'could not be read' })).toHaveCount(1);
  await page.evaluate(() => IO.autoSave());
  expect(await readIdb(page)).toBe(bad);
  // deliberate File>New (menu path, not the forced startup modal) -> normal saving resumes
  await page.evaluate(() => { IO.newMap(); IO.setNewMapSize(30, 30); IO.applyNewMap(); });
  await page.evaluate(() => IO.autoSave());
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(false);
  expect(JSON.parse((await readIdb(page))!).width).toBe(30);
  expect(JSON.parse((await readIdb(page))!).data.length).toBe(30);
});

test('protected mode also ends when the user opens a map file', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page);
  await writeIdb(page, '{"truncated');
  await noFlush(page);
  await reloadEditor(page);
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(true);
  await page.evaluate((j: any) => IO.loadFromJSON(j), gh.json('maps/current_map.json'));
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(false);
});

test('stamps stay monotonic across sessions even when the clock went backwards', async ({ page }) => {
  const gh = new FakeGitHub();
  const FUTURE = Date.now() + 10 * 365 * 24 * 3600 * 1000;
  const bigStamp = mapJson(gh, j => { j._autosavedAt = FUTURE; j.data[0][0] = 'Rubble_1'; });
  await openEditor(page);
  await writeIdb(page, bigStamp);
  await page.evaluate((v: string) => localStorage.setItem('map_autosave', v), mapJson(gh, j => { j._autosavedAt = 5; j.data[0][0] = 'Rubble_2'; }));
  await noFlush(page);
  await reloadEditor(page);
  expect(await page.evaluate(() => mapData[0])).toBe('Rubble_1');   // highest stamp wins
  await page.evaluate(async () => { mapData[0] = 'Rubble_3'; await IO.autoSave(); });
  expect(JSON.parse((await readIdb(page))!)._autosavedAt).toBeGreaterThan(FUTURE);
});

test('a successful IndexedDB write clears an earlier "Map autosave not saved" warning', async ({ page }) => {
  await openEditor(page);
  await breakStorage(page);
  await page.evaluate(() => { (window as any).__put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new DOMException('q', 'QuotaExceededError'); }; });
  await page.evaluate(() => IO.autoSave());
  const warn = page.locator('.toast.sticky', { hasText: 'Map autosave not saved' });
  await expect(warn).toHaveCount(1);
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as any).__put; });
  await page.evaluate(() => IO.autoSave());
  await expect(warn).toHaveCount(0);
});

test('a write that times out but commits later retires its localStorage fallback copy', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__autosaveIdbTimeoutMs = 300; });
  await openEditor(page);
  // hold a readwrite transaction open so the editor's put queues behind it
  await page.evaluate(() => new Promise<void>(res => {
    const r = indexedDB.open('MapEditorPro', 1);
    r.onsuccess = () => {
      const tx = r.result.transaction('kv', 'readwrite');
      const st = tx.objectStore('kv');
      (window as any).__stopBlock = () => { (window as any).__blocking = false; };
      (window as any).__blocking = true;
      const loop = () => { if ((window as any).__blocking) st.get('x').onsuccess = loop; };
      loop(); res();
    };
  }));
  await page.evaluate(() => IO.autoSave());                    // times out -> fallback copy
  expect(await page.evaluate(() => localStorage.getItem('map_autosave'))).not.toBeNull();
  await page.evaluate(() => (window as any).__stopBlock());
  await expect.poll(() => page.evaluate(() => localStorage.getItem('map_autosave'))).toBeNull();
  expect(await readIdb(page)).not.toBeNull();
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

// ── T0.12 round 2 ────────────────────────────────────────────────────────────
const seedValidThenFailRead = async (page: any) => {
  const gh = new FakeGitHub();
  const original = mapJson(gh, j => { j._autosavedAt = 777; j.data[0][0] = 'Rubble_3'; });
  await openEditor(page);
  await writeIdb(page, original);
  await noFlush(page);
  await page.addInitScript(FAIL_GET as any);
  await page.evaluate(() => { localStorage.removeItem('map_autosave'); });
  return original;
};

test('the forced startup modal keeps protection on: Create saves to the side copy only', async ({ page }) => {
  const original = await seedValidThenFailRead(page);
  await page.reload();
  const modal = page.locator('#newmap-modal');
  await expect(modal).toHaveClass(/open/);
  await expect(page.locator('#newmap-protect-note')).toContainText('NOT autosaved to the main slot');
  await page.waitForFunction(() => !!(window as any).__startupSyncDone);
  await modal.locator('.btn-primary', { hasText: 'Create' }).click();
  await page.evaluate(async () => { mapData[1] = 'Barren_1'; await IO.autoSave(); window.dispatchEvent(new Event('pagehide')); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(true);
  expect(await readIdb(page)).toBe(original);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('map_autosave_pending')))!).data[0][1]).toBe('Barren_1');
  await expect(page.locator('.toast.sticky', { hasText: 'could not be read' }).locator('.toast-detail')).toContainText('save it to a file');
});

test('a deliberate File>New after a protected startup ends protection and retires the side copy', async ({ page }) => {
  const original = await seedValidThenFailRead(page);
  await page.reload();
  await page.locator('#newmap-modal .btn-primary', { hasText: 'Create' }).click();
  await page.evaluate(() => IO.autoSave());
  expect(await page.evaluate(() => localStorage.getItem('map_autosave_pending'))).not.toBeNull();
  await page.evaluate(() => { IO.newMap(); });
  await page.locator('#newmap-modal .btn-primary', { hasText: 'Create' }).click();
  await page.evaluate(() => IO.autoSave());
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(false);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('map_autosave_pending'))).toBeNull();
  expect(await readIdb(page)).not.toBe(original);
});

test('a load that fails half-way does not end protection', async ({ page }) => {
  await openEditor(page);
  await writeIdb(page, '{"truncated');
  await noFlush(page);
  await reloadEditor(page);
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(true);
  const bad = new FakeGitHub().json('maps/current_map.json');
  bad.tileExtras = [null];   // throws after the map array is already replaced
  await page.evaluate((j: any) => { try { IO.loadFromJSON(j); } catch {} }, bad);
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(true);
});

const seedPending = async (page: any, pendingTs: number | null, pendingRaw?: string) => {
  const gh = new FakeGitHub();
  await openEditor(page);
  await writeIdb(page, mapJson(gh, j => { j._autosavedAt = 1000; j.data[0][0] = 'Rubble_1'; }));
  const pend = pendingRaw ?? mapJson(gh, j => { j._autosavedAt = pendingTs; j.data[0][0] = 'Rubble_2'; });
  await page.evaluate((v: string) => localStorage.setItem('map_autosave_pending', v), pend);
  await noFlush(page);
  await reloadEditor(page);
};
const pendingKey = (page: any) => page.evaluate(() => localStorage.getItem('map_autosave_pending'));

test('pending changes: "Restore newer changes" loads them and removes the side copy', async ({ page }) => {
  await seedPending(page, 2000);
  await expect(page.locator('#dialog-title')).toHaveText('Unsaved changes found');
  await page.locator('#dialog-actions').getByRole('button', { name: 'Restore newer changes' }).click();
  await expect.poll(() => page.evaluate(() => mapData[0])).toBe('Rubble_2');
  await expect.poll(() => pendingKey(page)).toBeNull();
  await expect.poll(async () => JSON.parse((await readIdb(page))!).data[0][0]).toBe('Rubble_2');
});

test('pending changes: Discard removes the side copy only on the explicit button; Escape leaves it', async ({ page }) => {
  await seedPending(page, 2000);
  const before = await pendingKey(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#dialog-modal.open')).toHaveCount(0);
  expect(await pendingKey(page)).toBe(before);
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(true);   // main slot paused, copy kept
  expect(await page.evaluate(() => mapData[0])).toBe('Rubble_1');
});

test('pending changes: the Discard button removes the side copy', async ({ page }) => {
  await seedPending(page, 2000);
  await expect(page.locator('#dialog-details')).toContainText('Newer changes: saved');
  await page.locator('#dialog-actions').getByRole('button', { name: /Discard newer changes/ }).click();
  await expect.poll(() => pendingKey(page)).toBeNull();
  expect(await page.evaluate(() => mapData[0])).toBe('Rubble_1');
});

test('an unanswered offer is offered again after a reload (flushes cannot make it look stale)', async ({ page }) => {
  await seedPending(page, 2000);
  const before = await pendingKey(page);
  const idbBefore = await readIdb(page);
  await expect(page.locator('#dialog-title')).toHaveText('Unsaved changes found');
  await page.evaluate(async () => { await IO.autoSave(); window.dispatchEvent(new Event('pagehide')); });
  expect(await readIdb(page)).toBe(idbBefore);
  await reloadEditor(page);
  await expect(page.locator('#dialog-title')).toHaveText('Unsaved changes found');
  expect(await pendingKey(page)).toBe(before);
});

test('a side copy that fails to apply stays intact and protection is unchanged', async ({ page }) => {
  const gh = new FakeGitHub();
  const bad = mapJson(gh, j => { j._autosavedAt = 2000; j.tileExtras = [null]; });
  await seedPending(page, null, bad);
  await page.locator('#dialog-actions').getByRole('button', { name: 'Restore newer changes' }).click();
  await expect(page.locator('.toast.sticky', { hasText: 'Could not restore the newer changes' })).toHaveCount(1);
  expect(await pendingKey(page)).toBe(bad);
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(false);
  await page.evaluate(async () => { await IO.autoSave(); window.dispatchEvent(new Event('pagehide')); });
  expect(await pendingKey(page)).toBe(bad);
});

// protected startup (valid record, read fails) with a side copy from an earlier protected session
const protectedStartupWithSide = async (page: any) => {
  const gh = new FakeGitHub();
  const original = mapJson(gh, j => { j._autosavedAt = 777; j.data[0][0] = 'Rubble_3'; });
  const side = mapJson(gh, j => { j._autosavedAt = 900; j.data[0][0] = 'Rubble_2'; });
  await openEditor(page);
  await writeIdb(page, original);
  await page.evaluate((v: string) => { localStorage.removeItem('map_autosave'); localStorage.setItem('map_autosave_pending', v); }, side);
  await noFlush(page);
  await page.addInitScript(FAIL_GET as any);
  await page.reload();
  await expect(page.locator('#dialog-title')).toHaveText('Unsaved changes found');   // offered on a protected startup too
  return { original, side };
};

test('protected startup: the blank placeholder is never autosaved over the earlier side copy', async ({ page }) => {
  const { original, side } = await protectedStartupWithSide(page);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { await IO.autoSave(); window.dispatchEvent(new Event('pagehide')); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300);
  expect(await pendingKey(page)).toBe(side);
  expect(await readIdb(page)).toBe(original);
  expect(await page.evaluate(() => localStorage.getItem('map_autosave_pending_prev'))).toBeNull();
  await expect(page.locator('.toast.sticky', { hasText: 'could not be read' }).locator('.toast-detail')).toContainText('File > New or File > Open resumes normal saving');
});

test('protected startup: the first side write rotates the earlier side copy to _prev', async ({ page }) => {
  const { original, side } = await protectedStartupWithSide(page);
  await page.keyboard.press('Escape');
  await page.locator('#newmap-modal .btn-primary', { hasText: 'Create' }).click();
  await page.evaluate(() => IO.autoSave());
  expect(await page.evaluate(() => localStorage.getItem('map_autosave_pending_prev'))).toBe(side);
  const pend = JSON.parse((await pendingKey(page))!);
  expect(pend._autosavedAt).toBeGreaterThan(900);
  expect(await readIdb(page)).toBe(original);
});

test('protected startup: Restore loads the side copy, protection stays on, the old copy is rotated not lost', async ({ page }) => {
  const { original, side } = await protectedStartupWithSide(page);
  await page.locator('#dialog-actions').getByRole('button', { name: 'Restore newer changes' }).click();
  await expect.poll(() => page.evaluate(() => mapData[0])).toBe('Rubble_2');
  expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(true);
  await page.evaluate(() => IO.autoSave());
  expect(await page.evaluate(() => localStorage.getItem('map_autosave_pending_prev'))).toBe(side);
  expect(await readIdb(page)).toBe(original);
});

for (const [name, ts, raw] of [['stale', 500, undefined], ['invalid', null, '{"garbage']] as const) {
  test(`a ${name} pending copy is removed on a clean startup without asking`, async ({ page }) => {
    await seedPending(page, ts, raw);
    await expect(page.locator('#dialog-modal.open')).toHaveCount(0);
    expect(await pendingKey(page)).toBeNull();
    expect(await page.evaluate(() => mapData[0])).toBe('Rubble_1');
  });
}
