// Packs the PNG sprites of a content package into atlas pages and compresses them to ASTC, without Unity: runs in the browser-less CI
// (tools/atlas/build-atlases.mjs). A port of the Unity AtlasBuilder (PostApocCityBuilder, Assets/_Project/Scripts/Editor/AtlasBuilder.cs), so the
// game reads the output unchanged: same page layout, same atlas.json, raw ASTC blocks (what Texture2D.LoadRawTextureData takes), bottom row first.
// Pixels here are RGBA, top row first (PNG order); rects in atlas.json are Unity coordinates (origin bottom-left).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';

export const sha256 = data => createHash('sha256').update(data).digest('hex');

// Math.round in .NET (Mathf.RoundToInt) rounds halves to even
const roundEven = v => { const f = Math.floor(v), d = v - f; return d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1); };

/** The cell size a sprite gets in a variant: the first rule that matches, else the variant's own. */
export function cellFor(variant, group, name) {
  for (const r of variant.rules || []) {
    if (r.group && r.group.toLowerCase() !== group.toLowerCase()) continue;
    if (r.name && !matchesMask(name, r.name)) continue;
    return r.cell;
  }
  return variant.cell;
}

/** Case-insensitive mask where * stands for any run of characters. */
export function matchesMask(text, mask) {
  const re = '^' + mask.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
  return new RegExp(re, 'i').test(text);
}

/** Box filter by a whole factor; colour is averaged premultiplied so transparent pixels do not tint the edge. */
export function downscale(src, srcSize, dstSize) {
  if (srcSize % dstSize !== 0) throw new Error(`${srcSize} is not a multiple of ${dstSize}`);
  const f = srcSize / dstSize, n = f * f, dst = new Uint8Array(dstSize * dstSize * 4);
  for (let y = 0; y < dstSize; y++)
    for (let x = 0; x < dstSize; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * srcSize + x * f + dx) * 4, ca = src[i + 3] / 255;
          r += src[i] * ca; g += src[i + 1] * ca; b += src[i + 2] * ca; a += ca;
        }
      const o = (y * dstSize + x) * 4;
      if (a > 0) { dst[o] = roundEven(r / a); dst[o + 1] = roundEven(g / a); dst[o + 2] = roundEven(b / a); dst[o + 3] = roundEven(a / n * 255); }
    }
  return dst;
}

/** One level down a mip chain: 2x2 average (premultiplied), the edge pixel is repeated when a size is odd. */
export function nextMip(src, w, h) {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), dst = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < 4; k++) {
        const sx = Math.min(w - 1, x * 2 + (k & 1)), sy = Math.min(h - 1, y * 2 + (k >> 1)), i = (sy * w + sx) * 4, ca = src[i + 3] / 255;
        r += src[i] * ca; g += src[i + 1] * ca; b += src[i + 2] * ca; a += ca;
      }
      const o = (y * nw + x) * 4;
      if (a > 0) { dst[o] = roundEven(r / a); dst[o + 1] = roundEven(g / a); dst[o + 2] = roundEven(b / a); dst[o + 3] = roundEven(a / 4 * 255); }
    }
  return dst;
}

const byName = (a, b) => { const x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; };

/** Row-major grid of cells; a page holds a square of them (4096 / 512 = 8 per row, 64 per page); a short last page is only as tall as its rows need. */
export function pack(group, cell, pageSize, cells) {
  const columns = Math.floor(pageSize / cell), maxPerPage = columns * columns, pages = [];
  for (let start = 0; start < cells.length; start += maxPerPage) {
    const count = Math.min(maxPerPage, cells.length - start), rows = Math.ceil(count / columns), height = rows * cell;
    const page = { group, cell, width: pageSize, height, pixels: new Uint8Array(pageSize * height * 4), sprites: [] };
    for (let i = 0; i < count; i++) {
      const { name, pixels } = cells[start + i], col = i % columns, row = Math.floor(i / columns), x = col * cell;
      for (let line = 0; line < cell; line++)
        page.pixels.set(pixels.subarray(line * cell * 4, (line + 1) * cell * 4), ((row * cell + line) * pageSize + x) * 4);
      page.sprites.push({ name, group, x, y: height - (row + 1) * cell, w: cell, h: cell });
    }
    pages.push(page);
  }
  return pages;
}

/**
 * Whole sprites of any size in rows ("shelves", tallest first). Every sprite starts on a multiple of `align` pixels (12 is a multiple of both
 * ASTC block sizes, so a block never holds pixels of two sprites) and leaves `gap` transparent pixels to its right and below.
 */
export function packBig(pageSize, align, gap, sprites) {
  const pages = [];
  if (!sprites.length) return pages;
  const up = v => Math.ceil(v / align) * align;
  const ordered = [...sprites].sort((a, b) => b.height - a.height || byName(a, b));
  let placed = [], x = 0, top = 0, rowHeight = 0, used = 0;
  const flush = () => {
    if (!placed.length) return;
    const height = up(used);
    let width = 0;
    for (const p of placed) width = Math.max(width, up(p.x + p.b.width));
    const page = { group: 'big', cell: 0, width, height, pixels: new Uint8Array(width * height * 4), sprites: [] };
    for (const { b, x: px, top: pTop } of placed) {
      for (let line = 0; line < b.height; line++)
        page.pixels.set(b.pixels.subarray(line * b.width * 4, (line + 1) * b.width * 4), ((pTop + line) * width + px) * 4);
      page.sprites.push({ name: b.name, group: b.group, x: px, y: height - (pTop + b.height), w: b.width, h: b.height });
    }
    pages.push(page);
    placed = []; x = 0; top = 0; rowHeight = 0; used = 0;
  };
  for (const b of ordered) {
    const slotW = up(b.width) + gap, slotH = up(b.height) + gap;
    if (x > 0 && x + slotW > pageSize) { top += rowHeight; x = 0; rowHeight = 0; }
    if (placed.length > 0 && top + slotH > pageSize) flush();
    placed.push({ b, x, top });
    x += slotW; rowHeight = Math.max(rowHeight, slotH); used = Math.max(used, top + b.height);
  }
  flush();
  return pages;
}

/**
 * The dominant colour of an RGBA image as "rrggbb": the mean of the opaque pixels weighted by their alpha, so transparent edges do not darken it.
 * "" when nothing is visible. The game uses it for far-zoom views that draw a tile as one colour.
 */
export function averageColour(pixels) {
  let r = 0, g = 0, b = 0, w = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (!a) continue;
    r += pixels[i] * a; g += pixels[i + 1] * a; b += pixels[i + 2] * a; w += a;
  }
  if (!w) return '';
  const h = v => Math.round(v / w).toString(16).padStart(2, '0');
  return h(r) + h(g) + h(b);
}

/** The PNGs of a folder, sorted by name: source-size ones are cells, the others (multi-tile sprites) are "big". */
export function readFolder(dir, group, cell, hashes, cells, bigs, colours = {}) {
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png')).sort((a, b) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
  for (const f of files) {
    const bytes = fs.readFileSync(path.join(dir, f)), name = f.replace(/\.png$/i, '');
    let png;
    try { png = PNG.sync.read(bytes); } catch { console.warn(`not an image: ${path.join(dir, f)}`); continue; }
    const pixels = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length);
    hashes[`${group}/${name}`] = sha256(bytes);
    colours[`${group}/${name}`] = averageColour(pixels);
    if (png.width === cell && png.height === cell) cells.push({ name, pixels });
    else bigs.push({ name, group, width: png.width, height: png.height, pixels });
  }
}

/** Compress one RGBA image to raw ASTC blocks, bottom row first (Unity's order). Needs the astcenc binary. */
export function astcEncode(astcenc, pixels, w, h, block, quality, tmp) {
  const tga = Buffer.alloc(18 + w * h * 4), px = tga.subarray(18);
  tga[2] = 2; tga.writeUInt16LE(w, 12); tga.writeUInt16LE(h, 14); tga[16] = 32; tga[17] = 0x28;   // uncompressed true colour, 8 alpha bits, top-left origin
  for (let i = 0; i < w * h * 4; i += 4) { px[i] = pixels[i + 2]; px[i + 1] = pixels[i + 1]; px[i + 2] = pixels[i]; px[i + 3] = pixels[i + 3]; }
  const input = path.join(tmp, 'in.tga'), output = path.join(tmp, 'out.astc');
  fs.writeFileSync(input, tga);
  const r = spawnSync(astcenc, ['-cl', input, output, block, `-${quality}`, '-yflip', '-silent'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`astcenc failed (${r.status}): ${r.stderr || r.stdout || r.error}`);
  const out = fs.readFileSync(output);
  return out.subarray(16);   // the 16-byte .astc header is not part of the texture data
}

/** All mip levels of a page, compressed and joined (largest first), as Texture2D.GetRawTextureData lays them out. */
export function encodePage(astcenc, page, block, mips, mipCount, quality, tmp) {
  const parts = [];
  let px = page.pixels, w = page.width, h = page.height;
  for (let level = 0; level < (mips ? mipCount : 1); level++) {
    parts.push(astcEncode(astcenc, px, w, h, block, quality, tmp));
    if (w === 1 && h === 1) break;
    px = nextMip(px, w, h); w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
  }
  return { raw: Buffer.concat(parts), mipCount: parts.length };
}

/** The ASTC block footprint of a Unity format name ("ASTC_6x6" -> "6x6"). */
export const blockOf = format => { const m = /^ASTC_(\d+x\d+)$/.exec(format); if (!m) throw new Error(`unsupported format ${format}`); return m[1]; };

/**
 * Builds every variant of one package. `groupDirs` maps a group to the folder with its PNGs. Writes <outDir>/<variant>/atlas.json and the pages.
 * Returns the index of each variant. `only` limits the variants (tests).
 */
export function buildPackage({ groupDirs, outDir, config, astcenc, quality = 'medium', mipCount = 8, only = null, log = () => {} }) {
  fs.mkdirSync(outDir, { recursive: true });
  const sources = {}, bigs = [], hashes = {}, colours = {};
  for (const group of config.groups) {
    const dir = groupDirs[group];
    if (!dir || !fs.existsSync(dir)) { log(`no folder for ${group}`); continue; }
    sources[group] = [];
    readFolder(dir, group, config.sourceCell, hashes, sources[group], bigs, colours);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
  const indexes = [];
  try {
    for (const v of config.variants) {
      if (only && !only.includes(v.name)) continue;
      const block = blockOf(v.format), vdir = path.join(outDir, v.name);
      fs.rmSync(vdir, { recursive: true, force: true });
      fs.mkdirSync(vdir, { recursive: true });
      const pages = [];
      for (const [group, cells] of Object.entries(sources)) {
        const byCell = new Map();
        for (const c of cells) { const k = cellFor(v, group, c.name); if (!byCell.has(k)) byCell.set(k, []); byCell.get(k).push(c); }
        for (const k of [...byCell.keys()].sort((a, b) => b - a))
          pages.push(...pack(group, k, config.pageSize, byCell.get(k).map(c => ({ name: c.name, pixels: k === config.sourceCell ? c.pixels : downscale(c.pixels, config.sourceCell, k) }))));
      }
      pages.push(...packBig(config.pageSize, config.bigAlign ?? 12, config.bigGap ?? 24, bigs));
      const index = { variant: v.name, format: v.format, mips: v.mips, pages: [], sprites: [] };
      pages.forEach((page, i) => {
        const { raw, mipCount: n } = encodePage(astcenc, page, block, v.mips, mipCount, quality, tmp);
        const file = `${page.group}_${page.cell}_${i}.bin`;
        fs.writeFileSync(path.join(vdir, file), raw);
        index.pages.push({ file, group: page.group, cell: page.cell, width: page.width, height: page.height, mipCount: n, bytes: raw.length, sha256: sha256(raw) });
        for (const sp of page.sprites) index.sprites.push({ name: sp.name, group: sp.group, page: i, x: sp.x, y: sp.y, w: sp.w, h: sp.h, src: hashes[`${sp.group}/${sp.name}`] ?? '', color: colours[`${sp.group}/${sp.name}`] ?? '' });
      });
      fs.writeFileSync(path.join(vdir, 'atlas.json'), JSON.stringify(index, null, 4));
      log(`${v.name}: ${index.pages.length} page(s), ${index.sprites.length} sprites, ${(index.pages.reduce((s, p) => s + p.bytes, 0) / 1048576).toFixed(1)} MB`);
      indexes.push(index);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return indexes;
}

/** The folders a package packs, as atlas groups. */
export const groupDirs = (site, id) => ({
  hex: path.join(site, 'packages', id, 'sprites', 'hex'),
  buildings: path.join(site, 'packages', id, 'sprites', 'buildings'),
  coast: path.join(site, 'packages', id, 'sprites', 'terrain', 'coastline'),
  roads: path.join(site, 'packages', id, 'sprites', 'terrain', 'roads'),
});

/** Bump when the builder writes something new into an atlas (a record field, a layout rule): every atlas then counts as stale and is rebuilt. 2 = per-sprite "color". */
export const ATLAS_FORMAT = 2;

/** One hash for everything an atlas is made of: every packed PNG (name + content) and the config. Same value as Tools/atlas/build-package-atlases.sh in the Unity repo. */
export function stamp(site, id, configBytes) {
  let text = '';
  const dirs = groupDirs(site, id);
  for (const g of ['hex', 'buildings', 'coast', 'roads']) {
    const dir = dirs[g];
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    for (const f of files) text += `${g}/${f} ${sha256(fs.readFileSync(path.join(dir, f)))}\n`;
  }
  text += `config ${sha256(configBytes)}\n`;
  text += `format ${ATLAS_FORMAT}\n`;
  return sha256(text);
}

/** git's blob id of a file (what the GitHub Contents API calls "sha"): lets the editor compare its file listing with what an atlas was built from. */
export const blobSha = data => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');

/** Every packed PNG with its blob id, "group/name.png" -> sha: written next to the atlas as source.json. */
export function sourceFiles(site, id) {
  const files = {};
  for (const [g, dir] of Object.entries(groupDirs(site, id))) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort()) files[`${g}/${f}`] = blobSha(fs.readFileSync(path.join(dir, f)));
  }
  return files;
}
