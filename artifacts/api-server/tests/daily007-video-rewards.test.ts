import assert from "node:assert/strict";
import test from "node:test";
import {
  completeDaily007VideoWatch,
  isEligibleDaily007VideoCompletion,
  startDaily007VideoWatch,
  youtubeVideoIdFromUrl,
} from "../src/lib/daily007-video-rewards.ts";

test("YouTube video links are accepted only for secure supported YouTube video URLs", () => {
  const id = "a1b2C3d4E5F";
  assert.equal(youtubeVideoIdFromUrl(`https://www.youtube.com/watch?v=${id}&list=PL123`), id);
  assert.equal(youtubeVideoIdFromUrl(`https://youtu.be/${id}?si=abc`), id);
  assert.equal(youtubeVideoIdFromUrl(`https://youtube.com/shorts/${id}`), id);
  assert.equal(youtubeVideoIdFromUrl(`https://www.youtube-nocookie.com/embed/${id}`), id);
  assert.equal(youtubeVideoIdFromUrl(`http://youtube.com/watch?v=${id}`), null);
  assert.equal(youtubeVideoIdFromUrl(`https://youtube.com.evil.example/watch?v=${id}`), null);
  assert.equal(youtubeVideoIdFromUrl("https://youtube.com/watch?v=short"), null);
});

test("starting a watch session locks the video row while recording the session", async () => {
  const startedAt = new Date(Date.UTC(2026, 9, 3, 12));
  let videoLockSql = "";
  const client = {
    async query<T = unknown>(sql: string, values: unknown[] = []) {
      if (sql.includes("SELECT id FROM daily007_v2_videos")) {
        videoLockSql = sql;
        return { rows: [{ id: "video-id" }] as T[] };
      }
      if (sql.includes("INSERT INTO daily007_v2_video_watch_sessions")) {
        assert.deepEqual(values, ["user-id", "video-id", 30]);
        return { rows: [{ id: "session-id", started_at: startedAt }] as T[] };
      }
      return { rows: [] as T[] };
    },
  };

  const session = await startDaily007VideoWatch(client, "user-id", "video-id", 30);
  assert.match(videoLockSql, /FOR SHARE/);
  assert.equal(session.sessionId, "session-id");
  assert.equal(session.startedAt, startedAt.toISOString());
});

test("video reward completion requires 75% playback and at least 70% of the reported duration", () => {
  const now = Date.UTC(2026, 9, 2, 12);
  const startedAt = new Date(now - 70_000);
  assert.equal(isEligibleDaily007VideoCompletion({
    percentWatched: 75, durationSeconds: 100, startedAt, now,
  }), true);
  assert.equal(isEligibleDaily007VideoCompletion({
    percentWatched: 74, durationSeconds: 100, startedAt, now,
  }), false);
  assert.equal(isEligibleDaily007VideoCompletion({
    percentWatched: 100, durationSeconds: 100, startedAt: new Date(now - 69_000), now,
  }), false);
});

test("video completion before the minimum elapsed time cannot credit the wallet", async () => {
  const now = Date.UTC(2026, 9, 2, 12);
  const session: any = {
    id: "session-id",
    video_id: "video-id",
    duration_seconds: 100,
    started_at: new Date(now - 69_000),
    completed_at: null,
    reward_ledger_id: null,
    active: true,
  };
  let walletWrites = 0;
  let ledgerWrites = 0;
  const client = {
    async query<T = unknown>(sql: string) {
      if (sql.includes("FROM daily007_v2_video_watch_sessions s")) {
        return { rows: [{ ...session }] as T[] };
      }
      if (sql.includes("UPDATE daily007_v2_users SET wallet_coins")) walletWrites += 1;
      if (sql.includes("INSERT INTO daily007_v2_wallet_ledger")) ledgerWrites += 1;
      return { rows: [] as T[] };
    },
  };

  await assert.rejects(
    completeDaily007VideoWatch(client, "user-id", "session-id", 100, now),
    (error: any) => error.status === 409,
  );
  assert.equal(walletWrites, 0);
  assert.equal(ledgerWrites, 0);
});

test("disabling a video after playback starts rejects completion without a wallet change or reward entry", async () => {
  const now = Date.UTC(2026, 9, 4, 12);
  const startedAt = new Date(now - 30_000);
  let videoActive = true;
  let walletCoins = 12;
  let walletWrites = 0;
  let ledgerWrites = 0;
  let sessionCompletionWrites = 0;
  const session: any = {
    id: "session-id",
    video_id: "video-id",
    duration_seconds: 30,
    started_at: startedAt,
    completed_at: null,
    reward_ledger_id: null,
  };
  const client = {
    async query<T = unknown>(sql: string, values: unknown[] = []) {
      if (sql.includes("SELECT id FROM daily007_v2_videos")) {
        assert.match(sql, /active = true FOR SHARE/);
        return { rows: (videoActive ? [{ id: "video-id" }] : []) as T[] };
      }
      if (sql.includes("INSERT INTO daily007_v2_video_watch_sessions")) {
        assert.deepEqual(values, ["user-id", "video-id", 30]);
        return { rows: [{ id: "session-id", started_at: startedAt }] as T[] };
      }
      if (sql.includes("FROM daily007_v2_video_watch_sessions s")) {
        assert.match(sql, /v\.active/);
        assert.match(sql, /FOR UPDATE OF s, v/);
        return { rows: [{ ...session, active: videoActive }] as T[] };
      }
      if (sql.includes("SELECT wallet_coins FROM daily007_v2_users")) {
        return { rows: [{ wallet_coins: walletCoins }] as T[] };
      }
      if (sql.includes("UPDATE daily007_v2_users SET wallet_coins")) {
        walletCoins = Number(values[1]);
        walletWrites += 1;
      } else if (sql.includes("INSERT INTO daily007_v2_wallet_ledger")) {
        ledgerWrites += 1;
      } else if (sql.includes("UPDATE daily007_v2_video_watch_sessions")) {
        sessionCompletionWrites += 1;
      }
      return { rows: [] as T[] };
    },
  };

  const started = await startDaily007VideoWatch(client, "user-id", "video-id", 30);
  assert.equal(started.sessionId, "session-id");

  // The Full Admin deactivates the video while this player session is open.
  videoActive = false;
  const unavailable = (error: any) =>
    error.status === 409 &&
    error.message === "This video is no longer available for rewards.";

  await assert.rejects(
    completeDaily007VideoWatch(client, "user-id", started.sessionId, 100, now),
    unavailable,
  );
  await assert.rejects(
    completeDaily007VideoWatch(client, "user-id", started.sessionId, 100, now),
    unavailable,
  );

  assert.equal(walletCoins, 12);
  assert.equal(walletWrites, 0);
  assert.equal(ledgerWrites, 0);
  assert.equal(sessionCompletionWrites, 0);
  assert.equal(session.completed_at, null);
  assert.equal(session.reward_ledger_id, null);
});

test("a completed playback session credits one coin once and writes one ledger row", async () => {
  const now = Date.UTC(2026, 9, 2, 12);
  const session: any = {
    id: "session-id",
    video_id: "video-id",
    duration_seconds: 100,
    started_at: new Date(now - 70_000),
    completed_at: null,
    reward_ledger_id: null,
    active: true,
  };
  let balance = 8;
  let walletWrites = 0;
  let ledgerWrites = 0;
  const client = {
    async query<T = unknown>(sql: string, values: any[] = []) {
      if (sql.includes("FROM daily007_v2_video_watch_sessions s")) {
        return { rows: [{ ...session }] as T[] };
      }
      if (sql.includes("SELECT wallet_coins FROM daily007_v2_users")) {
        return { rows: [{ wallet_coins: balance }] as T[] };
      }
      if (sql.includes("UPDATE daily007_v2_users SET wallet_coins")) {
        balance = values[1];
        walletWrites += 1;
        return { rows: [] as T[] };
      }
      if (sql.includes("INSERT INTO daily007_v2_wallet_ledger")) {
        ledgerWrites += 1;
        return { rows: [{ id: "ledger-id" }] as T[] };
      }
      if (sql.includes("UPDATE daily007_v2_video_watch_sessions")) {
        session.reported_percent = values[1];
        session.completed_at = new Date(now);
        session.reward_ledger_id = values[2];
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
  };

  const first = await completeDaily007VideoWatch(client, "user-id", "session-id", 100, now);
  assert.equal(first.rewarded, true);
  assert.equal(first.coins, 1);
  assert.equal(first.walletCoins, 9);
  assert.equal(balance, 9);
  assert.equal(walletWrites, 1);
  assert.equal(ledgerWrites, 1);

  const retry = await completeDaily007VideoWatch(client, "user-id", "session-id", 100, now);
  assert.equal(retry.rewarded, false);
  assert.equal(retry.walletCoins, 9);
  assert.equal(walletWrites, 1);
  assert.equal(ledgerWrites, 1);
});