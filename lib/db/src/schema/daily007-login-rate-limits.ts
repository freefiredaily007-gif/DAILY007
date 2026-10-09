import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const daily007LoginRateLimitsTable = pgTable("daily007_login_rate_limits", {
  clientIpHash: text("client_ip_hash").primaryKey(),
  attempts: integer("attempts").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  check("daily007_login_rate_limits_attempts_positive", sql`${table.attempts} >= 1`),
  index("daily007_login_rate_limits_expires_at_idx").on(table.expiresAt),
]);
