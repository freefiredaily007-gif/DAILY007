import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePaymentReference,
  parseCoinPackages,
  pausedVideoRewardResponse,
  referralCodeForUserId,
} from "../src/lib/daily007-compat-extra-validation.ts";

test("payment reference normalization is trim-, case-, and Unicode-width-insensitive", () => {
  assert.equal(normalizePaymentReference("  abc-123  "), "ABC-123");
  assert.equal(normalizePaymentReference("ＡＢＣ-１２３"), "ABC-123");
  assert.equal(normalizePaymentReference("AbC-123"), normalizePaymentReference(" abc-123 "));
});

test("coin packages accept unique whole-number amounts within configured purchase limits", () => {
  assert.deepEqual(parseCoinPackages(" 100, 250,1000 ", 100, 5000), [100, 250, 1000]);
  assert.deepEqual(parseCoinPackages("", 100, 5000), []);
  assert.equal(parseCoinPackages("100,100", 100, 5000), null);
  assert.equal(parseCoinPackages("99,500", 100, 5000), null);
  assert.equal(parseCoinPackages("100.5,500", 1, 5000), null);
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