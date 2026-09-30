export function normalizePaymentReference(reference: string): string {
  return reference.normalize("NFKC").trim().toLocaleUpperCase("en-US");
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