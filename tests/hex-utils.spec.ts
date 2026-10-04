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
