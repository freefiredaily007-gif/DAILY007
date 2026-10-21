export type ApprovedRegistrationMatchRow = {
  status?: string | null;
  tournamentId?: string | number | null;
  tournamentName?: string | null;
  startsAt?: string | null;
  totalPlayerSlots?: number | null;
  teamMembers?: unknown;
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
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return 'Scheduled time unavailable';
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
