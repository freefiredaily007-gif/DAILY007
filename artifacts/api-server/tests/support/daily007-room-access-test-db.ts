type TestUser = {
  id: string;
  name: string;
  email: string;
  role: "user" | "tournament_admin";
  wallet_coins: number;
  phone: string | null;
  game_uid: string | null;
  status: "active" | "blocked";
  auth_version: number;
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
  room_id: string | null;
  room_password: string | null;
  room_time: string;
  room_published: boolean;
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
  created_at: Date;
};

export const TEST_ADMIN_ID = "82000000-0000-4000-8000-000000000001";
export const TEST_PLAYER_ID = "82000000-0000-4000-8000-000000000002";
export const TEST_PENDING_PLAYER_ID = "82000000-0000-4000-8000-000000000003";
export const TEST_UNREGISTERED_PLAYER_ID = "82000000-0000-4000-8000-000000000004";
export const TEST_REJECTED_PLAYER_ID = "82000000-0000-4000-8000-000000000005";
export const TEST_BLOCKED_PLAYER_ID = "82000000-0000-4000-8000-000000000006";
export const TEST_MATCH_ID = "82000000-0000-4000-8000-000000000100";
export const TEST_REGISTRATION_ID = "82000000-0000-4000-8000-000000000101";
export const TEST_PENDING_REGISTRATION_ID = "82000000-0000-4000-8000-000000000102";
export const TEST_REJECTED_REGISTRATION_ID = "82000000-0000-4000-8000-000000000103";
export const TEST_BLOCKED_REGISTRATION_ID = "82000000-0000-4000-8000-000000000104";

class RoomAccessTestDatabase {
  users = new Map<string, TestUser>();
  match!: TestMatch;
  registrations: TestRegistration[] = [];

  constructor() {
    this.reset();
  }

  reset(): void {
    this.users = new Map([
      [TEST_ADMIN_ID, {
        id: TEST_ADMIN_ID,
        name: "Tournament Admin",
        email: "room-admin@example.test",
        role: "tournament_admin",
        wallet_coins: 0,
        phone: null,
        game_uid: null,
        status: "active",
        auth_version: 0,
      }],
      [TEST_PLAYER_ID, {
        id: TEST_PLAYER_ID,
        name: "Approved Player",
        email: "room-player@example.test",
        role: "user",
        wallet_coins: 25,
        phone: null,
        game_uid: "FF-ROOM-001",
        status: "active",
        auth_version: 0,
      }],
      [TEST_PENDING_PLAYER_ID, {
        id: TEST_PENDING_PLAYER_ID,
        name: "Pending Player",
        email: "pending-room-player@example.test",
        role: "user",
        wallet_coins: 0,
        phone: null,
        game_uid: "FF-PENDING-001",
        status: "active",
        auth_version: 0,
      }],
      [TEST_UNREGISTERED_PLAYER_ID, {
        id: TEST_UNREGISTERED_PLAYER_ID,
        name: "Unregistered Player",
        email: "unregistered-room-player@example.test",
        role: "user",
        wallet_coins: 0,
        phone: null,
        game_uid: "FF-NONE-001",
        status: "active",
        auth_version: 0,
      }],
      [TEST_REJECTED_PLAYER_ID, {
        id: TEST_REJECTED_PLAYER_ID,
        name: "Rejected Player",
        email: "rejected-room-player@example.test",
        role: "user",
        wallet_coins: 0,
        phone: null,
        game_uid: "FF-REJECTED-001",
        status: "active",
        auth_version: 0,
      }],
      [TEST_BLOCKED_PLAYER_ID, {
        id: TEST_BLOCKED_PLAYER_ID,
        name: "Blocked Player",
        email: "blocked-room-player@example.test",
        role: "user",
        wallet_coins: 25,
        phone: null,
        game_uid: "FF-BLOCKED-001",
        status: "blocked",
        auth_version: 0,
      }],
    ]);
    this.match = {
      id: TEST_MATCH_ID,
      title: "Room Access Test",
      mode: "solo",
      game_mode: "battle_royale",
      team_type: "solo",
      capacity: 48,
      entry_coins: 5,
      prize_pool: 100,
      starts_at: new Date("2020-01-01T00:00:00.000Z"),
      status: "ongoing",
      is_full: false,
      rules: "Isolated API test fixture",
      banner: "",
      image_url: null,
      prize_distribution: "[]",
      enabled: true,
      room_id: "TEST-ROOM-820",
      room_password: "fixture-only-password",
      room_time: "12:00 AM",
      room_published: true,
    };
    this.registrations = [{
      id: TEST_REGISTRATION_ID,
      match_id: TEST_MATCH_ID,
      captain_user_id: TEST_PLAYER_ID,
      captain_name: "Approved Player",
      captain_game_name: "RoomCaptain",
      captain_game_uid: "FF-ROOM-001",
      team_name: "",
      entry_coins_paid: 5,
      status: "approved",
      created_at: new Date("2020-01-01T00:00:00.000Z"),
    }, {
      id: TEST_PENDING_REGISTRATION_ID,
      match_id: TEST_MATCH_ID,
      captain_user_id: TEST_PENDING_PLAYER_ID,
      captain_name: "Pending Player",
      captain_game_name: "PendingCaptain",
      captain_game_uid: "FF-PENDING-001",
      team_name: "",
      entry_coins_paid: 0,
      status: "pending",
      created_at: new Date("2020-01-02T00:00:00.000Z"),
    }, {
      id: TEST_REJECTED_REGISTRATION_ID,
      match_id: TEST_MATCH_ID,
      captain_user_id: TEST_REJECTED_PLAYER_ID,
      captain_name: "Rejected Player",
      captain_game_name: "RejectedCaptain",
      captain_game_uid: "FF-REJECTED-001",
      team_name: "",
      entry_coins_paid: 0,
      status: "rejected",
      created_at: new Date("2020-01-03T00:00:00.000Z"),
    }];
  }

  async query<T = unknown>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, " ").trim();
    const first = String(values[0] ?? "");
    let rows: unknown[] = [];

    if (normalized === "SELECT id FROM daily007_v2_matches WHERE id = $1") {
      rows = first === this.match.id ? [{ id: this.match.id }] : [];
    } else if (normalized === "SELECT status FROM daily007_v2_matches WHERE id = $1") {
      rows = first === this.match.id ? [{ status: this.match.status }] : [];
    } else if (
      normalized ===
      "SELECT id, status, room_id, room_password, room_time, room_published FROM daily007_v2_matches WHERE id = $1"
    ) {
      rows = first === this.match.id
        ? [{
            id: this.match.id,
            status: this.match.status,
            room_id: this.match.room_id,
            room_password: this.match.room_password,
            room_time: this.match.room_time,
            room_published: this.match.room_published,
          }]
        : [];
    } else if (normalized ===
      "SELECT r.id AS registration_id, r.status, NULLIF(BTRIM(r.team_name), '') AS team_name, r.captain_game_name, roster.position, roster.member_name FROM daily007_v2_registrations r LEFT JOIN daily007_v2_roster roster ON roster.registration_id = r.id WHERE r.match_id = $1 AND r.status IN ('approved', 'pending') ORDER BY r.created_at, r.id, roster.position"
    ) {
      rows = this.registrations
        .filter((registration) =>
          registration.match_id === first &&
          ["approved", "pending"].includes(registration.status),
        )
        .map((registration) => ({
          registration_id: registration.id,
          status: registration.status,
          team_name: registration.team_name,
          captain_game_name: registration.captain_game_name,
          position: null,
          member_name: null,
        }));
    } else if (normalized.startsWith(
      "SELECT id, name, email, role, wallet_coins, phone, game_uid, status, auth_version FROM daily007_v2_users",
    )) {
      const user = this.users.get(first);
      rows = user ? [structuredClone(user)] : [];
    } else if (normalized.startsWith(
      "SELECT m.room_id, m.room_password, m.starts_at, m.status AS tournament_status",
    )) {
      const playerId = String(values[1] ?? "");
      if (first === this.match.id) {
        rows = [{
          room_id: this.match.room_id,
          room_password: this.match.room_password,
          starts_at: this.match.starts_at,
          tournament_status: this.match.status,
          registered: this.registrations.some((registration) =>
            registration.match_id === this.match.id &&
            registration.captain_user_id === playerId &&
            registration.status === "approved",
          ),
        }];
      }
    } else if (
      normalized.startsWith(
        "SELECT m.id, m.title, m.mode, m.game_mode, m.team_type, m.capacity, m.entry_coins, m.prize_pool, m.starts_at, m.status, m.is_full, m.rules, m.banner, m.image_url, m.prize_distribution, m.enabled, m.room_id, m.room_password, m.room_time, m.room_published,",
      ) &&
      normalized.includes(
        "FROM daily007_v2_matches m LEFT JOIN daily007_v2_registrations r ON r.match_id = m.id",
      ) &&
      normalized.endsWith("GROUP BY m.id ORDER BY m.starts_at ASC")
    ) {
      const detailId = normalized.includes("WHERE m.id = $1") ? first : null;
      const enabledOnly = normalized.includes("m.enabled = true");
      const isRequestedMatch = detailId
        ? detailId === this.match.id
        : this.match.status !== "cancelled";
      if (isRequestedMatch && (!enabledOnly || this.match.enabled)) {
        rows = [{
          id: this.match.id,
          title: this.match.title,
          mode: this.match.mode,
          game_mode: this.match.game_mode,
          team_type: this.match.team_type,
          capacity: this.match.capacity,
          entry_coins: this.match.entry_coins,
          prize_pool: this.match.prize_pool,
          starts_at: this.match.starts_at,
          status: this.match.status,
          is_full: this.match.is_full,
          rules: this.match.rules,
          banner: this.match.banner,
          image_url: this.match.image_url,
          prize_distribution: this.match.prize_distribution,
          enabled: this.match.enabled,
          room_id: this.match.room_id,
          room_password: this.match.room_password,
          room_time: this.match.room_time,
          room_published: this.match.room_published,
          has_started: this.match.starts_at.getTime() <= Date.now() + 5.5 * 60 * 60 * 1000,
          has_winner: false,
          completed_at: null,
          registered_count: this.registrations.filter((registration) =>
            registration.match_id === this.match.id &&
            ["approved", "pending"].includes(registration.status),
          ).length,
        }];
      }
    } else if (normalized.startsWith(
      "SELECT r.id, r.match_id, r.captain_user_id, r.captain_name, r.captain_game_name, r.captain_game_uid, r.team_name,",
    )) {
      const player = this.users.get(first);
      rows = this.registrations
        .filter((registration) => registration.captain_user_id === first)
        .map((registration) => ({
          ...structuredClone(registration),
          name: player?.name,
          email: player?.email,
          title: this.match.title,
          mode: this.match.mode,
          game_mode: this.match.game_mode,
          team_type: this.match.team_type,
          capacity: this.match.capacity,
          starts_at: this.match.starts_at,
          match_entry_coins: this.match.entry_coins,
          match_status: this.match.status,
          prize_pool: this.match.prize_pool,
          rules: this.match.rules,
          banner: this.match.banner,
          image_url: this.match.image_url,
          prize_distribution: this.match.prize_distribution,
          enabled: this.match.enabled,
          is_full: this.match.is_full,
          room_id: this.match.room_id,
          room_password: this.match.room_password,
          room_time: this.match.room_time,
          room_published: this.match.room_published,
          match_has_started: this.match.starts_at.getTime() <= Date.now() + 5.5 * 60 * 60 * 1000,
          match_has_winner: false,
          result_rank: null,
          result_kills: null,
          result_prize_coins: null,
          match_results: null,
          registered_count: this.registrations.filter((entry) =>
            entry.match_id === this.match.id &&
            ["approved", "pending"].includes(entry.status),
          ).length,
        }));
    } else if (normalized.startsWith(
      "SELECT position, member_name, member_uid FROM daily007_v2_roster WHERE registration_id = $1",
    )) {
      rows = [];
    } else if (
      normalized.startsWith(
        "UPDATE daily007_v2_matches SET room_id = $2, room_password = $3, room_published = true",
      ) &&
      normalized.endsWith("RETURNING id, room_published AS published")
    ) {
      if (first === this.match.id && this.match.status !== "cancelled") {
        this.match.room_id = String(values[1] ?? "");
        this.match.room_password = String(values[2] ?? "");
        this.match.room_published = true;
        rows = [{ id: this.match.id, published: true }];
      }
    } else if (
      normalized.startsWith(
        "UPDATE daily007_v2_matches SET room_id = $2, room_password = $3, room_published = true",
      ) &&
      normalized.endsWith(
        'RETURNING id, room_published AS "roomPublished", room_time AS "roomTime"',
      )
    ) {
      if (first === this.match.id && this.match.status !== "cancelled") {
        this.match.room_id = String(values[1] ?? "");
        this.match.room_password = String(values[2] ?? "");
        this.match.room_published = true;
        rows = [{
          id: this.match.id,
          roomPublished: true,
          roomTime: this.match.room_time,
        }];
      }
    } else if (normalized.startsWith(
      "UPDATE daily007_v2_matches SET room_id = NULL, room_password = NULL, room_published = false",
    )) {
      if (first === this.match.id) {
        this.match.room_id = null;
        this.match.room_password = null;
        this.match.room_published = false;
        rows = [{ id: this.match.id }];
      }
    } else {
      throw new Error(`Unexpected room-access test SQL: ${normalized}`);
    }

    return { rows: rows as T[] };
  }

  async connect() {
    return {
      query: <T = unknown>(sql: string, values?: unknown[]) =>
        this.query<T>(sql, values ?? []),
      release: () => {},
    };
  }
}

export const roomAccessTestDb = new RoomAccessTestDatabase();
export const pool = {
  query: <T = unknown>(sql: string, values?: unknown[]) =>
    roomAccessTestDb.query<T>(sql, values ?? []),
  connect: () => roomAccessTestDb.connect(),
};