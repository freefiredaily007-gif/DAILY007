type TestRole = "user" | "admin" | "tournament_admin";

type TestUser = {
  id: string;
  name: string;
  email: string;
  role: TestRole;
  wallet_coins: number;
  phone: null;
  game_uid: null;
  status: "active";
  auth_version: number;
};

type YoutubeClaim = {
  id: string;
  user_id: string;
  task_key: "youtube_subscribe";
  reward_coins: number;
  status: "pending" | "approved" | "rejected";
  review_reason: string | null;
  reviewed_by: string | null;
  reward_ledger_id: string | null;
  created_at: Date;
  reviewed_at: Date | null;
};

type LedgerEntry = {
  id: string;
  user_id: string;
  amount: number;
  balance_after: number;
  reason: string;
  idempotency_key: string;
  details: Record<string, unknown>;
};

type Notification = {
  user_id: string;
  title: string;
  body: string;
  type: string;
};

type DatabaseState = {
  users: Map<string, TestUser>;
  claims: Map<string, YoutubeClaim>;
  ledger: LedgerEntry[];
  notifications: Notification[];
};

export const YOUTUBE_TEST_PLAYER_ID = "61000000-0000-4000-8000-000000000001";
export const YOUTUBE_TEST_ADMIN_ID = "61000000-0000-4000-8000-000000000002";
export const YOUTUBE_TEST_TOURNAMENT_ADMIN_ID = "61000000-0000-4000-8000-000000000003";
export const YOUTUBE_TEST_CLAIM_ID = "62000000-0000-4000-8000-000000000001";

function cloneState(state: DatabaseState): DatabaseState {
  return {
    users: new Map([...state.users].map(([id, user]) => [id, structuredClone(user)])),
    claims: new Map([...state.claims].map(([id, claim]) => [id, structuredClone(claim)])),
    ledger: structuredClone(state.ledger),
    notifications: structuredClone(state.notifications),
  };
}

class YoutubeClaimTestDatabase {
  users = new Map<string, TestUser>();
  claims = new Map<string, YoutubeClaim>();
  ledger: LedgerEntry[] = [];
  notifications: Notification[] = [];
  claimTableQueryCount = 0;

  reset(): void {
    this.users = new Map([
      [YOUTUBE_TEST_PLAYER_ID, {
        id: YOUTUBE_TEST_PLAYER_ID,
        name: "YouTube Test Player",
        email: "youtube-player@example.test",
        role: "user",
        wallet_coins: 10,
        phone: null,
        game_uid: null,
        status: "active",
        auth_version: 0,
      }],
      [YOUTUBE_TEST_ADMIN_ID, {
        id: YOUTUBE_TEST_ADMIN_ID,
        name: "YouTube Test Admin",
        email: "youtube-admin@example.test",
        role: "admin",
        wallet_coins: 0,
        phone: null,
        game_uid: null,
        status: "active",
        auth_version: 0,
      }],
      [YOUTUBE_TEST_TOURNAMENT_ADMIN_ID, {
        id: YOUTUBE_TEST_TOURNAMENT_ADMIN_ID,
        name: "YouTube Test Tournament Admin",
        email: "youtube-tournament-admin@example.test",
        role: "tournament_admin",
        wallet_coins: 0,
        phone: null,
        game_uid: null,
        status: "active",
        auth_version: 0,
      }],
    ]);
    this.claims = new Map([[YOUTUBE_TEST_CLAIM_ID, {
      id: YOUTUBE_TEST_CLAIM_ID,
      user_id: YOUTUBE_TEST_PLAYER_ID,
      task_key: "youtube_subscribe",
      reward_coins: 2,
      status: "pending",
      review_reason: null,
      reviewed_by: null,
      reward_ledger_id: null,
      created_at: new Date("2026-10-01T12:00:00.000Z"),
      reviewed_at: null,
    }]]);
    this.ledger = [];
    this.notifications = [];
    this.claimTableQueryCount = 0;
  }

  snapshot(): DatabaseState {
    return cloneState({
      users: this.users,
      claims: this.claims,
      ledger: this.ledger,
      notifications: this.notifications,
    });
  }

  async query<T = unknown>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.includes("daily007_v2_youtube_subscribe_claims")) {
      this.claimTableQueryCount += 1;
    }
    let rows: unknown[];

    if (normalized.startsWith(
      "SELECT id, name, email, role, wallet_coins, phone, game_uid, status, auth_version FROM daily007_v2_users",
    )) {
      const user = this.users.get(String(values[0] ?? ""));
      rows = user ? [structuredClone(user)] : [];
    } else if (
      normalized === "SELECT pg_advisory_xact_lock_shared(740073)" ||
      normalized === "SELECT pg_advisory_xact_lock(740073)"
    ) {
      rows = [];
    } else if (normalized === "SELECT role, status FROM daily007_v2_users WHERE id = $1 FOR SHARE") {
      const user = this.users.get(String(values[0] ?? ""));
      rows = user ? [{ role: user.role, status: user.status }] : [];
    } else if (normalized === "SELECT * FROM daily007_v2_youtube_subscribe_claims WHERE id = $1 FOR UPDATE") {
      const claim = this.claims.get(String(values[0] ?? ""));
      rows = claim ? [structuredClone(claim)] : [];
    } else if (normalized.startsWith(
      "SELECT id FROM daily007_v2_youtube_subscribe_claims WHERE user_id = $1",
    )) {
      rows = [...this.claims.values()]
        .filter((claim) =>
          claim.user_id === values[0] &&
          claim.id !== values[1] &&
          claim.task_key === "youtube_subscribe" &&
          claim.status === "approved",
        )
        .map(({ id }) => ({ id }));
    } else if (normalized === "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE") {
      const user = this.users.get(String(values[0] ?? ""));
      rows = user ? [{ wallet_coins: user.wallet_coins }] : [];
    } else if (normalized === "SELECT id FROM daily007_v2_wallet_ledger WHERE idempotency_key = $1") {
      const ledger = this.ledger.find((entry) => entry.idempotency_key === values[0]);
      rows = ledger ? [{ id: ledger.id }] : [];
    } else if (normalized === "UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1") {
      const user = this.users.get(String(values[0] ?? ""));
      if (user) user.wallet_coins = Number(values[1]);
      rows = [];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_wallet_ledger")) {
      const [userId, amount, balanceAfter, idempotencyKey, details] = values as [
        string, number, number, string, Record<string, unknown>,
      ];
      const entry: LedgerEntry = {
        id: "63000000-0000-4000-8000-000000000001",
        user_id: userId,
        amount,
        balance_after: balanceAfter,
        reason: "youtube_subscribe_reward",
        idempotency_key: idempotencyKey,
        details,
      };
      this.ledger.push(entry);
      rows = [{ id: entry.id }];
    } else if (normalized.startsWith("UPDATE daily007_v2_youtube_subscribe_claims")) {
      const [claimId, reviewedBy, ledgerId] = values as [string, string, string];
      const claim = this.claims.get(claimId);
      if (claim) {
        Object.assign(claim, {
          status: "approved",
          reviewed_by: reviewedBy,
          reviewed_at: new Date("2026-10-01T12:05:00.000Z"),
          review_reason: null,
          reward_ledger_id: ledgerId,
        });
        rows = [structuredClone(claim)];
      } else {
        rows = [];
      }
    } else if (normalized.startsWith("INSERT INTO daily007_v2_notifications")) {
      const [user_id, body] = values as [string, string];
      this.notifications.push({
        user_id,
        title: normalized.includes("'YouTube task approved'") ? "YouTube task approved" : "YouTube task not approved",
        body,
        type: "reward",
      });
      rows = [];
    } else {
      throw new Error(`Unexpected YouTube claim test SQL: ${normalized}`);
    }

    return { rows: rows as T[] };
  }
}

export const youtubeClaimTestDb = new YoutubeClaimTestDatabase();
youtubeClaimTestDb.reset();

export const pool = {
  query: <T = unknown>(sql: string, values?: unknown[]) =>
    youtubeClaimTestDb.query<T>(sql, values),
  connect: async () => {
    let transactionSnapshot: DatabaseState | null = null;
    return {
      query: async <T = unknown>(sql: string, values?: unknown[]) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized === "BEGIN") {
          transactionSnapshot = youtubeClaimTestDb.snapshot();
          return { rows: [] as T[] };
        }
        if (normalized === "ROLLBACK" && transactionSnapshot) {
          const snapshot = transactionSnapshot;
          youtubeClaimTestDb.users = snapshot.users;
          youtubeClaimTestDb.claims = snapshot.claims;
          youtubeClaimTestDb.ledger = snapshot.ledger;
          youtubeClaimTestDb.notifications = snapshot.notifications;
          return { rows: [] as T[] };
        }
        if (normalized === "COMMIT" || normalized === "ROLLBACK") {
          transactionSnapshot = null;
          return { rows: [] as T[] };
        }
        return youtubeClaimTestDb.query<T>(normalized, values);
      },
      release: () => {},
    };
  },
};
