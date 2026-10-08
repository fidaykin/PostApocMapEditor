import { Page } from '@playwright/test';

// Editor globals used inside page.evaluate (not type-checked by Playwright; see editor-globals.d.ts).
declare const Packages: any, App: any, HEX_SIZE: number, COL_PITCH: number, ROW_PITCH: number;
declare function footprintCells(col: number, row: number, entry: any): { col: number; row: number }[];
declare function getSatelliteAnchor(col: number, row: number): { col: number; row: number } | null;
declare function invalidateSatelliteMap(): void;
declare function cityDistance(col: number, row: number): number;

/**
 * Tile icon audit (owner request): for every hex tile, what the PALETTE shows (the tile button's real <img>, its label and
 * category, the active-terrain preview, the HEX DB editor preview) is compared with what the MAP draws when that tile is
 * painted with the Paint tool (radius 0) into a neighbourhood of its own kind, at 200 % zoom.
 *
 * Pixel comparison: the painted cell is read back (getImageData; a screenshot of the same box when the canvas is tainted by
 * a cross-origin package sprite) and compared with an independent reference: the palette icon's own `src`, loaded as a
 * fresh `new Image()`, drawn the way a hex sprite is placed (2r box at the cell's centre from Canvas.hexCenterWorld and the
 * camera; multi-tile anchors at the cluster scale) on the map canvas itself (box cleared first; read back the same way, then
 * the map is re-rendered), so both go through the same canvas backend and resampler. Only pixels inside 0.85 r of the hex
 * (no outline, no anti-aliased rim) whose reference pixel and its 8 neighbours are fully opaque are scored: mean |RGB|
 * difference normalised to 0..1, per pixel (`score`) and on 4x4 block means (`blockScore`, the verdict score). What the
 * map shows through transparent sprite pixels is compared with the palette button's background (layered tiles) or flagged
 * (a non-layered tile shows the black canvas there).
 *
 * Used by tests/tile-icon-audit.spec.ts (repo base DB, default suite) and tests/tile-icon-audit.live.spec.ts
 * (AUDIT_LIVE=1: the live Decameroon package).
 */

/**
 * Threshold on the verdict score (blockScore: 4x4-block mean |RGB| difference over the sprite's fully opaque pixels).
 * Calibrated 2026-10-07 (Chrome headless, classic layout 1400x900, zoom 200 %, reference drawn on the map canvas):
 * the 149 tiles whose drawn hex IS their icon scored at most 0.00027 (base 90 + live Decameroon 60, minus Forest_5_Test,
 * whose semi-transparent sprite really is drawn differently), while the closest pair of DIFFERENT base pictures (Lake_5
 * frame vs the Lake_7 icon) scored 0.0047. 0.001 is 3.7x the worst self-score and 4.7x below the closest distinct pair.
 */
export const DIFF_THRESHOLD = 0.001;
/** An icon smaller than this (either side) is a placeholder, not a tile sprite (e.g. a 1x1 PNG). */
export const PLACEHOLDER_MAX_PX = 8;
/** Minimap colour (Terrain.color) farther than this (RGB Euclidean) from the sprite's mean opaque colour is noted. */
export const MINIMAP_NOTE_DIST = 80;
/** Transparent share of the hex above which what shows through it is checked (anti-aliased rims stay below 1 %). */
export const CLEAR_FRAC_MIN = 0.05;
/**
 * A layered tile: the palette button's background colour (what the palette shows behind the sprite) farther than this from
 * the mean colour the map draws behind it is a MISMATCH. Measured: water tiles 24-27 (palette flat #2a6fad vs the Water
 * sprite under), forests 0 (both the flat fallback), Special tiles 81 before the palette tint fix (#555 vs #7a9a4a).
 */
export const BG_MAX_DIST = 40;
export const PAGES_BASE = 'https://fidaykin.github.io/PostApocMapEditor/';

export interface AuditTile {
  id: string;
  package?: string;
  type?: string;
  category?: string;
  spriteName?: string;
  isLayered?: boolean;
  occupiedOffsets?: string[];
  edgeFaces?: string[];
}

export type Verdict = 'MATCH' | 'MISMATCH' | 'SPRITE MISSING' | 'DATA ISSUE';

export interface ChipInfo {
  src: string; complete: boolean; natW: number; natH: number; tooltip: string; alt: string;
  category: string | null; bg: string; pkgGroup: string | null;
  /** computed CSS of the icon <img>: the map stretches a sprite into a square 2r box */
  fit: string; cssW: string; cssH: string;
}

export interface TileResult {
  pkg: string; id: string; type: string; category: string; spriteName: string;
  activePkg: string;
  chip: ChipInfo | null;
  selected: string; selPreview: { src: string; name: string; id: string };
  before: string; mapId: string;
  byHexId: { id: string; type: string; package: string; spriteName: string } | null;
  spriteState: string; drawnSrc: string; expectedSrc: string;
  http: number; bytes: number;
  score: number | null; blockScore: number | null; scoreMode: string; opaqueFrac: number; clearFrac: number; semiFrac: number;
  refMean: number[] | null; clearMapMean: number[] | null; chipBg: string;
  bluishFrac: number;
  minimap: number[]; minimapDist: number | null;
  footprint: { cells: number; claimed: number } | null;
  editorPreview?: { rows: number; src: string; label: string; natW: number } | null;
  images?: { map: string; ref: string };
  /** how the frame was read: 'canvas' (getImageData) or 'screenshot' (tainted canvas); methodDelta = max channel difference of the two when both were taken */
  method: string; methodDelta?: number;
  error: string | null;
  verdict: Verdict; reasons: string[]; notes: string[];
}

// ── Static (data) checks, Node side ───────────────────────────────────────────────────────────────────────────────────

/** Category the palette should list a tile under, from its type ('' or ⚙️ SPECIAL for Special: the palette default). */
export const TYPE_CATEGORY: Record<string, string[]> = {
  'Water': ['💧 WATER / RIVER'], 'Rivers': ['💧 WATER / RIVER'],
  'Rubble': ['🏚️ RUBBLE/WASTELAND'], 'Plains': ['🌾 PLAINS'], 'Forests': ['🌲 FOREST'],
  'Hills/Mountains': ['⛰️ ROCKY/MOUNTAIN'], 'Resources': ['💎 RESOURCES'], 'Barren/Desert': ['🏜️ BARREN/DESERT'],
  'Swamp': ['🟫 SWAMP'], 'Volcanic/Rift': ['🌋 VOLCANIC/RIFT'], 'Special': ['', '⚙️ SPECIAL'],
};

export interface StaticFinding { issues: string[]; notes: string[] }
const key = (t: AuditTile) => `${t.package || 'postapoc'}::${t.id}`;

/**
 * Data checks that need no browser. `listing[pkg]` = the exact (case-sensitive) file names in that package's
 * sprites/hex/ directory (GitHub Pages is case-sensitive; the local macOS disk is not), or null when unknown.
 */
export function staticChecks(tiles: AuditTile[], listing: Record<string, string[] | null>): Map<string, StaticFinding> {
  const out = new Map<string, StaticFinding>();
  const byPkgSprite = new Map<string, AuditTile[]>();
  const byLowerId = new Map<string, AuditTile[]>();
  for (const t of tiles) {
    const pkg = t.package || 'postapoc';
    if (t.spriteName) {
      const k = pkg + '::' + t.spriteName;
      byPkgSprite.set(k, [...(byPkgSprite.get(k) ?? []), t]);
    }
    byLowerId.set(t.id.toLowerCase(), [...(byLowerId.get(t.id.toLowerCase()) ?? []), t]);
  }
  for (const t of tiles) {
    const pkg = t.package || 'postapoc';
    const f: StaticFinding = { issues: [], notes: [] };
    const sn = t.spriteName || '';
    if (!sn) f.issues.push('no spriteName');
    if (/\.(png|jpe?g|webp|gif)$/i.test(sn)) f.issues.push(`spriteName "${sn}" carries a file extension (".png" is appended again)`);
    const files = listing[pkg];
    if (sn && files) {
      if (!files.includes(sn + '.png')) {
        const ci = files.find(n => n.toLowerCase() === (sn + '.png').toLowerCase());
        f.issues.push(ci ? `case mismatch: spriteName "${sn}" but the file is "${ci}" (GitHub Pages is case-sensitive: 404)`
                         : `no file sprites/hex/${sn}.png in package ${pkg}`);
      }
    }
    const same = (byPkgSprite.get(pkg + '::' + sn) ?? []).filter(o => o !== t);
    if (sn && same.length) f.issues.push(`spriteName "${sn}" is shared with ${same.map(o => o.id).join(', ')} (two tiles, one picture)`);
    const owner = tiles.find(o => o !== t && (o.package || 'postapoc') === pkg && o.id === sn && o.spriteName !== sn);
    if (owner) f.issues.push(`spriteName "${sn}" is the id of another tile (${owner.id}, whose own sprite is "${owner.spriteName}")`);
    const twins = (byLowerId.get(t.id.toLowerCase()) ?? []).filter(o => o !== t);
    if (twins.length) f.issues.push(`id collides (case-insensitive) with ${twins.map(o => `${o.id} [${o.package || 'postapoc'}]`).join(', ')}: map cells store the bare id`);
    const allowed = TYPE_CATEGORY[t.type || ''];
    const cat = t.category || '';
    if (allowed && !allowed.includes(cat)) f.issues.push(`listed under "${cat || '⚙️ SPECIAL'}" but its type is ${t.type}`);
    if (!allowed) f.notes.push(`type "${t.type}" has no palette category`);
    if (sn && sn !== t.id) f.notes.push(`spriteName "${sn}" differs from id`);
    out.set(key(t), f);
  }
  return out;
}

// ── In-page kit ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Installs window.__TA (idempotent). Runs in the page: no imports, plain DOM / editor globals only. */
function auditKit(pagesBase: string) {
  const W = window as any;
  if (W.__TA) return;
  const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
  const loadImg = (src: string) => {
    if (!imgCache.has(src)) imgCache.set(src, new Promise(res => {
      const im = new Image();
      im.crossOrigin = 'anonymous';   // a package sprite from GitHub Pages must not taint the reference canvas
      im.onload = () => res(im); im.onerror = () => res(null);
      im.src = src;
    }));
    return imgCache.get(src)!;
  };
  const abs = (s: string) => (s ? new URL(s, location.href).href : '');
  function expectedSrc(t: any) {
    if (!t.spriteName) return '';
    const pkg = t.package || 'postapoc';
    const rel = 'packages/' + encodeURIComponent(pkg) + '/sprites/hex/' + encodeURIComponent(t.spriteName) + '.png';
    return pkg === 'postapoc' ? abs(rel) : pagesBase + rel;
  }
  function bgOf(el: Element | null): string {
    for (let e = el; e; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
    }
    return getComputedStyle(document.body).backgroundColor;
  }
  function findChip(t: any) {
    const sel = '.tile-btn[data-hex-id="' + CSS.escape(t.id) + '"]';
    if (document.querySelector('#palette-scroll .pkg-group')) {
      const g = document.querySelector('#palette-scroll .pkg-group[data-pkg="' + CSS.escape(t.package || 'postapoc') + '"]');
      return g ? g.querySelector(sel) as HTMLElement | null : null;
    }
    return document.querySelector('#palette-scroll ' + sel) as HTMLElement | null;
  }
  const isFootprint = (t: any) => Array.isArray(t.occupiedOffsets) && t.occupiedOffsets.length > 0;

  /** Reads the tile's palette chip, clicks it (the real selection handler), and lays out the neighbourhood. */
  function prepare(t: any, cell: { col: number; row: number }) {
    Tools.setActive('paint');
    Brush.setSize(0);
    const chip = findChip(t);
    let info: any = null;
    if (chip) {
      const img = chip.querySelector('img') as HTMLImageElement | null;
      const items = chip.parentElement;
      const hdr = items && items.previousElementSibling;
      info = {
        src: img ? img.src : '', complete: !!img && img.complete, natW: img ? img.naturalWidth : 0, natH: img ? img.naturalHeight : 0,
        tooltip: chip.querySelector('.tile-tooltip')?.textContent ?? '', alt: img ? img.alt : '',
        category: hdr && hdr.classList.contains('cat-header') ? hdr.textContent : null,
        bg: bgOf(chip), pkgGroup: (chip.closest('.pkg-group') as HTMLElement | null)?.dataset.pkg ?? null,
        fit: img ? getComputedStyle(img).objectFit : '', cssW: img ? getComputedStyle(img).width : '', cssH: img ? getComputedStyle(img).height : '',
      };
      chip.click();
    } else {
      UI.selectTerrain(t.id);   // no chip: still audit what the map draws for the id
    }
    const selPreview = {
      src: (document.getElementById('palette-sel-img') as HTMLImageElement).src,
      name: document.getElementById('palette-selected-name')!.textContent ?? '',
      id: document.getElementById('palette-selected-id')!.textContent ?? '',
    };
    // Neighbourhood: a radius-3 disc of the same tile (no neighbour of another type: no coastline, no blending), the
    // centre on a different background so the click really changes it. Multi-tile anchors stand on plain background.
    const bg = t.id === 'Plain_1' ? 'Plain_2' : 'Plain_1';
    for (const c of HexUtils.discCells(cell.col, cell.row, 3, MAP_WIDTH, MAP_HEIGHT)) mapData[c.row * MAP_WIDTH + c.col] = isFootprint(t) ? bg : t.id;
    mapData[cell.row * MAP_WIDTH + cell.col] = bg;
    invalidateSatelliteMap();
    Canvas.setZoom(200);
    Canvas.centerOnTile(cell.col, cell.row);
    const p = Canvas.hexScreenPos(cell.col, cell.row);
    const b = document.getElementById('map-canvas')!.getBoundingClientRect();
    return { chip: info, selected: UI.getSelectedTerrain(), selPreview, before: mapData[cell.row * MAP_WIDTH + cell.col], point: { x: b.left + p.x, y: b.top + p.y } };
  }

  /** Geometry of the painted cell on the canvas (independent of the draw code: hexCenterWorld + camera). */
  function cellBox(cell: { col: number; row: number }) {
    const scale = Canvas.getZoom() / 100, radius = HEX_SIZE * scale;
    const cam = Canvas.getCamera(), w = Canvas.hexCenterWorld(cell.col, cell.row);
    const cx = w.x * scale - cam.x, cy = w.y * scale - cam.y;
    const x0 = Math.floor(cx - radius) - 2, y0 = Math.floor(cy - radius) - 2, S = Math.ceil(2 * radius) + 5;
    return { scale, radius, cx, cy, x0, y0, S };
  }
  /**
   * The reference: the icon image drawn the way a hex sprite is placed (2r box, or the cluster box for anchors) at the cell's
   * position on a scratch canvas of the map canvas's size (Chrome picks the resampling path by canvas size: a small canvas
   * resamples differently), read back over the measured box.
   */
  let scratch: HTMLCanvasElement | null = null;
  function drawRef(img: HTMLImageElement | null, t: any, box: any): ImageData {
    const mc = document.getElementById('map-canvas') as HTMLCanvasElement;
    if (!scratch || scratch.width !== mc.width || scratch.height !== mc.height) {
      scratch = document.createElement('canvas'); scratch.width = mc.width; scratch.height = mc.height;
    }
    const g = scratch.getContext('2d', { willReadFrequently: false })!;
    g.clearRect(0, 0, scratch.width, scratch.height);
    if (img && img.naturalWidth) {
      if (isFootprint(t)) {
        const cW = 2 * (COL_PITCH + HEX_SIZE) * box.scale, cH = 3.5 * ROW_PITCH * box.scale;
        const s = Math.min(cW / img.naturalWidth, cH / img.naturalHeight), dW = img.naturalWidth * s, dH = img.naturalHeight * s;
        g.drawImage(img, box.cx - dW / 2, box.cy - dH / 2, dW, dH);
      } else {
        g.drawImage(img, box.cx - box.radius, box.cy - box.radius, 2 * box.radius, 2 * box.radius);
      }
    }
    return g.getImageData(box.x0, box.y0, box.S, box.S);
  }
  const toUrl = (d: ImageData) => { const c = document.createElement('canvas'); c.width = d.width; c.height = d.height; c.getContext('2d')!.putImageData(d, 0, 0); return c.toDataURL('image/png'); };
  /**
   * Pixel score of the frame `got` against the reference `want` inside 0.85 r of the hex. `score`: mean |RGB| difference on
   * the reference's solid pixels (alpha 255, 8 neighbours too), normalised to 0..1. `blockScore`: the same on 4x4 block means (only
   * blocks entirely opaque and inside the hex), which ignores resampling noise between the two canvases. A sprite with no
   * opaque pixel at all (e.g. drawn at 80 % alpha) is scored on its pixels with alpha >= 128, composited over `under`
   * (the palette button's background: what the palette shows).
   */
  function compare(got: Uint8ClampedArray, want: Uint8ClampedArray, box: any, under: number[] = [0, 0, 0]) {
    const R = box.radius * 0.85, s3 = Math.sqrt(3), S = box.S;
    const inHex = (x: number, y: number) => {
      const px = box.x0 + x + 0.5 - box.cx, py = box.y0 + y + 0.5 - box.cy;
      return !(Math.abs(py) > R * s3 / 2 || s3 * Math.abs(px) + Math.abs(py) > s3 * R);
    };
    let n = 0, nOp = 0, nClr = 0, nSemi = 0, diff = 0, semiDiff = 0, blue = 0;
    const ref = [0, 0, 0], clr = [0, 0, 0], semiRef = [0, 0, 0];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (!inHex(x, y)) continue;
      n++;
      const i = (y * S + x) * 4, a = want[i + 3];
      // opaque = this pixel and its 8 neighbours fully opaque: a resampled pixel next to a (semi-)transparent one mixes in what lies under it
      const solid = a === 255 && x > 0 && y > 0 && x < S - 1 && y < S - 1 && want[i - 4 + 3] === 255 && want[i + 4 + 3] === 255
        && want[i - S * 4 + 3] === 255 && want[i + S * 4 + 3] === 255 && want[i - S * 4 - 4 + 3] === 255 && want[i - S * 4 + 4 + 3] === 255
        && want[i + S * 4 - 4 + 3] === 255 && want[i + S * 4 + 4 + 3] === 255;
      if (solid) {
        nOp++;
        diff += Math.abs(got[i] - want[i]) + Math.abs(got[i + 1] - want[i + 1]) + Math.abs(got[i + 2] - want[i + 2]);
        ref[0] += want[i]; ref[1] += want[i + 1]; ref[2] += want[i + 2];
        if (want[i + 2] > want[i] + 10 && want[i + 2] >= want[i + 1] - 10) blue++;
      } else if (a <= 5) {
        nClr++; clr[0] += got[i]; clr[1] += got[i + 1]; clr[2] += got[i + 2];
      }
      if (a >= 128) {
        nSemi++;
        for (let ch = 0; ch < 3; ch++) {
          const c = (want[i + ch] * a + under[ch] * (255 - a)) / 255;   // getImageData is un-premultiplied
          semiDiff += Math.abs(got[i + ch] - c); semiRef[ch] += c;
        }
      }
    }
    let nb = 0, bdiff = 0;
    for (let by = 0; by + 4 <= S; by += 4) for (let bx = 0; bx + 4 <= S; bx += 4) {
      const g = [0, 0, 0], w = [0, 0, 0];
      let ok = true;
      for (let y = by; y < by + 4 && ok; y++) for (let x = bx; x < bx + 4; x++) {
        const i = (y * S + x) * 4;
        if (!inHex(x, y) || want[i + 3] < 255) { ok = false; break; }
        for (let ch = 0; ch < 3; ch++) { g[ch] += got[i + ch]; w[ch] += want[i + ch]; }
      }
      if (!ok) continue;
      nb++;
      bdiff += (Math.abs(g[0] - w[0]) + Math.abs(g[1] - w[1]) + Math.abs(g[2] - w[2])) / 16;
    }
    const semiOnly = !nOp && nSemi > 0;
    return {
      n, score: nOp ? diff / (nOp * 3 * 255) : (semiOnly ? semiDiff / (nSemi * 3 * 255) : null),
      blockScore: nb ? bdiff / (nb * 3 * 255) : (semiOnly ? semiDiff / (nSemi * 3 * 255) : null),
      scoreMode: nOp ? 'opaque' : (semiOnly ? 'semi-transparent over the palette background' : 'none'),
      opaqueFrac: n ? nOp / n : 0, clearFrac: n ? nClr / n : 0, semiFrac: n ? nSemi / n : 0,
      refMean: nOp ? ref.map(v => Math.round(v / nOp)) : (semiOnly ? semiRef.map(v => Math.round(v / nSemi)) : null),
      clearMapMean: nClr ? clr.map(v => Math.round(v / nClr)) : null,
      bluishFrac: nOp ? blue / nOp : 0,
    };
  }

  // The last measured cell: its geometry and the pixels read from the map canvas (null when the canvas is tainted).
  const last: { box: any; got: ImageData | null; refOnMap: ImageData | null; t: any; src: string } = { box: null, got: null, refOnMap: null, t: null, src: '' };

  /**
   * After the click, step 1: what the map holds for the cell; renders the frame to measure and reads it from the canvas.
   * A canvas that drew a cross-origin sprite (a package sprite from GitHub Pages while the editor runs on localhost) is
   * tainted: then `tainted` is true and the caller supplies a screenshot of the same box (measureB).
   */
  async function measureA(t: any, cell: { col: number; row: number }, chipSrc: string) {
    const k = cell.row * MAP_WIDTH + cell.col;
    const e = Terrain.byHexId(t.id);
    const r: any = {
      mapId: mapData[k],
      byHexId: e ? { id: e.id, type: e.type, package: e.package || 'postapoc', spriteName: e.spriteName } : null,
      spriteState: Terrain.spriteState(t.id),
      drawnSrc: Terrain.getSprite(t.id)?.src ?? '',
      expectedSrc: expectedSrc(t),
      layered: !!(e && Terrain.isLayeredHex(e)),   // the map draws a base terrain under this sprite
      error: null,
    };
    const src = chipSrc || r.expectedSrc;
    try {
      const resp = await fetch(src, { cache: 'no-store' });
      r.http = resp.status; r.bytes = resp.ok ? (await resp.arrayBuffer()).byteLength : 0;
    } catch (err) { r.http = 0; r.bytes = 0; }
    if (src) await loadImg(src);   // decoded before the frame is taken
    Canvas.render();
    const box = cellBox(cell);
    const mc = document.getElementById('map-canvas') as HTMLCanvasElement;
    if (box.x0 < 28 || box.y0 < 20 || box.x0 + box.S > mc.width || box.y0 + box.S > mc.height) r.error = 'cell not fully on screen';
    let got: ImageData | null = null;
    try { got = mc.getContext('2d')!.getImageData(box.x0, box.y0, box.S, box.S); } catch (err) { got = null; }
    Object.assign(last, { box, got, refOnMap: null, t, src });
    const rect = mc.getBoundingClientRect();
    r.tainted = !got;
    r.clip = { x: rect.left + window.scrollX + box.x0, y: rect.top + window.scrollY + box.y0, width: box.S, height: box.S };
    r.minimap = Terrain.color(t.id);
    if (isFootprint(t)) {
      const fc = footprintCells(cell.col, cell.row, t).filter((f: any) => f.col >= 0 && f.col < MAP_WIDTH && f.row >= 0 && f.row < MAP_HEIGHT);
      r.footprint = { cells: fc.length, claimed: fc.filter((f: any) => { const a = getSatelliteAnchor(f.col, f.row); return a && a.col === cell.col && a.row === cell.row; }).length };
    } else r.footprint = null;
    return r;
  }
  /**
   * Step 1b: the reference drawn ON THE MAP CANVAS itself (box cleared, icon drawn at the cell like a hex sprite), so the
   * reference goes through the very same canvas backend and resampler as the frame; read back like the frame (canvas, or
   * the caller's screenshot when tainted). measureB re-renders the map afterwards.
   */
  async function drawRefOnMap() {
    const { box, t, src } = last;
    const img = src ? await loadImg(src) : null;
    const g = (document.getElementById('map-canvas') as HTMLCanvasElement).getContext('2d')!;
    g.save();
    g.clearRect(box.x0, box.y0, box.S, box.S);
    g.beginPath(); g.rect(box.x0, box.y0, box.S, box.S); g.clip();
    if (img && img.naturalWidth) {
      if (isFootprint(t)) {
        const cW = 2 * (COL_PITCH + HEX_SIZE) * box.scale, cH = 3.5 * ROW_PITCH * box.scale;
        const s = Math.min(cW / img.naturalWidth, cH / img.naturalHeight), dW = img.naturalWidth * s, dH = img.naturalHeight * s;
        g.drawImage(img, box.cx - dW / 2, box.cy - dH / 2, dW, dH);
      } else g.drawImage(img, box.cx - box.radius, box.cy - box.radius, 2 * box.radius, 2 * box.radius);
    }
    g.restore();
    try { last.refOnMap = g.getImageData(box.x0, box.y0, box.S, box.S); } catch (err) { last.refOnMap = null; }
    return { tainted: !last.refOnMap };
  }
  async function decodeShot(b64: string, S: number) {
    const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d')!; g.drawImage(im, 0, 0);
    return g.getImageData(0, 0, S, S);
  }
  /** Step 2: compares the frame (canvas pixels, or the screenshot `shot` of the same box) with the icon reference. */
  async function measureB(shot: string | null, refShot: string | null, wantImages: boolean, under: number[]) {
    const { box, t, src } = last;
    const r: any = {};
    Canvas.render();   // drop the reference drawn on the map
    const refMap = refShot ? await decodeShot(refShot, box.S) : last.refOnMap;
    let got = last.got;
    if (shot) {
      const s = await decodeShot(shot, box.S);
      if (got) {   // both available: how far the screenshot path is from the canvas read (evidence for the live run)
        let d = 0; for (let i = 0; i < got.data.length; i++) if ((i & 3) !== 3) d = Math.max(d, Math.abs(got.data[i] - s.data[i]));
        r.methodDelta = d;
      }
      got = s;
    }
    r.method = shot ? 'screenshot' : 'canvas';
    last.got = got;
    const img = src ? await loadImg(src) : null;
    // Reference = the scratch rendering (alpha: which pixels are solid / transparent; colour of semi-transparent pixels)
    // with the colour of its solid pixels taken from the same image drawn on the map canvas (identical resampling path).
    const ref = drawRef(img, t, box);
    if (refMap) for (let i = 0; i < ref.data.length; i += 4) if (ref.data[i + 3] === 255) { ref.data[i] = refMap.data[i]; ref.data[i + 1] = refMap.data[i + 1]; ref.data[i + 2] = refMap.data[i + 2]; }
    Object.assign(r, compare(got!.data, ref.data, box, under));
    const mm = Terrain.color(t.id);
    r.minimapDist = r.refMean ? Math.round(Math.hypot(mm[0] - r.refMean[0], mm[1] - r.refMean[1], mm[2] - r.refMean[2])) : null;
    if (wantImages) {
      r.images = { map: toUrl(got!), ref: toUrl(ref) };
    }
    return r;
  }

  /**
   * Calibration: the last measured frame against the icon of every src in `srcs`, drawn at that cell like measureB's
   * reference (on the map canvas while it is readable; on the scratch canvas once it is tainted: `onMap` says which).
   */
  async function crossScores(srcs: { id: string; src: string; footprint: boolean }[]) {
    const { box, got } = last;
    const out: { id: string; score: number | null; blockScore: number | null; onMap: boolean }[] = [];
    try {
      for (const s of srcs) {
        const img = await loadImg(s.src);
        const tt = { occupiedOffsets: s.footprint ? ['N'] : [] };
        const ref = drawRef(img, tt, box);
        let onMap = false;
        if (img && img.naturalWidth) {
          Object.assign(last, { t: tt, src: s.src });
          await drawRefOnMap();
          if (last.refOnMap) {
            onMap = true;
            for (let i = 0; i < ref.data.length; i += 4) if (ref.data[i + 3] === 255) { ref.data[i] = last.refOnMap.data[i]; ref.data[i + 1] = last.refOnMap.data[i + 1]; ref.data[i + 2] = last.refOnMap.data[i + 2]; }
          }
        }
        const c = compare(got!.data, ref.data, box);
        out.push({ id: s.id, score: c.score, blockScore: c.blockScore, onMap });
      }
    } finally { Canvas.render(); }
    return out;
  }

  /** HEX DB editor: select each tile's row and read the preview <img>. */
  async function editorPreviews(tiles: any[]) {
    App.setMode('hexdb');
    const out: any[] = [];
    try {
      for (const t of tiles) {
        const rows = [...document.querySelectorAll('#hexdb-list .hexdb-list-row')].filter(r => r.textContent === t.id) as HTMLElement[];
        if (!rows.length) { out.push({ rows: 0, src: '', label: '', natW: 0 }); continue; }
        rows[0].click();
        const img = document.querySelector('#hexdb-right img') as HTMLImageElement | null;
        const label = (img?.nextElementSibling?.firstElementChild?.textContent) ?? '';
        const dec = img && img.src ? await loadImg(img.src) : null;
        out.push({ rows: rows.length, src: img ? img.src : '', label, natW: dec ? dec.naturalWidth : 0 });
      }
    } finally { App.setMode('map'); }
    return out;
  }

  W.__TA = { prepare, measureA, drawRefOnMap, measureB, crossScores, editorPreviews, expectedSrc, loadImg };
}

export async function installAuditKit(page: Page) {
  await page.evaluate(auditKit, PAGES_BASE);
}

/** A map with room for `n` isolated audit cells (7 apart, away from the city); returns the cells. */
export async function prepareAuditMap(page: Page, n: number) {
  const size = Math.min(450, Math.max(60, Math.ceil(Math.sqrt(n * 1.4 + 4)) * 7 + 8));
  return page.evaluate(([size, n]) => {
    IO.setNewMapSize(size, size);
    IO.applyNewMap();
    const cells: { col: number; row: number }[] = [];
    for (let row = 4; row < MAP_HEIGHT - 4 && cells.length < n; row += 7)
      for (let col = 4; col < MAP_WIDTH - 4 && cells.length < n; col += 7)
        // away from the city, and off the dashed block-grid lines (every 20th column / row counted from the far edge,
        // drawn through the cell centres while the rulers are on)
        if (cityDistance(col, row) > 6 && (MAP_WIDTH - col) % 20 !== 0 && (MAP_HEIGHT - row) % 20 !== 0) cells.push({ col, row });
    return cells;
  }, [size, n]);
}

export interface AuditOptions {
  wantImages?: (t: AuditTile) => boolean;
  /** Also take the screenshot while the canvas is readable, and record the max channel difference of the two reads. */
  compareMethods?: boolean;
  /** Called after each tile is measured (calibration: crossScores on the same frame). */
  after?: (t: AuditTile, raw: any) => Promise<void>;
}

/** Paints each tile with the real Paint tool (palette chip click + left click on the canvas) and measures it. */
export async function auditTiles(page: Page, tiles: AuditTile[], cells: { col: number; row: number }[], opts: AuditOptions = {}) {
  const raw: any[] = [];
  const activePkg = await page.evaluate(() => Packages.getActive());
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i], cell = cells[i];
    const prep = await page.evaluate(([t, c]) => (window as any).__TA.prepare(t, c), [t, cell] as const);
    await page.mouse.click(prep.point.x, prep.point.y);
    await page.mouse.move(2, 2);   // leaves the canvas: no hover preview in the measured frame
    const a = await page.evaluate(([t, c, src]) => (window as any).__TA.measureA(t, c, src), [t, cell, prep.chip?.src ?? ''] as const);
    const shot = (a.tainted || opts.compareMethods) ? (await page.screenshot({ clip: a.clip, animations: 'disabled', caret: 'hide' })).toString('base64') : null;
    await page.evaluate(() => (window as any).__TA.drawRefOnMap());
    const refShot = shot ? (await page.screenshot({ clip: a.clip, animations: 'disabled', caret: 'hide' })).toString('base64') : null;
    const under = (prep.chip?.bg ?? 'rgb(0, 0, 0)').match(/\d+/g)!.slice(0, 3).map(Number);
    const b = await page.evaluate(([shot, refShot, img, under]) => (window as any).__TA.measureB(shot, refShot, img, under), [shot, refShot, !!opts.wantImages?.(t), under] as const);
    const r = { t, activePkg, ...prep, ...a, ...b };
    raw.push(r);
    if (opts.after) await opts.after(t, r);
  }
  return raw;
}

export async function auditEditorPreviews(page: Page, tiles: AuditTile[]) {
  return page.evaluate(ts => (window as any).__TA.editorPreviews(ts), tiles);
}

const sameFile = (a: string, b: string) => {
  try { return decodeURIComponent(new URL(a).pathname) === decodeURIComponent(new URL(b).pathname) && new URL(a).host === new URL(b).host; }
  catch (e) { return a === b; }
};

/** Turns one raw measurement (+ static findings + editor preview) into a verdict with reasons. */
export function judge(raw: any, stat: StaticFinding | undefined, editor: any | undefined, threshold = DIFF_THRESHOLD): TileResult {
  const t: AuditTile = raw.t;
  const pkg = t.package || 'postapoc';
  const missing: string[] = [], mismatch: string[] = [], data: string[] = [...(stat?.issues ?? [])], notes: string[] = [...(stat?.notes ?? [])];
  const chip: ChipInfo | null = raw.chip;
  // sprite resolution
  if (!t.spriteName) missing.push('no spriteName');
  if (!chip) mismatch.push('no palette chip for this tile');
  else {
    if (!chip.complete || chip.natW === 0) missing.push(`palette icon not decoded (${chip.src})`);
    else if (chip.natW < PLACEHOLDER_MAX_PX || chip.natH < PLACEHOLDER_MAX_PX) missing.push(`palette icon is a ${chip.natW}x${chip.natH} placeholder`);
    if (raw.expectedSrc && chip.src && !chip.src.startsWith('data:') && !sameFile(chip.src, raw.expectedSrc)) mismatch.push(`icon src ${chip.src} is not the entry's sprite file ${raw.expectedSrc}`);
    if (chip.fit !== 'fill' || chip.cssW !== chip.cssH) mismatch.push(`palette icon box ${chip.cssW}x${chip.cssH} object-fit ${chip.fit}: not the square stretched box the map draws`);
    const fp = Array.isArray(t.occupiedOffsets) && t.occupiedOffsets.length > 0;
    if (chip.natW && chip.natH && Math.abs(chip.natW / chip.natH - 1) > 0.05)
      notes.push(fp ? `${chip.natW}x${chip.natH} cluster sprite: the palette stretches it to a square, the map keeps its aspect`
                    : `${chip.natW}x${chip.natH} sprite is stretched to a square in both palette and map`);
    if (chip.tooltip !== t.id) mismatch.push(`chip label "${chip.tooltip}" is not the id`);
    if (chip.pkgGroup && chip.pkgGroup !== pkg) mismatch.push(`chip listed in package group ${chip.pkgGroup}`);
    const allowed = TYPE_CATEGORY[t.type || ''];
    if (chip.category !== null && chip.category !== (t.category || '⚙️ SPECIAL')) mismatch.push(`chip under "${chip.category}" but the entry's category is "${t.category}"`);
    if (allowed && chip.category !== null && !allowed.includes(chip.category) && !(allowed.includes('') && chip.category === '⚙️ SPECIAL') && !data.some(d => d.startsWith('listed under')))
      data.push(`listed under "${chip.category}" but its type is ${t.type}`);
  }
  if (raw.http !== 200) missing.push(`sprite request answered HTTP ${raw.http}`);
  if (raw.spriteState !== 'loaded') missing.push(`map sprite state "${raw.spriteState}" (the map draws a fallback colour)`);
  // identity
  if (raw.selected !== t.id) mismatch.push(`chip click selected "${raw.selected}"`);
  if (raw.before === t.id) mismatch.push('cell already held the id before the click (setup)');
  if (raw.mapId !== t.id) mismatch.push(`mapData holds "${raw.mapId}" after painting`);
  const b = raw.byHexId;
  if (!b) mismatch.push('Terrain.byHexId(id) is null');
  else if (b.id !== t.id || b.type !== t.type || b.package !== pkg || b.spriteName !== t.spriteName)
    mismatch.push(`Terrain.byHexId resolves to ${b.id} [${b.package}] type ${b.type} sprite ${b.spriteName}`);
  if (raw.drawnSrc && raw.expectedSrc && !raw.drawnSrc.startsWith('data:') && !sameFile(raw.drawnSrc, raw.expectedSrc)) mismatch.push(`map sprite ${raw.drawnSrc} is not the entry's sprite file`);
  // previews
  if (chip && raw.selPreview.src !== chip.src) mismatch.push(`active-terrain preview shows ${raw.selPreview.src}, chip shows ${chip.src}`);
  if (raw.selPreview.id !== t.id) mismatch.push(`active-terrain id text "${raw.selPreview.id}"`);
  if (editor) {
    if (!editor.rows) mismatch.push('no HEX DB editor row');
    else {
      if (editor.rows > 1) data.push(`${editor.rows} HEX DB rows share this id`);
      if (raw.expectedSrc && !sameFile(editor.src, raw.expectedSrc) && !editor.src.startsWith('data:')) mismatch.push(`HEX DB editor preview shows ${editor.src}`);
      if (!editor.natW) missing.push('HEX DB editor preview image does not decode');
      if (editor.label !== t.id) mismatch.push(`HEX DB editor preview label "${editor.label}"`);
    }
  }
  // pixels
  if (raw.error) mismatch.push(raw.error);
  const verdictScore = raw.blockScore ?? raw.score;
  if (verdictScore === null) { if (!missing.length) mismatch.push('no opaque sprite pixel inside the hex (nothing to compare)'); }
  else if (verdictScore > threshold) mismatch.push(`drawn hex differs from the icon: score ${verdictScore.toFixed(4)} > ${threshold}${raw.scoreMode !== 'opaque' ? ` (${raw.scoreMode})` : ''}`);
  if (raw.footprint && raw.footprint.claimed !== raw.footprint.cells) mismatch.push(`footprint: ${raw.footprint.claimed}/${raw.footprint.cells} cells claimed by the anchor`);
  // what shows through the sprite's transparent pixels (non-anchor tiles; an anchor's footprint is reported separately)
  const fpTile = Array.isArray(t.occupiedOffsets) && t.occupiedOffsets.length > 0;
  if (!fpTile && raw.clearFrac > CLEAR_FRAC_MIN && raw.clearMapMean && chip) {
    const bg = (chip.bg.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    const d = Math.round(Math.hypot(bg[0] - raw.clearMapMean[0], bg[1] - raw.clearMapMean[1], bg[2] - raw.clearMapMean[2]));
    if (raw.layered && d > BG_MAX_DIST)
      mismatch.push(`behind the sprite (${Math.round(raw.clearFrac * 100)}% of the hex is transparent) the palette shows ${chip.bg} but the map draws rgb(${raw.clearMapMean.join(',')}) (distance ${d})`);
    if (!raw.layered)
      data.push(`${Math.round(raw.clearFrac * 100)}% of the hex is transparent in the sprite and the tile is not layered: the map shows the canvas background rgb(${raw.clearMapMean.join(',')}) there (no base terrain)`);
  }
  // informational
  if (raw.footprint) notes.push(`footprint ${raw.footprint.claimed}/${raw.footprint.cells} cells claimed`);
  if (raw.clearFrac > CLEAR_FRAC_MIN && raw.clearMapMean && (fpTile || raw.layered))
    notes.push(`${Math.round(raw.clearFrac * 100)}% of the hex is transparent in the sprite: palette shows ${chip?.bg ?? '?'} there, map shows rgb(${raw.clearMapMean.join(',')})`);
  if (raw.minimapDist !== null && raw.minimapDist > MINIMAP_NOTE_DIST) notes.push(`minimap colour rgb(${raw.minimap.join(',')}) is far (${raw.minimapDist}) from the sprite's mean rgb(${raw.refMean.join(',')})`);
  if ((t.type === 'Water') && raw.refMean && raw.bluishFrac < 0.05) notes.push(`type Water but only ${Math.round(raw.bluishFrac * 100)}% of the sprite is bluish`);
  const verdict: Verdict = missing.length ? 'SPRITE MISSING' : mismatch.length ? 'MISMATCH' : data.length ? 'DATA ISSUE' : 'MATCH';
  return {
    pkg, id: t.id, type: t.type ?? '', category: t.category ?? '', spriteName: t.spriteName ?? '', activePkg: raw.activePkg,
    chip, selected: raw.selected, selPreview: raw.selPreview, before: raw.before, mapId: raw.mapId, byHexId: b,
    spriteState: raw.spriteState, drawnSrc: raw.drawnSrc, expectedSrc: raw.expectedSrc, http: raw.http, bytes: raw.bytes,
    score: raw.score, blockScore: raw.blockScore, scoreMode: raw.scoreMode, opaqueFrac: raw.opaqueFrac, clearFrac: raw.clearFrac, semiFrac: raw.semiFrac, refMean: raw.refMean, clearMapMean: raw.clearMapMean,
    chipBg: chip?.bg ?? '', bluishFrac: raw.bluishFrac, minimap: raw.minimap, minimapDist: raw.minimapDist, footprint: raw.footprint,
    editorPreview: editor ?? null, images: raw.images, method: raw.method, methodDelta: raw.methodDelta, error: raw.error,
    verdict, reasons: [...missing, ...mismatch, ...data], notes,
  };
}

/** Full audit of `tiles` in the open editor: static checks, paint + measure, HEX DB previews, verdicts. */
export async function runAudit(page: Page, tiles: AuditTile[], listing: Record<string, string[] | null>,
  opts: AuditOptions & { threshold?: number; cells?: { col: number; row: number }[]; allTiles?: AuditTile[] } = {}) {
  await installAuditKit(page);
  const cells = opts.cells ?? await prepareAuditMap(page, tiles.length);
  if (cells.length < tiles.length) throw new Error(`audit map has ${cells.length} cells for ${tiles.length} tiles`);
  const raw = await auditTiles(page, tiles, cells, opts);
  const editor = await auditEditorPreviews(page, tiles);
  const stat = staticChecks(opts.allTiles ?? tiles, listing);   // data checks see the whole DB, not only the audited subset
  return { cells, results: raw.map((r, i) => judge(r, stat.get(key(tiles[i])), editor[i], opts.threshold)) };
}

// ── Report ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
export function resultsTable(rs: TileResult[], http?: (r: TileResult) => string) {
  const lines = [
    '| package | id | type | category | spriteName | sprite HTTP / bytes | score (block / pixel) | verdict | reason / notes |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rs) {
    const why = [...r.reasons, ...r.notes.map(n => 'note: ' + n)].join('; ');
    lines.push(`| ${cell(r.pkg)} | ${cell(r.id)} | ${cell(r.type)} | ${cell(r.category || '(none)')} | ${cell(r.spriteName)} | ${cell(http ? http(r) : `${r.http} / ${r.bytes}`)} | ${r.blockScore === null ? 'n/a' : r.blockScore.toFixed(5)} / ${r.score === null ? 'n/a' : r.score.toFixed(5)} | ${r.verdict} | ${cell(why)} |`);
  }
  return lines.join('\n');
}

export function verdictCounts(rs: TileResult[]) {
  const c: Record<Verdict, number> = { 'MATCH': 0, 'MISMATCH': 0, 'SPRITE MISSING': 0, 'DATA ISSUE': 0 };
  for (const r of rs) c[r.verdict]++;
  return c;
}
