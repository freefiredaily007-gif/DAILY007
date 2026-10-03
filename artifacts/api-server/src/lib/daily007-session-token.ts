import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 14;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Daily007SessionClaims = {
  userId: string;
  sessionVersion: number;
};

function tokenSecret(): string | null {
  const secret = process.env.DAILY007_AUTH_SECRET || process.env.SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

export function daily007TokenConfigured(): boolean {
  return tokenSecret() !== null;
}

export function makeToken(userId: string, sessionVersion = 0): string | null {
  const secret = tokenSecret();
  if (!secret || !UUID_PATTERN.test(userId) ||
      !Number.isSafeInteger(sessionVersion) || sessionVersion < 0) return null;
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    sv: sessionVersion,
    exp: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readSessionToken(token: string): Daily007SessionClaims | null {
  const secret = tokenSecret();
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const claims = payload as Record<string, unknown>;
    const sessionVersion = claims.sv === undefined ? 0 : claims.sv;
    if (typeof claims.sub !== "string" || !UUID_PATTERN.test(claims.sub) ||
        typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000) ||
        !Number.isSafeInteger(sessionVersion) || (sessionVersion as number) < 0) return null;
    return { userId: claims.sub, sessionVersion: sessionVersion as number };
  } catch {
    return null;
  }
}

export function readToken(token: string): string | null {
  return readSessionToken(token)?.userId ?? null;
}

export function isSessionVersionCurrent(tokenVersion: number, accountVersion: unknown): boolean {
  return Number.isSafeInteger(tokenVersion) && tokenVersion >= 0 &&
    Number.isSafeInteger(accountVersion) && (accountVersion as number) >= 0 &&
    tokenVersion === accountVersion;
}