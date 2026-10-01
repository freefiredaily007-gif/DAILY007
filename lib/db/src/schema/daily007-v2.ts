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
  phone: text("phone"),
  gameUid: text("game_uid"),
  referralCode: text("referral_code"),
  status: text("status").notNull().default("active"),
  role: text("role").notNull().default("user"),
  walletCoins: integer("wallet_coins").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("daily007_v2_users_wallet_nonnegative", sql`${table.walletCoins} >= 0`),
  check("daily007_v2_users_role_valid", sql`${table.role} IN ('user', 'admin')`),
  check("daily007_v2_users_status_valid", sql`${table.status} IN ('active', 'blocked')`),
]);

export const daily007MatchesTable = pgTable("daily007_v2_matches", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  mode: text("mode").notNull(),
  capacity: integer("capacity").notNull(),
  entryCoins: integer("entry_coins").notNull().default(0),
  prizePool: integer("prize_pool").notNull().default(0),
  rules: text("rules").notNull().default(""),
  banner: text("banner").notNull().default("br"),
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
  check("daily007_v2_matches_capacity_valid", sql`
    (${table.mode} = 'solo' AND ${table.capacity} = 48) OR
    (${table.mode} = 'squad' AND ${table.capacity} = 12) OR
    (${table.mode} = 'clash' AND ${table.capacity} = 2)
  `),
  check("daily007_v2_matches_entry_nonnegative", sql`${table.entryCoins} >= 0`),
  check("daily007_v2_matches_status_valid", sql`${table.status} IN ('open', 'full', 'setup_needed')`),
  check("daily007_v2_matches_full_consistent", sql`
    (${table.isFull} = false AND ${table.status} = 'open') OR
    (${table.isFull} = true AND ${table.status} IN ('full', 'setup_needed'))
  `),
  check("daily007_v2_matches_setup_only_clash", sql`${table.status} <> 'setup_needed' OR ${table.mode} = 'clash'`),
]);

export const daily007RegistrationsTable = pgTable("daily007_v2_registrations", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => daily007MatchesTable.id, { onDelete: "cascade" }),
  captainUserId: uuid("captain_user_id").notNull().references(() => daily007UsersTable.id),
  captainName: text("captain_name").notNull(),
  captainGameUid: text("captain_game_uid").notNull(),
  teamName: text("team_name").notNull().default(""),
  entryCoinsPaid: integer("entry_coins_paid").notNull(),
  status: text("status").notNull().default("approved"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("daily007_v2_registration_once_per_account").on(table.matchId, table.captainUserId),
  check("daily007_v2_registration_paid_nonnegative", sql`${table.entryCoinsPaid} >= 0`),
  check("daily007_v2_registration_status_valid", sql`${table.status} IN ('pending', 'approved', 'rejected')`),
  check("daily007_v2_registration_game_uid_nonempty", sql`length(btrim(${table.captainGameUid})) > 0`),
  index("daily007_v2_registrations_match_idx").on(table.matchId),
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

export const daily007WalletLedgerTable = pgTable("daily007_v2_wallet_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => daily007UsersTable.id),
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  reason: text("reason").notNull(),
  matchId: uuid("match_id").references(() => daily007MatchesTable.id),
  registrationId: uuid("registration_id").references(() => daily007RegistrationsTable.id),
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