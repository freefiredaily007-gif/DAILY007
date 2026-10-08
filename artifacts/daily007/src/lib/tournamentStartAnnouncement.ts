export function takeTournamentStartAnnouncement(
  tournament: { id: string | number; name?: string | null },
  announcedTournamentIds: Set<string>,
): string | null {
  const id = String(tournament.id).trim();
  if (!id || announcedTournamentIds.has(id)) return null;

  announcedTournamentIds.add(id);
  const name = String(tournament.name ?? "").trim() || "Tournament";
  return `Tournament ${name} is now ongoing.`;
}
