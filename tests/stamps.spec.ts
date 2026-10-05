import { test, expect, Page } from '@playwright/test';
import { freshEditor } from './editor-helpers';

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
    const snap = () => JSON.stringify({ m: mapData.join('|'), o: objectsData, r: roadsData, b: bridgesData, x: tileExtras, z: Array.from(ZonePainter.getZoneLayer()).join('') });
    const zl = ZonePainter.getZoneLayer();
    const base = { m: mapData.slice(), o: JSON.parse(JSON.stringify(objectsData)), r: JSON.parse(JSON.stringify(roadsData)), b: JSON.parse(JSON.stringify(bridgesData)), x: JSON.parse(JSON.stringify(tileExtras)), z: zl.slice() };
    const restore = () => { mapData = base.m.slice(); objectsData = JSON.parse(JSON.stringify(base.o)); roadsData = JSON.parse(JSON.stringify(base.r)); bridgesData = JSON.parse(JSON.stringify(base.b)); tileExtras = JSON.parse(JSON.stringify(base.x)); zl.set(base.z); invalidateSatelliteMap(); };
    const target = { col: 300, row: 300 };
    return Stamps.list().then((l: any[]) => {
      const baseS = snap();
      Clipboard.place(orig, target, xf, {});
      const a = snap(); restore();
      if (snap() !== baseS) throw new Error('restore failed');
      Clipboard.place(Stamps.toBuffer(l[0]), target, xf, {});
      const b = snap();
      return { a, b, baseS };
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
    expect(one.cells).toEqual([{ dq: 0, dr: 0, t: 'Forest_1', o: 'Grain_1', rd: { type: 'road_hex' }, b: 1, x: { underTerrainId: 'Water_1' }, z: 4, sat: true }]);
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

  test('list orders equal creation times by id, newest id first, identically every time', async ({ page }) => {
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
      buf.cells[0].t = 'MUTATED';                                       // the stored stamp is a copy
      const stored = (await Stamps.list()).find((s: any) => s.name === 'a');
      const tb = Stamps.toBuffer(stored); tb.cells[0].t = 'MUTATED2';     // so is every buffer
      const stored2 = (await Stamps.list()).find((s: any) => s.name === 'a');
      await Stamps.remove('nope');
      await Stamps.remove(a.id);
      return { t: [stored.cells[0].t, stored2.cells[0].t], names: (await Stamps.list()).map((s: any) => s.name), left: b.id };
    });
    expect(r.t).toEqual(['Forest_1', 'Forest_1']);
    expect(r.names).toEqual(['b']);
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
    await seedRich(page);
    const got = await page.evaluate(async () => { const l = await Stamps.list(); return { n: l.length, buf: Stamps.toBuffer(l[0]) }; });
    expect(got.n).toBe(1);
    expect(got.buf.cells).toEqual(orig.cells);                          // deep equality on every layer and every cell
    expect(got.buf.v).toBe(1);
    for (const xf of [null, { rot: 1, mh: false, mv: false }, { rot: 2, mh: true, mv: false }, { rot: 4, mh: false, mv: true }]) {
      const r = await placeBoth(page, orig, xf);
      expect(r.a).not.toBe(r.baseS);                                    // the placement did something
      expect(r.b).toBe(r.a);                                            // and the stamp does exactly the same
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
      const orig = IDBDatabase.prototype.transaction; let thrown = 0;
      IDBDatabase.prototype.transaction = function (...a: any[]) { if (thrown++ === 0) throw new DOMException('closing', 'InvalidStateError'); return orig.apply(this, a as any); };
      const names = (await Stamps.list()).map((s: any) => s.name);
      IDBDatabase.prototype.transaction = orig;
      return { names, thrown };
    });
    expect(r).toEqual({ names: ['a'], thrown: 1 });
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
      const f = Stamps.thumbnail(rec);                                     // after remove the cache entry is gone: a fresh render, same pixels
      const big = Stamps.thumbnail(rec, 100000), tiny = Stamps.thumbnail(rec, -5), junk = Stamps.thumbnail(rec, NaN);
      const img = (u: string) => new Promise<number[]>(res => { const i = new Image(); i.onload = () => res([i.width, i.height]); i.src = u; });
      return { png: a.startsWith('data:image/png;base64,'), same: a === b, sized: c === c2 && c !== a, twoRenders: afterCached, dEq: d === e && d === a, f: f === a, dims: [await img(a), await img(c), await img(big), await img(tiny), await img(junk)] };
    });
    expect(r.png).toBe(true);
    expect(r.same).toBe(true);
    expect(r.sized).toBe(true);
    expect(r.twoRenders).toBe(2);                                          // 48 and 64, each rendered once
    expect(r.dEq).toBe(true);
    expect(r.f).toBe(true);
    expect(r.dims[0]).toEqual([48, 48]);
    expect(r.dims[1]).toEqual([64, 64]);
    expect(r.dims[2][0]).toBeLessThanOrEqual(512);
    expect(r.dims[3][0]).toBeGreaterThanOrEqual(8);
    expect(r.dims[4]).toEqual([48, 48]);
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
