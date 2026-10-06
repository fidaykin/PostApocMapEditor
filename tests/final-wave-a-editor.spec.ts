import { test, expect } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// Final fix wave A, editor items: A9 (auto-place / zone fill keep Placement's bunkers and mega cities), A10 (startup autosave
// validation and load-refusal data safety), A11 (image pixel cap before decode).

const CFG = `{ bunkers: { count: 8, kind: 'settlement', id: 'bunker', minCity: 6 }, megaCities: { count: 2, kind: 'settlement', id: 'megacity', minCity: 40 },
  artifacts: { count: 0, kind: 'object', id: 'Artefact_Test_1', minCity: 25 }, ores: [] }`;
const types = (page: any): Promise<Record<string, number>> => page.evaluate(() => {
  const o: Record<string, number> = {};
  for (const s of settlements) o[s.type] = (o[s.type] || 0) + 1;
  return o;
});

test.describe('A9: Auto-place and zone fill only replace what slots/zones created', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('Place then Auto-place keeps bunkers and mega cities (and replaces stray slot settlements); undo restores everything', async ({ page }) => {
    await page.evaluate(`Placement.place(${CFG}, 7)`);
    const placed = await types(page);
    expect(placed.bunker, 'positive control: bunkers were placed').toBeGreaterThan(0);
    expect(placed.megacity, 'positive control: mega cities were placed').toBeGreaterThan(0);
    await page.evaluate(() => { settlements.push({ col: 5, row: 5, type: 'settlement' }, { col: 6, row: 9, type: 'outpost' }); });
    const before = await page.evaluate(() => JSON.stringify(settlements));
    await page.evaluate(() => {
      settlementSlots = [{ minDist: 5, maxDist: 12, count: 4, type: 'settlement', tapMultiplier: 1, level: 1, minSpacing: 2, nearPct: 34, midPct: 33, farPct: 33 }];
      autoPlaceSettlements();
    });
    const after = await types(page);
    expect(after.bunker).toBe(placed.bunker);
    expect(after.megacity).toBe(placed.megacity);
    expect(after.city).toBe(1);
    expect(after.settlement, 'slot settlements were placed').toBeGreaterThan(0);
    expect(await page.evaluate(() => settlements.some(s => s.col === 5 && s.row === 5 && s.type === 'settlement'))).toBe(false);   // stray slot settlement replaced
    expect(await page.evaluate(() => settlements.some(s => s.col === 6 && s.row === 9 && s.type === 'outpost'))).toBe(false);      // outposts are slot-created too
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => JSON.stringify(settlements))).toBe(before);
  });

  test('zone fill keeps bunkers/mega cities inside the zone, replaces only its own settlements; undo restores', async ({ page }) => {
    const r = await page.evaluate(() => {
      const id = ZonePainter.addZone('z', '#ff0000');
      const layer = ZonePainter.getZoneLayer();
      for (let row = 100; row < 200; row++) for (let col = 100; col < 200; col++) layer[row * MAP_WIDTH + col] = id;
      settlements.push({ col: 150, row: 150, type: 'bunker' }, { col: 120, row: 120, type: 'megacity' }, { col: 110, row: 110, type: 'settlement' });
      const before = JSON.stringify(settlements);
      ZonePainter.fillZoneSettlements(id, mapData, settlements);
      const kinds = settlements.map(s => s.type);
      const out = {
        bunker: settlements.some(s => s.type === 'bunker' && s.col === 150 && s.row === 150),
        mega: settlements.some(s => s.type === 'megacity' && s.col === 120 && s.row === 120),
        strayGone: !settlements.some(s => s.col === 110 && s.row === 110),
        newOnes: kinds.filter(k => k === 'settlement').length,
      };
      return { ...out, before };
    });
    expect(r.bunker).toBe(true);
    expect(r.mega).toBe(true);
    expect(r.strayGone).toBe(true);
    expect(r.newOnes, 'positive control: the zone fill placed settlements').toBeGreaterThan(0);
    // the History-backed entry point (Fill all zones) is one undoable step that restores the list
    const u = await page.evaluate(() => {
      const before = JSON.stringify(settlements);
      ZonePainter._fillAllZones();
      const mid = JSON.stringify(settlements);
      History.undo();
      return { changed: mid !== before, restored: JSON.stringify(settlements) === before, bunkers: settlements.filter(s => s.type === 'bunker').length };
    });
    expect(u.restored).toBe(true);
    expect(u.bunkers).toBe(1);
  });
});

// ── A10: startup autosave validation and load refusal keep the user's data ────────────────────────────────────────
import { openEditor, reloadEditor, FakeGitHub } from './helpers';

const idbOpen = `new Promise(res => { const r = indexedDB.open('MapEditorPro', 1); r.onsuccess = () => res(r.result); })`;
const readIdbKey = (page: any, key: string) => page.evaluate(async ([k, o]: string[]) => {
  const db: any = await eval(o);
  return new Promise<any>(res => { const g = db.transaction('kv').objectStore('kv').get(k); g.onsuccess = () => res(g.result ?? null); });
}, [key, idbOpen]);
const writeIdbKey = (page: any, key: string, v: any) => page.evaluate(async ([k, val, o]: any[]) => {
  const db: any = await eval(o);
  return new Promise<void>(res => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, k); tx.oncomplete = () => res(); });
}, [key, v, idbOpen]);
const baseMap = (tweak: (j: any) => void = () => {}) => { const j: any = new FakeGitHub().json('maps/current_map.json'); tweak(j); return j; };
const fileLabel = (page: any) => page.locator('#map-file-label').textContent();
const mapHash = (page: any) => page.evaluate(() => JSON.stringify([MAP_WIDTH, MAP_HEIGHT, mapData.join('|'), objectsData, settlements]));

test.describe('A10: autosave and load data safety', () => {
  test('a startup autosave that fails MapFormat validation turns protected mode on with a message; the stored record is never overwritten', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => { IO.autoSave = () => Promise.resolve(false); });          // no unload flush may replace the record we plant
    const bad = JSON.stringify({ ...baseMap(j => { j._autosavedAt = 4242; }), objects: [null] });
    await writeIdbKey(page, 'map_autosave', bad);
    await page.evaluate(() => localStorage.removeItem('map_autosave'));
    await reloadEditor(page);
    expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(true);
    expect(await page.evaluate(() => IO.getRestoreProblem())).toMatch(/could not be restored/);
    await expect(page.locator('.toast.sticky')).toContainText('could not be restored');
    await page.evaluate(async () => { mapData[1] = 'Barren_1'; await IO.autoSave(); });
    expect(await readIdbKey(page, 'map_autosave')).toBe(bad);                             // the main slot is left alone
  });

  test('positive control: a valid startup autosave still restores and is not protected', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => { IO.autoSave = () => Promise.resolve(false); });
    const good = JSON.stringify(baseMap(j => { j._autosavedAt = 4242; j.data[0][0] = 'Rubble_3'; }));
    await writeIdbKey(page, 'map_autosave', good);
    await page.evaluate(() => localStorage.removeItem('map_autosave'));
    await reloadEditor(page);
    expect(await page.evaluate(() => IO.isAutosaveProtected())).toBe(false);
    expect(await page.evaluate(() => mapData[0])).toBe('Rubble_3');
  });

  test('MapFormat.validate: a truthy non-array biomePresets and a non-base64 zoneMap are errors; null/[]/valid base64 are fine', async ({ page }) => {
    await openEditor(page);
    const r = await page.evaluate(() => {
      const base = () => ({ width: 10, height: 10, data: Array.from({ length: 10 }, () => Array(10).fill('Plain_1')) });
      const v = (extra: any) => MapFormat.validate({ ...base(), ...extra });
      return {
        objPresets: v({ biomePresets: {} }).errors, strPresets: v({ biomePresets: 'x' }).errors, numPresets: v({ biomePresets: 5 }).errors,
        okPresets: [v({ biomePresets: [] }).ok, v({ biomePresets: null }).ok, v({}).ok],
        objZone: v({ zoneMap: {} }).errors, numZone: v({ zoneMap: 5 }).errors, badZone: v({ zoneMap: 'not*base64!' }).errors, shortZone: v({ zoneMap: 'abcde' }).errors,
        okZone: [v({ zoneMap: btoa('abc') }).ok, v({ zoneMap: '' }).ok, v({ zoneMap: null }).ok, v({ zoneMap: 'QUJD\nREVG' }).ok],
      };
    });
    expect(r.objPresets).toEqual(['biomePresets must be an array.']);
    expect(r.strPresets).toEqual(['biomePresets must be an array.']);
    expect(r.numPresets).toEqual(['biomePresets must be an array.']);
    expect(r.okPresets).toEqual([true, true, true]);
    for (const k of ['objZone', 'numZone', 'badZone', 'shortZone']) expect((r as any)[k], k).toEqual(['zoneMap must be base64 text.']);
    expect(r.okZone).toEqual([true, true, true, true]);
  });

  test('a refused load (biomePresets: {}) touches nothing: current map and file name stay, loadFromJSON says false, no Loaded toast', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => { mapData[3] = 'Rubble_2'; IO.setFileName('mine'); });
    const before = await mapHash(page);
    const bad = JSON.stringify(baseMap(j => { j.biomePresets = {}; }));
    const ok = await page.evaluate(b => IO.loadFromJSON(JSON.parse(b)), bad);
    expect(ok).toBe(false);
    await expect(page.locator('#dialog-modal.open')).toBeVisible();                       // the failure is reported
    await page.locator('#dialog-modal.open button').first().click();
    expect(await mapHash(page)).toBe(before);
    expect(await fileLabel(page)).toBe('mine');
    // positive control: a valid map loads, returns true and takes its file name
    const good = JSON.stringify(baseMap());
    expect(await page.evaluate(b => IO.loadFromJSON(JSON.parse(b)), good)).toBe(true);
  });

  test('file input: a refused map keeps the file name; a valid one takes it', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => IO.setFileName('mine'));
    await page.setInputFiles('#file-input', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(baseMap(j => { j.zoneMap = { x: 1 }; }))) });
    await expect(page.locator('#dialog-modal.open')).toBeVisible();
    await page.locator('#dialog-modal.open button').first().click();
    expect(await fileLabel(page)).toBe('mine');
    await page.setInputFiles('#file-input', { name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(baseMap())) });
    await expect(page.locator('#map-file-label')).toHaveText('good');
  });

  test('server maps list: a refused map keeps the file name and never toasts Loaded; a valid one does', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.setJson('maps/map_list.json', { maps: [{ name: 'Bad one', fileName: 'bad.json' }, { name: 'Good one', fileName: 'good.json' }] });
    gh.setJson('maps/bad.json', baseMap(j => { j.biomePresets = {}; }));
    gh.setJson('maps/good.json', baseMap());
    await openEditor(page, { gh });
    await page.evaluate(() => IO.setFileName('mine'));
    await page.evaluate(() => GitHubSync.openMapsPopover());
    await page.locator('.gh-map-row').nth(0).getByRole('button', { name: 'Load' }).click();
    await expect(page.locator('#dialog-modal.open')).toBeVisible();
    await page.locator('#dialog-modal.open button').first().click();
    expect(await fileLabel(page)).toBe('mine');
    await expect(page.locator('#toast-container')).not.toContainText('Loaded Bad one');
    await page.evaluate(() => GitHubSync.openMapsPopover());                              // closed on refusal so the error is visible
    await expect(page.locator('.gh-map-row').nth(1)).toBeVisible();
    await page.locator('.gh-map-row').nth(1).getByRole('button', { name: 'Load' }).click();
    await expect(page.locator('#toast-container')).toContainText('Loaded Good one');
    expect(await fileLabel(page)).toBe('good');
  });
});
