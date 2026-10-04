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
  entry_coins: number;
  starts_at: Date;
  enabled: boolean;
};

export type CapturedRegistration = {
  id: string;
  match_id: string;
  captain_user_id: string;
  captain_name: string;
  captain_game_name: string;
  captain_game_uid: string;
  team_name: string;
  entry_coins_paid: number;
  status: "approved";
};

export type CapturedRosterMember = {
  registration_id: string;
  position: number;
  member_uid: string | null;
  member_name: string;
};

export type CapturedLedgerEntry = {
  user_id: string;
  amount: number;
  balance_after: number;
  reason: "match_entry";
  match_id: string;
  registration_id: string;
};

export const TEST_PLAYER_ID = "74000000-0000-4000-8000-000000000001";
export const TEST_MATCH_ID = "74000000-0000-4000-8000-000000000002";

class RegistrationProfileTestDatabase {
  user!: TestUser;
  match!: TestMatch;
  registrations: CapturedRegistration[] = [];
  roster: CapturedRosterMember[] = [];
  ledger: CapturedLedgerEntry[] = [];
  connectCount = 0;

  constructor() {
    this.reset();
  }

  reset(profileName = "Daily007 Player"): void {
    this.user = {
      id: TEST_PLAYER_ID,
      name: profileName,
      email: "captain-profile-test@example.test",
      role: "user",
      wallet_coins: 100,
      phone: null,
      game_uid: null,
      status: "active",
      auth_version: 0,
    };
    this.match = {
      id: TEST_MATCH_ID,
      mode: "squad",
      game_mode: "battle_royale",
      team_type: "duo",
      capacity: 24,
      status: "open",
      entry_coins: 7,
      starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      enabled: true,
    };
    this.registrations = [];
    this.roster = [];
    this.ledger = [];
    this.connectCount = 0;
  }

  async query<T = unknown>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    return this.execute<T>(sql, values);
  }

  async connect() {
    this.connectCount += 1;
    return {
      query: <T = unknown>(sql: string, values: unknown[] = []) => this.execute<T>(sql, values),
      release: () => {},
    };
  }

  private async execute<T>(sql: string, values: unknown[]): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, " ").trim();
    let result: unknown[] = [];

    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
      result = [];
    } else if (
      normalized.startsWith("SELECT id, name, email, role, wallet_coins, phone, game_uid, status, auth_version FROM daily007_v2_users")
    ) {
      result = String(values[0]) === this.user.id ? [structuredClone(this.user)] : [];
    } else if (
      normalized.startsWith("SELECT id, mode, game_mode, team_type, capacity, status, entry_coins, starts_at, enabled FROM daily007_v2_matches")
    ) {
      result = String(values[0]) === this.match.id ? [structuredClone(this.match)] : [];
    } else if (
      normalized.startsWith("SELECT r.id, r.captain_game_name, r.captain_game_uid, r.entry_coins_paid, l.balance_after")
    ) {
      result = [];
    } else if (normalized.startsWith("SELECT starts_at > clock_timestamp()")) {
      result = [{ upcoming: true }];
    } else if (
      normalized.startsWith("SELECT r.id FROM daily007_v2_registrations r")
    ) {
      result = [];
    } else if (
      normalized.startsWith("SELECT count(*)::text AS count FROM daily007_v2_registrations")
    ) {
      const count = this.registrations.filter((registration) =>
        registration.match_id === String(values[0]) &&
        ["approved", "pending"].includes(registration.status)
      ).length;
      result = [{ count: String(count) }];
    } else if (
      normalized.startsWith("SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE")
    ) {
      result = String(values[0]) === this.user.id
        ? [{ wallet_coins: this.user.wallet_coins }]
        : [];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_registrations")) {
      const [
        matchId,
        captainUserId,
        captainName,
        captainGameName,
        captainGameUid,
        teamName,
        entryCoinsPaid,
      ] = values;
      const id = `74000000-0000-4000-8000-${String(this.registrations.length + 10).padStart(12, "0")}`;
      this.registrations.push({
        id,
        match_id: String(matchId),
        captain_user_id: String(captainUserId),
        captain_name: String(captainName),
        captain_game_name: String(captainGameName),
        captain_game_uid: String(captainGameUid),
        team_name: String(teamName),
        entry_coins_paid: Number(entryCoinsPaid),
        status: "approved",
      });
      result = [{ id }];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_roster")) {
      const [registrationId, position, memberUid, memberName] = values;
      this.roster.push({
        registration_id: String(registrationId),
        position: Number(position),
        member_uid: memberUid == null ? null : String(memberUid),
        member_name: String(memberName),
      });
    } else if (normalized.startsWith("UPDATE daily007_v2_users SET wallet_coins")) {
      if (String(values[0]) === this.user.id) this.user.wallet_coins = Number(values[1]);
    } else if (normalized.startsWith("INSERT INTO daily007_v2_wallet_ledger")) {
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
    } else {
      throw new Error(`Unexpected registration profile test SQL: ${normalized}`);
    }

    return { rows: result as T[] };
  }
}

export const registrationProfileTestDb = new RegistrationProfileTestDatabase();
export const pool = {
  query: <T = unknown>(sql: string, values?: unknown[]) =>
    registrationProfileTestDb.query<T>(sql, values ?? []),
  connect: () => registrationProfileTestDb.connect(),
};