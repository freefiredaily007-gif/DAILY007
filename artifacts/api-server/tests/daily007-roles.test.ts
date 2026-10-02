import assert from "node:assert/strict";
import test from "node:test";
import {
  hasTournamentAdminAccess,
  isAssignableTournamentRole,
  isFullAdminRole,
} from "../src/lib/daily007-roles.ts";

test("Tournament Admin can access tournament operations but not full-admin operations", () => {
  assert.equal(hasTournamentAdminAccess("tournament_admin"), true);
  assert.equal(isFullAdminRole("tournament_admin"), false);
  assert.equal(hasTournamentAdminAccess("admin"), true);
  assert.equal(isFullAdminRole("admin"), true);
  assert.equal(hasTournamentAdminAccess("user"), false);
  assert.equal(isFullAdminRole("user"), false);
});

test("only player and Tournament Admin roles can be assigned through User Management", () => {
  assert.equal(isAssignableTournamentRole("user"), true);
  assert.equal(isAssignableTournamentRole("tournament_admin"), true);
  assert.equal(isAssignableTournamentRole("admin"), false);
  assert.equal(isAssignableTournamentRole("owner"), false);
});