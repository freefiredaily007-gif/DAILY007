import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { daily007UsersTable } from "./daily007-v2";

/**
 * This is an immutable-history record independent of the match/registration
 * rows, which are subject to the app's match-retention policy. User deletion
 * still removes that user's reward rows.
 */
export const daily007KillEarnRewardsTable = pgTable("daily007_v2_kill_earn_rewards", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull(),
  registrationId: uuid("registration_id").notNull(),
  userId: uuid("user_id").notNull().references(() => daily007UsersTable.id, { onDelete: "cascade" }),
  tournamentName: text("tournament_name").notNull(),
  submode: text("submode").notNull(),
  playerName: text("player_name").notNull(),
  playerUid: text("player_uid").notNull(),
  verifiedKills: integer("verified_kills").notNull(),
  evidenceReference: text("evidence_reference"),
  rewardPerKill: integer("reward_per_kill").notNull(),
  rewardCoins: integer("reward_coins").notNull(),
  status: text("status").notNull().default("pending"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  creditedAt: timestamp("credited_at", { withTimezone: true }),
  walletLedgerId: uuid("wallet_ledger_id"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("daily007_v2_kill_earn_reward_player_once").on(table.matchId, table.userId),
  unique("daily007_v2_kill_earn_reward_registration_once").on(table.matchId, table.registrationId),
  uniqueIndex("daily007_v2_kill_earn_reward_ledger_once").on(table.walletLedgerId)
    .where(sql`${table.walletLedgerId} IS NOT NULL`),
  check("daily007_v2_kill_earn_reward_submode_valid", sql`${table.submode} IN ('solo', 'duo', 'squad')`),
  check("daily007_v2_kill_earn_reward_kills_nonnegative", sql`${table.verifiedKills} BETWEEN 0 AND 2147483647`),
  check("daily007_v2_kill_earn_reward_evidence_reference_valid", sql`
    ${table.evidenceReference} IS NULL OR (
      length(${table.evidenceReference}) <= 2048
      AND ${table.evidenceReference} ~ '^https://[^[:space:]]+$'
    )
  `),
  check("daily007_v2_kill_earn_reward_rate_nonnegative", sql`${table.rewardPerKill} BETWEEN 0 AND 2147483647`),
  check("daily007_v2_kill_earn_reward_coins_nonnegative", sql`${table.rewardCoins} BETWEEN 0 AND 2147483647`),
  check("daily007_v2_kill_earn_reward_total_consistent", sql`
    ${table.rewardCoins}::numeric = ${table.verifiedKills}::numeric * ${table.rewardPerKill}::numeric
  `),
  check("daily007_v2_kill_earn_reward_status_valid", sql`${table.status} IN ('pending', 'approved', 'rejected', 'credited')`),
  check("daily007_v2_kill_earn_reward_review_consistent", sql`
    (${table.status} = 'pending' AND ${table.reviewedBy} IS NULL AND ${table.reviewedAt} IS NULL)
    OR
    (${table.status} <> 'pending' AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL)
  `),
  check("daily007_v2_kill_earn_reward_credit_consistent", sql`
    (${table.status} = 'credited' AND ${table.rewardCoins} > 0
      AND ${table.walletLedgerId} IS NOT NULL AND ${table.creditedAt} IS NOT NULL)
    OR
    (${table.status} <> 'credited' AND ${table.walletLedgerId} IS NULL AND ${table.creditedAt} IS NULL)
  `),
  check("daily007_v2_kill_earn_reward_rejection_reason", sql`
    (${table.status} = 'rejected' AND length(btrim(COALESCE(${table.rejectionReason}, ''))) > 0)
    OR (${table.status} <> 'rejected' AND ${table.rejectionReason} IS NULL)
  `),
  index("daily007_v2_kill_earn_reward_match_status_created_idx")
    .on(table.matchId, table.status, table.createdAt),
  index("daily007_v2_kill_earn_reward_player_created_idx")
    .on(table.userId, table.createdAt),
]);

export const insertDaily007KillEarnRewardSchema = createInsertSchema(daily007KillEarnRewardsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDaily007KillEarnReward = z.infer<typeof insertDaily007KillEarnRewardSchema>;
export type Daily007KillEarnReward = typeof daily007KillEarnRewardsTable.$inferSelect;
