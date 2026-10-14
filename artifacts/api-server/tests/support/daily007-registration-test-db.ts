type SignupAccount = {
  id: string;
  name: string;
  email: string;
  role: "user";
  status: "active";
  wallet_coins: number;
  phone: string | null;
  game_uid: string | null;
  password_salt: string;
  password_hash: string;
};

type RegistrationState = {
  accounts: Map<string, SignupAccount>;
  shortCodes: Map<string, string>;
  ledgerKeys: Set<string>;
  nextAccountId: number;
};

function copyState(state: RegistrationState): RegistrationState {
  return {
    accounts: new Map([...state.accounts].map(([id, account]) => [id, structuredClone(account)])),
    shortCodes: new Map(state.shortCodes),
    ledgerKeys: new Set(state.ledgerKeys),
    nextAccountId: state.nextAccountId,
  };
}

function accountId(sequence: number): string {
  return `30000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

class MemoryRegistrationDatabase {
  private state: RegistrationState = {
    accounts: new Map(),
    shortCodes: new Map(),
    ledgerKeys: new Set(),
    nextAccountId: 1,
  };

  async connect() {
    let transactionSnapshot: RegistrationState | null = null;
    return {
      query: async <T = unknown>(sql: string, values: unknown[] = []) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized === "BEGIN") {
          transactionSnapshot = copyState(this.state);
          return { rows: [] as T[] };
        }
        if (normalized === "COMMIT") {
          transactionSnapshot = null;
          return { rows: [] as T[] };
        }
        if (normalized === "ROLLBACK") {
          if (transactionSnapshot) this.state = transactionSnapshot;
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
    let rows: unknown[] = [];

    if (normalized.startsWith("INSERT INTO daily007_v2_users")) {
      const isV2Order = normalized.includes(
        "(name, email, password_salt, password_hash, phone, game_uid, referral_code)",
      );
      const [name, email, phone, gameUid, passwordSalt, passwordHash] = isV2Order
        ? [values[0], values[1], values[4], values[5], values[2], values[3]]
        : [values[0], values[1], values[2], values[3], values[5], values[6]];
      const account: SignupAccount = {
        id: accountId(this.state.nextAccountId++),
        name: String(name),
        email: String(email),
        role: "user",
        status: "active",
        wallet_coins: 0,
        phone: phone == null ? null : String(phone),
        game_uid: gameUid == null ? null : String(gameUid),
        password_salt: String(passwordSalt),
        password_hash: String(passwordHash),
      };
      if ([...this.state.accounts.values()].some((item) => item.email === account.email)) {
        throw Object.assign(new Error("duplicate email"), { code: "23505" });
      }
      this.state.accounts.set(account.id, account);
      rows = [{
        id: account.id,
        name: account.name,
        email: account.email,
        role: account.role,
        wallet_coins: account.wallet_coins,
        phone: account.phone,
        game_uid: account.game_uid,
        status: account.status,
      }];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_referral_codes")) {
      rows = [];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_referral_short_codes")) {
      this.state.shortCodes.set(String(values[0]), String(values[1]));
    } else if (normalized.startsWith(
      "SELECT code FROM daily007_v2_referral_short_codes WHERE user_id = $1",
    )) {
      const code = this.state.shortCodes.get(String(values[0]));
      rows = code ? [{ code }] : [];
    } else if (normalized.startsWith(
      "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
    )) {
      const account = this.state.accounts.get(String(values[0]));
      rows = account ? [{ wallet_coins: account.wallet_coins, status: account.status }] : [];
    } else if (normalized.startsWith(
      "SELECT id FROM daily007_v2_wallet_ledger WHERE idempotency_key = $1",
    )) {
      const key = String(values[0]);
      rows = this.state.ledgerKeys.has(key) ? [{ id: `ledger-${key}` }] : [];
    } else if (normalized.startsWith("UPDATE daily007_v2_users SET wallet_coins")) {
      const account = this.state.accounts.get(String(values[0]));
      if (account) account.wallet_coins = Number(values[1]);
    } else if (normalized.startsWith("INSERT INTO daily007_v2_wallet_ledger")) {
      this.state.ledgerKeys.add(String(values[3]));
    } else {
      throw new Error(`Unexpected registration test SQL: ${normalized}`);
    }

    return { rows: rows as T[] };
  }
}

const database = new MemoryRegistrationDatabase();

export const pool = {
  query: <T = unknown>(sql: string, values?: unknown[]) => database.query<T>(sql, values),
  connect: () => database.connect(),
};