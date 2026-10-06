import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openEditor } from './helpers';

test('hex-utils.js is DOM-free and does not use the legacy _DIRS tables', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'hex-utils.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const bad of [/\bdocument\b/, /\bwindow\b/, /_DIRS_/, /\bCanvas\b/, /MAP_WIDTH/]) expect(src).not.toMatch(bad);
});

test.describe('HexUtils geometry', () => {
  test.beforeEach(async ({ page }) => { await openEditor(page); });

  test('toCube/fromCube round-trip on even, odd and non-square maps', async ({ page }) => {
    const bad = await page.evaluate(() => {
      let bad = 0;
      for (const [W, H] of [[450, 450], [11, 11], [12, 10], [13, 12], [9, 9]]) {
        for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
          const f = HexUtils.fromCube(HexUtils.toCube(c, r, W, H), W, H);
          if (f.col !== c || f.row !== r) bad++;
        }
      }
      return bad;
    });
    expect(bad).toBe(0);
  });

  test('neighbours, rotation and mirrors agree with Canvas.hexCenterWorld pixels', async ({ page }) => {
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      const save = [MAP_WIDTH, MAP_HEIGHT];
      for (const [W, H] of [[450, 450], [451, 451], [12, 10]]) {
        MAP_WIDTH = W; MAP_HEIGHT = H;
        const c0 = Math.floor(W / 2), r0 = Math.floor(H / 2);
        const a = HexUtils.toCube(c0, r0, W, H);
        const pa = Canvas.hexCenterWorld(c0, r0);
        const rel = (c: any) => {
          const p = HexUtils.fromCube(c, W, H);
          const w = Canvas.hexCenterWorld(p.col, p.row);
          return { x: w.x - pa.x, y: w.y - pa.y };
        };
        const add = (d: any) => ({ q: a.q + d.q, r: a.r + d.r, s: a.s + d.s });
        const cs = Math.cos(Math.PI / 3), sn = Math.sin(Math.PI / 3);
        for (const d of HexUtils.CUBE_DIRS) {
          const p = rel(add(d));
          if (Math.abs(Math.hypot(p.x, p.y) - ROW_PITCH) > 1e-6) out.push(`pitch ${W}x${H}`);
          const rp = rel(add(HexUtils.rotateCube(d, 1)));   // screen y points down, so this matrix is clockwise
          if (Math.hypot(rp.x - (p.x * cs - p.y * sn), rp.y - (p.x * sn + p.y * cs)) > 1e-6) out.push(`rotate ${W}x${H}`);
          const mh = rel(add(HexUtils.mirrorCube(d, 'h')));
          if (Math.hypot(mh.x + p.x, mh.y - p.y) > 1e-6) out.push(`mirrorH ${W}x${H}`);
          const mv = rel(add(HexUtils.mirrorCube(d, 'v')));
          if (Math.hypot(mv.x - p.x, mv.y + p.y) > 1e-6) out.push(`mirrorV ${W}x${H}`);
        }
      }
      MAP_WIDTH = save[0]; MAP_HEIGHT = save[1];
      return out;
    });
    expect(problems).toEqual([]);
  });

  test('neighbours, rotation and mirrors agree with pixel geometry at random odd and even q-parity centres', async ({ page }) => {
    const r = await page.evaluate(() => {
      let seed = 777;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const out: string[] = [];
      const parities = new Set<string>();
      const save = [MAP_WIDTH, MAP_HEIGHT];
      const cs = Math.cos(Math.PI / 3), sn = Math.sin(Math.PI / 3);
      for (const [W, H] of [[451, 451], [13, 12]]) {
        MAP_WIDTH = W; MAP_HEIGHT = H;
        for (let i = 0; i < 60; i++) {
          const c0 = 2 + Math.floor(rnd() * (W - 4)), r0 = 2 + Math.floor(rnd() * (H - 4));
          const a = HexUtils.toCube(c0, r0, W, H);
          parities.add(W + 'x' + H + ':q' + (((a.q % 2) + 2) % 2));
          const pa = Canvas.hexCenterWorld(c0, r0);
          const rel = (c: any) => { const p = HexUtils.fromCube(c, W, H); const w = Canvas.hexCenterWorld(p.col, p.row); return { x: w.x - pa.x, y: w.y - pa.y }; };
          const add = (d: any) => ({ q: a.q + d.q, r: a.r + d.r, s: a.s + d.s });
          for (const d of HexUtils.CUBE_DIRS) {
            const p = rel(add(d));
            if (Math.abs(Math.hypot(p.x, p.y) - ROW_PITCH) > 1e-6) out.push(`pitch ${W}x${H} ${c0},${r0}`);
            const rp = rel(add(HexUtils.rotateCube(d, 1)));
            if (Math.hypot(rp.x - (p.x * cs - p.y * sn), rp.y - (p.x * sn + p.y * cs)) > 1e-6) out.push(`rotate ${W}x${H} ${c0},${r0}`);
            const mh = rel(add(HexUtils.mirrorCube(d, 'h')));
            if (Math.hypot(mh.x + p.x, mh.y - p.y) > 1e-6) out.push(`mirrorH ${W}x${H} ${c0},${r0}`);
            const mv = rel(add(HexUtils.mirrorCube(d, 'v')));
            if (Math.hypot(mv.x - p.x, mv.y + p.y) > 1e-6) out.push(`mirrorV ${W}x${H} ${c0},${r0}`);
          }
        }
      }
      MAP_WIDTH = save[0]; MAP_HEIGHT = save[1];
      return { out: [...new Set(out)], parities: [...parities].sort() };
    });
    expect(r.out).toEqual([]);
    // positive control: both parities of q were really exercised on both maps
    expect(r.parities).toEqual(['13x12:q0', '13x12:q1', '451x451:q0', '451x451:q1']);
  });

  test('corner disc counts are exact and equal the pixel-distance reference', async ({ page }) => {
    const r = await page.evaluate(() => {
      const save = [MAP_WIDTH, MAP_HEIGHT];
      const res: any = {};
      for (const [W, H] of [[450, 450], [451, 451]]) {
        MAP_WIDTH = W; MAP_HEIGHT = H;
        for (const [c, rw] of [[0, 0], [W - 1, H - 1], [0, H - 1], [W - 1, 0]]) {
          const p0 = Canvas.hexCenterWorld(c, rw);
          let ref = 0;
          for (let dc = -2; dc <= 2; dc++) for (let dr = -2; dr <= 2; dr++) {
            const cc = c + dc, rr = rw + dr;
            if (cc < 0 || cc >= W || rr < 0 || rr >= H) continue;
            const p = Canvas.hexCenterWorld(cc, rr);
            if (Math.hypot(p.x - p0.x, p.y - p0.y) <= 2 * ROW_PITCH + 1e-6) ref++;
          }
          res[`${W}x${H}@${c},${rw}`] = { got: HexUtils.discCells(c, rw, 2, W, H).length, ref };
        }
      }
      MAP_WIDTH = save[0]; MAP_HEIGHT = save[1];
      return res;
    });
    for (const k of Object.keys(r)) expect(r[k].got, k).toBe(r[k].ref);
    // pinned literals for the four corners of the default map (the independent reference above agrees)
    expect([r['450x450@0,0'].got, r['450x450@449,449'].got, r['450x450@0,449'].got, r['450x450@449,0'].got]).toEqual([7, 7, 8, 8]);
  });

  test('integer contract: integer inputs give integer, non -0 outputs', async ({ page }) => {
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      const isInt = (v: number) => Number.isInteger(v) && !Object.is(v, -0);
      for (const [W, H] of [[450, 450], [13, 12]]) {
        for (const [c, r] of [[0, 0], [W >> 1, H >> 1], [W - 1, H - 1], [3, H - 2]]) {
          const cu = HexUtils.toCube(c, r, W, H);
          if (![cu.q, cu.r, cu.s].every(isInt)) out.push('toCube ' + [W, H, c, r]);
          const f = HexUtils.fromCube(cu, W, H);
          if (!isInt(f.col) || !isInt(f.row)) out.push('fromCube ' + [W, H, c, r]);
          const lists = [HexUtils.discCells(c, r, 3, W, H), HexUtils.ringCells(c, r, 3, W, H), HexUtils.neighbors(c, r, W, H),
            HexUtils.lineCells({ col: c, row: r }, { col: W >> 1, row: H >> 1 }, W, H)];
          for (const l of lists) for (const t of l) if (!isInt(t.col) || !isInt(t.row)) out.push('cells ' + [W, H, c, r]);
          for (let k = -6; k <= 6; k++) {
            const t = HexUtils.rotateCube(cu, k);
            if (![t.q, t.r, t.s].every(isInt)) out.push('rotate ' + k);
          }
          for (const ax of ['h', 'v']) { const t = HexUtils.mirrorCube(cu, ax); if (![t.q, t.r, t.s].every(isInt)) out.push('mirror ' + ax); }
        }
      }
      return [...new Set(out)];
    });
    expect(bad).toEqual([]);
  });

  test('line, disc, ring sizes and clipping at the map corner', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = 450, H = 450;
      const a = { col: 200, row: 200 }, b = { col: 212, row: 190 };
      const line = HexUtils.lineCells(a, b, W, H);
      const ca = HexUtils.toCube(a.col, a.row, W, H), cb = HexUtils.toCube(b.col, b.row, W, H);
      let gaps = 0;
      for (let i = 1; i < line.length; i++) {
        const d = HexUtils.cubeDistance(HexUtils.toCube(line[i - 1].col, line[i - 1].row, W, H), HexUtils.toCube(line[i].col, line[i].row, W, H));
        if (d !== 1) gaps++;
      }
      return {
        lineLen: line.length, want: HexUtils.cubeDistance(ca, cb) + 1, gaps,
        first: line[0], last: line[line.length - 1],
        disc: [0, 1, 2, 3].map(n => HexUtils.discCells(200, 200, n, W, H).length),
        ring: [0, 1, 2, 5].map(n => HexUtils.ringCells(200, 200, n, W, H).length),
        corner: HexUtils.discCells(0, 0, 2, W, H).length,
        nb: HexUtils.neighbors(200, 200, W, H).length,
      };
    });
    expect(r.lineLen).toBe(r.want);
    expect(r.gaps).toBe(0);
    expect(r.first).toEqual({ col: 200, row: 200 });
    expect(r.last).toEqual({ col: 212, row: 190 });
    expect(r.disc).toEqual([1, 7, 19, 37]);
    expect(r.ring).toEqual([1, 6, 12, 30]);
    expect(r.corner).toBeLessThan(19);
    expect(r.nb).toBe(6);
  });

  test('seeded property checks: rotation, mirror, line, disc/ring, clipping, pixel agreement at both parities', async ({ page }) => {
    const r = await page.evaluate(() => {
      let seed = 12345;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const ri = (n: number) => Math.floor(rnd() * n);
      const eq = (a: any, b: any) => a.q === b.q && a.r === b.r && a.s === b.s;
      const fail: string[] = [];
      const W = 450, H = 450;
      const save = [MAP_WIDTH, MAP_HEIGHT]; MAP_WIDTH = W; MAP_HEIGHT = H;
      for (let i = 0; i < 300; i++) {
        const c0 = 20 + ri(410), r0 = 20 + ri(410);
        const a = HexUtils.toCube(c0, r0, W, H);
        const d = { q: ri(15) - 7, r: 0, s: 0 }; d.r = ri(15) - 7; d.s = -d.q - d.r;
        const k = ri(13) - 6;
        if (!eq(HexUtils.rotateCube(d, 6), d)) fail.push('rot6');
        if (!eq(HexUtils.rotateCube(HexUtils.rotateCube(d, k), -k), d)) fail.push('rot-inv');
        if (!eq(HexUtils.rotateCube(d, 2), HexUtils.rotateCube(HexUtils.rotateCube(d, 1), 1))) fail.push('rot-compose');
        for (const ax of ['h', 'v']) if (!eq(HexUtils.mirrorCube(HexUtils.mirrorCube(d, ax), ax), d)) fail.push('mirror2' + ax);
        const o = { q: 0, r: 0, s: 0 };
        if (HexUtils.cubeDistance(o, HexUtils.rotateCube(d, k)) !== HexUtils.cubeDistance(o, d)) fail.push('rot-dist');
        if (HexUtils.cubeDistance(o, HexUtils.mirrorCube(d, 'h')) !== HexUtils.cubeDistance(o, d)) fail.push('mir-dist');
        // pixel agreement of rotate by k about a random centre (covers both q parities)
        const pa = Canvas.hexCenterWorld(c0, r0);
        const pix = (cube: any) => { const p = HexUtils.fromCube(cube, W, H); const w = Canvas.hexCenterWorld(p.col, p.row); return { x: w.x - pa.x, y: w.y - pa.y }; };
        const add = (x: any) => ({ q: a.q + x.q, r: a.r + x.r, s: a.s + x.s });
        const p0 = pix(add(d)), p1 = pix(add(HexUtils.rotateCube(d, k)));
        const ang = k * Math.PI / 3, cs = Math.cos(ang), sn = Math.sin(ang);
        if (Math.hypot(p1.x - (p0.x * cs - p0.y * sn), p1.y - (p0.x * sn + p0.y * cs)) > 1e-6) fail.push('rot-pix');
        // line
        const b = HexUtils.toCube(20 + ri(410), 20 + ri(410), W, H);
        const line = HexUtils.cubeLine(a, b);
        if (!eq(line[0], a) || !eq(line[line.length - 1], b) || line.length !== HexUtils.cubeDistance(a, b) + 1) fail.push('line-ends');
        for (let j = 1; j < line.length; j++) if (HexUtils.cubeDistance(line[j - 1], line[j]) !== 1) fail.push('line-adj');
        const n = ri(6);
        if (HexUtils.cubeDisc(a, n).length !== 3 * n * (n + 1) + 1) fail.push('disc');
        if (HexUtils.cubeRing(a, n).length !== (n === 0 ? 1 : 6 * n)) fail.push('ring');
        for (const rc of HexUtils.cubeRing(a, n)) if (HexUtils.cubeDistance(a, rc) !== n) fail.push('ring-dist');
      }
      MAP_WIDTH = save[0]; MAP_HEIGHT = save[1];
      // cellsFromCubes clips and dedups
      const cells = HexUtils.cellsFromCubes([HexUtils.toCube(0, 0, 9, 9), HexUtils.toCube(0, 0, 9, 9), HexUtils.toCube(-1, 0, 9, 9), HexUtils.toCube(9, 3, 9, 9), HexUtils.toCube(4, 4, 9, 9)], 9, 9);
      return { fail: [...new Set(fail)], cells };
    });
    expect(r.fail).toEqual([]);
    expect(r.cells).toEqual([{ col: 0, row: 0 }, { col: 4, row: 4 }]);
  });

  // Known issue K1: the legacy direction tables contain two non-adjacent offsets per parity.
  // Un-fixme this once the owner approves changing road/river/coastline adjacency.
  test.fixme('legacy _DIRS tables point at true neighbours (K1)', async ({ page }) => {
    const bad = await page.evaluate(() => {
      let n = 0;
      for (const row of [224, 225]) {
        const p0 = Canvas.hexCenterWorld(225, row);
        const dirs = (MAP_HEIGHT - 1 - row) % 2 !== 0 ? _DIRS_EVEN : _DIRS_ODD;
        for (const [dc, dr] of Object.values(dirs) as number[][]) {
          const p = Canvas.hexCenterWorld(225 + dc, row + dr);
          if (Math.abs(Math.hypot(p.x - p0.x, p.y - p0.y) - ROW_PITCH) > 1e-6) n++;
        }
      }
      return n;
    });
    expect(bad).toBe(0);
  });
});

test('discCells/ringCells fast path matches the deduplicating reference (in and out of bounds)', async ({ page }) => {
  await openEditor(page);
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    for (const [W, H] of [[450, 450], [451, 451], [13, 9], [9, 13]])
      for (const [c, r, R] of [[0, 0, 4], [W - 1, H - 1, 6], [W >> 1, H >> 1, 5], [3, H - 2, 9], [W >> 1, H >> 1, 0]]) {
        const cube = HexUtils.toCube(c, r, W, H);
        const k = (a: any[]) => a.map(t => t.col + ',' + t.row).sort().join('|');
        if (k(HexUtils.discCells(c, r, R, W, H)) !== k(HexUtils.cellsFromCubes(HexUtils.cubeDisc(cube, R), W, H))) out.push('disc' + [W, H, c, r, R]);
        if (k(HexUtils.ringCells(c, r, R, W, H)) !== k(HexUtils.cellsFromCubes(HexUtils.cubeRing(cube, R), W, H))) out.push('ring' + [W, H, c, r, R]);
        const ordered = (a: any[]) => a.map(t => t.col + ',' + t.row).join('|');   // walk order, unsorted
        if (ordered(HexUtils.ringCells(c, r, R, W, H)) !== ordered(HexUtils.cellsFromCubes(HexUtils.cubeRing(cube, R), W, H))) out.push('ringorder' + [W, H, c, r, R]);
      }
    return out;
  });
  expect(bad).toEqual([]);
});

test.describe('HexUtils shapes (T2.4)', () => {
  test.beforeEach(async ({ page }) => { await openEditor(page); });

  test('polygonCells: hexagon corners give a filled 37-cell disc, outline gives the 18-cell ring', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = 450, H = 450;
      const a = HexUtils.toCube(225, 224, W, H);
      const ring = HexUtils.cubeRing(a, 3);
      const corners = [0, 3, 6, 9, 12, 15].map(i => ring[i]);
      return {
        filled: HexUtils.polygonCells(corners, W, H, true).length,
        outline: HexUtils.polygonCells(corners, W, H, false).length,
      };
    });
    expect(r.filled).toBe(37);
    expect(r.outline).toBe(18);
  });

  // Independent reference: true cell-centre pixels from Canvas.hexCenterWorld.
  for (const [W, H] of [[450, 450], [451, 451], [450, 451], [451, 450]]) {
    test(`lineCells vs pixel geometry on ${W}x${H}`, async ({ page }) => {
      const r = await page.evaluate(([W, H]) => {
        const oW = MAP_WIDTH, oH = MAP_HEIGHT; MAP_WIDTH = W; MAP_HEIGHT = H;
        try {
          const bad: string[] = [];
          const pairs = [[{ col: 100, row: 100 }, { col: 140, row: 190 }], [{ col: 150, row: 90 }, { col: 150, row: 200 }],
                         [{ col: 120, row: 101 }, { col: 60, row: 130 }], [{ col: 90, row: 90 }, { col: 90, row: 90 }],
                         [{ col: 200, row: 200 }, { col: 201, row: 200 }], [{ col: 80, row: 160 }, { col: 160, row: 100 }]];
          for (const [a, b] of pairs) {
            const cells = HexUtils.lineCells(a, b, W, H);
            const P = (c: any) => Canvas.hexCenterWorld(c.col, c.row);
            const pa = P(a), pb = P(b);
            const dist = HexUtils.cubeDistance(HexUtils.toCube(a.col, a.row, W, H), HexUtils.toCube(b.col, b.row, W, H));
            if (cells.length !== dist + 1) bad.push('len');
            if (cells[0].col !== a.col || cells[0].row !== a.row) bad.push('start');
            const e = cells[cells.length - 1]; if (e.col !== b.col || e.row !== b.row) bad.push('end');
            for (let i = 1; i < cells.length; i++) {
              const p = P(cells[i - 1]), q = P(cells[i]);
              if (Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - ROW_PITCH) > 0.01) bad.push('adjacent@' + i);
            }
            const L2 = (pb.x - pa.x) ** 2 + (pb.y - pa.y) ** 2;
            for (const c of cells) {
              const p = P(c);
              const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - pa.x) * (pb.x - pa.x) + (p.y - pa.y) * (pb.y - pa.y)) / L2));
              const d = Math.hypot(p.x - (pa.x + t * (pb.x - pa.x)), p.y - (pa.y + t * (pb.y - pa.y)));
              if (d > HEX_SIZE + 0.01) bad.push('far');
            }
          }
          return bad;
        } finally { MAP_WIDTH = oW; MAP_HEIGHT = oH; }
      }, [W, H]);
      expect(r).toEqual([]);
    });

    test(`polygonCells fill vs pixel-centre point-in-polygon on ${W}x${H} (concave + convex)`, async ({ page }) => {
      const r = await page.evaluate(([W, H]) => {
        const oW = MAP_WIDTH, oH = MAP_HEIGHT; MAP_WIDTH = W; MAP_HEIGHT = H;
        try {
          const res: any = {};
          const shapes: any = {
            convex: [[100, 100], [100, 140], [130, 160], [160, 140], [150, 100]],
            concave: [[100, 100], [100, 150], [140, 120], [180, 150], [180, 100], [140, 80]],   // arrow / notch
          };
          for (const name of Object.keys(shapes)) {
            const verts = shapes[name].map(([c, r]: number[]) => ({ col: c, row: r }));
            const cubes = verts.map((v: any) => HexUtils.toCube(v.col, v.row, W, H));
            const got = new Set(HexUtils.polygonCells(cubes, W, H, true).map((c: any) => c.col + ',' + c.row));
            const outline = new Set(HexUtils.polygonCells(cubes, W, H, false).map((c: any) => c.col + ',' + c.row));
            const poly = verts.map((v: any) => Canvas.hexCenterWorld(v.col, v.row));
            const inside = (p: any) => {
              let ins = false;
              for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const a = poly[i], b = poly[j];
                if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) ins = !ins;
              }
              return ins;
            };
            let diff = 0, nInside = 0;
            for (let col = 60; col < 220; col++) for (let row = 60; row < 220; row++) {
              const k = col + ',' + row;
              const want = inside(Canvas.hexCenterWorld(col, row));
              if (want) nInside++;
              if (outline.has(k)) { if (!got.has(k)) diff++; continue; }   // outline cells are always included
              if (want !== got.has(k)) diff++;
            }
            res[name] = { diff, nInside, size: got.size };
          }
          return res;
        } finally { MAP_WIDTH = oW; MAP_HEIGHT = oH; }
      }, [W, H]);
      for (const n of ['convex', 'concave']) { expect(r[n].diff).toBe(0); expect(r[n].nInside).toBeGreaterThan(500); }
    });
  }

  test('degenerate shapes do not throw and are clipped to the map', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = 450, H = 450, c = (col: number, row: number) => HexUtils.toCube(col, row, W, H);
      return {
        single: HexUtils.polygonCells([c(10, 10)], W, H, true).length,
        two: HexUtils.polygonCells([c(10, 10), c(10, 14)], W, H, true).length,
        collinear: HexUtils.polygonCells([c(10, 10), c(10, 14), c(10, 20)], W, H, true).length,
        collinearLine: HexUtils.lineCells({ col: 10, row: 10 }, { col: 10, row: 20 }, W, H).length,
        none: HexUtils.polygonCells([], W, H, true).length,
        clipped: HexUtils.polygonCells([c(-30, 5), c(-10, 5), c(-20, 25)], W, H, true).length,
        edge: HexUtils.polygonCells([c(0, 0), c(0, 30), c(30, 0)], W, H, true).every((p: any) => HexUtils.inBounds(p.col, p.row, W, H)),
      };
    });
    expect(r.single).toBe(1);
    expect(r.two).toBe(5);
    expect(r.collinear).toBe(r.collinearLine);
    expect(r.none).toBe(0);
    expect(r.clipped).toBe(0);
    expect(r.edge).toBe(true);
  });
});

test.describe('HexUtils feather maths (T3.1)', () => {
  test.beforeEach(async ({ page }) => { await openEditor(page); });

  test('edgeDistances of a radius-5 disc (Set and mask agree) and blendWeight ramp', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = 450, H = 450;
      const cells = HexUtils.discCells(225, 224, 5, W, H);
      const keys = new Set<string>(cells.map((c: any) => c.col + ',' + c.row));
      const dist = HexUtils.edgeDistances(keys, W, H);
      const hist: Record<number, number> = {};
      for (const v of dist.values()) hist[v] = (hist[v] || 0) + 1;
      const mask = new Uint8Array(W * H);
      for (const c of cells) mask[c.row * W + c.col] = 1;
      const md = HexUtils.edgeDistances(mask, W, H);
      let mismatch = 0, outside = 0;
      for (const [k, v] of dist) { const [c, rr] = k.split(',').map(Number); if (md[rr * W + c] !== v) mismatch++; }
      for (let i = 0; i < md.length; i++) if (!mask[i] && md[i] !== 0) outside++;
      return { hist, mismatch, outside,
        w: [HexUtils.blendWeight(1, 0), HexUtils.blendWeight(1, 3), HexUtils.blendWeight(4, 3), HexUtils.blendWeight(9, 3)] };
    });
    expect(r.hist).toEqual({ 1: 30, 2: 24, 3: 18, 4: 12, 5: 6, 6: 1 });
    expect(r.mismatch).toBe(0);
    expect(r.outside).toBe(0);
    expect(r.w).toEqual([1, 0.25, 1, 1]);
  });

  test('map-edge cells are not boundary; a whole-map selection has weight 1 everywhere (Set and mask)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = 12, H = 10;
      const all = new Set<string>(); const mask = new Uint8Array(W * H).fill(1);
      for (let rr = 0; rr < H; rr++) for (let c = 0; c < W; c++) all.add(c + ',' + rr);
      const d1 = HexUtils.edgeDistances(all, W, H), d2 = HexUtils.edgeDistances(mask, W, H);
      let minW = 1;
      for (const v of d1.values()) minW = Math.min(minW, HexUtils.blendWeight(v, 4));
      for (const v of d2) minW = Math.min(minW, HexUtils.blendWeight(v, 4));
      // positive control: the same maths on a partial selection does feather
      const part = new Set<string>(HexUtils.discCells(6, 5, 2, W, H).map((c: any) => c.col + ',' + c.row));
      const dp = HexUtils.edgeDistances(part, W, H);
      let pMin = 1; for (const v of dp.values()) pMin = Math.min(pMin, HexUtils.blendWeight(v, 4));
      // a disc touching the map corner: its in-map cells next to the map edge are not boundary
      const corner = new Set<string>(HexUtils.discCells(0, 0, 3, W, H).map((c: any) => c.col + ',' + c.row));
      const dc = HexUtils.edgeDistances(corner, W, H);
      return { minW, pMin, cornerCell: dc.get('0,0'), size: d1.size };
    });
    expect(r.size).toBe(120);
    expect(r.minW).toBe(1);
    expect(r.pMin).toBeCloseTo(1 / 5, 10);
    expect(r.cornerCell).toBeGreaterThan(1);
  });
});
