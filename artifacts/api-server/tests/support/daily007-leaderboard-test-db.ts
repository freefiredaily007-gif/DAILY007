type TestRole = "admin" | "tournament_admin" | "user";
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
type TestAward = {
  match_id: string;
  user_id: string;
  rank: number;
  kills: number;
  prize_coins: number;
  created_at: Date;
};
type TestMatch = { id: string; starts_at: Date };
type TestPeriod = {
  id: string;
  cycle_type: "weekly" | "monthly";
  starts_at: Date;
  ends_at: Date;
  status: "active" | "pending_approval" | "pending_activation" | "finalized";
  previous_period_id: string | null;
  final_standings: unknown;
  payout_configuration: unknown;
  approved_by: string | null;
  approved_at: Date | null;
  settled_at: Date | null;
};
type TestRewardSettings = {
  cycle_type: "weekly" | "monthly";
  first_place_coins: number;
  second_place_coins: number;
  third_place_coins: number;
};
type TestLedgerEntry = {
  id: string;
  user_id: string;
  amount: number;
  balance_after: number;
  reason: string;
  idempotency_key: string;
  details: Record<string, unknown>;
};
type TestSnapshot = {
  users: Map<string, TestUser>;
  matches: Map<string, TestMatch>;
  awards: TestAward[];
  periods: Map<string, TestPeriod>;
  rewardSettings: Map<string, TestRewardSettings>;
  ledger: Map<string, TestLedgerEntry>;
  nextPeriodNumber: number;
};

export const TEST_FULL_ADMIN_ID = "71000000-0000-4000-8000-000000000001";
export const TEST_TOURNAMENT_ADMIN_ID = "71000000-0000-4000-8000-000000000002";
export const TEST_PLAYER_ONE_ID = "71000000-0000-4000-8000-000000000003";
export const TEST_PLAYER_TWO_ID = "71000000-0000-4000-8000-000000000004";
export const TEST_PLAYER_THREE_ID = "71000000-0000-4000-8000-000000000005";
export const TEST_PLAYER_FOUR_ID = "71000000-0000-4000-8000-000000000006";
export const TEST_WEEKLY_PERIOD_ID = "72000000-0000-4000-8000-000000000001";
export const TEST_MONTHLY_PERIOD_ID = "72000000-0000-4000-8000-000000000002";

class MemoryLeaderboardDatabase {
  users = new Map<string, TestUser>();
  matches = new Map<string, TestMatch>();
  awards: TestAward[] = [];
  periods = new Map<string, TestPeriod>();
  rewardSettings = new Map<string, TestRewardSettings>();
  ledger = new Map<string, TestLedgerEntry>();
  failWalletUpdateFor: string | null = null;
  private nextPeriodNumber = 100;

  reset(): void {
    this.users = new Map([
      [TEST_FULL_ADMIN_ID, this.user(TEST_FULL_ADMIN_ID, "Full Admin", "admin@example.test", "admin", 0)],
      [TEST_TOURNAMENT_ADMIN_ID, this.user(TEST_TOURNAMENT_ADMIN_ID, "Tournament Admin", "tournament@example.test", "tournament_admin", 0)],
      [TEST_PLAYER_ONE_ID, this.user(TEST_PLAYER_ONE_ID, "Alpha", "alpha@example.test", "user", 100)],
      [TEST_PLAYER_TWO_ID, this.user(TEST_PLAYER_TWO_ID, "Bravo", "bravo@example.test", "user", 100)],
      [TEST_PLAYER_THREE_ID, this.user(TEST_PLAYER_THREE_ID, "Charlie", "charlie@example.test", "user", 100)],
      [TEST_PLAYER_FOUR_ID, this.user(TEST_PLAYER_FOUR_ID, "Delta", "delta@example.test", "user", 100)],
    ]);
    this.matches = new Map();
    this.awards = [];
    this.periods = new Map();
    this.rewardSettings = new Map([
      ["weekly", this.rewardSetting("weekly", 50, 40, 30)],
      ["monthly", this.rewardSetting("monthly", 90, 60, 30)],
    ]);
    this.ledger = new Map();
    this.failWalletUpdateFor = null;
    this.nextPeriodNumber = 100;
  }

  seedPeriod(period: Omit<TestPeriod, "approved_by" | "approved_at" | "settled_at"> & {
    approved_by?: string | null;
    approved_at?: Date | null;
    settled_at?: Date | null;
  }): void {
    this.periods.set(period.id, {
      ...period,
      approved_by: period.approved_by ?? null,
      approved_at: period.approved_at ?? null,
      settled_at: period.settled_at ?? null,
    });
  }

  seedMatch(id: string, startsAt: Date): void {
    this.matches.set(id, { id, starts_at: startsAt });
  }

  seedAward(award: TestAward): void {
    this.awards.push(award);
  }

  async query<T = unknown>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    return this.execute<T>(sql, values);
  }

  async connect() {
    let beforeTransaction: TestSnapshot | null = null;
    return {
      query: async <T = unknown>(sql: string, values: unknown[] = []) => {
        const normalized = this.normalize(sql);
        if (normalized === "BEGIN") {
          beforeTransaction = this.snapshot();
          return { rows: [] as T[] };
        }
        if (normalized === "COMMIT") {
          beforeTransaction = null;
          return { rows: [] as T[] };
        }
        if (normalized === "ROLLBACK") {
          if (beforeTransaction) this.restore(beforeTransaction);
          beforeTransaction = null;
          return { rows: [] as T[] };
        }
        return this.execute<T>(normalized, values);
      },
      release: () => {},
    };
  }

  private user(
    id: string,
    name: string,
    email: string,
    role: TestRole,
    wallet_coins: number,
  ): TestUser {
    return {
      id,
      name,
      email,
      role,
      wallet_coins,
      phone: null,
      game_uid: null,
      status: "active",
      auth_version: 0,
    };
  }

  private rewardSetting(
    cycle_type: "weekly" | "monthly",
    first_place_coins: number,
    second_place_coins: number,
    third_place_coins: number,
  ): TestRewardSettings {
    return { cycle_type, first_place_coins, second_place_coins, third_place_coins };
  }

  private normalize(sql: string): string {
    return sql.replace(/\s+/g, " ").trim();
  }

  private snapshot(): TestSnapshot {
    return structuredClone({
      users: this.users,
      matches: this.matches,
      awards: this.awards,
      periods: this.periods,
      rewardSettings: this.rewardSettings,
      ledger: this.ledger,
      nextPeriodNumber: this.nextPeriodNumber,
    });
  }

  private restore(snapshot: TestSnapshot): void {
    this.users = snapshot.users;
    this.matches = snapshot.matches;
    this.awards = snapshot.awards;
    this.periods = snapshot.periods;
    this.rewardSettings = snapshot.rewardSettings;
    this.ledger = snapshot.ledger;
    this.nextPeriodNumber = snapshot.nextPeriodNumber;
  }

  private periodRow(period: TestPeriod): TestPeriod {
    return structuredClone(period);
  }

  private standings(startsAt: Date, endsAt: Date): Record<string, unknown>[] {
    const grouped = new Map<string, {
      userId: string;
      name: string;
      points: number;
      earnings: number;
      wins: number;
      kills: number;
      matches: number;
    }>();
    for (const award of this.awards) {
      const match = this.matches.get(award.match_id);
      const user = this.users.get(award.user_id);
      if (!match || !user ||
          match.starts_at.getTime() < startsAt.getTime() ||
          match.starts_at.getTime() >= endsAt.getTime()) {
        continue;
      }
      let row = grouped.get(award.user_id);
      if (!row) {
        row = {
          userId: award.user_id,
          name: user.name,
          points: 0,
          earnings: 0,
          wins: 0,
          kills: 0,
          matches: 0,
        };
        grouped.set(award.user_id, row);
      }
      row.points += award.prize_coins;
      row.earnings += award.prize_coins;
      row.wins += award.rank === 1 ? 1 : 0;
      row.kills += award.kills;
      row.matches += 1;
    }
    return [...grouped.values()]
      .sort((a, b) =>
        b.points - a.points ||
        b.wins - a.wins ||
        b.kills - a.kills ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
        a.userId.localeCompare(b.userId),
      )
      .slice(0, 20)
      .map((row) => ({
        ...row,
        points: String(row.points),
        earnings: String(row.earnings),
        wins: String(row.wins),
        kills: String(row.kills),
        matches: String(row.matches),
      }));
  }

  private execute<T = unknown>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    const normalized = this.normalize(sql);
    const rows = <R>(items: unknown[] = []) => ({ rows: items as R[] });

    if (
      normalized === "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)" ||
      normalized === "SELECT pg_advisory_xact_lock(740072)"
    ) {
      return Promise.resolve(rows<T>());
    }
    if (
      normalized.startsWith("SELECT id, name, email, role, wallet_coins, phone, game_uid, status, auth_version FROM daily007_v2_users WHERE id = $1")
    ) {
      const user = this.users.get(String(values[0]));
      return Promise.resolve(rows<T>(user ? [structuredClone(user)] : []));
    }
    if (normalized === "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE") {
      const user = this.users.get(String(values[0]));
      return Promise.resolve(rows<T>(user ? [{ wallet_coins: user.wallet_coins }] : []));
    }
    if (normalized.startsWith('SELECT a.user_id AS "userId"')) {
      return Promise.resolve(rows<T>(
        this.standings(new Date(String(values[0])), new Date(String(values[1]))),
      ));
    }
    if (
      normalized.startsWith("SELECT id, cycle_type, starts_at, ends_at, status, previous_period_id,") &&
      normalized.includes("FROM daily007_v2_leaderboard_periods") &&
      normalized.includes("WHERE cycle_type = $1") &&
      normalized.includes("ORDER BY starts_at DESC")
    ) {
      const result = [...this.periods.values()]
        .filter((period) => period.cycle_type === values[0])
        .sort((a, b) => b.starts_at.getTime() - a.starts_at.getTime())
        .slice(0, 600)
        .map((period) => this.periodRow(period));
      return Promise.resolve(rows<T>(result));
    }
    if (
      normalized.startsWith("SELECT id, cycle_type, starts_at, ends_at, status, previous_period_id,") &&
      normalized.includes("FROM daily007_v2_leaderboard_periods") &&
      normalized.includes("WHERE previous_period_id = $1")
    ) {
      const period = [...this.periods.values()].find(
        (candidate) => candidate.previous_period_id === values[0],
      );
      return Promise.resolve(rows<T>(period ? [this.periodRow(period)] : []));
    }
    if (
      normalized.startsWith("SELECT id, cycle_type, starts_at, ends_at, status, previous_period_id,") &&
      normalized.includes("FROM daily007_v2_leaderboard_periods") &&
      normalized.includes("WHERE id = $1")
    ) {
      const period = this.periods.get(String(values[0]));
      return Promise.resolve(rows<T>(period ? [this.periodRow(period)] : []));
    }
    if (
      normalized.startsWith("SELECT id, cycle_type, starts_at, ends_at, status, previous_period_id,") &&
      normalized.includes("FROM daily007_v2_leaderboard_periods") &&
      normalized.includes("WHERE status = 'pending_approval'")
    ) {
      const result = [...this.periods.values()]
        .filter((period) => period.status === "pending_approval")
        .sort((a, b) => b.ends_at.getTime() - a.ends_at.getTime())
        .slice(0, 100)
        .map((period) => this.periodRow(period));
      return Promise.resolve(rows<T>(result));
    }
    if (
      normalized.startsWith("INSERT INTO daily007_v2_leaderboard_reward_settings") &&
      normalized.includes("VALUES ('weekly'), ('monthly')")
    ) {
      for (const cycleType of ["weekly", "monthly"] as const) {
        if (!this.rewardSettings.has(cycleType)) {
          this.rewardSettings.set(cycleType, this.rewardSetting(cycleType, 0, 0, 0));
        }
      }
      return Promise.resolve(rows<T>());
    }
    if (
      normalized.startsWith("INSERT INTO daily007_v2_leaderboard_reward_settings") &&
      normalized.includes("ON CONFLICT (cycle_type) DO UPDATE SET")
    ) {
      const cycleType = String(values[0]) as "weekly" | "monthly";
      this.rewardSettings.set(
        cycleType,
        this.rewardSetting(
          cycleType,
          Number(values[1]),
          Number(values[2]),
          Number(values[3]),
        ),
      );
      return Promise.resolve(rows<T>());
    }
    if (
      normalized.startsWith("SELECT starts_at, ends_at FROM daily007_v2_leaderboard_periods")
    ) {
      const cycleType = String(values[0]);
      const period = [...this.periods.values()]
        .filter((candidate) =>
          candidate.cycle_type === cycleType &&
          candidate.status !== "finalized" &&
          candidate.ends_at.getTime() > Date.now()
        )
        .sort((a, b) => b.starts_at.getTime() - a.starts_at.getTime())[0];
      return Promise.resolve(rows<T>(
        period ? [{ starts_at: period.starts_at, ends_at: period.ends_at }] : [],
      ));
    }
    if (
      normalized.startsWith("SELECT cycle_type, first_place_coins, second_place_coins, third_place_coins FROM daily007_v2_leaderboard_reward_settings")
    ) {
      const setting = this.rewardSettings.get(String(values[0]));
      return Promise.resolve(rows<T>(setting ? [structuredClone(setting)] : []));
    }
    if (normalized.startsWith("INSERT INTO daily007_v2_leaderboard_periods")) {
      const [cycleType, startsAt, endsAt, status, previousPeriodId, payoutConfiguration] = values;
      if (![...this.periods.values()].some(
        (period) =>
          period.cycle_type === cycleType &&
          period.starts_at.getTime() === new Date(String(startsAt)).getTime(),
      )) {
        const id = `73000000-0000-4000-8000-${String(this.nextPeriodNumber++).padStart(12, "0")}`;
        this.seedPeriod({
          id,
          cycle_type: cycleType as "weekly" | "monthly",
          starts_at: new Date(String(startsAt)),
          ends_at: new Date(String(endsAt)),
          status: status as TestPeriod["status"],
          previous_period_id: previousPeriodId as string | null,
          final_standings: [],
          payout_configuration: JSON.parse(String(payoutConfiguration)) as unknown,
        });
      }
      return Promise.resolve(rows<T>());
    }
    if (
      normalized.startsWith("UPDATE daily007_v2_leaderboard_periods") &&
      normalized.includes("SET payout_configuration = $2::jsonb")
    ) {
      const cycleType = String(values[0]);
      const payoutConfiguration = JSON.parse(String(values[1])) as unknown;
      const cutoff = new Date(String(values[2])).getTime();
      for (const period of this.periods.values()) {
        if (
          period.cycle_type === cycleType &&
          ["active", "pending_activation", "pending_approval"].includes(period.status) &&
          period.ends_at.getTime() > cutoff
        ) {
          period.payout_configuration = structuredClone(payoutConfiguration);
        }
      }
      return Promise.resolve(rows<T>());
    }
    if (normalized.startsWith("UPDATE daily007_v2_leaderboard_periods")) {
      const id = String(values[0]);
      const period = this.periods.get(id);
      if (!period) return Promise.resolve(rows<T>());
      if (normalized.includes("SET status = 'pending_approval'")) {
        period.status = "pending_approval";
        period.final_standings = JSON.parse(String(values[1])) as unknown;
        period.payout_configuration = JSON.parse(String(values[2])) as unknown;
        return Promise.resolve(rows<T>());
      }
      if (normalized.includes("SET status = 'finalized'")) {
        if (period.status !== "pending_approval") return Promise.resolve(rows<T>());
        period.status = "finalized";
        period.approved_by = String(values[1]);
        period.approved_at = new Date(String(values[2]));
        period.settled_at = new Date(String(values[2]));
        period.final_standings = JSON.parse(String(values[3])) as unknown;
        period.payout_configuration = JSON.parse(String(values[4])) as unknown;
        return Promise.resolve(rows<T>([{ id: period.id }]));
      }
      if (normalized.includes("SET status = 'active'")) {
        if (period.status !== "finalized") period.status = "active";
        return Promise.resolve(rows<T>());
      }
      throw new Error(`Unhandled leaderboard period update in test database: ${normalized}`);
    }
    if (normalized.startsWith("INSERT INTO daily007_v2_wallet_ledger")) {
      const [
        userId,
        amount,
        balanceAfter,
        reason,
        idempotencyKey,
        details,
      ] = values;
      if (this.ledger.has(String(idempotencyKey))) return Promise.resolve(rows<T>());
      const entry: TestLedgerEntry = {
        id: `ledger-${this.ledger.size + 1}`,
        user_id: String(userId),
        amount: Number(amount),
        balance_after: Number(balanceAfter),
        reason: String(reason),
        idempotency_key: String(idempotencyKey),
        details: JSON.parse(String(details)) as Record<string, unknown>,
      };
      this.ledger.set(entry.idempotency_key, entry);
      return Promise.resolve(rows<T>([{ id: entry.id }]));
    }
    if (normalized === "UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1") {
      const userId = String(values[0]);
      if (this.failWalletUpdateFor === userId) {
        throw Object.assign(new Error("Simulated wallet write failure."), { status: 503 });
      }
      const user = this.users.get(userId);
      if (user) user.wallet_coins = Number(values[1]);
      return Promise.resolve(rows<T>());
    }
    throw new Error(`Unhandled SQL in leaderboard test database: ${normalized}`);
  }
}

export const daily007LeaderboardTestDb = new MemoryLeaderboardDatabase();
daily007LeaderboardTestDb.reset();

export const pool = {
  query: <T = unknown>(sql: string, values?: unknown[]) =>
    daily007LeaderboardTestDb.query<T>(sql, values),
  connect: () => daily007LeaderboardTestDb.connect(),
};