#!/usr/bin/env node
// Rebuilds the compressed atlas variants of content packages from their PNG sprites (tools/atlas/atlas-config.json) in a checkout of the
// content site (gh-pages): <site>/packages/<id>/atlas/<variant>/. Run by the workflow .github/workflows/package-atlases.yml after every publish.
//
//   node tools/atlas/build-atlases.mjs --site <gh-pages checkout> [--check] [--force] [--astcenc <binary>] [--quality fast|medium|thorough] [package ...]
//
// --check  only compares; prints ok / stale / no-atlas per package and exits 1 when one is not ok
// --force  rebuilds even when the sprites have not changed since the last build
// Default packages: the ones <site>/packages/registry.json lists (a folder nothing lists is left alone). Nothing is committed or pushed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackage, groupDirs, sourceFiles, stamp } from './atlas-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(here, 'atlas-config.json');
const args = process.argv.slice(2);
const opt = (name, dflt = null) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const flag = name => args.includes(name);
const valueFlags = new Set(['--site', '--astcenc', '--quality']);
const packages = args.filter((a, i) => !a.startsWith('--') && !valueFlags.has(args[i - 1]));

const site = opt('--site');
if (!site || !fs.existsSync(path.join(site, 'packages'))) { console.error(`--site must be a checkout of the content site (no ${site}/packages)`); process.exit(2); }
const configBytes = fs.readFileSync(configPath);
const config = JSON.parse(configBytes);

let ids = packages;
if (!ids.length) {
  const registry = JSON.parse(fs.readFileSync(path.join(site, 'packages', 'registry.json'), 'utf8'));
  ids = (registry.packages || registry).map(p => p.id).filter(id => fs.existsSync(path.join(site, 'packages', id, 'sprites')));
}

let status = 0;
for (const id of ids) {
  const out = path.join(site, 'packages', id, 'atlas'), stampFile = path.join(out, 'source.sha256');
  const now = stamp(site, id, configBytes);
  const last = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8').trim() : '';
  if (flag('--check')) {
    if (!fs.existsSync(out)) { console.log(`${id}: no-atlas`); status = 1; }
    else if (now === last) console.log(`${id}: ok`);
    else { console.log(`${id}: stale (sprites or config changed since the last build)`); status = 1; }
    continue;
  }
  if (!flag('--force') && now === last) { console.log(`${id}: up to date, skipped`); continue; }
  const astcenc = opt('--astcenc', process.env.ASTCENC || 'astcenc');
  const work = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'atlas-out-'));
  console.log(`${id}: building…`);
  const t0 = Date.now();
  buildPackage({ groupDirs: groupDirs(site, id), outDir: work, config, astcenc, quality: opt('--quality', 'medium'), log: m => console.log(`  ${m}`) });
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.cpSync(work, out, { recursive: true });
  fs.rmSync(work, { recursive: true, force: true });
  fs.writeFileSync(stampFile, now + '\n');
  // what the editor compares its own file listing with, to tell whether the atlas is current
  fs.writeFileSync(path.join(out, 'source.json'), JSON.stringify({ stamp: now, builtAt: new Date().toISOString(), sprites: sourceFiles(site, id) }, null, 1) + '\n');
  console.log(`${id}: written to ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s (not committed)`);
}
process.exit(status);
