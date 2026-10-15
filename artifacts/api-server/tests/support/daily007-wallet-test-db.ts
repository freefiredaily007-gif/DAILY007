type WalletUser = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin" | "tournament_admin";
  wallet_coins: number;
  phone: null;
  game_uid: null;
  status: "active";
  auth_version: number;
};

type Payment = {
  id: string;
  user_id: string;
  coins: number;
  amount: number;
  payer_upi_id: string | null;
  reference: string;
  reference_normalized: string;
  proof_object_path: string | null;
  status: "pending" | "approved" | "rejected" | "deleted";
  review_reason: string | null;
  reviewed_by: string | null;
  created_at: Date;
  reviewed_at: Date | null;
};

type Withdrawal = {
  id: string;
  user_id: string;
  coins: number;
  method: string;
  account: string;
  status: "pending" | "approved" | "rejected" | "deleted";
  payout_status: "not_paid" | "manual_payout_required" | "paid";
  review_reason: string | null;
  reviewed_by: string | null;
  created_at: Date;
  reviewed_at: Date | null;
};

type LedgerEntry = {
  userId: string;
  amount: number;
  balanceAfter: number;
  reason: string;
};

type Notification = {
  userId: string;
  title: string;
  body: string;
  type: string;
};

type DatabaseSnapshot = {
  users: Map<string, WalletUser>;
  payments: Map<string, Payment>;
  withdrawals: Map<string, Withdrawal>;
  ledger: LedgerEntry[];
  notifications: Notification[];
  settings: Record<string, string>;
  nextPaymentId: number;
  nextWithdrawalId: number;
};

export const TEST_PLAYER_ID = "10000000-0000-4000-8000-000000000001";
export const TEST_ADMIN_ID = "10000000-0000-4000-8000-000000000002";
export const TEST_SECOND_ADMIN_ID = "10000000-0000-4000-8000-000000000003";
export const TEST_SECOND_PLAYER_ID = "10000000-0000-4000-8000-000000000004";

const DEFAULT_SETTINGS = {
  rechargeEnabled: "true",
  withdrawalEnabled: "true",
  upiId: "daily007@upi",
  upiQrObjectPath: "test-only-qr-object",
  minPurchase: "1",
  maxPurchase: "5000",
  minWithdrawal: "100",
  maxWithdrawal: "5000",
  coinToMoneyRate: "2.5",
};

function copyMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map([...source].map(([key, value]) => [key, structuredClone(value)]));
}

function uuidFor(sequence: number): string {
  return `20000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

class MemoryWalletDatabase {
  users = new Map<string, WalletUser>();
  payments = new Map<string, Payment>();
  withdrawals = new Map<string, Withdrawal>();
  ledger: LedgerEntry[] = [];
  notifications: Notification[] = [];
  settings: Record<string, string> = {};
  private nextPaymentId = 1;
  private nextWithdrawalId = 1;
  private demoteBeforeNextTransaction: string | null = null;

  reset({ playerBalance = 700, settings = {} }: {
    playerBalance?: number;
    settings?: Partial<typeof DEFAULT_SETTINGS>;
  } = {}): void {
    this.users = new Map([
      [TEST_PLAYER_ID, {
        id: TEST_PLAYER_ID,
        name: "Test Player",
        email: "player@example.test",
        role: "user",
        wallet_coins: playerBalance,
        phone: null,
        game_uid: null,
        status: "active",
        auth_version: 0,
      }],
      [TEST_SECOND_PLAYER_ID, {
        id: TEST_SECOND_PLAYER_ID,
        name: "Second Test Player",
        email: "second-player@example.test",
        role: "user",
        wallet_coins: playerBalance,
        phone: null,
        game_uid: null,
        status: "active",
        auth_version: 0,
      }],
      [TEST_ADMIN_ID, {
        id: TEST_ADMIN_ID,
        name: "Test Admin",
        email: "admin@example.test",
        role: "admin",
        wallet_coins: 0,
        phone: null,
        game_uid: null,
        status: "active",
        auth_version: 0,
      }],
    ]);
    this.payments = new Map();
    this.withdrawals = new Map();
    this.ledger = [];
    this.notifications = [];
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.nextPaymentId = 1;
    this.nextWithdrawalId = 1;
    this.demoteBeforeNextTransaction = null;
  }

  demoteUserBeforeNextTransaction(userId: string): void {
    this.demoteBeforeNextTransaction = userId;
  }

  seedPaymentHistory(payments: Array<{
    id: string;
    userId: string;
    createdAt: Date;
  }>): void {
    for (const { id, userId, createdAt } of payments) {
      this.payments.set(id, {
        id,
        user_id: userId,
        coins: 1,
        amount: 1,
        payer_upi_id: null,
        reference: id,
        reference_normalized: id.toUpperCase(),
        proof_object_path: null,
        status: "approved",
        review_reason: null,
        reviewed_by: null,
        created_at: new Date(createdAt),
        reviewed_at: null,
      });
    }
  }

  private snapshot(): DatabaseSnapshot {
    return {
      users: copyMap(this.users),
      payments: copyMap(this.payments),
      withdrawals: copyMap(this.withdrawals),
      ledger: structuredClone(this.ledger),
      notifications: structuredClone(this.notifications),
      settings: structuredClone(this.settings),
      nextPaymentId: this.nextPaymentId,
      nextWithdrawalId: this.nextWithdrawalId,
    };
  }

  private restore(snapshot: DatabaseSnapshot): void {
    this.users = snapshot.users;
    this.payments = snapshot.payments;
    this.withdrawals = snapshot.withdrawals;
    this.ledger = snapshot.ledger;
    this.notifications = snapshot.notifications;
    this.settings = snapshot.settings;
    this.nextPaymentId = snapshot.nextPaymentId;
    this.nextWithdrawalId = snapshot.nextWithdrawalId;
  }

  async connect() {
    let transactionSnapshot: DatabaseSnapshot | null = null;
    return {
      query: async <T = unknown>(sql: string, values: unknown[] = []) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized === "BEGIN") {
          if (this.demoteBeforeNextTransaction) {
            const user = this.users.get(this.demoteBeforeNextTransaction);
            if (user) user.role = "tournament_admin";
            this.demoteBeforeNextTransaction = null;
          }
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
    let rows: unknown[] = [];
    const userId = String(values[0] ?? "");

    if (normalized.startsWith(
      "SELECT id, name, email, role, wallet_coins, phone, game_uid, status, auth_version FROM daily007_v2_users",
    )) {
      const user = this.users.get(userId);
      rows = user ? [structuredClone(user)] : [];
    } else if (normalized.startsWith("SELECT id, id AS \"$id\", name, email, phone, game_uid AS \"gameUid\", role")) {
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
        createdAt: null,
      }));
    } else if (
      normalized === "SELECT pg_advisory_xact_lock(740073)" ||
      normalized === "SELECT pg_advisory_xact_lock_shared(740073)"
    ) {
      rows = [];
    } else if (normalized === "SELECT role, status FROM daily007_v2_users WHERE id = $1 FOR SHARE") {
      const user = this.users.get(userId);
      rows = user ? [{ role: user.role, status: user.status }] : [];
    } else if (normalized === "SELECT role FROM daily007_v2_users WHERE id = $1 FOR UPDATE") {
      const user = this.users.get(userId);
      rows = user ? [{ role: user.role }] : [];
    } else if (normalized === "SELECT count(*)::text AS count FROM daily007_v2_users WHERE role = 'admin'") {
      rows = [{ count: String([...this.users.values()].filter((user) => user.role === "admin").length) }];
    } else if (normalized.startsWith("UPDATE daily007_v2_users SET role = $2 WHERE id = $1 RETURNING id, role")) {
      const user = this.users.get(userId);
      if (user) {
        user.role = String(values[1]) as WalletUser["role"];
        rows = [{ id: user.id, role: user.role }];
      }
    } else if (normalized === "SELECT settings FROM daily007_v2_settings WHERE id = 1") {
      rows = [{ settings: structuredClone(this.settings) }];
    } else if (normalized.startsWith("SELECT wallet_coins FROM daily007_v2_users")) {
      const user = this.users.get(userId);
      rows = user ? [{ wallet_coins: user.wallet_coins }] : [];
    } else if (normalized.startsWith("SELECT r.id, r.referrer_user_id")) {
      rows = [];
    } else if (normalized.startsWith("SELECT * FROM daily007_v2_payments WHERE id = $1")) {
      const payment = this.payments.get(userId);
      rows = payment ? [structuredClone(payment)] : [];
    } else if (normalized.startsWith("SELECT * FROM daily007_v2_withdrawals WHERE id = $1")) {
      const withdrawal = this.withdrawals.get(userId);
      rows = withdrawal ? [structuredClone(withdrawal)] : [];
    } else if (normalized.startsWith(
      "SELECT 1 FROM daily007_v2_withdrawals WHERE user_id = $1 AND status = 'pending'",
    )) {
      rows = [...this.withdrawals.values()].some((item) =>
        item.user_id === userId && item.status === "pending",
      ) ? [{ exists: 1 }] : [];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_payments")) {
      const [requestUserId, coins, amount, payerUpiId, reference, referenceNormalized, proofPath] = values;
      const duplicateReference = [...this.payments.values()].some(
        (item) => item.reference_normalized === referenceNormalized,
      );
      if (duplicateReference) {
        throw Object.assign(new Error("duplicate payment reference"), {
          code: "23505",
          constraint: "daily007_v2_payments_reference_normalized_key",
        });
      }
      if ([...this.payments.values()].some(
        (item) => item.user_id === requestUserId && item.status === "pending",
      )) {
        throw Object.assign(new Error("pending payment already exists"), {
          code: "23505",
          constraint: "daily007_one_pending_payment_per_user",
        });
      }
      const id = uuidFor(this.nextPaymentId++);
      const payment: Payment = {
        id,
        user_id: String(requestUserId),
        coins: Number(coins),
        amount: Number(amount),
        payer_upi_id: payerUpiId == null ? null : String(payerUpiId),
        reference: String(reference),
        reference_normalized: String(referenceNormalized),
        proof_object_path: proofPath == null ? null : String(proofPath),
        status: "pending",
        review_reason: null,
        reviewed_by: null,
        created_at: new Date(),
        reviewed_at: null,
      };
      this.payments.set(id, payment);
      rows = [{
        id,
        coins: payment.coins,
        amount: payment.amount,
        payerUpiId: payment.payer_upi_id,
        txnId: payment.reference,
        status: payment.status,
        createdAt: payment.created_at,
      }];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_withdrawals")) {
      const [requestUserId, coins, method, account] = values;
      const id = uuidFor(this.nextWithdrawalId++);
      const withdrawal: Withdrawal = {
        id,
        user_id: String(requestUserId),
        coins: Number(coins),
        method: String(method),
        account: String(account),
        status: "pending",
        payout_status: "not_paid",
        review_reason: null,
        reviewed_by: null,
        created_at: new Date(),
        reviewed_at: null,
      };
      this.withdrawals.set(id, withdrawal);
      rows = [{
        id,
        coins: withdrawal.coins,
        method: withdrawal.method,
        account: withdrawal.account,
        status: withdrawal.status,
        payoutStatus: withdrawal.payout_status,
        createdAt: withdrawal.created_at,
      }];
    } else if (normalized.startsWith("UPDATE daily007_v2_users SET wallet_coins")) {
      const user = this.users.get(userId);
      if (user) user.wallet_coins = Number(values[1]);
    } else if (normalized.startsWith("INSERT INTO daily007_v2_wallet_ledger")) {
      this.ledger.push({
        userId,
        amount: Number(values[1]),
        balanceAfter: Number(values[2]),
        reason: normalized.match(/'([^']+)'/)?.[1] ?? "",
      });
      rows = [{ id: `ledger-${this.ledger.length}` }];
    } else if (
      normalized.startsWith("UPDATE daily007_v2_payments SET status = $2") ||
      normalized.startsWith("UPDATE daily007_v2_withdrawals SET status = $2")
    ) {
      const table = normalized.includes("daily007_v2_payments")
        ? this.payments
        : this.withdrawals;
      const request = table.get(userId);
      if (request) {
        request.status = String(values[1]) as Payment["status"] & Withdrawal["status"];
        request.reviewed_by = String(values[2]);
        request.reviewed_at = new Date();
        request.review_reason = values[3] == null ? null : String(values[3]);
        if ("payout_status" in request && values[4] !== undefined) {
          request.payout_status = String(values[4]) as Withdrawal["payout_status"];
        }
        rows = [structuredClone(request)];
      }
    } else if (normalized.startsWith("UPDATE daily007_v2_withdrawals SET payout_status = 'paid'")) {
      const request = this.withdrawals.get(userId);
      if (request) request.payout_status = "paid";
    } else if (normalized.startsWith("INSERT INTO daily007_v2_notifications")) {
      const literalValues = normalized.match(/VALUES \(\$1, '([^']*)', '([^']*)', '([^']*)'\)/);
      this.notifications.push({
        userId,
        title: String(values[1] ?? literalValues?.[1] ?? ""),
        body: String(values[2] ?? literalValues?.[2] ?? ""),
        type: String(values[3] ?? literalValues?.[3] ?? ""),
      });
    } else if (normalized.includes("FROM daily007_v2_payments WHERE user_id = $1")) {
      let history = [...this.payments.values()]
        .filter((item) => item.user_id === userId && item.status !== "deleted");
      if (normalized.includes("(created_at, id) < ($2::timestamptz, $3::uuid)")) {
        const cursorTime = Date.parse(String(values[1]));
        const cursorId = String(values[2]);
        history = history.filter((item) =>
          item.created_at.getTime() < cursorTime ||
          (item.created_at.getTime() === cursorTime && item.id < cursorId),
        );
      }
      if (/\bORDER BY created_at DESC\b/i.test(normalized)) {
        const usesIdTieBreaker = /\bORDER BY created_at DESC,\s*id DESC\b/i.test(normalized);
        history = history.sort((left, right) =>
          right.created_at.getTime() - left.created_at.getTime() ||
          (usesIdTieBreaker ? right.id.localeCompare(left.id) : 0),
        );
      }
      const limit = normalized.match(/\bLIMIT\s+(\d+|\$\d+)\b/i);
      if (limit) {
        const limitValue = limit[1].startsWith("$")
          ? Number(values[Number(limit[1].slice(1)) - 1])
          : Number(limit[1]);
        history = history.slice(0, limitValue);
      }
      rows = history.map((item) => ({
        id: item.id,
        coins: item.coins,
        amount: item.amount,
        txnId: item.reference,
        status: item.status,
        reviewReason: item.review_reason,
        createdAt: item.created_at,
        reviewedAt: item.reviewed_at,
        ...(normalized.includes('created_at::text AS "cursorCreatedAt"')
          ? { cursorCreatedAt: item.created_at.toISOString() }
          : {}),
      }));
    } else if (normalized.includes("FROM daily007_v2_withdrawals WHERE user_id = $1")) {
      rows = [...this.withdrawals.values()]
        .filter((item) => item.user_id === userId && item.status !== "deleted")
        .map((item) => ({
          id: item.id,
          coins: item.coins,
          method: item.method,
          account: item.account,
          status: item.status,
          payoutStatus: item.payout_status,
          reviewReason: item.review_reason,
          createdAt: item.created_at,
          reviewedAt: item.reviewed_at,
        }));
    } else {
      throw new Error(`Unexpected wallet test SQL: ${normalized}`);
    }

    return { rows: rows as T[] };
  }
}

export const walletTestDb = new MemoryWalletDatabase();
walletTestDb.reset();

export const pool = {
  query: <T = unknown>(sql: string, values?: unknown[]) => walletTestDb.query<T>(sql, values),
  connect: () => walletTestDb.connect(),
};