import assert from "node:assert/strict";
import test from "node:test";
import {
  daily007UserDeletionCandidateError,
  deleteDaily007UserData,
  type Daily007UserDeletionClient,
} from "../src/lib/daily007-user-deletion";
import { isDaily007PaymentProofObjectPath } from "../src/lib/daily007-wallet-storage";

class RecordingClient implements Daily007UserDeletionClient {
  readonly statements: string[] = [];

  async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
    this.statements.push(sql.replace(/\s+/g, " ").trim());
    return { rows: [{ id: `row-${this.statements.length}` }] as T[] };
  }
}

const candidate = {
  actorId: "admin-id",
  targetId: "player-id",
  targetEmail: "player@example.com",
  targetRole: "user",
  confirmationEmail: " PLAYER@example.com ",
};

test("account deletion candidate checks protect self and privileged accounts", () => {
  assert.equal(daily007UserDeletionCandidateError(candidate), null);
  assert.deepEqual(
    daily007UserDeletionCandidateError({ ...candidate, actorId: candidate.targetId }),
    { status: 409, message: "You cannot delete your own account." },
  );
  assert.equal(
    daily007UserDeletionCandidateError({ ...candidate, targetRole: "admin" })?.status,
    409,
  );
  assert.equal(
    daily007UserDeletionCandidateError({ ...candidate, confirmationEmail: "other@example.com" })?.status,
    400,
  );
});

test("payment proof deletion only accepts an owner's stored image path", () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const otherId = "22222222-2222-4222-8222-222222222222";
  const imageId = "33333333-3333-4333-8333-333333333333";
  const path = `/objects/uploads/daily007/payment-proofs/${ownerId}/${imageId}.webp`;

  assert.equal(isDaily007PaymentProofObjectPath(path, ownerId), true);
  assert.equal(isDaily007PaymentProofObjectPath(path, otherId), false);
  assert.equal(isDaily007PaymentProofObjectPath(`${path}.txt`, ownerId), false);
  assert.equal(
    isDaily007PaymentProofObjectPath(`/objects/uploads/daily007/payment-proofs/${ownerId}/../${imageId}.png`, ownerId),
    false,
  );
});

test("account data cleanup removes dependent rows before registrations and the user", async () => {
  const client = new RecordingClient();
  const result = await deleteDaily007UserData(client, "player-id", "clerk-player-id", 2);

  const statement = (table: string) => client.statements.findIndex((sql) => sql.includes(table));
  assert.ok(statement("daily007_v2_video_watch_sessions") < statement("daily007_v2_wallet_ledger"));
  assert.ok(statement("daily007_v2_youtube_subscribe_claims") < statement("daily007_v2_wallet_ledger"));
  assert.ok(statement("daily007_v2_instagram_follow_claims") < statement("daily007_v2_wallet_ledger"));
  assert.ok(statement("daily007_v2_result_awards") < statement("DELETE FROM daily007_v2_registrations"));
  assert.ok(statement("daily007_v2_wallet_ledger") < statement("DELETE FROM daily007_v2_registrations"));
  assert.ok(statement("daily007_v2_roster") < statement("DELETE FROM daily007_v2_registrations"));
  assert.ok(statement("DELETE FROM daily007_v2_registrations") < statement("DELETE FROM daily007_v2_users"));
  assert.ok(client.statements.some((sql) =>
    sql.includes("google_clerk_user_id = $2") && sql.includes("user_id = $1"),
  ));
  assert.ok(client.statements.some((sql) =>
    sql.includes("jsonb_array_elements(final_standings)") && sql.includes("userId"),
  ));
  assert.equal(result.registrations, 1);
  assert.equal(result.rosterMembers, 1);
  assert.equal(result.paymentProofFiles, 2);
  assert.equal(result.instagramFollowClaims, 1);
  assert.equal(result.auditAttributionsCleared, 4);
});
