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

export const TEST_MATCH_ID = "54000000-0000-4000-8000-000000000100";
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
  registrations: TestRegistration[] = [];
  roster: TestRosterMember[] = [];
  ledger: TestLedgerEntry[] = [];
  private nextRegistrationNumber = 11;
  private readonly matchRowLock = new AsyncMutex();
  private lockHold: MatchLockHold | null = null;
  private failNextLedgerInsert = false;

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
    const existingRegistrationId = "54000000-0000-4000-8000-000000000010";
    this.registrations = [{
      id: existingRegistrationId,
      match_id: TEST_MATCH_ID,
      captain_user_id: INCUMBENT_PLAYER_ID,
      captain_name: "Existing Player",
      captain_game_name: "Existing Captain",
      captain_game_uid: "FF-EXISTING-001",
      team_name: "",
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
    this.lockHold = null;
    this.failNextLedgerInsert = false;
  }

  failOnNextLedgerInsert(): void {
    this.failNextLedgerInsert = true;
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
          const release = await this.matchRowLock.acquire(() => hold?.secondQueuedSignal.resolve());
          releases.push(release);
          if (!snapshot) snapshot = this.snapshot();
          if (hold && !hold.paused) {
            hold.paused = true;
            hold.firstAcquiredSignal.resolve();
            await hold.continueSignal.promise;
            if (this.lockHold === hold) this.lockHold = null;
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
      registrations: structuredClone(this.registrations),
      roster: structuredClone(this.roster),
      ledger: structuredClone(this.ledger),
      nextRegistrationNumber: this.nextRegistrationNumber,
    };
  }

  private restore(snapshot: Snapshot): void {
    this.users = snapshot.users;
    this.match = snapshot.match;
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
      rows = String(values[0]) === this.match.id ? [structuredClone(this.match)] : [];
    } else if (normalized.startsWith(
      "SELECT r.id, r.captain_game_name, r.captain_game_uid, r.entry_coins_paid, l.balance_after",
    )) {
      const registration = this.registrations.find((item) =>
        item.match_id === String(values[0]) && item.captain_user_id === String(values[1]),
      );
      const entry = registration && this.ledger.find((item) => item.registration_id === registration.id);
      if (registration && entry) {
        rows = [{
          id: registration.id,
          captain_game_name: registration.captain_game_name,
          captain_game_uid: registration.captain_game_uid,
          entry_coins_paid: registration.entry_coins_paid,
          balance_after: entry.balance_after,
          capacity: this.match.capacity,
          status: this.match.status,
          is_full: this.match.is_full,
          registration_status: registration.status,
        }];
      }
    } else if (normalized.startsWith("SELECT starts_at > clock_timestamp()")) {
      rows = [{
        upcoming: this.match.starts_at.getTime() > Date.now() + 5 * 60 * 60 * 1000 + 30 * 60 * 1000,
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
    } else if (normalized.startsWith(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
    )) {
      const user = this.users.get(String(values[0]));
      rows = user ? [{ wallet_coins: user.wallet_coins }] : [];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_registrations")) {
      const [matchId, userId, captainName, captainGameName, captainGameUid, teamName, entryCoinsPaid] = values;
      const id = `54000000-0000-4000-8000-${String(this.nextRegistrationNumber++).padStart(12, "0")}`;
      this.registrations.push({
        id,
        match_id: String(matchId),
        captain_user_id: String(userId),
        captain_name: String(captainName),
        captain_game_name: String(captainGameName),
        captain_game_uid: String(captainGameUid),
        team_name: String(teamName),
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
      this.match.status = String(values[1]);
      this.match.is_full = true;
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