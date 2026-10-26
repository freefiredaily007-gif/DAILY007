import { C } from '../components/ui';

export const GAME_MODE_FILTERS = [
  { key: 'all', title: 'ALL', name: 'ALL TOURNAMENTS', gameMode: undefined, accent: C.gold },
  { key: 'battle_royale_kill_earn', title: 'BR KILL & EARN', name: 'BATTLE ROYALE KILL & EARN', gameMode: 'battle_royale_kill_earn', accent: C.orange },
  { key: 'battle_royale', title: 'BR CLASSIC', name: 'BATTLE ROYALE CLASSIC', gameMode: 'battle_royale', accent: C.gold },
  { key: 'clash_squad', title: 'CLASH SQUAD', name: 'CLASH SQUAD', gameMode: 'clash_squad', accent: C.neon },
  { key: 'lone_wolf', title: 'LONE WOLF', name: 'LONE WOLF', gameMode: 'lone_wolf', accent: C.purple },
] as const;

export type TournamentModeFilterKey = (typeof GAME_MODE_FILTERS)[number]['key'];

function normalizeModeFilter(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function resolveModeFilter(value: unknown): TournamentModeFilterKey {
  const normalized = normalizeModeFilter(value);
  if (!normalized) return 'all';
  return GAME_MODE_FILTERS.find((filter) =>
    filter.key !== 'all' && normalizeModeFilter(filter.gameMode) === normalized,
  )?.key ?? 'all';
}
