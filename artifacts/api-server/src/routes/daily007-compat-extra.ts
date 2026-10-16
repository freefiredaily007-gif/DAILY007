import { Router, type IRouter, type Request, type Response } from "express";
import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import {
  Daily007AdminCreateVideoBody,
  Daily007AdminCreateVideoResponse,
  Daily007AdminUpdateVideoBody,
  Daily007AdminUpdateVideoResponse,
  Daily007AdminListVideosResponse,
  Daily007AdminSetVideoActiveResponse,
  Daily007ListVideosResponse,
  Daily007AdminDeleteUserBody,
  Daily007AdminDeleteUserResponse,
} from "@workspace/api-zod";
import {
  assertDaily007RoleLocked,
  authenticate,
  requireAdmin,
  requireTournamentAdmin,
  withDaily007RoleTransaction,
  type Daily007RoleRequirement,
  type Daily007MutationClient,
} from "./daily007-v2";
import { isAssignableTournamentRole, wouldRemoveLastFullAdmin } from "../lib/daily007-roles";
import {
  isValidYoutubeChannelUrl,
  normalizePaymentReference,
  parseCoinPackages,
  pausedVideoRewardResponse,
} from "../lib/daily007-compat-extra-validation";
import {
  awardReferrerForApprovedRecharge,
  classifyReferralRechargeStatus,
  ensureDaily007ReferralCode,
} from "../lib/daily007-referrals";
import { createDaily007ReferralLinks } from "../lib/daily007-referral-links";
import { ensureLegacySquadTeams } from "../lib/daily007-squad-slots";
import {
  reviewYoutubeSubscribeClaim,
  submitYoutubeSubscribeClaim,
  youtubeClaimResponse,
} from "../lib/daily007-youtube-subscribe";
import {
  completeDaily007VideoWatch,
  isValidDaily007VideoStartAttemptId,
  startDaily007VideoWatch,
  youtubeVideoIdFromUrl,
} from "../lib/daily007-video-rewards";
import {
  createWalletImageReadUrl,
  createWalletImageUpload,
  deleteDaily007PaymentProofObject,
  isDaily007PaymentProofObjectPath,
  isWalletObjectPath,
  validateUploadedWalletImage,
} from "../lib/daily007-wallet-storage";
import {
  daily007UserDeletionCandidateError,
  deleteDaily007UserData,
} from "../lib/daily007-user-deletion";

const router: IRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const MAX_INT = 2_147_483_647;
function leaderboardRewardHistoryDescription(details: Record<string, unknown>): string | null {
  const cycleType = details.cycleType;
  const rank = Number(details.rank);
  if (
    (cycleType !== "weekly" && cycleType !== "monthly") ||
    !Number.isSafeInteger(rank) ||
    rank < 1
  ) {
    return null;
  }
  const cycle = cycleType === "weekly" ? "Weekly" : "Monthly";
  return `${cycle} Leaderboard Rank #${rank} Reward`;
}

const SETTINGS_DEFAULTS = {
  appName: "Daily007",
  whatsappLink: "https://chat.whatsapp.com/F86q8n8R6cT2e0oiYDldGc?s=cl&p=a&mlu=4&ilr=4",
  instagramLink: "https://www.instagram.com/freefiredaily007?stkn=MWYyeHJncGRpYzA1cQ==",
  youtubeLink: "https://youtube.com/@freefiredaily007?si=JDNGf0Tgc8hi0me0",
  upiId: "", paymentNote: "", supportContact: "", minPurchase: "1", maxPurchase: "5000",
  minWithdrawal: "100", maxWithdrawal: "5000", coinToMoneyRate: "1",
  coinPackages: "", rechargeEnabled: "false", withdrawalEnabled: "false", upiQrObjectPath: "",
  youtubeTaskEnabled: "true", youtubeTaskReward: "2",
  youtubeTaskUrl: "https://youtube.com/@freefiredaily007?si=xWEYS3ViPlDz7Em3",
};
type Client = { query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>; release(): void };
const userId = (req: Request) => req.daily007Account?.id;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function error(res: Response, status: number, message: string) { res.status(status).json({ error: message }); }
function validId(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
const PAYMENT_HISTORY_PAGE_SIZE = 200;
type PaymentHistoryCursor = { createdAt: string; id: string };
function encodePaymentHistoryCursor(cursor: PaymentHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
function decodePaymentHistoryCursor(value: unknown): PaymentHistoryCursor | null {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isObject(parsed) || typeof parsed.createdAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt)) || !validId(parsed.id)) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}
function text(value: unknown, min = 1, max = 200): string | null {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max ? value.trim() : null;
}
function integer(value: unknown, min = 0, max = MAX_INT): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
async function transaction<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect() as unknown as Client;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
async function roleTransaction<T>(
  req: Request,
  requiredRole: Daily007RoleRequirement,
  work: (client: Daily007MutationClient) => Promise<T>,
  lockMode: "shared" | "exclusive" = "shared",
): Promise<T> {
  const id = userId(req);
  if (!id) throw Object.assign(new Error("A valid Daily007 account is required."), { status: 401 });
  return withDaily007RoleTransaction(id, requiredRole, work, lockMode);
}
async function markDaily007VideoCatalogSeeded(client: Daily007MutationClient): Promise<void> {
  await client.query(
    `INSERT INTO daily007_v2_settings (id, settings)
     VALUES (1, '{"__daily007VideoCatalogSeeded": true}'::jsonb)
     ON CONFLICT (id) DO UPDATE
       SET settings = COALESCE(daily007_v2_settings.settings, '{}'::jsonb) || EXCLUDED.settings`,
  );
}
function respondFailure(res: Response, e: unknown) {
  const status = (e as { status?: number })?.status;
  if (status) error(res, status, (e as Error).message);
  else throw e;
}
function privateAccount(req: Request, res: Response): string | null {
  const id = userId(req);
  if (!id) { error(res, 401, "A valid Daily007 bearer token is required."); return null; }
  return id;
}

function isClerkUserAlreadyDeleted(cause: unknown): boolean {
  const error = cause as {
    status?: unknown;
    statusCode?: unknown;
    errors?: Array<{ code?: unknown }>;
  } | null;
  return error?.status === 404 || error?.statusCode === 404 ||
    (Array.isArray(error?.errors) && error.errors.some((entry) =>
      entry.code === "resource_not_found" || entry.code === "clerk_resource_not_found",
    ));
}

async function deleteClerkIdentity(clerkUserId: string): Promise<void> {
  try {
    await clerkClient.users.deleteUser(clerkUserId);
  } catch (cause) {
    if (!isClerkUserAlreadyDeleted(cause)) throw cause;
  }
}

async function settings(): Promise<Record<string, unknown>> {
  const result = await pool.query<{ settings: Record<string, unknown> }>(
    "SELECT settings FROM daily007_v2_settings WHERE id = 1",
  );
  const storedSettings = { ...(result.rows[0]?.settings ?? {}) };
  delete storedSettings.__daily007VideoCatalogSeeded;
  delete storedSettings.__daily007AutoCancelCursor;
  const current = { ...SETTINGS_DEFAULTS, ...storedSettings };
  for (const key of ["whatsappLink", "instagramLink", "youtubeLink"] as const) {
    if (typeof current[key] !== "string" || !current[key].trim()) {
      current[key] = SETTINGS_DEFAULTS[key];
    }
  }
  return current;
}

async function clientSettings(admin = false): Promise<Record<string, unknown>> {
  const current = await settings();
  const qrObjectPath = String(current.upiQrObjectPath ?? "");
  const { upiQrObjectPath: _privatePath, ...visible } = current;
  return {
    ...visible,
    rechargeEnabled: current.rechargeEnabled === "true",
    withdrawalEnabled: current.withdrawalEnabled === "true",
    youtubeTaskEnabled: current.youtubeTaskEnabled === "true",
    upiQrUrl: qrObjectPath ? await createWalletImageReadUrl(qrObjectPath, 60 * 60) : "",
    ...(admin ? { upiQrObjectPath: qrObjectPath } : {}),
  };
}

router.post("/wallet/uploads/request-url", authenticate, async (req, res): Promise<void> => {
  const id = privateAccount(req, res); if (!id) return;
  const body = req.body as unknown;
  if (!isObject(body) ||
      (body.purpose !== "payment-proof" && body.purpose !== "wallet-qr") ||
      typeof body.contentType !== "string" ||
      typeof body.size !== "number") {
    error(res, 400, "Expected an image purpose, MIME type, and file size."); return;
  }
  if (body.purpose === "wallet-qr" && !requireAdmin(req, res)) return;
  const purpose = body.purpose as "payment-proof" | "wallet-qr";
  const contentType = body.contentType as string;
  const size = body.size as number;
  try {
    const createUpload = () => createWalletImageUpload({
      userId: id,
      purpose,
      contentType,
      size,
    });
    const upload = body.purpose === "wallet-qr"
      ? await roleTransaction(req, "admin", createUpload)
      : await createUpload();
    res.json({ ...upload, expiresInSeconds: 900 });
  } catch (e) {
    if ((e as { status?: number }).status) { respondFailure(res, e); return; }
    const message = e instanceof Error ? e.message : "Could not create an upload URL.";
    error(res, 400, message);
  }
});

router.get("/wallet/transactions", authenticate, async (req, res): Promise<void> => {
  const id = privateAccount(req, res); if (!id) return;
  const result = await pool.query(
    `SELECT ledger.id, ledger.amount, ledger.balance_after AS "balanceAfter",
            ledger.reason, ledger.details, ledger.created_at AS "createdAt",
            ledger.match_id AS "matchId", ledger.registration_id AS "registrationId",
            tournament.title AS "tournamentTitle",
            award.rank AS "placementRank", award.kills AS "placementKills"
       FROM daily007_v2_wallet_ledger ledger
       LEFT JOIN daily007_v2_matches tournament
          ON (
            (ledger.reason = 'tournament_cancel_refund'
              AND tournament.id::text = COALESCE(
                ledger.match_id::text,
                substring(
                  COALESCE(ledger.details->>'description', '')
                  FROM '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'
                ),
                NULLIF(ledger.details->>'tournamentId', '')
              ))
            OR (ledger.reason = 'match_prize' AND tournament.id = ledger.match_id)
          )
       LEFT JOIN daily007_v2_result_awards award
         ON ledger.reason = 'match_prize'
        AND award.match_id = ledger.match_id
        AND award.registration_id = ledger.registration_id
        AND award.user_id = ledger.user_id
      WHERE ledger.user_id = $1
      ORDER BY ledger.created_at DESC
      LIMIT 500`, [id],
  );
  res.json(result.rows.map((row: any) => {
    const { matchId, registrationId, tournamentTitle, placementRank, placementKills, ...transactionRow } = row;
    const details = row.details && typeof row.details === "object" ? row.details as Record<string, unknown> : {};
    const existingDescription = typeof details.description === "string" && details.description.trim()
      ? details.description.trim()
      : null;
    const leaderboardDescription = leaderboardRewardHistoryDescription(details);
    const descriptionTournamentId = typeof details.description === "string"
      ? details.description.match(UUID_IN_TEXT)?.[0]
      : null;
    const structuredTournamentId = typeof details.tournamentId === "string" && details.tournamentId.trim()
      ? details.tournamentId.trim()
      : null;
    const tournamentId = typeof matchId === "string" && matchId.trim()
      ? matchId.trim()
      : descriptionTournamentId ??
        (structuredTournamentId && UUID.test(structuredTournamentId)
          ? structuredTournamentId
          : null);
    const resolvedTournamentTitle = typeof tournamentTitle === "string" && tournamentTitle.trim()
      ? tournamentTitle.trim()
      : typeof details.tournamentTitle === "string" && details.tournamentTitle.trim()
        ? details.tournamentTitle.trim()
        : null;
    const description = row.reason === "tournament_cancel_refund"
      ? resolvedTournamentTitle
        ? `Entry fee refunded — ${resolvedTournamentTitle} (tournament cancelled)`
        : tournamentId
          ? `Entry fee refunded — tournament ${tournamentId} (tournament cancelled)`
          : existingDescription ?? "Entry fee refunded (tournament cancelled)"
      : row.reason === "match_prize"
        ? (() => {
          const rank = Number(placementRank);
          const rankLabel = Number.isSafeInteger(rank) && rank > 0
            ? `${rank}${rank % 100 >= 11 && rank % 100 <= 13 ? "th" : rank % 10 === 1 ? "st" : rank % 10 === 2 ? "nd" : rank % 10 === 3 ? "rd" : "th"} place`
            : null;
          const kills = Number(placementKills);
          const killsLabel = placementKills !== null && placementKills !== undefined && Number.isSafeInteger(kills) && kills >= 0
            ? `${kills} ${kills === 1 ? "kill" : "kills"}`
            : null;
          const placement = [rankLabel, killsLabel].filter(Boolean).join(" · ");
          const tournamentLabel = resolvedTournamentTitle
            ? resolvedTournamentTitle
            : tournamentId
              ? `tournament ${tournamentId}`
              : null;
          const context = [tournamentLabel, placement].filter(Boolean).join(" · ");
          return context
            ? `Tournament prize — ${context}`
            : existingDescription ?? "Tournament prize";
        })()
        : leaderboardDescription ?? existingDescription ?? (row.reason === "video_watch_reward"
          ? "Video watch reward"
          : String(row.reason).replaceAll("_", " "));
    return {
      ...transactionRow,
      ...(row.reason === "match_prize" ? {
        ...(typeof registrationId === "string" ? { registrationId } : {}),
        ...(resolvedTournamentTitle ? { tournamentTitle: resolvedTournamentTitle } : {}),
        ...(placementRank !== null && placementRank !== undefined ? { placementRank } : {}),
        ...(placementKills !== null && placementKills !== undefined ? { placementKills } : {}),
      } : {}),
      description,
    };
  }));
});

router.post("/payments", authenticate, async (req, res): Promise<void> => {
  const id = privateAccount(req, res); if (!id) return;
  const body = req.body as unknown;
  if (!isObject(body)) { error(res, 400, "Expected coins and a payment transaction reference."); return; }
  const coins = body.coins;
  const reference = text(body.txnId ?? body.reference, 1, 200);
  const payerUpiId = text(body.payerUpiId, 1, 200);
  if (!integer(coins, 1) || !reference) {
    error(res, 400, "coins must be a positive whole number and txnId/reference must contain 1–200 characters.");
    return;
  }
  if (!payerUpiId) {
    error(res, 400, "payerUpiId must contain 1–200 characters.");
    return;
  }
  const config = await settings();
  const minimum = Number(config.minPurchase);
  const maximum = Number(config.maxPurchase);
  if (config.rechargeEnabled !== "true" || !text(config.upiId, 1, 200) || !text(config.upiQrObjectPath, 1, 500)) {
    error(res, 409, "Payment requests are unavailable until an administrator enables recharge and configures the UPI ID and QR."); return;
  }
  if (!Number.isSafeInteger(minimum) || minimum < 1 ||
      !Number.isSafeInteger(maximum) || maximum < minimum || coins < minimum || coins > maximum) {
    error(res, 400, `Payment request must be between ${minimum} and ${maximum} coins.`);
    return;
  }
  const rate = Number(config.coinToMoneyRate);
  const amount = Math.round(coins * rate);
  if (!Number.isFinite(rate) || rate <= 0 || !integer(amount, 1)) {
    error(res, 400, "The configured coin conversion rate produces an unsupported payment amount.");
    return;
  }
  const rawProof = body.proofObjectPath;
  let proofObjectPath: string | null = null;
  if (rawProof !== undefined && rawProof !== null && rawProof !== "") {
    proofObjectPath = text(rawProof, 1, 500);
    if (!proofObjectPath || !proofObjectPath.startsWith(`/objects/uploads/daily007/payment-proofs/${id}/`)) {
      error(res, 400, "The payment screenshot must be uploaded to your account before submitting the request."); return;
    }
    try {
      await validateUploadedWalletImage(proofObjectPath, id);
    } catch (e) {
      error(res, 400, e instanceof Error ? e.message : "The payment screenshot could not be verified."); return;
    }
  }
  const normalized = normalizePaymentReference(reference);
  try {
    const result = await pool.query(
      `INSERT INTO daily007_v2_payments
         (user_id, coins, amount, payer_upi_id, reference, reference_normalized, proof_object_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, coins, amount, payer_upi_id AS "payerUpiId", reference AS "txnId", status,
                 created_at AS "createdAt"`,
      [id, coins, amount, payerUpiId, reference, normalized, proofObjectPath],
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      const constraint = (e as { constraint?: string }).constraint;
      error(res, 409, constraint === "daily007_one_pending_payment_per_user"
        ? "You already have a pending coin recharge request."
        : "This payment reference has already been submitted.");
      return;
    }
    throw e;
  }
});

router.get("/my/payments", authenticate, async (req, res): Promise<void> => {
  const id = privateAccount(req, res); if (!id) return;
  const paginated = req.query.paginated === "true" || req.query.cursor !== undefined;
  if (req.query.paginated !== undefined && req.query.paginated !== "true") {
    error(res, 400, "Payment history pagination must be true when requested."); return;
  }
  const cursorValue = req.query.cursor;
  if (cursorValue !== undefined && typeof cursorValue !== "string") {
    error(res, 400, "Payment history cursor is invalid."); return;
  }
  const cursor = cursorValue === undefined ? null : decodePaymentHistoryCursor(cursorValue);
  if (cursorValue !== undefined && !cursor) {
    error(res, 400, "Payment history cursor is invalid."); return;
  }
  if (!paginated) {
    const result = await pool.query(
      `SELECT id, coins, amount, reference AS "txnId", status,
              review_reason AS "reviewReason", created_at AS "createdAt",
              reviewed_at AS "reviewedAt"
         FROM daily007_v2_payments WHERE user_id = $1
         ORDER BY created_at DESC, id DESC LIMIT 200`, [id],
    );
    res.json(result.rows);
    return;
  }
  const result = cursor
    ? await pool.query(
      `SELECT id, coins, amount, reference AS "txnId", status,
              review_reason AS "reviewReason", created_at AS "createdAt",
              reviewed_at AS "reviewedAt", created_at::text AS "cursorCreatedAt"
         FROM daily007_v2_payments
        WHERE user_id = $1 AND (created_at, id) < ($2::timestamptz, $3::uuid)
        ORDER BY created_at DESC, id DESC LIMIT $4`,
      [id, cursor.createdAt, cursor.id, PAYMENT_HISTORY_PAGE_SIZE + 1],
    )
    : await pool.query(
      `SELECT id, coins, amount, reference AS "txnId", status,
              review_reason AS "reviewReason", created_at AS "createdAt",
              reviewed_at AS "reviewedAt", created_at::text AS "cursorCreatedAt"
         FROM daily007_v2_payments WHERE user_id = $1
         ORDER BY created_at DESC, id DESC LIMIT $2`,
      [id, PAYMENT_HISTORY_PAGE_SIZE + 1],
    );
  const hasMore = result.rows.length > PAYMENT_HISTORY_PAGE_SIZE;
  const pageRows = result.rows.slice(0, PAYMENT_HISTORY_PAGE_SIZE);
  const lastRow = pageRows[pageRows.length - 1] as
    | { id: string; cursorCreatedAt: string }
    | undefined;
  res.json({
    items: pageRows.map(({ cursorCreatedAt: _cursorCreatedAt, ...payment }) => payment),
    nextCursor: hasMore && lastRow
      ? encodePaymentHistoryCursor({ createdAt: lastRow.cursorCreatedAt, id: lastRow.id })
      : null,
  });
});

router.post("/withdrawals", authenticate, async (req, res): Promise<void> => {
  const id = privateAccount(req, res); if (!id) return;
  const body = req.body as unknown;
  const coins = isObject(body) ? body.coins : undefined;
  const method = isObject(body) ? text(body.method, 1, 40) : null;
  const account = isObject(body) ? text(body.account, 1, 200) : null;
  const config = await settings();
  const configuredMinimum = Number(config.minWithdrawal);
  const minimum = Number.isSafeInteger(configuredMinimum)
    ? Math.max(100, configuredMinimum)
    : 100;
  const maximum = Math.max(minimum, Number(config.maxWithdrawal));
  if (config.withdrawalEnabled !== "true") {
    error(res, 409, "Withdrawals are currently disabled by the administrator."); return;
  }
  if (!Number.isSafeInteger(minimum) || minimum < 100 ||
      !Number.isSafeInteger(maximum) || maximum < minimum || maximum > MAX_INT) {
    error(res, 503, "Withdrawal limits are not configured correctly.");
    return;
  }
  if (!integer(coins, minimum, maximum) || !method || !account) {
    error(res, 400, `coins must be an integer between ${minimum} and ${maximum}, with a method and payout account.`);
    return;
  }
  try {
    const withdrawal = await transaction(async (client) => {
      const user = await client.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE", [id],
      );
      const balance = user.rows[0]?.wallet_coins;
      if (balance === undefined) throw Object.assign(new Error("Account not found."), { status: 404 });
      const pending = await client.query(
        "SELECT 1 FROM daily007_v2_withdrawals WHERE user_id = $1 AND status = 'pending' LIMIT 1",
        [id],
      );
      if (pending.rows[0]) {
        throw Object.assign(new Error("You already have a pending withdrawal request."), { status: 409 });
      }
      if (balance < coins) throw Object.assign(new Error("Insufficient wallet balance."), { status: 409 });
      const nextBalance = balance - coins;
      const saved = await client.query<Record<string, unknown>>(
        `INSERT INTO daily007_v2_withdrawals (user_id, coins, method, account)
         VALUES ($1, $2, $3, $4)
         RETURNING id, coins, method, account, status, payout_status AS "payoutStatus", created_at AS "createdAt"`,
        [id, coins, method, account],
      );
      await client.query("UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1", [id, nextBalance]);
      await client.query(
        `INSERT INTO daily007_v2_wallet_ledger (user_id, amount, balance_after, reason)
         VALUES ($1, $2, $3, 'withdrawal_reserved')`, [id, -coins, nextBalance],
      );
      return { ...saved.rows[0], walletCoins: nextBalance };
    });
    res.status(201).json(withdrawal);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      error(res, 409, "You already have a pending withdrawal request.");
      return;
    }
    respondFailure(res, e);
  }
});

router.get("/my/withdrawals", authenticate, async (req, res): Promise<void> => {
  const id = privateAccount(req, res); if (!id) return;
  const result = await pool.query(
    `SELECT id, coins, method, account, status, payout_status AS "payoutStatus",
            review_reason AS "reviewReason", created_at AS "createdAt",
            reviewed_at AS "reviewedAt"
       FROM daily007_v2_withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`, [id],
  );
  res.json(result.rows);
});

router.get("/admin/payments", authenticate, async (req, res): Promise<void> => {
  try {
    const rows = await roleTransaction(req, "admin", async (client) => {
      const result = await client.query(
        `SELECT p.id, p.user_id AS "userId", u.name AS "userName", u.email,
                p.coins, p.amount, p.reference AS "reference", p.reference AS "txnId", p.status,
                p.payer_upi_id AS "payerUpiId",
                p.proof_object_path IS NOT NULL AS "proofAvailable",
                p.review_reason AS "reviewReason",
                p.created_at AS "createdAt", p.reviewed_at AS "reviewedAt"
           FROM daily007_v2_payments p JOIN daily007_v2_users u ON u.id = p.user_id
          WHERE p.status <> 'deleted'
          ORDER BY p.created_at DESC LIMIT 500`,
      );
      return result.rows;
    });
    res.json(rows);
  } catch (e) { respondFailure(res, e); }
});

router.get("/admin/payments/:id/proof-url", authenticate, async (req, res): Promise<void> => {
  if (!validId(req.params.id)) { error(res, 400, "Payment request id must be a UUID."); return; }
  try {
    const result = await roleTransaction(req, "admin", async (client) => {
      const payment = await client.query<{ proof_object_path: string | null }>(
        "SELECT proof_object_path FROM daily007_v2_payments WHERE id = $1 AND status <> 'deleted'",
        [req.params.id],
      );
      const objectPath = payment.rows[0]?.proof_object_path;
      if (!objectPath || !isWalletObjectPath(objectPath)) return null;
      try {
        return await createWalletImageReadUrl(objectPath);
      } catch {
        return null;
      }
    });
    if (!result) { error(res, 404, "Payment proof is unavailable."); return; }
    res.json({ url: result });
  } catch (e) { respondFailure(res, e); }
});

router.get("/admin/withdrawals", authenticate, async (req, res): Promise<void> => {
  try {
    const rows = await roleTransaction(req, "admin", async (client) => {
      const result = await client.query(
        `SELECT w.id, w.user_id AS "userId", u.name AS "userName", u.email,
                w.coins, w.method, w.account, w.status, w.payout_status AS "payoutStatus",
                w.review_reason AS "reviewReason",
                w.created_at AS "createdAt", w.reviewed_at AS "reviewedAt"
           FROM daily007_v2_withdrawals w JOIN daily007_v2_users u ON u.id = w.user_id
          WHERE w.status <> 'deleted'
          ORDER BY w.created_at DESC LIMIT 500`,
      );
      return result.rows;
    });
    res.json(rows);
  } catch (e) { respondFailure(res, e); }
});

router.post("/admin/withdrawals/:id/payout", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!validId(req.params.id)) { error(res, 400, "Withdrawal id must be a UUID."); return; }
  const adminId = privateAccount(req, res); if (!adminId) return;
  try {
    const result = await roleTransaction(req, "admin", async (client) => {
      const locked = await client.query<any>(
        "SELECT * FROM daily007_v2_withdrawals WHERE id = $1 FOR UPDATE", [req.params.id],
      );
      const request = locked.rows[0];
      if (!request) throw Object.assign(new Error("Withdrawal not found."), { status: 404 });
      if (request.status !== "approved") {
        throw Object.assign(new Error("Approve the withdrawal before recording its manual payout."), { status: 409 });
      }
      if (request.payout_status === "paid") return { id: request.id, payoutStatus: "paid", alreadyRecorded: true };
      if (request.payout_status !== "manual_payout_required") {
        throw Object.assign(new Error("This withdrawal is not awaiting a manual payout."), { status: 409 });
      }
      await client.query(
        "UPDATE daily007_v2_withdrawals SET payout_status = 'paid' WHERE id = $1", [req.params.id],
      );
      await client.query(
        `INSERT INTO daily007_v2_notifications (user_id, title, body, type)
         VALUES ($1, 'Withdrawal paid', 'Your withdrawal has been paid manually by the administrator.', 'payment')`,
        [request.user_id],
      );
      return { id: request.id, payoutStatus: "paid" };
    });
    res.json(result);
  } catch (e) { respondFailure(res, e); }
});

for (const kind of ["payments", "withdrawals"] as const) {
  const table = kind === "payments" ? "daily007_v2_payments" : "daily007_v2_withdrawals";
  router.post(`/admin/${kind}/:id/:action`, authenticate, async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const id = req.params.id;
    const action = req.params.action;
    const adminId = privateAccount(req, res);
    if (!adminId) return;
    if (!validId(id) || (action !== "approve" && action !== "reject")) {
      error(res, 400, "A valid request UUID and approve/reject action are required."); return;
    }
    const body = req.body as unknown;
    const reviewReason = isObject(body) ? text(body.reason, 1, 500) : null;
    if (action === "reject" && !reviewReason) {
      error(res, 400, "Provide a rejection reason of 1–500 characters."); return;
    }
    try {
      const result = await roleTransaction(req, "admin", async (client) => {
        const locked = await client.query<any>(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
        const request = locked.rows[0];
        if (!request) throw Object.assign(new Error("Request not found."), { status: 404 });
        if (request.status !== "pending") {
          if ((action === "approve" && request.status === "approved") ||
              (action === "reject" && request.status === "rejected")) return { ...request, alreadyReviewed: true };
          throw Object.assign(new Error("This request has already been reviewed with a different outcome."), { status: 409 });
        }
        if (kind === "payments" && action === "approve") {
          const account = await client.query<{ wallet_coins: number }>(
            "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE", [request.user_id],
          );
          const balance = account.rows[0]?.wallet_coins;
          if (balance === undefined) throw Object.assign(new Error("Account not found."), { status: 404 });
          const next = balance + request.coins;
          if (!Number.isSafeInteger(next) || next > MAX_INT) throw Object.assign(new Error("Wallet balance would exceed the supported range."), { status: 409 });
          await client.query("UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1", [request.user_id, next]);
          await client.query(
            `INSERT INTO daily007_v2_wallet_ledger (user_id, amount, balance_after, reason)
             VALUES ($1, $2, $3, 'payment_approved')`, [request.user_id, request.coins, next],
          );
          await awardReferrerForApprovedRecharge(
            client,
            request.user_id,
            request.id,
            request.coins,
          );
        }
        if (kind === "withdrawals" && action === "reject") {
          const account = await client.query<{ wallet_coins: number }>(
            "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE", [request.user_id],
          );
          const balance = account.rows[0]?.wallet_coins;
          if (balance === undefined) throw Object.assign(new Error("Account not found."), { status: 404 });
          const next = balance + request.coins;
          if (next > MAX_INT) throw Object.assign(new Error("Refund would exceed the supported wallet range."), { status: 409 });
          await client.query("UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1", [request.user_id, next]);
          await client.query(
            `INSERT INTO daily007_v2_wallet_ledger (user_id, amount, balance_after, reason)
             VALUES ($1, $2, $3, 'withdrawal_rejected_refund')`, [request.user_id, request.coins, next],
          );
        }
        const payoutStatus = kind === "withdrawals" && action === "approve" ? "manual_payout_required" : request.payout_status;
        const saved = await client.query(
          `UPDATE ${table} SET status = $2, reviewed_by = $3, reviewed_at = now(),
                               review_reason = $4
               ${kind === "withdrawals" ? ", payout_status = $5" : ""}
            WHERE id = $1 RETURNING *`,
          kind === "withdrawals"
            ? [id, action === "approve" ? "approved" : "rejected", adminId, reviewReason, payoutStatus]
            : [id, action === "approve" ? "approved" : "rejected", adminId, reviewReason],
        );
        const title = kind === "payments"
          ? (action === "approve" ? "Coin deposit approved" : "Coin deposit rejected")
          : (action === "approve" ? "Withdrawal approved" : "Withdrawal rejected");
        const message = kind === "payments"
          ? (action === "approve"
            ? `Your coin deposit has been approved. ${request.coins} coins have been added to your wallet.`
            : `Your coin deposit request was rejected. Reason: ${reviewReason}`)
          : (action === "approve"
            ? "Your withdrawal request was approved. The payout is manual and will be recorded when sent."
            : `Your ${request.coins}-coin withdrawal was rejected and the coins were refunded. Reason: ${reviewReason}`);
        await client.query(
          `INSERT INTO daily007_v2_notifications (user_id, title, body, type)
           VALUES ($1, $2, $3, 'payment')`,
          [request.user_id, title, message],
        );
        return saved.rows[0];
      });
      res.json(result);
    } catch (e) { respondFailure(res, e); }
  });

  router.delete(`/admin/${kind}/:id`, authenticate, async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!validId(req.params.id)) { error(res, 400, "Request id must be a UUID."); return; }
    try {
      const result = await roleTransaction(req, "admin", async (client) => {
        const locked = await client.query<any>(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [req.params.id]);
        const request = locked.rows[0];
        if (!request || request.status === "deleted") return false;
        if (request.status === "approved") throw Object.assign(new Error("Approved financial records cannot be deleted."), { status: 409 });
        if (kind === "withdrawals" && request.status === "pending") {
          const account = await client.query<{ wallet_coins: number }>(
            "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE", [request.user_id],
          );
          const next = (account.rows[0]?.wallet_coins ?? 0) + request.coins;
          if (next > MAX_INT) throw Object.assign(new Error("Refund would exceed the supported wallet range."), { status: 409 });
          await client.query("UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1", [request.user_id, next]);
          await client.query(
            `INSERT INTO daily007_v2_wallet_ledger (user_id, amount, balance_after, reason)
             VALUES ($1, $2, $3, 'withdrawal_deleted_refund')`, [request.user_id, request.coins, next],
          );
        }
        await client.query(`UPDATE ${table} SET status = 'deleted' WHERE id = $1`, [req.params.id]);
        return true;
      });
      if (!result) { error(res, 404, "Request not found."); return; }
      res.json({ id: req.params.id, deleted: true });
    } catch (e) { respondFailure(res, e); }
  });
}

router.get("/admin/users", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const result = await pool.query(
    `SELECT id, id AS "$id", name, email, phone, game_uid AS "gameUid", role,
            status, wallet_coins AS coins, created_at AS "createdAt"
       FROM daily007_v2_users ORDER BY created_at DESC LIMIT 1000`,
  );
  res.json(result.rows);
});

router.post("/admin/users/:id/delete", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const actorId = userId(req);
  if (!actorId) { error(res, 401, "A valid Daily007 account is required."); return; }
  if (!validId(req.params.id)) { error(res, 400, "User id must be a UUID."); return; }
  const parsedBody = Daily007AdminDeleteUserBody.safeParse(req.body);
  if (!parsedBody.success) {
    error(res, 400, "Type the exact account email to confirm permanent deletion.");
    return;
  }

  const targetId = req.params.id;
  const confirmationEmail = parsedBody.data.confirmationEmail;
  try {
    const staged = await roleTransaction(req, "admin", async (client) => {
      const selected = await client.query<{
        id: string;
        email: string;
        role: string;
        status: string;
        clerk_user_id: string | null;
      }>(
        `SELECT id, email, role, status, clerk_user_id
           FROM daily007_v2_users
          WHERE id = $1
          FOR UPDATE`,
        [targetId],
      );
      const target = selected.rows[0];
      if (!target) throw Object.assign(new Error("User not found."), { status: 404 });

      const candidateError = daily007UserDeletionCandidateError({
        actorId,
        targetId: target.id,
        targetEmail: target.email,
        targetRole: target.role,
        confirmationEmail,
      });
      if (candidateError) {
        throw Object.assign(new Error(candidateError.message), { status: candidateError.status });
      }

      const reviewReferences = await client.query<{ count: string }>(
        `SELECT
           (SELECT count(*) FROM daily007_v2_admin_access_requests WHERE reviewed_by = $1) +
           (SELECT count(*) FROM daily007_v2_google_recovery_requests WHERE reviewed_by = $1) +
           (SELECT count(*) FROM daily007_v2_payments WHERE reviewed_by = $1) +
           (SELECT count(*) FROM daily007_v2_withdrawals WHERE reviewed_by = $1) +
           (SELECT count(*) FROM daily007_v2_youtube_subscribe_claims WHERE reviewed_by = $1)
           AS count`,
        [targetId],
      );
      if (Number(reviewReferences.rows[0]?.count ?? 0) > 0) {
        throw Object.assign(
          new Error("Reassign this account's administrator review history before deleting it."),
          { status: 409 },
        );
      }

      const proofRows = await client.query<{ proof_object_path: string }>(
        `SELECT DISTINCT proof_object_path
           FROM daily007_v2_payments
          WHERE user_id = $1 AND proof_object_path IS NOT NULL`,
        [targetId],
      );
      const proofPaths = proofRows.rows.map((row) => row.proof_object_path);
      if (proofPaths.some((path) => !isDaily007PaymentProofObjectPath(path, targetId))) {
        throw Object.assign(
          new Error("A stored payment proof has an unexpected path. Resolve it before deleting this account."),
          { status: 409 },
        );
      }

      await client.query(
        `UPDATE daily007_v2_users
            SET status = 'blocked',
                auth_version = CASE
                  WHEN status = 'blocked' THEN auth_version
                  ELSE COALESCE(auth_version, 0) + 1
                END
          WHERE id = $1`,
        [targetId],
      );
      return {
        email: target.email,
        clerkUserId: target.clerk_user_id,
        proofPaths,
      };
    });

    const externalCleanup = [
      ...staged.proofPaths.map((path) => deleteDaily007PaymentProofObject(path, targetId)),
      ...(staged.clerkUserId ? [deleteClerkIdentity(staged.clerkUserId)] : []),
    ];
    const cleanupResults = await Promise.allSettled(externalCleanup);
    const cleanupFailures = cleanupResults.filter((result) => result.status === "rejected");
    if (cleanupFailures.length > 0) {
      console.error("Daily007 account external cleanup failed.", {
        targetId,
        failureCount: cleanupFailures.length,
      });
      error(
        res,
        502,
        "The account is blocked, but sign-in or payment-proof cleanup failed. Database records remain; retry the deletion.",
      );
      return;
    }

    const removed = await roleTransaction(req, "admin", async (client) => {
      const locked = await client.query<{
        id: string;
        email: string;
        role: string;
        status: string;
        clerk_user_id: string | null;
      }>(
        `SELECT id, email, role, status, clerk_user_id
           FROM daily007_v2_users
          WHERE id = $1
          FOR UPDATE`,
        [targetId],
      );
      const target = locked.rows[0];
      if (!target) throw Object.assign(new Error("User not found; no database data was removed."), { status: 404 });

      const candidateError = daily007UserDeletionCandidateError({
        actorId,
        targetId: target.id,
        targetEmail: target.email,
        targetRole: target.role,
        confirmationEmail,
      });
      if (candidateError) {
        throw Object.assign(new Error(candidateError.message), { status: candidateError.status });
      }
      if (target.status !== "blocked" || target.email.toLowerCase() !== staged.email.toLowerCase() ||
          target.clerk_user_id !== staged.clerkUserId) {
        throw Object.assign(
          new Error("The account changed during deletion. It remains blocked; review it and retry."),
          { status: 409 },
        );
      }

      return deleteDaily007UserData(
        client,
        targetId,
        target.clerk_user_id,
        staged.proofPaths.length,
      );
    });
    const response = Daily007AdminDeleteUserResponse.parse({
      deleted: true,
      clerkIdentityDeleted: staged.clerkUserId !== null,
      removed,
    });
    res.json(response);
  } catch (cause) {
    const status = (cause as { status?: number })?.status;
    if (status) {
      respondFailure(res, cause);
      return;
    }
    console.error("Daily007 account deletion did not complete.", { targetId });
    error(res, 500, "The account remains blocked; database cleanup did not finish. Retry the deletion.");
  }
});

router.patch("/admin/users/:id/role", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const actorId = userId(req);
  if (!actorId) { error(res, 401, "A valid Daily007 account is required."); return; }
  const id = req.params.id;
  const body = req.body as unknown;
  if (!validId(id) || !isObject(body) || !isAssignableTournamentRole(body.role)) {
    error(res, 400, "A valid user UUID and role of user or tournament_admin are required.");
    return;
  }
  if (id === userId(req)) {
    error(res, 409, "You cannot change your own administrator access.");
    return;
  }
  try {
    const result = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(740073)");
      await assertDaily007RoleLocked(client, actorId, "admin");
      const selected = await client.query<{ role: string }>(
        "SELECT role FROM daily007_v2_users WHERE id = $1 FOR UPDATE", [id],
      );
      const currentRole = selected.rows[0]?.role;
      if (!currentRole) return null;
      if (currentRole === "admin") {
        const admins = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM daily007_v2_users WHERE role = 'admin'",
        );
        if (wouldRemoveLastFullAdmin(currentRole, Number(admins.rows[0]?.count ?? 0))) {
          throw Object.assign(new Error("At least one full administrator must remain."), { status: 409 });
        }
      }
      const updated = await client.query<{ id: string; role: string }>(
        "UPDATE daily007_v2_users SET role = $2 WHERE id = $1 RETURNING id, role",
        [id, body.role],
      );
      return updated.rows[0] ?? null;
    });
    if (!result) { error(res, 404, "User not found."); return; }
    res.json(result);
  } catch (e) { respondFailure(res, e); }
});

router.patch("/admin/users/:id", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = req.params.id;
  const body = req.body as unknown;
  if (!validId(id) || !isObject(body)) { error(res, 400, "A valid user UUID and JSON object are required."); return; }
  const setStatus = Object.hasOwn(body, "status");
  const setCoins = Object.hasOwn(body, "coinsDelta");
  const hasRequestId = Object.hasOwn(body, "requestId");
  if ((!setStatus && !setCoins) ||
      (setStatus && body.status !== "active" && body.status !== "blocked") ||
      (setCoins && (!integer(body.coinsDelta, -MAX_INT, MAX_INT) || body.coinsDelta === 0)) ||
      (hasRequestId && (!setCoins || setStatus || !validId(body.requestId)))) {
    error(res, 400, "Provide status active/blocked and/or a nonzero signed integer coinsDelta within 32-bit range; coin adjustment requestId must be a UUID."); return;
  }
  const reason = setCoins ? text(body.note ?? body.reason, 1, 100) : null;
  if (setCoins && !reason) { error(res, 400, "A 1–100 character reason is required for coin adjustments."); return; }
  const actorId = userId(req);
  const idempotencyKey = hasRequestId
    ? `daily007-admin-adjustment:${actorId}:${body.requestId as string}`
    : null;
  try {
    const user = await roleTransaction(req, "admin", async (client) => {
      if (idempotencyKey) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [idempotencyKey],
        );
        const existing = await client.query<{ user_id: string; amount: number; reason: string }>(
          `SELECT user_id, amount, reason
             FROM daily007_v2_wallet_ledger
            WHERE idempotency_key = $1`,
          [idempotencyKey],
        );
        const previous = existing.rows[0];
        if (previous) {
          if (previous.user_id !== id || previous.amount !== body.coinsDelta ||
              previous.reason !== `admin_adjustment:${reason}`) {
            throw Object.assign(new Error("This adjustment request ID was already used for a different request."), { status: 409 });
          }
          const current = await client.query(
            `SELECT id, name, email, status, wallet_coins AS "coins"
               FROM daily007_v2_users
              WHERE id = $1`,
            [id],
          );
          return current.rows[0] ?? null;
        }
      }
      const locked = await client.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE", [id],
      );
      const balance = locked.rows[0]?.wallet_coins;
      if (balance === undefined) return null;
      const next = setCoins ? balance + (body.coinsDelta as number) : balance;
      if (!Number.isSafeInteger(next) || next < 0 || next > MAX_INT) {
        throw Object.assign(new Error("Adjustment would make the wallet negative or exceed its supported range."), { status: 409 });
      }
      const update = await client.query(
        `UPDATE daily007_v2_users SET status = COALESCE($2, status), wallet_coins = $3
          WHERE id = $1 RETURNING id, name, email, status, wallet_coins AS "coins"`,
        [id, setStatus ? body.status : null, next],
      );
      if (setCoins) await client.query(
        `INSERT INTO daily007_v2_wallet_ledger (user_id, amount, balance_after, reason, idempotency_key)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, body.coinsDelta, next, `admin_adjustment:${reason}`, idempotencyKey],
      );
      return update.rows[0];
    }, setStatus ? "exclusive" : "shared");
    if (!user) { error(res, 404, "User not found."); return; }
    res.json(user);
  } catch (e) { respondFailure(res, e); }
});

router.get("/admin/transactions", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const result = await pool.query(
    `SELECT l.id, l.user_id AS "userId", u.name AS "userName", u.email, l.amount,
            l.balance_after AS "balanceAfter", l.reason, l.created_at AS "createdAt"
       FROM daily007_v2_wallet_ledger l JOIN daily007_v2_users u ON u.id = l.user_id
      ORDER BY l.created_at DESC LIMIT 1000`,
  );
  res.json(result.rows);
});

router.get("/admin/stats", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM daily007_v2_users) AS "totalUsers",
        (SELECT count(*)::int FROM daily007_v2_matches m
          WHERE (m.enabled = true AND m.starts_at > clock_timestamp() + interval '5 hours 30 minutes')
             OR (m.starts_at <= clock_timestamp() + interval '5 hours 30 minutes'
                 AND NOT (m.enabled = false AND EXISTS (
                   SELECT 1 FROM daily007_v2_result_awards a
                    WHERE a.match_id = m.id AND a.rank = 1
                 )))) AS "activeTournaments",
       (SELECT count(*)::int FROM daily007_v2_registrations WHERE status = 'pending') AS "pendingRegistrations",
       (SELECT count(*)::int FROM daily007_v2_registrations WHERE status = 'approved') AS "approvedRegistrations",
       (SELECT count(*)::int FROM daily007_v2_registrations WHERE status = 'rejected') AS "rejectedRegistrations",
       (SELECT count(*)::int FROM daily007_v2_payments WHERE status = 'pending') AS "pendingPayments",
        (SELECT count(*)::int
           FROM daily007_v2_matches m
          WHERE m.enabled = false
            AND EXISTS (
              SELECT 1 FROM daily007_v2_result_awards a
               WHERE a.match_id = m.id AND a.rank = 1
            )) AS "completedTournaments",
       (SELECT COALESCE(sum(amount) FILTER (WHERE amount > 0), 0)::int FROM daily007_v2_wallet_ledger) AS "coinsDistributed",
       (SELECT COALESCE(sum(wallet_coins), 0)::int FROM daily007_v2_users) AS "coinsInWallets",
       (SELECT COALESCE(sum(prize_coins), 0)::int FROM daily007_v2_result_awards) AS "prizeDistributed",
       (SELECT count(*)::int FROM daily007_v2_registrations
         WHERE created_at >= date_trunc('day', now())) AS "todayRegistrations",
       (SELECT COALESCE(sum(amount), 0)::int FROM daily007_v2_payments
         WHERE status = 'approved' AND created_at >= date_trunc('day', now())) AS "todayRevenue"`,
  );
  const activity = await pool.query(
    `SELECT text, icon, time FROM (
       SELECT '🪙'::text AS icon,
              u.name || ' · ' || replace(l.reason, '_', ' ') AS text,
              l.created_at AS time
         FROM daily007_v2_wallet_ledger l
         JOIN daily007_v2_users u ON u.id = l.user_id
       UNION ALL
       SELECT '💳'::text AS icon,
              u.name || ' · payment ' || p.status AS text,
              p.created_at AS time
         FROM daily007_v2_payments p
         JOIN daily007_v2_users u ON u.id = p.user_id
       UNION ALL
       SELECT '📝'::text AS icon,
              r.captain_name || ' · registration ' || r.status AS text,
              r.created_at AS time
         FROM daily007_v2_registrations r
     ) recent ORDER BY time DESC LIMIT 8`,
  );
  res.json({ stats: result.rows[0], activity: activity.rows });
});

router.get("/me/stats", authenticate, async (req, res): Promise<void> => {
  const id = privateAccount(req, res); if (!id) return;
  const result = await pool.query(
    `SELECT
       (SELECT count(DISTINCT r.match_id)::int FROM daily007_v2_registrations r
         WHERE r.captain_user_id = $1 AND r.status = 'approved') AS matches,
       (SELECT count(*)::int FROM daily007_v2_result_awards a
         WHERE a.user_id = $1 AND a.rank = 1) AS wins,
       (SELECT COALESCE(sum(a.kills), 0)::int FROM daily007_v2_result_awards a
         WHERE a.user_id = $1) AS kills,
       (SELECT COALESCE(sum(a.prize_coins), 0)::int FROM daily007_v2_result_awards a
         WHERE a.user_id = $1) AS "prizeCoins"`,
    [id],
  );
  res.json(result.rows[0]);
});

router.get("/settings", async (_req, res): Promise<void> => { res.json(await clientSettings()); });
router.get("/admin/settings", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  res.json(await clientSettings(true));
});
router.put("/admin/settings", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const body = req.body as unknown;
  if (!isObject(body) || Object.keys(body).some((key) => !Object.hasOwn(SETTINGS_DEFAULTS, key))) {
    error(res, 400, "Settings must be an object containing only supported settings fields."); return;
  }
  const next: Record<string, string> = {};
  const current = await settings();
  for (const [key, fallback] of Object.entries(SETTINGS_DEFAULTS)) {
    const value = body[key] === undefined ? (current[key] ?? fallback) : body[key];
    const maxLength = key === "paymentNote" ? 1000 : key === "upiQrObjectPath" ? 500 :
      key === "youtubeTaskReward" ? 20 : key === "coinPackages" ? 300 : 300;
    if (typeof value !== "string" || value.length > maxLength) {
      error(res, 400, `${key} must be a string within the allowed length.`); return;
    }
    next[key] = value.trim();
  }
  const min = Number(next.minPurchase), max = Number(next.maxPurchase);
  if (!Number.isSafeInteger(min) || min < 1 || !Number.isSafeInteger(max) || max < min || max > MAX_INT) {
    error(res, 400, "minPurchase and maxPurchase must be valid positive coin limits, with maxPurchase >= minPurchase."); return;
  }
  const coinPackages = parseCoinPackages(next.coinPackages, min, max);
  if (!coinPackages) {
    error(res, 400, "coinPackages must contain up to 20 unique whole-number amounts within the minimum and maximum purchase limits."); return;
  }
  next.coinPackages = coinPackages.join(",");
  const minWithdrawal = Number(next.minWithdrawal);
  if (!Number.isSafeInteger(minWithdrawal) || minWithdrawal < 100 || minWithdrawal > MAX_INT) {
    error(res, 400, "minWithdrawal must be a whole number of at least 100 coins."); return;
  }
  const maxWithdrawal = Number(next.maxWithdrawal);
  if (!Number.isSafeInteger(maxWithdrawal) || maxWithdrawal < minWithdrawal || maxWithdrawal > MAX_INT) {
    error(res, 400, "maxWithdrawal must be a whole number at least as large as minWithdrawal."); return;
  }
  const coinToMoneyRate = Number(next.coinToMoneyRate);
  if (!Number.isFinite(coinToMoneyRate) || coinToMoneyRate <= 0 ||
      coinToMoneyRate > 1_000_000 ||
      Math.abs(coinToMoneyRate * 10_000 - Math.round(coinToMoneyRate * 10_000)) > 1e-8) {
    error(res, 400, "coinToMoneyRate must be a positive rate with no more than four decimal places."); return;
  }
  if (!["true", "false"].includes(next.rechargeEnabled) ||
      !["true", "false"].includes(next.withdrawalEnabled) ||
      !["true", "false"].includes(next.youtubeTaskEnabled)) {
    error(res, 400, "Recharge, withdrawal, and YouTube task enablement must be true or false."); return;
  }
  if (!/^[1-9]\d*$/.test(next.youtubeTaskReward) ||
      !Number.isSafeInteger(Number(next.youtubeTaskReward)) ||
      Number(next.youtubeTaskReward) > MAX_INT) {
    error(res, 400, "youtubeTaskReward must be a positive whole-number coin amount."); return;
  }
  if (!isValidYoutubeChannelUrl(next.youtubeTaskUrl)) {
    error(res, 400, "youtubeTaskUrl must be a valid HTTPS YouTube channel URL."); return;
  }
  if (next.upiId && !/^[a-zA-Z0-9._-]{2,100}@[a-zA-Z0-9.-]{2,100}$/.test(next.upiId)) {
    error(res, 400, "Enter a valid UPI ID."); return;
  }
  if (next.upiQrObjectPath) {
    if (!next.upiQrObjectPath.startsWith("/objects/uploads/daily007/wallet-qr/") ||
        !isWalletObjectPath(next.upiQrObjectPath)) {
      error(res, 400, "Upload the QR image through the wallet settings before saving it."); return;
    }
    try { await validateUploadedWalletImage(next.upiQrObjectPath); }
    catch (e) {
      error(res, 400, e instanceof Error ? e.message : "The QR image could not be verified."); return;
    }
  }
  if (next.rechargeEnabled === "true" && (!next.upiId || !next.upiQrObjectPath)) {
    error(res, 400, "Configure both a UPI ID and a QR image before enabling recharge."); return;
  }
  try {
    await roleTransaction(req, "admin", (client) => client.query(
      `INSERT INTO daily007_v2_settings (id, settings, updated_by, updated_at) VALUES (1, $1, $2, now())
       ON CONFLICT (id) DO UPDATE
         SET settings = EXCLUDED.settings ||
           CASE
             WHEN daily007_v2_settings.settings ? '__daily007VideoCatalogSeeded'
               THEN jsonb_build_object(
                 '__daily007VideoCatalogSeeded',
                 daily007_v2_settings.settings->'__daily007VideoCatalogSeeded'
               )
               ELSE '{}'::jsonb
             END ||
             CASE
               WHEN daily007_v2_settings.settings ? '__daily007AutoCancelCursor'
                 THEN jsonb_build_object(
                   '__daily007AutoCancelCursor',
                   daily007_v2_settings.settings->'__daily007AutoCancelCursor'
                 )
               ELSE '{}'::jsonb
             END,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
      [JSON.stringify(next), userId(req)],
    ));
  } catch (e) { respondFailure(res, e); return; }
  res.json(await clientSettings(true));
});

router.get("/earn/youtube-subscribe", authenticate, async (req, res): Promise<void> => {
  const id = privateAccount(req, res); if (!id) return;
  const current = await settings();
  const rewardCoins = Number(current.youtubeTaskReward);
  const channelUrl = String(current.youtubeTaskUrl ?? "");
  if (!integer(rewardCoins, 1) || !isValidYoutubeChannelUrl(channelUrl)) {
    error(res, 503, "The YouTube task is not configured correctly."); return;
  }
  const claimResult = await pool.query<any>(
    `SELECT * FROM daily007_v2_youtube_subscribe_claims
      WHERE user_id = $1 AND task_key = 'youtube_subscribe'
      ORDER BY (status = 'approved') DESC, created_at DESC LIMIT 1`,
    [id],
  );
  const row = claimResult.rows[0] ?? null;
  res.json({
    enabled: current.youtubeTaskEnabled === "true",
    rewardCoins,
    channelUrl,
    completed: row?.status === "approved",
    claim: row ? youtubeClaimResponse(row) : null,
  });
});

router.post("/earn/youtube-subscribe/claims", authenticate, async (req, res): Promise<void> => {
  const id = privateAccount(req, res); if (!id) return;
  const current = await settings();
  if (current.youtubeTaskEnabled !== "true") {
    error(res, 409, "The YouTube task is currently disabled."); return;
  }
  const rewardCoins = Number(current.youtubeTaskReward);
  if (!integer(rewardCoins, 1)) {
    error(res, 503, "The YouTube task reward is not configured correctly."); return;
  }
  try {
    const result = await transaction((client) => submitYoutubeSubscribeClaim(client, id, rewardCoins));
    res.status(result.created ? 201 : 200).json(result.claim);
  } catch (e) { respondFailure(res, e); }
});

router.get("/admin/earn/youtube-subscribe/claims", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const [countResult, claimsResult] = await Promise.all([
    pool.query<{ total: string | number }>(
      `SELECT COUNT(*) AS total FROM daily007_v2_youtube_subscribe_claims
        WHERE task_key = 'youtube_subscribe' AND status = 'approved'`,
    ),
    pool.query(
      `SELECT c.id, c.user_id AS "userId", COALESCE(u.name, 'Player') AS "userName",
              COALESCE(u.email, '') AS email, c.status, c.reward_coins AS "rewardCoins",
              c.created_at AS "createdAt", c.reviewed_at AS "reviewedAt",
              c.review_reason AS "reviewReason", c.reward_ledger_id AS "transactionId"
         FROM daily007_v2_youtube_subscribe_claims c
         JOIN daily007_v2_users u ON u.id = c.user_id
        WHERE c.task_key = 'youtube_subscribe'
        ORDER BY CASE c.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                 c.created_at DESC
        LIMIT 500`,
    ),
  ]);
  res.json({ totalCompleted: Number(countResult.rows[0]?.total ?? 0), claims: claimsResult.rows });
});

router.post("/admin/earn/youtube-subscribe/claims/:id/:action", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const adminId = privateAccount(req, res); if (!adminId) return;
  const claimId = req.params.id;
  const action = req.params.action;
  if (!validId(claimId) || (action !== "approve" && action !== "reject")) {
    error(res, 400, "A valid claim UUID and approve/reject action are required."); return;
  }
  const body = req.body as unknown;
  const reasonProvided = isObject(body) && body.reason !== undefined;
  const reason = isObject(body) ? text(body.reason, 1, 500) : null;
  if (action === "reject" && reasonProvided && !reason) {
    error(res, 400, "Rejection reason must be 1–500 characters."); return;
  }
  try {
    const reviewed = await roleTransaction(req, "admin", (client) =>
      reviewYoutubeSubscribeClaim(client, claimId, adminId, action, reason));
    res.json(reviewed);
  } catch (e) { respondFailure(res, e); }
});

router.get("/notifications", authenticate, async (req, res): Promise<void> => {
  const id = privateAccount(req, res); if (!id) return;
  const result = await pool.query(
    `SELECT id, title, body, type, (read_at IS NOT NULL) AS read,
            created_at AS "createdAt" FROM daily007_v2_notifications
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`, [id],
  );
  res.json(result.rows);
});
router.patch("/notifications/:id/read", authenticate, async (req, res): Promise<void> => {
  const id = privateAccount(req, res); if (!id) return;
  if (!validId(req.params.id)) { error(res, 400, "Notification id must be a UUID."); return; }
  const result = await pool.query(
    `UPDATE daily007_v2_notifications SET read_at = COALESCE(read_at, now())
      WHERE id = $1 AND user_id = $2 RETURNING id, (read_at IS NOT NULL) AS read`, [req.params.id, id],
  );
  if (!result.rows[0]) { error(res, 404, "Notification not found."); return; }
  res.json(result.rows[0]);
});
router.post("/admin/notifications", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const body = req.body as unknown;
  if (!isObject(body)) { error(res, 400, "Expected title, body, type, and optional userIds."); return; }
  const title = text(body.title, 1, 120), message = text(body.body, 1, 2000);
  const type = body.type;
  const types = new Set(["all", "tournament", "room", "winner", "payment", "selected"]);
  if (!title || !message || typeof type !== "string" || !types.has(type)) {
    error(res, 400, "title/body are required and type must be a supported notification type."); return;
  }
  if (type === "selected") {
    if (!Array.isArray(body.userIds) || body.userIds.length < 1 || body.userIds.length > 500 ||
        !body.userIds.every(validId) || new Set(body.userIds).size !== body.userIds.length) {
      error(res, 400, "Selected notifications require 1–500 unique valid user UUIDs."); return;
    }
  } else if (body.userIds !== undefined) { error(res, 400, "userIds may only be supplied for selected notifications."); return; }
  const sent = await roleTransaction(req, "admin", async (client) => {
    const targets = type === "selected"
      ? await client.query<{ id: string }>("SELECT id FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [body.userIds])
      : await client.query<{ id: string }>("SELECT id FROM daily007_v2_users");
    if (type === "selected" && targets.rows.length !== (body.userIds as string[]).length) {
      throw Object.assign(new Error("One or more selected users do not exist."), { status: 400 });
    }
    for (const target of targets.rows) {
      await client.query(
        `INSERT INTO daily007_v2_notifications (user_id, title, body, type) VALUES ($1, $2, $3, $4)`,
        [target.id, title, message, type],
      );
    }
    return targets.rows.length;
  }).catch((e) => {
    const status = (e as { status?: number }).status;
    if (status) { error(res, status, (e as Error).message); return null; }
    throw e;
  });
  if (sent !== null) res.status(201).json({ sent });
});

router.get("/leaderboard", async (_req, res): Promise<void> => {
  const result = await pool.query(
    `SELECT u.id, u.name, COALESCE(s.wins, 0)::int AS wins,
            COALESCE(s.kills, 0)::int AS kills, COALESCE(s.prize_coins, 0)::int AS "prizeCoins"
       FROM daily007_v2_users u LEFT JOIN daily007_v2_user_stats s ON s.user_id = u.id
      WHERE u.status IS DISTINCT FROM 'blocked'
      ORDER BY COALESCE(s.wins, 0) DESC, COALESCE(s.kills, 0) DESC LIMIT 100`,
  );
  res.json(result.rows);
});

router.get("/referrals", authenticate, async (req, res): Promise<void> => {
  const id = privateAccount(req, res); if (!id) return;
  const code = await ensureDaily007ReferralCode(pool, id);
  const [referrals, totals] = await Promise.all([
    pool.query(
      `SELECT r.id, u.id AS "referredUserId", u.name AS "referredName",
              'complete' AS "signupStatus",
              CASE WHEN EXISTS (
                SELECT 1 FROM daily007_v2_wallet_ledger signup_bonus
                 WHERE signup_bonus.idempotency_key = 'daily007-referral-signup:' || u.id::text
              ) THEN 'credited' ELSE 'not_credited' END AS "signupBonusStatus",
              CASE
                WHEN r.rewarded_at IS NOT NULL THEN 'rewarded'
                WHEN EXISTS (
                  SELECT 1 FROM daily007_v2_payments p
                   WHERE p.user_id = u.id AND p.status = 'approved' AND p.coins >= 50
                ) THEN 'eligible_unrewarded'
                WHEN EXISTS (
                  SELECT 1 FROM daily007_v2_payments p
                   WHERE p.user_id = u.id AND p.status = 'pending' AND p.coins >= 50
                ) THEN 'awaiting_approval'
                WHEN EXISTS (
                  SELECT 1 FROM daily007_v2_payments p
                   WHERE p.user_id = u.id AND p.status IN ('approved', 'pending')
                ) THEN 'below_minimum'
                ELSE 'not_started'
              END AS "firstRechargeStatus",
              CASE WHEN r.rewarded_at IS NOT NULL THEN 'credited' ELSE 'pending' END
                AS "referrerRewardStatus",
              (
                SELECT reward.details ->> 'qualifyingPaymentId'
                  FROM daily007_v2_wallet_ledger reward
                 WHERE reward.idempotency_key = 'daily007-referral-recharge:' || r.id::text
                 LIMIT 1
              ) AS "qualifyingPaymentId",
              r.created_at AS "createdAt"
         FROM daily007_v2_referrals r
         JOIN daily007_v2_users u ON u.id = r.referred_user_id
        WHERE r.referrer_user_id = $1
        ORDER BY r.created_at DESC`,
      [id],
    ),
    pool.query<{ total: number }>(
      `SELECT COALESCE(sum(amount), 0)::int AS total
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1 AND reason IN ('Referral Signup Bonus', 'Referral Recharge Bonus')`,
      [id],
    ),
  ]);
  const successfulReferrals = referrals.rows.filter(
    (referral: any) => referral.referrerRewardStatus === "credited",
  ).length;
  const referralList = referrals.rows.map((referral: any) => ({
    ...referral,
    firstRechargeStatus: classifyReferralRechargeStatus({
      rewarded: referral.firstRechargeStatus === "rewarded",
      approvedAtLeastMinimum: referral.firstRechargeStatus === "eligible_unrewarded",
      pendingAtLeastMinimum: referral.firstRechargeStatus === "awaiting_approval",
      hasOtherRecharge: referral.firstRechargeStatus === "below_minimum",
    }),
  }));
  const totalPeopleReferred = referralList.length;
  const { referralLink } = createDaily007ReferralLinks(code);
  res.json({
    code,
    referralLink,
    totalPeopleReferred,
    successfulReferrals,
    pendingReferrals: totalPeopleReferred - successfulReferrals,
    totalReferralCoinsEarned: totals.rows[0]?.total ?? 0,
    referrals: referralList,
  });
});

router.get("/videos", async (_req, res): Promise<void> => {
  const result = await pool.query(
    `SELECT id, title, topic, youtube_id AS "youtubeId", active, created_at AS "createdAt"
       FROM daily007_v2_videos
      WHERE active = true
      ORDER BY created_at DESC, id`,
  );
  res.json(Daily007ListVideosResponse.parse({
    videos: result.rows.map((video: any) => ({
      ...video,
      url: `https://youtu.be/${video.youtubeId}`,
    })),
  }));
});

router.get("/admin/videos", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  // Carry the existing featured player into the managed list once. Admins can
  // deactivate it after adding their replacement or additional videos.
  let result: { rows: any[] };
  try {
    result = await roleTransaction(req, "admin", async (client) => {
      await client.query(
        `INSERT INTO daily007_v2_settings (id, settings)
         VALUES (1, '{}'::jsonb)
         ON CONFLICT (id) DO NOTHING`,
      );
      const seedState = await client.query<{ seeded: boolean }>(
        `SELECT COALESCE((settings->>'__daily007VideoCatalogSeeded')::boolean, false) AS seeded
           FROM daily007_v2_settings
          WHERE id = 1
          FOR UPDATE`,
      );
      if (!seedState.rows[0]?.seeded) {
        await client.query(
          `INSERT INTO daily007_v2_videos (title, topic, youtube_id, active)
           SELECT $1, $2, $3, true
            WHERE NOT EXISTS (SELECT 1 FROM daily007_v2_videos)
           ON CONFLICT (youtube_id) DO NOTHING`,
          ["Daily007 featured video", "General", "opKbUpusuTc"],
        );
        await markDaily007VideoCatalogSeeded(client);
      }
      return client.query(
        `SELECT id, title, topic, youtube_id AS "youtubeId", active, created_at AS "createdAt"
           FROM daily007_v2_videos
          ORDER BY created_at DESC, id`,
      );
    });
  } catch (e) { respondFailure(res, e); return; }
  res.json(Daily007AdminListVideosResponse.parse({
    videos: result.rows.map((video: any) => ({
      ...video,
      url: `https://youtu.be/${video.youtubeId}`,
    })),
  }));
});

router.post("/admin/videos", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const parsedBody = Daily007AdminCreateVideoBody.safeParse(req.body);
  if (!parsedBody.success) {
    error(res, 400, "Enter a title, topic, and valid YouTube video URL."); return;
  }
  const title = text(parsedBody.data.title, 1, 120);
  const topic = text(parsedBody.data.topic, 1, 80);
  const youtubeId = youtubeVideoIdFromUrl(parsedBody.data.url);
  if (!title || !topic || !youtubeId) {
    error(res, 400, "Enter a title, topic up to 80 characters, and valid YouTube video URL."); return;
  }
  try {
    const result = await roleTransaction(req, "admin", (client) => client.query(
      `INSERT INTO daily007_v2_videos (title, topic, youtube_id, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, topic, youtube_id AS "youtubeId", active, created_at AS "createdAt"`,
      [title, topic, youtubeId, userId(req)],
    ));
    const video: any = result.rows[0];
    res.status(201).json(Daily007AdminCreateVideoResponse.parse({
      ...video,
      url: `https://youtu.be/${video.youtubeId}`,
    }));
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      error(res, 409, "This YouTube video is already in the managed list."); return;
    }
    if ((e as { status?: number }).status) { respondFailure(res, e); return; }
    throw e;
  }
});

router.patch("/admin/videos/:id", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = req.params.id;
  if (!validId(id)) {
    error(res, 400, "Provide a valid video id."); return;
  }
  const parsedBody = Daily007AdminUpdateVideoBody.safeParse(req.body);
  if (!parsedBody.success) {
    error(res, 400, "Enter a title, topic, and valid YouTube video URL."); return;
  }
  const title = text(parsedBody.data.title, 1, 120);
  const topic = text(parsedBody.data.topic, 1, 80);
  const youtubeId = youtubeVideoIdFromUrl(parsedBody.data.url);
  if (!title || !topic || !youtubeId) {
    error(res, 400, "Enter a title, topic up to 80 characters, and valid YouTube video URL."); return;
  }

  try {
    const outcome = await roleTransaction(req, "admin", async (client) => {
      const existing = await client.query<{ youtube_id: string }>(
        `SELECT youtube_id
           FROM daily007_v2_videos
          WHERE id = $1
          FOR UPDATE`,
        [id],
      );
      const current = existing.rows[0];
      if (!current) return { kind: "missing" } as const;

      if (current.youtube_id !== youtubeId) {
        const watchHistory = await client.query<{ hasSessions: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM daily007_v2_video_watch_sessions WHERE video_id = $1
           ) AS "hasSessions"`,
          [id],
        );
        if (watchHistory.rows[0]?.hasSessions) return { kind: "history" } as const;
      }

      const result = await client.query<{
        id: string;
        title: string;
        topic: string;
        youtubeId: string;
        active: boolean;
        createdAt: Date | string;
      }>(
        `UPDATE daily007_v2_videos
            SET title = $2, topic = $3, youtube_id = $4
          WHERE id = $1
          RETURNING id, title, topic, youtube_id AS "youtubeId", active, created_at AS "createdAt"`,
        [id, title, topic, youtubeId],
      );
      const updated = result.rows[0];
      if (!updated) return { kind: "missing" } as const;
      return { kind: "updated", video: updated } as const;
    });

    if (outcome.kind === "missing") {
      error(res, 404, "Video not found."); return;
    }
    if (outcome.kind === "history") {
      error(res, 409, "This video has watch history. Add a new video instead of changing its YouTube link."); return;
    }
    res.json(Daily007AdminUpdateVideoResponse.parse({
      ...outcome.video,
      url: `https://youtu.be/${outcome.video.youtubeId}`,
    }));
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      error(res, 409, "This YouTube video is already in the managed list."); return;
    }
    if ((e as { status?: number }).status) { respondFailure(res, e); return; }
    throw e;
  }
});

router.delete("/admin/videos/:id", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = req.params.id;
  if (!validId(id)) {
    error(res, 400, "Provide a valid video id."); return;
  }

  let outcome: "missing" | "history" | "deleted";
  try {
    outcome = await roleTransaction(req, "admin", async (client) => {
      await client.query(
        `INSERT INTO daily007_v2_settings (id, settings)
         VALUES (1, '{}'::jsonb)
         ON CONFLICT (id) DO NOTHING`,
      );
      await client.query("SELECT id FROM daily007_v2_settings WHERE id = 1 FOR UPDATE");
      const existing = await client.query<{ id: string }>(
        `SELECT id
           FROM daily007_v2_videos
          WHERE id = $1
          FOR UPDATE`,
        [id],
      );
      if (!existing.rows[0]) return "missing";

      const watchHistory = await client.query<{ hasSessions: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM daily007_v2_video_watch_sessions WHERE video_id = $1
         ) AS "hasSessions"`,
        [id],
      );
      if (watchHistory.rows[0]?.hasSessions) return "history";

      await client.query("DELETE FROM daily007_v2_videos WHERE id = $1", [id]);
      await markDaily007VideoCatalogSeeded(client);
      return "deleted";
    });
  } catch (e) { respondFailure(res, e); return; }

  if (outcome === "missing") {
    error(res, 404, "Video not found."); return;
  }
  if (outcome === "history") {
    error(res, 409, "This video has watch history. Hide it instead of permanently deleting it."); return;
  }
  res.status(204).send();
});

router.patch("/admin/videos/:id/active", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = req.params.id;
  const body = req.body as unknown;
  if (!validId(id) || !isObject(body) || typeof body.active !== "boolean") {
    error(res, 400, "Provide a valid video id and active state."); return;
  }
  let result;
  try {
    result = await roleTransaction(req, "admin", (client) => client.query(
    `UPDATE daily007_v2_videos
        SET active = $2
      WHERE id = $1
      RETURNING id, title, topic, youtube_id AS "youtubeId", active, created_at AS "createdAt"`,
    [id, body.active],
    ));
  } catch (e) { respondFailure(res, e); return; }
  const video: any = result.rows[0];
  if (!video) { error(res, 404, "Video not found."); return; }
  res.json(Daily007AdminSetVideoActiveResponse.parse({
    ...video,
    url: `https://youtu.be/${video.youtubeId}`,
  }));
});

router.post("/videos/watch/start", authenticate, async (req, res): Promise<void> => {
  const accountId = privateAccount(req, res); if (!accountId) return;
  const body = req.body as unknown;
  if (!isObject(body) || !validId(body.videoId) ||
      !integer(body.durationSeconds, 5, 86_400) ||
      !isValidDaily007VideoStartAttemptId(body.attemptId)) {
    error(res, 400, "Provide a valid video id, duration, and playback attempt identity."); return;
  }
  try {
    const result = await transaction((client) =>
      startDaily007VideoWatch(
        client,
        accountId,
        body.videoId as string,
        body.durationSeconds as number,
        body.attemptId as string,
      ));
    const { created, ...session } = result;
    res.status(created ? 201 : 200).json(session);
  } catch (e) { respondFailure(res, e); }
});

router.post("/videos/watch/complete", authenticate, async (req, res): Promise<void> => {
  const accountId = privateAccount(req, res); if (!accountId) return;
  const body = req.body as unknown;
  if (!isObject(body) || !validId(body.sessionId) ||
      !integer(body.percentWatched, 75, 100)) {
    error(res, 400, "Provide a valid playback session and at least 75% estimated progress."); return;
  }
  try {
    const result = await transaction((client) =>
      completeDaily007VideoWatch(
        client,
        accountId,
        body.sessionId as string,
        body.percentWatched as number,
      ));
    res.json(result);
  } catch (e) { respondFailure(res, e); }
});

// Keep the older endpoint non-rewarding: only a server-created playback
// session can be credited by the new completion route.
router.post("/videos/watch", authenticate, (_req, res): void => {
  res.json(pausedVideoRewardResponse());
});

function configuredPrizeForRank(prizePool: number, prizeDistribution: string, rank: number): number {
  const configured = /(?:#\s*)?(\d+)(?:st|nd|rd|th)?\s*(?:place)?\s*[:=-]\s*([\d,]+)/gi;
  for (const match of prizeDistribution.matchAll(configured)) {
    if (Number(match[1]) !== rank) continue;
    const amount = Number(match[2].replace(/,/g, ""));
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_INT) {
      throw Object.assign(new Error("The configured tournament prize is outside the supported range."), { status: 409 });
    }
    return amount;
  }
  return rank === 1 ? prizePool : 0;
}

router.get("/admin/results/duplicate-placements", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const result = await pool.query<{
    tournamentId: string;
    tournamentName: string;
    startsAt: Date | string;
    tournamentStatus: string;
    prizePool: number;
    prizeDistribution: string;
    rank: number;
    registrationCount: number;
    totalPrizeCoins: string;
    awards: Array<{
      awardId: string;
      registrationId: string;
      userId: string;
      playerName: string;
      gameName: string;
      teamName: string | null;
      kills: number;
      prizeCoins: number;
      createdAt: string;
    }>;
  }>(
    `WITH duplicate_placements AS (
       SELECT match_id, rank, count(*)::int AS registration_count
         FROM daily007_v2_result_awards
        GROUP BY match_id, rank
       HAVING count(*) > 1
     )
     SELECT m.id AS "tournamentId", m.title AS "tournamentName",
            m.starts_at AS "startsAt", m.status AS "tournamentStatus",
            m.prize_pool AS "prizePool", m.prize_distribution AS "prizeDistribution",
            duplicate.rank, duplicate.registration_count AS "registrationCount",
            sum(award.prize_coins)::text AS "totalPrizeCoins",
            jsonb_agg(
              jsonb_build_object(
                'awardId', award.id,
                'registrationId', award.registration_id,
                'userId', award.user_id,
                'playerName', registration.captain_name,
                'gameName', registration.captain_game_name,
                'teamName', registration.team_name,
                'kills', award.kills,
                'prizeCoins', award.prize_coins,
                'createdAt', award.created_at
              )
              ORDER BY award.created_at ASC, award.id ASC
            ) AS awards
       FROM duplicate_placements duplicate
       JOIN daily007_v2_matches m ON m.id = duplicate.match_id
       JOIN daily007_v2_result_awards award
         ON award.match_id = duplicate.match_id AND award.rank = duplicate.rank
       JOIN daily007_v2_registrations registration ON registration.id = award.registration_id
      GROUP BY m.id, duplicate.rank, duplicate.registration_count
      ORDER BY m.starts_at DESC, duplicate.rank ASC, m.id ASC`,
  );

  res.json({
    success: true,
    data: result.rows.map((row) => ({
      ...row,
      startsAt: row.startsAt instanceof Date ? row.startsAt.toISOString() : new Date(row.startsAt).toISOString(),
      // Keep the exact total as text; PostgreSQL sums can exceed JavaScript's safe integer range.
      totalPrizeCoins: String(row.totalPrizeCoins),
    })),
    correctionGuidance:
      "This audit does not change results or player balances. Verify each placement against the original tournament records and prize rules before deciding whether to preserve or correct it. If a correction is approved, reconcile the award, wallet, lifetime stats, and prize ledger together in one transaction; preserve an auditable ledger trail with compensating entries rather than deleting payout history.",
  });
});

router.get("/admin/results", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const includeUnfinalized = req.query.includeUnfinalized === "true";
  const result = await pool.query<{
    tournamentId: string;
    tournamentName: string;
    registrationId: string;
    playerName: string;
    gameName: string | null;
    teamName: string | null;
    rank: number;
    kills: number;
    prizeCoins: number;
    createdAt: Date | string;
  }>(
    `SELECT award.match_id AS "tournamentId", m.title AS "tournamentName",
            award.registration_id AS "registrationId", registration.captain_name AS "playerName",
            registration.captain_game_name AS "gameName", registration.team_name AS "teamName",
            award.rank, award.kills, award.prize_coins AS "prizeCoins", award.created_at AS "createdAt"
       FROM daily007_v2_result_awards award
       JOIN daily007_v2_matches m ON m.id = award.match_id
       JOIN daily007_v2_registrations registration ON registration.id = award.registration_id
       WHERE m.status <> 'cancelled'
         AND (
           $1::boolean
           OR (
             m.enabled = false
             AND EXISTS (
               SELECT 1 FROM daily007_v2_result_awards winner
                WHERE winner.match_id = m.id AND winner.rank = 1
             )
           )
         )
       ORDER BY m.starts_at DESC, award.rank ASC, award.created_at ASC, award.id ASC`,
    [includeUnfinalized],
  );
  res.json({
    success: true,
    data: result.rows.map((row) => ({
      ...row,
      createdAt: row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt).toISOString(),
    })),
  });
});

router.post("/admin/results", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const body = req.body as unknown;
  if (!isObject(body) || !validId(body.tournamentId) || !validId(body.registrationId) ||
      !integer(body.rank, 1) || !integer(body.kills, 0)) {
    error(res, 400, "tournamentId/match id and registrationId UUIDs, positive rank and nonnegative kills are required."); return;
  }
  const tournamentId = body.tournamentId as string;
  const registrationId = body.registrationId as string;
  const rank = body.rank as number;
  const kills = body.kills as number;
  try {
    const result = await roleTransaction(req, "tournament_admin", async (client) => {
      const matchFormat = await client.query<{
        mode: string; game_mode: string | null; team_type: string | null;
      }>(
        "SELECT mode, game_mode, team_type FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
        [tournamentId],
      );
      const format = matchFormat.rows[0];
      if (!format) throw Object.assign(new Error("Tournament was not found."), { status: 404 });
      const isBattleRoyaleSquad = format.mode === "squad" &&
        (format.game_mode === null ||
          (format.game_mode === "battle_royale" && format.team_type === "squad"));
      if (isBattleRoyaleSquad) await ensureLegacySquadTeams(client, tournamentId);
      const registration = await client.query<{
        id: string; match_id: string; captain_user_id: string; prize_pool: number; prize_distribution: string;
        has_started: boolean; match_status: string;
      }>(
        `SELECT r.id, r.match_id, r.captain_user_id, m.prize_pool, m.prize_distribution,
                m.status AS match_status,
                m.starts_at <= clock_timestamp() + interval '5 hours 30 minutes' AS has_started
           FROM daily007_v2_registrations r
           JOIN daily007_v2_matches m ON m.id = r.match_id
          WHERE r.id = $1 AND m.id = $2 AND r.status = 'approved'
          FOR UPDATE OF r`, [registrationId, tournamentId],
      );
      const row = registration.rows[0];
      if (!row || row.match_id !== tournamentId) throw Object.assign(new Error("Registration was not found for this tournament/match."), { status: 404 });
      let squadTeamId: string | null = null;
      if (isBattleRoyaleSquad) {
        const membership = await client.query<{
          team_id: string; captain_registration_id: string | null; is_active: boolean;
        }>(
          `SELECT member.team_id, team.captain_registration_id, member.is_active
             FROM daily007_v2_squad_team_members member
             JOIN daily007_v2_squad_teams team ON team.id = member.team_id
            WHERE member.registration_id = $1
            LIMIT 1`,
          [row.id],
        );
        const member = membership.rows[0];
        if (!member || member.is_active !== true) {
          throw Object.assign(new Error("This player no longer occupies an active Squad slot."), { status: 409 });
        }
        if (member.captain_registration_id !== row.id) {
          throw Object.assign(new Error("Publish Squad results from the team captain’s registration."), { status: 409 });
        }
        squadTeamId = member.team_id;
      }
      if (row.match_status === "cancelled") {
        throw Object.assign(new Error("Results cannot be published for a cancelled tournament."), { status: 409 });
      }
      if (!row.has_started) {
        throw Object.assign(new Error("Results can only be published after the tournament starts."), { status: 409 });
      }
      // The match row is locked above, so submissions for this tournament serialize at this check.
      const existingPlacement = await client.query<{ registration_id: string }>(
        "SELECT registration_id FROM daily007_v2_result_awards WHERE match_id = $1 AND rank = $2",
        [row.match_id, rank],
      );
      const placementAward = existingPlacement.rows[0];
      if (placementAward) {
        if (placementAward.registration_id === row.id) {
          throw Object.assign(new Error("A result has already been published for this registration."), { status: 409 });
        }
        if (rank === 1) {
          throw Object.assign(new Error("A winner has already been declared for this tournament."), { status: 409 });
        }
        throw Object.assign(new Error("This placement has already been awarded for this tournament."), { status: 409 });
      }
      if (isBattleRoyaleSquad && squadTeamId) {
        const previousTeamAward = await client.query<{ registration_id: string }>(
          `SELECT award.registration_id
             FROM daily007_v2_result_awards award
             JOIN daily007_v2_squad_team_members awarded_member
               ON awarded_member.registration_id = award.registration_id
            WHERE award.match_id = $1 AND awarded_member.team_id = $2
            LIMIT 1`,
          [row.match_id, squadTeamId],
        );
        if (previousTeamAward.rows[0]) {
          throw Object.assign(new Error("A result has already been published for this Squad team."), { status: 409 });
        }
      }
      const prizeCoins = configuredPrizeForRank(row.prize_pool, row.prize_distribution, rank);
      const account = await client.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE", [row.captain_user_id],
      );
      const balance = account.rows[0]?.wallet_coins;
      if (balance === undefined) throw Object.assign(new Error("Player account not found."), { status: 404 });
      const next = balance + prizeCoins;
      if (next > MAX_INT) throw Object.assign(new Error("Prize would exceed the supported wallet range."), { status: 409 });
      const statsResult = await client.query<{
        matches: number;
        wins: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT matches, wins, kills, prize_coins
           FROM daily007_v2_user_stats
          WHERE user_id = $1
          FOR UPDATE`,
        [row.captain_user_id],
      );
      const stats = statsResult.rows[0] ?? { matches: 0, wins: 0, kills: 0, prize_coins: 0 };
      const statIncrements: Array<[string, number, number]> = [
        ["matches", stats.matches, 1],
        ["wins", stats.wins, rank === 1 ? 1 : 0],
        ["kills", stats.kills, kills],
        ["prize total", stats.prize_coins, prizeCoins],
      ];
      for (const [statName, currentValue, increment] of statIncrements) {
        const nextValue = currentValue + increment;
        if (!Number.isSafeInteger(nextValue) || nextValue > MAX_INT) {
          throw Object.assign(
            new Error(`Player lifetime ${statName} would exceed the supported range.`),
            { status: 409 },
          );
        }
      }
      const award = await client.query(
        `INSERT INTO daily007_v2_result_awards (match_id, registration_id, user_id, rank, kills, prize_coins)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`, [row.match_id, row.id, row.captain_user_id, rank, kills, prizeCoins],
      );
      await client.query(
        `INSERT INTO daily007_v2_user_stats (user_id, matches, wins, kills, prize_coins)
         VALUES ($1, 1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           matches = daily007_v2_user_stats.matches + 1,
           wins = daily007_v2_user_stats.wins + EXCLUDED.wins,
           kills = daily007_v2_user_stats.kills + EXCLUDED.kills,
           prize_coins = daily007_v2_user_stats.prize_coins + EXCLUDED.prize_coins`,
        [row.captain_user_id, rank === 1 ? 1 : 0, kills, prizeCoins],
      );
      await client.query("UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1", [row.captain_user_id, next]);
      if (prizeCoins > 0) await client.query(
        `INSERT INTO daily007_v2_wallet_ledger
           (user_id, amount, balance_after, reason, match_id, registration_id)
         VALUES ($1, $2, $3, 'match_prize', $4, $5)`,
        [row.captain_user_id, prizeCoins, next, row.match_id, row.id],
      );
      if (rank === 1) {
        await client.query(
          "UPDATE daily007_v2_matches SET enabled = false WHERE id = $1",
          [row.match_id],
        );
      }
      return { id: (award.rows[0] as { id: string }).id, registrationId: row.id, userId: row.captain_user_id, prizeCoins, walletCoins: next };
    });
    res.status(201).json(result);
  } catch (e) {
    const postgresError = e as { code?: unknown; constraint?: unknown } | null;
    if (
      postgresError?.code === "23505" &&
      postgresError.constraint === "daily007_v2_result_awards_registration_id_unique"
    ) {
      error(res, 409, "A result has already been published for this registration.");
      return;
    }
    respondFailure(res, e);
  }
});

export default router;