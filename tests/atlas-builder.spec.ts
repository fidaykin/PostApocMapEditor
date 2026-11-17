// The Node atlas builder (tools/atlas) is a port of the Unity AtlasBuilder: same layout rules, same atlas.json. Pure logic, no browser.
// astcenc is replaced by a fake that writes a .astc header plus one 16-byte block per block of the image, so the page/mip layout is checked.
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lib: Promise<any> = import('../tools/atlas/atlas-lib.mjs');

const solid = (n: number, r: number, a = 255) => { const px = new Uint8Array(n * n * 4); for (let i = 0; i < px.length; i += 4) { px[i] = r; px[i + 3] = a; } return px; };
const names = (n: number) => Array.from({ length: n }, (_, i) => `S${i}`);

test.describe('atlas builder', () => {
  test('cellFor: the first matching rule wins, else the variant cell; masks are case-insensitive and * is any run', async () => {
    const { cellFor, matchesMask } = await lib;
    const v = { cell: 512, rules: [{ group: 'hex', name: '*Forest*', cell: 128 }, { group: 'hex', cell: 256 }] };
    expect(cellFor(v, 'hex', 'HS_Forest_1')).toBe(128);
    expect(cellFor(v, 'hex', 'HS_Swamp_1')).toBe(256);
    expect(cellFor(v, 'buildings', 'HS_Farm_1')).toBe(512);
    expect(matchesMask('HS_Forest_1', '*forest*')).toBe(true);
    expect(matchesMask('HS_Swamp_1', '*Forest*')).toBe(false);
    expect(matchesMask('a.b', 'a*c')).toBe(false);
    expect(matchesMask('axb', 'a.b')).toBe(false);   // the dot is literal
  });

  test('downscale averages blocks and keeps transparent edges untinted', async () => {
    const { downscale } = await lib;
    const src = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < src.length; i += 4) { src[i] = 200; src[i + 1] = 100; src[i + 3] = 255; }
    src.fill(0, 0, 4);   // one transparent pixel in the top-left block
    const dst = downscale(src, 4, 2);
    expect(dst.length).toBe(16);
    expect(dst[0]).toBe(200);     // colour of the opaque pixels only
    expect(dst[3]).toBe(191);     // 3 of 4 opaque
    expect(dst[7]).toBe(255);
    expect(() => downscale(src, 4, 3)).toThrow();
  });

  test('pack: 64 cells of 512 per page, 256 of 256; a short last page is only as tall as its rows; rects use Unity (bottom-left) coordinates', async () => {
    const { pack } = await lib;
    const cells = (n: number, size: number) => names(n).map((name, i) => ({ name, pixels: solid(size, i + 1) }));
    expect(pack('hex', 512, 4096, cells(65, 512)).length).toBe(2);
    const small = pack('hex', 256, 4096, cells(65, 256));
    expect(small.length).toBe(1);
    expect(small[0].height).toBe(5 * 256);
    const [first, last] = [small[0].sprites[0], small[0].sprites[64]];
    expect(first).toMatchObject({ x: 0, y: 4 * 256, w: 256, h: 256 });   // row 0 is the TOP of the page: the highest y
    expect(last).toMatchObject({ x: 0, y: 0 });
    expect(small[0].pixels[0]).toBe(1);                                  // top-left pixel of the image is the first sprite
    expect(small[0].pixels[((4 * 256) * 4096) * 4]).toBe(65);            // first pixel of the last row
  });

  test('packBig: whole sprites on the alignment grid with a gap, no overlap, never scaled; a full page starts a new one', async () => {
    const { packBig } = await lib;
    const big = (name: string, width: number, height: number, mark = 7) => {
      const pixels = new Uint8Array(width * height * 4);
      for (let i = 0; i < pixels.length; i += 4) { pixels[i] = mark; pixels[i + 3] = 255; }
      return { name, group: 'hex', width, height, pixels };
    };
    const sprites = [big('a', 1286, 1341), big('b', 1286, 1341), big('c', 1054, 987), big('d', 697, 941), big('e', 1151, 783)];
    const pages = packBig(4096, 12, 24, sprites);
    const all = pages.flatMap((p: any) => p.sprites.map((sp: any) => ({ p, sp })));
    expect(all.length).toBe(5);
    for (const { p, sp } of all) {
      expect(sp.x % 12).toBe(0);
      expect((p.height - (sp.y + sp.h)) % 12).toBe(0);
      expect(sp.x + sp.w).toBeLessThanOrEqual(p.width);
      expect(sp.y).toBeGreaterThanOrEqual(0);
      const src = sprites.find(b => b.name === sp.name)!;
      expect([sp.w, sp.h]).toEqual([src.width, src.height]);
    }
    for (const g of new Set(all.map((t: any) => t.p)))
      for (const a of all.filter((t: any) => t.p === g).map((t: any) => t.sp))
        for (const b of all.filter((t: any) => t.p === g).map((t: any) => t.sp)) {
          if (a.name === b.name) continue;
          expect(a.x + a.w + 24 <= b.x || b.x + b.w + 24 <= a.x || a.y + a.h + 24 <= b.y || b.y + b.h + 24 <= a.y, `${a.name}/${b.name} closer than the gap`).toBe(true);
        }
    const one = packBig(4096, 12, 24, [big('a', 100, 50, 9)])[0];
    const sp = one.sprites[0];
    expect(one.pixels[((one.height - sp.y - sp.h) * one.width + sp.x) * 4]).toBe(9);          // the image-space top-left pixel of the sprite
    expect(one.pixels[((one.height - sp.y) * one.width + sp.x) * 4 + 3]).toBe(0);           // padding under it (up to the alignment) is transparent
    expect(packBig(4096, 12, 24, Array.from({ length: 20 }, (_, i) => big('s' + i, 1286, 1341))).length).toBe(4);   // 6 per page: 6+6+6+2
    expect(packBig(4096, 12, 24, []).length).toBe(0);
  });

  test('nextMip halves each side (odd sides repeat the edge) and averages', async () => {
    const { nextMip } = await lib;
    const src = new Uint8Array(3 * 3 * 4);
    for (let i = 0; i < src.length; i += 4) { src[i] = 100; src[i + 3] = 255; }
    const m = nextMip(src, 3, 3);
    expect(m.length).toBe(4);
    expect([m[0], m[3]]).toEqual([100, 255]);
    expect(nextMip(new Uint8Array(4), 1, 1).length).toBe(4);
  });

  test('buildPackage writes pages, mips and atlas.json in the format the game reads; stamp tracks sprites and config', async () => {
    const { buildPackage, groupDirs, stamp, sha256 } = await lib;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'));
    const site = path.join(tmp, 'site');
    const dirs = groupDirs(site, 'p');
    for (const d of Object.values(dirs) as string[]) fs.mkdirSync(d, { recursive: true });
    const png = (file: string, w: number, h: number, r: number) => { const p = new PNG({ width: w, height: h }); for (let i = 0; i < p.data.length; i += 4) { p.data[i] = r; p.data[i + 3] = 255; } fs.writeFileSync(file, PNG.sync.write(p)); };
    png(path.join(dirs.hex, 'B_Hex.png'), 512, 512, 20); png(path.join(dirs.hex, 'a_Hex.png'), 512, 512, 10);
    png(path.join(dirs.hex, 'Mega.png'), 700, 900, 30); png(path.join(dirs.buildings, 'Farm.png'), 512, 512, 40);
    // fake astcenc: a header + 16 bytes per block; records the flags it got
    const fake = path.join(tmp, 'astcenc');
    fs.writeFileSync(fake, `#!/usr/bin/env node
const fs=require('fs');const a=process.argv.slice(2);
const buf=fs.readFileSync(a[1]);const w=buf.readUInt16LE(12),h=buf.readUInt16LE(14);
const [bx,by]=a[3].split('x').map(Number);const n=Math.ceil(w/bx)*Math.ceil(h/by);
if(!a.includes('-yflip')||!a.includes('-cl'))process.exit(3);
fs.writeFileSync(a[2],Buffer.concat([Buffer.alloc(16),Buffer.alloc(n*16,1)]));`);
    fs.chmodSync(fake, 0o755);
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', 'atlas', 'atlas-config.json'), 'utf8'));
    const out = path.join(tmp, 'out');
    const [idx] = (await lib).buildPackage({ groupDirs: dirs, outDir: out, config, astcenc: fake, only: ['astc6x6-mips-hex256'] });
    expect(idx.variant).toBe('astc6x6-mips-hex256');
    const hex = idx.pages.find((p: any) => p.group === 'hex');
    expect(hex).toMatchObject({ cell: 256, width: 4096, height: 256 });                 // hex group goes down to 256 in this variant
    expect(idx.pages.find((p: any) => p.group === 'buildings').cell).toBe(512);
    expect(idx.pages.at(-1).group).toBe('big');                                         // the 700x900 sprite is packed whole
    expect(idx.sprites.map((s: any) => s.name).sort()).toEqual(['B_Hex', 'Farm', 'Mega', 'a_Hex'].sort());
    expect(idx.sprites.find((s: any) => s.name === 'a_Hex').x).toBe(0);                 // sorted case-insensitively: a_Hex before B_Hex
    expect(idx.sprites.find((s: any) => s.name === 'B_Hex').x).toBe(256);
    // mips: 4096x256 in 6x6 blocks, 8 levels
    let expectBytes = 0, w = 4096, h = 256; for (let i = 0; i < 8; i++) { expectBytes += Math.ceil(w / 6) * Math.ceil(h / 6) * 16; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
    expect(hex.mipCount).toBe(8);
    expect(hex.bytes).toBe(expectBytes);
    const raw = fs.readFileSync(path.join(out, 'astc6x6-mips-hex256', hex.file));
    expect(sha256(raw)).toBe(hex.sha256);
    expect(idx.sprites[0].src).toMatch(/^[0-9a-f]{64}$/);
    // stamp changes with a sprite and with the config, and ignores non-png files
    const cfg = Buffer.from(JSON.stringify(config));
    const s1 = stamp(site, 'p', cfg);
    fs.writeFileSync(path.join(dirs.hex, 'notes.txt'), 'x');
    expect(stamp(site, 'p', cfg)).toBe(s1);
    png(path.join(dirs.hex, 'a_Hex.png'), 512, 512, 11);
    expect(stamp(site, 'p', cfg)).not.toBe(s1);
    expect(stamp(site, 'p', Buffer.from('{}'))).not.toBe(stamp(site, 'p', cfg));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
