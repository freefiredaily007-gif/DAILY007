import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { logoutDaily007 } from "../src/lib/logout.ts";

const [
  app,
  auth,
  fixture,
  route,
  successfulFlow,
  failedFlow,
  restoreFlow,
  runner,
  emulatorScript,
] = await Promise.all([
  readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/Auth.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/LogoutNativeTest.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/logout-native-test.tsx", import.meta.url), "utf8"),
  readFile(new URL("../maestro/logout/delayed-success.yaml", import.meta.url), "utf8"),
  readFile(new URL("../maestro/logout/delayed-failure.yaml", import.meta.url), "utf8"),
  readFile(new URL("../maestro/logout/restore-session.yaml", import.meta.url), "utf8"),
  readFile(new URL("./run-android-logout.mjs", import.meta.url), "utf8"),
  readFile(new URL("../../../.github/scripts/android-emulator-verification.sh", import.meta.url), "utf8"),
]);

test("native logout fixture exercises the production DailyApp handler and is development-only", () => {
  assert.match(app, /export function DailyAppLogoutNativeTest/);
  assert.match(app, /if \(!__DEV__\) return null/);
  assert.match(app, /testInitialUser=\{logoutNativeTestUser\}/);
  assert.match(route, /LogoutNativeTest/);
  assert.match(fixture, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(fixture, /new Promise<void>\(\(resolve, reject\) =>/);
  assert.match(fixture, /Simulated Clerk sign-out failure/);
});

test("local logout finishes before Clerk and reports either Clerk outcome", async () => {
  for (const clerkOutcome of ["success", "failure"]) {
    const events = [];
    let finishClerkSignOut;
    const logout = logoutDaily007(
      () => {
        events.push("clerk-started");
        return new Promise((resolve, reject) => {
          finishClerkSignOut = clerkOutcome === "success" ? resolve : reject;
        });
      },
      async () => { events.push("local-session-cleared"); },
    );

    await Promise.resolve();
    assert.deepEqual(events, ["local-session-cleared", "clerk-started"]);
    finishClerkSignOut(clerkOutcome === "success" ? undefined : new Error("Clerk unavailable"));
    assert.equal(await logout, clerkOutcome === "failure");
  }
});

test("pending logout hides signed-in and auth screens while rejecting repeated requests", () => {
  const logoutStart = app.indexOf("const logout = useCallback(async () => {");
  const duplicateGuard = app.indexOf("if (logoutInFlight.current) return;", logoutStart);
  const startLock = app.indexOf("logoutInFlight.current = true;", logoutStart);
  const clerkCall = app.indexOf("await logoutDaily007(signOutClerk", logoutStart);
  const pendingBranch = app.indexOf('testID="logout-pending"');
  const repeatAction = app.indexOf('testID="logout-test-repeat"');
  assert.ok(logoutStart >= 0 && duplicateGuard > logoutStart && startLock > duplicateGuard);
  assert.ok(clerkCall > startLock && pendingBranch > clerkCall);
  assert.ok(repeatAction > pendingBranch);
  assert.match(successfulFlow, /assertNotVisible:[\s\S]*?id: auth-login-tab/);
  assert.match(successfulFlow, /logout-test-repeat/);
  assert.match(successfulFlow, /Clerk sign-out calls: 1/);
  assert.match(successfulFlow, /Clerk sign-out calls: 2/);
});

test("Android flows finish delayed Clerk sign-out with success and failure and confirm auth", () => {
  for (const flow of [successfulFlow, failedFlow]) {
    assert.match(flow, /id: logout-pending/);
    assert.match(flow, /id: auth-login-tab/);
    assert.match(flow, /id: auth-screen/);
    assert.match(flow, /id: admin-header-logout-control/);
  }
  assert.match(successfulFlow, /id: logout-test-resolve/);
  assert.match(failedFlow, /id: logout-test-reject/);
  assert.match(failedFlow, /visible: "Sign-out issue"/);
  assert.match(auth, /testID="auth-screen"/);
  assert.match(fixture, /SESSION_BACKUP_KEY/);
  assert.match(restoreFlow, /scenario=cleanup/);
});

test("Android logout runner restores the saved session and is part of API 35 verification", () => {
  assert.match(runner, /delayed-success\.yaml/);
  assert.match(runner, /delayed-failure\.yaml/);
  assert.match(runner, /restore-session\.yaml/);
  assert.match(runner, /EXPO_DEV_URL/);
  assert.match(emulatorScript, /run_maestro_suite clerk-logout test:android-logout/);
});
