import { execFileSync } from 'child_process';

/**
 * macOS power transitions from `pmset -g log`, so a run can tell whether the machine slept while it ran.
 *
 * Why (end-of-plan suite, 2026-10-06): the Mac idle-slept on battery and then lived only in ~45 s maintenance dark
 * wakes every ~500 s. `caffeinate -i -s` taken INSIDE a dark wake does not turn it into a full wake (and -s only
 * applies on AC), so the suite ran in 45 s slices: every wait spanning a sleep ended ~8 min later and all three
 * workers "stalled" at the same moment. Node timers do not advance while the machine sleeps, so the 20 s startup cap
 * was respected in awake time; the 500 s were the sleep.
 */
export type PowerKind = 'sleep' | 'darkwake' | 'wake';
export interface PowerEvent { t: number; kind: PowerKind; text: string }

const LINE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2}) (Sleep|DarkWake|Wake)\s{2,}\t?(.*)$/;

export function parsePmsetLog(text: string): PowerEvent[] {
  const out: PowerEvent[] = [];
  for (const raw of text.split('\n')) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const [, d, tm, sign, hh, mm, kind, rest] = m;
    const t = Date.parse(`${d}T${tm}${sign}${hh}:${mm}`);
    if (Number.isNaN(t)) continue;
    const body = rest.trim();
    if (kind === 'Sleep' && !/^Entering Sleep/.test(body)) continue;
    out.push({ t, kind: kind === 'Sleep' ? 'sleep' : kind === 'DarkWake' ? 'darkwake' : 'wake', text: body });
  }
  return out;
}

/** Sleeps that started inside [from, to]. */
export function sleepsBetween(events: PowerEvent[], from: number, to: number): PowerEvent[] {
  return events.filter(e => e.kind === 'sleep' && e.t >= from && e.t <= to);
}

/** `pmset -g log` (macOS only); '' anywhere else or on any failure. Takes ~3 s, so call it once per run. */
export function readPmsetLog(): string {
  if (process.platform !== 'darwin') return '';
  try { return execFileSync('pmset', ['-g', 'log'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 20_000 }); }
  catch { return ''; }
}
