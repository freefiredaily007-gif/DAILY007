import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { authenticate, requireAdmin, requireTournamentAdmin } from "./daily007-v2";
import { isAssignableTournamentRole } from "../lib/daily007-roles";
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
import {
  reviewYoutubeSubscribeClaim,
  submitYoutubeSubscribeClaim,
  youtubeClaimResponse,
} from "../lib/daily007-youtube-subscribe";
import {
  completeDaily007VideoWatch,
  startDaily007VideoWatch,
  youtubeVideoIdFromUrl,
} from "../lib/daily007-video-rewards";
import {
  createWalletImageReadUrl,
  createWalletImageUpload,
  isWalletObjectPath,
  validateUploadedWalletImage,
} from "../lib/daily007-wallet-storage";

const router: IRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INT = 2_147_483_647;
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

async function settings(): Promise<Record<string, unknown>> {
  const result = await pool.query<{ settings: Record<string, unknown> }>(
    "SELECT settings FROM daily007_v2_settings WHERE id = 1",
  );
  const current = { ...SETTINGS_DEFAULTS, ...(result.rows[0]?.settings ?? {}) };
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
  try {
    const upload = await createWalletImageUpload({
      userId: id,
      purpose: body.purpose,
      contentType: body.contentType,
      size: body.size,
    });
    res.json({ ...upload, expiresInSeconds: 900 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create an upload URL.";
    error(res, 400, message);
  }
});

router.get("/wallet/transactions", authenticate, async (req, res): Promise<void> => {
  const id = privateAccount(req, res); if (!id) return;
  const result = await pool.query(
    `SELECT id, amount, balance_after AS "balanceAfter", reason, details,
            created_at AS "createdAt"
       FROM daily007_v2_wallet_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`, [id],
  );
  res.json(result.rows.map((row: any) => ({
    ...row, description: String(row.reason).replaceAll("_", " "),
  })));
});

router.post("/payments", authenticate, async (req, res): Promise<void> => {
  const id = privateAccount(req, res); if (!id) return;
  const body = req.body as unknown;
  if (!isObject(body)) { error(res, 400, "Expected coins and a payment transaction reference."); return; }
  const coins = body.coins;
  const reference = text(body.txnId ?? body.reference, 1, 200);
  const payerUpiId = body.payerUpiId === undefined ? null : text(body.payerUpiId, 1, 200);
  if (!integer(coins, 1) || !reference) {
    error(res, 400, "coins must be a positive whole number and txnId/reference must contain 1–200 characters.");
    return;
  }
  if (body.payerUpiId !== undefined && !payerUpiId) {
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
       VALUES ($1, $2, $2, $3, $4, $5, $6)
       RETURNING id, coins, amount, payer_upi_id AS "payerUpiId", reference AS "txnId", status,
                 created_at AS "createdAt"`,
      [id, coins, payerUpiId, reference, normalized, proofObjectPath],
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
  const result = await pool.query(
    `SELECT id, coins, amount, reference AS "txnId", status,
            review_reason AS "reviewReason", created_at AS "createdAt",
            reviewed_at AS "reviewedAt"
       FROM daily007_v2_payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`, [id],
  );
  res.json(result.rows);
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
  if (!requireAdmin(req, res)) return;
  const result = await pool.query(
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
  res.json(result.rows);
});

router.get("/admin/payments/:id/proof-url", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!validId(req.params.id)) { error(res, 400, "Payment request id must be a UUID."); return; }
  const result = await pool.query<{ proof_object_path: string | null }>(
    "SELECT proof_object_path FROM daily007_v2_payments WHERE id = $1 AND status <> 'deleted'",
    [req.params.id],
  );
  const objectPath = result.rows[0]?.proof_object_path;
  if (!objectPath || !isWalletObjectPath(objectPath)) { error(res, 404, "Payment proof is unavailable."); return; }
  try {
    res.json({ url: await createWalletImageReadUrl(objectPath) });
  } catch {
    error(res, 404, "Payment proof is unavailable.");
  }
});

router.get("/admin/withdrawals", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const result = await pool.query(
    `SELECT w.id, w.user_id AS "userId", u.name AS "userName", u.email,
            w.coins, w.method, w.account, w.status, w.payout_status AS "payoutStatus",
            w.review_reason AS "reviewReason",
            w.created_at AS "createdAt", w.reviewed_at AS "reviewedAt"
       FROM daily007_v2_withdrawals w JOIN daily007_v2_users u ON u.id = w.user_id
      WHERE w.status <> 'deleted'
      ORDER BY w.created_at DESC LIMIT 500`,
  );
  res.json(result.rows);
});

router.post("/admin/withdrawals/:id/payout", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!validId(req.params.id)) { error(res, 400, "Withdrawal id must be a UUID."); return; }
  const adminId = privateAccount(req, res); if (!adminId) return;
  try {
    const result = await transaction(async (client) => {
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
      const result = await transaction(async (client) => {
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
      const result = await transaction(async (client) => {
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

router.patch("/admin/users/:id/role", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
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
      const selected = await client.query<{ role: string }>(
        "SELECT role FROM daily007_v2_users WHERE id = $1 FOR UPDATE", [id],
      );
      const currentRole = selected.rows[0]?.role;
      if (!currentRole) return null;
      if (currentRole === "admin") {
        const admins = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM daily007_v2_users WHERE role = 'admin'",
        );
        if (Number(admins.rows[0]?.count ?? 0) <= 1) {
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
  if ((!setStatus && !setCoins) ||
      (setStatus && body.status !== "active" && body.status !== "blocked") ||
      (setCoins && (!integer(body.coinsDelta, -MAX_INT, MAX_INT) || body.coinsDelta === 0))) {
    error(res, 400, "Provide status active/blocked and/or a nonzero signed integer coinsDelta within 32-bit range."); return;
  }
  const reason = setCoins ? text(body.note ?? body.reason, 1, 100) : null;
  if (setCoins && !reason) { error(res, 400, "A 1–100 character reason is required for coin adjustments."); return; }
  try {
    const user = await transaction(async (client) => {
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
        `INSERT INTO daily007_v2_wallet_ledger (user_id, amount, balance_after, reason)
         VALUES ($1, $2, $3, $4)`, [id, body.coinsDelta, next, `admin_adjustment:${reason}`],
      );
      return update.rows[0];
    });
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
       (SELECT count(*)::int FROM daily007_v2_matches
         WHERE enabled = true AND starts_at > now()) AS "activeTournaments",
       (SELECT count(*)::int FROM daily007_v2_registrations WHERE status = 'pending') AS "pendingRegistrations",
       (SELECT count(*)::int FROM daily007_v2_registrations WHERE status = 'approved') AS "approvedRegistrations",
       (SELECT count(*)::int FROM daily007_v2_registrations WHERE status = 'rejected') AS "rejectedRegistrations",
       (SELECT count(*)::int FROM daily007_v2_payments WHERE status = 'pending') AS "pendingPayments",
       (SELECT count(DISTINCT match_id)::int FROM daily007_v2_result_awards) AS "completedTournaments",
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
  await pool.query(
    `INSERT INTO daily007_v2_settings (id, settings, updated_by, updated_at) VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(next), userId(req)],
  );
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
    const reviewed = await transaction((client) =>
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
  const sent = await transaction(async (client) => {
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
    `SELECT id, title, youtube_id AS "youtubeId", active, created_at AS "createdAt"
       FROM daily007_v2_videos
      WHERE active = true
      ORDER BY created_at DESC, id`,
  );
  res.json({
    videos: result.rows.map((video: any) => ({
      ...video,
      url: `https://youtu.be/${video.youtubeId}`,
    })),
  });
});

router.get("/admin/videos", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  // Carry the existing featured player into the managed list once. Admins can
  // deactivate it after adding their replacement or additional videos.
  await pool.query(
    `INSERT INTO daily007_v2_videos (title, youtube_id, active)
     SELECT $1, $2, true
      WHERE NOT EXISTS (SELECT 1 FROM daily007_v2_videos)
     ON CONFLICT (youtube_id) DO NOTHING`,
    ["Daily007 featured video", "opKbUpusuTc"],
  );
  const result = await pool.query(
    `SELECT id, title, youtube_id AS "youtubeId", active, created_at AS "createdAt"
       FROM daily007_v2_videos
      ORDER BY created_at DESC, id`,
  );
  res.json({
    videos: result.rows.map((video: any) => ({
      ...video,
      url: `https://youtu.be/${video.youtubeId}`,
    })),
  });
});

router.post("/admin/videos", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const body = req.body as unknown;
  if (!isObject(body)) {
    error(res, 400, "Expected a video title and YouTube URL."); return;
  }
  const title = text(body.title, 1, 120);
  const youtubeId = youtubeVideoIdFromUrl(body.url);
  if (!title || !youtubeId) {
    error(res, 400, "Enter a title up to 120 characters and a valid YouTube video URL."); return;
  }
  try {
    const result = await pool.query(
      `INSERT INTO daily007_v2_videos (title, youtube_id, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, title, youtube_id AS "youtubeId", active, created_at AS "createdAt"`,
      [title, youtubeId, userId(req)],
    );
    const video: any = result.rows[0];
    res.status(201).json({ ...video, url: `https://youtu.be/${video.youtubeId}` });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      error(res, 409, "This YouTube video is already in the managed list."); return;
    }
    throw e;
  }
});

router.patch("/admin/videos/:id/active", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = req.params.id;
  const body = req.body as unknown;
  if (!validId(id) || !isObject(body) || typeof body.active !== "boolean") {
    error(res, 400, "Provide a valid video id and active state."); return;
  }
  const result = await pool.query(
    `UPDATE daily007_v2_videos
        SET active = $2
      WHERE id = $1
      RETURNING id, title, youtube_id AS "youtubeId", active, created_at AS "createdAt"`,
    [id, body.active],
  );
  const video: any = result.rows[0];
  if (!video) { error(res, 404, "Video not found."); return; }
  res.json({ ...video, url: `https://youtu.be/${video.youtubeId}` });
});

router.post("/videos/watch/start", authenticate, async (req, res): Promise<void> => {
  const accountId = privateAccount(req, res); if (!accountId) return;
  const body = req.body as unknown;
  if (!isObject(body) || !validId(body.videoId) ||
      !integer(body.durationSeconds, 5, 86_400)) {
    error(res, 400, "Provide a valid video id and duration."); return;
  }
  try {
    const session = await transaction((client) =>
      startDaily007VideoWatch(client, accountId, body.videoId as string, body.durationSeconds as number));
    res.status(201).json(session);
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

router.post("/admin/results", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const body = req.body as unknown;
  if (!isObject(body) || !validId(body.tournamentId) || !validId(body.registrationId) ||
      !integer(body.rank, 1) || !integer(body.kills, 0) || !integer(body.prizeCoins, 0)) {
    error(res, 400, "tournamentId/match id and registrationId UUIDs, positive rank, nonnegative kills and prizeCoins are required."); return;
  }
  const tournamentId = body.tournamentId as string;
  const registrationId = body.registrationId as string;
  const rank = body.rank as number;
  const kills = body.kills as number;
  const prizeCoins = body.prizeCoins as number;
  try {
    const result = await transaction(async (client) => {
      const registration = await client.query<{
        id: string; match_id: string; captain_user_id: string;
      }>(
        `SELECT id, match_id, captain_user_id FROM daily007_v2_registrations
          WHERE id = $1 AND status = 'approved' FOR UPDATE`, [registrationId],
      );
      const row = registration.rows[0];
      if (!row || row.match_id !== tournamentId) throw Object.assign(new Error("Registration was not found for this tournament/match."), { status: 404 });
      const account = await client.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE", [row.captain_user_id],
      );
      const balance = account.rows[0]?.wallet_coins;
      if (balance === undefined) throw Object.assign(new Error("Player account not found."), { status: 404 });
      const next = balance + prizeCoins;
      if (next > MAX_INT) throw Object.assign(new Error("Prize would exceed the supported wallet range."), { status: 409 });
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
        `INSERT INTO daily007_v2_wallet_ledger (user_id, amount, balance_after, reason)
         VALUES ($1, $2, $3, 'match_prize')`, [row.captain_user_id, prizeCoins, next],
      );
      return { id: (award.rows[0] as { id: string }).id, registrationId: row.id, userId: row.captain_user_id, walletCoins: next };
    });
    res.status(201).json(result);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") { error(res, 409, "A result has already been published for this registration."); return; }
    respondFailure(res, e);
  }
});

export default router;