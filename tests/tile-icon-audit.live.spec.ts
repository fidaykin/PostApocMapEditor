import { test, expect, Page } from '@playwright/test';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FakeGitHub, openEditor, ROOT, seedServerPackage } from './helpers';
import { AuditTile, DIFF_THRESHOLD, PAGES_BASE, resultsTable, runAudit, TileResult, verdictCounts } from './tile-audit-helpers';

// LIVE-DATA tile icon audit (opt-in, NOT part of the default suite: playwright.config.ts ignores *.live.spec.ts unless
// AUDIT_LIVE=1). Downloads the live registry, the Decameroon package (package.json, hex_database.json) and every hex
// sprite it names from GitHub Pages (plain GETs) into AUDIT_LIVE_DIR, serves them to the editor through FakeGitHub (the
// real package machinery: startup sync, registry, Pages sprite URLs) and audits the repo's base tiles and the live
// Decameroon tiles: pass A with the default package active, pass B with Decameroon active (every tile painted from its
// own package's palette chip while the other package is active). Writes AUDIT_LIVE_DIR/results-*.json, report-tables.md
// and, for every tile that is not MATCH, the two compared images (map frame, icon reference) under AUDIT_LIVE_DIR/images/.
//   AUDIT_LIVE=1 AUDIT_LIVE_DIR=/some/scratch/dir npx playwright test tests/tile-icon-audit.live.spec.ts

const DIR = process.env.AUDIT_LIVE_DIR || path.join(os.tmpdir(), 'tile-icon-audit-live');
const PKG = 'decameroon';

async function get(url: string) {
  const r = await fetch(url, { cache: 'no-store' } as any);
  return { status: r.status, body: r.ok ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0) };
}

async function download() {
  fs.mkdirSync(path.join(DIR, 'sprites/hex'), { recursive: true });
  const reg = await get(PAGES_BASE + 'packages/registry.json');
  const pkg = await get(PAGES_BASE + `packages/${PKG}/package.json`);
  const hex = await get(PAGES_BASE + `packages/${PKG}/hex_database.json`);
  for (const [n, r] of [['registry.json', reg], ['package.json', pkg], ['hex_database.json', hex]] as const) {
    if (r.status !== 200) throw new Error(`${n}: HTTP ${r.status}`);
    fs.writeFileSync(path.join(DIR, n), r.body);
  }
  const db = JSON.parse(hex.body.toString('utf8'));
  const fetched: Record<string, { status: number; bytes: number; url: string }> = {};
  for (const h of db.hexes) {
    if (!h.spriteName || fetched[h.spriteName]) continue;
    const url = PAGES_BASE + `packages/${PKG}/sprites/hex/${encodeURIComponent(h.spriteName)}.png`;
    const r = await get(url);
    fetched[h.spriteName] = { status: r.status, bytes: r.body.length, url };
    if (r.status === 200) fs.writeFileSync(path.join(DIR, 'sprites/hex', h.spriteName + '.png'), r.body);
  }
  fs.writeFileSync(path.join(DIR, 'sprite-fetch.json'), JSON.stringify(fetched, null, 1));
  return { registry: JSON.parse(reg.body.toString('utf8')), pkgJson: JSON.parse(pkg.body.toString('utf8')), db, fetched };
}

async function waitSettled(page: Page) {
  await page.waitForFunction(() => Terrain.pendingSprites() === 0);
}

test('LIVE: tile icon audit of the base and the live Decameroon package', async ({ page }) => {
  test.skip(process.env.AUDIT_LIVE !== '1', 'opt-in: AUDIT_LIVE=1');
  test.setTimeout(30 * 60_000);
  const live = await download();
  const gh = new FakeGitHub();
  const sprites: Record<string, Buffer> = {};
  for (const [name, f] of Object.entries(live.fetched)) if (f.status === 200) sprites[`hex/${name}.png`] = fs.readFileSync(path.join(DIR, 'sprites/hex', name + '.png'));
  seedServerPackage(gh, PKG, { name: live.pkgJson.name, version: live.pkgJson.version, description: live.pkgJson.description, hexes: live.db.hexes, sprites });
  gh.setJson('packages/registry.json', live.registry);
  gh.setJson(`packages/${PKG}/package.json`, live.pkgJson);

  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page, { gh });
  await waitSettled(page);

  const base: AuditTile[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/postapoc/hex_database.json'), 'utf8')).hexes.map((h: any) => ({ ...h, package: 'postapoc' }));
  const dec: AuditTile[] = live.db.hexes.map((h: any) => ({ ...h, package: h.package || PKG }));
  const loaded = await page.evaluate(p => HexDB.getAll().filter((h: any) => h.package === p).map((h: any) => h.id), PKG);
  expect(loaded.slice().sort(), 'the editor loaded the live Decameroon DB').toEqual(dec.map(t => t.id).sort());
  const tiles = [...base, ...dec];
  const listing = {
    postapoc: fs.readdirSync(path.join(ROOT, 'packages/postapoc/sprites/hex')),
    [PKG]: Object.entries(live.fetched).filter(([, f]) => f.status === 200).map(([n]) => n + '.png'),
  };

  // Calibration evidence: the frame of every tile against the icon of every OTHER sprite file (distinct bytes).
  const hashOf = (t: AuditTile) => {
    const f = t.package === 'postapoc' ? path.join(ROOT, 'packages/postapoc/sprites/hex', t.spriteName + '.png') : path.join(DIR, 'sprites/hex', t.spriteName + '.png');
    return fs.existsSync(f) ? crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex') : 'missing:' + t.id;
  };
  const cross: Record<string, any> = {};
  let crossBySrc: { id: string; src: string; footprint: boolean; hash: string }[] = [];

  const pass = async (label: string, calibrate: boolean) => {
    const { results } = await runAudit(page, tiles, listing, {
      compareMethods: calibrate,
      wantImages: () => true,
      after: calibrate ? async (t, raw) => {
        if (!crossBySrc.length) crossBySrc = await page.evaluate(ts => ts.map((t: any) => ({ id: t.id, src: (window as any).__TA.expectedSrc(t), footprint: !!(t.occupiedOffsets && t.occupiedOffsets.length), hash: t.hash })), tiles.map(x => ({ ...x, hash: hashOf(x) })));
        const own = hashOf(t);
        const others = crossBySrc.filter(s => s.hash !== own && !s.hash.startsWith('missing:'));
        const sc: { id: string; score: number | null; blockScore: number | null }[] = await page.evaluate(o => (window as any).__TA.crossScores(o), others);
        const near = (k: 'score' | 'blockScore') => sc.filter(s => s[k] !== null).sort((x, y) => x[k]! - y[k]!).slice(0, 8).map(s => ({ id: s.id, v: s[k] }));
        cross[`${t.package}::${t.id}`] = { self: raw.score, selfBlock: raw.blockScore, nearScore: near('score'), nearBlock: near('blockScore') };
      } : undefined,
    });
    // images: kept for every tile whose verdict is not MATCH (or whose pixels do not match)
    fs.mkdirSync(path.join(DIR, 'images'), { recursive: true });
    for (const r of results) {
      const bad = r.verdict !== 'MATCH' || r.blockScore === null || r.blockScore > DIFF_THRESHOLD;
      if (bad && r.images) {
        for (const k of ['map', 'ref'] as const)
          fs.writeFileSync(path.join(DIR, 'images', `${label}__${r.pkg}__${r.id}__${k}.png`), Buffer.from(r.images[k].split(',')[1], 'base64'));
      }
      delete r.images;
    }
    fs.writeFileSync(path.join(DIR, `results-${label}.json`), JSON.stringify(results, null, 1));
    return results;
  };

  const a = await pass('A-postapoc-active', true);
  fs.writeFileSync(path.join(DIR, 'calibration.json'), JSON.stringify(cross, null, 1));
  await page.evaluate(p => Packages.setActive(p), PKG);
  expect(await page.evaluate(() => Packages.getActive())).toBe(PKG);
  const b = await pass('B-decameroon-active', false);

  // Tables for the report (the committed report is written from these).
  const httpOf = (r: TileResult) => r.pkg === PKG ? `${live.fetched[r.spriteName]?.status ?? 'n/a'} / ${live.fetched[r.spriteName]?.bytes ?? 0} (live)` : `${r.http} / ${r.bytes} (repo)`;
  const diffs = a.map((r, i) => ({ r, o: b[i] })).filter(({ r, o }) => r.verdict !== o.verdict || r.reasons.join() !== o.reasons.join());
  const md = [
    `# generated ${new Date().toISOString()}`,
    '', '## Pass A (postapoc active)', '', JSON.stringify({ postapoc: verdictCounts(a.filter(r => r.pkg === 'postapoc')), [PKG]: verdictCounts(a.filter(r => r.pkg === PKG)) }),
    '', '## Pass B (decameroon active)', '', JSON.stringify({ postapoc: verdictCounts(b.filter(r => r.pkg === 'postapoc')), [PKG]: verdictCounts(b.filter(r => r.pkg === PKG)) }),
    '', `pass A vs pass B differences: ${diffs.length}`, ...diffs.map(({ r, o }) => `- ${r.pkg}/${r.id}: A ${r.verdict} [${r.reasons.join('; ')}] / B ${o.verdict} [${o.reasons.join('; ')}]`),
    '', '## Table (pass A)', '', resultsTable(a, httpOf),
  ].join('\n');
  fs.writeFileSync(path.join(DIR, 'report-tables.md'), md);
  expect(a.length).toBe(tiles.length);
  expect(b.length).toBe(tiles.length);
});
