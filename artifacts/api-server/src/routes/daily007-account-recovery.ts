import { clerkClient, getAuth } from "@clerk/express";
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { verifiedGoogleIdentity, type GoogleIdentity } from "../lib/daily007-google-auth-validation";
import { isOwnerRecoveryCodeConfigured, ownerRecoveryCodeMatches } from "../lib/daily007-owner-recovery-code";
import {
  cleanRecoveryReviewNote,
  isEligibleForGoogleRecoveryApproval,
  isEligibleForGoogleOwnerRecovery,
  isEligibleForGoogleRecoveryRequest,
} from "../lib/daily007-account-recovery-policy";
import { authenticate, requireAdmin, withDaily007RoleTransaction } from "./daily007-v2";

const router: IRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Client = {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
  release(): void;
};

type RecoveryRow = {
  id: string;
  user_id: string;
  google_clerk_user_id: string;
  google_email: string;
  status: string;
  account_email: string;
  account_status: string;
  account_clerk_user_id: string | null;
};

type OwnerRecoveryAttemptWindow = {
  attempts: number;
  expiresAt: number;
};

const ownerRecoveryAttempts = new Map<string, OwnerRecoveryAttemptWindow>();
const OWNER_RECOVERY_ATTEMPT_LIMIT = 5;
const OWNER_RECOVERY_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const OWNER_RECOVERY_AUDIT_NOTE =
  "Sole Full Admin recovery authorized with the workspace owner code and a verified matching Google identity.";

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function ownerRecoveryAttemptAllowed(clerkUserId: string): boolean {
  const now = Date.now();
  const current = ownerRecoveryAttempts.get(clerkUserId);
  if (current && current.expiresAt > now) {
    return current.attempts < OWNER_RECOVERY_ATTEMPT_LIMIT;
  }
  ownerRecoveryAttempts.delete(clerkUserId);
  return true;
}

function recordOwnerRecoveryFailure(clerkUserId: string): void {
  const now = Date.now();
  const current = ownerRecoveryAttempts.get(clerkUserId);
  const next = current && current.expiresAt > now
    ? { attempts: current.attempts + 1, expiresAt: current.expiresAt }
    : { attempts: 1, expiresAt: now + OWNER_RECOVERY_ATTEMPT_WINDOW_MS };
  ownerRecoveryAttempts.set(clerkUserId, next);

  if (ownerRecoveryAttempts.size > 1000) {
    for (const [id, window] of ownerRecoveryAttempts) {
      if (window.expiresAt <= now) ownerRecoveryAttempts.delete(id);
    }
  }
}

async function transaction<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect() as unknown as Client;
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function googleIdentityForClerkUser(clerkUserId: string): Promise<GoogleIdentity | null> {
  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  return verifiedGoogleIdentity(clerkUser);
}

// This endpoint never creates or links an account. It returns the same response
// whether or not a matching, unlinked account is eligible for review.
router.post("/auth/google/recovery-request", async (req, res): Promise<void> => {
  if (!/^Bearer\s+\S+$/i.test(req.get("authorization") ?? "")) {
    fail(res, 401, "A valid Clerk bearer session is required.");
    return;
  }

  const clerkUserId = getAuth(req).userId;
  if (!clerkUserId) {
    fail(res, 401, "A valid Clerk session is required.");
    return;
  }

  let identity: GoogleIdentity | null;
  try {
    identity = await googleIdentityForClerkUser(clerkUserId);
  } catch {
    fail(res, 503, "Unable to verify the Google identity. Please try again.");
    return;
  }
  if (!identity) {
    fail(res, 403, "A verified Google identity is required.");
    return;
  }

  await transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0)), pg_advisory_xact_lock(hashtextextended($2, 0))",
      [identity!.email, `clerk:${identity!.clerkUserId}`],
    );
    const accountResult = await client.query<{
      id: string;
      email: string;
      status: string;
      clerk_user_id: string | null;
    }>(
      `SELECT id, email, status, clerk_user_id
         FROM daily007_v2_users
        WHERE lower(email) = $1
        FOR UPDATE`,
      [identity!.email],
    );
    const account = accountResult.rows[0];
    const eligible = isEligibleForGoogleRecoveryRequest(account ? {
      id: account.id,
      email: account.email,
      status: account.status,
      clerkUserId: account.clerk_user_id,
    } : null, identity!);
    if (!eligible) return;

    const alreadyLinked = await client.query<{ id: string }>(
      "SELECT id FROM daily007_v2_users WHERE clerk_user_id = $1 FOR UPDATE",
      [identity!.clerkUserId],
    );
    if (alreadyLinked.rows.length) return;

    const pending = await client.query<{ google_clerk_user_id: string }>(
      `SELECT google_clerk_user_id
         FROM daily007_v2_google_recovery_requests
        WHERE (user_id = $1 OR google_clerk_user_id = $2) AND status = 'pending'
        FOR UPDATE`,
      [account.id, identity!.clerkUserId],
    );
    if (pending.rows.length) return;

    await client.query(
      `INSERT INTO daily007_v2_google_recovery_requests
         (user_id, google_clerk_user_id, google_email)
       VALUES ($1, $2, $3)`,
      [account.id, identity!.clerkUserId, identity!.email],
    );
  });

  res.status(202).json({
    message: "If an eligible account exists, a Full Admin will review the request.",
  });
});

router.post("/auth/google/recovery-owner", async (req, res): Promise<void> => {
  if (!/^Bearer\s+\S+$/i.test(req.get("authorization") ?? "")) {
    fail(res, 401, "A valid Clerk bearer session is required.");
    return;
  }

  const clerkUserId = getAuth(req).userId;
  if (!clerkUserId) {
    fail(res, 401, "A valid Clerk session is required.");
    return;
  }

  let identity: GoogleIdentity | null;
  try {
    identity = await googleIdentityForClerkUser(clerkUserId);
  } catch {
    fail(res, 503, "Unable to verify the Google identity. Please try again.");
    return;
  }
  if (!identity) {
    fail(res, 403, "A verified Google identity is required.");
    return;
  }

  const configuredCode = process.env.DAILY007_OWNER_RECOVERY_CODE;
  if (!isOwnerRecoveryCodeConfigured(configuredCode)) {
    fail(res, 503, "Owner recovery is not configured. Ask the workspace owner to configure its recovery code.");
    return;
  }
  if (!ownerRecoveryAttemptAllowed(clerkUserId)) {
    fail(res, 429, "Too many owner recovery attempts. Wait 15 minutes before trying again.");
    return;
  }

  const body = req.body as Record<string, unknown> | null;
  const suppliedCode = body && typeof body === "object" ? body.ownerRecoveryCode : undefined;
  if (!ownerRecoveryCodeMatches(suppliedCode, configuredCode)) {
    recordOwnerRecoveryFailure(clerkUserId);
    fail(res, 403, "The owner recovery code was not accepted.");
    return;
  }
  ownerRecoveryAttempts.delete(clerkUserId);

  const outcome = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [identity!.email]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`clerk:${identity!.clerkUserId}`]);
    await client.query("SELECT pg_advisory_xact_lock(740072)");

    const accountResult = await client.query<{
      id: string;
      email: string;
      status: string;
      role: string;
      clerk_user_id: string | null;
    }>(
      `SELECT id, email, status, role, clerk_user_id
         FROM daily007_v2_users
        WHERE lower(email) = $1
        FOR UPDATE`,
      [identity!.email],
    );
    const account = accountResult.rows[0];
    const adminResult = await client.query<{ id: string }>(
      "SELECT id FROM daily007_v2_users WHERE role = 'admin' ORDER BY id FOR UPDATE",
    );
    const eligible = isEligibleForGoogleOwnerRecovery({
      account: account ? {
        id: account.id,
        email: account.email,
        status: account.status,
        role: account.role,
        clerkUserId: account.clerk_user_id,
      } : null,
      soleAdminUserIds: adminResult.rows.map((row) => row.id),
      identity,
    });
    if (!eligible) return "not-eligible" as const;

    const pending = await client.query<{ id: string; user_id: string; google_clerk_user_id: string }>(
      `SELECT id, user_id, google_clerk_user_id
         FROM daily007_v2_google_recovery_requests
        WHERE (user_id = $1 OR google_clerk_user_id = $2) AND status = 'pending'
        FOR UPDATE`,
      [account.id, identity!.clerkUserId],
    );
    if (pending.rows.some((row) =>
      row.user_id !== account.id || row.google_clerk_user_id !== identity!.clerkUserId
    )) return "not-eligible" as const;

    const linked = await client.query<{ id: string }>(
      `UPDATE daily007_v2_users
          SET clerk_user_id = $2
        WHERE id = $1 AND clerk_user_id IS NULL
        RETURNING id`,
      [account.id, identity!.clerkUserId],
    );
    if (!linked.rows.length) return "not-eligible" as const;

    const existingRequest = pending.rows[0];
    if (existingRequest) {
      await client.query(
        `UPDATE daily007_v2_google_recovery_requests
            SET status = 'approved', reviewed_at = now(), reviewed_by = $2,
                review_note = $3, review_method = 'owner_code'
          WHERE id = $1`,
        [existingRequest.id, account.id, OWNER_RECOVERY_AUDIT_NOTE],
      );
    } else {
      await client.query(
        `INSERT INTO daily007_v2_google_recovery_requests
           (user_id, google_clerk_user_id, google_email, status, reviewed_at,
            reviewed_by, review_note, review_method)
         VALUES ($1, $2, $3, 'approved', now(), $1, $4, 'owner_code')`,
        [account.id, identity!.clerkUserId, identity!.email, OWNER_RECOVERY_AUDIT_NOTE],
      );
    }

    return "recovered" as const;
  });

  if (outcome !== "recovered") {
    fail(res, 409, "Owner recovery could not be completed for this account.");
    return;
  }
  res.json({ message: "Owner recovery verified. You can now sign in with Google." });
});

router.get("/admin/account-recovery-requests", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const adminId = req.daily007Account?.id;
  if (!adminId) {
    fail(res, 401, "A valid Daily007 account is required.");
    return;
  }
  let result;
  try {
    result = await withDaily007RoleTransaction(adminId, "admin", (client) => client.query(
      `SELECT r.id, r.user_id AS "userId", r.google_email AS "googleEmail",
              r.created_at AS "createdAt",
              u.name AS "accountName", u.email AS "accountEmail",
              u.phone AS "phone", u.game_uid AS "gameUid", u.role AS "accountRole"
         FROM daily007_v2_google_recovery_requests r
         JOIN daily007_v2_users u ON u.id = r.user_id
        WHERE r.status = 'pending'
        ORDER BY r.created_at ASC`,
    ));
  } catch (cause) {
    const status = (cause as { status?: number }).status;
    if (status) {
      fail(res, status, (cause as Error).message);
      return;
    }
    throw cause;
  }
  res.json(result.rows);
});

router.post(
  "/admin/account-recovery-requests/:id/:action",
  authenticate,
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const requestId = typeof req.params.id === "string" ? req.params.id : "";
    const action = req.params.action;
    const reviewNote = cleanRecoveryReviewNote((req.body as Record<string, unknown> | null)?.reviewNote);
    if (!UUID.test(requestId) || (action !== "approve" && action !== "reject") || !reviewNote) {
      fail(res, 400, "A valid request, action, and 10–500 character review note are required.");
      return;
    }

    const reviewerId = req.daily007Account?.id;
    if (!reviewerId) {
      fail(res, 401, "A valid Daily007 account is required.");
      return;
    }

    const requestResult = await pool.query<RecoveryRow>(
      `SELECT r.id, r.user_id, r.google_clerk_user_id, r.google_email, r.status,
              u.email AS account_email, u.status AS account_status,
              u.clerk_user_id AS account_clerk_user_id
         FROM daily007_v2_google_recovery_requests r
         JOIN daily007_v2_users u ON u.id = r.user_id
        WHERE r.id = $1 AND r.status = 'pending'`,
      [requestId],
    );
    const initialRequest = requestResult.rows[0];
    if (!initialRequest) {
      fail(res, 404, "Pending recovery request not found.");
      return;
    }
    if (initialRequest.user_id === reviewerId) {
      fail(res, 409, "A different Full Admin must review this account recovery.");
      return;
    }

    let currentIdentity: GoogleIdentity | null = null;
    if (action === "approve") {
      try {
        currentIdentity = await googleIdentityForClerkUser(initialRequest.google_clerk_user_id);
      } catch {
        fail(res, 503, "Unable to re-verify the Google identity. Please try again.");
        return;
      }
      const eligible = isEligibleForGoogleRecoveryApproval({
        requestStatus: initialRequest.status,
        requestUserId: initialRequest.user_id,
        reviewerUserId: reviewerId,
        requestedClerkUserId: initialRequest.google_clerk_user_id,
        requestedEmail: initialRequest.google_email,
        account: {
          id: initialRequest.user_id,
          email: initialRequest.account_email,
          status: initialRequest.account_status,
          clerkUserId: initialRequest.account_clerk_user_id,
        },
        currentIdentity,
      });
      if (!eligible) {
        fail(res, 409, "The account or verified Google identity changed. Do not approve this request; refresh and review it again.");
        return;
      }
    }

    let result;
    try {
      result = await withDaily007RoleTransaction(reviewerId, "admin", async (client) => {
      const locked = await client.query<RecoveryRow>(
        `SELECT r.id, r.user_id, r.google_clerk_user_id, r.google_email, r.status,
                u.email AS account_email, u.status AS account_status,
                u.clerk_user_id AS account_clerk_user_id
           FROM daily007_v2_google_recovery_requests r
           JOIN daily007_v2_users u ON u.id = r.user_id
          WHERE r.id = $1
          FOR UPDATE OF r, u`,
        [requestId],
      );
      const request = locked.rows[0];
      if (!request || request.status !== "pending") return "not-pending" as const;
      if (request.user_id === reviewerId) return "self-review" as const;

      if (action === "approve") {
        const valid = isEligibleForGoogleRecoveryApproval({
          requestStatus: request.status,
          requestUserId: request.user_id,
          reviewerUserId: reviewerId,
          requestedClerkUserId: request.google_clerk_user_id,
          requestedEmail: request.google_email,
          account: {
            id: request.user_id,
            email: request.account_email,
            status: request.account_status,
            clerkUserId: request.account_clerk_user_id,
          },
          currentIdentity,
        });
        if (!valid) return "identity-changed" as const;
        if (!request.account_clerk_user_id) {
          const linked = await client.query(
            `UPDATE daily007_v2_users
                SET clerk_user_id = $2
              WHERE id = $1 AND clerk_user_id IS NULL`,
            [request.user_id, request.google_clerk_user_id],
          );
          if (!linked.rowCount) return "identity-changed" as const;
        }
      }

      await client.query(
        `UPDATE daily007_v2_google_recovery_requests
            SET status = $2, reviewed_at = now(), reviewed_by = $3, review_note = $4,
                review_method = 'full_admin'
          WHERE id = $1`,
        [requestId, action === "approve" ? "approved" : "rejected", reviewerId, reviewNote],
      );
      return "reviewed" as const;
      });
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      if (status) {
        fail(res, status, (cause as Error).message);
        return;
      }
      throw cause;
    }

    if (result === "not-pending") {
      fail(res, 409, "This recovery request has already been reviewed.");
      return;
    }
    if (result === "self-review") {
      fail(res, 409, "A different Full Admin must review this account recovery.");
      return;
    }
    if (result === "identity-changed") {
      fail(res, 409, "The account or verified Google identity changed. Do not approve this request; refresh and review it again.");
      return;
    }
    res.json({ id: requestId, status: action === "approve" ? "approved" : "rejected" });
  },
);

export default router;