import type { Tournament } from './api';

export type TournamentTeamSlotInput = Partial<
  Pick<Tournament, 'filledSlots' | 'totalSlots' | 'availableSlots'>
>;

export type TournamentTeamSlotSummary = {
  filled: number;
  total: number;
  available: number;
  label: string;
};

export function getTournamentTeamSlotSummary(
  tournament: TournamentTeamSlotInput,
): TournamentTeamSlotSummary {
  const filled = Math.max(0, Number(tournament.filledSlots ?? 0));
  const total = Math.max(0, Number(tournament.totalSlots ?? 12));
  const available = Math.max(
    0,
    Number(tournament.availableSlots ?? total - filled),
  );

  return {
    filled,
    total,
    available,
    label: `${filled}/${total} teams formed · ${available} team slots available`,
  };
}
