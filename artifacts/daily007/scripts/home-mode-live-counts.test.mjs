import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { countOpenHomeTournamentsByMode } from '../src/lib/tournamentFilters.ts';

const homeSource = await readFile(
  new URL('../src/screens/Home.tsx', import.meta.url),
  'utf8',
);
const homeModeCardsSource = await readFile(
  new URL('../src/screens/HomeGameModeCards.tsx', import.meta.url),
  'utf8',
);

test('counts only enabled, upcoming tournaments with remaining player seats per game mode', () => {
  const now = Date.parse('2026-10-24T10:00:00.000Z');
  const futureStart = new Date(now + 60 * 60 * 1000).toISOString();
  const tournament = (overrides = {}) => ({
    enabled: true,
    status: 'open',
    startsAt: futureStart,
    teamSize: 1,
    totalSlots: 48,
    totalPlayerSlots: 48,
    filledSlots: 0,
    filledPlayerSlots: 0,
    ...overrides,
  });

  const counts = countOpenHomeTournamentsByMode([
    tournament({ id: 'br-open', gameMode: 'battle_royale' }),
    tournament({
      id: 'br-full',
      gameMode: 'battle_royale',
      filledSlots: 48,
      filledPlayerSlots: 48,
    }),
    tournament({
      id: 'br-disabled',
      gameMode: 'battle_royale',
      enabled: false,
    }),
    tournament({
      id: 'br-started',
      gameMode: 'battle_royale',
      startsAt: new Date(now - 1).toISOString(),
    }),
    tournament({
      id: 'br-cancelled',
      gameMode: 'battle_royale',
      status: 'cancelled',
    }),
    tournament({
      id: 'cs-last-seat',
      gameMode: 'clash_squad',
      teamSize: 2,
      totalSlots: 2,
      totalPlayerSlots: 4,
      filledSlots: 2,
      filledPlayerSlots: 3,
      status: 'setup_needed',
    }),
    tournament({
      id: 'lone-wolf-closed',
      mode: 'Lone Wolf',
      registrationOpen: false,
    }),
  ], now);

  assert.deepEqual(counts, {
    battle_royale: 1,
    battle_royale_kill_earn: 0,
    clash_squad: 1,
    lone_wolf: 0,
  });
});

test('Home shows the live count only after its database-backed tournament refresh succeeds', () => {
  assert.match(homeSource, /api\.tournaments\('\?enabled=true'\)/);
  assert.match(homeSource, /modeCountsReady=\{lastSuccessfulRefreshAt !== null\}/);
  assert.match(homeSource, /countOpenHomeTournamentsByMode\(items,\s*clockNow\)/);
  assert.match(homeModeCardsSource, /testID=\{`home-mode-live-count-\$\{mode\.gameMode\}`\}/);
  assert.match(homeModeCardsSource, /LIVE \{liveCount\}/);
  assert.doesNotMatch(homeModeCardsSource, /LIVE \{liveCount\}[^<]*TOURNAMENTS/);
});

test('all Home game-mode LIVE counts use the prominent neon pill styling', () => {
  assert.match(
    homeModeCardsSource,
    /modeLiveBadge:\s*\{[\s\S]*?minHeight: 36[\s\S]*?paddingHorizontal: 14[\s\S]*?paddingVertical: 6[\s\S]*?borderWidth: 1\.5[\s\S]*?borderColor: C\.green[\s\S]*?glow\(C\.green, 10\)/,
  );
  assert.match(homeModeCardsSource, /modeLiveDot:\s*\{\s*width: 9,\s*height: 9/);
  assert.match(
    homeModeCardsSource,
    /modeLiveText:\s*\{\s*color: C\.green,\s*fontSize: 16,\s*fontWeight: '800'/,
  );
  assert.match(homeModeCardsSource, /modes\.map\(\(mode\) =>/);
});
