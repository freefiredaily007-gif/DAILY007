import { sql } from "drizzle-orm";
import {
  check,
  integer,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { daily007UsersTable } from "./daily007-v2";

export type Daily007LeaderboardCycleType = "weekly" | "monthly";
export type Daily007LeaderboardStatus =
  | "active"
  | "pending_approval"
  | "pending_activation"
  | "finalized";

export type Daily007LeaderboardStanding = {
  rank: number;
  userId: string;
  name: string;
  points: number;
  earnings: number;
  wins: number;
  kills: number;
  matches: number;
};

export type Daily007LeaderboardPayout = {
  rank: number;
  coins: number;
};

export const daily007LeaderboardPeriodsTable = pgTable(
  "daily007_v2_leaderboard_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cycleType: text("cycle_type").$type<Daily007LeaderboardCycleType>().notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: text("status").$type<Daily007LeaderboardStatus>().notNull(),
    previousPeriodId: uuid("previous_period_id"),
    approvedBy: uuid("approved_by").references(() => daily007UsersTable.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    finalStandings: jsonb("final_standings")
      .$type<Daily007LeaderboardStanding[]>()
      .notNull()
      .default([]),
    payoutConfiguration: jsonb("payout_configuration")
      .$type<Daily007LeaderboardPayout[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "daily007_v2_leaderboard_cycle_valid",
      sql`${table.cycleType} IN ('weekly', 'monthly')`,
    ),
    check(
      "daily007_v2_leaderboard_status_valid",
      sql`${table.status} IN ('active', 'pending_approval', 'pending_activation', 'finalized')`,
    ),
    check(
      "daily007_v2_leaderboard_window_valid",
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    uniqueIndex("daily007_v2_leaderboard_type_start_unique").on(
      table.cycleType,
      table.startsAt,
    ),
    uniqueIndex("daily007_v2_leaderboard_one_active_idx")
      .on(table.cycleType)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("daily007_v2_leaderboard_previous_unique")
      .on(table.previousPeriodId)
      .where(sql`${table.previousPeriodId} IS NOT NULL`),
    index("daily007_v2_leaderboard_status_idx").on(
      table.cycleType,
      table.status,
      table.startsAt,
    ),
  ],
);

export const daily007LeaderboardRewardSettingsTable = pgTable(
  "daily007_v2_leaderboard_reward_settings",
  {
    cycleType: text("cycle_type")
      .$type<Daily007LeaderboardCycleType>()
      .primaryKey(),
    firstPlaceCoins: integer("first_place_coins").notNull().default(0),
    secondPlaceCoins: integer("second_place_coins").notNull().default(0),
    thirdPlaceCoins: integer("third_place_coins").notNull().default(0),
    updatedBy: uuid("updated_by").references(() => daily007UsersTable.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "daily007_v2_leaderboard_rewards_cycle_valid",
      sql`${table.cycleType} IN ('weekly', 'monthly')`,
    ),
    check(
      "daily007_v2_leaderboard_rewards_coins_valid",
      sql`
        ${table.firstPlaceCoins} BETWEEN 0 AND 2147483647 AND
        ${table.secondPlaceCoins} BETWEEN 0 AND 2147483647 AND
        ${table.thirdPlaceCoins} BETWEEN 0 AND 2147483647
      `,
    ),
  ],
);