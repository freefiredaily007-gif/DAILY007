export type RecoveryTestUser = {
  id: string;
  name: string;
  email: string;
  role: "user" | "tournament_admin" | "admin";
  wallet_coins: number;
  phone: string | null;
  game_uid: string | null;
  status: "active" | "blocked";
  auth_version: number;
  clerk_user_id: string | null;
};

export type RecoveryTestRequest = {
  id: string;
  user_id: string;
  google_clerk_user_id: string;
  google_email: string;
  status: "pending" | "approved" | "rejected";
  created_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  review_note: string | null;
  review_method: "full_admin" | "owner_code" | null;
};

type QueryResult<T> = { rows: T[]; rowCount: number | null };
type Query = <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
type Snapshot = {
  users: Map<string, RecoveryTestUser>;
  requests: Map<string, RecoveryTestRequest>;
  nextRequestId: number;
};

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map([...source].map(([key, value]) => [key, structuredClone(value)]));
}

class MemoryRecoveryDatabase {
  users = new Map<string, RecoveryTestUser>();
  requests = new Map<string, RecoveryTestRequest>();
  queryHistory: Array<{ sql: string; values: unknown[] }> = [];
  private nextRequestId = 1;

  reset(): void {
    this.users.clear();
    this.requests.clear();
    this.queryHistory = [];
    this.nextRequestId = 1;
  }

  seedUser(
    user: Pick<RecoveryTestUser, "id" | "email"> & Partial<Omit<RecoveryTestUser, "id" | "email">>,
  ): RecoveryTestUser {
    const seeded: RecoveryTestUser = {
      id: user.id,
      name: user.name ?? "Recovery Test Account",
      email: user.email,
      role: user.role ?? "user",
      wallet_coins: user.wallet_coins ?? 0,
      phone: user.phone ?? null,
      game_uid: user.game_uid ?? null,
      status: user.status ?? "active",
      auth_version: user.auth_version ?? 0,
      clerk_user_id: user.clerk_user_id ?? null,
    };
    this.users.set(seeded.id, seeded);
    return seeded;
  }

  blockUser(userId: string): void {
    const user = this.users.get(userId);
    if (!user) throw new Error("Cannot block an unknown recovery test account.");
    user.status = "blocked";
  }

  async connect(): Promise<{ query: Query; release(): void }> {
    let transactionSnapshot: Snapshot | null = null;
    return {
      query: async <T = unknown>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized === "BEGIN") {
          transactionSnapshot = this.snapshot();
          this.record(normalized, values);
          return { rows: [], rowCount: 0 };
        }
        if (normalized === "COMMIT") {
          transactionSnapshot = null;
          this.record(normalized, values);
          return { rows: [], rowCount: 0 };
        }
        if (normalized === "ROLLBACK") {
          if (transactionSnapshot) this.restore(transactionSnapshot);
          transactionSnapshot = null;
          this.record(normalized, values);
          return { rows: [], rowCount: 0 };
        }
        return this.execute<T>(normalized, values);
      },
      release: () => {},
    };
  }

  async query<T = unknown>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    return this.execute<T>(sql.replace(/\s+/g, " ").trim(), values);
  }

  private snapshot(): Snapshot {
    return {
      users: cloneMap(this.users),
      requests: cloneMap(this.requests),
      nextRequestId: this.nextRequestId,
    };
  }

  private restore(snapshot: Snapshot): void {
    this.users = snapshot.users;
    this.requests = snapshot.requests;
    this.nextRequestId = snapshot.nextRequestId;
  }

  private record(sql: string, values: unknown[]): void {
    this.queryHistory.push({ sql, values: structuredClone(values) });
  }

  private requestRow(request: RecoveryTestRequest): Record<string, unknown> | null {
    const account = this.users.get(request.user_id);
    if (!account) return null;
    return {
      id: request.id,
      user_id: request.user_id,
      google_clerk_user_id: request.google_clerk_user_id,
      google_email: request.google_email,
      status: request.status,
      account_email: account.email,
      account_status: account.status,
      account_clerk_user_id: account.clerk_user_id,
    };
  }

  private execute<T>(sql: string, values: unknown[]): QueryResult<T> {
    this.record(sql, values);
    const first = String(values[0] ?? "");
    const second = String(values[1] ?? "");
    let rows: unknown[] = [];
    let rowCount: number | null = null;

    if (sql === "SELECT pg_advisory_xact_lock_shared(740073)" ||
        sql.startsWith("SELECT pg_advisory_xact_lock(") ||
        sql.startsWith("SELECT pg_advisory_xact_lock_shared(")) {
      rows = [];
    } else if (sql.startsWith("SELECT role, status FROM daily007_v2_users WHERE id = $1 FOR SHARE")) {
      const user = this.users.get(first);
      rows = user ? [{ role: user.role, status: user.status }] : [];
    } else if (sql.startsWith(
      "SELECT id, name, email, role, wallet_coins, phone, game_uid, status, auth_version FROM daily007_v2_users WHERE id = $1",
    )) {
      const user = this.users.get(first);
      rows = user ? [structuredClone(user)] : [];
    } else if (sql.startsWith("SELECT id FROM daily007_v2_users WHERE clerk_user_id = $1")) {
      const user = [...this.users.values()].find((candidate) => candidate.clerk_user_id === first);
      rows = user ? [{ id: user.id }] : [];
    } else if (sql.startsWith("SELECT id, email, status, clerk_user_id FROM daily007_v2_users")) {
      const user = [...this.users.values()].find((candidate) => candidate.email.toLowerCase() === first);
      rows = user ? [{
        id: user.id,
        email: user.email,
        status: user.status,
        clerk_user_id: user.clerk_user_id,
      }] : [];
    } else if (sql.startsWith("SELECT id, email, status, role, clerk_user_id FROM daily007_v2_users")) {
      const user = [...this.users.values()].find((candidate) => candidate.email.toLowerCase() === first);
      rows = user ? [{
        id: user.id,
        email: user.email,
        status: user.status,
        role: user.role,
        clerk_user_id: user.clerk_user_id,
      }] : [];
    } else if (sql.startsWith("SELECT id FROM daily007_v2_users WHERE role = 'admin'")) {
      rows = [...this.users.values()]
        .filter((user) => user.role === "admin")
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((user) => ({ id: user.id }));
    } else if (sql.includes("FROM daily007_v2_google_recovery_requests") &&
               sql.includes("WHERE (user_id = $1 OR google_clerk_user_id = $2)")) {
      const matches = [...this.requests.values()].filter((request) =>
        request.status === "pending" &&
        (request.user_id === first || request.google_clerk_user_id === second)
      );
      rows = sql.startsWith("SELECT google_clerk_user_id")
        ? matches.map((request) => ({ google_clerk_user_id: request.google_clerk_user_id }))
        : matches.map((request) => ({
          id: request.id,
          user_id: request.user_id,
          google_clerk_user_id: request.google_clerk_user_id,
        }));
    } else if (sql.includes("FROM daily007_v2_google_recovery_requests r JOIN daily007_v2_users u") &&
               sql.includes("WHERE r.id = $1")) {
      const request = this.requests.get(first);
      if (request && (!sql.includes("r.status = 'pending'") || request.status === "pending")) {
        const joined = this.requestRow(request);
        rows = joined ? [joined] : [];
      }
    } else if (sql.includes("FROM daily007_v2_google_recovery_requests r JOIN daily007_v2_users u") &&
               sql.includes("WHERE r.status = 'pending'")) {
      rows = [...this.requests.values()]
        .filter((request) => request.status === "pending")
        .map((request) => {
          const account = this.users.get(request.user_id);
          return account ? {
            id: request.id,
            userId: request.user_id,
            googleEmail: request.google_email,
            createdAt: request.created_at,
            accountName: account.name,
            accountEmail: account.email,
            phone: account.phone,
            gameUid: account.game_uid,
            accountRole: account.role,
          } : null;
        })
        .filter((row) => row !== null);
    } else if (sql.startsWith("INSERT INTO daily007_v2_google_recovery_requests")) {
      const id = `00000000-0000-4000-8000-${String(this.nextRequestId++).padStart(12, "0")}`;
      const ownerCodeApproval = sql.includes("review_method") && sql.includes("'owner_code'");
      const request: RecoveryTestRequest = {
        id,
        user_id: first,
        google_clerk_user_id: second,
        google_email: String(values[2] ?? ""),
        status: ownerCodeApproval ? "approved" : "pending",
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        reviewed_at: ownerCodeApproval ? new Date("2026-01-01T00:00:00.000Z") : null,
        reviewed_by: ownerCodeApproval ? first : null,
        review_note: ownerCodeApproval ? String(values[3] ?? "") : null,
        review_method: ownerCodeApproval ? "owner_code" : null,
      };
      this.requests.set(id, request);
      rows = [{ id }];
      rowCount = 1;
    } else if (sql.startsWith("UPDATE daily007_v2_users SET clerk_user_id = $2")) {
      const user = this.users.get(first);
      if (user && user.clerk_user_id === null) {
        user.clerk_user_id = second;
        rows = sql.includes("RETURNING id") ? [{ id: user.id }] : [];
        rowCount = 1;
      } else {
        rowCount = 0;
      }
    } else if (sql.startsWith("UPDATE daily007_v2_google_recovery_requests")) {
      const request = this.requests.get(first);
      if (request) {
        if (sql.includes("review_method = 'full_admin'")) {
          request.status = second as RecoveryTestRequest["status"];
          request.reviewed_by = String(values[2] ?? "");
          request.review_note = String(values[3] ?? "");
          request.review_method = "full_admin";
        } else if (sql.includes("review_method = 'owner_code'")) {
          request.status = "approved";
          request.reviewed_by = second;
          request.review_note = String(values[2] ?? "");
          request.review_method = "owner_code";
        }
        request.reviewed_at = new Date("2026-01-01T00:00:00.000Z");
        rowCount = 1;
      } else {
        rowCount = 0;
      }
    }

    return { rows: rows as T[], rowCount: rowCount ?? rows.length };
  }
}

export const recoveryTestDb = new MemoryRecoveryDatabase();

export const pool = {
  query: <T = unknown>(sql: string, values: unknown[] = []) => recoveryTestDb.query<T>(sql, values),
  connect: () => recoveryTestDb.connect(),
};