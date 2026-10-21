type TestUser = {
  id: string;
  name: string;
  email: string;
  role: "user";
  wallet_coins: number;
  phone: null;
  game_uid: null;
  status: "active";
  auth_version: number;
};

type TestMatch = {
  id: string;
  mode: string;
  game_mode: string;
  team_type: string;
  capacity: number;
  status: string;
  is_full: boolean;
  entry_coins: number;
  starts_at: Date;
  enabled: boolean;
};

type TestRegistration = {
  id: string;
  match_id: string;
  captain_user_id: string;
  captain_name: string;
  captain_game_name: string;
  captain_game_uid: string;
  team_name: string;
  assigned_group_number: number | null;
  entry_coins_paid: number;
  status: "approved" | "pending" | "rejected";
};

type TestRosterMember = {
  registration_id: string;
  member_uid: string | null;
};

type TestLedgerEntry = {
  user_id: string;
  amount: number;
  balance_after: number;
  reason: "match_entry";
  match_id: string;
  registration_id: string;
};

type Snapshot = {
  users: Map<string, TestUser>;
  match: TestMatch;
  secondMatch: TestMatch;
  registrations: TestRegistration[];
  roster: TestRosterMember[];
  ledger: TestLedgerEntry[];
  nextRegistrationNumber: number;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class AsyncMutex {
  private tail = Promise.resolve();
  private active = false;
  private waiting = 0;

  async acquire(onQueued?: () => void): Promise<() => void> {
    const previous = this.tail;
    const queued = this.active || this.waiting > 0;
    const turn = deferred();
    this.tail = previous.then(() => turn.promise);
    this.waiting += 1;
    if (queued) onQueued?.();
    await previous;
    this.waiting -= 1;
    this.active = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = false;
      turn.resolve();
    };
  }
}

type MatchLockHold = {
  firstAcquired: Promise<void>;
  secondQueued: Promise<void>;
  release: () => void;
  firstAcquiredSignal: ReturnType<typeof deferred>;
  secondQueuedSignal: ReturnType<typeof deferred>;
  continueSignal: ReturnType<typeof deferred>;
  paused: boolean;
};

type WalletLockHold = {
  firstAcquired: Promise<void>;
  secondQueued: Promise<void>;
  release: () => void;
  firstAcquiredSignal: ReturnType<typeof deferred>;
  secondQueuedSignal: ReturnType<typeof deferred>;
  continueSignal: ReturnType<typeof deferred>;
  paused: boolean;
};

export const TEST_MATCH_ID = "54000000-0000-4000-8000-000000000100";
export const TEST_SECOND_MATCH_ID = "54000000-0000-4000-8000-000000000101";
export const FIRST_PLAYER_ID = "54000000-0000-4000-8000-000000000001";
export const SECOND_PLAYER_ID = "54000000-0000-4000-8000-000000000002";
const INCUMBENT_PLAYER_ID = "54000000-0000-4000-8000-000000000003";

function testUser(id: string, name: string, email: string, walletCoins: number): TestUser {
  return {
    id,
    name,
    email,
    role: "user",
    wallet_coins: walletCoins,
    phone: null,
    game_uid: null,
    status: "active",
    auth_version: 0,
  };
}

class RegistrationCapacityTestDatabase {
  users = new Map<string, TestUser>();
  match!: TestMatch;
  secondMatch!: TestMatch;
  registrations: TestRegistration[] = [];
  roster: TestRosterMember[] = [];
  ledger: TestLedgerEntry[] = [];
  private nextRegistrationNumber = 11;
  private matchRowLocks = new Map<string, AsyncMutex>();
  private walletRowLocks = new Map<string, AsyncMutex>();
  private lockHold: MatchLockHold | null = null;
  private walletLockHold: WalletLockHold | null = null;
  private failNextLedgerInsert = false;
  private failNextRegistrationInsertWithUniqueViolation = false;
  rosterRowsAtLedgerFailure: number | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.users = new Map([
      [FIRST_PLAYER_ID, testUser(FIRST_PLAYER_ID, "First Player", "first@example.test", 100)],
      [SECOND_PLAYER_ID, testUser(SECOND_PLAYER_ID, "Second Player", "second@example.test", 100)],
      [INCUMBENT_PLAYER_ID, testUser(INCUMBENT_PLAYER_ID, "Existing Player", "existing@example.test", 93)],
    ]);
    this.match = {
      id: TEST_MATCH_ID,
      mode: "solo",
      game_mode: "battle_royale",
      team_type: "solo",
      capacity: 2,
      status: "open",
      is_full: false,
      entry_coins: 7,
      starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      enabled: true,
    };
    this.secondMatch = {
      id: TEST_SECOND_MATCH_ID,
      mode: "solo",
      game_mode: "battle_royale",
      team_type: "solo",
      capacity: 4,
      status: "open",
      is_full: false,
      entry_coins: 7,
      starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      enabled: true,
    };
    const existingRegistrationId = "54000000-0000-4000-8000-000000000010";
    this.registrations = [{
      id: existingRegistrationId,
      match_id: TEST_MATCH_ID,
      captain_user_id: INCUMBENT_PLAYER_ID,
      captain_name: "Existing Player",
      captain_game_name: "Existing Captain",
      captain_game_uid: "FF-EXISTING-001",
      team_name: "",
      assigned_group_number: 1,
      entry_coins_paid: 7,
      status: "approved",
    }];
    this.roster = [];
    this.ledger = [{
      user_id: INCUMBENT_PLAYER_ID,
      amount: -7,
      balance_after: 93,
      reason: "match_entry",
      match_id: TEST_MATCH_ID,
      registration_id: existingRegistrationId,
    }];
    this.nextRegistrationNumber = 11;
    this.matchRowLocks = new Map();
    this.walletRowLocks = new Map();
    this.lockHold = null;
    this.walletLockHold = null;
    this.failNextLedgerInsert = false;
    this.failNextRegistrationInsertWithUniqueViolation = false;
    this.rosterRowsAtLedgerFailure = null;
  }

  failOnNextLedgerInsert(): void {
    this.failNextLedgerInsert = true;
  }

  failOnNextRegistrationInsertAsDuplicate(): void {
    this.failNextRegistrationInsertWithUniqueViolation = true;
  }

  holdNextMatchRowLock(): MatchLockHold {
    const firstAcquiredSignal = deferred();
    const secondQueuedSignal = deferred();
    const continueSignal = deferred();
    const hold: MatchLockHold = {
      firstAcquired: firstAcquiredSignal.promise,
      secondQueued: secondQueuedSignal.promise,
      release: () => continueSignal.resolve(),
      firstAcquiredSignal,
      secondQueuedSignal,
      continueSignal,
      paused: false,
    };
    this.lockHold = hold;
    return hold;
  }

  holdNextWalletRowLock(): WalletLockHold {
    const firstAcquiredSignal = deferred();
    const secondQueuedSignal = deferred();
    const continueSignal = deferred();
    const hold: WalletLockHold = {
      firstAcquired: firstAcquiredSignal.promise,
      secondQueued: secondQueuedSignal.promise,
      release: () => continueSignal.resolve(),
      firstAcquiredSignal,
      secondQueuedSignal,
      continueSignal,
      paused: false,
    };
    this.walletLockHold = hold;
    return hold;
  }

  private matchById(id: string): TestMatch | undefined {
    if (id === this.match.id) return this.match;
    if (id === this.secondMatch.id) return this.secondMatch;
    return undefined;
  }

  private lockFor(locks: Map<string, AsyncMutex>, id: string): AsyncMutex {
    let lock = locks.get(id);
    if (!lock) {
      lock = new AsyncMutex();
      locks.set(id, lock);
    }
    return lock;
  }

  async query<T = unknown>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    return this.execute<T>(sql, values);
  }

  async connect() {
    let snapshot: Snapshot | null = null;
    const releases: Array<() => void> = [];
    const releaseLocks = () => {
      for (const release of releases.splice(0).reverse()) release();
    };
    return {
      query: async <T = unknown>(sql: string, values: unknown[] = []) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized === "BEGIN") return { rows: [] as T[] };
        if (normalized === "COMMIT") {
          snapshot = null;
          releaseLocks();
          return { rows: [] as T[] };
        }
        if (normalized === "ROLLBACK") {
          if (snapshot) this.restore(snapshot);
          snapshot = null;
          releaseLocks();
          return { rows: [] as T[] };
        }
        if (normalized.startsWith("SELECT id, mode, game_mode, team_type, capacity, status, entry_coins, starts_at, enabled FROM daily007_v2_matches") &&
            normalized.endsWith("FOR UPDATE")) {
          const hold = this.lockHold;
          const matchId = String(values[0]);
          const release = await this.lockFor(this.matchRowLocks, matchId)
            .acquire(() => hold?.secondQueuedSignal.resolve());
          releases.push(release);
          if (!snapshot) snapshot = this.snapshot();
          if (hold && !hold.paused) {
            hold.paused = true;
            hold.firstAcquiredSignal.resolve();
            await hold.continueSignal.promise;
            if (this.lockHold === hold) this.lockHold = null;
          }
        }
        if (normalized === "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE") {
          const hold = this.walletLockHold;
          const userId = String(values[0]);
          let waitedForLock = false;
          const release = await this.lockFor(this.walletRowLocks, userId)
            .acquire(() => {
              waitedForLock = true;
              hold?.secondQueuedSignal.resolve();
            });
          releases.push(release);
          if (waitedForLock) snapshot = this.snapshot();
          if (hold && !hold.paused) {
            hold.paused = true;
            hold.firstAcquiredSignal.resolve();
            await hold.continueSignal.promise;
            if (this.walletLockHold === hold) this.walletLockHold = null;
          }
        }
        return this.execute<T>(normalized, values);
      },
      release: () => {
        if (snapshot) this.restore(snapshot);
        snapshot = null;
        releaseLocks();
      },
    };
  }

  private snapshot(): Snapshot {
    return {
      users: new Map([...this.users].map(([id, user]) => [id, structuredClone(user)])),
      match: structuredClone(this.match),
      secondMatch: structuredClone(this.secondMatch),
      registrations: structuredClone(this.registrations),
      roster: structuredClone(this.roster),
      ledger: structuredClone(this.ledger),
      nextRegistrationNumber: this.nextRegistrationNumber,
    };
  }

  private restore(snapshot: Snapshot): void {
    this.users = snapshot.users;
    this.match = snapshot.match;
    this.secondMatch = snapshot.secondMatch;
    this.registrations = snapshot.registrations;
    this.roster = snapshot.roster;
    this.ledger = snapshot.ledger;
    this.nextRegistrationNumber = snapshot.nextRegistrationNumber;
  }

  private async execute<T>(sql: string, values: unknown[]): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, " ").trim();
    let rows: unknown[] = [];

    if (normalized.startsWith(
      "SELECT id, name, email, role, wallet_coins, phone, game_uid, status, auth_version FROM daily007_v2_users",
    )) {
      const user = this.users.get(String(values[0]));
      rows = user ? [structuredClone(user)] : [];
    } else if (normalized.startsWith(
      "SELECT id, mode, game_mode, team_type, capacity, status, entry_coins, starts_at, enabled FROM daily007_v2_matches",
    )) {
      const match = this.matchById(String(values[0]));
      rows = match ? [structuredClone(match)] : [];
    } else if (normalized.startsWith(
      "SELECT r.id, r.captain_game_name, r.captain_game_uid, r.team_name, r.assigned_group_number",
    )) {
      const registration = this.registrations.find((item) =>
        item.match_id === String(values[0]) && item.captain_user_id === String(values[1]),
      );
      const entry = registration && this.ledger.find((item) => item.registration_id === registration.id);
      const match = registration && this.matchById(registration.match_id);
      if (registration) {
        rows = [{
          id: registration.id,
          captain_game_name: registration.captain_game_name,
          captain_game_uid: registration.captain_game_uid,
          team_name: registration.team_name,
          assigned_group_number: registration.assigned_group_number,
          entry_coins_paid: registration.entry_coins_paid,
          balance_after: entry?.balance_after ?? null,
          capacity: match?.capacity,
          status: match?.status,
          is_full: match?.is_full,
          registration_status: registration.status,
        }];
      }
    } else if (normalized.startsWith("WITH active AS ( SELECT id, assigned_group_number, created_at FROM daily007_v2_registrations")) {
      const matchId = String(values[0]);
      const capacity = Number(values[1]);
      const active = this.registrations.filter((registration) =>
        registration.match_id === matchId && ["approved", "pending"].includes(registration.status),
      );
      const usedGroups = new Set(active
        .map((registration) => registration.assigned_group_number)
        .filter((groupNumber): groupNumber is number => groupNumber !== null));
      const freeGroups = Array.from({ length: capacity }, (_, index) => index + 1)
        .filter((groupNumber) => !usedGroups.has(groupNumber));
      for (const registration of active) {
        if (registration.assigned_group_number === null) {
          registration.assigned_group_number = freeGroups.shift() ?? null;
        }
      }
    } else if (normalized.startsWith("SELECT starts_at > clock_timestamp()")) {
      const match = this.matchById(String(values[0]));
      rows = [{
        upcoming: Boolean(match && match.starts_at.getTime() > Date.now() + 5 * 60 * 60 * 1000 + 30 * 60 * 1000),
      }];
    } else if (normalized.startsWith("SELECT r.id FROM daily007_v2_registrations r")) {
      const submittedUids = (values[1] as string[]).map((uid) => uid.toLowerCase());
      const duplicate = this.registrations.find((registration) => {
        if (registration.match_id !== String(values[0]) || !["approved", "pending"].includes(registration.status)) {
          return false;
        }
        if (submittedUids.includes(registration.captain_game_uid.toLowerCase())) return true;
        return this.roster.some((member) =>
          member.registration_id === registration.id &&
          member.member_uid !== null &&
          submittedUids.includes(member.member_uid.toLowerCase()),
        );
      });
      rows = duplicate ? [{ id: duplicate.id }] : [];
    } else if (normalized.startsWith("SELECT count(*)::text AS count FROM daily007_v2_registrations")) {
      const count = this.registrations.filter((registration) =>
        registration.match_id === String(values[0]) &&
        ["approved", "pending"].includes(registration.status),
      ).length;
      rows = [{ count: String(count) }];
    } else if (normalized.startsWith("SELECT assigned_group_number FROM daily007_v2_registrations")) {
      rows = this.registrations
        .filter((registration) =>
          registration.match_id === String(values[0]) &&
          ["approved", "pending"].includes(registration.status) &&
          registration.assigned_group_number !== null,
        )
        .map((registration) => ({ assigned_group_number: registration.assigned_group_number }));
    } else if (normalized.startsWith(
      "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
    )) {
      const user = this.users.get(String(values[0]));
      rows = user ? [{ wallet_coins: user.wallet_coins, status: user.status }] : [];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_registrations")) {
      if (this.failNextRegistrationInsertWithUniqueViolation) {
        this.failNextRegistrationInsertWithUniqueViolation = false;
        throw Object.assign(new Error("Injected duplicate registration."), { code: "23505" });
      }
      const [matchId, userId, captainName, captainGameName, captainGameUid, teamName, assignedGroupNumber, entryCoinsPaid] = values;
      const id = `54000000-0000-4000-8000-${String(this.nextRegistrationNumber++).padStart(12, "0")}`;
      this.registrations.push({
        id,
        match_id: String(matchId),
        captain_user_id: String(userId),
        captain_name: String(captainName),
        captain_game_name: String(captainGameName),
        captain_game_uid: String(captainGameUid),
        team_name: String(teamName),
        assigned_group_number: Number(assignedGroupNumber),
        entry_coins_paid: Number(entryCoinsPaid),
        status: "approved",
      });
      rows = [{ id }];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_roster")) {
      const [registrationId, , memberUid] = values;
      this.roster.push({
        registration_id: String(registrationId),
        member_uid: memberUid == null ? null : String(memberUid),
      });
    } else if (normalized.startsWith("UPDATE daily007_v2_users SET wallet_coins")) {
      const user = this.users.get(String(values[0]));
      if (user) user.wallet_coins = Number(values[1]);
    } else if (normalized.startsWith("INSERT INTO daily007_v2_wallet_ledger")) {
      if (this.failNextLedgerInsert) {
        this.failNextLedgerInsert = false;
        this.rosterRowsAtLedgerFailure = this.roster.length;
        throw new Error("Injected wallet ledger insert failure.");
      }
      const [userId, amount, balanceAfter, matchId, registrationId] = values;
      this.ledger.push({
        user_id: String(userId),
        amount: Number(amount),
        balance_after: Number(balanceAfter),
        reason: "match_entry",
        match_id: String(matchId),
        registration_id: String(registrationId),
      });
    } else if (normalized.startsWith("UPDATE daily007_v2_matches SET status")) {
      const match = this.matchById(String(values[0]));
      if (match) {
        match.status = String(values[1]);
        match.is_full = true;
      }
    } else {
      throw new Error(`Unexpected registration-capacity test SQL: ${normalized}`);
    }

    return { rows: rows as T[] };
  }
}

export const registrationCapacityTestDb = new RegistrationCapacityTestDatabase();
export const pool = {
  query: <T = unknown>(sql: string, values?: unknown[]) =>
    registrationCapacityTestDb.query<T>(sql, values ?? []),
  connect: () => registrationCapacityTestDb.connect(),
};