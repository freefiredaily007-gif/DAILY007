import {
  check, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { daily007UsersTable, daily007MatchesTable, daily007RegistrationsTable } from "./daily007-v2";

export const daily007PaymentsTable = pgTable("daily007_v2_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => daily007UsersTable.id),
  coins: integer("coins").notNull(),
  amount: integer("amount").notNull(),
  referenceNormalized: text("reference_normalized").notNull().unique(),
  reference: text("reference").notNull(),
  status: text("status").notNull().default("pending"),
  reviewedBy: uuid("reviewed_by").references(() => daily007UsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (table) => [
  check("daily007_payment_coins_valid", sql`${table.coins} BETWEEN 1 AND 2147483647`),
  check("daily007_payment_status_valid", sql`${table.status} IN ('pending', 'approved', 'rejected', 'deleted')`),
  index("daily007_payment_user_idx").on(table.userId, table.createdAt),
]);

export const daily007WithdrawalsTable = pgTable("daily007_v2_withdrawals", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => daily007UsersTable.id),
  coins: integer("coins").notNull(),
  method: text("method").notNull(),
  account: text("account").notNull(),
  status: text("status").notNull().default("pending"),
  payoutStatus: text("payout_status").notNull().default("not_paid"),
  reviewedBy: uuid("reviewed_by").references(() => daily007UsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (table) => [
  check("daily007_withdrawal_coins_valid", sql`${table.coins} BETWEEN 100 AND 2147483647`),
  check("daily007_withdrawal_status_valid", sql`${table.status} IN ('pending', 'approved', 'rejected', 'deleted')`),
  check("daily007_withdrawal_payout_status_valid", sql`${table.payoutStatus} IN ('not_paid', 'manual_payout_required')`),
  index("daily007_withdrawal_user_idx").on(table.userId, table.createdAt),
  uniqueIndex("daily007_one_pending_withdrawal_per_user").on(table.userId)
    .where(sql`${table.status} = 'pending'`),
]);

export const daily007SettingsTable = pgTable("daily007_v2_settings", {
  id: integer("id").primaryKey().default(1),
  settings: jsonb("settings").notNull().default({}),
  updatedBy: uuid("updated_by").references(() => daily007UsersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("daily007_settings_singleton", sql`${table.id} = 1`)]);

export const daily007NotificationsTable = pgTable("daily007_v2_notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => daily007UsersTable.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  type: text("type").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("daily007_notification_user_idx").on(table.userId, table.createdAt)]);

export const daily007ReferralsTable = pgTable("daily007_v2_referrals", {
  id: uuid("id").defaultRandom().primaryKey(),
  referrerUserId: uuid("referrer_user_id").notNull().references(() => daily007UsersTable.id),
  referredUserId: uuid("referred_user_id").notNull().unique().references(() => daily007UsersTable.id),
  code: text("code").notNull(),
  rewardedAt: timestamp("rewarded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const daily007ReferralCodesTable = pgTable("daily007_v2_referral_codes", {
  userId: uuid("user_id").primaryKey().references(() => daily007UsersTable.id),
  code: text("code").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const daily007ResultAwardsTable = pgTable("daily007_v2_result_awards", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => daily007MatchesTable.id),
  registrationId: uuid("registration_id").notNull().unique().references(() => daily007RegistrationsTable.id),
  userId: uuid("user_id").notNull().references(() => daily007UsersTable.id),
  rank: integer("rank").notNull(),
  kills: integer("kills").notNull(),
  prizeCoins: integer("prize_coins").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("daily007_result_rank_valid", sql`${table.rank} BETWEEN 1 AND 2147483647`),
  check("daily007_result_kills_valid", sql`${table.kills} BETWEEN 0 AND 2147483647`),
  check("daily007_result_prize_valid", sql`${table.prizeCoins} BETWEEN 0 AND 2147483647`),
]);

export const daily007UserStatsTable = pgTable("daily007_v2_user_stats", {
  userId: uuid("user_id").primaryKey().references(() => daily007UsersTable.id),
  matches: integer("matches").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  kills: integer("kills").notNull().default(0),
  prizeCoins: integer("prize_coins").notNull().default(0),
});