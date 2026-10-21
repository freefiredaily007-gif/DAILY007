export type SquadSqlClient = {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

export type SquadOccupancy = {
  filledTeams: number;
  filledPlayers: number;
};

type LegacyRegistration = {
  id: string;
  captain_game_name: string;
  captain_game_uid: string;
  team_number: number | null;
};

/**
 * Give pre-redesign whole-team registrations stable display positions without
 * changing their saved registrations or rosters. Called while the match row is
 * locked, so two first-time Squad reads cannot allocate the same team number.
 */
export async function ensureLegacySquadTeams(
  client: SquadSqlClient,
  matchId: string,
  teamCount = 12,
  teamSize = 4,
): Promise<void> {
  const legacy = await client.query<LegacyRegistration>(
    `SELECT r.id, r.captain_game_name, r.captain_game_uid,
            r.assigned_group_number AS team_number
       FROM daily007_v2_registrations r
       JOIN daily007_v2_matches m ON m.id = r.match_id
      WHERE r.match_id = $1
        AND r.status IN ('approved', 'pending')
        AND (m.game_mode IS NULL OR m.team_type IN ('duo', 'squad'))
        AND NOT EXISTS (
          SELECT 1 FROM daily007_v2_squad_teams t WHERE t.legacy_registration_id = r.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM daily007_v2_squad_team_members member
           WHERE member.registration_id = r.id
        )
      ORDER BY r.assigned_group_number NULLS LAST, r.created_at, r.id
      FOR UPDATE OF r`,
    [matchId],
  );

  const takenResult = await client.query<{ team_number: number }>(
    "SELECT team_number FROM daily007_v2_squad_teams WHERE match_id = $1 FOR UPDATE",
    [matchId],
  );
  const taken = new Set(takenResult.rows.map((row) => Number(row.team_number)));
  for (const registration of legacy.rows) {
    let teamNumber = registration.team_number === null ? 1 : Number(registration.team_number);
    if (!Number.isSafeInteger(teamNumber) || teamNumber < 1 || teamNumber > teamCount) {
      teamNumber = 1;
      while (teamNumber <= teamCount && taken.has(teamNumber)) teamNumber++;
    }
    if (teamNumber > teamCount || taken.has(teamNumber)) continue;

    const teamResult = await client.query<{ id: string }>(
      `INSERT INTO daily007_v2_squad_teams
         (match_id, team_number, captain_registration_id, legacy_registration_id)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (match_id, team_number) DO NOTHING
       RETURNING id`,
      [matchId, teamNumber, registration.id],
    );
    const teamId = teamResult.rows[0]?.id;
    if (!teamId) continue;
    taken.add(teamNumber);
    await client.query(
      `INSERT INTO daily007_v2_squad_team_members
         (team_id, slot_number, registration_id, is_active)
       VALUES ($1, 1, $2, true)
       ON CONFLICT DO NOTHING`,
      [teamId, registration.id],
    );
    const roster = await client.query<{ position: number; member_name: string; member_uid: string | null }>(
      `SELECT position, member_name, member_uid
         FROM daily007_v2_roster
        WHERE registration_id = $1
        ORDER BY position`,
      [registration.id],
    );
    for (const member of roster.rows) {
      if (Number(member.position) + 1 > teamSize) continue;
      await client.query(
        `INSERT INTO daily007_v2_squad_team_members
           (team_id, slot_number, legacy_game_name, legacy_game_uid, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT DO NOTHING`,
        [
          teamId,
          Number(member.position) + 1,
          member.member_name.trim() || "Player",
          member.member_uid?.trim() || null,
        ],
      );
    }
  }
}

export async function getSquadOccupancy(
  client: SquadSqlClient,
  matchId: string,
): Promise<SquadOccupancy> {
  const result = await client.query<{ filled_teams: number; filled_players: number }>(
    `SELECT count(DISTINCT member.team_id)::integer AS filled_teams,
            count(member.id)::integer AS filled_players
       FROM daily007_v2_squad_teams team
       LEFT JOIN daily007_v2_squad_team_members member
         ON member.team_id = team.id AND member.is_active = true
      WHERE team.match_id = $1`,
    [matchId],
  );
  return {
    filledTeams: Number(result.rows[0]?.filled_teams ?? 0),
    filledPlayers: Number(result.rows[0]?.filled_players ?? 0),
  };
}

export async function deactivateSquadRegistration(
  client: SquadSqlClient,
  registrationId: string,
  removedByUserId: string | null = null,
): Promise<void> {
  const membership = await client.query<{
    team_id: string;
    legacy_registration_id: string | null;
    captain_registration_id: string | null;
  }>(
    `SELECT member.team_id, team.legacy_registration_id, team.captain_registration_id
       FROM daily007_v2_squad_team_members member
       JOIN daily007_v2_squad_teams team ON team.id = member.team_id
      WHERE member.registration_id = $1 AND member.is_active = true
      FOR UPDATE OF member, team`,
    [registrationId],
  );
  for (const row of membership.rows) {
    if (row.legacy_registration_id === registrationId) {
      await client.query(
        `UPDATE daily007_v2_squad_team_members
            SET is_active = false, removed_at = clock_timestamp(), removed_by_user_id = $2
          WHERE team_id = $1 AND is_active = true`,
        [row.team_id, removedByUserId],
      );
      await client.query(
        `UPDATE daily007_v2_squad_teams
            SET captain_registration_id = NULL, legacy_registration_id = NULL
          WHERE id = $1`,
        [row.team_id],
      );
      continue;
    }

    await client.query(
      `UPDATE daily007_v2_squad_team_members
          SET is_active = false, removed_at = clock_timestamp(), removed_by_user_id = $2
        WHERE team_id = $1 AND registration_id = $3 AND is_active = true`,
      [row.team_id, removedByUserId, registrationId],
    );
    if (row.captain_registration_id === registrationId) {
      const nextCaptain = await client.query<{ registration_id: string }>(
        `SELECT member.registration_id
           FROM daily007_v2_squad_team_members member
           JOIN daily007_v2_registrations r ON r.id = member.registration_id
          WHERE member.team_id = $1 AND member.is_active = true
            AND r.status IN ('approved', 'pending')
          ORDER BY member.slot_number, member.created_at, member.id
          LIMIT 1`,
        [row.team_id],
      );
      await client.query(
        "UPDATE daily007_v2_squad_teams SET captain_registration_id = $2 WHERE id = $1",
        [row.team_id, nextCaptain.rows[0]?.registration_id ?? null],
      );
    }
  }
}
