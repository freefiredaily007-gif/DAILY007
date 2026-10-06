import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  adminNavigationForRole,
  canNavigateAdminScreen,
  refreshUserAccountAccess,
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

test("Full Admin can see and open the Videos management screen", () => {
  const navigation = adminNavigationForRole("admin", "videos", ADMIN_NAV_ITEMS);

  assert.deepEqual(navigation, {
    activeScreen: "videos",
    visibleNavKeys: ADMIN_NAV_KEYS,
  });
  assert.equal(canNavigateAdminScreen("admin", "videos"), true);
});

test("Tournament Admin cannot see or directly open Videos management", () => {
  const navigation = adminNavigationForRole(
    "tournament_admin",
    "videos",
    ADMIN_NAV_ITEMS,
  );

  assert.deepEqual(navigation, {
    activeScreen: "tournaments",
    visibleNavKeys: ["tournaments", "registrations"],
  });
  assert.equal(canNavigateAdminScreen("tournament_admin", "videos"), false);
  assert.equal(canNavigateAdminScreen("tournament_admin", navigation.activeScreen), true);
});

test("App and AdminApp use the tested refresh and role-navigation decisions", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const adminSource = await readFile(new URL("../src/screens/AdminApp.tsx", import.meta.url), "utf8");
  const refreshStart = appSource.indexOf("const refreshAccess = useCallback(");
  const refreshEnd = appSource.indexOf("\n  }, []);", refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, "The account-access refresh callback must remain.");
  const refreshSource = appSource.slice(refreshStart, refreshEnd);

  assert.match(refreshSource, /Api\.meAccount\(\)/);
  assert.match(refreshSource, /refreshUserAccountAccess\(\s*previous,\s*\(\) => Api\.meAccount\(\)/);
  assert.match(refreshSource, /setSession\(refreshedUser\)/);
  assert.match(refreshSource, /setUser\(refreshedUser\)/);
  assert.doesNotMatch(refreshSource, /logoutDaily007|signOutClerk|Api\.me\(/);
  assert.match(appSource, /rootNavigationForRole\(user\.role\)/);
  assert.match(appSource, /rootNavigation === 'Admin'/);
  assert.match(appSource, /if \(!user\) return <Auth/);
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
  assert.match(adminSource, /\{ key: 'videos', label: 'Videos', icon: 'video' \}/);
  assert.match(adminSource, /videos:\s*AdminVideos/);
  assert.match(adminSource, /const activeScreen = navigation\.activeScreen/);
  assert.match(adminSource, /\[activeScreen\]\s*\|\|\s*AdminDashboard/);
  assert.match(adminSource, /<Screen\s+go=\{navigate\}/);
});
