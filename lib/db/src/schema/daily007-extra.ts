import {
  boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  daily007UsersTable,
  daily007MatchesTable,
  daily007RegistrationsTable,
  daily007WalletLedgerTable,
} from "./daily007-v2";

export const daily007PaymentsTable = pgTable("daily007_v2_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => daily007UsersTable.id),
  coins: integer("coins").notNull(),
  amount: integer("amount").notNull(),
  payerUpiId: text("payer_upi_id"),
  referenceNormalized: text("reference_normalized").notNull().unique(),
  reference: text("reference").notNull(),
  proofObjectPath: text("proof_object_path"),
  status: text("status").notNull().default("pending"),
  reviewReason: text("review_reason"),
  reviewedBy: uuid("reviewed_by").references(() => daily007UsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (table) => [
  check("daily007_payment_coins_valid", sql`${table.coins} BETWEEN 1 AND 2147483647`),
  check("daily007_payment_status_valid", sql`${table.status} IN ('pending', 'approved', 'rejected', 'deleted')`),
  index("daily007_payment_user_idx").on(table.userId, table.createdAt),
  uniqueIndex("daily007_one_pending_payment_per_user").on(table.userId)
    .where(sql`${table.status} = 'pending'`),
]);

export const daily007WithdrawalsTable = pgTable("daily007_v2_withdrawals", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => daily007UsersTable.id),
  coins: integer("coins").notNull(),
  method: text("method").notNull(),
  account: text("account").notNull(),
  status: text("status").notNull().default("pending"),
  payoutStatus: text("payout_status").notNull().default("not_paid"),
  reviewReason: text("review_reason"),
  reviewedBy: uuid("reviewed_by").references(() => daily007UsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (table) => [
  check("daily007_withdrawal_coins_valid", sql`${table.coins} BETWEEN 1 AND 2147483647`),
  check("daily007_withdrawal_status_valid", sql`${table.status} IN ('pending', 'approved', 'rejected', 'deleted')`),
  check("daily007_withdrawal_payout_status_valid", sql`${table.payoutStatus} IN ('not_paid', 'manual_payout_required', 'paid')`),
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

export const daily007ReferralShortCodesTable = pgTable("daily007_v2_referral_short_codes", {
  userId: uuid("user_id").primaryKey().references(() => daily007UsersTable.id),
  code: text("code").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("daily007_referral_short_code_format", sql`${table.code} ~ '^[A-Z]{5}$'`),
]);

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
  index("daily007_result_awards_match_idx").on(table.matchId),
]);

export const daily007UserStatsTable = pgTable("daily007_v2_user_stats", {
  userId: uuid("user_id").primaryKey().references(() => daily007UsersTable.id),
  matches: integer("matches").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  kills: integer("kills").notNull().default(0),
  prizeCoins: integer("prize_coins").notNull().default(0),
});

export const daily007YoutubeSubscribeClaimsTable = pgTable("daily007_v2_youtube_subscribe_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => daily007UsersTable.id),
  taskKey: text("task_key").notNull().default("youtube_subscribe"),
  rewardCoins: integer("reward_coins").notNull(),
  status: text("status").notNull().default("pending"),
  reviewReason: text("review_reason"),
  reviewedBy: uuid("reviewed_by").references(() => daily007UsersTable.id),
  rewardLedgerId: uuid("reward_ledger_id").references(() => daily007WalletLedgerTable.id).unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (table) => [
  check("daily007_youtube_claim_reward_valid", sql`${table.rewardCoins} BETWEEN 1 AND 2147483647`),
  check("daily007_youtube_claim_status_valid", sql`${table.status} IN ('pending', 'approved', 'rejected')`),
  index("daily007_youtube_claim_user_idx").on(table.userId, table.taskKey, table.createdAt),
  index("daily007_youtube_claim_status_idx").on(table.status, table.createdAt),
  uniqueIndex("daily007_youtube_one_pending_claim_per_user").on(table.userId, table.taskKey)
    .where(sql`${table.status} = 'pending'`),
  uniqueIndex("daily007_youtube_one_completion_per_user").on(table.userId, table.taskKey)
    .where(sql`${table.status} = 'approved'`),
]);

export const daily007VideosTable = pgTable("daily007_v2_videos", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  topic: text("topic").notNull().default("General"),
  youtubeId: text("youtube_id").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => daily007UsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("daily007_video_title_valid", sql`length(btrim(${table.title})) BETWEEN 1 AND 120`),
  check("daily007_video_topic_valid", sql`length(btrim(${table.topic})) BETWEEN 1 AND 80`),
  check("daily007_video_youtube_id_valid", sql`${table.youtubeId} ~ '^[A-Za-z0-9_-]{11}$'`),
  index("daily007_video_active_created_idx").on(table.active, table.createdAt),
]);

export const daily007VideoWatchSessionsTable = pgTable("daily007_v2_video_watch_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => daily007UsersTable.id),
  videoId: uuid("video_id").notNull().references(() => daily007VideosTable.id),
  durationSeconds: integer("duration_seconds").notNull(),
  reportedPercent: integer("reported_percent").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  rewardLedgerId: uuid("reward_ledger_id").references(() => daily007WalletLedgerTable.id).unique(),
}, (table) => [
  check("daily007_video_watch_duration_valid", sql`${table.durationSeconds} BETWEEN 5 AND 86400`),
  check("daily007_video_watch_percent_valid", sql`${table.reportedPercent} BETWEEN 0 AND 100`),
  index("daily007_video_watch_user_video_idx").on(table.userId, table.videoId, table.startedAt),
  index("daily007_video_watch_video_idx").on(table.videoId, table.startedAt),
]);