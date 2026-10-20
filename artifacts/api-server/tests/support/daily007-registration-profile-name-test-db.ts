type TestUser = {
  id: string;
  name: string;
  email: string;
  role: "user" | "tournament_admin";
  wallet_coins: number;
  phone: string | null;
  game_uid: null;
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
  status: string;
  entry_coins: number;
  prize_pool: number;
  rules: string;
  banner: string;
  image_url: string | null;
  prize_distribution: string;
  starts_at: Date;
  enabled: boolean;
  is_full: boolean;
  room_id: string | null;
  room_password: string | null;
  room_time: string;
  room_published: boolean;
};

export type CapturedRegistration = {
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
  created_at: Date;
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
  reason: "match_entry" | "registration_refund";
  match_id: string;
  registration_id: string;
};

export type CapturedResultAward = {
  match_id: string;
  registration_id: string;
  rank: number;
  kills: number;
  prize_coins: number;
};

type CapturedSquadTeam = {
  id: string;
  match_id: string;
  team_number: number;
  captain_registration_id: string;
  legacy_registration_id: string;
};

type CapturedSquadMember = {
  team_id: string;
  slot_number: number;
  registration_id: string | null;
  legacy_game_name: string | null;
  legacy_game_uid: string | null;
  is_active: boolean;
};

type RegistrationProfileTransactionSnapshot = {
  user: TestUser;
  tournamentAdmin: TestUser;
  additionalUsers: TestUser[];
  match: TestMatch;
  additionalMatches: TestMatch[];
  registrations: CapturedRegistration[];
  roster: CapturedRosterMember[];
  ledger: CapturedLedgerEntry[];
  resultAwards: CapturedResultAward[];
  squadTeams: CapturedSquadTeam[];
  squadMembers: CapturedSquadMember[];
};

export const TEST_PLAYER_ID = "74000000-0000-4000-8000-000000000001";
export const TEST_MATCH_ID = "74000000-0000-4000-8000-000000000002";
export const TEST_TOURNAMENT_ADMIN_ID = "74000000-0000-4000-8000-000000000003";
export const PUBLIC_PARTICIPANT_PRIVATE_EMAIL = "participant-private-email-8d74@example.test";
export const PUBLIC_PARTICIPANT_PRIVATE_PHONE = "+1-555-019-8274";
export const PUBLIC_PARTICIPANT_PRIVATE_WALLET = 839174263;

class RegistrationProfileTestDatabase {
  user!: TestUser;
  tournamentAdmin!: TestUser;
  additionalUsers: TestUser[] = [];
  match!: TestMatch;
  additionalMatches: TestMatch[] = [];
  registrations: CapturedRegistration[] = [];
  roster: CapturedRosterMember[] = [];
  ledger: CapturedLedgerEntry[] = [];
  resultAwards: CapturedResultAward[] = [];
  squadTeams: CapturedSquadTeam[] = [];
  squadMembers: CapturedSquadMember[] = [];
  connectCount = 0;
  failRosterInsertAtPosition: number | null = null;

  constructor() {
    this.reset();
  }

  reset(profileName = "Daily007 Player"): void {
    this.additionalUsers = [];
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
    this.tournamentAdmin = {
      id: TEST_TOURNAMENT_ADMIN_ID,
      name: "Test Tournament Admin",
      email: "tournament-admin@example.test",
      role: "tournament_admin",
      wallet_coins: 0,
      phone: null,
      game_uid: null,
      status: "active",
      auth_version: 0,
    };
    this.match = {
      id: TEST_MATCH_ID,
      title: "Captain Profile Test Match",
      mode: "clash",
      game_mode: "clash_squad",
      team_type: "squad",
      capacity: 12,
      status: "open",
      entry_coins: 7,
      prize_pool: 100,
      rules: "Test rules",
      banner: "",
      image_url: null,
      prize_distribution: "[]",
      starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      enabled: true,
      is_full: false,
      room_id: null,
      room_password: null,
      room_time: "",
      room_published: false,
    };
    this.additionalMatches = [];
    this.registrations = [];
    this.roster = [];
    this.ledger = [];
    this.resultAwards = [];
    this.squadTeams = [];
    this.squadMembers = [];
    this.connectCount = 0;
    this.failRosterInsertAtPosition = null;
  }

  seedPublicParticipantPrivacySentinels(): void {
    this.user.email = PUBLIC_PARTICIPANT_PRIVATE_EMAIL;
    this.user.phone = PUBLIC_PARTICIPANT_PRIVATE_PHONE;
    this.user.wallet_coins = PUBLIC_PARTICIPANT_PRIVATE_WALLET;
  }

  addOtherRegistration(
    status: CapturedRegistration["status"] = "approved",
    matchId = this.match.id,
    label = "Other",
    includeRoster = true,
  ): {
    registration: CapturedRegistration;
    roster: CapturedRosterMember[];
  } {
    if (matchId !== this.match.id && !this.additionalMatches.some((match) => match.id === matchId)) {
      this.additionalMatches.push({
        ...structuredClone(this.match),
        id: matchId,
        title: "Other Fire Tournament",
      });
    }
    const labelSlug = label.replace(/[^a-zA-Z0-9]/g, "") || "Other";
    const captainUserId = `74000000-0000-4000-8000-${String(this.additionalUsers.length + 4).padStart(12, "0")}`;
    const registrationId = `74000000-0000-4000-8000-${String(this.registrations.length + 11).padStart(12, "0")}`;
    this.additionalUsers.push({
      ...structuredClone(this.user),
      id: captainUserId,
      name: `${label} Daily007 Player`,
      email: `${labelSlug.toLowerCase()}-captain-profile-test@example.test`,
    });
    const registration: CapturedRegistration = {
      id: registrationId,
      match_id: matchId,
      captain_user_id: captainUserId,
      captain_name: `${label} Daily007 Player`,
      captain_game_name: `${labelSlug}FireCaptain`,
      captain_game_uid: `FF-${labelSlug.toUpperCase()}-CAPTAIN-UID`,
      team_name: `${label} Fire`,
      assigned_group_number: null,
      entry_coins_paid: this.match.entry_coins,
      status,
      created_at: new Date(),
    };
    const roster: CapturedRosterMember[] = [
      {
        registration_id: registrationId,
        position: 1,
        member_uid: `FF-${labelSlug.toUpperCase()}-TEAMMATE-UID`,
        member_name: `${label} FireMate`,
      },
      {
        registration_id: registrationId,
        position: 2,
        member_uid: `FF-${labelSlug.toUpperCase()}-TEAMMATE-TWO-UID`,
        member_name: `${label} FireMateTwo`,
      },
      {
        registration_id: registrationId,
        position: 3,
        member_uid: `FF-${labelSlug.toUpperCase()}-TEAMMATE-THREE-UID`,
        member_name: `${label} FireMateThree`,
      },
    ];
    this.registrations.push(registration);
    if (includeRoster) this.roster.push(...roster);
    return {
      registration: structuredClone(registration),
      roster: includeRoster ? structuredClone(roster) : [],
    };
  }

  async query<T = unknown>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    return this.execute<T>(sql, values);
  }

  async connect() {
    this.connectCount += 1;
    let transactionSnapshot: RegistrationProfileTransactionSnapshot | null = null;
    return {
      query: <T = unknown>(sql: string, values: unknown[] = []) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized === "BEGIN") {
          transactionSnapshot = {
            user: structuredClone(this.user),
            tournamentAdmin: structuredClone(this.tournamentAdmin),
            additionalUsers: structuredClone(this.additionalUsers),
            match: structuredClone(this.match),
            additionalMatches: structuredClone(this.additionalMatches),
            registrations: structuredClone(this.registrations),
            roster: structuredClone(this.roster),
            ledger: structuredClone(this.ledger),
            resultAwards: structuredClone(this.resultAwards),
            squadTeams: structuredClone(this.squadTeams),
            squadMembers: structuredClone(this.squadMembers),
          };
        } else if (normalized === "ROLLBACK" && transactionSnapshot) {
          this.user = transactionSnapshot.user;
          this.tournamentAdmin = transactionSnapshot.tournamentAdmin;
          this.additionalUsers = transactionSnapshot.additionalUsers;
          this.match = transactionSnapshot.match;
          this.additionalMatches = transactionSnapshot.additionalMatches;
          this.registrations = transactionSnapshot.registrations;
          this.roster = transactionSnapshot.roster;
          this.ledger = transactionSnapshot.ledger;
          this.resultAwards = transactionSnapshot.resultAwards;
          this.squadTeams = transactionSnapshot.squadTeams;
          this.squadMembers = transactionSnapshot.squadMembers;
          transactionSnapshot = null;
        } else if (normalized === "COMMIT") {
          transactionSnapshot = null;
        }
        return this.execute<T>(sql, values);
      },
      release: () => {},
    };
  }

  private async execute<T>(sql: string, values: unknown[]): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, " ").trim();
    let result: unknown[] = [];

    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
      result = [];
    } else if (normalized === "SELECT match_id FROM daily007_v2_registrations WHERE id = $1") {
      const registration = this.registrations.find((candidate) =>
        candidate.id === String(values[0])
      );
      result = registration ? [{ match_id: registration.match_id }] : [];
    } else if (
      normalized === "SELECT capacity, mode, status FROM daily007_v2_matches WHERE id = $1 FOR UPDATE"
    ) {
      const match = [this.match, ...this.additionalMatches].find((candidate) =>
        candidate.id === String(values[0])
      );
      result = match ? [structuredClone(match)] : [];
    } else if (
      normalized.startsWith("SELECT id, match_id, captain_user_id, entry_coins_paid, status FROM daily007_v2_registrations")
    ) {
      const registration = this.registrations.find((candidate) =>
        candidate.id === String(values[0])
      );
      result = registration ? [structuredClone(registration)] : [];
    } else if (
      normalized === "SELECT status FROM daily007_v2_registrations WHERE id = $1 FOR UPDATE"
    ) {
      const registration = this.registrations.find((candidate) =>
        candidate.id === String(values[0])
      );
      result = registration ? [{ status: registration.status }] : [];
    } else if (
      normalized.startsWith("SELECT id, name, email, role, wallet_coins, phone, game_uid, status, auth_version FROM daily007_v2_users")
    ) {
      const account = [this.user, this.tournamentAdmin, ...this.additionalUsers].find((candidate) =>
        candidate.id === String(values[0])
      );
      result = account ? [structuredClone(account)] : [];
    } else if (
      normalized.startsWith("SELECT r.id, r.match_id, r.captain_user_id, r.captain_name, r.captain_game_name,")
    ) {
      const includesProfileNameInMatchResults = normalized.includes(
        "'playerName', result_registration.captain_name",
      );
      result = this.registrations
        .filter((registration) => registration.captain_user_id === String(values[0]))
        .map((registration) => ({
          ...structuredClone(registration),
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
          match_has_started: false,
          match_has_winner: false,
          match_results: this.resultAwards
            .filter((award) => award.match_id === registration.match_id)
            .flatMap((award) => {
              const finisher = this.registrations.find((candidate) =>
                candidate.id === award.registration_id
              );
              return finisher
                ? [{
                    rank: award.rank,
                    kills: award.kills,
                    prizeCoins: award.prize_coins,
                    gameName: finisher.captain_game_name,
                    teamName: finisher.team_name,
                    ...(includesProfileNameInMatchResults
                      ? { playerName: finisher.captain_name }
                      : {}),
                  }]
                : [];
            })
            .sort((left, right) =>
              left.rank - right.rank || left.gameName.localeCompare(right.gameName)
            ),
          result_rank: null,
          result_kills: null,
          result_prize_coins: null,
          registered_count: this.registrations.filter((candidate) =>
            candidate.match_id === this.match.id &&
            ["approved", "pending"].includes(candidate.status)
          ).length,
        }));
    } else if (normalized.startsWith("SELECT m.id, m.title, m.mode, m.game_mode, m.team_type, m.capacity, m.entry_coins, m.prize_pool, m.starts_at,")) {
      const idFilter = normalized.includes("m.id = $1") ? String(values[0]) : null;
      const match = [this.match, ...this.additionalMatches].find((candidate) =>
        (!idFilter || candidate.id === idFilter) &&
        (idFilter !== null || candidate.status !== "cancelled") &&
        (!normalized.includes("m.enabled = true") || candidate.enabled)
      );
      result = match
        ? [{
            ...structuredClone(match),
            has_started: false,
            has_winner: false,
            completed_at: null,
            registered_count: this.registrations.filter((registration) =>
              registration.match_id === match.id &&
              ["approved", "pending"].includes(registration.status)
            ).length,
          }]
        : [];
    } else if (
      normalized.startsWith("SELECT match_id FROM daily007_v2_registrations WHERE id = $1 AND captain_user_id = $2")
    ) {
      const registration = this.registrations.find((candidate) =>
        candidate.id === String(values[0]) && candidate.captain_user_id === String(values[1])
      );
      result = registration ? [{ match_id: registration.match_id }] : [];
    } else if (
      normalized.startsWith("SELECT m.id, m.starts_at, m.status, m.enabled, m.mode, m.game_mode, m.team_type,")
    ) {
      const match = [this.match, ...this.additionalMatches].find((candidate) =>
        candidate.id === String(values[0])
      );
      result = match ? [{ ...structuredClone(match), database_now: new Date(), has_result: false }] : [];
    } else if (
      normalized.startsWith("SELECT id, status FROM daily007_v2_registrations WHERE id = $1 AND match_id = $2")
    ) {
      const registration = this.registrations.find((candidate) =>
        candidate.id === String(values[0]) &&
        candidate.match_id === String(values[1]) &&
        candidate.captain_user_id === String(values[2])
      );
      result = registration ? [{ id: registration.id, status: registration.status }] : [];
    } else if (
      normalized.startsWith("SELECT r.id FROM daily007_v2_registrations r") &&
      normalized.includes("r.match_id = $1") &&
      normalized.includes("r.id <> $2")
    ) {
      const matchId = String(values[0]);
      const excludedRegistrationId = String(values[1]);
      const submittedUids = new Set((values[2] as string[]).map((uid) => uid.toLowerCase()));
      const duplicate = this.registrations.find((registration) =>
        registration.match_id === matchId &&
        registration.id !== excludedRegistrationId &&
        ["approved", "pending"].includes(registration.status) &&
        (
          submittedUids.has(registration.captain_game_uid.toLowerCase()) ||
          this.roster.some((member) =>
            member.registration_id === registration.id &&
            member.member_uid !== null &&
            submittedUids.has(member.member_uid.toLowerCase())
          )
        )
      );
      result = duplicate ? [{ id: duplicate.id }] : [];
    } else if (
      normalized.startsWith("UPDATE daily007_v2_registrations AS r SET captain_game_name = $3")
    ) {
      const registration = this.registrations.find((candidate) =>
        candidate.id === String(values[0]) &&
        candidate.match_id === String(values[1]) &&
        ["approved", "pending"].includes(candidate.status)
      );
      if (registration && this.match.enabled &&
          !["live", "closed", "cancelled", "completed"].includes(this.match.status) &&
          this.match.starts_at.getTime() > Date.now() + 6 * 60 * 60 * 1000) {
        registration.captain_game_name = String(values[2]);
        registration.captain_game_uid = String(values[3]);
        registration.team_name = String(values[4]);
        result = [{ id: registration.id }];
      }
    } else if (normalized === "DELETE FROM daily007_v2_roster WHERE registration_id = $1") {
      this.roster = this.roster.filter((member) => member.registration_id !== String(values[0]));
    } else if (
      normalized.startsWith("INSERT INTO daily007_v2_roster (registration_id, position, member_uid, member_name)")
    ) {
      const [registrationId, position, memberUid, memberName] = values;
      if (Number(position) === this.failRosterInsertAtPosition) {
        throw new Error(`Injected roster insert failure at position ${String(position)}.`);
      }
      this.roster.push({
        registration_id: String(registrationId),
        position: Number(position),
        member_uid: memberUid == null ? null : String(memberUid),
        member_name: String(memberName),
      });
    } else if (
      normalized.startsWith("SELECT position, member_name, member_uid FROM daily007_v2_roster")
    ) {
      result = this.roster
        .filter((member) => member.registration_id === String(values[0]))
        .sort((left, right) => left.position - right.position)
        .map((member) => structuredClone(member));
    } else if (normalized ===
      "SELECT member_name, member_uid FROM daily007_v2_roster WHERE registration_id = $1 ORDER BY position"
    ) {
      result = this.roster
        .filter((member) => member.registration_id === String(values[0]))
        .sort((left, right) => left.position - right.position)
        .map(({ member_name, member_uid }) => ({ member_name, member_uid }));
    } else if (
      normalized.startsWith("SELECT r.id AS registration_id, r.status, NULLIF(BTRIM(r.team_name), '') AS team_name,")
    ) {
      const statusFilter = normalized.match(/r\.status IN \(([^)]*)\)/i)?.[1];
      const allowedStatuses = statusFilter === undefined
        ? undefined
        : [...statusFilter.matchAll(/'([^']+)'/g)].map(([, status]) => status);
      result = this.registrations
        .filter((registration) =>
          registration.match_id === String(values[0]) &&
          (!allowedStatuses || allowedStatuses.includes(registration.status))
        )
        .flatMap((registration) => {
          const roster = this.roster
            .filter((member) => member.registration_id === registration.id)
            .sort((left, right) => left.position - right.position);
          return (roster.length ? roster : [null]).map((member) => ({
            registration_id: registration.id,
            status: registration.status,
            team_name: registration.team_name.trim() || null,
            captain_game_name: registration.captain_game_name,
            position: member?.position ?? null,
            member_name: member?.member_name ?? null,
          }));
        });
    } else if (
      normalized.startsWith("SELECT team.team_number, COALESCE(registration.status, legacy.status) AS status,")
    ) {
      result = this.squadTeams
        .filter((team) => team.match_id === String(values[0]))
        .sort((left, right) => left.team_number - right.team_number)
        .flatMap((team) => {
          const legacy = this.registrations.find(
            (registration) => registration.id === team.legacy_registration_id,
          );
          return this.squadMembers
            .filter((member) => member.team_id === team.id && member.is_active)
            .flatMap((member) => {
              const registration = member.registration_id
                ? this.registrations.find((candidate) => candidate.id === member.registration_id)
                : legacy;
              if (!registration || !["approved", "pending"].includes(registration.status)) return [];
              return [{
                team_number: team.team_number,
                status: registration.status,
                team_name: registration.team_name || `Team ${String(team.team_number).padStart(2, "0")}`,
                game_name: member.registration_id
                  ? registration.captain_game_name
                  : member.legacy_game_name,
              }];
            });
        });
    } else if (normalized.startsWith(
      "SELECT capacity, mode, game_mode, team_type, status FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
    )) {
      const match = [this.match, ...this.additionalMatches].find(
        (candidate) => candidate.id === String(values[0]),
      );
      result = match
        ? [{
            capacity: match.capacity,
            mode: match.mode,
            game_mode: match.game_mode,
            team_type: match.team_type,
            status: match.status,
          }]
        : [];
    } else if (
      normalized.startsWith("SELECT mode, game_mode, team_type FROM daily007_v2_matches WHERE id = $1")
    ) {
      const match = [this.match, ...this.additionalMatches].find(
        (candidate) => candidate.id === String(values[0]),
      );
      result = match
        ? [{ mode: match.mode, game_mode: match.game_mode, team_type: match.team_type }]
        : [];
    } else if (
      normalized.startsWith("SELECT r.id, r.captain_game_name, r.captain_game_uid FROM daily007_v2_registrations r")
    ) {
      const matchId = String(values[0]);
      result = this.registrations
        .filter((registration) =>
          registration.match_id === matchId &&
          ["approved", "pending"].includes(registration.status) &&
          !this.squadTeams.some((team) => team.legacy_registration_id === registration.id) &&
          !this.squadMembers.some((member) => member.registration_id === registration.id)
        )
        .sort((left, right) =>
          left.created_at.getTime() - right.created_at.getTime() || left.id.localeCompare(right.id)
        )
        .map(({ id, captain_game_name, captain_game_uid }) => ({
          id,
          captain_game_name,
          captain_game_uid,
        }));
    } else if (
      normalized === "SELECT team_number FROM daily007_v2_squad_teams WHERE match_id = $1 FOR UPDATE"
    ) {
      result = this.squadTeams
        .filter((team) => team.match_id === String(values[0]))
        .map(({ team_number }) => ({ team_number }));
    } else if (
      normalized.startsWith("INSERT INTO daily007_v2_squad_teams")
    ) {
      const [matchId, teamNumber, registrationId] = values;
      const existing = this.squadTeams.find(
        (team) => team.match_id === String(matchId) && team.team_number === Number(teamNumber),
      );
      if (!existing) {
        const id = `registration-profile-squad-team-${this.squadTeams.length + 1}`;
        this.squadTeams.push({
          id,
          match_id: String(matchId),
          team_number: Number(teamNumber),
          captain_registration_id: String(registrationId),
          legacy_registration_id: String(registrationId),
        });
        result = [{ id }];
      }
    } else if (
      normalized.startsWith("INSERT INTO daily007_v2_squad_team_members (team_id, slot_number, registration_id, is_active)")
    ) {
      const [teamId, registrationId] = values;
      const slotNumber = 1;
      if (!this.squadMembers.some((member) =>
        member.team_id === String(teamId) && member.slot_number === Number(slotNumber) && member.is_active
      )) {
        this.squadMembers.push({
          team_id: String(teamId),
          slot_number: Number(slotNumber),
          registration_id: String(registrationId),
          legacy_game_name: null,
          legacy_game_uid: null,
          is_active: true,
        });
      }
    } else if (
      normalized.startsWith("INSERT INTO daily007_v2_squad_team_members (team_id, slot_number, legacy_game_name, legacy_game_uid, is_active)")
    ) {
      const [teamId, slotNumber, gameName, gameUid] = values;
      if (!this.squadMembers.some((member) =>
        member.team_id === String(teamId) && member.slot_number === Number(slotNumber) && member.is_active
      )) {
        this.squadMembers.push({
          team_id: String(teamId),
          slot_number: Number(slotNumber),
          registration_id: null,
          legacy_game_name: String(gameName),
          legacy_game_uid: gameUid == null ? null : String(gameUid),
          is_active: true,
        });
      }
    } else if (
      normalized === "SELECT id FROM daily007_v2_matches WHERE id = $1"
    ) {
      result = String(values[0]) === this.match.id ? [{ id: this.match.id }] : [];
    } else if (
      normalized === "SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE"
    ) {
      result = String(values[0]) === this.match.id ? [{ id: this.match.id }] : [];
    } else if (
      normalized === "SELECT title FROM daily007_v2_matches WHERE id = $1"
    ) {
      result = String(values[0]) === this.match.id ? [{ title: this.match.title }] : [];
    } else if (
      normalized.startsWith("SELECT r.id AS registration_id, r.captain_name, r.captain_game_name,")
    ) {
      const exactStatus = normalized.match(/r\.status\s*=\s*'([^']+)'/i)?.[1];
      const statusList = normalized.match(/r\.status\s+IN\s*\(([^)]*)\)/i)?.[1];
      const allowedStatuses = exactStatus
        ? [exactStatus]
        : statusList === undefined
          ? null
          : [...statusList.matchAll(/'([^']+)'/g)].map(([, status]) => status);
      result = this.registrations
        .filter((registration) =>
          registration.match_id === String(values[0]) &&
          (!allowedStatuses || allowedStatuses.includes(registration.status))
        )
        .flatMap((registration) => {
          const roster = this.roster
            .filter((member) => member.registration_id === registration.id)
            .sort((left, right) => left.position - right.position);
          return (roster.length ? roster : [null]).map((member) => ({
            registration_id: registration.id,
            captain_name: registration.captain_name,
            captain_game_name: registration.captain_game_name,
            captain_game_uid: registration.captain_game_uid,
            team_name: registration.team_name,
            email: [
              this.user,
              this.tournamentAdmin,
              ...this.additionalUsers,
            ].find((user) => user.id === registration.captain_user_id)?.email ?? "",
            created_at: registration.created_at,
            position: member?.position ?? null,
            member_name: member?.member_name ?? null,
            member_uid: member?.member_uid ?? null,
          }));
        });
    } else if (
      normalized.startsWith("SELECT id, mode, game_mode, team_type, capacity, status, entry_coins, starts_at, enabled FROM daily007_v2_matches")
    ) {
      result = String(values[0]) === this.match.id ? [structuredClone(this.match)] : [];
    } else if (
      normalized.startsWith("SELECT r.id AS registration_id, r.assigned_group_number, r.status")
    ) {
      const matchId = String(values[0]);
      const active = this.registrations
        .filter((registration) =>
          registration.match_id === matchId && ["approved", "pending"].includes(registration.status),
        )
        .sort((left, right) =>
          left.created_at.getTime() - right.created_at.getTime() || left.id.localeCompare(right.id),
        );
      const occupied = new Set(active
        .map((registration) => registration.assigned_group_number)
        .filter((groupNumber): groupNumber is number => groupNumber !== null));
      const capacity = [this.match, ...this.additionalMatches]
        .find((match) => match.id === matchId)?.capacity ?? active.length;
      const available = Array.from({ length: capacity }, (_, index) => index + 1)
        .filter((groupNumber) => !occupied.has(groupNumber));
      const assigned = new Map<string, number | null>();
      for (const registration of active) {
        assigned.set(
          registration.id,
          registration.assigned_group_number ?? available.shift() ?? null,
        );
      }
      result = active.flatMap((registration) => {
        const roster = this.roster
          .filter((member) => member.registration_id === registration.id)
          .sort((left, right) => left.position - right.position);
        return (roster.length ? roster : [null]).map((member) => ({
          registration_id: registration.id,
          assigned_group_number: assigned.get(registration.id) ?? null,
          status: registration.status,
          team_name: registration.team_name,
          captain_game_name: registration.captain_game_name,
          position: member?.position ?? null,
          member_name: member?.member_name ?? null,
        }));
      });
    } else if (
      normalized.startsWith("SELECT r.id, r.captain_game_name, r.captain_game_uid, r.team_name, r.assigned_group_number")
    ) {
      const registration = this.registrations.find((candidate) =>
        candidate.match_id === String(values[0]) &&
        candidate.captain_user_id === String(values[1]),
      );
      const entry = registration && this.ledger.find((candidate) =>
        candidate.registration_id === registration.id,
      );
      const match = registration && [this.match, ...this.additionalMatches].find((candidate) =>
        candidate.id === registration.match_id,
      );
      result = registration && entry && match
        ? [{
            id: registration.id,
            captain_game_name: registration.captain_game_name,
            captain_game_uid: registration.captain_game_uid,
            team_name: registration.team_name,
            assigned_group_number: registration.assigned_group_number,
            entry_coins_paid: registration.entry_coins_paid,
            balance_after: entry.balance_after,
            capacity: match.capacity,
            status: match.status,
            is_full: match.is_full,
            registration_status: registration.status,
          }]
        : [];
    } else if (normalized.startsWith("WITH active AS ( SELECT id, assigned_group_number, created_at FROM daily007_v2_registrations")) {
      const matchId = String(values[0]);
      const capacity = Number(values[1]);
      const active = this.registrations
        .filter((registration) =>
          registration.match_id === matchId && ["approved", "pending"].includes(registration.status),
        )
        .sort((left, right) => left.created_at.getTime() - right.created_at.getTime() || left.id.localeCompare(right.id));
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
      result = [];
    } else if (normalized.startsWith("SELECT starts_at > clock_timestamp()")) {
      result = [{ upcoming: true }];
    } else if (normalized.startsWith(
      "SELECT id, status, captain_game_name, captain_game_uid, team_name FROM daily007_v2_registrations WHERE id = $1 AND match_id = $2 AND captain_user_id = $3 FOR UPDATE",
    )) {
      const registration = this.registrations.find((candidate) =>
        candidate.id === String(values[0]) &&
        candidate.match_id === String(values[1]) &&
        candidate.captain_user_id === String(values[2]),
      );
      result = registration
        ? [{
            id: registration.id,
            status: registration.status,
            captain_game_name: registration.captain_game_name,
            captain_game_uid: registration.captain_game_uid,
            team_name: registration.team_name,
          }]
        : [];
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
      normalized.startsWith("SELECT assigned_group_number FROM daily007_v2_registrations")
    ) {
      result = this.registrations
        .filter((registration) =>
          registration.match_id === String(values[0]) &&
          ["approved", "pending"].includes(registration.status) &&
          registration.assigned_group_number !== null,
        )
        .map((registration) => ({ assigned_group_number: registration.assigned_group_number }));
    } else if (
      normalized === "SELECT status FROM daily007_v2_users WHERE id = $1 FOR SHARE"
    ) {
      const user = [this.user, ...this.additionalUsers].find((candidate) =>
        candidate.id === String(values[0])
      );
      result = user ? [{ status: user.status }] : [];
    } else if (
      normalized === "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE"
    ) {
      const user = [this.user, ...this.additionalUsers].find((candidate) =>
        candidate.id === String(values[0])
      );
      result = user ? [{ wallet_coins: user.wallet_coins, status: user.status }] : [];
    } else if (normalized.startsWith("SELECT wallet_coins")) {
      const user = [this.user, ...this.additionalUsers].find((candidate) =>
        candidate.id === String(values[0])
      );
      result = user ? [{ wallet_coins: user.wallet_coins }] : [];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_registrations")) {
      const [
        matchId,
        captainUserId,
        captainName,
        captainGameName,
        captainGameUid,
        teamName,
        assignedGroupNumber,
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
        assigned_group_number: Number(assignedGroupNumber),
        entry_coins_paid: Number(entryCoinsPaid),
        status: "approved",
        created_at: new Date(),
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
      const user = [this.user, ...this.additionalUsers].find((candidate) =>
        candidate.id === String(values[0])
      );
      if (user) user.wallet_coins = Number(values[1]);
    } else if (normalized.startsWith("INSERT INTO daily007_v2_wallet_ledger")) {
      const [userId, amount, balanceAfter, matchId, registrationId] = values;
      this.ledger.push({
        user_id: String(userId),
        amount: Number(amount),
        balance_after: Number(balanceAfter),
        reason: normalized.includes("'registration_refund'")
          ? "registration_refund"
          : "match_entry",
        match_id: String(matchId),
        registration_id: String(registrationId),
      });
    } else if (
      normalized === "UPDATE daily007_v2_registrations SET status = 'rejected' WHERE id = $1" ||
      normalized === "UPDATE daily007_v2_registrations SET status = 'approved' WHERE id = $1"
    ) {
      const registration = this.registrations.find((candidate) =>
        candidate.id === String(values[0])
      );
      if (registration) {
        registration.status = normalized.includes("'rejected'") ? "rejected" : "approved";
      }
    } else if (normalized.startsWith("UPDATE daily007_v2_matches SET status")) {
      this.match.status = String(values[1]);
    } else if (
      normalized === "UPDATE daily007_v2_matches SET is_full = $2, status = $3 WHERE id = $1"
    ) {
      const match = [this.match, ...this.additionalMatches].find((candidate) =>
        candidate.id === String(values[0])
      );
      if (match) {
        match.is_full = Boolean(values[1]);
        match.status = String(values[2]);
      }
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