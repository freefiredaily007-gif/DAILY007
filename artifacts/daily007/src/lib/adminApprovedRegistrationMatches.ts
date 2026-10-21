export type ApprovedRegistrationMatchRow = {
  status?: string | null;
  tournamentId?: string | number | null;
  tournamentName?: string | null;
  startsAt?: string | null;
  totalPlayerSlots?: number | null;
  teamMembers?: unknown;
};

export type RegistrationTournamentSource = {
  id: string;
  name: string;
  startsAt?: string | null;
  totalPlayerSlots?: number;
  totalSlots?: number;
  teamSize?: number;
  enabled?: boolean;
  status?: string;
  lifecycle: 'upcoming' | 'ongoing';
};

export type ApprovedRegistrationMatchGroup<T extends ApprovedRegistrationMatchRow> = {
  id: string;
  tournamentName: string;
  startsAt: string | null;
  startLabel: string;
  totalPlayerSlots: number | null;
  approvedPlayerCount: number;
  rows: T[];
};

export type AdminApprovedTournamentCard<T extends ApprovedRegistrationMatchRow> =
  ApprovedRegistrationMatchGroup<T> & {
    lifecycle: 'upcoming' | 'ongoing';
  };

function registeredPlayerCount(row: ApprovedRegistrationMatchRow): number {
  let members = row.teamMembers;
  if (typeof members === 'string') {
    try {
      members = JSON.parse(members);
    } catch {
      members = null;
    }
  }
  return Array.isArray(members) && members.length > 0 ? members.length : 1;
}

export function formatAdminRegistrationStart(value: unknown): string {
  return formatAdminIstDateTime(value, 'Scheduled time unavailable');
}

export function formatAdminRegistrationTime(value: unknown): string {
  return formatAdminIstDateTime(value, 'Time unavailable');
}

function formatAdminIstDateTime(value: unknown, invalidLabel: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return invalidLabel;
  }
  const date = new Date(value);
  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  return `${dateLabel} · ${timeLabel} IST`;
}

export function buildAdminRegistrationTournamentCards<T extends ApprovedRegistrationMatchRow>(
  tournaments: readonly RegistrationTournamentSource[],
  rows: readonly T[],
): AdminApprovedTournamentCard<T>[] {
  const approvedGroups = new Map(
    groupApprovedRegistrationRows(rows).map((group) => [group.id, group]),
  );
  const cards: AdminApprovedTournamentCard<T>[] = [];

  for (const tournament of tournaments) {
    const id = String(tournament.id ?? '').trim();
    if (!id) continue;

    const group = approvedGroups.get(id);
    const computedSlots = Number(tournament.totalPlayerSlots)
      || Number(tournament.totalSlots) * Number(tournament.teamSize || 1);
    const totalPlayerSlots = group?.totalPlayerSlots
      ?? (Number.isSafeInteger(computedSlots) && computedSlots > 0 ? computedSlots : null);
    cards.push({
      id,
      tournamentName: String(tournament.name ?? '').trim() || 'Tournament',
      startsAt: typeof tournament.startsAt === 'string' ? tournament.startsAt : null,
      startLabel: formatAdminRegistrationStart(tournament.startsAt),
      totalPlayerSlots,
      approvedPlayerCount: group?.approvedPlayerCount ?? 0,
      rows: group?.rows ?? [],
      lifecycle: tournament.lifecycle,
    });
  }

  return cards.sort((a, b) => {
    const aTime = Date.parse(String(a.startsAt ?? ''));
    const bTime = Date.parse(String(b.startsAt ?? ''));
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
    if (Number.isFinite(aTime)) return -1;
    if (Number.isFinite(bTime)) return 1;
    return a.tournamentName.localeCompare(b.tournamentName);
  });
}

export function groupApprovedRegistrationRows<T extends ApprovedRegistrationMatchRow>(
  rows: readonly T[],
): ApprovedRegistrationMatchGroup<T>[] {
  const groups = new Map<string, ApprovedRegistrationMatchGroup<T>>();
  for (const row of rows) {
    const id = String(row.tournamentId ?? '').trim();
    if (!id || row.status !== 'approved') continue;
    let group = groups.get(id);
    if (!group) {
      const startsAt = typeof row.startsAt === 'string' ? row.startsAt : null;
      const totalPlayerSlots = Number(row.totalPlayerSlots);
      group = {
        id,
        tournamentName: String(row.tournamentName ?? '').trim() || 'Tournament',
        startsAt,
        startLabel: formatAdminRegistrationStart(startsAt),
        totalPlayerSlots: Number.isSafeInteger(totalPlayerSlots) && totalPlayerSlots > 0
          ? totalPlayerSlots
          : null,
        approvedPlayerCount: 0,
        rows: [],
      };
      groups.set(id, group);
    }
    group.rows.push(row);
    group.approvedPlayerCount += registeredPlayerCount(row);
  }
  return [...groups.values()].sort((a, b) => {
    const aTime = Date.parse(String(a.startsAt ?? ''));
    const bTime = Date.parse(String(b.startsAt ?? ''));
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
    return a.tournamentName.localeCompare(b.tournamentName);
  });
}
