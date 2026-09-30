import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@clerk/express";
import {
  chooseGoogleAccountAction,
  verifiedGoogleIdentity,
} from "../src/lib/daily007-google-auth-validation.ts";

test("Google identity requires both a verified Google external account and verified Clerk email", () => {
  const identity = verifiedGoogleIdentity({
    id: "user_clerk_123",
    firstName: "Daily",
    lastName: "Player",
    emailAddresses: [{
      emailAddress: "Player@Example.com",
      verification: { status: "verified" },
    }],
    externalAccounts: [{
      provider: "google",
      emailAddress: "player@example.com",
      firstName: "Google",
      lastName: "Player",
      verification: { status: "verified" },
    }],
  } as unknown as User);
  assert.deepEqual(identity, {
    clerkUserId: "user_clerk_123",
    email: "player@example.com",
    name: "Daily Player",
  });

  const unverified = verifiedGoogleIdentity({
    id: "user_clerk_123",
    emailAddresses: [{ emailAddress: "player@example.com", verification: { status: "unverified" } }],
    externalAccounts: [{
      provider: "google",
      emailAddress: "player@example.com",
      verification: { status: "verified" },
    }],
  } as unknown as User);
  assert.equal(unverified, null);
});

test("Google sign-in decisions prohibit automatic email linking and permit explicit same-email linking", () => {
  const base = {
    linkedUserId: null,
    linkedEmail: null,
    emailOwnerUserId: "local-user",
    localTokenUserId: null,
    verifiedEmail: "player@example.com",
  };
  assert.equal(chooseGoogleAccountAction(base), "email-conflict");
  assert.equal(chooseGoogleAccountAction({
    ...base,
    localTokenUserId: "local-user",
  }), "link");
  assert.equal(chooseGoogleAccountAction({
    ...base,
    emailOwnerUserId: null,
    localTokenUserId: null,
  }), "create");
});

test("linked identities are immutable to other local accounts and email mismatches", () => {
  const base = {
    linkedUserId: "linked-user",
    linkedEmail: "player@example.com",
    emailOwnerUserId: "linked-user",
    localTokenUserId: null,
    verifiedEmail: "player@example.com",
  };
  assert.equal(chooseGoogleAccountAction(base), "existing");
  assert.equal(chooseGoogleAccountAction({
    ...base,
    localTokenUserId: "other-user",
  }), "linked-elsewhere");
  assert.equal(chooseGoogleAccountAction({
    ...base,
    linkedEmail: "changed@example.com",
  }), "email-mismatch");
});