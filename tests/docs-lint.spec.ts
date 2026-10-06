import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Documentation lint (T6.5): Markdown links resolve, the HTML guides are the rendering of their Markdown sources, and the
// README names every root script. No page needed.
const ROOT = path.resolve(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** [text](target) links outside fenced code blocks and inline code; images included. */
export function markdownLinks(md: string): { text: string; target: string; line: number }[] {
  const out: { text: string; target: string; line: number }[] = [];
  let fenced = false;
  md.split('\n').forEach((raw, i) => {
    if (/^\s*```/.test(raw)) { fenced = !fenced; return; }
    if (fenced) return;
    const line = raw.replace(/`[^`]*`/g, '');
    for (const m of line.matchAll(/!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.push({ text: m[1], target: m[2], line: i + 1 });
  });
  return out;
}

const DOCS = ['README.md', 'docs/guides/editor-guide.en.md', 'docs/guides/editor-guide.uk.md'];

test('the link extractor sees links and skips code (positive and negative control)', () => {
  const md = ['see [a](x/y.md) and `[no](nope.md)`', '```', '[fenced](nope2.md)', '```', '![img](p.png) [ext](https://e.com/z)'].join('\n');
  expect(markdownLinks(md).map(l => l.target)).toEqual(['x/y.md', 'p.png', 'https://e.com/z']);
});

for (const doc of DOCS) {
  test(`${doc}: every relative link points to an existing file or heading`, () => {
    const md = read(doc);
    const links = markdownLinks(md);
    expect(links.length, 'a document with no links would pass vacuously').toBeGreaterThan(0);
    const broken: string[] = [];
    for (const l of links) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(l.target)) continue;                       // http:, https:, mailto:
      const [file, hash] = l.target.split('#');
      const abs = file ? path.resolve(ROOT, path.dirname(doc), decodeURIComponent(file)) : path.join(ROOT, doc);
      if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) { broken.push(`${doc}:${l.line} ${l.target} leaves the repository`); continue; }
      if (!fs.existsSync(abs)) { broken.push(`${doc}:${l.line} ${l.target} does not exist`); continue; }
      if (hash && abs.endsWith('.md')) {
        const slugs = read(path.relative(ROOT, abs)).split('\n').filter(x => /^#{1,6} /.test(x))
          .map(h => h.replace(/^#+ /, '').toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-'));
        if (!slugs.includes(hash)) broken.push(`${doc}:${l.line} ${l.target}: no such heading`);
      }
    }
    expect(broken).toEqual([]);
  });
}

test('a broken link would be reported (control for the lint above)', () => {
  const l = markdownLinks('[x](docs/does-not-exist.md)')[0];
  expect(fs.existsSync(path.resolve(ROOT, l.target))).toBe(false);
});

test('the HTML guides are the rendering of their Markdown sources (run: node scripts/build-guides.js)', () => {
  const { render, GUIDES } = require('../scripts/build-guides.js');
  for (const [name, lang] of GUIDES) {
    const html = read(`docs/guides/${name}.html`);
    expect(html, `${name}.html is stale`).toBe(render(read(`docs/guides/${name}.md`), lang));
    expect(html).not.toMatch(/\.md"/);                                            // no link to a raw Markdown file (browsers download it)
  }
});

test('the English and Ukrainian guides have the same sections and the same shortcut tables', () => {
  const heads = (md: string) => md.split('\n').filter(l => /^## \d+\./.test(l)).map(l => /^## (\d+)\./.exec(l)![1]);
  const en = read('docs/guides/editor-guide.en.md'), uk = read('docs/guides/editor-guide.uk.md');
  expect(heads(uk)).toEqual(heads(en));
  expect(heads(en).length).toBeGreaterThanOrEqual(13);
  const keys = (md: string) => [...md.matchAll(/^\| (`[^|]+`) \|/gm)].map(m => m[1]);
  expect(keys(uk)).toEqual(keys(en));
  expect(keys(en).length).toBeGreaterThan(30);
  expect(uk).toMatch(/[іїєґ]/);                                                   // really Ukrainian text, not a copy of the English one
});

test('the README lists every script at the repository root', () => {
  const readme = read('README.md');
  const rootScripts = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f));
  expect(rootScripts).toEqual(expect.arrayContaining(['hex-utils.js', 'map-jobs.js', 'map-worker.js', 'gen-utils.js', 'map-format.js', 'brush.js', 'zone-painter.js']));
  for (const f of rootScripts) expect(readme, `README.md does not mention ${f}`).toContain('`' + f + '`');
  for (const f of ['MapEditorPro.html', 'deploy.sh', 'npx playwright test']) expect(readme).toContain(f);
  expect(readme).not.toMatch(/MapEditor\.html/);
});
