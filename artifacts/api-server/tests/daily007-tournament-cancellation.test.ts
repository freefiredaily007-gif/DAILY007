import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelUnderfilledTournamentTransaction,
  type CancellationSqlClient,
} from "../src/lib/daily007-tournament-cancellation.ts";

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