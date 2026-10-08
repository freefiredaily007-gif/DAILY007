type PasswordChangeTestUser = {
  id: string;
  name: string;
  email: string;
  role: "user";
  wallet_coins: number;
  phone: string | null;
  game_uid: string | null;
  status: "active";
  auth_version: number;
  password_salt: string;
  password_hash: string;
};

type Credentials = Pick<PasswordChangeTestUser, "password_salt" | "password_hash">;
type PasswordChangeAttemptWindow = {
  windowId: string;
  failures: number;
  inFlight: number;
  expiresAt: number;
};

export const PASSWORD_CHANGE_TEST_USER_ID = "50000000-0000-4000-8000-000000000001";

class MemoryPasswordChangeDatabase {
  readonly user: PasswordChangeTestUser = {
    id: PASSWORD_CHANGE_TEST_USER_ID,
    name: "Password Change Test",
    email: "password-change@example.test",
    role: "user",
    wallet_coins: 73,
    phone: null,
    game_uid: null,
    status: "active",
    auth_version: 6,
    password_salt: "",
    password_hash: "",
  };
  credentialReadSnapshots: Credentials[] = [];
  passwordWriteAttempts = 0;
  successfulPasswordWrites = 0;
  credentialReadBarrierTimedOut = false;

  private expectedCredentialReads = 0;
  private credentialReadGate: Promise<void> | null = null;
  private releaseCredentialReadGate: (() => void) | null = null;
  private credentialReadWatchdog: ReturnType<typeof setTimeout> | null = null;
  private passwordChangeAttemptWindow: PasswordChangeAttemptWindow | null = null;

  reset(): void {
    Object.assign(this.user, {
      name: "Password Change Test",
      email: "password-change@example.test",
      role: "user" as const,
      wallet_coins: 73,
      phone: null,
      game_uid: null,
      status: "active" as const,
      auth_version: 6,
      password_salt: "",
      password_hash: "",
    });
    this.credentialReadSnapshots = [];
    this.passwordWriteAttempts = 0;
    this.successfulPasswordWrites = 0;
    this.credentialReadBarrierTimedOut = false;
    this.expectedCredentialReads = 0;
    this.credentialReadGate = null;
    this.releaseCredentialReadGate = null;
    if (this.credentialReadWatchdog) clearTimeout(this.credentialReadWatchdog);
    this.credentialReadWatchdog = null;
    this.passwordChangeAttemptWindow = null;
  }

  setCredentials(credentials: Credentials): void {
    this.user.password_salt = credentials.password_salt;
    this.user.password_hash = credentials.password_hash;
  }

  snapshot(): PasswordChangeTestUser {
    return structuredClone(this.user);
  }

  holdCredentialReadsUntil(count: number): void {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error(`Invalid credential read barrier count: ${count}`);
    }
    this.expectedCredentialReads = count;
    this.credentialReadBarrierTimedOut = false;
    this.credentialReadGate = new Promise<void>((resolve) => {
      this.releaseCredentialReadGate = resolve;
    });
    // This watchdog only fails a broken test instead of coordinating request timing.
    this.credentialReadWatchdog = setTimeout(() => {
      this.credentialReadBarrierTimedOut = true;
      this.releaseCredentialReadGate?.();
    }, 10_000);
  }

  async query<T = unknown>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, " ").trim();
    const userId = String(values[0] ?? "");

    if (normalized.startsWith("INSERT INTO daily007_password_change_attempts")) {
      const windowId = String(values[1]);
      const windowMs = Number(values[2]);
      const attemptLimit = Number(values[3]);
      const now = Date.now();
      let window = this.passwordChangeAttemptWindow;
      if (!window || window.expiresAt <= now) {
        window = { windowId, failures: 0, inFlight: 1, expiresAt: now + windowMs };
        this.passwordChangeAttemptWindow = window;
        return { rows: [{ window_id: window.windowId }] as T[] };
      }
      if (window.failures + window.inFlight >= attemptLimit) return { rows: [] };
      window.inFlight += 1;
      return { rows: [{ window_id: window.windowId }] as T[] };
    }

    if (normalized.startsWith("SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - now())))")) {
      const window = this.passwordChangeAttemptWindow;
      if (!window || window.expiresAt <= Date.now()) return { rows: [] };
      return {
        rows: [{
          retry_after_seconds: Math.max(1, Math.ceil((window.expiresAt - Date.now()) / 1000)),
        }] as T[],
      };
    }

    if (normalized.startsWith("UPDATE daily007_password_change_attempts")) {
      const windowId = String(values[1]);
      const outcome = String(values[2]);
      const windowMs = Number(values[3]);
      const window = this.passwordChangeAttemptWindow;
      if (window && window.windowId === windowId && window.expiresAt > Date.now()) {
        window.inFlight = Math.max(0, window.inFlight - 1);
        if (outcome === "incorrect") window.failures += 1;
        if (outcome === "correct") {
          window.failures = 0;
          window.expiresAt = Date.now() + windowMs;
        }
      }
      return { rows: [] };
    }

    if (normalized ===
      "SELECT id, name, email, role, wallet_coins, phone, game_uid, status, auth_version FROM daily007_v2_users WHERE id = $1") {
      return {
        rows: (userId === this.user.id ? [{
          id: this.user.id,
          name: this.user.name,
          email: this.user.email,
          role: this.user.role,
          wallet_coins: this.user.wallet_coins,
          phone: this.user.phone,
          game_uid: this.user.game_uid,
          status: this.user.status,
          auth_version: this.user.auth_version,
        }] : []) as T[],
      };
    }

    if (normalized ===
      "SELECT clerk_user_id IS NOT NULL AS google_linked FROM daily007_v2_users WHERE id = $1") {
      return {
        rows: (userId === this.user.id ? [{ google_linked: false }] : []) as T[],
      };
    }

    if (normalized === "SELECT password_salt, password_hash FROM daily007_v2_users WHERE id = $1") {
      if (userId !== this.user.id) return { rows: [] };
      const credentials = {
        password_salt: this.user.password_salt,
        password_hash: this.user.password_hash,
      };
      this.credentialReadSnapshots.push(structuredClone(credentials));
      const readGate = this.credentialReadGate;

      if (!readGate || this.expectedCredentialReads === 0) {
        throw new Error("Password credential reads must be explicitly coordinated by the test.");
      }
      if (this.credentialReadSnapshots.length > this.expectedCredentialReads) {
        throw new Error("More password credential reads occurred than the test expected.");
      }
      if (this.credentialReadSnapshots.length === this.expectedCredentialReads) {
        if (this.credentialReadWatchdog) clearTimeout(this.credentialReadWatchdog);
        this.credentialReadWatchdog = null;
        this.releaseCredentialReadGate?.();
      }
      await readGate;
      return { rows: [credentials] as T[] };
    }

    if (normalized ===
      "UPDATE daily007_v2_users SET password_salt = $2, password_hash = $3 WHERE id = $1 AND password_salt = $4 AND password_hash = $5 RETURNING id") {
      this.passwordWriteAttempts += 1;
      const [replacementSalt, replacementHash, originalSalt, originalHash] = values.slice(1).map(String);
      if (userId !== this.user.id ||
          this.user.password_salt !== originalSalt ||
          this.user.password_hash !== originalHash) {
        return { rows: [] };
      }
      this.user.password_salt = replacementSalt;
      this.user.password_hash = replacementHash;
      this.successfulPasswordWrites += 1;
      return { rows: [{ id: this.user.id }] as T[] };
    }

    throw new Error(`Unexpected password-change test SQL: ${normalized}`);
  }
}

export const passwordChangeTestDb = new MemoryPasswordChangeDatabase();
passwordChangeTestDb.reset();

export const pool = {
  query: <T = unknown>(sql: string, values?: unknown[]) =>
    passwordChangeTestDb.query<T>(sql, values),
};