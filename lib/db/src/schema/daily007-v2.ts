import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const daily007UsersTable = pgTable("daily007_v2_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  clerkUserId: text("clerk_user_id").unique(),
  passwordSalt: text("password_salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordChangeRequestId: uuid("password_change_request_id"),
  passwordChangeRequestFingerprint: text("password_change_request_fingerprint"),
  authVersion: integer("auth_version").notNull().default(0),
  phone: text("phone"),
  gameUid: text("game_uid"),
  referralCode: text("referral_code"),
  status: text("status").notNull().default("active"),
  role: text("role").notNull().default("user"),
  walletCoins: integer("wallet_coins").notNull().default(0),
  preferredLanguage: text("preferred_language"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("daily007_v2_users_wallet_nonnegative", sql`${table.walletCoins} >= 0`),
  check("daily007_v2_users_role_valid_v2", sql`${table.role} IN ('user', 'tournament_admin', 'admin')`),
  check("daily007_v2_users_status_valid", sql`${table.status} IN ('active', 'blocked')`),
  check(
    "daily007_v2_users_preferred_language_valid",
    sql`${table.preferredLanguage} IS NULL OR ${table.preferredLanguage} IN ('en', 'hi', 'gu')`,
  ),
]);

export const daily007PasswordChangeAttemptsTable = pgTable("daily007_password_change_attempts", {
  userId: uuid("user_id").primaryKey().references(() => daily007UsersTable.id, { onDelete: "cascade" }),
  windowId: uuid("window_id").notNull().defaultRandom(),
  failures: integer("failures").notNull().default(0),
  inFlight: integer("in_flight").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  check("daily007_password_change_failures_nonnegative", sql`${table.failures} >= 0`),
  check("daily007_password_change_in_flight_nonnegative", sql`${table.inFlight} >= 0`),
  check("daily007_password_change_attempts_within_limit", sql`${table.failures} + ${table.inFlight} <= 5`),
]);

export const daily007AdminAccessRequestsTable = pgTable("daily007_v2_admin_access_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => daily007UsersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: uuid("reviewed_by").references(() => daily007UsersTable.id),
}, (table) => [
  check("daily007_v2_admin_access_request_status_valid", sql`${table.status} IN ('pending', 'approved', 'rejected')`),
  uniqueIndex("daily007_v2_admin_access_pending_once").on(table.userId)
    .where(sql`${table.status} = 'pending'`),
  index("daily007_v2_admin_access_status_idx").on(table.status, table.createdAt),
]);

export const daily007GoogleRecoveryRequestsTable = pgTable("daily007_v2_google_recovery_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => daily007UsersTable.id),
  googleClerkUserId: text("google_clerk_user_id").notNull(),
  googleEmail: text("google_email").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: uuid("reviewed_by").references(() => daily007UsersTable.id),
  reviewNote: text("review_note"),
  reviewMethod: text("review_method"),
}, (table) => [
  check("daily007_v2_google_recovery_status_valid", sql`${table.status} IN ('pending', 'approved', 'rejected')`),
  check(
    "daily007_v2_google_recovery_method_valid",
    sql`${table.reviewMethod} IS NULL OR ${table.reviewMethod} IN ('full_admin', 'owner_code')`,
  ),
  check(
    "daily007_v2_google_recovery_review_audit_valid",
    sql`(${table.status} = 'pending' AND ${table.reviewedAt} IS NULL AND ${table.reviewedBy} IS NULL AND ${table.reviewNote} IS NULL)
      OR (${table.status} IN ('approved', 'rejected') AND ${table.reviewedAt} IS NOT NULL
        AND ${table.reviewedBy} IS NOT NULL AND char_length(${table.reviewNote}) BETWEEN 10 AND 500)`,
  ),
  uniqueIndex("daily007_v2_google_recovery_pending_user_once").on(table.userId)
    .where(sql`${table.status} = 'pending'`),
  uniqueIndex("daily007_v2_google_recovery_pending_clerk_once").on(table.googleClerkUserId)
    .where(sql`${table.status} = 'pending'`),
  index("daily007_v2_google_recovery_status_created_idx").on(table.status, table.createdAt),
]);

export const daily007MatchesTable = pgTable("daily007_v2_matches", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  mode: text("mode").notNull(),
  gameMode: text("game_mode"),
  teamType: text("team_type"),
  capacity: integer("capacity").notNull(),
  entryCoins: integer("entry_coins").notNull().default(0),
  prizePool: integer("prize_pool").notNull().default(0),
  killRewardCoins: integer("kill_reward_coins").notNull().default(0),
  rules: text("rules").notNull().default(""),
  banner: text("banner").notNull().default("br"),
  imageUrl: text("image_url"),
  prizeDistribution: text("prize_distribution").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("open"),
  isFull: boolean("is_full").notNull().default(false),
  roomId: text("room_id"),
  roomPassword: text("room_password"),
  roomTime: text("room_time").notNull().default("08:00 PM"),
  roomPublished: boolean("room_published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("daily007_v2_matches_mode_valid", sql`${table.mode} IN ('solo', 'squad', 'clash')`),
  check("daily007_v2_matches_game_mode_valid_v3", sql`
    (${table.gameMode} IS NULL AND ${table.teamType} IS NULL) OR
    (${table.gameMode} IS NOT NULL AND ${table.teamType} IS NOT NULL AND
     ${table.gameMode} IN ('battle_royale', 'battle_royale_kill_earn', 'clash_squad', 'lone_wolf', 'knockout_squad') AND
     ${table.teamType} IN ('solo', 'duo', 'squad') AND
     ((${table.gameMode} = 'knockout_squad' AND ${table.mode} = 'squad' AND ${table.teamType} = 'squad') OR
      (${table.gameMode} IN ('battle_royale', 'battle_royale_kill_earn') AND
        ((${table.teamType} = 'solo' AND ${table.mode} = 'solo') OR
         (${table.teamType} IN ('duo', 'squad') AND ${table.mode} = 'squad'))) OR
      (${table.gameMode} IN ('clash_squad', 'lone_wolf') AND ${table.mode} = 'clash')))
  `),
  check("daily007_v2_matches_capacity_by_format_valid_v3", sql`
    (${table.gameMode} IS NULL AND ${table.teamType} IS NULL AND (
      (${table.mode} = 'solo' AND ${table.capacity} = 48) OR
      (${table.mode} = 'squad' AND ${table.capacity} = 12) OR
      (${table.mode} = 'clash' AND ${table.capacity} = 2)
    )) OR
    (${table.gameMode} IS NOT NULL AND ${table.teamType} IS NOT NULL AND
     ${table.gameMode} IN ('battle_royale', 'battle_royale_kill_earn') AND
      ((${table.teamType} = 'solo' AND ${table.capacity} = 48) OR
       (${table.teamType} = 'duo' AND ${table.capacity} = 24) OR
       (${table.teamType} = 'squad' AND ${table.capacity} = 12))) OR
    (${table.gameMode} = 'knockout_squad' AND ${table.teamType} = 'squad' AND
      ${table.mode} = 'squad' AND ${table.capacity} BETWEEN 4 AND 12) OR
    (${table.gameMode} IS NOT NULL AND ${table.teamType} IS NOT NULL AND
     ${table.gameMode} IN ('clash_squad', 'lone_wolf') AND ${table.capacity} = 2)
  `),
  check("daily007_v2_matches_entry_nonnegative", sql`${table.entryCoins} >= 0`),
  check("daily007_v2_matches_kill_reward_nonnegative", sql`${table.killRewardCoins} >= 0`),
  check("daily007_v2_matches_status_valid_v3", sql`${table.status} IN ('open', 'full', 'setup_needed', 'cancelled', 'completed')`),
  check("daily007_v2_matches_full_consistent_v3", sql`
    ${table.status} = 'cancelled' OR
    (${table.status} = 'completed' AND ${table.enabled} = false) OR
    (${table.isFull} = false AND ${table.status} = 'open') OR
    (${table.isFull} = true AND ${table.status} IN ('full', 'setup_needed'))
  `),
  check("daily007_v2_matches_setup_only_clash", sql`${table.status} <> 'setup_needed' OR ${table.mode} = 'clash'`),
  index("daily007_v2_matches_starts_at_idx").on(table.startsAt),
]);

export const daily007KnockoutEventsTable = pgTable("daily007_knockout_events", {
  matchId: uuid("match_id").primaryKey()
    .references(() => daily007MatchesTable.id, { onDelete: "cascade" }),
  pointsPerKill: integer("points_per_kill").notNull().default(1),
  round1Eliminated: integer("round1_eliminated").notNull().default(2),
  round2Eliminated: integer("round2_eliminated").notNull().default(2),
  createdByUserId: uuid("created_by_user_id")
    .references(() => daily007UsersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("daily007_knockout_points_per_kill_valid", sql`${table.pointsPerKill} BETWEEN 1 AND 1000`),
  check("daily007_knockout_round_eliminations_valid", sql`
    ${table.round1Eliminated} >= 1 AND ${table.round2Eliminated} >= 1
  `),
  index("daily007_knockout_events_updated_at_idx").on(table.updatedAt),
]);

export const daily007RegistrationsTable = pgTable("daily007_v2_registrations", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => daily007MatchesTable.id, { onDelete: "cascade" }),
  captainUserId: uuid("captain_user_id").notNull().references(() => daily007UsersTable.id),
  addedByCaptain: boolean("added_by_captain").notNull().default(false),
  paidByUserId: uuid("paid_by_user_id").references(() => daily007UsersTable.id),
  captainName: text("captain_name").notNull(),
  captainGameName: text("captain_game_name").notNull().default(""),
  captainGameUid: text("captain_game_uid").notNull(),
  teamName: text("team_name").notNull().default(""),
  assignedGroupNumber: integer("assigned_group_number"),
  entryCoinsPaid: integer("entry_coins_paid").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("daily007_v2_registration_once_per_account_non_captain_added")
    .on(table.matchId, table.captainUserId)
    .where(sql`${table.addedByCaptain} = false`),
  check("daily007_v2_registration_paid_nonnegative", sql`${table.entryCoinsPaid} >= 0`),
  check("daily007_v2_registration_status_valid_v2", sql`${table.status} IN ('pending', 'approved', 'rejected', 'removed')`),
  check("daily007_v2_registration_game_uid_nonempty", sql`length(btrim(${table.captainGameUid})) > 0`),
  check("daily007_v2_registration_group_number_positive", sql`${table.assignedGroupNumber} IS NULL OR ${table.assignedGroupNumber} > 0`),
  index("daily007_v2_registrations_match_idx").on(table.matchId),
  uniqueIndex("daily007_v2_registration_active_group_once")
    .on(table.matchId, table.assignedGroupNumber)
    .where(sql`${table.assignedGroupNumber} IS NOT NULL AND ${table.status} IN ('approved', 'pending')`),
]);

export const daily007RosterTable = pgTable("daily007_v2_roster", {
  id: uuid("id").defaultRandom().primaryKey(),
  registrationId: uuid("registration_id").notNull().references(() => daily007RegistrationsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  memberUid: text("member_uid"),
  memberName: text("member_name").notNull(),
}, (table) => [
  unique("daily007_v2_roster_position_unique").on(table.registrationId, table.position),
  check("daily007_v2_roster_position_valid", sql`${table.position} BETWEEN 1 AND 3`),
  check("daily007_v2_roster_member_uid_nonempty", sql`${table.memberUid} IS NULL OR length(btrim(${table.memberUid})) > 0`),
]);

export const daily007SquadTeamsTable = pgTable("daily007_v2_squad_teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => daily007MatchesTable.id, { onDelete: "cascade" }),
  teamNumber: integer("team_number").notNull(),
  captainRegistrationId: uuid("captain_registration_id")
    .references(() => daily007RegistrationsTable.id, { onDelete: "set null" }),
  legacyRegistrationId: uuid("legacy_registration_id")
    .references(() => daily007RegistrationsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("daily007_v2_squad_team_number_unique").on(table.matchId, table.teamNumber),
  uniqueIndex("daily007_v2_squad_team_captain_unique").on(table.captainRegistrationId)
    .where(sql`${table.captainRegistrationId} IS NOT NULL`),
  uniqueIndex("daily007_v2_squad_team_legacy_registration_unique").on(table.legacyRegistrationId)
    .where(sql`${table.legacyRegistrationId} IS NOT NULL`),
  check("daily007_v2_squad_team_number_24_valid", sql`${table.teamNumber} BETWEEN 1 AND 24`),
]);

export const daily007SquadTeamMembersTable = pgTable("daily007_v2_squad_team_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id").notNull().references(() => daily007SquadTeamsTable.id, { onDelete: "cascade" }),
  slotNumber: integer("slot_number").notNull(),
  registrationId: uuid("registration_id").references(() => daily007RegistrationsTable.id, { onDelete: "cascade" }),
  legacyGameName: text("legacy_game_name"),
  legacyGameUid: text("legacy_game_uid"),
  isActive: boolean("is_active").notNull().default(true),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removedByUserId: uuid("removed_by_user_id").references(() => daily007UsersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("daily007_v2_squad_team_member_active_slot_unique")
    .on(table.teamId, table.slotNumber)
    .where(sql`${table.isActive} = true`),
  uniqueIndex("daily007_v2_squad_team_member_registration_unique")
    .on(table.registrationId)
    .where(sql`${table.registrationId} IS NOT NULL`),
  check("daily007_v2_squad_team_member_slot_valid", sql`${table.slotNumber} BETWEEN 1 AND 4`),
  check("daily007_v2_squad_team_member_identity_valid", sql`
    (${table.registrationId} IS NOT NULL AND ${table.legacyGameName} IS NULL AND ${table.legacyGameUid} IS NULL)
    OR
    (${table.registrationId} IS NULL AND ${table.legacyGameName} IS NOT NULL
      AND length(btrim(${table.legacyGameName})) > 0
      AND (${table.legacyGameUid} IS NULL OR length(btrim(${table.legacyGameUid})) > 0))
  `),
  check("daily007_v2_squad_team_member_removed_state_valid", sql`
    (${table.isActive} = true AND ${table.removedAt} IS NULL)
    OR (${table.isActive} = false AND ${table.removedAt} IS NOT NULL)
  `),
]);

export const daily007WalletLedgerTable = pgTable("daily007_v2_wallet_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => daily007UsersTable.id),
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  reason: text("reason").notNull(),
  // Historical IDs are retained after the 72-hour match cleanup removes match rows.
  // Wallet ledger rows are immutable; these identifiers intentionally have no foreign keys.
  matchId: uuid("match_id"),
  registrationId: uuid("registration_id"),
  idempotencyKey: text("idempotency_key"),
  details: jsonb("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("daily007_v2_ledger_balance_nonnegative", sql`${table.balanceAfter} >= 0`),
  uniqueIndex("daily007_v2_ledger_registration_debit_once").on(table.registrationId)
    .where(sql`${table.reason} = 'match_entry'`),
  uniqueIndex("daily007_v2_ledger_registration_refund_once").on(table.registrationId)
    .where(sql`${table.reason} = 'registration_refund'`),
  uniqueIndex("daily007_v2_ledger_idempotency_key_unique").on(table.idempotencyKey),
  index("daily007_v2_wallet_ledger_user_idx").on(table.userId, table.createdAt),
]);

export const daily007KillEarnCorrectionsTable = pgTable("daily007_v2_kill_earn_corrections", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: text("request_id").notNull().unique(),
  matchId: uuid("match_id").notNull(),
  registrationId: uuid("registration_id").notNull(),
  userId: uuid("user_id").notNull().references(() => daily007UsersTable.id, { onDelete: "cascade" }),
  previousKills: integer("previous_kills").notNull(),
  correctedKills: integer("corrected_kills").notNull(),
  rewardPerKill: integer("reward_per_kill").notNull(),
  coinDelta: integer("coin_delta").notNull(),
  reason: text("reason").notNull(),
  adminId: uuid("admin_id").notNull(),
  ledgerId: uuid("ledger_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("daily007_v2_kill_earn_correction_previous_kills_valid", sql`${table.previousKills} BETWEEN 0 AND 47`),
  check("daily007_v2_kill_earn_correction_corrected_kills_valid", sql`${table.correctedKills} BETWEEN 0 AND 47`),
  check("daily007_v2_kill_earn_correction_rate_valid", sql`${table.rewardPerKill} BETWEEN 0 AND 100`),
  check("daily007_v2_kill_earn_correction_delta_consistent", sql`
    ${table.coinDelta}::numeric =
      (${table.correctedKills}::numeric - ${table.previousKills}::numeric) * ${table.rewardPerKill}::numeric
  `),
  check("daily007_v2_kill_earn_correction_reason_nonempty", sql`length(btrim(${table.reason})) > 0`),
  index("daily007_v2_kill_earn_correction_match_idx").on(table.matchId, table.createdAt),
  index("daily007_v2_kill_earn_correction_user_idx").on(table.userId, table.createdAt),
]);

export const insertDaily007UserSchema = createInsertSchema(daily007UsersTable).omit({
  id: true,
  createdAt: true,
});
export const insertDaily007MatchSchema = createInsertSchema(daily007MatchesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDaily007User = z.infer<typeof insertDaily007UserSchema>;
export type Daily007User = typeof daily007UsersTable.$inferSelect;
export type InsertDaily007Match = z.infer<typeof insertDaily007MatchSchema>;
export type Daily007Match = typeof daily007MatchesTable.$inferSelect;