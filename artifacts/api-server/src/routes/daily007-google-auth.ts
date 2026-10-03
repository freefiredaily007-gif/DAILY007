import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { pool } from "@workspace/db";
import { hashPassword, makeToken } from "./daily007-v2";
import { isSessionVersionCurrent, readSessionToken } from "../lib/daily007-session-token";
import { awardDaily007SignupBonus, ensureDaily007ReferralCode } from "../lib/daily007-referrals";
import {
  chooseGoogleAccountAction,
  verifiedGoogleIdentity,
  type GoogleIdentity,
} from "../lib/daily007-google-auth-validation";

const router: IRouter = Router();

type Account = {
  id: string;
  name: string;
  email: string;
  role: string;
  wallet_coins: number;
  status: string;
  auth_version: number;
  clerk_user_id?: string | null;
};

type SqlClient = {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

async function withTransaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect() as unknown as SqlClient;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function lookupGoogleIdentity(req: Request): Promise<GoogleIdentity | null> {
  const userId = getAuth(req).userId;
  if (!userId) return null;
  const user = await clerkClient.users.getUser(userId);
  return verifiedGoogleIdentity(user);
}

router.post("/auth/google", async (req, res): Promise<void> => {
  if (!/^Bearer\s+\S+$/i.test(req.get("authorization") ?? "")) {
    fail(res, 401, "A valid Clerk bearer session is required.");
    return;
  }
  const clerkUserId = getAuth(req).userId;
  if (!clerkUserId) {
    fail(res, 401, "A valid Clerk bearer session is required.");
    return;
  }

  let identity: GoogleIdentity | null;
  try {
    identity = await lookupGoogleIdentity(req);
  } catch {
    fail(res, 503, "Unable to verify the Google identity with Clerk. Please try again.");
    return;
  }
  if (!identity) {
    fail(res, 403, "This Clerk account must have a Google account with a verified email address.");
    return;
  }

  if (req.body !== undefined && !isRecord(req.body)) {
    fail(res, 400, "Expected an object containing an optional referralCode.");
    return;
  }
  const referralInput = isRecord(req.body) ? req.body.referralCode : undefined;
  const trimmedReferral = typeof referralInput === "string" ? referralInput.trim() : null;
  const referralCode = referralInput === undefined || referralInput === null ||
      (typeof referralInput === "string" && trimmedReferral === "")
    ? null
    : trimmedReferral && trimmedReferral.length <= 64
      ? trimmedReferral
      : undefined;
  if (referralCode === undefined) {
    fail(res, 400, "referralCode must be a string containing at most 64 characters.");
    return;
  }

  const localToken = req.get("X-Daily007-Token");
  let localTokenClaims: ReturnType<typeof readSessionToken> = null;
  if (localToken) {
    localTokenClaims = readSessionToken(localToken);
    if (!localTokenClaims) {
      fail(res, 401, "X-Daily007-Token must contain a valid Daily007 token.");
      return;
    }
  }

  if (!makeToken("00000000-0000-4000-8000-000000000000")) {
    fail(res, 503, "Daily007 authentication is not configured.");
    return;
  }
  const credentials = await hashPassword(randomBytes(64).toString("base64url"));

  try {
    const result = await withTransaction(async (client) => {
      // Serialize first-signup/link attempts for this immutable Clerk subject.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [identity.clerkUserId]);

      const linkedResult = await client.query<Account>(
        `SELECT id, name, email, role, wallet_coins, status, clerk_user_id, auth_version
           FROM daily007_v2_users WHERE clerk_user_id = $1 FOR UPDATE`,
        [identity.clerkUserId],
      );
      const linked = linkedResult.rows[0] ?? null;
      const emailOwnerResult = await client.query<{ id: string }>(
        "SELECT id FROM daily007_v2_users WHERE email = $1 FOR UPDATE",
        [identity.email],
      );
      const emailOwnerId = emailOwnerResult.rows[0]?.id ?? null;
      let localAccount: Account | null = null;
      if (localTokenClaims) {
        const localResult = await client.query<Account>(
          `SELECT id, name, email, role, wallet_coins, status, clerk_user_id, auth_version
             FROM daily007_v2_users WHERE id = $1 FOR UPDATE`,
          [localTokenClaims.userId],
        );
        localAccount = localResult.rows[0] ?? null;
        if (!localAccount) throw httpError(401, "Daily007 account not found.");
        if (!isSessionVersionCurrent(localTokenClaims.sessionVersion, localAccount.auth_version)) {
          throw httpError(401, "This Daily007 session was replaced by a newer sign-in. Sign in again.");
        }
        if (localAccount.status === "blocked") throw httpError(403, "This account is blocked.");
        if (localAccount.email.trim().toLowerCase() !== identity.email) {
          throw httpError(409, "The verified Google email must match the signed-in Daily007 account.");
        }
        if (localAccount.clerk_user_id && localAccount.clerk_user_id !== identity.clerkUserId) {
          throw httpError(409, "This Daily007 account is already linked to a different Google identity.");
        }
      }

      const action = chooseGoogleAccountAction({
        linkedUserId: linked?.id ?? null,
        linkedEmail: linked?.email ?? null,
        emailOwnerUserId: emailOwnerId,
        localTokenUserId: localAccount?.id ?? null,
        verifiedEmail: identity.email,
      });

      if (action === "linked-elsewhere") {
        throw httpError(409, "This Google identity is linked to a different Daily007 account.");
      }
      if (action === "email-mismatch") {
        throw httpError(409, "The linked Google email no longer matches this Daily007 account. Sign in with your password to resolve the account link.");
      }
      if (action === "email-conflict") {
        throw httpError(409, "An account already uses this email. Sign in with your password, then connect Google in Profile.");
      }

      let account: Account;
      let created = false;
      if (action === "existing") {
        account = linked!;
      } else if (action === "link") {
        const updated = await client.query<Account>(
          `UPDATE daily007_v2_users
              SET clerk_user_id = $2
            WHERE id = $1 AND clerk_user_id IS NULL
            RETURNING id, name, email, role, wallet_coins, status, clerk_user_id, auth_version`,
          [localAccount!.id, identity.clerkUserId],
        );
        if (!updated.rows[0]) throw httpError(409, "This account could not be linked because its identity changed concurrently.");
        account = updated.rows[0];
      } else {
        const inserted = await client.query<Account>(
          `INSERT INTO daily007_v2_users
             (name, email, password_salt, password_hash, referral_code, clerk_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, name, email, role, wallet_coins, status, clerk_user_id, auth_version`,
          [identity.name, identity.email, credentials.salt, credentials.hash, referralCode, identity.clerkUserId],
        );
        account = inserted.rows[0];
        await ensureDaily007ReferralCode(client, account.id);
        account.wallet_coins = await awardDaily007SignupBonus(client, referralCode, account.id);
        created = true;
      }

      if (account.status === "blocked") throw httpError(403, "This account is blocked.");
      let sessionVersion = account.auth_version;
      if (!localTokenClaims) {
        const rotated = await client.query<{ auth_version: number }>(
          `UPDATE daily007_v2_users
              SET auth_version = auth_version + 1
            WHERE id = $1 AND status = 'active'
            RETURNING auth_version`,
          [account.id],
        );
        if (!rotated.rows[0]) throw httpError(401, "Account could not be signed in. Please try again.");
        sessionVersion = rotated.rows[0].auth_version;
      }
      return { account, created, sessionVersion };
    });

    const accountToken = makeToken(result.account.id, result.sessionVersion);
    if (!accountToken) {
      fail(res, 503, "Daily007 authentication is not configured.");
      return;
    }
    res.status(result.created ? 201 : 200).json({
      id: result.account.id,
      name: result.account.name,
      email: result.account.email,
      coins: result.account.wallet_coins,
      role: result.account.role,
      token: accountToken,
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) {
      fail(res, status, (error as Error).message);
      return;
    }
    if ((error as { code?: string }).code === "23505") {
      fail(res, 409, "This email or Google identity is already linked to another account.");
      return;
    }
    throw error;
  }
});

export default router;