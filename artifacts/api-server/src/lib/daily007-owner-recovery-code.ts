import { timingSafeEqual } from "node:crypto";

const MIN_CODE_BYTES = 32;
const MAX_CODE_BYTES = 256;

export function isOwnerRecoveryCodeConfigured(code: string | undefined): code is string {
  if (!code || code.trim() !== code) return false;
  const length = Buffer.byteLength(code, "utf8");
  return length >= MIN_CODE_BYTES && length <= MAX_CODE_BYTES;
}

export function ownerRecoveryCodeMatches(candidate: unknown, configuredCode: string | undefined): boolean {
  if (
    typeof candidate !== "string" ||
    Buffer.byteLength(candidate, "utf8") < MIN_CODE_BYTES ||
    Buffer.byteLength(candidate, "utf8") > MAX_CODE_BYTES ||
    !isOwnerRecoveryCodeConfigured(configuredCode)
  ) return false;

  const candidateBytes = Buffer.from(candidate, "utf8");
  const configuredBytes = Buffer.from(configuredCode, "utf8");
  return candidateBytes.length === configuredBytes.length &&
    timingSafeEqual(candidateBytes, configuredBytes);
}