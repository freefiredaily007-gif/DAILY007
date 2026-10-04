export type Daily007Role = "user" | "tournament_admin" | "admin";

export function isFullAdminRole(role: unknown): role is "admin" {
  return role === "admin";
}

export function hasTournamentAdminAccess(role: unknown): role is "admin" | "tournament_admin" {
  return role === "admin" || role === "tournament_admin";
}

export function isAssignableTournamentRole(role: unknown): role is "user" | "tournament_admin" {
  return role === "user" || role === "tournament_admin";
}

export function wouldRemoveLastFullAdmin(role: unknown, fullAdminCount: number): boolean {
  return isFullAdminRole(role) &&
    (!Number.isSafeInteger(fullAdminCount) || fullAdminCount <= 1);
}