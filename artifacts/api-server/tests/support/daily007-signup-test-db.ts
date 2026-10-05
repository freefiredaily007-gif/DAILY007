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

type Snapshot = {
  users: Map<string, SignupUser>;
  shortCodesByUser: Map<string, string>;
  shortCodeOwners: Map<string, string>;
  legacyCodeOwners: Map<string, string>;
  referrals: SignupReferral[];
  ledger: SignupLedgerEntry[];
  nextUserId: number;
  nextLedgerId: number;
  nextReferralId: number;
};

export const SIGNUP_TEST_REFERRAL_CODE = "ABCDE";
const REFERRER_ID = "40000000-0000-4000-8000-000000000001";
export const SIGNUP_TEST_LEGACY_REFERRAL_CODE = referralCodeForUserId(REFERRER_ID);

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map([...source].map(([key, value]) => [key, structuredClone(value)]));
}

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
  private nextUserId = 2;
  private nextLedgerId = 1;
  private nextReferralId = 1;
  private shouldFailNextReferralSignupRewardLedgerWrite = false;

  reset(): void {
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
    this.shouldFailNextReferralSignupRewardLedgerWrite = false;
    this.nextUserId = 2;
    this.nextLedgerId = 1;
    this.nextReferralId = 1;
  }

  failNextReferralSignupRewardLedgerWrite(): void {
    this.referralSignupRewardLedgerFailureContext = null;
    this.shouldFailNextReferralSignupRewardLedgerWrite = true;
  }

  private snapshot(): Snapshot {
    return {
      users: cloneMap(this.users),
      shortCodesByUser: cloneMap(this.shortCodesByUser),
      shortCodeOwners: cloneMap(this.shortCodeOwners),
      legacyCodeOwners: cloneMap(this.legacyCodeOwners),
      referrals: structuredClone(this.referrals),
      ledger: structuredClone(this.ledger),
      nextUserId: this.nextUserId,
      nextLedgerId: this.nextLedgerId,
      nextReferralId: this.nextReferralId,
    };
  }

  private restore(snapshot: Snapshot): void {
    this.users = snapshot.users;
    this.shortCodesByUser = snapshot.shortCodesByUser;
    this.shortCodeOwners = snapshot.shortCodeOwners;
    this.legacyCodeOwners = snapshot.legacyCodeOwners;
    this.referrals = snapshot.referrals;
    this.ledger = snapshot.ledger;
    this.nextUserId = snapshot.nextUserId;
    this.nextLedgerId = snapshot.nextLedgerId;
    this.nextReferralId = snapshot.nextReferralId;
  }

  async connect() {
    let transactionSnapshot: Snapshot | null = null;
    return {
      query: async <T = unknown>(sql: string, values: unknown[] = []) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized === "BEGIN") {
          transactionSnapshot = this.snapshot();
          return { rows: [] as T[] };
        }
        if (normalized === "COMMIT") {
          transactionSnapshot = null;
          return { rows: [] as T[] };
        }
        if (normalized === "ROLLBACK") {
          if (transactionSnapshot) this.restore(transactionSnapshot);
          transactionSnapshot = null;
          return { rows: [] as T[] };
        }
        return this.query<T>(normalized, values);
      },
      release: () => {},
    };
  }

  async query<T = unknown>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
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
        user.clerk_user_id = String(values[1]);
        rows = [this.accountRow(user)];
      }
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
        user.role = values[1] as SignupUser["role"];
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
      if (!this.legacyCodeOwners.has(code)) this.legacyCodeOwners.set(code, userId);
    } else if (normalized.startsWith(
      "INSERT INTO daily007_v2_referral_short_codes (user_id, code)",
    )) {
      const [userId, code] = values.map(String);
      if (!this.shortCodesByUser.has(userId) && !this.shortCodeOwners.has(code)) {
        this.shortCodesByUser.set(userId, code);
        this.shortCodeOwners.set(code, userId);
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
      user.wallet_coins = Number(values[1]);
    } else if (normalized.startsWith("INSERT INTO daily007_v2_wallet_ledger")) {
      const [userId, amount, balanceAfter, idempotencyKey, details] = values;
      if (this.ledger.some((item) => item.idempotency_key === idempotencyKey)) {
        throw duplicateError("duplicate wallet ledger idempotency key");
      }
      const reason = normalized.match(/VALUES \(\$1, \$2, \$3, '([^']+)'/)?.[1];
      if (!reason) throw new Error(`Unexpected signup ledger insert: ${normalized}`);
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
        this.shouldFailNextReferralSignupRewardLedgerWrite = false;
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
    } else if (normalized.startsWith("UPDATE daily007_v2_users SET auth_version = auth_version + 1")) {
      const user = this.users.get(first);
      if (user?.status === "active") {
        user.auth_version += 1;
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