import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePaymentReference,
  pausedVideoRewardResponse,
  referralCodeForUserId,
} from "../src/lib/daily007-compat-extra-validation.ts";

test("payment reference normalization is trim-, case-, and Unicode-width-insensitive", () => {
  assert.equal(normalizePaymentReference("  abc-123  "), "ABC-123");
  assert.equal(normalizePaymentReference("ＡＢＣ-１２３"), "ABC-123");
  assert.equal(normalizePaymentReference("AbC-123"), normalizePaymentReference(" abc-123 "));
});

test("referral codes are stable per account and unique across account UUIDs", () => {
  const firstId = "7d160000-0000-4000-8000-000000000001";
  const secondId = "7d160000-0000-4000-8000-000000000002";
  const firstCode = referralCodeForUserId(firstId);
  assert.equal(firstCode, referralCodeForUserId(firstId));
  assert.notEqual(firstCode, referralCodeForUserId(secondId));
  assert.match(firstCode, /^D7[0-9A-F]{32}$/);
});

test("video rewards explicitly return paused without awarding coins", () => {
  assert.deepEqual(pausedVideoRewardResponse(), {
    rewarded: false,
    coins: 0,
    message: "Video rewards are paused until verified playback is available.",
  });
});