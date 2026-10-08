import { referralCodeForUserId } from "../../src/lib/daily007-compat-extra-validation";

type SignupUser = {
  id: string;
  name: string;
  email: string;
  role: "user" | "tournament_admin" | "admin";
  wallet_coins: number;
  phone: string | null;
  game_uid: string | null;
  status: "active" | "blocked";
  auth_version: number;
  password_salt: string;
  password_hash: string;
  referral_code: string | null;
  clerk_user_id: string | null;
};

type SignupLedgerEntry = {
  id: string;
  user_id: string;
  amount: number;
  balance_after: number;
  reason: string;
  idempotency_key: string;
  details: Record<string, unknown>;
  created_at: Date;
};

type SignupReferral = {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  code: string;
};

type UndoAction = () => void;
type RecordUndoAction = (undo: UndoAction) => void;

type AdvisoryLockBarrier = {
  expectedArrivals: number;
  arrivals: number;
  promise: Promise<void>;
  release: () => void;
  timeout: ReturnType<typeof setTimeout>;
};

type AuthVersionUpdatePause = {
  reached: Promise<void>;
  markReached: () => void;
  resume: Promise<void>;
  release: () => void;
  claimed: boolean;
};

type ReferralRewardLedgerFailurePause = {
  reached: Promise<void>;
  markReached: () => void;
  resume: Promise<void>;
  release: () => void;
  claimed: boolean;
};

export const SIGNUP_TEST_REFERRAL_CODE = "ABCDE";
const REFERRER_ID = "40000000-0000-4000-8000-000000000001";
const UNKNOWN_REFERRER_ID = "40000000-0000-4000-8000-000000000099";
export const SIGNUP_TEST_LEGACY_REFERRAL_CODE = referralCodeForUserId(REFERRER_ID);
export const SIGNUP_TEST_UNKNOWN_LEGACY_REFERRAL_CODE = referralCodeForUserId(UNKNOWN_REFERRER_ID);

function userIdFor(sequence: number): string {
  return `40000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function duplicateError(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: "23505" });
}

class MemorySignupDatabase {
  users = new Map<string, SignupUser>();
  shortCodesByUser = new Map<string, string>();
  shortCodeOwners = new Map<string, string>();
  legacyCodeOwners = new Map<string, string>();
  referrals: SignupReferral[] = [];
  ledger: SignupLedgerEntry[] = [];
  referralSignupRewardLedgerFailureContext: {
    accountExists: boolean;
    referralExists: boolean;
    walletCoins: number | null;
  } | null = null;
  failedReferralSignupRewardUserId: string | null = null;
  welcomeSignupRewardLedgerFailureContext: {
    accountExists: boolean;
    legacyCodeExists: boolean;
    shortCodeExists: boolean;
    walletCoins: number | null;
  } | null = null;
  referralCodeInsertFailureContext: {
    accountExists: boolean;
    legacyCodeExists: boolean;
    shortCodeExists: boolean;
  } | null = null;
  private nextUserId = 2;
  private nextLedgerId = 1;
  private nextReferralId = 1;
  private advisoryLockTails = new Map<string, Promise<void>>();
  private advisoryLockBarrier: AdvisoryLockBarrier | null = null;
  private authVersionUpdatePause: AuthVersionUpdatePause | null = null;
  private referralRewardLedgerFailurePause: ReferralRewardLedgerFailurePause | null = null;
  advisoryLockWaitCount = 0;
  get activeAdvisoryLockCount(): number {
    return this.advisoryLockTails.size;
  }
  private shouldFailNextWelcomeSignupRewardLedgerWrite = false;
  private shouldFailNextReferralSignupRewardLedgerWrite = false;
  private shouldFailNextReferralShortCodeInsert = false;

  reset(): void {
    this.advisoryLockBarrier?.release();
    this.authVersionUpdatePause?.release();
    this.referralRewardLedgerFailurePause?.release();
    const referrer: SignupUser = {
      id: REFERRER_ID,
      name: "Referral Test Owner",
      email: "referrer@example.test",
      role: "user",
      wallet_coins: 0,
      phone: null,
      game_uid: null,
      status: "active",
      auth_version: 0,
      password_salt: "",
      password_hash: "",
      referral_code: null,
      clerk_user_id: null,
    };
    this.users = new Map([[referrer.id, referrer]]);
    this.shortCodesByUser = new Map([[referrer.id, SIGNUP_TEST_REFERRAL_CODE]]);
    this.shortCodeOwners = new Map([[SIGNUP_TEST_REFERRAL_CODE, referrer.id]]);
    this.legacyCodeOwners = new Map([[SIGNUP_TEST_LEGACY_REFERRAL_CODE, referrer.id]]);
    this.referrals = [];
    this.ledger = [];
    this.referralSignupRewardLedgerFailureContext = null;
    this.failedReferralSignupRewardUserId = null;
    this.welcomeSignupRewardLedgerFailureContext = null;
    this.referralCodeInsertFailureContext = null;
    this.shouldFailNextWelcomeSignupRewardLedgerWrite = false;
    this.shouldFailNextReferralSignupRewardLedgerWrite = false;
    this.shouldFailNextReferralShortCodeInsert = false;
    this.nextUserId = 2;
    this.nextLedgerId = 1;
    this.nextReferralId = 1;
    this.advisoryLockTails.clear();
    this.advisoryLockWaitCount = 0;
    this.authVersionUpdatePause = null;
    this.referralRewardLedgerFailurePause = null;
  }

  synchronizeNextAdvisoryLockQueries(expectedArrivals: number): void {
    if (!Number.isInteger(expectedArrivals) || expectedArrivals < 1) {
      throw new Error("Advisory lock synchronization requires a positive integer.");
    }
    this.advisoryLockBarrier?.release();

    let resolveBarrier!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveBarrier = resolve;
    });
    let barrier!: AdvisoryLockBarrier;
    barrier = {
      expectedArrivals,
      arrivals: 0,
      promise,
      release: () => {
        clearTimeout(barrier.timeout);
        if (this.advisoryLockBarrier === barrier) this.advisoryLockBarrier = null;
        resolveBarrier();
      },
      timeout: setTimeout(() => barrier.release(), 2_000),
    };
    this.advisoryLockBarrier = barrier;
  }

  pauseNextAuthVersionUpdate(): {
    reached: Promise<void>;
    release: () => void;
  } {
    this.authVersionUpdatePause?.release();

    let markReached!: () => void;
    const reached = new Promise<void>((resolve) => {
      markReached = resolve;
    });
    let resumeUpdate!: () => void;
    const resume = new Promise<void>((resolve) => {
      resumeUpdate = resolve;
    });

    let pause!: AuthVersionUpdatePause;
    pause = {
      reached,
      markReached,
      resume,
      claimed: false,
      release: () => {
        resumeUpdate();
        if (this.authVersionUpdatePause === pause) {
          this.authVersionUpdatePause = null;
        }
      },
    };
    this.authVersionUpdatePause = pause;
    return { reached, release: () => pause.release() };
  }

  failNextReferralSignupRewardLedgerWrite(): void {
    this.referralSignupRewardLedgerFailureContext = null;
    this.failedReferralSignupRewardUserId = null;
    this.shouldFailNextReferralSignupRewardLedgerWrite = true;
  }

  pauseNextReferralSignupRewardLedgerFailure(): {
    reached: Promise<void>;
    release: () => void;
  } {
    this.referralRewardLedgerFailurePause?.release();

    let markReached!: () => void;
    const reached = new Promise<void>((resolve) => {
      markReached = resolve;
    });
    let resumeFailure!: () => void;
    const resume = new Promise<void>((resolve) => {
      resumeFailure = resolve;
    });
    let pause!: ReferralRewardLedgerFailurePause;
    pause = {
      reached,
      markReached,
      resume,
      claimed: false,
      release: () => {
        resumeFailure();
        if (this.referralRewardLedgerFailurePause === pause) {
          this.referralRewardLedgerFailurePause = null;
        }
      },
    };
    this.referralRewardLedgerFailurePause = pause;
    return { reached, release: () => pause.release() };
  }

  failNextWelcomeSignupRewardLedgerWrite(): void {
    this.welcomeSignupRewardLedgerFailureContext = null;
    this.shouldFailNextWelcomeSignupRewardLedgerWrite = true;
  }

  failNextReferralShortCodeInsert(): void {
    this.referralCodeInsertFailureContext = null;
    this.shouldFailNextReferralShortCodeInsert = true;
  }

  private async acquireAdvisoryTransactionLock(key: string): Promise<() => void> {
    const previous = this.advisoryLockTails.get(key);
    if (previous) this.advisoryLockWaitCount += 1;

    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    this.advisoryLockTails.set(key, current);
    if (previous) await previous;

    return () => {
      releaseCurrent();
      if (this.advisoryLockTails.get(key) === current) {
        this.advisoryLockTails.delete(key);
      }
    };
  }

  private async waitForAdvisoryLockBarrier(): Promise<void> {
    const barrier = this.advisoryLockBarrier;
    if (!barrier) return;
    barrier.arrivals += 1;
    if (barrier.arrivals >= barrier.expectedArrivals) barrier.release();
    await barrier.promise;
  }

  async connect() {
    let transactionActive = false;
    let transactionUndo: UndoAction[] = [];
    const transactionLockReleases: (() => void)[] = [];
    const releaseTransactionLocks = () => {
      for (const release of transactionLockReleases.splice(0).reverse()) release();
    };
    return {
      query: async <T = unknown>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized === "BEGIN") {
          transactionActive = true;
          transactionUndo = [];
          return { rows: [] as T[] };
        }
        if (normalized === "COMMIT") {
          transactionActive = false;
          transactionUndo = [];
          releaseTransactionLocks();
          return { rows: [] as T[] };
        }
        if (normalized === "ROLLBACK") {
          if (transactionActive) {
            for (const undo of transactionUndo.reverse()) undo();
          }
          transactionActive = false;
          transactionUndo = [];
          releaseTransactionLocks();
          return { rows: [] as T[] };
        }
        if (normalized.startsWith("SELECT pg_advisory_xact_lock(")) {
          await this.waitForAdvisoryLockBarrier();
          const releaseLock = await this.acquireAdvisoryTransactionLock(
            String(values[0] ?? ""),
          );
          transactionLockReleases.push(releaseLock);
          return { rows: [] as T[] };
        }
        const recordUndo = transactionActive
          ? (undo: UndoAction) => transactionUndo.push(undo)
          : undefined;
        return this.query<T>(normalized, values, recordUndo);
      },
      release: releaseTransactionLocks,
    };
  }

  async query<T = unknown>(
    sql: string,
    values: unknown[] = [],
    recordUndo?: RecordUndoAction,
  ): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, " ").trim();
    const first = String(values[0] ?? "");
    let rows: unknown[] = [];

    if (normalized.startsWith("INSERT INTO daily007_v2_users")) {
      const googleSignup = normalized.includes(
        "(name, email, password_salt, password_hash, referral_code, clerk_user_id)",
      );
      const [name, email, passwordSalt, passwordHash, phone, gameUid, referralCode, clerkUserId] =
        googleSignup
          ? [values[0], values[1], values[2], values[3], null, null, values[4], values[5]]
          : [values[0], values[1], values[2], values[3], values[4], values[5], values[6], null];
      if ([...this.users.values()].some((user) => user.email === email)) {
        throw duplicateError("duplicate signup email");
      }
      const user: SignupUser = {
        id: userIdFor(this.nextUserId++),
        name: String(name),
        email: String(email),
        role: "user",
        wallet_coins: 0,
        phone: phone == null ? null : String(phone),
        game_uid: gameUid == null ? null : String(gameUid),
        status: "active",
        auth_version: 0,
        password_salt: String(passwordSalt),
        password_hash: String(passwordHash),
        referral_code: referralCode == null ? null : String(referralCode),
        clerk_user_id: clerkUserId == null ? null : String(clerkUserId),
      };
      this.users.set(user.id, user);
      recordUndo?.(() => {
        if (this.users.get(user.id) === user) this.users.delete(user.id);
      });
      rows = [this.accountRow(user)];
    } else if (normalized.startsWith("SELECT pg_advisory_xact_lock(")) {
      rows = [];
    } else if (
      normalized.startsWith(
        "SELECT id, name, email, role, wallet_coins, status, clerk_user_id, auth_version FROM daily007_v2_users WHERE clerk_user_id = $1",
      )
    ) {
      const user = [...this.users.values()].find((entry) => entry.clerk_user_id === first);
      rows = user ? [this.accountRow(user)] : [];
    } else if (normalized.startsWith(
      "SELECT id, name, email, role, wallet_coins, status, clerk_user_id, auth_version FROM daily007_v2_users WHERE id = $1",
    )) {
      const user = this.users.get(first);
      rows = user ? [this.accountRow(user)] : [];
    } else if (normalized.startsWith("SELECT id FROM daily007_v2_users WHERE email = $1")) {
      const user = [...this.users.values()].find((entry) => entry.email === first);
      rows = user ? [{ id: user.id }] : [];
    } else if (normalized.startsWith(
      "UPDATE daily007_v2_users SET clerk_user_id = $2 WHERE id = $1 AND clerk_user_id IS NULL",
    )) {
      const user = this.users.get(first);
      if (user && !user.clerk_user_id) {
        const previousClerkUserId = user.clerk_user_id;
        user.clerk_user_id = String(values[1]);
        recordUndo?.(() => {
          if (user.clerk_user_id === String(values[1])) {
            user.clerk_user_id = previousClerkUserId;
          }
        });
        rows = [this.accountRow(user)];
      }
    } else if (normalized.startsWith(
      "SELECT clerk_user_id IS NOT NULL AS google_linked FROM daily007_v2_users WHERE id = $1",
    )) {
      const user = this.users.get(first);
      rows = user ? [{ google_linked: user.clerk_user_id !== null }] : [];
    } else if (normalized.startsWith(
      "SELECT id, name, email, role, wallet_coins, phone, game_uid, status, auth_version FROM daily007_v2_users",
    )) {
      const user = this.users.get(first);
      rows = user ? [this.accountRow(user)] : [];
    } else if (normalized.startsWith("SELECT role FROM daily007_v2_users WHERE id = $1 FOR UPDATE")) {
      const user = this.users.get(first);
      rows = user ? [{ role: user.role }] : [];
    } else if (normalized.startsWith(
      "SELECT count(*)::text AS count FROM daily007_v2_users WHERE role = 'admin'",
    )) {
      rows = [{ count: String([...this.users.values()].filter((user) => user.role === "admin").length) }];
    } else if (normalized.startsWith(
      "UPDATE daily007_v2_users SET role = $2 WHERE id = $1 RETURNING id, role",
    )) {
      const user = this.users.get(first);
      if (user) {
        const previousRole = user.role;
        user.role = values[1] as SignupUser["role"];
        recordUndo?.(() => {
          if (user.role === values[1]) user.role = previousRole;
        });
        rows = [{ id: user.id, role: user.role }];
      }
    } else if (normalized.startsWith(
      "SELECT id, name, email, role, wallet_coins, phone, game_uid, status, password_salt, password_hash FROM daily007_v2_users",
    )) {
      const user = [...this.users.values()].find((entry) => entry.email === first);
      rows = user ? [{
        ...this.accountRow(user),
        password_salt: user.password_salt,
        password_hash: user.password_hash,
      }] : [];
    } else if (normalized.startsWith(
      "SELECT id, name, email, phone, game_uid, role, status, wallet_coins, password_salt, password_hash FROM daily007_v2_users",
    )) {
      const user = [...this.users.values()].find((entry) => entry.email === first);
      rows = user ? [{
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        game_uid: user.game_uid,
        role: user.role,
        status: user.status,
        wallet_coins: user.wallet_coins,
        password_salt: user.password_salt,
        password_hash: user.password_hash,
      }] : [];
    } else if (normalized.startsWith(
      "INSERT INTO daily007_v2_referral_codes (user_id, code)",
    )) {
      const [userId, code] = values.map(String);
      if (!this.legacyCodeOwners.has(code)) {
        this.legacyCodeOwners.set(code, userId);
        recordUndo?.(() => {
          if (this.legacyCodeOwners.get(code) === userId) {
            this.legacyCodeOwners.delete(code);
          }
        });
      }
    } else if (normalized.startsWith(
      "INSERT INTO daily007_v2_referral_short_codes (user_id, code)",
    )) {
      const [userId, code] = values.map(String);
      if (this.shouldFailNextReferralShortCodeInsert) {
        this.referralCodeInsertFailureContext = {
          accountExists: this.users.has(userId),
          legacyCodeExists: [...this.legacyCodeOwners.values()].includes(userId),
          shortCodeExists: this.shortCodesByUser.has(userId),
        };
        this.shouldFailNextReferralShortCodeInsert = false;
        throw new Error("Simulated referral short-code write failure.");
      }
      if (!this.shortCodesByUser.has(userId) && !this.shortCodeOwners.has(code)) {
        this.shortCodesByUser.set(userId, code);
        this.shortCodeOwners.set(code, userId);
        recordUndo?.(() => {
          if (this.shortCodesByUser.get(userId) === code) {
            this.shortCodesByUser.delete(userId);
          }
          if (this.shortCodeOwners.get(code) === userId) {
            this.shortCodeOwners.delete(code);
          }
        });
      }
    } else if (normalized.startsWith(
      "SELECT code FROM daily007_v2_referral_short_codes WHERE user_id = $1",
    )) {
      const code = this.shortCodesByUser.get(first);
      rows = code ? [{ code }] : [];
    } else if (normalized.startsWith(
      "SELECT user_id FROM daily007_v2_referral_short_codes WHERE code = $1",
    )) {
      const userId = this.shortCodeOwners.get(first);
      rows = userId ? [{ user_id: userId }] : [];
    } else if (normalized.startsWith(
      "SELECT user_id FROM daily007_v2_referral_codes WHERE code = $1",
    )) {
      const userId = this.legacyCodeOwners.get(first);
      rows = userId ? [{ user_id: userId }] : [];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_referrals")) {
      const [referrerUserId, referredUserId, code] = values.map(String);
      const referral = {
        id: userIdFor(1000 + this.nextReferralId++),
        referrer_user_id: referrerUserId,
        referred_user_id: referredUserId,
        code,
      };
      this.referrals.push(referral);
      recordUndo?.(() => {
        const referralIndex = this.referrals.findIndex((item) => item.id === referral.id);
        if (referralIndex !== -1) this.referrals.splice(referralIndex, 1);
      });
      rows = [{ id: referral.id }];
    } else if (normalized.startsWith("SELECT wallet_coins FROM daily007_v2_users")) {
      const user = this.users.get(first);
      rows = user ? [{ wallet_coins: user.wallet_coins }] : [];
    } else if (normalized.startsWith(
      "SELECT id FROM daily007_v2_wallet_ledger WHERE idempotency_key = $1",
    )) {
      const entry = this.ledger.find((item) => item.idempotency_key === first);
      rows = entry ? [{ id: entry.id }] : [];
    } else if (normalized.startsWith("UPDATE daily007_v2_users SET wallet_coins")) {
      const user = this.users.get(first);
      if (!user) throw new Error(`Signup test user not found for wallet update: ${first}`);
      const previousWalletCoins = user.wallet_coins;
      const updatedWalletCoins = Number(values[1]);
      user.wallet_coins = updatedWalletCoins;
      recordUndo?.(() => {
        if (user.wallet_coins === updatedWalletCoins) {
          user.wallet_coins = previousWalletCoins;
        }
      });
    } else if (normalized.startsWith("INSERT INTO daily007_v2_wallet_ledger")) {
      const [userId, amount, balanceAfter, idempotencyKey, details] = values;
      if (this.ledger.some((item) => item.idempotency_key === idempotencyKey)) {
        throw duplicateError("duplicate wallet ledger idempotency key");
      }
      const reason = normalized.match(/VALUES \(\$1, \$2, \$3, '([^']+)'/)?.[1];
      if (!reason) throw new Error(`Unexpected signup ledger insert: ${normalized}`);
      if (reason === "Welcome Signup Bonus" && this.shouldFailNextWelcomeSignupRewardLedgerWrite) {
        const signupUserId = String(userId);
        const signupUser = this.users.get(signupUserId);
        this.welcomeSignupRewardLedgerFailureContext = {
          accountExists: Boolean(signupUser),
          legacyCodeExists: [...this.legacyCodeOwners.values()].includes(signupUserId),
          shortCodeExists: this.shortCodesByUser.has(signupUserId),
          walletCoins: signupUser?.wallet_coins ?? null,
        };
        this.shouldFailNextWelcomeSignupRewardLedgerWrite = false;
        throw new Error("Simulated welcome signup reward ledger write failure.");
      }
      if (reason === "Referral Signup Bonus" && this.shouldFailNextReferralSignupRewardLedgerWrite) {
        const referredUserId = String(userId);
        const referredUser = this.users.get(referredUserId);
        this.referralSignupRewardLedgerFailureContext = {
          accountExists: Boolean(referredUser),
          referralExists: this.referrals.some(
            (referral) => referral.referred_user_id === referredUserId,
          ),
          walletCoins: referredUser?.wallet_coins ?? null,
        };
        this.failedReferralSignupRewardUserId = referredUserId;
        this.shouldFailNextReferralSignupRewardLedgerWrite = false;
        const pause = this.referralRewardLedgerFailurePause;
        if (pause && !pause.claimed) {
          pause.claimed = true;
          pause.markReached();
          await pause.resume;
        }
        throw new Error("Simulated referral signup reward ledger write failure.");
      }
      const entry: SignupLedgerEntry = {
        id: `signup-ledger-${this.nextLedgerId++}`,
        user_id: String(userId),
        amount: Number(amount),
        balance_after: Number(balanceAfter),
        reason,
        idempotency_key: String(idempotencyKey),
        details: details && typeof details === "object" ? structuredClone(details as Record<string, unknown>) : {},
        created_at: new Date(this.nextLedgerId),
      };
      this.ledger.push(entry);
      recordUndo?.(() => {
        const ledgerIndex = this.ledger.findIndex((item) => item.id === entry.id);
        if (ledgerIndex !== -1) this.ledger.splice(ledgerIndex, 1);
      });
    } else if (normalized.startsWith("UPDATE daily007_v2_users SET auth_version = auth_version + 1")) {
      const pause = this.authVersionUpdatePause;
      if (pause && !pause.claimed) {
        pause.claimed = true;
        pause.markReached();
        await pause.resume;
      }
      const user = this.users.get(first);
      const statusGuarded = /\bAND\s+status\s*=\s*'active'/i.test(normalized);
      if (user && (!statusGuarded || user.status === "active")) {
        const previousAuthVersion = user.auth_version;
        user.auth_version += 1;
        recordUndo?.(() => {
          if (user.auth_version === previousAuthVersion + 1) {
            user.auth_version = previousAuthVersion;
          }
        });
        rows = [{ auth_version: user.auth_version }];
      }
    } else if (normalized.startsWith(
      `SELECT id, id AS "$id", name, email, phone, game_uid AS "gameUid", role, status, wallet_coins AS coins, created_at AS "createdAt" FROM daily007_v2_users`,
    )) {
      rows = [...this.users.values()].map((user) => ({
        id: user.id,
        $id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        gameUid: user.game_uid,
        role: user.role,
        status: user.status,
        coins: user.wallet_coins,
        createdAt: new Date(0),
      }));
    } else if (
      normalized.startsWith(
        'SELECT ledger.id, ledger.amount, ledger.balance_after AS "balanceAfter", ledger.reason, ledger.details,',
      ) &&
      normalized.includes("FROM daily007_v2_wallet_ledger ledger") &&
      normalized.includes(
        "WHERE ledger.user_id = $1 ORDER BY ledger.created_at DESC LIMIT 500",
      )
    ) {
      rows = this.ledger
        .filter((entry) => entry.user_id === first)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, 500)
        .map((entry) => ({
          id: entry.id,
          amount: entry.amount,
          balanceAfter: entry.balance_after,
          reason: entry.reason,
          details: structuredClone(entry.details),
          createdAt: entry.created_at,
          matchId: null,
          tournamentTitle: null,
        }));
    } else if (normalized.startsWith(
      "SELECT id, amount, balance_after AS \"balanceAfter\", reason, details,",
    ) && normalized.includes("FROM daily007_v2_wallet_ledger WHERE user_id = $1")) {
      rows = this.ledger
        .filter((entry) => entry.user_id === first)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .map((entry) => ({
          id: entry.id,
          amount: entry.amount,
          balanceAfter: entry.balance_after,
          reason: entry.reason,
          details: structuredClone(entry.details),
          createdAt: entry.created_at,
        }));
    } else {
      throw new Error(`Unexpected signup test SQL: ${normalized}`);
    }

    return { rows: rows as T[] };
  }

  private accountRow(user: SignupUser) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      wallet_coins: user.wallet_coins,
      phone: user.phone,
      game_uid: user.game_uid,
      status: user.status,
      auth_version: user.auth_version,
      clerk_user_id: user.clerk_user_id,
    };
  }
}

export const signupTestDb = new MemorySignupDatabase();
signupTestDb.reset();

export const pool = {
  query: <T = unknown>(sql: string, values?: unknown[]) => signupTestDb.query<T>(sql, values),
  connect: () => signupTestDb.connect(),
};