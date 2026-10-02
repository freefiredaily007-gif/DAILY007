export const DAILY007_VIDEO_REWARD_COINS = 1;
export const DAILY007_VIDEO_COMPLETION_PERCENT = 75;
export const DAILY007_VIDEO_MIN_DURATION_SECONDS = 5;
export const DAILY007_VIDEO_MAX_DURATION_SECONDS = 86_400;

export interface Daily007VideoRewardClient {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

interface WatchSessionRow {
  id: string;
  video_id: string;
  duration_seconds: number;
  started_at: Date | string;
  completed_at: Date | string | null;
  reward_ledger_id: string | null;
  active: boolean;
}

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

export function youtubeVideoIdFromUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length > 500) return null;

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const youtubeHosts = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
  ]);
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;

  let videoId: string | null = null;
  if (hostname === "youtu.be" || hostname === "www.youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (youtubeHosts.has(hostname)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/watch") videoId = url.searchParams.get("v");
    else if (["embed", "shorts", "live"].includes(parts[0] ?? "")) videoId = parts[1] ?? null;
  }

  return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null;
}

export function isEligibleDaily007VideoCompletion(input: {
  percentWatched: number;
  durationSeconds: number;
  startedAt: Date | string;
  now?: number;
}): boolean {
  const { percentWatched, durationSeconds, startedAt } = input;
  if (!Number.isSafeInteger(percentWatched) ||
      percentWatched < DAILY007_VIDEO_COMPLETION_PERCENT ||
      percentWatched > 100 ||
      !Number.isSafeInteger(durationSeconds) ||
      durationSeconds < DAILY007_VIDEO_MIN_DURATION_SECONDS ||
      durationSeconds > DAILY007_VIDEO_MAX_DURATION_SECONDS) {
    return false;
  }

  const startedAtMs = startedAt instanceof Date ? startedAt.getTime() : new Date(startedAt).getTime();
  const now = input.now ?? Date.now();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(now) || now < startedAtMs) return false;

  const minimumElapsedSeconds = Math.max(
    DAILY007_VIDEO_MIN_DURATION_SECONDS,
    Math.ceil(durationSeconds * 0.7),
  );
  return now - startedAtMs >= minimumElapsedSeconds * 1000;
}

export async function startDaily007VideoWatch(
  client: Daily007VideoRewardClient,
  userId: string,
  videoId: string,
  durationSeconds: number,
): Promise<{ sessionId: string; startedAt: string }> {
  if (!Number.isSafeInteger(durationSeconds) ||
      durationSeconds < DAILY007_VIDEO_MIN_DURATION_SECONDS ||
      durationSeconds > DAILY007_VIDEO_MAX_DURATION_SECONDS) {
    throw httpError(400, "Video duration is invalid.");
  }

  const video = await client.query<{ id: string }>(
    "SELECT id FROM daily007_v2_videos WHERE id = $1 AND active = true",
    [videoId],
  );
  if (!video.rows[0]) throw httpError(404, "This video is unavailable.");

  const inserted = await client.query<{ id: string; started_at: Date | string }>(
    `INSERT INTO daily007_v2_video_watch_sessions (user_id, video_id, duration_seconds)
     VALUES ($1, $2, $3)
     RETURNING id, started_at`,
    [userId, videoId, durationSeconds],
  );
  const session = inserted.rows[0];
  if (!session) throw new Error("The video watch session could not be created.");
  const startedAt = session.started_at instanceof Date
    ? session.started_at.toISOString()
    : new Date(session.started_at).toISOString();
  return { sessionId: session.id, startedAt };
}

export async function completeDaily007VideoWatch(
  client: Daily007VideoRewardClient,
  userId: string,
  sessionId: string,
  percentWatched: number,
  now = Date.now(),
): Promise<{
  rewarded: boolean;
  coins: number;
  walletCoins: number;
  transactionId: string | null;
  message: string;
}> {
  const locked = await client.query<WatchSessionRow>(
    `SELECT s.id, s.video_id, s.duration_seconds, s.started_at, s.completed_at,
            s.reward_ledger_id, v.active
       FROM daily007_v2_video_watch_sessions s
       JOIN daily007_v2_videos v ON v.id = s.video_id
      WHERE s.id = $1 AND s.user_id = $2
      FOR UPDATE OF s, v`,
    [sessionId, userId],
  );
  const session = locked.rows[0];
  if (!session) throw httpError(404, "Video watch session not found.");
  if (!session.active) throw httpError(409, "This video is no longer available for rewards.");

  if (session.completed_at) {
    const account = await client.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [userId],
    );
    return {
      rewarded: false,
      coins: 0,
      walletCoins: Number(account.rows[0]?.wallet_coins ?? 0),
      transactionId: session.reward_ledger_id,
      message: "This view has already been rewarded.",
    };
  }

  if (!isEligibleDaily007VideoCompletion({
    percentWatched,
    durationSeconds: Number(session.duration_seconds),
    startedAt: session.started_at,
    now,
  })) {
    throw httpError(409, "Keep the video playing until it completes to earn 1 coin.");
  }

  const account = await client.query<{ wallet_coins: number }>(
    "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
    [userId],
  );
  const balance = Number(account.rows[0]?.wallet_coins);
  if (!Number.isSafeInteger(balance) || balance < 0) {
    throw httpError(404, "Daily007 account not found or wallet balance is invalid.");
  }
  if (balance >= 2_147_483_647) throw httpError(409, "Wallet balance would exceed the supported range.");

  const nextBalance = balance + DAILY007_VIDEO_REWARD_COINS;
  await client.query(
    "UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1",
    [userId, nextBalance],
  );
  const idempotencyKey = `daily007-video-watch:${sessionId}`;
  const ledger = await client.query<{ id: string }>(
    `INSERT INTO daily007_v2_wallet_ledger
       (user_id, amount, balance_after, reason, idempotency_key, details)
     VALUES ($1, $2, $3, 'video_watch_reward', $4, $5)
     RETURNING id`,
    [
      userId,
      DAILY007_VIDEO_REWARD_COINS,
      nextBalance,
      idempotencyKey,
      { videoId: session.video_id, sessionId, reportedPercent: percentWatched },
    ],
  );
  const transactionId = ledger.rows[0]?.id;
  if (!transactionId) throw new Error("The video reward transaction could not be recorded.");

  await client.query(
    `UPDATE daily007_v2_video_watch_sessions
        SET reported_percent = $2, completed_at = now(), reward_ledger_id = $3
      WHERE id = $1`,
    [sessionId, percentWatched, transactionId],
  );

  return {
    rewarded: true,
    coins: DAILY007_VIDEO_REWARD_COINS,
    walletCoins: nextBalance,
    transactionId,
    message: "1 coin added to your wallet.",
  };
}