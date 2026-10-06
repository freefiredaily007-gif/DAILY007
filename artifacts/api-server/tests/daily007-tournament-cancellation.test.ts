import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelUnderfilledTournamentAndRefund,
  cancelUnderfilledTournamentTransaction,
  type CancellationSqlClient,
} from "../src/lib/daily007-tournament-cancellation.ts";
import { autoCancellationTestDb } from "./support/daily007-auto-cancel-test-db";

type Match = {
  id: string;
  title: string;
  mode: string;
  game_mode: string | null;
  status: string;
  capacity: number;
  has_started: boolean;
  has_winner: boolean;
};

type Registration = {
  id: string;
  captain_user_id: string;
  entry_coins_paid: number;
  status: string;
};

class MemoryCancellationClient implements CancellationSqlClient {
  readonly wallets = new Map<string, number>();
  readonly ledger = new Map<string, { userId: string; amount: number; registrationId: string }>();

  constructor(
    readonly match: Match,
    readonly registrations: Registration[],
  ) {
    for (const registration of registrations) {
      this.wallets.set(registration.captain_user_id, 10);
    }
  }

  release(): void {}

  async query<T = unknown>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    let rows: unknown[] = [];
    if (text.includes("FROM daily007_v2_matches m") && text.includes("FOR UPDATE OF m")) {
      rows = [this.match];
    } else if (text.includes("count(*)::integer AS filled_slots")) {
      rows = [{
        filled_slots: this.registrations.filter((registration) =>
          ["approved", "pending"].includes(registration.status),
        ).length,
      }];
    } else if (text.includes("ORDER BY captain_user_id, id")) {
      rows = this.registrations.filter((registration) =>
        ["approved", "pending"].includes(registration.status),
      );
    } else if (text.includes("FROM daily007_v2_wallet_ledger") && text.includes("SELECT id")) {
      const priorRefund = [...this.ledger.values()].some((entry) => entry.registrationId === values[0]);
      rows = priorRefund ? [{ id: "prior-refund" }] : [];
    } else if (text.startsWith("SELECT wallet_coins FROM daily007_v2_users")) {
      const balance = this.wallets.get(String(values[0]));
      rows = balance === undefined ? [] : [{ wallet_coins: balance }];
    } else if (text.startsWith("UPDATE daily007_v2_users")) {
      this.wallets.set(String(values[0]), Number(values[1]));
    } else if (text.includes("INSERT INTO daily007_v2_wallet_ledger")) {
      const key = String(values[5]);
      if (!this.ledger.has(key)) {
        this.ledger.set(key, {
          userId: String(values[0]),
          amount: Number(values[1]),
          registrationId: String(values[4]),
        });
        rows = [{ id: `ledger-${this.ledger.size}` }];
      }
    } else if (text.startsWith("UPDATE daily007_v2_matches")) {
      this.match.status = "cancelled";
    }
    return { rows: rows as T[] };
  }
}

function underfilledMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: "match-1",
    title: "Clash test",
    mode: "clash",
    game_mode: "clash_squad",
    status: "open",
    capacity: 2,
    has_started: true,
    has_winner: false,
    ...overrides,
  };
}

test("automatic cancellation refunds every active registration once and cancels the tournament", async () => {
  const client = new MemoryCancellationClient(underfilledMatch(), [
    { id: "reg-1", captain_user_id: "user-1", entry_coins_paid: 25, status: "pending" },
    { id: "reg-2", captain_user_id: "user-2", entry_coins_paid: 50, status: "rejected" },
  ]);

  const first = await cancelUnderfilledTournamentTransaction(client, "match-1", true);
  assert.deepEqual(first, {
    id: "match-1",
    status: "cancelled",
    registrationsRefunded: 1,
    accountsRefunded: 1,
    coinsRefunded: 25,
  });
  assert.equal(client.wallets.get("user-1"), 35);
  assert.equal(client.wallets.get("user-2"), 10);
  assert.equal(client.ledger.size, 1);
  assert.equal(client.match.status, "cancelled");

  const second = await cancelUnderfilledTournamentTransaction(client, "match-1", true);
  assert.equal(second, null);
  assert.equal(client.wallets.get("user-1"), 35);
  assert.equal(client.wallets.get("user-2"), 10);
  assert.equal(client.ledger.size, 1);
});

test("automatic cancellation skips full tournaments and all other game modes", async () => {
  const fullClient = new MemoryCancellationClient(
    underfilledMatch(),
    [
      { id: "reg-1", captain_user_id: "user-1", entry_coins_paid: 25, status: "approved" },
      { id: "reg-2", captain_user_id: "user-2", entry_coins_paid: 50, status: "approved" },
    ],
  );
  const full = await cancelUnderfilledTournamentTransaction(fullClient, "match-1", true);
  assert.equal(full, null);
  assert.equal(fullClient.match.status, "open");
  assert.equal(fullClient.ledger.size, 0);

  const battleRoyaleClient = new MemoryCancellationClient(
    underfilledMatch({ mode: "solo", game_mode: "battle_royale" }),
    [{ id: "reg-1", captain_user_id: "user-1", entry_coins_paid: 25, status: "approved" }],
  );
  const battleRoyale = await cancelUnderfilledTournamentTransaction(battleRoyaleClient, "match-1", true);
  assert.equal(battleRoyale, null);
  assert.equal(battleRoyaleClient.match.status, "open");
  assert.equal(battleRoyaleClient.ledger.size, 0);
});

const ATOMIC_MATCH_ID = "atomic-cancel-match";
const FIRST_PAYER_ID = "payer-01";
const SECOND_PAYER_ID = "payer-02";
const FIRST_REGISTRATION_ID = "registration-01";
const SECOND_REGISTRATION_ID = "registration-02";

function resetAtomicCancellationFixture({
  includeSecondPayer = true,
  secondPayerBalance = 200,
  ledger = [],
}: {
  includeSecondPayer?: boolean;
  secondPayerBalance?: number;
  ledger?: {
    idempotencyKey: string;
    entry: {
      userId: string;
      amount: number;
      balanceAfter: number;
      reason: string;
      matchId: string;
      registrationId: string;
    };
  }[];
} = {}): void {
  const nowMs = Date.parse("2035-04-05T14:30:00.000Z");
  autoCancellationTestDb.reset({
    nowMs,
    matches: [{
      id: ATOMIC_MATCH_ID,
      title: "Atomic Cancellation Test",
      mode: "clash",
      game_mode: "clash_squad",
      status: "open",
      capacity: 3,
      startsAtWallMs: nowMs - 1_000,
      hasWinner: false,
      enabled: true,
      isFull: false,
      roomId: "room-before-cancel",
      roomPassword: "room-password-before-cancel",
      roomPublished: true,
    }],
    registrations: [
      {
        id: FIRST_REGISTRATION_ID,
        match_id: ATOMIC_MATCH_ID,
        captain_user_id: FIRST_PAYER_ID,
        entry_coins_paid: 25,
        status: "approved",
      },
      {
        id: SECOND_REGISTRATION_ID,
        match_id: ATOMIC_MATCH_ID,
        captain_user_id: SECOND_PAYER_ID,
        entry_coins_paid: 40,
        status: "pending",
      },
    ],
    accounts: [
      { id: FIRST_PAYER_ID, wallet_coins: 100 },
      ...(includeSecondPayer ? [{ id: SECOND_PAYER_ID, wallet_coins: secondPayerBalance }] : []),
    ],
    ledger,
  });
}

function atomicCancellationSnapshot() {
  return structuredClone({
    matches: autoCancellationTestDb.matches,
    registrations: autoCancellationTestDb.registrations,
    accounts: autoCancellationTestDb.accounts,
    ledger: autoCancellationTestDb.ledger,
  });
}

test("a later missing payer rolls back prior refunds and a repaired retry refunds each payer once", async () => {
  resetAtomicCancellationFixture({ includeSecondPayer: false });
  const before = atomicCancellationSnapshot();

  await assert.rejects(
    cancelUnderfilledTournamentAndRefund(ATOMIC_MATCH_ID, true),
    /A paying account was not found or has an invalid wallet balance/,
  );

  assert.deepEqual(autoCancellationTestDb.mutationTrace, [
    `wallet:${FIRST_PAYER_ID}`,
    `ledger:${FIRST_REGISTRATION_ID}`,
  ]);
  assert.deepEqual(atomicCancellationSnapshot(), before);

  autoCancellationTestDb.accounts.set(SECOND_PAYER_ID, {
    id: SECOND_PAYER_ID,
    wallet_coins: 200,
  });
  const beforeRetryTraceLength = autoCancellationTestDb.mutationTrace.length;
  const retry = await cancelUnderfilledTournamentAndRefund(ATOMIC_MATCH_ID, true);

  assert.deepEqual(retry, {
    id: ATOMIC_MATCH_ID,
    status: "cancelled",
    registrationsRefunded: 2,
    accountsRefunded: 2,
    coinsRefunded: 65,
  });
  assert.equal(autoCancellationTestDb.matches.get(ATOMIC_MATCH_ID)?.status, "cancelled");
  assert.deepEqual(autoCancellationTestDb.registrations, before.registrations);
  assert.equal(autoCancellationTestDb.accounts.get(FIRST_PAYER_ID)?.wallet_coins, 125);
  assert.equal(autoCancellationTestDb.accounts.get(SECOND_PAYER_ID)?.wallet_coins, 240);
  assert.deepEqual(
    autoCancellationTestDb.mutationTrace.slice(beforeRetryTraceLength),
    [
      `wallet:${FIRST_PAYER_ID}`,
      `ledger:${FIRST_REGISTRATION_ID}`,
      `wallet:${SECOND_PAYER_ID}`,
      `ledger:${SECOND_REGISTRATION_ID}`,
    ],
  );
  assert.deepEqual(
    [...autoCancellationTestDb.ledger.values()]
      .map(({ userId, amount, balanceAfter, registrationId }) => ({
        userId,
        amount,
        balanceAfter,
        registrationId,
      }))
      .sort((a, b) => a.userId.localeCompare(b.userId)),
    [
      {
        userId: FIRST_PAYER_ID,
        amount: 25,
        balanceAfter: 125,
        registrationId: FIRST_REGISTRATION_ID,
      },
      {
        userId: SECOND_PAYER_ID,
        amount: 40,
        balanceAfter: 240,
        registrationId: SECOND_REGISTRATION_ID,
      },
    ],
  );

  const afterRetry = atomicCancellationSnapshot();
  assert.equal(await cancelUnderfilledTournamentAndRefund(ATOMIC_MATCH_ID, true), null);
  assert.deepEqual(atomicCancellationSnapshot(), afterRetry);
});

test("an existing later refund record rolls back earlier cancellation credits and ledger rows", async () => {
  resetAtomicCancellationFixture({
    secondPayerBalance: 240,
    ledger: [{
      idempotencyKey: "existing-refund-for-registration-02",
      entry: {
        userId: SECOND_PAYER_ID,
        amount: 40,
        balanceAfter: 240,
        reason: "tournament_cancel_refund",
        matchId: ATOMIC_MATCH_ID,
        registrationId: SECOND_REGISTRATION_ID,
      },
    }],
  });
  const before = atomicCancellationSnapshot();

  await assert.rejects(
    cancelUnderfilledTournamentAndRefund(ATOMIC_MATCH_ID, true),
    /A registration already has a refund record/,
  );

  assert.deepEqual(autoCancellationTestDb.mutationTrace, [
    `wallet:${FIRST_PAYER_ID}`,
    `ledger:${FIRST_REGISTRATION_ID}`,
  ]);
  assert.deepEqual(atomicCancellationSnapshot(), before);
});

test("overlapping cancellation attempts refund each registration only once", async () => {
  resetAtomicCancellationFixture();

  const attempts = await Promise.allSettled([
    cancelUnderfilledTournamentAndRefund(ATOMIC_MATCH_ID),
    cancelUnderfilledTournamentAndRefund(ATOMIC_MATCH_ID),
  ]);

  assert.equal(
    autoCancellationTestDb.matchRowLockWaitCount(ATOMIC_MATCH_ID),
    1,
    "the overlapping attempt must wait for the tournament row lock",
  );
  const completed = attempts.find((attempt) => attempt.status === "fulfilled");
  const rejected = attempts.find((attempt) => attempt.status === "rejected");
  assert.ok(completed && completed.status === "fulfilled", "one attempt should complete the cancellation");
  assert.ok(rejected && rejected.status === "rejected", "the waiting manual attempt should reject");
  assert.match(String(rejected.reason), /Tournament is already cancelled/i);
  assert.deepEqual(completed.value, {
    id: ATOMIC_MATCH_ID,
    status: "cancelled",
    registrationsRefunded: 2,
    accountsRefunded: 2,
    coinsRefunded: 65,
  });

  assert.equal(autoCancellationTestDb.matches.get(ATOMIC_MATCH_ID)?.status, "cancelled");
  assert.equal(autoCancellationTestDb.accounts.get(FIRST_PAYER_ID)?.wallet_coins, 125);
  assert.equal(autoCancellationTestDb.accounts.get(SECOND_PAYER_ID)?.wallet_coins, 240);
  assert.deepEqual(autoCancellationTestDb.mutationTrace, [
    `wallet:${FIRST_PAYER_ID}`,
    `ledger:${FIRST_REGISTRATION_ID}`,
    `wallet:${SECOND_PAYER_ID}`,
    `ledger:${SECOND_REGISTRATION_ID}`,
  ]);

  const cancellationRefunds = [...autoCancellationTestDb.ledger.entries()]
    .filter(([, entry]) =>
      entry.matchId === ATOMIC_MATCH_ID && entry.reason === "tournament_cancel_refund",
    );
  assert.equal(cancellationRefunds.length, 2);
  assert.deepEqual(
    new Map(cancellationRefunds.map(([, entry]) => [entry.registrationId, entry.amount])),
    new Map([
      [FIRST_REGISTRATION_ID, 25],
      [SECOND_REGISTRATION_ID, 40],
    ]),
  );
});

test("a waiting cancellation succeeds after the first refund write rolls back", async () => {
  resetAtomicCancellationFixture();
  autoCancellationTestDb.failNextRefundWriteAfterFirstWalletMutation(ATOMIC_MATCH_ID);

  const firstAttempt = cancelUnderfilledTournamentAndRefund(ATOMIC_MATCH_ID);
  const waitingAttempt = cancelUnderfilledTournamentAndRefund(ATOMIC_MATCH_ID);
  await autoCancellationTestDb.waitForMatchRowLockWaitCount(ATOMIC_MATCH_ID);

  const [first, waiting] = await Promise.allSettled([firstAttempt, waitingAttempt]);
  assert.equal(autoCancellationTestDb.matchRowLockWaitCount(ATOMIC_MATCH_ID), 1);
  assert.ok(first.status === "rejected", "the first refund write should fail");
  assert.match(String(first.reason), /Injected tournament cancellation refund write failure/);
  assert.ok(waiting.status === "fulfilled", "the cancellation waiting on the row lock should succeed");
  assert.deepEqual(waiting.value, {
    id: ATOMIC_MATCH_ID,
    status: "cancelled",
    registrationsRefunded: 2,
    accountsRefunded: 2,
    coinsRefunded: 65,
  });

  assert.equal(autoCancellationTestDb.matches.get(ATOMIC_MATCH_ID)?.status, "cancelled");
  assert.equal(autoCancellationTestDb.accounts.get(FIRST_PAYER_ID)?.wallet_coins, 125);
  assert.equal(autoCancellationTestDb.accounts.get(SECOND_PAYER_ID)?.wallet_coins, 240);
  assert.deepEqual(autoCancellationTestDb.mutationTrace, [
    `wallet:${FIRST_PAYER_ID}`,
    `refund-write-failure:${FIRST_REGISTRATION_ID}`,
    `wallet:${FIRST_PAYER_ID}`,
    `ledger:${FIRST_REGISTRATION_ID}`,
    `wallet:${SECOND_PAYER_ID}`,
    `ledger:${SECOND_REGISTRATION_ID}`,
  ]);

  const cancellationRefunds = [...autoCancellationTestDb.ledger.values()]
    .filter(({ matchId, reason }) =>
      matchId === ATOMIC_MATCH_ID && reason === "tournament_cancel_refund",
    );
  assert.equal(cancellationRefunds.length, 2);
  assert.deepEqual(
    new Map(cancellationRefunds.map(({ registrationId, userId, amount }) => [
      registrationId,
      { userId, amount },
    ])),
    new Map([
      [FIRST_REGISTRATION_ID, { userId: FIRST_PAYER_ID, amount: 25 }],
      [SECOND_REGISTRATION_ID, { userId: SECOND_PAYER_ID, amount: 40 }],
    ]),
  );
});
