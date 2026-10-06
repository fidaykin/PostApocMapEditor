import { test, expect } from '@playwright/test';
import { parsePmsetLog, sleepsBetween } from './sleep-guard';
import { startupHeadline } from './helpers';

// Real `pmset -g log` lines (2026-10-06): the machine idle-slept on battery and then ran the whole test suite inside
// ~45 s maintenance dark wakes, ~500 s apart; every wait that spanned one of those sleeps ended ~8 min later.
const LOG = [
  '2026-10-06 20:11:14 +0300 Wake                \tWake from Deep Idle [CDNVA] : due to smc.sysState.Wake(0x70070000) pwrbtn SMC.OutboxNotEmpty/UserActivity Assertion Using AC',
  '2026-10-06 21:15:50 +0300 Sleep               \tEntering Sleep state due to \'Idle Sleep\':TCPKeepAlive=active Using Batt (Charge:100%) 365 secs  ',
  '2026-10-06 21:15:51 +0300 Wake Requests       \t[*process=mDNSResponder request=Maintenance deltaSecs=362 wakeAt=2026-10-06 21:21:54 info="DHCP lease renewal"]',
  '2026-10-06 22:27:17 +0300 DarkWake            \tDarkWake from Deep Idle [CDNP] : due to NUB.SPMI0Sw3IRQ nub-spmi0.0x02 rtc/Maintenance Using BATT (Charge:100%) 45 secs   ',
  '2026-10-06 22:27:47 +0300 Assertions          \tPID 13297(AddressBookSourceSync) Released PreventUserIdleSystemSleep "Address Book Source Sync" 00:00:30',
  '2026-10-06 22:28:02 +0300 Sleep               \tEntering Sleep state due to \'Maintenance Sleep\':TCPKeepAlive=active Using Batt (Charge:100%) 502 secs  ',
  '2026-10-06 22:36:24 +0300 DarkWake            \tDarkWake from Deep Idle [CDNP] : due to NUB.SPMI0Sw3IRQ rtc/Maintenance Using BATT (Charge:100%) 45 secs   ',
  '2026-10-06 22:37:09 +0300 Sleep               \tEntering Sleep state due to \'Maintenance Sleep\':TCPKeepAlive=active Using Batt (Charge:100%) 502 secs  ',
  '2026-10-06 22:45:31 +0300 DarkWake            \tDarkWake from Deep Idle [CDNP] : due to NUB.SPMI0Sw3IRQ rtc/Maintenance Using BATT (Charge:100%) 45 secs   ',
  '2026-10-06 23:19:01 +0300 Wake                \tDarkWake to FullWake from Deep Idle [CDNVA] : due to HID Activity Using BATT (Charge:100%)',
].join('\n');
const at = (s: string) => Date.parse(s.replace(' ', 'T').replace(' +0300', '+03:00'));

test.describe('sleep guard (pmset log)', () => {
  test('parses sleep, dark wake and full wake transitions and ignores every other line', () => {
    const ev = parsePmsetLog(LOG);
    expect(ev.map(e => e.kind)).toEqual(['wake', 'sleep', 'darkwake', 'sleep', 'darkwake', 'sleep', 'darkwake', 'wake']);
    expect(ev[1].t).toBe(at('2026-10-06 21:15:50 +0300'));
    expect(ev[1].text).toContain('Idle Sleep');
  });

  test('sleepsBetween lists the sleeps inside a run window only', () => {
    const ev = parsePmsetLog(LOG);
    const s = sleepsBetween(ev, at('2026-10-06 22:09:00 +0300'), at('2026-10-06 22:40:00 +0300'));
    expect(s.map(e => e.t)).toEqual([at('2026-10-06 22:28:02 +0300'), at('2026-10-06 22:37:09 +0300')]);
    expect(sleepsBetween(ev, at('2026-10-06 23:19:02 +0300'), at('2026-10-06 23:40:00 +0300'))).toEqual([]);
  });
});

test('a startup failure that spanned a freeze says so in its first (logged) line', () => {
  const frozen = startupHeadline(500_700, 19_900, 'startup requests settled (network idle for 500 ms)', 480_000);
  expect(frozen).toMatch(/^editor startup not ready after 500\.7 s \(cap 19\.9 s\)/);
  expect(frozen).toContain('test process frozen ~480 s (machine asleep?)');
  const real = startupHeadline(20_100, 19_900, 'startup requests settled (network idle for 500 ms)', 0);
  expect(real).not.toContain('frozen');
  expect(real).toContain('waiting for: startup requests settled');
});
