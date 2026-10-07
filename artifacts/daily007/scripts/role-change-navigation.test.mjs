import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  adminNavigationForRole,
  canNavigateAdminScreen,
  refreshAccessAfterPending,
  refreshAccessIfActive,
  refreshUserAccountAccess,
  refreshUserAccountAccessSafely,
  rootNavigationForRole,
} from "../src/lib/roleNavigation.ts";

const ADMIN_NAV_KEYS = [
  "dashboard",
  "leaderboards",
  "tournaments",
  "registrations",
  "payments",
  "wallet",
  "earnTasks",
  "videos",
  "users",
  "notifications",
  "settings",
];
const SENSITIVE_ADMIN_SCREEN_KEYS = [
  "payments",
  "wallet",
  "leaderboards",
  "earnTasks",
  "videos",
];
const TOURNAMENT_ADMIN_NAV_KEYS = ["tournaments", "registrations"];
const PLAYER_TAB_NAMES = ["Home", "Video", "Earn", "Wallet", "Profile"];
const ADMIN_NAV_ITEMS = ADMIN_NAV_KEYS.map((key) => ({ key }));

async function applyMockRoleRefresh(previousRole, refreshedRole) {
  const previousUser = {
    id: "current-account",
    name: "Current Player",
    email: "current-player@example.test",
    role: previousRole,
    token: "same-saved-daily007-session",
  };
  let currentUser = previousUser;
  let savedSession = previousUser;
  let accountRefreshCalls = 0;

  const mockApi = {
    async meAccount() {
      accountRefreshCalls += 1;
      return {
        id: previousUser.id,
        name: previousUser.name,
        email: previousUser.email,
        role: refreshedRole,
        token: undefined,
      };
    },
  };
  const updatedUser = await refreshUserAccountAccess(
    currentUser,
    () => mockApi.meAccount(),
    (refreshedUser) => {
      savedSession = refreshedUser;
      currentUser = refreshedUser;
    },
  );

  assert.equal(updatedUser, currentUser);
  return { currentUser, savedSession, accountRefreshCalls };
}

async function applyMockAccessRefreshFailure(error) {
  const initialUser = {
    id: "current-account",
    name: "Current Tournament Admin",
    email: "current-admin@example.test",
    role: "tournament_admin",
    token: "same-saved-daily007-session",
  };
  let currentUser = initialUser;
  let savedSession = initialUser;
  let commitCalls = 0;
  let rejectCalls = 0;

  const result = await refreshUserAccountAccessSafely(
    initialUser,
    async () => { throw error; },
    (updatedUser) => {
      commitCalls += 1;
      currentUser = updatedUser;
      savedSession = updatedUser;
    },
    () => {
      rejectCalls += 1;
      currentUser = null;
      savedSession = null;
    },
  );

  return {
    result,
    initialUser,
    currentUser,
    savedSession,
    commitCalls,
    rejectCalls,
    navigation: currentUser ? rootNavigationForRole(currentUser.role) : "Auth",
  };
}

async function applyMockRoleChangeOnResume(
  previousRole,
  refreshedRole,
  { pendingBeforeResume = false } = {},
) {
  const initialUser = {
    id: "current-account",
    name: "Current Player",
    email: "current-player@example.test",
    role: previousRole,
    token: "same-saved-daily007-session",
  };
  let currentUser = initialUser;
  let savedSession = initialUser;
  let accountRefreshCalls = 0;
  let sessionRejectionCalls = 0;
  let accessRefreshRequest = null;
  const resumeRefreshRequest = { current: null };
  let resolvePendingAccountResponse;
  const pendingAccountResponse = new Promise((resolve) => {
    resolvePendingAccountResponse = resolve;
  });

  const fetchAccount = async () => {
    accountRefreshCalls += 1;
    if (pendingBeforeResume && accountRefreshCalls === 1) {
      return pendingAccountResponse;
    }
    return { role: refreshedRole, token: undefined };
  };

  const refreshAccess = () => {
    if (accessRefreshRequest) return accessRefreshRequest;
    const request = refreshUserAccountAccessSafely(
      currentUser,
      fetchAccount,
      (updatedUser) => {
        currentUser = updatedUser;
        savedSession = updatedUser;
      },
      () => {
        currentUser = null;
        savedSession = null;
        sessionRejectionCalls += 1;
      },
    );
    accessRefreshRequest = request;
    void request.then(
      () => {
        if (accessRefreshRequest === request) accessRefreshRequest = null;
      },
      () => {
        if (accessRefreshRequest === request) accessRefreshRequest = null;
      },
    );
    return request;
  };

  let resumeRefreshPromise;
  const refreshOnResume = () => {
    resumeRefreshPromise = refreshAccessAfterPending(
      accessRefreshRequest,
      resumeRefreshRequest,
      refreshAccess,
    );
    return resumeRefreshPromise;
  };
  const preResumePromise = pendingBeforeResume ? refreshAccess() : null;
  const navigationBeforeResume = rootNavigationForRole(currentUser.role);
  refreshAccessIfActive("background", refreshOnResume);
  const callsBeforeResume = accountRefreshCalls;
  refreshAccessIfActive("active", refreshOnResume);
  const callsImmediatelyAfterResume = accountRefreshCalls;
  const firstResumePromise = resumeRefreshPromise;
  refreshAccessIfActive("active", refreshOnResume);
  const repeatedResumeWasCoalesced = resumeRefreshPromise === firstResumePromise;
  const callsAfterRepeatedResume = accountRefreshCalls;
  if (preResumePromise) {
    resolvePendingAccountResponse({ role: previousRole, token: undefined });
    await preResumePromise;
  }
  await resumeRefreshPromise;

  return {
    currentUser,
    savedSession,
    navigationBeforeResume,
    navigationAfterResume: currentUser ? rootNavigationForRole(currentUser.role) : "Auth",
    callsBeforeResume,
    callsImmediatelyAfterResume,
    repeatedResumeWasCoalesced,
    callsAfterRepeatedResume,
    accountRefreshCalls,
    sessionRejectionCalls,
  };
}

for (const [failureName, error] of [
  ["network", Object.assign(new Error("Network unavailable"), { code: "ERR_NETWORK" })],
  ["5xx", Object.assign(new Error("Server unavailable"), { response: { status: 503 } })],
]) {
  test(`${failureName} account-refresh failures preserve the current user, token, and navigation`, async () => {
    const state = await applyMockAccessRefreshFailure(error);

    assert.equal(state.result, null);
    assert.equal(state.currentUser, state.initialUser);
    assert.equal(state.savedSession, state.initialUser);
    assert.equal(state.savedSession.token, "same-saved-daily007-session");
    assert.equal(state.commitCalls, 0);
    assert.equal(state.rejectCalls, 0);
    assert.equal(state.navigation, "Admin");
    assert.deepEqual(
      adminNavigationForRole(state.currentUser.role, "tournaments", ADMIN_NAV_ITEMS),
      {
        activeScreen: "tournaments",
        visibleNavKeys: ["tournaments", "registrations"],
      },
    );
  });
}

for (const status of [401, 403]) {
  test(`${status} account-refresh responses clear the active session`, async () => {
    const state = await applyMockAccessRefreshFailure({ response: { status } });

    assert.equal(state.result, null);
    assert.equal(state.currentUser, null);
    assert.equal(state.savedSession, null);
    assert.equal(state.rejectCalls, 1);
    assert.equal(state.navigation, "Auth");
  });
}

test("a role change made in the background applies immediately when the app resumes", async () => {
  const state = await applyMockRoleChangeOnResume("user", "tournament_admin");

  assert.equal(state.callsBeforeResume, 0);
  assert.equal(state.callsImmediatelyAfterResume, 1);
  assert.equal(state.repeatedResumeWasCoalesced, true);
  assert.equal(state.callsAfterRepeatedResume, 1);
  assert.equal(state.accountRefreshCalls, 1);
  assert.equal(state.currentUser.id, "current-account");
  assert.equal(state.currentUser.role, "tournament_admin");
  assert.equal(state.currentUser.token, "same-saved-daily007-session");
  assert.equal(state.savedSession.id, "current-account");
  assert.equal(state.savedSession.role, "tournament_admin");
  assert.equal(state.savedSession.token, "same-saved-daily007-session");
  assert.equal(state.navigationBeforeResume, "Tabs");
  assert.equal(state.navigationAfterResume, "Admin");
  assert.deepEqual(
    adminNavigationForRole(state.currentUser.role, "dashboard", ADMIN_NAV_ITEMS),
    {
      activeScreen: "tournaments",
      visibleNavKeys: ["tournaments", "registrations"],
    },
  );
  assert.equal(state.sessionRejectionCalls, 0);
});

test("a resume queues a fresh role refresh behind an older in-flight request", async () => {
  const state = await applyMockRoleChangeOnResume(
    "user",
    "tournament_admin",
    { pendingBeforeResume: true },
  );

  assert.equal(state.callsBeforeResume, 1);
  assert.equal(state.callsImmediatelyAfterResume, 1);
  assert.equal(state.repeatedResumeWasCoalesced, true);
  assert.equal(state.callsAfterRepeatedResume, 1);
  assert.equal(state.accountRefreshCalls, 2);
  assert.equal(state.currentUser.role, "tournament_admin");
  assert.equal(state.savedSession.role, "tournament_admin");
  assert.equal(state.savedSession.token, "same-saved-daily007-session");
  assert.equal(state.navigationAfterResume, "Admin");
  assert.equal(state.sessionRejectionCalls, 0);
});

test("a Full Admin demoted in the background loses restricted screens on resume", async () => {
  const state = await applyMockRoleChangeOnResume("admin", "tournament_admin");

  assert.equal(state.callsBeforeResume, 0);
  assert.equal(state.callsImmediatelyAfterResume, 1);
  assert.equal(state.repeatedResumeWasCoalesced, true);
  assert.equal(state.callsAfterRepeatedResume, 1);
  assert.equal(state.accountRefreshCalls, 1);
  assert.equal(state.currentUser.id, "current-account");
  assert.equal(state.currentUser.role, "tournament_admin");
  assert.equal(state.savedSession.token, "same-saved-daily007-session");
  assert.equal(state.navigationBeforeResume, "Admin");
  assert.equal(state.navigationAfterResume, "Admin");
  assert.deepEqual(
    adminNavigationForRole(state.currentUser.role, "wallet", ADMIN_NAV_ITEMS),
    {
      activeScreen: "tournaments",
      visibleNavKeys: ["tournaments", "registrations"],
    },
  );
  assert.equal(canNavigateAdminScreen(state.currentUser.role, "wallet"), false);
  assert.equal(state.sessionRejectionCalls, 0);
});

test("Player becomes a restricted Tournament Admin after the account refresh", async () => {
  const state = await applyMockRoleRefresh("user", "tournament_admin");

  assert.equal(state.accountRefreshCalls, 1);
  assert.equal(state.currentUser.role, "tournament_admin");
  assert.equal(state.currentUser.id, "current-account");
  assert.equal(state.currentUser.token, "same-saved-daily007-session");
  assert.equal(state.savedSession.token, state.currentUser.token);
  assert.equal(rootNavigationForRole(state.currentUser.role), "Admin");
  assert.deepEqual(
    adminNavigationForRole(state.currentUser.role, "dashboard", ADMIN_NAV_ITEMS),
    {
      activeScreen: "tournaments",
      visibleNavKeys: ["tournaments", "registrations"],
    },
  );
  assert.equal(canNavigateAdminScreen(state.currentUser.role, "tournaments"), true);
  assert.equal(canNavigateAdminScreen(state.currentUser.role, "wallet"), false);
});

test("Full Admin becomes a player after refresh without removing the saved sign-in", async () => {
  const state = await applyMockRoleRefresh("admin", "user");

  assert.equal(state.accountRefreshCalls, 1);
  assert.equal(state.currentUser.role, "user");
  assert.equal(state.currentUser.id, "current-account");
  assert.equal(state.currentUser.token, "same-saved-daily007-session");
  assert.equal(state.savedSession.token, state.currentUser.token);
  assert.equal(rootNavigationForRole(state.currentUser.role), "Tabs");
  assert.deepEqual(
    adminNavigationForRole(state.currentUser.role, "settings", ADMIN_NAV_ITEMS).visibleNavKeys,
    [],
  );
});

test("Full Admin can see and open payment, wallet, and reward management screens", () => {
  for (const screen of SENSITIVE_ADMIN_SCREEN_KEYS) {
    const navigation = adminNavigationForRole("admin", screen, ADMIN_NAV_ITEMS);

    assert.equal(navigation.activeScreen, screen, `Full Admin should open ${screen}`);
    assert.deepEqual(navigation.visibleNavKeys, ADMIN_NAV_KEYS);
    assert.equal(canNavigateAdminScreen("admin", screen), true);
  }
});

test("Tournament Admin cannot see or directly open payment, wallet, or reward management", () => {
  for (const screen of SENSITIVE_ADMIN_SCREEN_KEYS) {
    const navigation = adminNavigationForRole(
      "tournament_admin",
      screen,
      ADMIN_NAV_ITEMS,
    );

    assert.deepEqual(navigation, {
      activeScreen: "tournaments",
      visibleNavKeys: TOURNAMENT_ADMIN_NAV_KEYS,
    }, `Tournament Admin should fall back from ${screen}`);
    assert.equal(canNavigateAdminScreen("tournament_admin", screen), false);
    assert.equal(
      canNavigateAdminScreen("tournament_admin", navigation.activeScreen),
      true,
    );
  }
});

test("App and AdminApp use the tested refresh and role-navigation decisions", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const adminSource = await readFile(new URL("../src/screens/AdminApp.tsx", import.meta.url), "utf8");
  const refreshStart = appSource.indexOf("const refreshAccess = useCallback(");
  const refreshEnd = appSource.indexOf("\n  }, []);", refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, "The account-access refresh callback must remain.");
  const refreshSource = appSource.slice(refreshStart, refreshEnd);

  assert.match(refreshSource, /Api\.meAccount\(\)/);
  assert.match(refreshSource, /refreshUserAccountAccessSafely\(\s*previous,\s*\(\) => Api\.meAccount\(\)/);
  assert.match(refreshSource, /setSession\(refreshedUser\)/);
  assert.match(refreshSource, /setUser\(refreshedUser\)/);
  assert.match(refreshSource, /setSession\(null\)/);
  assert.match(refreshSource, /setUser\(null\)/);
  assert.doesNotMatch(refreshSource, /logoutDaily007|signOutClerk|Api\.me\(/);
  assert.match(appSource, /rootNavigationForRole\(user\.role\)/);
  assert.match(appSource, /rootNavigation === 'Admin'/);
  assert.match(appSource, /if \(!user\) return <Auth/);
  assert.match(
    appSource,
    /refreshAccessAfterPending\(\s*accessRefreshRequest\.current,\s*resumeAccessRefreshRequest,\s*refreshAccess/,
  );
  assert.match(
    appSource,
    /AppState\.addEventListener\('change', \(state\) => \{\s*refreshAccessIfActive\(state, refreshAccessOnResume\);\s*\}\)/,
  );
  assert.match(appSource, /if \(AppState\.currentState === 'active'\) void refreshAccess\(\)/);
  assert.match(appSource, /\}, 30_000\)/);
  for (const tabName of PLAYER_TAB_NAMES) {
    assert.match(appSource, new RegExp(`<Tab\\.Screen name="${tabName}"`));
  }

  assert.match(adminSource, /adminNavigationForRole\(user\.role, screen, NAV\)/);
  assert.match(adminSource, /canNavigateAdminScreen\(user\.role, next\)/);
  assert.match(
    adminSource,
    /const visibleNav = NAV\.filter\(\(item\) => navigation\.visibleNavKeys\.includes\(item\.key\)\);/,
  );
  assert.match(
    adminSource,
    /const navigate = \(next: string\) => \{\s*if \(canNavigateAdminScreen\(user\.role, next\)\) setScreen\(next\);\s*\};/,
  );
  assert.match(adminSource, /visibleNav\.map\(\(n\) =>/);
  for (const [key, component] of [
    ["payments", "AdminPayments"],
    ["wallet", "AdminWallet"],
    ["leaderboards", "AdminLeaderboards"],
    ["earnTasks", "AdminEarnTasks"],
    ["videos", "AdminVideos"],
  ]) {
    assert.match(adminSource, new RegExp(`\\{ key: '${key}', label:`));
    assert.match(adminSource, new RegExp(`${key}:\\s*${component}`));
  }
  assert.match(adminSource, /const activeScreen = navigation\.activeScreen/);
  assert.match(adminSource, /\[activeScreen\]\s*\|\|\s*AdminDashboard/);
  assert.match(adminSource, /<Screen\s+go=\{navigate\}/);
  assert.match(adminSource, /onPress=\{\(\) => navigate\(n\.key\)\}/);
});
