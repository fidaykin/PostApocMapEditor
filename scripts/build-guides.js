#!/usr/bin/env node
// Renders docs/guides/editor-guide.{en,uk}.md to sibling .html files (the Help menu opens the HTML: browsers download
// raw .md files instead of showing them). Understands only the Markdown subset the guides use: #/##/### headings,
// paragraphs, "- " lists, pipe tables, `code`, **bold**, [text](url). All text is HTML-escaped.
// usage: node scripts/build-guides.js          (writes the .html files)
//        require('./scripts/build-guides').render(markdown, lang) -> html string (tests compare it with the committed files)
'use strict';
const fs = require('fs');
const path = require('path');

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  const parts = text.split(/(`[^`]+`)/);
  return parts.map(p => {
    if (/^`[^`]+`$/.test(p)) return '<code>' + esc(p.slice(1, -1)) + '</code>';
    let h = esc(p);
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const href = url.replace(/^(editor-guide\.(?:en|uk))\.md$/, '$1.html');
      return '<a href="' + href + '">' + label + '</a>';
    });
    return h;
  }).join('');
}

function render(md, lang) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let title = '', i = 0;
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{1,3}) (.+)$/.exec(l))) {
      const level = m[1].length, text = m[2];
      if (level === 1) title = text;
      const num = /^(\d+)\./.exec(text);
      out.push(`<h${level}${num ? ` id="section-${num[1]}"` : ''}>${inline(text)}</h${level}>`);
      i++;
    } else if (/^\|/.test(l)) {
      const head = cells(l); i += 2;                       // header row + separator row
      let t = '<table><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
      while (i < lines.length && /^\|/.test(lines[i])) { t += '<tr>' + cells(lines[i]).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>'; i++; }
      out.push(t + '</tbody></table>');
    } else if (/^- /.test(l)) {
      let ul = '<ul>';
      while (i < lines.length && /^- /.test(lines[i])) { ul += '<li>' + inline(lines[i].slice(2)) + '</li>'; i++; }
      out.push(ul + '</ul>');
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,3} |\||- )/.test(lines[i])) { para.push(lines[i]); i++; }
      out.push('<p>' + inline(para.join(' ')) + '</p>');
    }
  }
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { --bg: #ffffff; --text: #1b1f24; --muted: #57606a; --border: #d0d7de; --code: #eef1f4; --link: #0b5cad; }
@media (prefers-color-scheme: dark) { :root { --bg: #14161a; --text: #e6e8eb; --muted: #9aa4af; --border: #3a4048; --code: #23272d; --link: #6cb2ff; } }
body { background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, sans-serif; margin: 0; padding: 24px 16px 64px; }
main { max-width: 820px; margin: 0 auto; }
h1, h2, h3 { line-height: 1.25; }
h2 { margin-top: 2em; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
a { color: var(--link); }
code { background: var(--code); border-radius: 4px; padding: 1px 5px; font-size: 0.92em; }
table { border-collapse: collapse; margin: 12px 0; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--border); padding: 5px 10px; text-align: left; vertical-align: top; }
th { background: var(--code); }
li { margin: 3px 0; }
</style>
</head>
<body>
<main>
${out.join('\n')}
</main>
</body>
</html>
`;
}

const GUIDES = [['editor-guide.en', 'en'], ['editor-guide.uk', 'uk']];
module.exports = { render, GUIDES };

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'docs', 'guides');
  for (const [name, lang] of GUIDES) {
    fs.writeFileSync(path.join(dir, name + '.html'), render(fs.readFileSync(path.join(dir, name + '.md'), 'utf8'), lang));
    console.log('wrote docs/guides/' + name + '.html');
  }
}
