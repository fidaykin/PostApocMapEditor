import { test, expect } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// Phase 2 cleanup A1: tool shortcuts must be reachable on every keyboard layout and a press must trigger exactly one tool.
// Layouts are given as the typed characters of the three physical letter rows (QWERTY positions Q..P, A..;, Z../).

const ROWS = ['KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP', 'KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon', 'KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash'].map(r => r.split(' '));
const LAYOUTS: Record<string, string[]> = {
  qwerty:    ['qwertyuiop', 'asdfghjkl;', 'zxcvbnm,./'],
  azerty:    ['azertyuiop', 'qsdfghjklm', 'wxcvbn,;:!'],
  qwertz:    ['qwertzuiop', 'asdfghjkl;', 'yxcvbnm,./'],
  dvorak:    ["',.pyfgcrl", 'aoeuidhtns', ';qjkxbmwvz'],
  colemak:   ['qwfpgjluy;', 'arstdhneio', 'zxcvbkm,./'],
  workman:   ['qdrwbjfup;', 'ashtgyneoi', 'zxmcvkl,./'],
  turkishF:  ['fgğıodrnhp', 'uieaütkmly', 'jövcçzsb.,'],
  ukrainian: ['йцукенгшщз', 'фівапролдж', 'ячсмитьбю.'],
  russian:   ['йцукенгшщз', 'фывапролдж', 'ячсмитьбю.'],
};
// the tool each letter is bound to (typed letter on Latin layouts, physical key on Cyrillic ones)
// letters that a layout types on non-letter physical keys (Turkish-F puts x on the quote key; its q and w sit on the bracket keys, which are the brush-radius keys by design,
// so Road and Erase Road have no shortcut there: a documented limit, reachable with the toolbar)
const EXTRA: Record<string, { code: string; key: string }[]> = { turkishF: [{ code: 'Quote', key: 'x' }] };
const TOOL: Record<string, string> = { p: 'paint', f: 'fill', r: 'rect', e: 'eye', s: 'select', t: 'settlement', d: 'erase', z: 'zone', l: 'line', o: 'circle', g: 'polygon', x: 'eraser', a: 'scatter', m: 'marquee', h: 'replace', b: 'object', w: 'road', c: 'road-connect', q: 'erase-road', u: 'bridge', y: 'symmetry' };

test.describe('shortcut layouts (cleanup A1)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  for (const [name, rows] of Object.entries(LAYOUTS)) {
    test(`${name}: every bound shortcut is reachable and each key press triggers exactly its own tool`, async ({ page }) => {
      const presses: { code: string; key: string }[] = [];
      rows.forEach((row, i) => [...row].forEach((ch, j) => presses.push({ code: ROWS[i][j], key: ch })));
      presses.push(...(EXTRA[name] || []));
      const res = await page.evaluate((ps) => {
        const out: { code: string; key: string; sentinel: string; tool: string; symChanged: boolean }[] = [];
        for (const sentinel of ['line', 'paint']) for (const p of ps) {
          Tools.setActive(sentinel);
          const sym0 = Tools.getSymmetry();
          window.dispatchEvent(new KeyboardEvent('keydown', { key: p.key, code: p.code, bubbles: true, cancelable: true }));
          out.push({ code: p.code, key: p.key, sentinel, tool: Tools.getActive(), symChanged: Tools.getSymmetry() !== sym0 });
          while (Tools.getSymmetry() !== sym0) Tools.cycleSymmetry();
        }
        return out;
      }, presses);
      const reached = new Set<string>();
      const physicalOnly = 'loxgamhbwcquy';                       // letters that also work from the physical key when the typed key is not a letter
      for (const r of res) {
        const typedLatin = /^[a-z]$/.test(r.key) ? r.key : '';
        const codeLetter = r.code.startsWith('Key') ? r.code[3].toLowerCase() : '';
        const letter = typedLatin || (/\p{L}/u.test(r.key) ? codeLetter : (physicalOnly.includes(codeLetter) ? codeLetter : ''));
        const bound = letter ? TOOL[letter] : '';
        const where = `${name} ${r.code}/${r.key} (from ${r.sentinel})`;
        if (bound === 'symmetry') { expect(r.symChanged, where).toBe(true); expect(r.tool, where).toBe(r.sentinel); reached.add(bound); }
        else if (bound) { expect(r.tool, where).toBe(bound); expect(r.symChanged, where).toBe(false); reached.add(bound); }
        else { expect(r.tool, where + ' must do nothing').toBe(r.sentinel); expect(r.symChanged, where).toBe(false); }
      }
      const unreachableByDesign = name === 'turkishF' ? ['road', 'erase-road'] : [];
      expect([...reached].sort()).toEqual(Object.values(TOOL).filter(t => !unreachableByDesign.includes(t)).sort());
    });
  }

  test('concrete layout regressions: AZERTY physical W types z (Zone), Turkish-F U types r (Rect), Workman U types f (Fill), QWERTZ Y types z (Zone)', async ({ page }) => {
    const press = async (key: string, code: string) => {
      await page.evaluate(() => Tools.setActive('line'));
      await page.evaluate(([k, c]) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: c, bubbles: true })), [key, code]);
      return page.evaluate(() => Tools.getActive());
    };
    expect(await press('z', 'KeyW')).toBe('zone');
    expect(await press('w', 'KeyZ')).toBe('road');
    expect(await press('r', 'KeyU')).toBe('rect');
    expect(await press('f', 'KeyU')).toBe('fill');
    expect(await press('z', 'KeyY')).toBe('zone');
  });
});
