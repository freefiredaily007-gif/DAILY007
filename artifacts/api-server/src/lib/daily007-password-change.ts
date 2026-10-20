import { createHmac, timingSafeEqual } from "node:crypto";

export type PasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
  requestId?: string;
};

const PASSWORD_CHANGE_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePasswordChangeInput(value: unknown): PasswordChangeInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (
    keys.length < 2 ||
    keys.length > 3 ||
    keys.some((key) => key !== "currentPassword" && key !== "newPassword" && key !== "requestId") ||
    typeof body.currentPassword !== "string" ||
    body.currentPassword.length < 1 ||
    body.currentPassword.length > 200 ||
    typeof body.newPassword !== "string" ||
    body.newPassword.length < 8 ||
    body.newPassword.length > 200 ||
    (body.requestId !== undefined &&
      (typeof body.requestId !== "string" || !PASSWORD_CHANGE_REQUEST_ID_PATTERN.test(body.requestId)))
  ) return null;

  return {
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
    ...(typeof body.requestId === "string" ? { requestId: body.requestId.toLowerCase() } : {}),
  };
}

export function createPasswordChangeRequestFingerprint(
  userId: string,
  input: PasswordChangeInput,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(JSON.stringify([userId, input.requestId, input.currentPassword, input.newPassword]))
    .digest("hex");
}

export function passwordChangeRequestFingerprintsMatch(
  candidate: string | null,
  stored: string | null,
): boolean {
  if (
    !candidate ||
    !stored ||
    !/^[0-9a-f]{64}$/i.test(candidate) ||
    !/^[0-9a-f]{64}$/i.test(stored)
  ) return false;
  return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(stored, "hex"));
}

export function passwordHashesMatch(candidate: Buffer, expected: Buffer): boolean {
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}