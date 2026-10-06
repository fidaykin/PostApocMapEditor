// T6.2: MapFormat (map-format.js): pure versioning + validation that mirrors IO.loadFromJSON's leniency.
// Node side: the file is evaluated in a bare vm context (no window/document/self) and via require().
// Page side: the same maps go through the REAL loader, and validate().ok must agree with "the loader did not fail".
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { openEditor } from '../helpers';
import '../editor-globals.d';

declare const MapFormat: any;
const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'map-format.js');

function loadInVm(extra: Record<string, any> = {}) {
  const sandbox: any = { ...extra };
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'map-format.js' });
  return sandbox.MapFormat;
}
const MF = () => loadInVm();
// vm results are cross-realm: normalise before deep equality
const plain = (v: any) => JSON.parse(JSON.stringify(v));
const good = (): any => ({ version: 2, packages: ['postapoc'], width: 12, height: 10,
  data: Array.from({ length: 10 }, () => new Array(12).fill('Plain_1')),
  settlements: [{ col: 6, row: 5, type: 'city' }], settlement_priorities: { p1: ['Plain_1'], p2: [] } });

test('map-format.js is DOM-free, loads in a bare vm context and via require, and exposes the API', () => {
  const src = fs.readFileSync(SRC, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const bad of [/\bdocument\b/, /\bwindow\b/, /\bJSON\.stringify\b/, /MAP_WIDTH/]) expect(src).not.toMatch(bad);
  const viaVm = MF();
  const viaRequire = require(SRC);
  for (const m of [viaVm, viaRequire]) {
    expect(m.CURRENT_VERSION).toBe(2);
    expect([m.MIN_SIZE, m.MAX_SIZE]).toEqual([10, 450]);
    expect(['validate', 'migrate', 'stamp'].map(k => typeof m[k])).toEqual(['function', 'function', 'function']);
  }
});

test('a valid current map is ok with no errors and no warnings', () => {
  const r = plain(MF().validate(good()));
  expect(r).toMatchObject({ ok: true, errors: [], warnings: [], version: 2, clamped: null });
});

test('every fixture under maps/ validates ok (no-version warning only); map_list.json is not a map', () => {
  const dir = path.join(ROOT, 'maps');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'map_list.json');
  expect(files.length).toBeGreaterThanOrEqual(30);   // positive control: the fixtures were really found
  const mf = MF();
  const seenLegacy = new Set<boolean>();
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const r = plain(mf.validate(j));
    expect(r.errors, f).toEqual([]);
    expect(r.ok, f).toBe(true);
    for (const w of r.warnings) expect(w, f).toMatch(/no version/i);
    seenLegacy.add(r.legacyIntegerCells);
  }
  expect([...seenLegacy].sort()).toEqual([false, true]);   // both the integer-cell and the id-string fixtures were covered
  const list = plain(mf.validate(JSON.parse(fs.readFileSync(path.join(dir, 'map_list.json'), 'utf8'))));
  expect(list.ok).toBe(false);
});

test('structural errors: the loader would throw or load garbage', () => {
  const mf = MF();
  const errs = (o: any) => plain(mf.validate(o)).errors.join(' | ');
  expect(plain(mf.validate(null)).ok).toBe(false);
  expect(plain(mf.validate([])).ok).toBe(false);
  expect(plain(mf.validate('map')).ok).toBe(false);
  expect(errs({ ...good(), data: 'x' })).toMatch(/data/);
  expect(errs({ ...good(), width: 'wide' })).toMatch(/width/);
  expect(errs({ ...good(), width: 0 })).toMatch(/width/);
  expect(errs({ ...good(), height: undefined })).toMatch(/height/);
  expect(errs({ ...good(), height: 10.5 })).toMatch(/height/);
  expect(errs({ ...good(), data: [['Plain_1', {}], []] })).toMatch(/cell/);
  expect(errs({ ...good(), data: [['Plain_1', true]] })).toMatch(/cell/);
  expect(errs({ ...good(), data: [{ a: 1 }] })).toMatch(/row/);
  expect(errs({ ...good(), bridges: [null] })).toMatch(/bridges/);
  expect(errs({ ...good(), objects: [undefined] })).toMatch(/objects/);
  expect(errs({ ...good(), roads: [null] })).toMatch(/roads/);
  expect(errs({ ...good(), tileExtras: [null] })).toMatch(/tileExtras/);
  expect(errs({ ...good(), settlements: [null] })).toMatch(/settlements/);
  expect(errs({ ...good(), settlement_slots: [null] })).toMatch(/settlement_slots/);
  expect(errs({ ...good(), width: 12, data: [[1, 2], [{}]] })).toMatch(/cell/);   // legacy integer map: same rule
});

test('loader leniency is accepted: null/empty cells, missing rows, numeric strings, wrong-typed optional lists', () => {
  const mf = MF();
  const ok = (o: any) => plain(mf.validate(o));
  expect(ok({ ...good(), data: [['Plain_1', null, '', undefined, 0, false]] }).ok).toBe(true);        // falsy cells -> Plain_1
  expect(ok({ ...good(), data: [['Plain_1'], null, undefined, ['Water_1']] }).ok).toBe(true);          // missing/short rows
  expect(ok({ ...good(), width: '12', height: '10' }).ok).toBe(true);                                  // Math.min coerces
  for (const k of ['bridges', 'objects', 'roads', 'tileExtras', 'settlement_slots', 'packages', 'zones']) {
    const r = ok({ ...good(), [k]: { not: 'an array' } });
    expect(r.ok, k).toBe(true);                                                                        // the loader ignores them
    expect(r.warnings.join(' | '), k).toMatch(new RegExp(k));
  }
  expect(ok({ ...good(), packages: [1, null, 'x'] }).ok).toBe(true);
  expect(ok({ ...good(), version: 1.5 }).ok).toBe(true);                                               // the loader ignores `version`
});

test('size and shape problems are warnings, not errors', () => {
  const mf = MF();
  const r = (o: any) => plain(mf.validate(o));
  const noVersion: any = good(); delete noVersion.version;
  expect(r(noVersion)).toMatchObject({ ok: true, version: null });
  expect(r(noVersion).warnings.join()).toMatch(/no version/i);
  const big = r({ ...good(), width: 600, height: 5 });
  expect(big).toMatchObject({ ok: true, clamped: { from: [600, 5], to: [450, 10] } });
  expect(big.warnings.join(' | ')).toMatch(/outside 10-450/);
  expect(r({ ...good(), height: 12 }).warnings.join()).toMatch(/10 rows/);
  expect(r({ ...good(), width: 14 }).warnings.join()).toMatch(/shorter than the width/);
  expect(r({ ...good(), data: [['A'], null, ['B']] }).warnings.join()).toMatch(/missing/);
  expect(r({ ...good(), settlements: [{ col: 90, row: 5, type: 'city' }, { x: 3, y: 99 }, { x: 3, y: 3 }] }).warnings.join()).toMatch(/2 settlement\(s\) lie outside/);
  expect(r({ ...good(), version: 3 })).toMatchObject({ ok: true, version: 3 });
  expect(r({ ...good(), version: 3 }).warnings.join()).toMatch(/newer/i);
  expect(r({ ...good(), width: '12' }).warnings.join()).toMatch(/text/);
  expect(r({ ...good(), data: [['Plain_1', 2]] }).warnings.join()).toMatch(/numeric/);
});

test('the 16 contract keys, editor-only keys and unknown keys are all accepted and never stripped', () => {
  const mf = MF();
  const full: any = { ...good(), settlement_slots: [{ minDist: 1 }], bridges: [{ col: 1, row: 1, axis: 2 }],
    objects: [{ col: 1, row: 2, id: 'X' }], tileExtras: [{ col: 3, row: 3, underTerrainId: 'Plain_1' }],
    roads: [{ col: 4, row: 4, type: 'road_hex' }], zones: [{ id: 1, name: 'Z', color: '#f00' }], zoneMap: 'AAAA',
    biomePresets: [], _zoneNextId: 2, distance_bands: [10, 20], custom_terrain: [], someFutureKey: { deep: [1, 2, 3] } };
  const before = Object.keys(full).sort();
  const r = plain(mf.validate(full));
  expect(r).toMatchObject({ ok: true, errors: [], warnings: [] });
  expect(Object.keys(full).sort()).toEqual(before);
  const m = mf.migrate(full);
  expect(Object.keys(m).sort()).toEqual(before);                     // migrate keeps unknown keys too
  expect(m.someFutureKey).toBe(full.someFutureKey);
});

test('prototype pollution: own __proto__ keys are rejected, never copied, and Object.prototype stays clean', () => {
  const mf = MF();
  const hostile = JSON.parse('{"version":2,"width":12,"height":10,"data":[],"__proto__":{"polluted":1}}');
  const r = plain(mf.validate(hostile));
  expect(r.ok).toBe(false);
  expect(r.errors.join()).toMatch(/__proto__/);
  const inEntry = JSON.parse('{"version":2,"width":12,"height":10,"data":[],"objects":[{"col":1,"row":1,"id":"X","__proto__":{"polluted":1}}]}');
  expect(plain(mf.validate(inEntry)).errors.join()).toMatch(/__proto__/);
  const m = mf.migrate(hostile);
  expect(Object.prototype.hasOwnProperty.call(m, '__proto__')).toBe(false);
  expect((m as any).polluted).toBeUndefined();
  expect(({} as any).polluted).toBeUndefined();
  expect((vm.runInNewContext('({}).polluted') as any)).toBeUndefined();
  // positive control: a clean map with a normal prototype is not rejected
  expect(plain(mf.validate(good())).ok).toBe(true);
});

test('migrate: v1 to v2 shallow copy, never mutates, keeps layers by reference; old settlement {x,y} shape normalised', () => {
  const mf = MF();
  const old: any = { width: 12, height: 10, data: [[1, 2, 3]], settlements: [{ x: 3, y: 4 }, { col: 1, row: 2, type: 'city' }], custom: 5 };
  const snapshot = JSON.stringify(old);
  const m = mf.migrate(old);
  expect(JSON.stringify(old)).toBe(snapshot);                         // input untouched
  expect(m).not.toBe(old);
  expect(m.version).toBe(2);
  expect(plain(m.packages)).toEqual(['postapoc']);
  expect(m.data).toBe(old.data);                                      // no deep copy (huge maps)
  expect(plain(m.settlements)).toEqual([{ col: 3, row: 4, type: 'settlement' }, { col: 1, row: 2, type: 'city' }]);
  expect(old.settlements[0]).toEqual({ x: 3, y: 4 });
  expect(m.custom).toBe(5);
  const again = mf.migrate(m);
  expect(plain(again)).toEqual(plain(m));                             // idempotent
  expect(mf.migrate(good()).settlements).toEqual(good().settlements);
  expect(plain(mf.migrate({ ...good(), packages: ['medieval'] }).packages)).toEqual(['medieval']);   // existing packages kept
  expect(mf.migrate({ ...good(), version: 5 }).version).toBe(5);       // never downgrades a newer file
  expect(() => mf.migrate(null)).not.toThrow();
});

test('stamp sets the current version first and never mutates', () => {
  const mf = MF();
  const o: any = { width: 3, packages: ['postapoc'], version: 1 };
  const s = mf.stamp(o);
  expect(o.version).toBe(1);
  expect(Object.keys(s)).toEqual(['version', 'width', 'packages']);
  expect(s.version).toBe(2);
  expect(Object.keys(mf.stamp({ width: 3 }))).toEqual(['version', 'width']);
});

test('no JSON.stringify deep copy anywhere, and hostile input never throws', () => {
  const trap = { stringify() { throw new Error('stringify called'); }, parse: JSON.parse };
  const mf = loadInVm({ JSON: trap });
  const huge: any = { ...good(), width: 450, height: 450, data: Array.from({ length: 450 }, () => new Array(450).fill('Plain_1')),
    roads: Array.from({ length: 5000 }, (_, i) => ({ col: i % 450, row: (i / 450) | 0, type: 'road_hex' })) };
  expect(mf.validate(huge).ok).toBe(true);
  expect(mf.migrate(huge).data).toBe(huge.data);
  expect(mf.stamp(huge).data).toBe(huge.data);
  const throwing = { get width() { throw new Error('boom'); } };
  const cyc: any = { width: 12, height: 10, data: [] }; cyc.data.push(cyc);
  for (const h of [undefined, null, 0, 'x', [], [[]], () => 1, throwing, cyc, new Proxy({}, { get() { throw new Error('trap'); } })]) {
    const r = plain(mf.validate(h));
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    for (const e of r.errors.concat(r.warnings)) expect(typeof e).toBe('string');
  }
});

test('messages are plain strings that never echo untrusted values', () => {
  const mf = MF();
  const evil = '<img src=x onerror=alert(1)>';
  const r = plain(mf.validate({ ...good(), width: evil, data: [[evil, {}]], packages: [evil], version: evil }));
  for (const m of r.errors.concat(r.warnings)) { expect(typeof m).toBe('string'); expect(m).not.toContain('<'); expect(m.length).toBeLessThan(300); }
  const r2 = plain(mf.validate({ ...good(), data: [[evil, { x: 1 }]], packages: [evil, 5] }));
  for (const m of r2.errors.concat(r2.warnings)) expect(m).not.toContain('<');
});

test.describe('in the editor page', () => {
  test('the page loads map-format.js as a global', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', r => { if (r.url().includes('map-format.js') && !r.ok()) failed.push(r.url()); });
    await openEditor(page);
    expect(await page.evaluate(() => [typeof MapFormat.validate, MapFormat.CURRENT_VERSION])).toEqual(['function', 2]);
    expect(failed).toEqual([]);
    const html = fs.readFileSync(path.join(ROOT, 'MapEditorPro.html'), 'utf8');
    expect(html).toMatch(/<script src="map-format\.js\?v=1"><\/script>/);
  });

  test('validate() agrees with the real loader on crafted maps (differential)', async ({ page }) => {
    await openEditor(page);
    const rows = (h: number, w: number, v: any = 'Plain_1') => Array.from({ length: h }, () => new Array(w).fill(v));
    const cases: Record<string, any> = {
      minimal: { width: 10, height: 10, data: rows(10, 10) },
      versioned: { version: 2, width: 10, height: 10, data: rows(10, 10), settlements: [{ col: 5, row: 5, type: 'city' }] },
      stringSize: { width: '12', height: '11', data: rows(11, 12) },
      nullCells: { width: 10, height: 10, data: [[null, '', 0, 'Water_1']] },
      missingRows: { width: 10, height: 10, data: [['Water_1'], null, undefined, ['Oil_1']] },
      legacyInts: { width: 10, height: 10, data: rows(10, 10, 12) },
      legacyCustom: { width: 10, height: 10, data: rows(10, 10, 12), custom_terrain: [{ x: 1, y: 1, id: 'Oil_1' }] },
      xySettlements: { width: 10, height: 10, data: rows(10, 10), settlements: [{ x: 2, y: 2 }] },
      tooBig: { width: 600, height: 700, data: rows(2, 2) },
      tooSmall: { width: 3, height: 4, data: rows(4, 3) },
      badLists: { width: 10, height: 10, data: rows(10, 10), bridges: 5, objects: 'x', roads: {}, tileExtras: 7, settlement_slots: 1 },
      noWidth: { height: 10, data: rows(10, 10) },
      zeroHeight: { width: 10, height: 0, data: rows(10, 10) },
      noData: { width: 10, height: 10 },
      dataString: { width: 10, height: 10, data: 'abc' },
      widthText: { width: 'wide', height: 10, data: rows(10, 10) },
      nullBridge: { width: 10, height: 10, data: rows(10, 10), bridges: [null] },
      nullObject: { width: 10, height: 10, data: rows(10, 10), objects: [null] },
      nullRoad: { width: 10, height: 10, data: rows(10, 10), roads: [null] },
      nullExtra: { width: 10, height: 10, data: rows(10, 10), tileExtras: [null] },
      nullSettlement: { width: 10, height: 10, data: rows(10, 10), settlements: [null] },
      nullSlot: { width: 10, height: 10, data: rows(10, 10), settlement_slots: [null] },
    };
    const r = await page.evaluate((cs) => {
      const out: Record<string, any> = {};
      const realAlert = UI.alert; let alerts = 0;
      UI.alert = () => { alerts++; };
      for (const [name, json] of Object.entries(cs)) {
        alerts = 0;
        try { IO.loadFromJSON(JSON.parse(JSON.stringify(json))); } catch (e) { alerts++; }
        const v = MapFormat.validate(json);
        out[name] = { loaderFailed: alerts > 0, ok: v.ok };
      }
      UI.alert = realAlert;
      return out;
    }, cases);
    const mismatches = Object.entries(r).filter(([, v]: any) => v.loaderFailed === v.ok).map(([k]) => k);
    expect(mismatches).toEqual([]);
    // positive controls: both outcomes occurred
    const vals: any[] = Object.values(r);
    expect(vals.some(v => v.ok)).toBe(true);
    expect(vals.some(v => !v.ok)).toBe(true);
    expect(vals.filter(v => v.ok).length).toBeGreaterThanOrEqual(10);
  });
});
