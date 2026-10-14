type TestUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  wallet_coins: number;
  phone: string | null;
  game_uid: string | null;
  status: "active";
  auth_version: number;
};

type TestRegistration = {
  id: string;
  match_id: string;
  captain_user_id: string;
  captain_name: string;
  captain_game_name: string;
  team_name: string | null;
  status: "approved" | "pending" | "rejected";
};

type TestAward = {
  id: string;
  match_id: string;
  registration_id: string;
  user_id: string;
  rank: number;
  kills: number;
  prize_coins: number;
  created_at: Date;
};

type TestMatch = {
  id: string;
  title: string;
  mode: string;
  game_mode: string;
  team_type: string;
  capacity: number;
  entry_coins: number;
  prize_pool: number;
  starts_at: Date;
  status: string;
  is_full: boolean;
  rules: string;
  banner: string;
  image_url: string | null;
  prize_distribution: string;
  enabled: boolean;
  room_id: null;
  room_password: null;
  room_time: null;
  room_published: boolean;
};

type TestStats = { matches: number; wins: number; kills: number; prize_coins: number };
type FinalizationFailureObservation = {
  awardCount: number;
  ledgerCount: number;
  stats: TestStats | null;
  walletCoins: number | null;
  matchEnabled: boolean;
};
type TestLedgerEntry = {
  userId: string;
  amount: number;
  balanceAfter: number;
  reason: string;
};

export const TEST_ADMIN_ID = "70000000-0000-4000-8000-000000000004";
export const TEST_WINNER_ID = "70000000-0000-4000-8000-000000000005";
export const TEST_RUNNER_UP_ID = "70000000-0000-4000-8000-000000000006";
export const TEST_PENDING_PLAYER_ID = "70000000-0000-4000-8000-000000000007";
export const TEST_MATCH_ID = "70000000-0000-4000-8000-000000000001";
export const TEST_WINNER_REGISTRATION_ID = "70000000-0000-4000-8000-000000000002";
export const TEST_RUNNER_UP_REGISTRATION_ID = "70000000-0000-4000-8000-000000000003";
export const TEST_PENDING_REGISTRATION_ID = "70000000-0000-4000-8000-000000000008";

const PRIZE_DISTRIBUTION = "1st: 1,500 coins\n2nd: 600 coins";

class MemoryTournamentResultsDatabase {
  users = new Map<string, TestUser>();
  registrations: TestRegistration[] = [];
  awards: TestAward[] = [];
  stats = new Map<string, TestStats>();
  ledger: TestLedgerEntry[] = [];
  match: TestMatch = this.emptyMatch();
  additionalMatches: TestMatch[] = [];
  emptyMyRegistrationStandingsMatchIds = new Set<string>();
  finalizationFailureObservation: FinalizationFailureObservation | null = null;
  private failNextMatchFinalization = false;
  private cancelMatchAfterPublicResultsStatusReadId: string | null = null;

  reset(): void {
    this.users = new Map([
      [TEST_ADMIN_ID, this.user(TEST_ADMIN_ID, "Test Admin", "admin@example.test", "admin", 0)],
      [TEST_WINNER_ID, this.user(TEST_WINNER_ID, "First Place", "winner@example.test", "user", 100)],
      [TEST_RUNNER_UP_ID, this.user(TEST_RUNNER_UP_ID, "Second Place", "runner-up@example.test", "user", 200)],
      [TEST_PENDING_PLAYER_ID, this.user(TEST_PENDING_PLAYER_ID, "Pending Player", "pending@example.test", "user", 300)],
    ]);
    this.registrations = [];
    this.awards = [];
    this.stats = new Map();
    this.ledger = [];
    this.match = this.emptyMatch();
    this.additionalMatches = [];
    this.emptyMyRegistrationStandingsMatchIds = new Set();
    this.finalizationFailureObservation = null;
    this.failNextMatchFinalization = false;
    this.cancelMatchAfterPublicResultsStatusReadId = null;
  }

  failOnNextMatchFinalization(): void {
    this.failNextMatchFinalization = true;
  }

  cancelMatchAfterNextPublicResultsStatusRead(matchId: string): void {
    this.cancelMatchAfterPublicResultsStatusReadId = matchId;
  }

  setMyRegistrationStandingsEmpty(matchId: string): void {
    this.emptyMyRegistrationStandingsMatchIds.add(matchId);
  }

  approveTestRegistrations(): void {
    this.registrations = [
      {
        id: TEST_WINNER_REGISTRATION_ID,
        match_id: TEST_MATCH_ID,
        captain_user_id: TEST_WINNER_ID,
        captain_name: "First Place",
        captain_game_name: "WinnerFF",
        team_name: null,
        status: "approved",
      },
      {
        id: TEST_RUNNER_UP_REGISTRATION_ID,
        match_id: TEST_MATCH_ID,
        captain_user_id: TEST_RUNNER_UP_ID,
        captain_name: "Second Place",
        captain_game_name: "RunnerUpFF",
        team_name: null,
        status: "approved",
      },
    ];
  }

  addPendingTestRegistration(): void {
    this.registrations.push({
      id: TEST_PENDING_REGISTRATION_ID,
      match_id: TEST_MATCH_ID,
      captain_user_id: TEST_PENDING_PLAYER_ID,
      captain_name: "Pending Player",
      captain_game_name: "PendingFF",
      team_name: null,
      status: "pending",
    });
  }

  async query<T = unknown>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    return this.execute<T>(sql, values);
  }

  async connect() {
    let beforeTransaction: ReturnType<MemoryTournamentResultsDatabase["snapshot"]> | null = null;
    return {
      query: async <T = unknown>(sql: string, values: unknown[] = []) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
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
    role: TestUser["role"],
    wallet_coins: number,
  ): TestUser {
    return { id, name, email, role, wallet_coins, phone: null, game_uid: null, status: "active", auth_version: 0 };
  }

  private emptyMatch(): TestMatch {
    return {
      id: TEST_MATCH_ID,
      title: "Prize verification tournament",
      mode: "solo",
      game_mode: "battle_royale",
      team_type: "solo",
      capacity: 48,
      entry_coins: 0,
      prize_pool: 2_100,
      starts_at: new Date(Date.now() + 86_400_000),
      status: "open",
      is_full: false,
      rules: "",
      banner: "br",
      image_url: null,
      prize_distribution: "",
      enabled: true,
      room_id: null,
      room_password: null,
      room_time: null,
      room_published: false,
    };
  }

  private snapshot() {
    return {
      users: structuredClone(this.users),
      registrations: structuredClone(this.registrations),
      awards: structuredClone(this.awards),
      stats: structuredClone(this.stats),
      ledger: structuredClone(this.ledger),
      match: structuredClone(this.match),
    };
  }

  private restore(snapshot: ReturnType<MemoryTournamentResultsDatabase["snapshot"]>): void {
    this.users = snapshot.users;
    this.registrations = snapshot.registrations;
    this.awards = snapshot.awards;
    this.stats = snapshot.stats;
    this.ledger = snapshot.ledger;
    this.match = snapshot.match;
  }

  private async execute<T>(sql: string, values: unknown[]): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, " ").trim();
    let rows: unknown[] = [];

    if (normalized.startsWith(
      "SELECT id, name, email, role, wallet_coins, phone, game_uid, status, auth_version FROM daily007_v2_users",
    )) {
      const user = this.users.get(String(values[0]));
      rows = user ? [structuredClone(user)] : [];
    } else if (normalized === "SELECT pg_advisory_xact_lock_shared(740073)") {
      rows = [];
    } else if (normalized === "SELECT role, status FROM daily007_v2_users WHERE id = $1 FOR SHARE") {
      const user = this.users.get(String(values[0]));
      rows = user ? [{ role: user.role, status: user.status }] : [];
    } else if (normalized.startsWith(
      "SELECT (SELECT count(DISTINCT r.match_id)::int FROM daily007_v2_registrations r",
    )) {
      const userId = String(values[0]);
      const approvedMatchIds = new Set(
        this.registrations
          .filter((registration) =>
            registration.captain_user_id === userId && registration.status === "approved",
          )
          .map((registration) => registration.match_id),
      );
      const awards = this.awards.filter((award) => award.user_id === userId);
      rows = [{
        matches: approvedMatchIds.size,
        wins: awards.filter((award) => award.rank === 1).length,
        kills: awards.reduce((total, award) => total + award.kills, 0),
        prizeCoins: awards.reduce((total, award) => total + award.prize_coins, 0),
      }];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_matches")) {
      const [
        title,
        mode,
        gameMode,
        teamType,
        capacity,
        entryCoins,
        prizePool,
        startsAt,
        rules,
        banner,
        imageUrl,
        prizeDistribution,
        enabled,
      ] = values;
      this.match = {
        ...this.emptyMatch(),
        title: String(title),
        mode: String(mode),
        game_mode: String(gameMode),
        team_type: String(teamType),
        capacity: Number(capacity),
        entry_coins: Number(entryCoins),
        prize_pool: Number(prizePool),
        starts_at: startsAt instanceof Date ? startsAt : new Date(String(startsAt)),
        rules: String(rules),
        banner: String(banner),
        image_url: imageUrl == null ? null : String(imageUrl),
        prize_distribution: String(prizeDistribution),
        enabled: Boolean(enabled),
      };
      rows = [{ id: this.match.id }];
    } else if (normalized.startsWith(
      "SELECT m.id, m.title, m.mode, m.game_mode, m.team_type, m.capacity, m.entry_coins, m.prize_pool, m.starts_at",
    )) {
      rows = values.length === 0 || values[0] === this.match.id
        ? [{
          ...structuredClone(this.match),
          has_started: false,
          has_winner: false,
          completed_at: null,
          registered_count: this.registrations.filter((registration) =>
            ["approved", "pending"].includes(registration.status),
          ).length,
        }]
        : [];
    } else if (normalized.startsWith(
      "SELECT r.id, r.match_id, r.captain_user_id, m.prize_pool, m.prize_distribution",
    )) {
      const registration = this.registrations.find((entry) =>
        entry.id === values[0] &&
        entry.match_id === values[1] &&
        entry.status === "approved",
      );
      rows = registration ? [{
        id: registration.id,
        match_id: registration.match_id,
        captain_user_id: registration.captain_user_id,
        prize_pool: this.match.prize_pool,
        prize_distribution: this.match.prize_distribution,
        has_started: this.match.starts_at.getTime() <= Date.now() + 5.5 * 60 * 60 * 1000,
        match_status: this.match.status,
      }] : [];
    } else if (normalized.startsWith(
      "SELECT registration_id FROM daily007_v2_result_awards WHERE match_id = $1 AND rank = $2",
    )) {
      const placement = this.awards.find(
        (award) => award.match_id === values[0] && award.rank === Number(values[1]),
      );
      rows = placement ? [{ registration_id: placement.registration_id }] : [];
    } else if (normalized.startsWith("SELECT wallet_coins FROM daily007_v2_users")) {
      const user = this.users.get(String(values[0]));
      rows = user ? [{ wallet_coins: user.wallet_coins }] : [];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_result_awards")) {
      const [matchId, registrationId, userId, rank, kills, prizeCoins] = values;
      if (this.awards.some((award) => award.registration_id === registrationId)) {
        throw Object.assign(new Error("duplicate result award"), { code: "23505" });
      }
      const award: TestAward = {
        id: `award-${this.awards.length + 1}`,
        match_id: String(matchId),
        registration_id: String(registrationId),
        user_id: String(userId),
        rank: Number(rank),
        kills: Number(kills),
        prize_coins: Number(prizeCoins),
        created_at: new Date(Date.now() + this.awards.length),
      };
      this.awards.push(award);
      rows = [{ id: award.id }];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_user_stats")) {
      const [userId, wins, kills, prizeCoins] = values;
      const previous = this.stats.get(String(userId)) ?? { matches: 0, wins: 0, kills: 0, prize_coins: 0 };
      this.stats.set(String(userId), {
        matches: previous.matches + 1,
        wins: previous.wins + Number(wins),
        kills: previous.kills + Number(kills),
        prize_coins: previous.prize_coins + Number(prizeCoins),
      });
    } else if (normalized.startsWith("UPDATE daily007_v2_users SET wallet_coins")) {
      const user = this.users.get(String(values[0]));
      if (user) user.wallet_coins = Number(values[1]);
    } else if (normalized.startsWith("INSERT INTO daily007_v2_wallet_ledger")) {
      rows = [];
      this.ledger.push({
        userId: String(values[0]),
        amount: Number(values[1]),
        balanceAfter: Number(values[2]),
        reason: "match_prize",
      });
    } else if (normalized.startsWith("UPDATE daily007_v2_matches SET enabled = false")) {
      if (this.failNextMatchFinalization) {
        this.failNextMatchFinalization = false;
        const matchId = String(values[0]);
        const awards = this.awards.filter((award) => award.match_id === matchId);
        const winningUserId = awards[0]?.user_id;
        this.finalizationFailureObservation = {
          awardCount: awards.length,
          ledgerCount: winningUserId
            ? this.ledger.filter((entry) => entry.userId === winningUserId).length
            : 0,
          stats: winningUserId
            ? structuredClone(this.stats.get(winningUserId) ?? null)
            : null,
          walletCoins: winningUserId
            ? this.users.get(winningUserId)?.wallet_coins ?? null
            : null,
          matchEnabled: this.match.enabled,
        };
        throw Object.assign(
          new Error("Injected test database failure while finalizing tournament results."),
          { code: "XX000" },
        );
      }
      if (this.match.id === values[0]) this.match.enabled = false;
    } else if (normalized === "SELECT enabled, status FROM daily007_v2_matches WHERE id = $1") {
      const match = [this.match, ...this.additionalMatches]
        .find((candidate) => candidate.id === values[0]);
      rows = match ? [{ enabled: match.enabled, status: match.status }] : [];
      if (match?.id === this.cancelMatchAfterPublicResultsStatusReadId) {
        match.status = "cancelled";
        this.cancelMatchAfterPublicResultsStatusReadId = null;
      }
    } else if (normalized.startsWith(
      "SELECT r.id, r.match_id, r.captain_user_id, r.captain_name, r.captain_game_name, r.captain_game_uid, r.team_name,",
    )) {
      const matches = [this.match, ...this.additionalMatches];
      const excludesCancelledArray = normalized.includes(
        "WHERE published.match_id = m.id AND m.status <> 'cancelled'",
      );
      const excludesCancelledIndividual = normalized.includes(
        "ON award.registration_id = r.id AND m.status <> 'cancelled'",
      );
      rows = this.registrations
        .filter((registration) => registration.captain_user_id === values[0])
        .flatMap((registration) => {
          const match = matches.find((candidate) => candidate.id === registration.match_id);
          if (!match) return [];
          const visibleAwards = this.awards.filter((award) =>
            award.match_id === match.id && (!excludesCancelledArray || match.status !== "cancelled"),
          );
          const individualAward = this.awards.find((award) =>
            award.registration_id === registration.id &&
            (!excludesCancelledIndividual || match.status !== "cancelled"),
          );
          return [{
            id: registration.id,
            match_id: registration.match_id,
            captain_user_id: registration.captain_user_id,
            captain_name: registration.captain_name,
            captain_game_name: registration.captain_game_name,
            captain_game_uid: null,
            team_name: registration.team_name,
            entry_coins_paid: match.entry_coins,
            status: registration.status,
            created_at: new Date(Date.now() - 60 * 60 * 1000),
            title: match.title,
            mode: match.mode,
            game_mode: match.game_mode,
            team_type: match.team_type,
            capacity: match.capacity,
            starts_at: match.starts_at,
            match_entry_coins: match.entry_coins,
            match_status: match.status,
            prize_pool: match.prize_pool,
            rules: match.rules,
            banner: match.banner,
            image_url: match.image_url,
            prize_distribution: match.prize_distribution,
            enabled: match.enabled,
            is_full: match.is_full,
            room_id: match.room_id,
            room_password: match.room_password,
            room_time: null,
            room_published: match.room_published,
            match_has_started: match.starts_at.getTime() <= Date.now() + 5.5 * 60 * 60 * 1000,
            match_has_winner: this.awards.some((award) =>
              award.match_id === match.id && award.rank === 1,
            ),
            match_results: this.emptyMyRegistrationStandingsMatchIds.has(match.id)
              ? null
              : visibleAwards.length
              ? visibleAwards
                .map((award) => {
                  const resultRegistration = this.registrations.find(
                    (candidate) => candidate.id === award.registration_id,
                  )!;
                  return {
                    rank: award.rank,
                    kills: award.kills,
                    prizeCoins: award.prize_coins,
                    gameName: resultRegistration.captain_game_name,
                    teamName: resultRegistration.team_name,
                  };
                })
                .sort((left, right) =>
                  left.rank - right.rank || left.gameName.localeCompare(right.gameName),
                )
              : null,
            result_rank: individualAward?.rank ?? null,
            result_kills: individualAward?.kills ?? null,
            result_prize_coins: individualAward?.prize_coins ?? null,
            registered_count: this.registrations.filter((candidate) =>
              candidate.match_id === match.id &&
              ["approved", "pending"].includes(candidate.status),
            ).length,
          }];
        })
        .sort((left, right) => right.created_at.getTime() - left.created_at.getTime());
    } else if (normalized ===
      "SELECT position, member_name, member_uid FROM daily007_v2_roster WHERE registration_id = $1 ORDER BY position"
    ) {
      rows = [];
    } else if (normalized.startsWith(
      "SELECT award.registration_id, award.rank, award.kills, award.prize_coins, COALESCE",
    )) {
      rows = this.awards
        .filter((award) => award.match_id === values[0])
        .map((award) => {
          const registration = this.registrations.find((entry) => entry.id === award.registration_id)!;
          return {
            registration_id: award.registration_id,
            rank: award.rank,
            kills: award.kills,
            prize_coins: award.prize_coins,
            game_name: registration.captain_game_name,
            team_name: registration.team_name,
            created_at: award.created_at,
          };
        })
        .sort((left, right) => left.rank - right.rank || left.created_at.getTime() - right.created_at.getTime());
    } else if (normalized.startsWith(
      'SELECT award.match_id AS "tournamentId", m.title AS "tournamentName",',
    )) {
      const matches = [this.match, ...this.additionalMatches];
      const excludesCancelled = normalized.includes("m.status <> 'cancelled'");
      const includeUnfinalized = values[0] === true;
      const requiresDisabledMatch = !includeUnfinalized && normalized.includes("m.enabled = false");
      const requiresWinner = !includeUnfinalized && normalized.includes(
        "EXISTS ( SELECT 1 FROM daily007_v2_result_awards winner",
      );
      rows = this.awards
        .filter((award) => {
          const match = matches.find((candidate) => candidate.id === award.match_id);
          if (!match) return false;
          if (excludesCancelled && match.status === "cancelled") return false;
          if (requiresDisabledMatch && match.enabled) return false;
          if (requiresWinner && !this.awards.some((candidate) =>
            candidate.match_id === match.id && candidate.rank === 1,
          )) return false;
          return true;
        })
        .map((award) => {
          const match = matches.find((candidate) => candidate.id === award.match_id)!;
          const registration = this.registrations.find((entry) => entry.id === award.registration_id)!;
          return {
            tournamentId: match.id,
            tournamentName: match.title,
            registrationId: registration.id,
            playerName: registration.captain_name,
            gameName: registration.captain_game_name,
            teamName: registration.team_name,
            rank: award.rank,
            kills: award.kills,
            prizeCoins: award.prize_coins,
            createdAt: award.created_at,
          };
        })
        .sort((left, right) => left.rank - right.rank || left.createdAt.getTime() - right.createdAt.getTime());
    } else {
      throw new Error(`Unexpected tournament-results test SQL: ${normalized}`);
    }

    return { rows: rows as T[] };
  }
}

export const tournamentResultsTestDb = new MemoryTournamentResultsDatabase();
tournamentResultsTestDb.reset();

export const pool = {
  query: <T = unknown>(sql: string, values?: unknown[]) => tournamentResultsTestDb.query<T>(sql, values),
  connect: () => tournamentResultsTestDb.connect(),
};
