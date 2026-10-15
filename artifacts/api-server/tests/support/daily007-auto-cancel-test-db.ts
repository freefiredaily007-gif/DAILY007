type TestMatch = {
  id: string;
  title: string;
  mode: string;
  game_mode: string | null;
  status: string;
  capacity: number;
  startsAtWallMs: number;
  hasWinner: boolean;
  enabled: boolean;
  isFull: boolean;
  roomId: string | null;
  roomPassword: string | null;
  roomPublished: boolean;
};

type TestRegistration = {
  id: string;
  match_id: string;
  captain_user_id: string;
  entry_coins_paid: number;
  status: string;
};

type TestAccount = {
  id: string;
  wallet_coins: number;
};

type TestLedgerEntry = {
  userId: string;
  amount: number;
  balanceAfter: number;
  reason: string;
  matchId: string | null;
  registrationId: string;
  details?: Record<string, unknown>;
  createdAt?: Date;
};

type TestDatabaseSnapshot = {
  matches: Map<string, TestMatch>;
  registrations: TestRegistration[];
  accounts: Map<string, TestAccount>;
  ledger: Map<string, TestLedgerEntry>;
};

type TestDatabaseSeed = {
  nowMs: number;
  matches: TestMatch[];
  registrations: TestRegistration[];
  accounts: TestAccount[];
  settings?: Record<string, unknown>;
  ledger?: {
    idempotencyKey: string;
    entry: TestLedgerEntry;
  }[];
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const ACTIVE_REGISTRATION_STATUSES = new Set(["approved", "pending"]);
const REFUND_REASONS = new Set(["registration_refund", "tournament_cancel_refund"]);
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map([...source].map(([key, value]) => [key, structuredClone(value)]));
}

class InMemoryRowLock {
  private locked = false;
  private readonly waiters: (() => void)[] = [];
  private readonly waitCountWaiters: { target: number; resolve: () => void }[] = [];
  private waitAttempts = 0;

  get waitCount(): number {
    return this.waitAttempts;
  }

  waitForWaitCount(target: number): Promise<void> {
    if (this.waitAttempts >= target) return Promise.resolve();
    return new Promise<void>((resolve) => this.waitCountWaiters.push({ target, resolve }));
  }

  async acquire(): Promise<() => void> {
    if (this.locked) {
      this.waitAttempts += 1;
      for (let index = this.waitCountWaiters.length - 1; index >= 0; index -= 1) {
        const waiter = this.waitCountWaiters[index];
        if (this.waitAttempts >= waiter.target) {
          this.waitCountWaiters.splice(index, 1);
          waiter.resolve();
        }
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.locked = true;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.locked = false;
    };
  }
}

class Daily007AutoCancelTestDatabase {
  nowMs = 0;
  matches = new Map<string, TestMatch>();
  registrations: TestRegistration[] = [];
  accounts = new Map<string, TestAccount>();
  ledger = new Map<string, TestLedgerEntry>();
  settings: Record<string, unknown> = {};
  private readonly matchRowLocks = new Map<string, InMemoryRowLock>();
  private readonly failedMatchFinalizations = new Set<string>();
  private readonly finalizationWaiterCounts = new Map<string, number>();
  private readonly failedRefundWrites = new Map<string, string | null>();
  private failedCursorSaves = 0;
  private failedSettingsReads = 0;
  // Kept outside transaction snapshots so tests can verify that a later failure
  // happened after an earlier wallet or ledger write had been attempted.
  readonly mutationTrace: string[] = [];
  readonly candidateSelectionSizes: number[] = [];

  reset(seed: TestDatabaseSeed): void {
    this.nowMs = seed.nowMs;
    this.matches = new Map(seed.matches.map((match) => [match.id, structuredClone(match)]));
    this.registrations = structuredClone(seed.registrations);
    this.accounts = new Map(seed.accounts.map((account) => [account.id, structuredClone(account)]));
    this.ledger = new Map(
      (seed.ledger ?? []).map(({ idempotencyKey, entry }) => [
        idempotencyKey,
        structuredClone(entry),
      ]),
    );
    this.settings = structuredClone(seed.settings ?? {});
    this.matchRowLocks.clear();
    this.failedMatchFinalizations.clear();
    this.finalizationWaiterCounts.clear();
    this.failedRefundWrites.clear();
    this.failedCursorSaves = 0;
    this.failedSettingsReads = 0;
    this.mutationTrace.length = 0;
    this.candidateSelectionSizes.length = 0;
  }

  failNextMatchFinalization(matchId: string): void {
    this.failedMatchFinalizations.add(matchId);
  }

  failNextMatchFinalizationAfterWaitingCancellations(
    matchId: string,
    waiterCount = 1,
  ): void {
    this.failedMatchFinalizations.add(matchId);
    this.finalizationWaiterCounts.set(matchId, waiterCount);
  }

  failNextRefundWriteAfterWalletMutation(
    matchId: string,
    registrationId?: string,
  ): void {
    this.failedRefundWrites.set(matchId, registrationId ?? null);
  }

  failNextCursorSave(): void {
    this.failedCursorSaves += 1;
  }

  failNextSettingsRead(): void {
    this.failedSettingsReads += 1;
  }

  setNow(nowMs: number): void {
    this.nowMs = nowMs;
  }

  matchRowLockWaitCount(matchId: string): number {
    return this.matchRowLocks.get(matchId)?.waitCount ?? 0;
  }

  waitForMatchRowLockWaitCount(matchId: string, target = 1): Promise<void> {
    return this.rowLockForMatch(matchId).waitForWaitCount(target);
  }

  private rowLockForMatch(matchId: string): InMemoryRowLock {
    let lock = this.matchRowLocks.get(matchId);
    if (!lock) {
      lock = new InMemoryRowLock();
      this.matchRowLocks.set(matchId, lock);
    }
    return lock;
  }

  private snapshot(): TestDatabaseSnapshot {
    return {
      matches: cloneMap(this.matches),
      registrations: structuredClone(this.registrations),
      accounts: cloneMap(this.accounts),
      ledger: cloneMap(this.ledger),
    };
  }

  private restore(snapshot: TestDatabaseSnapshot): void {
    this.matches = snapshot.matches;
    this.registrations = snapshot.registrations;
    this.accounts = snapshot.accounts;
    this.ledger = snapshot.ledger;
  }

  async connect() {
    let transactionSnapshot: TestDatabaseSnapshot | null = null;
    const rowLockReleases: Array<() => void> = [];
    const lockedMatchIds = new Set<string>();
    const releaseRowLocks = () => {
      for (const release of rowLockReleases.splice(0).reverse()) release();
      lockedMatchIds.clear();
    };
    return {
      query: async <T = unknown>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized === "BEGIN") {
          transactionSnapshot = this.snapshot();
          return { rows: [] as T[] };
        }
        if (normalized === "COMMIT") {
          transactionSnapshot = null;
          releaseRowLocks();
          return { rows: [] as T[] };
        }
        if (normalized === "ROLLBACK") {
          if (transactionSnapshot) this.restore(transactionSnapshot);
          transactionSnapshot = null;
          releaseRowLocks();
          return { rows: [] as T[] };
        }
        if (normalized.includes("FOR UPDATE OF m")) {
          const matchId = String(values[0]);
          if (!lockedMatchIds.has(matchId)) {
            rowLockReleases.push(await this.rowLockForMatch(matchId).acquire());
            lockedMatchIds.add(matchId);
            if (transactionSnapshot) transactionSnapshot = this.snapshot();
          }
        }
        return this.query<T>(normalized, values);
      },
      release: releaseRowLocks,
    };
  }

  async query<T = unknown>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, " ").trim();
    let rows: unknown[] = [];

    if (normalized === "SELECT settings FROM daily007_v2_settings WHERE id = 1") {
      if (this.failedSettingsReads > 0) {
        this.failedSettingsReads -= 1;
        throw new Error("Injected automatic-cancellation settings read failure.");
      }
      rows = [{ settings: structuredClone(this.settings) }];
    } else if (
      normalized.startsWith("INSERT INTO daily007_v2_settings (id, settings)") &&
      normalized.includes("__daily007AutoCancelCursor")
    ) {
      if (this.failedCursorSaves > 0) {
        this.failedCursorSaves -= 1;
        throw new Error("Injected automatic-cancellation cursor persistence failure.");
      }
      this.settings.__daily007AutoCancelCursor = JSON.parse(String(values[0])) as unknown;
    } else if (
      normalized.startsWith('SELECT m.id, m.starts_at AS "startsAt" FROM daily007_v2_matches m') &&
      normalized.includes("ORDER BY m.starts_at ASC, m.id ASC") &&
      normalized.includes("LIMIT $1")
    ) {
      const batchSize = Number(values[0]);
      const cursorStartsAt = values[1] as Date | string | null;
      const cursorTime = cursorStartsAt === null ? null : new Date(cursorStartsAt).getTime();
      const cursorId = values[2] == null ? null : String(values[2]);
      rows = [...this.matches.values()]
        .filter((match) => {
          const activeCount = this.registrations.filter((registration) =>
            registration.match_id === match.id &&
            ACTIVE_REGISTRATION_STATUSES.has(registration.status),
          ).length;
          const gameMode = match.game_mode?.trim().toLowerCase() ?? "";
          const storageMode = match.mode.trim().toLowerCase();
          const automaticMode = gameMode === "clash_squad" ||
            gameMode === "lone_wolf" ||
            (!gameMode && storageMode === "clash");
          return match.startsAtWallMs <= this.nowMs + IST_OFFSET_MS &&
            match.status !== "cancelled" &&
            automaticMode &&
            activeCount < match.capacity &&
            !match.hasWinner &&
            (cursorTime === null ||
              match.startsAtWallMs > cursorTime ||
              (match.startsAtWallMs === cursorTime && match.id > cursorId!));
        })
        .sort((a, b) =>
          a.startsAtWallMs - b.startsAtWallMs ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        )
        .slice(0, batchSize)
        .map((match) => ({ id: match.id, startsAt: new Date(match.startsAtWallMs) }));
      this.candidateSelectionSizes.push(rows.length);
    } else if (normalized.includes("FOR UPDATE OF m")) {
      const match = this.matches.get(String(values[0]));
      rows = match ? [{
        id: match.id,
        title: match.title,
        mode: match.mode,
        game_mode: match.game_mode,
        status: match.status,
        capacity: match.capacity,
        has_started: match.startsAtWallMs <= this.nowMs + IST_OFFSET_MS,
        has_winner: match.hasWinner,
      }] : [];
    } else if (normalized.includes("count(*)::integer AS filled_slots")) {
      const matchId = String(values[0]);
      rows = [{
        filled_slots: this.registrations.filter((registration) =>
          registration.match_id === matchId &&
          ACTIVE_REGISTRATION_STATUSES.has(registration.status),
        ).length,
      }];
    } else if (normalized.includes("ORDER BY captain_user_id, id")) {
      const matchId = String(values[0]);
      rows = this.registrations
        .filter((registration) =>
          registration.match_id === matchId &&
          ACTIVE_REGISTRATION_STATUSES.has(registration.status),
        )
        .sort((a, b) =>
          a.captain_user_id.localeCompare(b.captain_user_id) || a.id.localeCompare(b.id),
        );
    } else if (
      normalized.includes("FROM daily007_v2_wallet_ledger") &&
      normalized.includes("registration_id = $1")
    ) {
      const registrationId = String(values[0]);
      const priorRefund = [...this.ledger.values()].find((entry) =>
        entry.registrationId === registrationId && REFUND_REASONS.has(entry.reason),
      );
      rows = priorRefund ? [{ id: "prior-refund" }] : [];
    } else if (
      normalized.includes("FROM daily007_v2_wallet_ledger") &&
      normalized.includes("user_id = $1")
    ) {
      const userId = String(values[0]);
      rows = [...this.ledger.entries()]
        .filter(([, entry]) => entry.userId === userId)
        .sort(([, left], [, right]) =>
          (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0),
        )
        .slice(0, 500)
        .map(([idempotencyKey, entry]) => {
          const description = entry.details?.description;
          const tournamentId = entry.matchId ??
            (typeof description === "string" ? description.match(UUID_IN_TEXT)?.[0] : null) ??
            (typeof entry.details?.tournamentId === "string" ? entry.details.tournamentId : null);
          return {
            id: `ledger-${idempotencyKey}`,
            amount: entry.amount,
            balanceAfter: entry.balanceAfter,
            reason: entry.reason,
            details: entry.details ?? {},
            createdAt: entry.createdAt ?? new Date(this.nowMs),
            matchId: entry.matchId,
            tournamentTitle: tournamentId ? this.matches.get(tournamentId)?.title ?? null : null,
          };
        });
    } else if (
      normalized.startsWith(
        "SELECT id, name, email, role, wallet_coins, phone, game_uid, status, auth_version FROM daily007_v2_users",
      )
    ) {
      const account = this.accounts.get(String(values[0]));
      rows = account ? [{
        id: account.id,
        name: "Test Wallet Player",
        email: `${account.id}@example.test`,
        role: "user",
        wallet_coins: account.wallet_coins,
        phone: null,
        game_uid: null,
        status: "active",
        auth_version: 0,
      }] : [];
    } else if (normalized.startsWith("SELECT wallet_coins FROM daily007_v2_users")) {
      const account = this.accounts.get(String(values[0]));
      rows = account ? [{ wallet_coins: account.wallet_coins }] : [];
    } else if (normalized.startsWith("UPDATE daily007_v2_users SET wallet_coins")) {
      const account = this.accounts.get(String(values[0]));
      if (!account) throw new Error(`Unknown test account: ${String(values[0])}`);
      account.wallet_coins = Number(values[1]);
      this.mutationTrace.push(`wallet:${String(values[0])}`);
    } else if (normalized.includes("INSERT INTO daily007_v2_wallet_ledger")) {
      const [userId, amount, balanceAfter, matchId, registrationId, idempotencyKey] = values;
      const key = String(idempotencyKey);
      const matchIdString = String(matchId);
      const registrationIdString = String(registrationId);
      const failingRegistrationId = this.failedRefundWrites.get(matchIdString);
      if (
        this.failedRefundWrites.has(matchIdString) &&
        (failingRegistrationId === null ||
          failingRegistrationId === registrationIdString)
      ) {
        this.failedRefundWrites.delete(matchIdString);
        if (this.mutationTrace.at(-1) !== `wallet:${String(userId)}`) {
          throw new Error(
            "Injected refund write failure requires a preceding wallet mutation.",
          );
        }
        await this.waitForMatchRowLockWaitCount(matchIdString);
        this.mutationTrace.push(`refund-write-failure:${registrationIdString}`);
        throw new Error(
          `Injected tournament cancellation refund write failure: ${matchIdString}`,
        );
      }
      if (!this.ledger.has(key)) {
        this.ledger.set(key, {
          userId: String(userId),
          amount: Number(amount),
          balanceAfter: Number(balanceAfter),
          reason: "tournament_cancel_refund",
          matchId: String(matchId),
          registrationId: String(registrationId),
          details: JSON.parse(String(values[6])) as Record<string, unknown>,
          createdAt: new Date(this.nowMs),
        });
        this.mutationTrace.push(`ledger:${String(registrationId)}`);
        rows = [{ id: `ledger-${this.ledger.size}` }];
      }
    } else if (normalized.startsWith("UPDATE daily007_v2_matches")) {
      const matchId = String(values[0]);
      if (this.failedMatchFinalizations.delete(matchId)) {
        const waiterCount = this.finalizationWaiterCounts.get(matchId) ?? 0;
        this.finalizationWaiterCounts.delete(matchId);
        if (waiterCount > 0) {
          await this.waitForMatchRowLockWaitCount(matchId, waiterCount);
        }
        this.mutationTrace.push(`finalize:${matchId}`);
        throw new Error(`Injected tournament finalization failure: ${matchId}`);
      }
      const match = this.matches.get(matchId);
      if (match) {
        match.enabled = false;
        match.isFull = false;
        match.status = "cancelled";
        match.roomId = null;
        match.roomPassword = null;
        match.roomPublished = false;
      }
    } else {
      throw new Error(`Unexpected auto-cancellation test SQL: ${normalized}`);
    }

    return { rows: rows as T[] };
  }
}

export const autoCancellationTestDb = new Daily007AutoCancelTestDatabase();

export const pool = {
  query: <T = unknown>(sql: string, values?: unknown[]) => autoCancellationTestDb.query<T>(sql, values),
  connect: () => autoCancellationTestDb.connect(),
};