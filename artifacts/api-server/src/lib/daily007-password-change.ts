import { timingSafeEqual } from "node:crypto";

export type PasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
};

export function parsePasswordChangeInput(value: unknown): PasswordChangeInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (
    keys.length !== 2 ||
    keys.some((key) => key !== "currentPassword" && key !== "newPassword") ||
    typeof body.currentPassword !== "string" ||
    body.currentPassword.length < 1 ||
    body.currentPassword.length > 200 ||
    typeof body.newPassword !== "string" ||
    body.newPassword.length < 8 ||
    body.newPassword.length > 200
  ) return null;

  return {
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  };
}

export function passwordHashesMatch(candidate: Buffer, expected: Buffer): boolean {
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}