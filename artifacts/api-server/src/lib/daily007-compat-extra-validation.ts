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

export function referralCodeForUserId(userId: string): string {
  return `D7${userId.replaceAll("-", "").toUpperCase()}`;
}

export function pausedVideoRewardResponse() {
  return {
    rewarded: false as const,
    coins: 0 as const,
    message: "Video rewards are paused until verified playback is available.",
  };
}