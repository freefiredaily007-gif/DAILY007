export type TeamMemberInput = { name: string; uid: string | null };

export function parseFutureTimestamp(value: unknown, now = Date.now()): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6]);
  const offsetHour = parts[10] === undefined ? 0 : Number(parts[10]);
  const offsetMinute = parts[11] === undefined ? 0 : Number(parts[11]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] ||
      hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() > now ? date : null;
}

export function parseTeamMembers(value: unknown, expectedCount = 3): TeamMemberInput[] | null {
  if (!Number.isInteger(expectedCount) || expectedCount < 0 || expectedCount > 3 ||
      !Array.isArray(value) || value.length !== expectedCount) return null;
  const members: TeamMemberInput[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
    const member = entry as Record<string, unknown>;
    if (typeof member.name !== "string" || member.name.trim().length === 0 ||
        member.name.trim().length > 100) return null;
    let uid: string | null = null;
    if (member.uid !== undefined && member.uid !== null) {
      if (typeof member.uid !== "string" || member.uid.trim().length > 128) return null;
      const normalizedUid = member.uid.trim();
      if (normalizedUid.length > 0) uid = normalizedUid;
    }
    members.push({ name: member.name.trim(), uid });
  }
  const providedUids = members.flatMap((member) => member.uid === null ? [] : [member.uid]);
  return new Set(providedUids.map((uid) => uid.toLocaleLowerCase())).size === providedUids.length ? members : null;
}

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // Prefix ASCII and locale-specific full-width formula starters (including
  // ones preceded by Unicode whitespace, invisible format characters, or controls).
  if (/^(?:[\s\p{Cf}\p{Cc}])*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}