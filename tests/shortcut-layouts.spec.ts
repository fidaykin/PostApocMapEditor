import { test, expect } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// Phase 2 cleanup A1: tool shortcuts must be reachable on every keyboard layout and a press must trigger exactly one tool.
// Layouts are given as the typed characters of the three physical letter rows (QWERTY positions Q..P, A..;, Z../).

const ROWS = ['KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP', 'KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon', 'KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash'].map(r => r.split(' '));
// Each layout: the typed characters of the three rows AND, hand-written, the tool letter each physical key must trigger ('.' = nothing).
// Tool letters: p paint f fill r rect e eye s select t settlement d erase z zone l line o circle g polygon x eraser a scatter m marquee h replace b object w road c road-connect q erase-road u bridge y symmetry.
// The expectations are written out by hand (not derived with the code's own rule). Notes on the rule they encode: a typed Latin letter decides (ASCII or not: Turkish dotless i / g-breve
// bind nothing); a typed non-letter falls back to the physical key for the tools that have one (Dvorak ' and , sit on Q and W = road tools); a typed Cyrillic letter uses the physical key.
const LAYOUTS: Record<string, { typed: string[]; expect: string[] }> = {
  qwerty:    { typed: ['qwertyuiop', 'asdfghjkl;', 'zxcvbnm,./'], expect: ['qwertyu.op', 'asdfgh..l.', 'zxc.b.m...'] },
  azerty:    { typed: ['azertyuiop', 'qsdfghjklm', 'wxcvbn,;:!'], expect: ['azertyu.op', 'qsdfgh..lm', 'wxc.b.m...'] },
  qwertz:    { typed: ['qwertzuiop', 'asdfghjkl\u00f6', 'yxcvbnm,.-'], expect: ['qwertzu.op', 'asdfgh..l.', 'yxc.b.m...'] },
  dvorak:    { typed: ["',.pyfgcrl", 'aoeuidhtns', ';qjkxbmwvz'], expect: ['qw.pyfgcrl', 'aoeu.dht.s', '.q..xbmw.z'] },
  colemak:   { typed: ['qwfpgjluy;', 'arstdhneio', 'zxcvbkm,./'], expect: ['qwfpg.luy.', 'arstdh.e.o', 'zxc.b.m...'] },
  workman:   { typed: ['qdrwbjfup;', 'ashtgyneoi', 'zxmcvkl,./'], expect: ['qdrwb.fup.', 'ashtgy.eo.', 'zxmc..l...'] },
  turkishF:  { typed: ['fg\u011f\u0131odrnhp', 'uiea\u00fctkmly', 'j\u00f6vc\u00e7zsb.,'], expect: ['fg..odr.hp', 'u.ea.t.mly', '...c.zsb..'] },
  ukrainian: { typed: ['\u0439\u0446\u0443\u043a\u0435\u043d\u0433\u0448\u0449\u0437', '\u0444\u0456\u0432\u0430\u043f\u0440\u043e\u043b\u0434\u0436', '\u044f\u0447\u0441\u043c\u0438\u0442\u044c\u0431\u044e.'], expect: ['qwertyu.op', 'asdfgh..l.', 'zxc.b.m...'] },
  russian:   { typed: ['\u0439\u0446\u0443\u043a\u0435\u043d\u0433\u0448\u0449\u0437', '\u0444\u044b\u0432\u0430\u043f\u0440\u043e\u043b\u0434\u0436', '\u044f\u0447\u0441\u043c\u0438\u0442\u044c\u0431\u044e.'], expect: ['qwertyu.op', 'asdfgh..l.', 'zxc.b.m...'] },
};
// keys outside the three letter rows that a layout types a letter on: Turkish-F has s-cedilla on the quote key and x on the backslash key (ISO).
// Its q and w sit on the bracket keys, which are the brush-radius keys by design, so Road and Erase Road have no shortcut there (reachable with the toolbar).
const EXTRA: Record<string, { code: string; key: string; expect: string }[]> = { turkishF: [{ code: 'Quote', key: '\u015f', expect: '.' }, { code: 'Backslash', key: 'x', expect: 'x' }] };
// T4.4: the shortcut registry also owns the non-letter keys + - = 0 1 2 3 (matched by the typed character). Hand-written, per layout: which of the
// letter-row keys type one of them. Only QWERTZ types one ('-' on its Slash key = zoom out); every other layout types none of them on these rows,
// so every press must leave the zoom alone. ('.' = no zoom change, '-' = zoom out.) The registry's own resolver must agree with each press.
const ZOOM: Record<string, string[]> = {
  qwerty: ['..........', '..........', '..........'], azerty: ['..........', '..........', '..........'], qwertz: ['..........', '..........', '.........-'],
  dvorak: ['..........', '..........', '..........'], colemak: ['..........', '..........', '..........'], workman: ['..........', '..........', '..........'],
  turkishF: ['..........', '..........', '..........'], ukrainian: ['..........', '..........', '..........'], russian: ['..........', '..........', '..........'],
};
const TOOL: Record<string, string> = { p: 'paint', f: 'fill', r: 'rect', e: 'eye', s: 'select', t: 'settlement', d: 'erase', z: 'zone', l: 'line', o: 'circle', g: 'polygon', x: 'eraser', a: 'scatter', m: 'marquee', h: 'replace', b: 'object', w: 'road', c: 'road-connect', q: 'erase-road', u: 'bridge', y: 'symmetry' };

test.describe('shortcut layouts (cleanup A1)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  for (const [name, lay] of Object.entries(LAYOUTS)) {
    test(`${name}: every bound shortcut is reachable and each key press triggers exactly its own tool`, async ({ page }) => {
      const presses: { code: string; key: string; expect: string; zoom: string }[] = [];
      lay.typed.forEach((row, i) => [...row].forEach((ch, j) => presses.push({ code: ROWS[i][j], key: ch, expect: lay.expect[i][j], zoom: ZOOM[name][i][j] })));
      presses.push(...(EXTRA[name] || []).map(x => ({ ...x, zoom: '.' })));
      const res = await page.evaluate((ps) => {
        const out: { sentinel: string; tool: string; symChanged: boolean; zoomDelta: number; resolved: string | null }[] = [];
        for (const sentinel of ['line', 'paint']) for (const p of ps) {
          Tools.setActive(sentinel);
          Canvas.setZoom(100);
          const sym0 = Tools.getSymmetry();
          const ev = new KeyboardEvent('keydown', { key: p.key, code: p.code, bubbles: true, cancelable: true });
          window.dispatchEvent(ev);
          const hit = Shortcuts.resolve(ev);
          out.push({ sentinel, tool: Tools.getActive(), symChanged: Tools.getSymmetry() !== sym0, zoomDelta: Canvas.getZoom() - 100, resolved: hit ? hit.id : null });
          while (Tools.getSymmetry() !== sym0) Tools.cycleSymmetry();
        }
        return out;
      }, presses);
      const reached = new Set<string>();
      res.forEach((r, i) => {
        const p = presses[i % presses.length];
        const where = `${name} ${p.code}/${p.key} (from ${r.sentinel})`;
        const bound = p.expect === '.' ? '' : TOOL[p.expect];
        if (p.zoom === '-') { expect(r.zoomDelta, where + ' types - : zoom out').toBeLessThan(0); expect(r.resolved, where).toBe('zoom-out'); }
        else expect(r.zoomDelta, where + ' must not zoom').toBe(0);
        if (p.zoom !== '-') expect(r.resolved, where + ' registry resolver').toBe(bound ? 'tool-' + bound : null);
        if (bound === 'symmetry') { expect(r.symChanged, where).toBe(true); expect(r.tool, where).toBe(r.sentinel); reached.add(bound); }
        else if (bound) { expect(r.tool, where).toBe(bound); expect(r.symChanged, where).toBe(false); reached.add(bound); }
        else { expect(r.tool, where + ' must do nothing').toBe(r.sentinel); expect(r.symChanged, where).toBe(false); }
      });
      const unreachableByDesign = name === 'turkishF' ? ['road', 'erase-road'] : [];
      expect([...reached].sort()).toEqual(Object.values(TOOL).filter(t => !unreachableByDesign.includes(t)).sort());
    });
  }

  // I1: key NAMES (Dead, Process, Unidentified), IME composition, Alt (macOS Option), key repeat must never switch tools; QWERTY plain / CapsLock / Shift behave as before.
  test('Option / dead keys / IME composition / key repeat never change the tool; plain, CapsLock and Shift presses on QWERTY are unchanged', async ({ page }) => {
    type Ev = { key: string; code: string; altKey?: boolean; shiftKey?: boolean; repeat?: boolean; isComposing?: boolean };
    const cases: { name: string; ev: Ev; start: string; expect: string }[] = [
      // macOS Option+letter on US QWERTY
      { name: 'Option+E (Dead)', ev: { key: 'Dead', code: 'KeyE', altKey: true }, start: 'line', expect: 'line' },
      { name: 'Option+P (pi)', ev: { key: '\u03c0', code: 'KeyP', altKey: true }, start: 'line', expect: 'line' },
      { name: 'Option+F (f-hook)', ev: { key: '\u0192', code: 'KeyF', altKey: true }, start: 'line', expect: 'line' },
      { name: 'Option+S (sharp s)', ev: { key: '\u00df', code: 'KeyS', altKey: true }, start: 'line', expect: 'line' },
      { name: 'Option+Z (Omega)', ev: { key: '\u03a9', code: 'KeyZ', altKey: true }, start: 'line', expect: 'line' },
      { name: 'Option+L (not-sign) code tool', ev: { key: '\u00ac', code: 'KeyL', altKey: true }, start: 'paint', expect: 'paint' },
      { name: 'Dead without Alt', ev: { key: 'Dead', code: 'KeyP' }, start: 'line', expect: 'line' },
      { name: 'Dead on a code-tool key', ev: { key: 'Dead', code: 'KeyL' }, start: 'paint', expect: 'paint' },
      { name: 'Process (IME)', ev: { key: 'Process', code: 'KeyP' }, start: 'line', expect: 'line' },
      { name: 'Unidentified', ev: { key: 'Unidentified', code: 'KeyP' }, start: 'line', expect: 'line' },
      { name: 'composing p', ev: { key: 'p', code: 'KeyP', isComposing: true }, start: 'line', expect: 'line' },
      { name: 'composing l', ev: { key: 'l', code: 'KeyL', isComposing: true }, start: 'paint', expect: 'paint' },
      { name: 'repeat p', ev: { key: 'p', code: 'KeyP', repeat: true }, start: 'line', expect: 'line' },
      { name: 'repeat l', ev: { key: 'l', code: 'KeyL', repeat: true }, start: 'paint', expect: 'paint' },
      // non-Latin layouts: the physical fallback also refuses Alt / Shift / repeat
      { name: 'Cyrillic Alt+\u0437', ev: { key: '\u0437', code: 'KeyP', altKey: true }, start: 'line', expect: 'line' },
      { name: 'Cyrillic repeat', ev: { key: '\u0437', code: 'KeyP', repeat: true }, start: 'line', expect: 'line' },
      { name: 'Cyrillic Shift', ev: { key: '\u0417', code: 'KeyP', shiftKey: true }, start: 'line', expect: 'line' },
      { name: 'Greek Alt+pi', ev: { key: '\u03c0', code: 'KeyP', altKey: true }, start: 'line', expect: 'line' },
      // positive controls: these still work
      { name: 'QWERTY p', ev: { key: 'p', code: 'KeyP' }, start: 'line', expect: 'paint' },
      { name: 'QWERTY CapsLock P', ev: { key: 'P', code: 'KeyP' }, start: 'line', expect: 'paint' },
      { name: 'QWERTY Shift+P', ev: { key: 'P', code: 'KeyP', shiftKey: true }, start: 'line', expect: 'paint' },
      { name: 'QWERTY CapsLock L', ev: { key: 'L', code: 'KeyL' }, start: 'paint', expect: 'line' },
      { name: 'QWERTY Shift+L stays blocked', ev: { key: 'L', code: 'KeyL', shiftKey: true }, start: 'paint', expect: 'paint' },
      { name: 'Cyrillic plain', ev: { key: '\u0437', code: 'KeyP' }, start: 'line', expect: 'paint' },
      { name: 'Cyrillic CapsLock', ev: { key: '\u0417', code: 'KeyP' }, start: 'line', expect: 'paint' },
      { name: 'Greek plain pi', ev: { key: '\u03c0', code: 'KeyP' }, start: 'line', expect: 'paint' },
    ];
    const res = await page.evaluate((cs) => cs.map(c => {
      Tools.setActive(c.start);
      window.dispatchEvent(new KeyboardEvent('keydown', { ...c.ev, bubbles: true, cancelable: true }));
      return Tools.getActive();
    }), cases);
    cases.forEach((c, i) => expect(res[i], c.name).toBe(c.expect));
  });

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
