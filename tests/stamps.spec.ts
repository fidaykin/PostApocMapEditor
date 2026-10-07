import { test, expect, Page } from '@playwright/test';
import { freshEditor, clickCell, cellPoint } from './editor-helpers';
import * as fs from 'fs';
import { openSection } from './helpers';

// Region used by the plain tests: two cells next to the city.
async function seedPond(page: Page) {
  await page.evaluate(() => {
    mapData[224 * MAP_WIDTH + 225] = 'Forest_1';
    mapData[224 * MAP_WIDTH + 226] = 'Mountain_1';
    Selection.setCells([{ col: 225, row: 224 }, { col: 226, row: 224 }]);
  });
}
const capturePond = (page: Page) => page.evaluate(() => Clipboard.capture(Selection.getCells()));

// A rich region: terrain, objects, two road types, bridges (two axes), extras, zones and a real multi-tile anchor
// (Rabbit_Flat_1 = anchor + 3 satellite cells). Deterministic, so a second page session can rebuild the same map.
async function seedRich(page: Page) {
  return page.evaluate(() => {
    const W = MAP_WIDTH, zl = ZonePainter.getZoneLayer();
    mapData.fill('Plain_1'); objectsData = {}; roadsData = {}; tileExtras = {}; bridgesData = []; zl.fill(0);
    mapData[200 * W + 200] = 'Rabbit_Flat_1'; invalidateSatelliteMap();
    const cells: { col: number; row: number }[] = [];
    for (let r = 198; r <= 202; r++) for (let c = 198; c <= 204; c++) cells.push({ col: c, row: r });
    mapData[198 * W + 198] = 'Forest_1'; objectsData['198,198'] = 'Grain_1'; roadsData['198,198'] = { type: 'road_hex' };
    mapData[198 * W + 199] = 'Mountain_1'; roadsData['199,198'] = { type: 'road_alt' };
    mapData[198 * W + 200] = 'Water_1'; bridgesData.push({ col: 200, row: 198, axis: 2 }); tileExtras['200,198'] = { underTerrainId: 'Water_1', tag: 7 };
    mapData[199 * W + 198] = 'Desert_1'; bridgesData.push({ col: 198, row: 199, axis: 1 }); zl[199 * W + 198] = 3;
    mapData[199 * W + 199] = 'Hills_1'; zl[199 * W + 199] = 2;
    for (const q of cells) {                                   // satellites of the multi-tile anchor carry layers too
      const own = getSatelliteAnchor(q.col, q.row);
      if (own && own.col === 200 && own.row === 200) { const k = q.col + ',' + q.row; objectsData[k] = 'Grain_1'; roadsData[k] = { type: 'road_hex' }; zl[q.row * W + q.col] = 5; }
    }
    Selection.setCells(cells);
    return Clipboard.capture(Selection.getCells());
  });
}
const snapshot = (page: Page) => page.evaluate(() => JSON.stringify({ m: mapData.join('|'), o: objectsData, r: roadsData, b: bridgesData, x: tileExtras, z: Array.from(ZonePainter.getZoneLayer()).join('') }));

/** Places `bufJson` (a buffer) at a target on the SAME starting map twice: once as given, once via the stored stamp. */
async function placeBoth(page: Page, orig: any, xf: any) {
  return page.evaluate(([orig, xf]) => {
    const snap = () => JSON.stringify({ m: mapData.join('|'), o: objectsData, r: roadsData, b: bridgesData, x: tileExtras });   // the zone layer is compared apart (stamps carry no zones)
    const zonesNow = () => Array.from(ZonePainter.getZoneLayer()).join('');
    const here = Clipboard.capture(Selection.getCells());            // a buffer that belongs to THIS map (one passed in from Node lost its map token)
    if (JSON.stringify(here.cells) !== JSON.stringify(orig.cells)) throw new Error('capture differs');
    const zl = ZonePainter.getZoneLayer();
    const base = { m: mapData.slice(), o: JSON.parse(JSON.stringify(objectsData)), r: JSON.parse(JSON.stringify(roadsData)), b: JSON.parse(JSON.stringify(bridgesData)), x: JSON.parse(JSON.stringify(tileExtras)), z: zl.slice() };
    const restore = () => { mapData = base.m.slice(); objectsData = JSON.parse(JSON.stringify(base.o)); roadsData = JSON.parse(JSON.stringify(base.r)); bridgesData = JSON.parse(JSON.stringify(base.b)); tileExtras = JSON.parse(JSON.stringify(base.x)); zl.set(base.z); invalidateSatelliteMap(); };
    const target = { col: 300, row: 300 };
    return Stamps.list().then((l: any[]) => {
      const baseS = snap(), zoneBase = zonesNow();
      Clipboard.place(here, target, xf, {});
      const a = snap(), zoneA = zonesNow(); restore();
      if (snap() !== baseS || zonesNow() !== zoneBase) throw new Error('restore failed');
      Clipboard.place(Stamps.toBuffer(l[0]), target, xf, {});
      const b = snap(), zoneB = zonesNow();
      return { a, b, baseS, zoneBase, zoneA, zoneB };
    });
  }, [orig, xf]);
}

test.describe('stamp store (T2.12)', () => {
  test('stamps persist across a reload', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    await page.evaluate(async () => { await Stamps.save('pond', Clipboard.capture(Selection.getCells())); });
    await page.reload();
    await page.waitForFunction(() => typeof Stamps !== 'undefined' && HexDB.getAll().length > 0);
    const list = await page.evaluate(async () => (await Stamps.list()).map((s: any) => ({ name: s.name, n: s.cells.length })));
    expect(list).toEqual([{ name: 'pond', n: 2 }]);
  });

  test('stamps live in their own database and never in the map JSON, localStorage or the autosave database', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    const r = await page.evaluate(async () => {
      await Stamps.save('SECRETSTAMPNAME', Clipboard.capture(Selection.getCells()));
      IO.scheduleAutoSave();
      const dbs = (await indexedDB.databases()).map((d: any) => d.name);
      const ls = Object.keys(localStorage).map(k => k + '=' + localStorage.getItem(k)).join('\n');
      // dump every store of the autosave database
      const dump: string = await new Promise(res => {
        const rq = indexedDB.open('MapEditorPro');
        rq.onerror = () => res('');
        rq.onsuccess = () => {
          const db = rq.result, names = Array.from(db.objectStoreNames) as string[];
          if (!names.length) { db.close(); return res(''); }
          const tx = db.transaction(names, 'readonly'); let out = '';
          let left = names.length;
          for (const n of names) { const g = tx.objectStore(n).getAll(); g.onsuccess = () => { try { out += JSON.stringify(g.result); } catch {} if (--left === 0) { db.close(); res(out); } }; }
        };
      });
      return { dbs, mapHas: (IO.getMapJson() || '').includes('SECRETSTAMPNAME'), mapStamps: (IO.getMapJson() || '').toLowerCase().includes('stamp'), lsHas: ls.includes('SECRETSTAMPNAME'), dumpHas: dump.includes('SECRETSTAMPNAME') };
    });
    expect(r.dbs).toContain('MapEditorStamps');
    expect(r.mapHas).toBe(false);
    expect(r.mapStamps).toBe(false);
    expect(r.lsHas).toBe(false);
    expect(r.dumpHas).toBe(false);
  });

  test('New Map does not touch the stamps', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    const names = await page.evaluate(async () => {
      await Stamps.save('keep', Clipboard.capture(Selection.getCells()));
      IO.newMap(true);
      return (await Stamps.list()).map((s: any) => s.name);
    });
    expect(names).toEqual(['keep']);
  });

  test('export / import round-trips and malformed input writes nothing', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    const r = await page.evaluate(async () => {
      const a = await Stamps.save('a', Clipboard.capture(Selection.getCells()));
      const json = await Stamps.exportJson();
      const parsed = JSON.parse(json);
      await Stamps.remove(a.id);
      const imported = await Stamps.importJson(json);
      let err = '';
      try { await Stamps.importJson('{"format":"mapeditor-stamps","version":1,"stamps":[{"name":"bad","cells":[{"dq":"x"}]}]}'); }
      catch (e: any) { err = e.message; }
      const after = await Stamps.list();
      return { head: [parsed.format, parsed.version, parsed.stamps.length], imported, err, names: after.map((s: any) => s.name), cells: after[0].cells, orig: a.cells };
    });
    expect(r.head).toEqual(['mapeditor-stamps', 1, 1]);
    expect(r.imported).toBe(1);
    expect(r.err).toMatch(/invalid/i);
    expect(r.names).toEqual(['a']);
    expect(r.cells).toEqual(r.orig);
  });

  // ---------- strict import --------------------------------------------------------------------
  const wrap = (stamps: string) => `{"format":"mapeditor-stamps","version":1,"stamps":${stamps}}`;
  const okCell = '{"dq":0,"dr":0,"t":"Plain_1"}';
  const BAD: [string, string][] = [
    ['not JSON', 'nope{'],
    ['top-level array', '[]'],
    ['null', 'null'],
    ['wrong format', '{"format":"other","version":1,"stamps":[]}'],
    ['missing version', '{"format":"mapeditor-stamps","stamps":[]}'],
    ['future version', '{"format":"mapeditor-stamps","version":2,"stamps":[]}'],
    ['stamps not an array', '{"format":"mapeditor-stamps","version":1,"stamps":{}}'],
    ['stamp not an object', wrap('[5]')],
    ['stamp is null', wrap('[null]')],
    ['name missing', wrap(`[{"cells":[${okCell}]}]`)],
    ['name not a string', wrap(`[{"name":7,"cells":[${okCell}]}]`)],
    ['cells missing', wrap('[{"name":"x"}]')],
    ['cells empty', wrap('[{"name":"x","cells":[]}]')],
    ['cells not an array', wrap('[{"name":"x","cells":{}}]')],
    ['dq string', wrap('[{"name":"x","cells":[{"dq":"1","dr":0,"t":"A"}]}]')],
    ['dq float', wrap('[{"name":"x","cells":[{"dq":1.5,"dr":0,"t":"A"}]}]')],
    ['dr missing', wrap('[{"name":"x","cells":[{"dq":1,"t":"A"}]}]')],
    ['t missing', wrap('[{"name":"x","cells":[{"dq":0,"dr":0}]}]')],
    ['t empty', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":""}]}]')],
    ['o not a string', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","o":5}]}]')],
    ['rd not an object', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","rd":"road"}]}]')],
    ['b not an integer', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","b":"1"}]}]')],
    ['z not an integer', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","z":1.5}]}]')],
    ['z 256 (Uint8 zone layer would wrap it to 0)', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","z":256}]}]')],
    ['z 300', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","z":300}]}]')],
    ['z negative', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","z":-1}]}]')],
    ['road carries col/row (would move on Save/Load)', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","rd":{"type":"road_hex","col":0,"row":0}}]}]')],
    ['road carries only row', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","rd":{"type":"road_hex","row":3}}]}]')],
    ['extras carry col/row', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","x":{"underTerrainId":"Water_1","col":0,"row":0}}]}]')],
    ['extras carry only col', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","x":{"col":2}}]}]')],
    ['road without a type', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","rd":{}}]}]')],
    ['road type not a string', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","rd":{"type":5}}]}]')],
    ['road type empty', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","rd":{"type":""}}]}]')],
    ['duplicate cell', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A"},{"dq":0,"dr":0,"t":"B"}]}]')],
    ['__proto__ on a cell', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","__proto__":{"polluted":1}}]}]')],
    ['__proto__ on a stamp', wrap(`[{"name":"x","__proto__":{"polluted":1},"cells":[${okCell}]}]`)],
    ['constructor in extras', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","x":{"a":{"constructor":{"prototype":{"polluted":1}}}}}]}]')],
    ['__proto__ in a road', wrap('[{"name":"x","cells":[{"dq":0,"dr":0,"t":"A","rd":{"__proto__":{"polluted":1}}}]}]')],
    ['one bad stamp after two good ones', wrap(`[{"name":"a","cells":[${okCell}]},{"name":"b","cells":[${okCell}]},{"name":"c","cells":[{"dq":0,"dr":0}]}]`)],
  ];
  for (const [title, text] of BAD) {
    test(`importJson rejects (${title}) and writes nothing`, async ({ page }) => {
      await freshEditor(page);
      const r = await page.evaluate(async (text) => {
        let err = '', sync = false, p: any;
        try { p = Stamps.importJson(text); } catch { sync = true; }
        try { await p; } catch (e: any) { err = e instanceof Error ? e.message : 'not an Error'; }
        return { err, sync, n: (await Stamps.list()).length, polluted: ({} as any).polluted };
      }, text);
      expect(r.sync).toBe(false);
      expect(r.err).toMatch(/^Invalid stamp file/);
      expect(r.n).toBe(0);
      expect(r.polluted).toBeUndefined();
    });
  }

  test('importJson rejects non-string input and oversize files', async ({ page }) => {
    await freshEditor(page);
    const r = await page.evaluate(async (okCell) => {
      const out: any = {};
      for (const [k, v] of [['number', 5], ['undefined', undefined], ['object', {}]] as any) {
        try { await Stamps.importJson(v); out[k] = 'resolved'; } catch (e: any) { out[k] = /Invalid stamp file/.test(e.message); }
      }
      const many = '{"format":"mapeditor-stamps","version":1,"stamps":[' + new Array(10001).fill('{"name":"s","cells":[' + okCell + ']}').join(',') + ']}';
      try { await Stamps.importJson(many); out.many = 'resolved'; } catch (e: any) { out.many = /Invalid stamp file.*too many/i.test(e.message); }
      let cells = '';
      for (let i = 0; i < 250001; i++) cells += (i ? ',' : '') + '{"dq":' + i + ',"dr":0,"t":"A"}';
      try { await Stamps.importJson('{"format":"mapeditor-stamps","version":1,"stamps":[{"name":"big","cells":[' + cells + ']}]}'); out.big = 'resolved'; } catch (e: any) { out.big = /Invalid stamp file.*too many cells/i.test(e.message); }
      out.n = (await Stamps.list()).length;
      return out;
    }, okCell);
    expect(r).toEqual({ number: true, undefined: true, object: true, many: true, big: true, n: 0 });
  });

  test('importJson at the limit is accepted (250000 cells, exact)', async ({ page }) => {
    await freshEditor(page);
    const r = await page.evaluate(async () => {
      let cells = '';
      for (let i = 0; i < 250000; i++) cells += (i ? ',' : '') + '{"dq":' + (i % 500) + ',"dr":' + Math.floor(i / 500) + ',"t":"A"}';
      const n = await Stamps.importJson('{"format":"mapeditor-stamps","version":1,"stamps":[{"name":"big","cells":[' + cells + ']}]}');
      return { n, len: (await Stamps.list())[0].cells.length };
    });
    expect(r).toEqual({ n: 1, len: 250000 });
  });

  test('importJson ignores unknown fields, keeps the rest, returns the count', async ({ page }) => {
    await freshEditor(page);
    const r = await page.evaluate(async () => {
      const text = JSON.stringify({ format: 'mapeditor-stamps', version: 1, extra: 1, stamps: [
        { name: 'one', extra: 'x', created: 5, v: 1, cells: [{ dq: 0, dr: 0, t: 'Forest_1', foo: 1, o: 'Grain_1', rd: { type: 'road_hex' }, b: 1, x: { underTerrainId: 'Water_1' }, z: 4, sat: true }] },
        { name: '  two  ', cells: [{ dq: 1, dr: -1, t: 'Plain_1' }] },
      ] });
      const n = await Stamps.importJson(text);
      return { n, list: await Stamps.list() };
    });
    expect(r.n).toBe(2);
    const one = r.list.find((s: any) => s.name === 'one');
    expect(one.v).toBe(1);
    expect(one.created).toBe(5);
    expect(one.cells).toEqual([{ dq: 0, dr: 0, t: 'Forest_1', o: 'Grain_1', rd: { type: 'road_hex' }, b: 1, x: { underTerrainId: 'Water_1' }, sat: true }]);   // z is validated but NOT stored: zone ids are map-local
    expect(r.list.map((s: any) => s.name).sort()).toEqual(['one', 'two']);
    expect(r.list.every((s: any) => /^s/.test(s.id))).toBe(true);
  });

  test('importJson is ONE transaction: a failure in the middle of the write leaves nothing', async ({ page }) => {
    await freshEditor(page);
    const r = await page.evaluate(async () => {
      await Stamps.list();                                   // open the connection first
      const orig = IDBObjectStore.prototype.add; let calls = 0;
      IDBObjectStore.prototype.add = function (...a: any[]) { if (++calls === 3) throw new DOMException('boom', 'DataError'); return orig.apply(this, a as any); };
      const cell = '{"dq":0,"dr":0,"t":"A"}';
      let err = '';
      try { await Stamps.importJson('{"format":"mapeditor-stamps","version":1,"stamps":[{"name":"a","cells":[' + cell + ']},{"name":"b","cells":[' + cell + ']},{"name":"c","cells":[' + cell + ']},{"name":"d","cells":[' + cell + ']}]}'); } catch (e: any) { err = e.message; }
      IDBObjectStore.prototype.add = orig;
      return { err, calls, n: (await Stamps.list()).length };
    });
    expect(r.calls).toBe(3);
    expect(r.err).not.toBe('');
    expect(r.n).toBe(0);
  });

  // ---------- save / list / remove -------------------------------------------------------------
  test('save validates the buffer, never throws synchronously, never stores a bad stamp', async ({ page }) => {
    await freshEditor(page);
    const r = await page.evaluate(async () => {
      const out: any[] = [];
      for (const b of [null, undefined, 5, {}, { cells: [] }, { cells: [{ dq: 'x', dr: 0, t: 'A' }] }, { cells: [{ dq: 0, dr: 0 }] }, { cells: 'no' }]) {
        let sync = false, p: any, err = '';
        try { p = Stamps.save('x', b); } catch { sync = true; }
        try { await p; } catch (e: any) { err = e instanceof Error ? e.message : '?'; }
        out.push([sync, /^Invalid stamp/.test(err)]);
      }
      return { out, n: (await Stamps.list()).length };
    });
    expect(r.out.every((o: any) => o[0] === false && o[1] === true)).toBe(true);
    expect(r.n).toBe(0);
  });

  test('names: trimmed, empty becomes "Stamp N", capped at 80, markup stored raw', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    const names = await page.evaluate(async () => {
      const buf = Clipboard.capture(Selection.getCells());
      const out: string[] = [];
      for (const n of ['  pond  ', '', '   ', undefined, 'x'.repeat(100), '<img src=x onerror=alert(1)>', 'é'.repeat(79) + '😀']) out.push((await Stamps.save(n as any, buf)).name);
      return out;
    });
    expect(names[0]).toBe('pond');
    expect(names[1]).toBe('Stamp 2');
    expect(names[2]).toBe('Stamp 3');
    expect(names[3]).toBe('Stamp 4');
    expect(names[4]).toBe('x'.repeat(80));
    expect(names[5]).toBe('<img src=x onerror=alert(1)>');
    expect(names[6]).toBe('é'.repeat(79));                   // an emoji cut in half is dropped, never a lone surrogate
    expect(await page.evaluate(() => document.querySelector('img[src="x"]'))).toBeNull();
  });

  test('two quick saves with the same name get distinct ids; list is newest first and deterministic with equal timestamps', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    const r = await page.evaluate(async () => {
      const buf = Clipboard.capture(Selection.getCells());
      const realNow = Date.now; Date.now = () => 1_700_000_000_000;       // every save sees the same millisecond
      const two = await Promise.all([Stamps.save('same', buf), Stamps.save('same', buf)]);
      const seq: string[] = [];
      for (const n of ['a', 'b', 'c']) seq.push((await Stamps.save(n, buf)).name);
      const more = await Promise.all(Array.from({ length: 40 }, () => Stamps.save('bulk', buf)));
      Date.now = realNow;
      const l1 = await Stamps.list(), l2 = await Stamps.list();
      const created = l1.map((s: any) => s.created);
      return { distinct: two[0].id !== two[1].id, ids: new Set([...two, ...more].map((s: any) => s.id)).size, total: l1.length, same: JSON.stringify(l1) === JSON.stringify(l2), sorted: created.every((c: number, i: number) => i === 0 || created[i - 1] >= c), strict: new Set(created).size === created.length };
    });
    expect(r.distinct).toBe(true);
    expect(r.ids).toBe(42);
    expect(r.total).toBe(45);
    expect(r.same).toBe(true);
    expect(r.sorted).toBe(true);
    expect(r.strict).toBe(true);
    // the sequential a, b, c saves come out c, b, a (newest first) even though the clock never moved
    const names = await page.evaluate(async () => (await Stamps.list()).map((s: any) => s.name));
    expect(names.filter((n: string) => n.length === 1)).toEqual(['c', 'b', 'a']);
  });

  test('list orders equal creation times by id (deterministic, identical every time)', async ({ page }) => {
    await freshEditor(page);
    const r = await page.evaluate(async () => {
      const cell = '{"dq":0,"dr":0,"t":"A"}';
      const st = ['a', 'b', 'c', 'd', 'e'].map(n => '{"name":"' + n + '","created":42,"cells":[' + cell + ']}');
      await Stamps.importJson('{"format":"mapeditor-stamps","version":1,"stamps":[' + st.join(',') + ']}');
      const l1 = (await Stamps.list()).map((s: any) => s.id), l2 = (await Stamps.list()).map((s: any) => s.id);
      return { l1, l2, desc: [...l1].sort().reverse() };
    });
    expect(r.l1).toEqual(r.desc);
    expect(r.l2).toEqual(r.l1);
  });

  test('ids do not collide even when the clock and Math.random are frozen', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    const r = await page.evaluate(async () => {
      const buf = Clipboard.capture(Selection.getCells());
      const rn = Math.random, dn = Date.now; Math.random = () => 0.5; Date.now = () => 1;
      const a = await Promise.all(Array.from({ length: 30 }, () => Stamps.save('x', buf)));
      Math.random = rn; Date.now = dn;
      return new Set(a.map((s: any) => s.id)).size;
    });
    expect(r).toBe(30);
  });

  test('remove deletes one stamp, unknown ids are a no-op, and the record is a deep copy', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    const r = await page.evaluate(async () => {
      const buf = Clipboard.capture(Selection.getCells());
      const a = await Stamps.save('a', buf), b = await Stamps.save('b', buf);
      buf.cells[0].t = 'MUTATED'; buf.cells[1].foo = 1;                 // the stored stamp is a copy, cleaned of unknown fields
      const sav = await Stamps.save('c', { cells: [{ dq: 0, dr: 0, t: 'Forest_1', foo: 'x' }] });
      const stored = (await Stamps.list()).find((s: any) => s.name === 'a');
      const tb = Stamps.toBuffer(stored); tb.cells[0].t = 'MUTATED2';     // so is every buffer
      const stored2 = (await Stamps.list()).find((s: any) => s.name === 'a');
      await Stamps.remove('nope');
      await Stamps.remove(a.id);
      return { ret: [a.cells[0].t, a.cells[1].t, 'foo' in a.cells[1], sav.cells[0].foo === undefined], t: [stored.cells[0].t, stored2.cells[0].t], names: (await Stamps.list()).map((s: any) => s.name), left: b.id };
    });
    expect(r.t).toEqual(['Forest_1', 'Forest_1']);
    expect(r.ret).toEqual(['Forest_1', 'Mountain_1', false, true]);
    expect(r.names).toEqual(['c', 'b']);
  });

  // ---------- buffers --------------------------------------------------------------------------
  test('toBuffer feeds Clipboard.place', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    await page.evaluate(async () => {
      const rec = await Stamps.save('p', Clipboard.capture(Selection.getCells()));
      Clipboard.place(Stamps.toBuffer(rec), { col: 225, row: 219 }, null, {});
    });
    expect(await page.evaluate(() => [mapData[219 * MAP_WIDTH + 225], mapData[219 * MAP_WIDTH + 226]])).toEqual(['Forest_1', 'Mountain_1']);
  });

  test('a rich buffer (every layer, multi-tile anchor and its footprint) round-trips through a reload and places identically', async ({ page }) => {
    await freshEditor(page);
    const orig = await seedRich(page);
    // preconditions: every layer really is in the capture
    const has = (k: string) => orig.cells.filter((c: any) => c[k] !== undefined).length;
    expect([has('o') >= 2, has('rd') >= 3, has('b'), has('x'), has('z') >= 3, has('sat')]).toEqual([true, true, 2, 1, true, 3]);
    expect(new Set(orig.cells.filter((c: any) => c.rd).map((c: any) => c.rd.type))).toEqual(new Set(['road_hex', 'road_alt']));
    await page.evaluate(async (b) => { await Stamps.save('rich', b); }, orig);
    await freshEditor(page);                                           // a brand-new page session: only IndexedDB survives
    const origHere = await seedRich(page);                             // a capture of THIS session's map (the first one belongs to a map that no longer exists)
    const got = await page.evaluate(async () => { const l = await Stamps.list(); return { n: l.length, buf: Stamps.toBuffer(l[0]) }; });
    expect(got.n).toBe(1);
    expect(got.buf.cells).toEqual(orig.cells.map((c: any) => { const { z, ...rest } = c; return rest; }));   // every layer and cell, except zones (map-local ids are not stored)
    expect(got.buf.v).toBe(1);
    for (const xf of [null, { rot: 1, mh: false, mv: false }, { rot: 2, mh: true, mv: false }, { rot: 4, mh: false, mv: true }]) {
      await seedRich(page);                                             // the restore inside placeBoth reassigns mapData, which clears the selection
      const r = await placeBoth(page, origHere, xf);
      expect(r.a).not.toBe(r.baseS);                                    // the placement did something
      expect(r.b).toBe(r.a);                                            // and the stamp does exactly the same (terrain, objects, roads, bridges, extras)
      expect(r.zoneA, 'the same-map capture does paste its zones').not.toBe(r.zoneBase);
      expect(r.zoneB, 'the stamp pastes no zone').toBe(r.zoneBase);
    }
  });

  test('a transformed paste drops the footprint cells of a stored multi-tile anchor exactly like the capture (carry rules survive)', async ({ page }) => {
    await freshEditor(page);
    const orig = await seedRich(page);
    await page.evaluate(async (b) => { await Stamps.save('rich', b); }, orig);
    const r = await page.evaluate(async (orig) => {
      const rec = (await Stamps.list())[0], buf = Stamps.toBuffer(rec), xf = { rot: 1, mh: false, mv: false }, t = { col: 300, row: 300 };
      const p1 = Clipboard.plan(orig, t, xf), p2 = Clipboard.plan(buf, t, xf);
      const key = (p: any) => JSON.stringify([p.map((i: any) => [i.col, i.row, i.e.t, i.e.sat === true]), p.carry.map((i: any) => [i.col, i.row]), p.dropped]);
      return { same: key(p1) === key(p2), carried: p2.carry.length, dropped: p2.dropped, sats: buf.cells.filter((c: any) => c.sat).length, planned: p2.length };
    }, orig);
    expect(r.same).toBe(true);
    expect(r.sats).toBe(3);
    expect(r.carried).toBeGreaterThan(0);                               // zones/roads of footprint cells travel
    expect(r.dropped).toBeGreaterThan(0);                               // objects on them are dropped and counted
  });

  // ---------- robustness -----------------------------------------------------------------------
  test('IndexedDB unavailable: rejected Errors, no synchronous throw, editor starts, recovers afterwards', async ({ page }) => {
    await page.addInitScript(() => {
      const open = IDBFactory.prototype.open;
      (window as any).__failStamps = true;
      IDBFactory.prototype.open = function (name: string, ...a: any[]) {
        if (name === 'MapEditorStamps' && (window as any).__failStamps) throw new DOMException('The operation is insecure.', 'SecurityError');
        return open.call(this, name, ...(a as [number]));
      };
    });
    await freshEditor(page);                                             // startup is unaffected
    expect(await page.evaluate(() => mapData.length)).toBe(450 * 450);
    await seedPond(page);
    const r = await page.evaluate(async () => {
      const out: any = {};
      const probe = async (k: string, f: () => any) => { let sync = false, p: any; try { p = f(); } catch { sync = true; } let e: any = null; try { await p; } catch (x) { e = x; } out[k] = [sync, e instanceof Error, e && /unavailable/i.test(e.message)]; };
      const buf = Clipboard.capture(Selection.getCells());
      await probe('list', () => Stamps.list());
      await probe('save', () => Stamps.save('x', buf));
      await probe('remove', () => Stamps.remove('x'));
      await probe('export', () => Stamps.exportJson());
      await probe('import', () => Stamps.importJson('{"format":"mapeditor-stamps","version":1,"stamps":[{"name":"a","cells":[{"dq":0,"dr":0,"t":"A"}]}]}'));
      (window as any).__failStamps = false;                            // the browser lets us in again
      await Stamps.save('later', buf);
      out.later = (await Stamps.list()).map((s: any) => s.name);
      return out;
    });
    for (const k of ['list', 'save', 'remove', 'export', 'import']) expect(r[k]).toEqual([false, true, true]);
    expect(r.later).toEqual(['later']);
  });

  test('IndexedDB open that fails asynchronously or is blocked rejects with a clear Error', async ({ page }) => {
    await freshEditor(page);
    // the Stamps panel opens its connection at startup (T2.13): drop it (versionchange closes it) so this test sees a cold open
    await page.evaluate(() => new Promise(res => { const q = indexedDB.deleteDatabase('MapEditorStamps'); q.onsuccess = q.onerror = q.onblocked = res; }));
    const r = await page.evaluate(async () => {
      const open = IDBFactory.prototype.open; const out: string[] = [];
      for (const mode of ['error', 'blocked']) {
        IDBFactory.prototype.open = function (name: string, ...a: any[]) {
          if (name !== 'MapEditorStamps') return open.call(this, name, ...(a as [number]));
          const req: any = {};
          setTimeout(() => { if (mode === 'error') { req.error = new DOMException('denied', 'UnknownError'); req.onerror?.({ target: req }); } else req.onblocked?.({}); }, 0);
          return req;
        };
        try { await Stamps.list(); out.push('resolved'); } catch (e: any) { out.push(e instanceof Error && /unavailable/i.test(e.message) ? 'ok' : 'bad:' + e.message); }
      }
      IDBFactory.prototype.open = open;
      out.push(String((await Stamps.list()).length));
      return out;
    });
    expect(r).toEqual(['ok', 'ok', '0']);
  });

  test('a full disk (QuotaExceededError) rejects with a "full" Error and stores nothing', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    const r = await page.evaluate(async () => {
      await Stamps.list();
      const orig = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function () { throw new DOMException('quota', 'QuotaExceededError'); };
      let err = ''; try { await Stamps.save('q', Clipboard.capture(Selection.getCells())); } catch (e: any) { err = e.message; }
      IDBObjectStore.prototype.add = orig;
      return { err, n: (await Stamps.list()).length };
    });
    expect(r.err).toMatch(/full/i);
    expect(r.n).toBe(0);
  });

  test('a closed connection is reopened transparently', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    const r = await page.evaluate(async () => {
      await Stamps.save('a', Clipboard.capture(Selection.getCells()));
      const orig = IDBDatabase.prototype.transaction; let thrown = 0, calls = 0;
      IDBDatabase.prototype.transaction = function (...a: any[]) { if (calls++ === 0) { thrown++; throw new DOMException('closing', 'InvalidStateError'); } return orig.apply(this, a as any); };
      const names = (await Stamps.list()).map((s: any) => s.name);
      IDBDatabase.prototype.transaction = orig;
      return { names, thrown, calls };
    });
    expect(r).toEqual({ names: ['a'], thrown: 1, calls: 2 });
  });

  // ---------- thumbnails -----------------------------------------------------------------------
  test('thumbnail is a PNG data URL, deterministic, cached per id+size', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    const r = await page.evaluate(async () => {
      const rec = await Stamps.save('t', Clipboard.capture(Selection.getCells()));
      const realCreate = document.createElement.bind(document); let canvases = 0;
      document.createElement = ((tag: string, o?: any) => { if (String(tag).toLowerCase() === 'canvas') canvases++; return realCreate(tag, o); }) as any;
      const a = Stamps.thumbnail(rec), b = Stamps.thumbnail(rec), c = Stamps.thumbnail(rec, 64), c2 = Stamps.thumbnail(rec, 64);
      const afterCached = canvases;
      const noId = { name: 'n', cells: rec.cells };                       // unsaved: not cached, still deterministic
      const d = Stamps.thumbnail(noId), e = Stamps.thumbnail(noId);
      document.createElement = realCreate;
      await Stamps.remove(rec.id);
      let fresh = 0; const rc2 = document.createElement.bind(document);
      document.createElement = ((tag: string, o?: any) => { if (String(tag).toLowerCase() === 'canvas') fresh++; return rc2(tag, o); }) as any;
      const f = Stamps.thumbnail(rec);                                     // after remove the cache entry is gone: a fresh render, same pixels
      document.createElement = rc2;
      const big = Stamps.thumbnail(rec, 100000), tiny = Stamps.thumbnail(rec, -5), junk = Stamps.thumbnail(rec, NaN);
      const img = (u: string) => new Promise<number[]>(res => { const i = new Image(); i.onload = () => res([i.width, i.height]); i.src = u; });
      return { png: a.startsWith('data:image/png;base64,'), same: a === b, sized: c === c2 && c !== a, twoRenders: afterCached, dEq: d === e && d === a, f: f === a, fresh, dims: [await img(a), await img(c), await img(big), await img(tiny), await img(junk)] };
    });
    expect(r.png).toBe(true);
    expect(r.same).toBe(true);
    expect(r.sized).toBe(true);
    expect(r.twoRenders).toBe(2);                                          // 48 and 64, each rendered once
    expect(r.dEq).toBe(true);
    expect(r.f).toBe(true);
    expect(r.fresh).toBe(1);                                               // remove really invalidated: the canvas was rebuilt
    expect(r.dims[0]).toEqual([48, 48]);
    expect(r.dims[1]).toEqual([64, 64]);
    expect(r.dims[2][0]).toBeLessThanOrEqual(512);
    expect(r.dims[3][0]).toBeGreaterThanOrEqual(8);
    expect(r.dims[4]).toEqual([48, 48]);
  });

  // ---------- layer values must survive paste AND map save/load ---------------------------------
  test('save rejects the same corrupting buffers and accepts the boundary values (z 255 validated but not stored, real road/extras)', async ({ page }) => {
    await freshEditor(page);
    const r = await page.evaluate(async () => {
      const mk = (extra: any) => ({ v: 1, origin: null, cells: [Object.assign({ dq: 0, dr: 0, t: 'A' }, extra)] });
      const out: any = {};
      for (const [k, extra] of [['z256', { z: 256 }], ['rdcol', { rd: { type: 'road_hex', col: 0, row: 0 } }], ['xrow', { x: { row: 1 } }], ['notype', { rd: {} }]] as any) {
        try { await Stamps.save('bad', mk(extra)); out[k] = 'saved'; } catch (e: any) { out[k] = /^Invalid stamp/.test(e.message); }
      }
      const ok = await Stamps.save('ok', mk({ z: 255, rd: { type: 'road_alt', extra: 1 }, x: { underTerrainId: 'Water_1', tag: 7 } }));
      out.n = (await Stamps.list()).length; out.okZ = ok.cells[0].z === undefined ? 'not stored' : ok.cells[0].z;
      return out;
    });
    expect(r).toEqual({ z256: true, rdcol: true, xrow: true, notype: true, n: 1, okZ: 'not stored' });
  });

  test('import accepts the boundary values a real capture can hold (z 255 is ignored, a plain road_hex is kept unchanged)', async ({ page }) => {
    await freshEditor(page);
    const r = await page.evaluate(async () => {
      const text = '{"format":"mapeditor-stamps","version":1,"stamps":[{"name":"s","cells":[{"dq":0,"dr":0,"t":"Plain_1","z":255,"rd":{"type":"road_hex"}}]}]}';
      await Stamps.importJson(text);
      const rec = (await Stamps.list())[0];
      return { z: rec.cells[0].z === undefined ? 'not stored' : rec.cells[0].z, rd: rec.cells[0].rd };
    });
    expect(r).toEqual({ z: 'not stored', rd: { type: 'road_hex' } });
  });

  // ---------- created / ids / thumbnails (fix round 1) --------------------------------------------
  test('an imported future `created` is clamped to now so it cannot pin a stamp to the top', async ({ page }) => {
    await freshEditor(page);
    const r = await page.evaluate(async () => {
      const cell = '{"dq":0,"dr":0,"t":"A"}';
      const before = Date.now();
      await Stamps.importJson('{"format":"mapeditor-stamps","version":1,"stamps":[{"name":"future","created":8000000000000000,"cells":[' + cell + ']},{"name":"past","created":5,"cells":[' + cell + ']}]}');
      const l = await Stamps.list();
      const fut = l.find((s: any) => s.name === 'future'), past = l.find((s: any) => s.name === 'past');
      await Stamps.save('later', { v: 1, origin: null, cells: [{ dq: 0, dr: 0, t: 'A' }] });
      return { futureClamped: fut.created >= before && fut.created <= Date.now() + 1, past: past.created, top: (await Stamps.list())[0].name };
    });
    expect(r).toEqual({ futureClamped: true, past: 5, top: 'later' });
  });

  test('ids sort lexically in creation order across the base-36 counter rollover (36 -> 10 digits)', async ({ page }) => {
    await freshEditor(page);
    const r = await page.evaluate(async () => {
      const cell = '{"dq":0,"dr":0,"t":"A"}';
      const names = Array.from({ length: 80 }, (_, i) => 'n' + String(i).padStart(2, '0'));
      await Stamps.importJson('{"format":"mapeditor-stamps","version":1,"stamps":[' + names.map(n => '{"name":"' + n + '","created":42,"cells":[' + cell + ']}').join(',') + ']}');
      return (await Stamps.list()).map((s: any) => s.name);
    });
    // equal `created`: the newest id (= last imported) comes first, for every stamp including those after id counter 35
    expect(r).toEqual(Array.from({ length: 80 }, (_, i) => 'n' + String(79 - i).padStart(2, '0')));
  });

  test('a database deleted or upgraded elsewhere (versionchange) is not blocked and the next call reopens', async ({ page }) => {
    await freshEditor(page);
    const r = await page.evaluate(async () => {
      const buf = { v: 1, origin: null, cells: [{ dq: 0, dr: 0, t: 'A' }] };
      await Stamps.save('before', buf);
      let blocked = false;
      await new Promise<void>((res, rej) => {
        const q = indexedDB.deleteDatabase('MapEditorStamps');
        q.onblocked = () => { blocked = true; };
        q.onsuccess = () => res(); q.onerror = () => rej(q.error);
      });
      const afterDelete = (await Stamps.list()).length;
      await Stamps.save('after', buf);
      return { blocked, afterDelete, names: (await Stamps.list()).map((s: any) => s.name) };
    });
    expect(r).toEqual({ blocked: false, afterDelete: 0, names: ['after'] });
  });

  test('thumbnail work is bounded for huge stamps and exact for small ones', async ({ page }) => {
    await freshEditor(page);
    const r = await page.evaluate(() => {
      const proto = CanvasRenderingContext2D.prototype as any, orig = proto.beginPath; let paths = 0;
      proto.beginPath = function () { paths++; return orig.apply(this, arguments as any); };
      const mk = (n: number) => ({ id: 'h' + n, cells: Array.from({ length: n }, (_, i) => ({ dq: i % 500, dr: Math.floor(i / 500), t: 'Forest_1' })) });
      const out: any = {};
      try {
        Stamps.thumbnail(mk(40), 48); out.small = paths; paths = 0;
        const edge = mk(2 * 48 * 48); Stamps.thumbnail(edge, 48); out.edge = paths; paths = 0;   // exactly 2 cells per pixel: still drawn in full
        const url = Stamps.thumbnail(mk(250000), 48); out.huge = paths; out.png = url.startsWith('data:image/png;base64,'); paths = 0;
      } finally { proto.beginPath = orig; }
      return out;
    });
    expect(r.small).toBe(40);
    expect(r.edge).toBe(2 * 48 * 48);
    expect(r.png).toBe(true);
    expect(r.huge).toBeGreaterThan(0);
    expect(r.huge).toBeLessThanOrEqual(48 * 48);
  });

  test('thumbnail pixels match the independent hexCenterWorld geometry (colours at known offsets)', async ({ page }) => {
    await freshEditor(page);
    // three cells of different colours: Terrain.color table values (literals, not read back from the code under test)
    const cells = [{ col: 225, row: 224, t: 'Forest_1', rgb: [50, 115, 50] }, { col: 226, row: 224, t: 'Mountain_1', rgb: [150, 150, 150] }, { col: 225, row: 226, t: 'Desert_1', rgb: [210, 185, 120] }];
    const r = await page.evaluate(async (cells) => {
      for (const c of cells) mapData[c.row * MAP_WIDTH + c.col] = c.t;
      Selection.setCells(cells.map(c => ({ col: c.col, row: c.row })));
      const rec = await Stamps.save('geo', Clipboard.capture(Selection.getCells()));
      const SIZE = 96, url = Stamps.thumbnail(rec, SIZE);
      const img: HTMLImageElement = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = url; });
      const cv = document.createElement('canvas'); cv.width = cv.height = SIZE; const cx = cv.getContext('2d')!; cx.drawImage(img, 0, 0);
      const w = cells.map(c => Canvas.hexCenterWorld(c.col, c.row));
      const minX = Math.min(...w.map(p => p.x)), maxX = Math.max(...w.map(p => p.x)), minY = Math.min(...w.map(p => p.y)), maxY = Math.max(...w.map(p => p.y));
      const bw = maxX - minX + 2 * HEX_SIZE, bh = maxY - minY + ROW_PITCH, sc = SIZE / Math.max(bw, bh);
      const ox = (SIZE - bw * sc) / 2, oy = (SIZE - bh * sc) / 2;
      const px = (p: any, dx = 0, dy = 0) => Array.from(cx.getImageData(Math.round(ox + (p.x - minX + HEX_SIZE) * sc + dx), Math.round(oy + (p.y - minY + ROW_PITCH / 2) * sc + dy), 1, 1).data);
      return { centres: w.map(p => px(p)), corner: Array.from(cx.getImageData(0, 0, 1, 1).data), sc, off: w.map(p => px(p, 0, 0.45 * ROW_PITCH * sc)) };
    }, cells);
    cells.forEach((c, i) => expect(r.centres[i]).toEqual([...c.rgb, 255]));
    expect(r.corner[3]).toBe(0);                                         // outside every hex: transparent
    expect(r.off.map((p: number[]) => p[3])).toEqual([255, 255, 255]);   // just inside the hex edge still painted
    expect(r.sc).toBeGreaterThan(0.3);                                   // the picture really is large enough to probe
  });
});

// ───────────────────────── T2.13: the Stamps panel ─────────────────────────
const toasts = (page: Page) => page.locator('#toast-container .toast').allTextContents();
const lastToast = async (page: Page) => { const t = await toasts(page); return t[t.length - 1] || ''; };
const names = (page: Page) => page.evaluate(async () => (await Stamps.list()).map((s: any) => s.name));
async function saveNamed(page: Page, name: string) {
  await page.fill('#stamp-name', name);
  await page.click('#stamp-save-btn');
  await expect(page.locator('#stamp-name')).toHaveValue('');
}
/** Imports `n` one-cell stamps named s0..s{n-1} (created ascending, so sN-1 is the newest) through the store. */
async function importMany(page: Page, n: number) {
  await page.evaluate(async n => {
    const stamps = Array.from({ length: n }, (_, i) => ({ name: 's' + i, created: 1000 + i, v: 1, cells: [{ dq: 0, dr: 0, t: 'Forest_1' }] }));
    await Stamps.importJson(JSON.stringify({ format: 'mapeditor-stamps', version: 1, stamps }));
    await Stamps.refresh();
  }, n);
}

test.describe('stamps panel (T2.13)', () => {
  test('save the selection, place it with a click, delete it (cancel keeps it, only that stamp goes)', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await seedPond(page);
    await saveNamed(page, '  pond  ');
    await expect(page.locator('.stamp-row')).toHaveCount(1);
    await expect(page.locator('.stamp-row')).toContainText('pond');
    expect(await names(page)).toEqual(['pond']);                       // trimmed
    await page.click('.stamp-row .stamp-name');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paste');
    const before = await page.evaluate(() => mapData.slice());
    await clickCell(page, 225, 219);
    const diff = await page.evaluate(b => { const o: any[] = []; for (let i = 0; i < mapData.length; i++) if (mapData[i] !== b[i]) o.push({ col: i % MAP_WIDTH, row: Math.floor(i / MAP_WIDTH), t: mapData[i] }); return o; }, before);
    expect(diff.map((d: any) => d.t).sort()).toEqual(['Forest_1', 'Mountain_1']);
    const cubes = await page.evaluate(d => d.map((c: any) => HexUtils.toCube(c.col, c.row, MAP_WIDTH, MAP_HEIGHT)), diff);
    expect(Math.max(Math.abs(cubes[0].q - cubes[1].q), Math.abs(cubes[0].r - cubes[1].r), Math.abs(cubes[0].s - cubes[1].s))).toBe(1);   // still adjacent
    expect(Math.abs(diff[0].row - 219) + Math.abs(diff[1].row - 219)).toBeLessThanOrEqual(2);                                               // landed at the click
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => Tools.getActive())).not.toBe('paste');
    // second stamp; deleting one removes only that one; cancel keeps it
    await seedPond(page);
    await saveNamed(page, 'second');
    await expect(page.locator('.stamp-row')).toHaveCount(2);
    await expect(page.locator('.stamp-row').first()).toContainText('second');   // newest first
    await page.locator('.stamp-row').first().locator('.stamp-del').click();
    await expect(page.locator('#dialog-modal')).toHaveClass(/open/);
    await page.locator('#dialog-actions button[data-value="cancel"]').click();
    await expect(page.locator('.stamp-row')).toHaveCount(2);
    expect(await names(page)).toEqual(['second', 'pond']);
    await page.locator('.stamp-row').first().locator('.stamp-del').click();
    await page.locator('#dialog-actions button[data-value="ok"]').click();
    await expect(page.locator('.stamp-row')).toHaveCount(1);
    await expect(page.locator('.stamp-row')).toContainText('pond');
    expect(await names(page)).toEqual(['pond']);
    await page.locator('.stamp-row .stamp-del').click();
    await page.locator('#dialog-actions button[data-value="ok"]').click();
    await expect(page.locator('.stamp-row')).toHaveCount(0);
    await expect(page.locator('#stamp-list')).toContainText('No stamps yet');
  });

  test('the panel lives in the left palette, adds nothing to the toolbar and keeps the canvas size (1491x808 at 1400x900)', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const r = await page.evaluate(() => {
      const c = document.getElementById('map-canvas') as HTMLCanvasElement;
      const p = document.getElementById('stamp-panel')!, lp = document.getElementById('palette-panel')!.getBoundingClientRect(), b = p.getBoundingClientRect();
      return { cw: c.width, ch: c.height, inLeft: !!p.closest('#palette-panel'), inRight: !!p.closest('#right-panel'), inToolbar: !!p.closest('#map-tools, #map-io, header'),
               fits: b.left >= lp.left - 0.5 && b.right <= lp.right + 0.5, paletteW: Math.round(lp.width), cols: getComputedStyle(document.getElementById('main')!).gridTemplateColumns.split(' ').length };
    });
    expect(r).toEqual({ cw: 1491, ch: 808, inLeft: true, inRight: false, inToolbar: false, fits: true, paletteW: 220, cols: 3 });
  });

  // The app has a fixed ~1931 px layout: the RIGHT panel is off screen below that width (pre-existing; owner decision for
  // minimap / brush / active terrain). The Stamps panel is in the left palette, which is always on screen.
  for (const [w, h] of [[1400, 900], [1100, 700]]) {
    test(`usable at ${w}x${h}: the panel and its save button are inside the window (palette scrolled to it) and a row takes a real mouse click`, async ({ page }) => {
      await freshEditor(page); await openSection(page, 'stamps');
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await importMany(page, 12);
      await expect(page.locator('.stamp-row')).toHaveCount(12);
      // Only the palette and the list are scrolled (like a user with a wheel): scrollIntoView would also shift the
      // overflow:hidden app containers, which is exactly what hides an off-screen panel from a real user.
      const geo = (sel: string) => page.evaluate(s => {
        const b = document.querySelector(s)!.getBoundingClientRect();
        return { ok: b.width > 0 && b.height > 0 && b.left >= 0 && b.top >= 0 && b.right <= window.innerWidth && b.bottom <= window.innerHeight, x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }, sel);
      await page.evaluate(() => { const pp = document.getElementById('palette-panel')!; pp.scrollTop = pp.scrollHeight; });
      expect((await geo('#stamp-save-btn')).ok).toBe(true);
      expect((await geo('#stamp-name')).ok).toBe(true);
      await page.evaluate(() => { const l = document.getElementById('stamp-list')!; l.scrollTop = l.scrollHeight; });
      const g = await geo('.stamp-row:last-child .stamp-name');       // oldest: s0, reached through the list scroll
      expect(g.ok).toBe(true);
      await page.mouse.click(g.x, g.y);                                // a real mouse click at its on-screen position
      expect(await page.evaluate(() => Tools.getActive())).toBe('paste');
      expect(await page.evaluate(() => ['main', 'app'].map(id => { const e = document.getElementById(id)!; return e.scrollLeft + e.scrollTop; }).concat([document.documentElement.scrollLeft, document.documentElement.scrollTop, document.body.scrollLeft, document.body.scrollTop]))).toEqual([0, 0, 0, 0, 0, 0]);
      // the terrain palette stays reachable and the page itself does not scroll
      const o = await page.evaluate(() => ({ ps: document.getElementById('palette-scroll')!.clientHeight, sx: window.scrollX, sy: window.scrollY, pw: document.getElementById('palette-panel')!.getBoundingClientRect().width, cw: (document.getElementById('map-canvas') as HTMLCanvasElement).width }));
      expect(o.ps).toBeGreaterThanOrEqual(100);
      expect([o.sx, o.sy, o.pw, o.cw]).toEqual([0, 0, 220, 1491]);
    });
  }

  test('after a mouse click on a stamp row the button does not keep focus: Space still pans, rotation and the paste session survive', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await seedPond(page);
    await saveNamed(page, 'pond');
    await page.click('.stamp-row .stamp-name');
    expect(await page.evaluate(() => document.activeElement && (document.activeElement as HTMLElement).className)).not.toBe('stamp-place');
    await page.keyboard.press('Period');
    expect(await page.evaluate(() => Tools.getFloatTransform()!.rot)).toBe(1);
    await page.evaluate(() => { (window as any).__bp = 0; const o = Tools.beginPaste; Tools.beginPaste = (b: any) => { (window as any).__bp++; return o(b); }; });
    await page.keyboard.down('Space'); await page.keyboard.up('Space');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => ({ rot: Tools.getFloatTransform()!.rot, bp: (window as any).__bp, mv: Tools.isMoving() }))).toEqual({ rot: 1, bp: 0, mv: false });
    // Space + drag pans the camera
    const cam0 = await page.evaluate(() => Canvas.getCamera());
    const box = (await page.locator('#map-canvas').boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.keyboard.down('Space');
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y + 40, { steps: 4 }); await page.mouse.up();
    await page.keyboard.up('Space');
    const cam1 = await page.evaluate(() => Canvas.getCamera());
    expect(Math.abs(cam1.x - cam0.x) + Math.abs(cam1.y - cam0.y)).toBeGreaterThan(20);
    // keyboard activation still works and fires once
    await page.keyboard.press('Escape');
    await page.locator('.stamp-row .stamp-place').focus();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => ({ t: Tools.getActive(), bp: (window as any).__bp }))).toEqual({ t: 'paste', bp: 1 });
  });

  test('names render as text only (markup, 80 characters) and never run script or widen the panel', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await seedPond(page);
    const evil = '<img src=x onerror="window.__xss=1"><b>bold</b>';
    await saveNamed(page, evil);
    const long80 = 'W'.repeat(80);
    await saveNamed(page, long80 + 'IGNORED');
    await expect(page.locator('.stamp-row')).toHaveCount(2);
    const r = await page.evaluate(() => {
      const l = document.getElementById('stamp-list')!;
      return { xss: (window as any).__xss, imgsWithSrcX: l.querySelectorAll('img[src="x"]').length, bold: l.querySelectorAll('b').length, texts: Array.from(l.querySelectorAll('.stamp-name')).map(e => e.textContent), hOverflow: l.scrollWidth > l.clientWidth };
    });
    expect(r.xss).toBeUndefined();
    expect(r.imgsWithSrcX).toBe(0);
    expect(r.bold).toBe(0);
    expect(r.texts).toEqual([long80, evil]);
    expect(r.hOverflow).toBe(false);
    expect((await names(page))).toEqual([long80, evil]);                   // stored: 80 characters, newest first
    // delete confirm shows the name as text too
    await page.locator('.stamp-row').last().locator('.stamp-del').click();
    expect(await page.evaluate(() => ({ msg: document.getElementById('dialog-msg')!.textContent, imgs: document.querySelectorAll('#dialog-modal img').length }))).toEqual({ msg: expect.stringContaining(evil), imgs: 0 });
    await page.locator('#dialog-actions button[data-value="cancel"]').click();
  });

  test('save refuses with a clear toast: empty selection, stale map (selection dropped), a running fill', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await page.fill('#stamp-name', 'keepme');
    await page.click('#stamp-save-btn');
    expect(await lastToast(page)).toMatch(/select a region/i);
    expect(await names(page)).toEqual([]);
    await expect(page.locator('#stamp-name')).toHaveValue('keepme');           // refused: the typed name stays
    await seedPond(page);
    await page.evaluate(() => IO.newMap(true));                                  // map replaced: the selection is gone
    await page.click('#stamp-save-btn');
    expect(await names(page)).toEqual([]);
    expect(await lastToast(page)).toMatch(/select a region/i);
    // fill busy: save and place are both refused
    await seedPond(page);
    await saveNamed(page, 'base');
    await page.evaluate(() => { Selection.setCells([{ col: 225, row: 224 }]); UI.selectTerrain('Forest_1'); });
    const r = await page.evaluate(async () => {
      const p = Tools.fill(225, 225);
      const busy = Tools.isFillBusy();
      (document.getElementById('stamp-name') as HTMLInputElement).value = 'during';
      (document.getElementById('stamp-save-btn') as HTMLElement).click();
      (document.querySelector('.stamp-row .stamp-name') as HTMLElement).click();
      const out = { busy, active: Tools.getActive(), toast: Array.from(document.querySelectorAll('#toast-container .toast')).map(t => t.textContent), name: (document.getElementById('stamp-name') as HTMLInputElement).value };
      await p;
      return out;
    });
    expect(r.busy).toBe(true);
    expect(r.active).not.toBe('paste');
    expect(r.name).toBe('during');
    expect(r.toast.join('|')).toMatch(/fill/i);
    expect(await names(page)).toEqual(['base']);
  });

  test('storage failure shows the error in a toast, keeps the typed name, and a later save works', async ({ page }) => {
    await page.addInitScript(() => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name: string, ...a: any[]) { if (name === 'MapEditorStamps' && (window as any).__stampFail) throw new Error('boom: blocked'); return (open as any).call(this, name, ...a); };
      (window as any).__stampFail = true;
    });
    await freshEditor(page); await openSection(page, 'stamps');
    await expect(page.locator('#stamp-list')).toContainText(/unavailable/i);
    await seedPond(page);
    await page.fill('#stamp-name', 'typed');
    await page.click('#stamp-save-btn');
    await expect.poll(() => lastToast(page)).toMatch(/unavailable.*boom/i);
    await expect(page.locator('#stamp-name')).toHaveValue('typed');
    await page.evaluate(() => { (window as any).__stampFail = false; });
    await page.click('#stamp-save-btn');
    await expect(page.locator('.stamp-row')).toHaveCount(1);
    await expect(page.locator('#stamp-name')).toHaveValue('');
  });

  test('typing a name never triggers a shortcut; Enter saves once and does not lift the selection', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await seedPond(page);
    await page.locator('#stamp-name').focus();
    await page.keyboard.type('Spare maps');
    await page.keyboard.press('Backspace'); await page.keyboard.press('Delete'); await page.keyboard.type('s');
    for (const k of ['BracketLeft', 'BracketRight', 'Comma', 'Period', 'Slash', 'Semicolon']) await page.keyboard.press(k);
    await page.keyboard.press('Escape');
    const mid = await page.evaluate(() => ({ tool: Tools.getActive(), sel: Selection.size(), v: (document.getElementById('stamp-name') as HTMLInputElement).value, forest: mapData[224 * MAP_WIDTH + 225], brush: Brush.getSize(), sym: Tools.getSymmetry() }));
    expect(mid.tool).toBe('paint');
    expect(mid.sel).toBe(2);                                                   // Delete/Backspace/Esc did not touch the selection
    expect(mid.forest).toBe('Forest_1');
    expect(mid.brush).toBe(0);
    expect(mid.sym).toBe('none');
    // the field shows exactly what was typed (Backspace removed the s, Delete at the end is a no-op, then s, then the punctuation keys typed their characters)
    expect(mid.v).toBe('Spare maps[],./;');
    // Enter inside the field saves and does not lift
    await page.locator('#stamp-name').fill('via enter');
    await page.keyboard.press('Enter');
    await expect(page.locator('.stamp-row')).toHaveCount(1);
    const after = await page.evaluate(() => ({ moving: Tools.isMoving(), pasting: Tools.isPasting(), tool: Tools.getActive(), sel: Selection.size() }));
    expect(after).toEqual({ moving: false, pasting: false, tool: 'paint', sel: 2 });
    expect(await names(page)).toEqual(['via enter']);
    // two Enters in the same task save once (double-submit guard)
    const saves = await page.evaluate(() => {
      let n = 0; const o = Clipboard.capture; Clipboard.capture = (c: any) => { n++; return o(c); };   // one capture per accepted save
      const i = document.getElementById('stamp-name') as HTMLInputElement; i.value = 'dup'; i.focus();
      for (let k = 0; k < 2; k++) i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      const r = n; setTimeout(() => { Clipboard.capture = o; }, 0); return r;     // counted synchronously: the second Enter hit the guard
    });
    expect(saves).toBe(1);
    await expect(page.locator('.stamp-row')).toHaveCount(2);
    expect(await names(page)).toEqual(['dup', 'via enter']);
  });

  test('a focused row place button starts the paste with Enter or Space (no lift, no pan), Esc cancels', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await seedPond(page);
    await saveNamed(page, 'pond');
    await page.locator('.stamp-row .stamp-place').focus();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => ({ t: Tools.getActive(), mv: Tools.isMoving() }))).toEqual({ t: 'paste', mv: false });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await page.locator('.stamp-row .stamp-place').focus();
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => ({ t: Tools.getActive(), mv: Tools.isMoving() }))).toEqual({ t: 'paste', mv: false });
    // labels and tooltips for assistive tech
    const a = await page.evaluate(() => ({ tags: ['stamp-save-btn', 'stamp-export-btn', 'stamp-import-btn'].map(id => document.getElementById(id)!.tagName), label: document.getElementById('stamp-name')!.getAttribute('aria-label'), del: document.querySelector('.stamp-del')!.getAttribute('aria-label') }));
    expect(a.tags).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    expect(a.label).toBeTruthy();
    expect(a.del).toMatch(/delete/i);
  });

  test('a row refuses while a move is lifted and the buffer is built once per paste session', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await seedPond(page);
    await saveNamed(page, 'pond');
    const r = await page.evaluate(() => {
      let calls = 0; const orig = Stamps.toBuffer; Stamps.toBuffer = (rec: any) => { calls++; return orig(rec); };
      const row = () => document.querySelector('.stamp-row .stamp-name') as HTMLElement;
      Tools.beginMove();
      row().click();
      const lifted = { moving: Tools.isMoving(), calls };
      Tools.cancelFloat();
      row().click(); const b1 = calls; row().click(); const b2 = calls;     // second click while still pasting the same stamp: same buffer
      Tools.setActive('paint');
      row().click();                                                         // a later session of the same stamp reuses it too
      Stamps.toBuffer = orig;
      return { lifted, b1, b2, b3: calls };
    });
    expect(r.lifted).toEqual({ moving: true, calls: 0 });
    expect([r.b1, r.b2, r.b3]).toEqual([1, 1, 1]);   // one deep copy per stamp: the same buffer keeps its geometry cache
  });

  const spyToasts = (page: Page) => page.evaluate(() => { (window as any).__t = []; const o = UI.toast; UI.toast = (m: any, ...a: any[]) => { (window as any).__t.push(String(m)); return o.call(UI, m, ...a); }; });
  const spied = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__t.slice());
  const NOT_LOADED = /not loaded/;

  test('pasting a stamp with ids that are not loaded toasts the count and still pastes', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await spyToasts(page);
    await page.evaluate(async () => {
      await Stamps.importJson(JSON.stringify({ format: 'mapeditor-stamps', version: 1, stamps: [{ name: 'alien', cells: [{ dq: 0, dr: 0, t: 'Forest_1' }, { dq: 1, dr: 0, t: 'NoSuchPkg_Tile' }, { dq: 0, dr: 1, t: 'Other_Missing' }] }] }));
      await Stamps.refresh();
    });
    await page.click('.stamp-row .stamp-name');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paste');
    expect(await spied(page)).toContain('2 cells use tiles that are not loaded');
    await page.click('.stamp-row .stamp-name');                                // same session: no second warning
    expect((await spied(page)).filter(t => NOT_LOADED.test(t)).length).toBe(1);
    await seedPond(page);
    await saveNamed(page, 'fine');
    await page.locator('.stamp-row').first().locator('.stamp-name').click();
    expect((await spied(page)).filter(t => NOT_LOADED.test(t)).length).toBe(1);   // a stamp whose ids are all loaded stays quiet
  });

  test('the unknown-tile warning returns when a Ctrl+V clipboard paste replaced the stamp float (same stamp id, different buffer)', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await spyToasts(page);
    await page.evaluate(async () => {
      await Stamps.importJson(JSON.stringify({ format: 'mapeditor-stamps', version: 1, stamps: [{ name: 'alien', cells: [{ dq: 0, dr: 0, t: 'Forest_1' }, { dq: 1, dr: 0, t: 'NoSuchPkg_Tile' }] }] }));
      await Stamps.refresh();
    });
    await page.click('.stamp-row .stamp-name');
    expect((await spied(page)).filter(t => NOT_LOADED.test(t)).length).toBe(1);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => Tools.isPasting())).toBe(false);
    await seedPond(page);
    await page.evaluate(() => Tools.copySelection());
    await page.keyboard.press('Control+v');                                   // a clipboard paste (not the stamp) floats now
    expect(await page.evaluate(() => Tools.isPasting())).toBe(true);
    await page.click('.stamp-row .stamp-name');                               // the stamp floats again: warn again
    expect((await spied(page)).filter(t => NOT_LOADED.test(t)).length).toBe(2);
    await page.click('.stamp-row .stamp-name');                               // same float buffer: quiet
    expect((await spied(page)).filter(t => NOT_LOADED.test(t)).length).toBe(2);
  });

  test('export downloads stamps-YYYY-MM-DD.json holding exactly the stored stamps; empty library toasts', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await page.click('#stamp-export-btn');
    await expect.poll(() => toasts(page)).toContain('No stamps to export');
    await seedPond(page);
    await saveNamed(page, 'pond');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#stamp-export-btn')]);
    const today = await page.evaluate(() => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); });
    expect(dl.suggestedFilename()).toBe(`stamps-${today}.json`);
    const text = fs.readFileSync(await dl.path(), 'utf8');
    const j = JSON.parse(text);
    expect([j.format, j.version, j.stamps.length, j.stamps[0].name, j.stamps[0].cells.length]).toEqual(['mapeditor-stamps', 1, 1, 'pond', 2]);
  });

  test('import: a valid file adds stamps and a count toast, the same file again works (input reset), bad files add nothing', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await seedPond(page);
    await saveNamed(page, 'pond');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#stamp-export-btn')]);
    const file = await dl.path();
    await page.setInputFiles('#stamp-import-file', file);
    await expect(page.locator('.stamp-row')).toHaveCount(2);
    expect(await toasts(page)).toContain('Imported 1 stamp');
    expect(await page.evaluate(() => (document.getElementById('stamp-import-file') as HTMLInputElement).value)).toBe('');
    await page.setInputFiles('#stamp-import-file', file);                      // the very same file again
    await expect(page.locator('.stamp-row')).toHaveCount(3);
    // a broken file: error message toast, nothing changes
    await page.setInputFiles('#stamp-import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"nope"}') });
    await expect.poll(() => lastToast(page)).toMatch(/Invalid stamp file/);
    // one bad stamp among good ones: nothing is imported
    const mixed = { format: 'mapeditor-stamps', version: 1, stamps: [{ name: 'ok', cells: [{ dq: 0, dr: 0, t: 'Forest_1' }] }, { name: 'bad', cells: [{ dq: 0, dr: 0, t: 'Forest_1', z: 999 }] }] };
    await page.setInputFiles('#stamp-import-file', { name: 'mixed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(mixed)) });
    await expect.poll(() => lastToast(page)).toMatch(/Invalid stamp file/);
    await expect(page.locator('.stamp-row')).toHaveCount(3);
    expect((await names(page)).length).toBe(3);
  });

  test('more than 100 stamps: a page of rows with Show more, newest first, thumbnails only for rows near the viewport', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await page.evaluate(() => { (window as any).__thumbCanvases = 0; const o = HTMLCanvasElement.prototype.toDataURL; HTMLCanvasElement.prototype.toDataURL = function (...a: any[]) { (window as any).__thumbCanvases++; return (o as any).apply(this, a); }; });
    await importMany(page, 250);
    await expect(page.locator('.stamp-row')).toHaveCount(100);
    await expect(page.locator('.stamp-row .stamp-name').first()).toContainText('s249');
    await expect(page.locator('#stamp-more')).toContainText('150');
    await expect.poll(() => page.evaluate(() => (window as any).__thumbCanvases)).toBeGreaterThan(0);   // thumbnails arrive via the observer
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));   // two frames: the visible batch is done (ticks, not wall clock)
    const made = await page.evaluate(() => (window as any).__thumbCanvases);
    expect(made).toBeGreaterThan(0);
    expect(made).toBeLessThan(40);                                              // only the visible part of the list got a thumbnail
    await page.click('#stamp-more');
    await expect(page.locator('.stamp-row')).toHaveCount(200);
    await page.click('#stamp-more');
    await expect(page.locator('.stamp-row')).toHaveCount(250);
    await expect(page.locator('#stamp-more')).toHaveCount(0);
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));   // two frames for the observer to settle
    expect(await page.evaluate(() => (window as any).__thumbCanvases)).toBeLessThan(80);
    // scrolling reveals more thumbnails lazily
    const before = await page.evaluate(() => (window as any).__thumbCanvases);
    await page.evaluate(() => { const l = document.getElementById('stamp-list')!; l.scrollTop = l.scrollHeight; });
    await expect.poll(() => page.evaluate(() => (window as any).__thumbCanvases)).toBeGreaterThan(before);
  });

  test('stamps survive a real reload and the panel shows them without any click', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await seedPond(page);
    await saveNamed(page, 'persisted');
    await page.reload();
    await page.waitForFunction(() => typeof Stamps !== 'undefined' && HexDB.getAll().length > 0);
    await expect(page.locator('.stamp-row')).toHaveCount(1);
    await expect(page.locator('.stamp-row')).toContainText('persisted');
    await page.locator('.stamp-row .stamp-name').click();
    expect(await page.evaluate(() => Tools.getActive())).toBe('paste');
  });

  test('the panel never touches the map: saving, importing and deleting leave map data, history and autosave alone', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await seedPond(page);
    const snap = () => page.evaluate(() => ({ same: (window as any).__m === undefined ? ((window as any).__m = mapData.join('|'), true) : (window as any).__m === mapData.join('|'), u: History.undoSize(), sel: Selection.size() }));
    const a = await snap();
    await page.evaluate(() => { (window as any).__as = 0; const o = IO.scheduleAutoSave; IO.scheduleAutoSave = (...a: any[]) => { (window as any).__as++; return o.apply(IO, a); }; });
    await saveNamed(page, 'x');
    await importMany(page, 2);
    await page.locator('.stamp-row').first().locator('.stamp-del').click();
    await page.locator('#dialog-actions button[data-value="ok"]').click();
    await expect(page.locator('.stamp-row')).toHaveCount(2);
    expect(await snap()).toEqual(a);
    expect(await page.evaluate(() => (window as any).__as)).toBe(0);
  });

  test('Esc in the name field blurs it (shortcuts work again) and keeps the typed text', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await page.locator('#stamp-name').focus();
    await page.keyboard.type('abc');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => ({ tag: document.activeElement && document.activeElement.tagName, v: (document.getElementById('stamp-name') as HTMLInputElement).value }))).toEqual({ tag: 'BODY', v: 'abc' });
    await page.keyboard.press('KeyM');
    expect(await page.evaluate(() => Tools.getActive())).toBe('marquee');
  });

  test('a selection above the store limit is refused before it is captured (same message, name kept)', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await spyToasts(page);
    await seedPond(page);
    await page.fill('#stamp-name', 'huge');
    const r = await page.evaluate(async () => {
      let captures = 0; const oc = Clipboard.capture; Clipboard.capture = (c: any) => { captures++; return oc(c); };
      const os = Selection.size; Selection.size = () => 250001;
      await Stamps.saveSelection();
      Selection.size = os; Clipboard.capture = oc;
      return captures;
    });
    expect(r).toBe(0);
    expect((await spied(page)).some(t => /too many cells.*250000/.test(t))).toBe(true);
    await expect(page.locator('#stamp-name')).toHaveValue('huge');
    expect(await names(page)).toEqual([]);
  });

  test('export reads the library once', async ({ page }) => {
    await freshEditor(page); await openSection(page, 'stamps');
    await seedPond(page);
    await saveNamed(page, 'one');
    const reads = await page.evaluate(async () => {
      let n = 0; const o = IDBObjectStore.prototype.getAll; IDBObjectStore.prototype.getAll = function (...a: any[]) { n++; return (o as any).apply(this, a); };
      const oc = URL.createObjectURL; URL.createObjectURL = () => 'blob:x';
      HTMLAnchorElement.prototype.click = function () {};
      await Stamps.exportFile();
      IDBObjectStore.prototype.getAll = o; URL.createObjectURL = oc;
      return n;
    });
    expect(reads).toBe(1);
  });
});

test.describe('stamps panel startup isolation (T2.13 fix round 1)', () => {
  test('a throwing Stamps.initPanel (IntersectionObserver throws) does not take down the later startup steps', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).IntersectionObserver = function () { throw new Error('io boom'); };
      // record every toast text from the very start (the failure toast fires during startup, before any test code runs)
      (window as any).__startupToasts = [];
      new MutationObserver(ms => { for (const m of ms) m.addedNodes.forEach((n: any) => { if (n.classList && n.classList.contains('toast')) (window as any).__startupToasts.push(n.textContent); }); })
        .observe(document, { childList: true, subtree: true });
    });
    await freshEditor(page);
    // the failure is reported with its real message (and the editor says so rather than failing silently)
    await expect.poll(() => page.evaluate(() => (window as any).__startupToasts)).toContain('Stamps panel failed to start: io boom');
    expect(await page.evaluate(() => HexDB.getAll().length)).toBeGreaterThan(0);          // HexDB init (a later startup step) ran
    await page.keyboard.press('KeyM');                                    // IO.initKeyboard / Tools shortcuts are alive
    expect(await page.evaluate(() => Tools.getActive())).toBe('marquee');
    await page.keyboard.press('Control+a');
    expect(await page.evaluate(() => Selection.size())).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.getElementById('brush-size-label')!.textContent)).toMatch(/Radius/);
    // a History shortcut still works: paint one cell, Ctrl+Z restores it
    await page.evaluate(() => { Selection.clear(); UI.selectTerrain('Water_1'); Tools.setActive('paint'); });
    const p = await cellPoint(page, 225, 224);
    await page.mouse.click(p.x, p.y);
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 225])).toBe('Water_1');
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 225])).toBe('Plain_1');
  });
});
