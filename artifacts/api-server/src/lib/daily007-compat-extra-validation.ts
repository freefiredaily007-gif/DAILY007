import { createHash } from "node:crypto";

export function normalizePaymentReference(reference: string): string {
  return reference.normalize("NFKC").trim().toLocaleUpperCase("en-US");
}

export function parseCoinPackages(value: string, minimum: number, maximum: number): number[] | null {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const entries = trimmed.split(",");
  if (entries.length > 20) return null;

  const packages = entries.map((entry) => {
    const normalized = entry.trim();
    if (!/^\d+$/.test(normalized)) return null;
    const amount = Number(normalized);
    return Number.isSafeInteger(amount) && amount >= minimum && amount <= maximum ? amount : null;
  });
  if (packages.some((amount) => amount === null) ||
      new Set(packages).size !== packages.length) return null;
  return packages as number[];
}

export function isValidYoutubeChannelUrl(value: string): boolean {
  if (!value || value.length > 300) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname) &&
      !url.username && !url.password && url.pathname.length > 1;
  } catch {
    return false;
  }
}

export function referralCodeForUserId(userId: string): string {
  return `D7${userId.replaceAll("-", "").toUpperCase()}`;
}

const SHORT_REFERRAL_CONSONANTS = "BCDFGHJKLMNPQRSTVWXYZ";
const SHORT_REFERRAL_VOWELS = "AEIOU";

export function shortReferralCodeForUserId(userId: string, attempt = 0): string {
  if (!Number.isSafeInteger(attempt) || attempt < 0) {
    throw new Error("Referral code attempt must be a non-negative integer.");
  }
  const hash = createHash("sha256").update(`${userId}:${attempt}`).digest();
  return [
    SHORT_REFERRAL_CONSONANTS[hash[0] % SHORT_REFERRAL_CONSONANTS.length],
    SHORT_REFERRAL_VOWELS[hash[1] % SHORT_REFERRAL_VOWELS.length],
    SHORT_REFERRAL_CONSONANTS[hash[2] % SHORT_REFERRAL_CONSONANTS.length],
    SHORT_REFERRAL_VOWELS[hash[3] % SHORT_REFERRAL_VOWELS.length],
    SHORT_REFERRAL_CONSONANTS[hash[4] % SHORT_REFERRAL_CONSONANTS.length],
  ].join("");
}

export function pausedVideoRewardResponse() {
  return {
    rewarded: false as const,
    coins: 0 as const,
    message: "Video rewards are paused until verified playback is available.",
  };
}