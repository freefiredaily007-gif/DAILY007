import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test, { mock } from "node:test";
import ts from "typescript";
import {
  restoreDaily007Session,
  runSingleFlight,
  subscribeToSessionVerificationRecovery,
} from "../src/lib/session-verification.ts";

const SESSION_KEY = "daily007_v2_session";
const savedSession = {
  id: "test-player",
  name: "Test Player",
  email: "player@example.test",
  token: "saved-test-token",
};

let storedSession = null;
let rejectedStoredSessionWrites = 0;
const mockedStorage = {
  async getItem(key) {
    assert.equal(key, SESSION_KEY);
    return storedSession;
  },
  async setItem(key, value) {
    assert.equal(key, SESSION_KEY);
    if (rejectedStoredSessionWrites > 0) {
      rejectedStoredSessionWrites -= 1;
      throw new Error("Mock AsyncStorage rejected the session refresh.");
    }
    storedSession = value;
  },
  async removeItem(key) {
    assert.equal(key, SESSION_KEY);
    storedSession = null;
  },
  rejectNextSessionWrites(count = 1) {
    assert.ok(Number.isInteger(count) && count > 0);
    rejectedStoredSessionWrites = count;
  },
  clearSessionWriteRejection() {
    rejectedStoredSessionWrites = 0;
  },
};

mock.module("@react-native-async-storage/async-storage", {
  defaultExport: mockedStorage,
});
mock.module("@workspace/api-client-react", {
  namedExports: { setAuthExpiredHandler() {} },
});
mock.module("expo-constants", {
  defaultExport: { expoConfig: null },
});
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        error?.code === "ERR_MODULE_NOT_FOUND" &&
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !/\.[a-z\d]+$/i.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const {
  Api,
  captureSessionRevision,
  currentUser,
  getSession,
  http,
  setSession,
  setSessionForAuthAttempt,
} = await import("../src/lib/api.ts");
const profileSource = await readFile(
  new URL("../src/screens/Profile.tsx", import.meta.url),
  "utf8",
);
const profileSourceFile = ts.createSourceFile(
  "Profile.tsx",
  profileSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function mockStorage(initialSession = savedSession) {
  let value = initialSession ? JSON.stringify(initialSession) : null;
  let removeCalls = 0;
  return {
    async getItem(key) {
      assert.equal(key, SESSION_KEY);
      return value;
    },
    async setItem(key, nextValue) {
      assert.equal(key, SESSION_KEY);
      value = nextValue;
    },
    async removeItem(key) {
      assert.equal(key, SESSION_KEY);
      removeCalls += 1;
      value = null;
    },
    readSession() {
      return value ? JSON.parse(value) : null;
    },
    get removeCalls() {
      return removeCalls;
    },
  };
}

function responseError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

async function restoreFromMockStorage(storage, verifyWithApi) {
  return restoreDaily007Session(
    async () => {
      const raw = await storage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    },
    verifyWithApi,
    async (session) => {
      if (session) await storage.setItem(SESSION_KEY, JSON.stringify(session));
      else await storage.removeItem(SESSION_KEY);
    },
  );
}

function prepareApiSession() {
  setSession(null);
  storedSession = JSON.stringify(savedSession);
}

function mockApiRequests(t, {
  accountFailure,
  statsFailure,
  statsResponse,
  accountResponse,
  client = http,
} = {}) {
  const requests = [];
  t.mock.method(client, "get", async (path) => {
    requests.push(path);
    if (path === "/auth/me") {
      if (accountFailure) throw accountFailure;
      return {
        data: {
          id: "verified-player",
          name: "Verified Player",
          email: "verified@example.test",
          phone: "5550107",
          gameUid: "FF-VERIFIED",
          role: "user",
          status: "active",
          coins: 17,
          walletCoins: 17,
          ...accountResponse,
        },
      };
    }
    if (path === "/me/stats") {
      if (statsFailure) throw statsFailure;
      return { data: statsResponse };
    }
    assert.fail(`Unexpected API request: ${path}`);
  });
  return requests;
}

test("Google-link status checks use /auth/me and retain the current Daily007 token", async (t) => {
  prepareApiSession();
  const requests = mockApiRequests(t, {
    accountResponse: { googleLinked: true },
  });

  assert.equal(await Api.googleLinkStatus(), true);
  assert.deepEqual(requests, ["/auth/me"]);
  assert.equal((await getSession()).token, savedSession.token);
});

test("a temporary Google-link status failure rejects without clearing the Daily007 session", async (t) => {
  prepareApiSession();
  const requests = mockApiRequests(t, {
    accountFailure: Object.assign(new Error("Temporary server error"), {
      response: { status: 503 },
    }),
  });

  await assert.rejects(Api.googleLinkStatus(), /Temporary server error/);
  assert.deepEqual(requests, ["/auth/me"]);
  assert.equal((await getSession()).token, savedSession.token);
});

test("a response without a confirmed Google-link boolean is not treated as unlinked", async (t) => {
  prepareApiSession();
  const requests = mockApiRequests(t);

  await assert.rejects(Api.googleLinkStatus(), /could not confirm your Google connection status/);
  assert.deepEqual(requests, ["/auth/me"]);
  assert.equal((await getSession()).token, savedSession.token);
});

function createProfileScreen(
  user,
  {
    react = React,
    getUser = () => user,
    refresh = async () => user,
    renderComponent = false,
    width = 402,
    fontScale = 1,
    googleLinkStatus = async () => false,
    useFocusEffect = () => {},
  } = {},
) {
  let profileDeclaration = null;

  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "Profile") {
      profileDeclaration = node;
    }
    ts.forEachChild(node, visit);
  }

  visit(profileSourceFile);
  assert.ok(profileDeclaration, "Profile should export its screen component.");
  const componentSource = profileDeclaration
    .getText(profileSourceFile)
    .replace(/^export\s+default\s+/, "");
  const javascript = ts.transpileModule(componentSource, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const s = new Proxy({}, {
    get: (_target, key) => ({ profileStyle: String(key) }),
  });
  const View = ({
    children,
    style,
    accessible,
    accessibilityRole,
    accessibilityLabel,
    importantForAccessibility,
  }) => {
    const styleList = Array.isArray(style) ? style : [style];
    const isStatCard = styleList.some((entry) => entry?.profileStyle === "stat");
    const isStats = styleList.some((entry) => entry?.profileStyle === "stats");
    const isTwoColumnStats = styleList.some((entry) => entry?.profileStyle === "statsLarge");
    const isLargeStatCard = styleList.some((entry) => entry?.profileStyle === "statLarge");
    const accessibilityProps = {
      ...(accessible ? { "data-accessible": "true" } : {}),
      ...(accessibilityRole ? { role: accessibilityRole } : {}),
      ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}),
      ...(importantForAccessibility
        ? { "data-important-for-accessibility": importantForAccessibility }
        : {}),
    };
    return React.createElement(
      "div",
      isStats
        ? {
            "data-testid": "profile-stats",
            "data-two-column-layout": String(isTwoColumnStats),
          }
        : isStatCard
          ? {
              "data-testid": "profile-stat-card",
              "data-large-text-layout": String(isLargeStatCard),
              ...accessibilityProps,
            }
          : undefined,
      children,
    );
  };
  const Text = ({
    children,
    style,
    accessibilityLabel,
    accessibilityLiveRegion,
    accessibilityElementsHidden,
    importantForAccessibility,
  }) => {
    const testId = style?.profileStyle === "statV"
      ? "profile-stat-value"
      : style?.profileStyle === "statL"
        ? "profile-stat-label"
        : undefined;
    const props = {
      ...(testId ? { "data-testid": testId } : {}),
      ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}),
      ...(accessibilityLiveRegion ? { "aria-live": accessibilityLiveRegion } : {}),
      ...(accessibilityElementsHidden ? { "aria-hidden": "true" } : {}),
      ...(importantForAccessibility
        ? { "data-important-for-accessibility": importantForAccessibility }
        : {}),
    };
    return React.createElement("span", props, children);
  };
  const Card = ({ children, testID }) => React.createElement(
    "section",
    testID ? { "data-testid": testID } : undefined,
    children,
  );
  const SectionTitle = ({ children }) => React.createElement("h2", null, children);
  const Button = ({
    title,
    children,
    testID,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityHint,
    accessibilityState,
  }) => React.createElement(
    "button",
    {
      ...(testID ? { "data-testid": testID } : {}),
      ...(onPress ? { onClick: onPress } : {}),
      ...(disabled ? { disabled: true } : {}),
      ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}),
      ...(accessibilityHint ? { "aria-description": accessibilityHint } : {}),
      ...(accessibilityState?.disabled ? { "aria-disabled": "true" } : {}),
      ...(accessibilityState?.busy ? { "aria-busy": "true" } : {}),
    },
    children ?? title,
  );
  const KeyValue = ({ k, v }) => React.createElement(
    "div",
    null,
    React.createElement("span", null, k),
    React.createElement("span", null, v),
  );
  const scope = {
    React: react,
    ScrollView: ({ children }) => React.createElement("main", null, children),
    View,
    Modal: ({ visible, children }) => visible
      ? React.createElement("div", null, children)
      : null,
    Text,
    Input: () => null,
    SectionTitle,
    Card,
    Btn: Button,
    KV: KeyValue,
    GoogleSSOButton: () => null,
    useWindowDimensions: () => ({ width, fontScale }),
    Platform: { OS: "android" },
    Application: { nativeApplicationVersion: "1.0.0", nativeBuildVersion: "7" },
    Constants: {
      expoConfig: { version: "1.0.0", android: { versionCode: 7 } },
    },
    useApp: () => ({ user: getUser(), refresh, logout() {} }),
    useNavigation: () => ({ navigate() {} }),
    useFocusEffect,
    useDaily007ChangePassword: () => ({
      mutateAsync: async () => {},
      isPending: false,
    }),
    Api: {
      adminBootstrapStatus: async () => ({ available: false }),
      googleLinkStatus,
    },
    apiError: () => "Request failed.",
    PROFILE_PASSWORD_MAX_LENGTH: 200,
    submitProfilePasswordChange: async () => null,
    nativeTextScaleTextProps: () => ({}),
    C: new Proxy({}, { get: (_target, key) => String(key) }),
    s,
  };
  const Profile = new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn Profile;`,
  )(...Object.values(scope));
  return renderComponent
    ? () => {
        react.beginRender?.();
        return Profile();
      }
    : react.createElement(Profile);
}

function createHookReact() {
  const slots = [];
  let cursor = 0;
  return {
    Fragment: Symbol("Fragment"),
    createElement(type, props, ...children) {
      return {
        type,
        props: {
          ...props,
          children: children.length === 0
            ? props?.children
            : children.length === 1
              ? children[0]
              : children,
        },
      };
    },
    useState(initialValue) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = initialValue;
      return [
        slots[slot],
        (value) => { slots[slot] = value; },
      ];
    },
    useRef(initialValue) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = { current: initialValue };
      return slots[slot];
    },
    useCallback(callback) {
      return callback;
    },
    useEffect() {},
    beginRender() {
      cursor = 0;
    },
  };
}

function renderHookTree(node, react) {
  if (node == null || typeof node === "boolean") return null;
  if (Array.isArray(node)) {
    return node.map((child) => renderHookTree(child, react));
  }
  if (typeof node !== "object" || !("type" in node)) return node;

  const { type, props = {} } = node;
  const children = renderHookTree(props.children, react);
  if (type === react.Fragment) return children;
  if (typeof type === "function") {
    return renderHookTree(type({ ...props, children }), react);
  }
  return react.createElement(type, props, children);
}

function findRenderedElement(node, predicate) {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRenderedElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (predicate(node)) return node;
  return findRenderedElement(node.props?.children, predicate);
}

function renderedTextContent(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderedTextContent).join("");
  return renderedTextContent(node.props?.children);
}

test("401 and 403 verification responses clear the saved session", async () => {
  for (const status of [401, 403]) {
    const storage = mockStorage();
    const result = await restoreFromMockStorage(storage, async () => {
      throw responseError(status);
    });

    assert.deepEqual(result, { status: "rejected" });
    assert.equal(storage.readSession(), null);
    assert.equal(storage.removeCalls, 1);
  }
});

test("a server error preserves the saved token and returns a retry state", async () => {
  const storage = mockStorage();
  const result = await restoreFromMockStorage(storage, async () => {
    throw responseError(503);
  });

  assert.deepEqual(result, { status: "retry", session: savedSession });
  assert.equal(storage.readSession().token, savedSession.token);
  assert.equal(storage.removeCalls, 0);
});

test("a network timeout preserves the saved token and returns a retry state", async () => {
  const storage = mockStorage();
  const timeout = Object.assign(new Error("timeout"), { code: "ECONNABORTED" });
  const result = await restoreFromMockStorage(storage, async () => {
    throw timeout;
  });

  assert.deepEqual(result, { status: "retry", session: savedSession });
  assert.equal(storage.readSession().token, savedSession.token);
  assert.equal(storage.removeCalls, 0);
});

test("temporary profile-statistics failures preserve the verified account", async (t) => {
  const failures = [
    {
      name: "a server error",
      error: Object.assign(new Error("HTTP 503"), {
        response: { status: 503, data: { error: "Statistics are unavailable." } },
      }),
      statsError: "Statistics are unavailable.",
    },
    {
      name: "a network failure",
      error: new Error("Network disconnected"),
      statsError: "Network disconnected",
    },
  ];

  for (const failure of failures) {
    await t.test(failure.name, async (subtest) => {
      prepareApiSession();
      const requests = mockApiRequests(subtest, { statsFailure: failure.error });

      const user = await Api.me();

      assert.deepEqual(requests, ["/auth/me", "/me/stats"]);
      assert.equal(user.id, "verified-player");
      assert.equal(user.name, "Verified Player");
      assert.equal(user.email, "verified@example.test");
      assert.equal(user.coins, 17);
      assert.equal(user.token, savedSession.token);
      assert.equal(user.matches, undefined);
      assert.equal(user.wins, undefined);
      assert.equal(user.kills, undefined);
      assert.equal(user.prizeCoins, undefined);
      assert.equal(user.statsError, failure.statsError);
    });
  }
});

test("successful profile statistics map every counter and leave statsError clear", async (t) => {
  const responses = [
    {
      name: "camel-case prizeCoins",
      stats: { matches: 27, wins: 11, kills: 94, prizeCoins: 640 },
      expectedPrizeCoins: 640,
    },
    {
      name: "supported snake-case prize_coins alias",
      stats: { matches: 18, wins: 6, kills: 52, prize_coins: 375 },
      expectedPrizeCoins: 375,
    },
    {
      name: "valid zero-valued totals",
      stats: { matches: 0, wins: 0, kills: 0, prizeCoins: 0 },
      expectedPrizeCoins: 0,
    },
    {
      name: "exact safe-integer boundary totals",
      stats: {
        matches: Number.MAX_SAFE_INTEGER,
        wins: String(Number.MAX_SAFE_INTEGER),
        kills: Number.MAX_SAFE_INTEGER,
        prizeCoins: String(Number.MAX_SAFE_INTEGER),
      },
      expected: {
        matches: Number.MAX_SAFE_INTEGER,
        wins: Number.MAX_SAFE_INTEGER,
        kills: Number.MAX_SAFE_INTEGER,
        prizeCoins: Number.MAX_SAFE_INTEGER,
      },
      expectedPrizeCoins: Number.MAX_SAFE_INTEGER,
    },
  ];

  for (const response of responses) {
    await t.test(response.name, async (subtest) => {
      prepareApiSession();
      const requests = mockApiRequests(subtest, {
        statsResponse: response.stats,
      });

      const user = await Api.me();

      assert.deepEqual(requests, ["/auth/me", "/me/stats"]);
      assert.equal(user.id, "verified-player");
      assert.equal(user.name, "Verified Player");
      assert.equal(user.email, "verified@example.test");
      assert.equal(user.coins, 17);
      assert.equal(user.token, savedSession.token);
      assert.equal(user.matches, response.expected?.matches ?? response.stats.matches);
      assert.equal(user.wins, response.expected?.wins ?? response.stats.wins);
      assert.equal(user.kills, response.expected?.kills ?? response.stats.kills);
      assert.equal(user.prizeCoins, response.expectedPrizeCoins);
      assert.equal(user.statsError, undefined);
    });
  }
});

function renderedProfileStatCards(markup) {
  return [...markup.matchAll(
    /<div data-testid="profile-stat-card"[^>]*><span data-testid="profile-stat-value"[^>]*>([^<]*)<\/span><span data-testid="profile-stat-label"[^>]*>([^<]*)<\/span><\/div>/g,
  )].map(([, value, label]) => [label, value]);
}

test("Profile renders successfully refreshed totals under their matching labels", async (t) => {
  prepareApiSession();
  const statsResponse = { matches: 27, wins: 11, kills: 94, prizeCoins: 640 };
  const requests = mockApiRequests(t, { statsResponse });
  const refreshedUser = await Api.me();

  assert.deepEqual(requests, ["/auth/me", "/me/stats"]);
  assert.equal(refreshedUser.matches, 27);
  assert.equal(refreshedUser.wins, 11);
  assert.equal(refreshedUser.kills, 94);
  assert.equal(refreshedUser.prizeCoins, 640);

  const markup = renderToStaticMarkup(createProfileScreen(refreshedUser));
  const statCards = renderedProfileStatCards(markup);

  assert.deepEqual(statCards, [
    ["MATCHES", "27"],
    ["WINS", "11"],
    ["KILLS", "94"],
    ["PRIZES", "🪙640"],
  ]);
  assert.doesNotMatch(markup, /Profile statistics are loading|Profile statistics unavailable:/);
});

test("Profile announces each total with its label and hides duplicate visual text", () => {
  const user = {
    ...savedSession,
    matches: 27,
    wins: 11,
    kills: 94,
    prizeCoins: 640,
  };
  const markup = renderToStaticMarkup(createProfileScreen(user));
  const statCards = [...markup.matchAll(
    /<div data-testid="profile-stat-card"([^>]*)>([\s\S]*?)<\/div>/g,
  )];
  const expectedAnnouncements = [
    "27 matches",
    "11 wins",
    "94 kills",
    "640 prize coins",
  ];

  assert.equal(statCards.length, 4);
  statCards.forEach(([, attributes, contents], index) => {
    assert.match(attributes, /data-accessible="true"/);
    assert.match(attributes, /role="text"/);
    assert.match(attributes, /data-important-for-accessibility="yes"/);
    assert.match(
      attributes,
      new RegExp(`aria-label="${expectedAnnouncements[index]}"`),
    );
    assert.equal(
      [...contents.matchAll(/aria-hidden="true"/g)].length,
      2,
      "Both visible text nodes should be hidden under the single stat announcement.",
    );
    assert.equal(
      [...contents.matchAll(/data-important-for-accessibility="no-hide-descendants"/g)].length,
      2,
    );
    assert.doesNotMatch(attributes, /🪙|coin icon/i, "Decorative coin art must not be in the spoken label.");
  });
});

function assertUnavailableProfileStatCards(markup, expectedAnnouncements) {
  const statCards = [...markup.matchAll(
    /<div data-testid="profile-stat-card"([^>]*)>([\s\S]*?)<\/div>/g,
  )];
  const expectedValues = ["—", "—", "—", "🪙—"];

  assert.equal(statCards.length, 4, "All four profile totals should render.");
  statCards.forEach(([, attributes, contents], index) => {
    assert.match(attributes, /data-accessible="true"/);
    assert.match(attributes, /role="text"/);
    assert.match(attributes, /data-important-for-accessibility="yes"/);
    assert.ok(
      attributes.includes(`aria-label="${expectedAnnouncements[index]}"`),
      `Stat card ${index + 1} should announce its unavailable state.`,
    );
    assert.doesNotMatch(attributes, /🪙|coin icon/i, "Decorative coin art must not be in the spoken label.");
    assert.equal(
      [...contents.matchAll(/aria-hidden="true"/g)].length,
      2,
      "Both visible text nodes should be hidden under the single stat announcement.",
    );
    assert.equal(
      [...contents.matchAll(/data-important-for-accessibility="no-hide-descendants"/g)].length,
      2,
    );
    assert.match(
      contents,
      new RegExp(`<span data-testid="profile-stat-value"[^>]*>${expectedValues[index]}</span>`),
      "Unavailable data should render a placeholder, not a stale total.",
    );
  });
}

test("Profile announces all four totals as unavailable while statistics are loading", () => {
  const user = { ...savedSession };
  const markup = renderToStaticMarkup(createProfileScreen(user));

  assertUnavailableProfileStatCards(markup, [
    "Matches unavailable while loading",
    "Wins unavailable while loading",
    "Kills unavailable while loading",
    "Prize coins unavailable while loading",
  ]);
  assert.match(markup, /Profile statistics are loading\./);
});

test("Profile announces all four totals as unavailable after a statistics failure", () => {
  const user = {
    ...savedSession,
    matches: 27,
    wins: 11,
    kills: 94,
    prizeCoins: 640,
    statsError: "Network disconnected",
  };
  const markup = renderToStaticMarkup(createProfileScreen(user));

  assertUnavailableProfileStatCards(markup, [
    "Matches unavailable",
    "Wins unavailable",
    "Kills unavailable",
    "Prize coins unavailable",
  ]);
  assert.match(markup, /Profile statistics unavailable: Network disconnected/);
});

test("Profile keeps large totals and labels inside stat cards at enlarged text scales", () => {
  const user = {
    ...savedSession,
    matches: 1234567,
    wins: 234567,
    kills: 7654321,
    prizeCoins: 98765432,
  };
  const expectedCards = [
    ["MATCHES", "1234567"],
    ["WINS", "234567"],
    ["KILLS", "7654321"],
    ["PRIZES", "🪙98765432"],
  ];
  const viewports = [
    { name: "standard", width: 402 },
    { name: "narrow", width: 320 },
  ];
  const scales = [1.5, 2];

  for (const viewport of viewports) {
    for (const fontScale of scales) {
      const markup = renderToStaticMarkup(createProfileScreen(user, {
        width: viewport.width,
        fontScale,
      }));
      assert.match(markup, /data-testid="profile-stats"/);
      assert.deepEqual(
        renderedProfileStatCards(markup),
        expectedCards,
        `${viewport.name} viewport at ${fontScale}× must keep every full total with its label`,
      );
      assert.equal(
        [...markup.matchAll(/data-large-text-layout="true"/g)].length,
        4,
        `${viewport.name} viewport at ${fontScale}× must use the two-column large-text cards`,
      );
    }
  }

  assert.match(
    profileSource,
    /statV: \{[^}]*maxWidth: '100%'[^}]*flexShrink: 1[^}]*textAlign: 'center'/,
    "Stat values should be able to shrink and wrap inside their cards.",
  );
  assert.match(
    profileSource,
    /statL: \{[^}]*maxWidth: '100%'[^}]*flexShrink: 1[^}]*textAlign: 'center'/,
    "Stat labels should be able to shrink and wrap inside their cards.",
  );
});

test("Profile keeps maximum safe-integer totals readable on narrow screens at enlarged text sizes", () => {
  const user = {
    ...savedSession,
    matches: Number.MAX_SAFE_INTEGER,
    wins: Number.MAX_SAFE_INTEGER,
    kills: Number.MAX_SAFE_INTEGER,
    prizeCoins: Number.MAX_SAFE_INTEGER,
  };
  const fullValue = "9007199254740991";
  const wrappedValue = "9007\u200B1992\u200B5474\u200B0991";
  const expectedCards = [
    ["MATCHES", wrappedValue],
    ["WINS", wrappedValue],
    ["KILLS", wrappedValue],
    ["PRIZES", `🪙\u200B${wrappedValue}`],
  ];
  const viewports = [320, 360];
  const scales = [1, 1.5, 2];

  for (const width of viewports) {
    for (const fontScale of scales) {
      const markup = renderToStaticMarkup(createProfileScreen(user, { width, fontScale }));
      assert.deepEqual(
        renderedProfileStatCards(markup),
        expectedCards,
        `${width}px viewport at ${fontScale}× must render every digit and its label`,
      );
      assert.match(
        markup,
        /data-testid="profile-stats" data-two-column-layout="true"/,
        `${width}px viewport at ${fontScale}× must give each total a wider card`,
      );
      const statCards = [...markup.matchAll(/<div data-testid="profile-stat-card"([^>]*)>/g)];
      assert.equal(statCards.length, 4);
      statCards.forEach(([, attributes], index) => {
        const spokenValue = index === 3 ? `${fullValue} prize coins` : `${fullValue} ${["matches", "wins", "kills"][index]}`;
        assert.ok(
          attributes.includes(`aria-label="${spokenValue}"`),
          `${width}px viewport at ${fontScale}× must keep the full accessible total`,
        );
      });
    }
  }
});

test("Profile shows unavailable totals after successful malformed statistics", async (t) => {
  prepareApiSession();
  const requests = mockApiRequests(t, {
    statsResponse: { matches: 9, wins: 2, kills: "many", prizeCoins: 120 },
  });
  const user = await Api.me();

  assert.deepEqual(requests, ["/auth/me", "/me/stats"]);
  assert.equal(user.id, "verified-player");
  assert.equal(user.name, "Verified Player");
  assert.equal(user.matches, undefined);
  assert.equal(user.wins, undefined);
  assert.equal(user.kills, undefined);
  assert.equal(user.prizeCoins, undefined);
  assert.equal(user.statsError, "Profile statistics response is incomplete.");

  const markup = renderToStaticMarkup(createProfileScreen(user));
  const statCards = renderedProfileStatCards(markup);

  assert.match(markup, /Verified Player/);
  assert.deepEqual(statCards, [
    ["MATCHES", "—"],
    ["WINS", "—"],
    ["KILLS", "—"],
    ["PRIZES", "🪙—"],
  ]);
  assert.equal(statCards.some(([, value]) => /\b0\b/.test(value)), false);
  assert.match(
    markup,
    /Profile statistics unavailable: Profile statistics response is incomplete\./,
  );
  assert.doesNotMatch(markup, /Profile statistics are loading/);
});

test("Profile retries unavailable statistics once and replaces the markers after success", async () => {
  const unavailableUser = {
    id: "verified-player",
    name: "Verified Player",
    email: "verified@example.test",
    coins: 17,
    token: savedSession.token,
    statsError: "Network disconnected",
  };
  const refreshedUser = {
    ...unavailableUser,
    matches: 27,
    wins: 11,
    kills: 94,
    prizeCoins: 640,
    statsError: undefined,
  };
  let currentUser = unavailableUser;
  let refreshCalls = 0;
  let resolveRefresh;
  const refreshPromise = new Promise((resolve) => {
    resolveRefresh = resolve;
  });
  const refresh = () => {
    refreshCalls += 1;
    return refreshPromise.then((nextUser) => {
      currentUser = nextUser;
      return nextUser;
    });
  };
  const react = createHookReact();
  const renderProfile = createProfileScreen(unavailableUser, {
    react,
    getUser: () => currentUser,
    refresh,
    renderComponent: true,
  });
  const render = () => renderHookTree(renderProfile(), react);
  const getRetryButton = (tree) => findRenderedElement(
    tree,
    (node) => node.type === "button" && node.props["data-testid"] === "profile-stats-retry",
  );

  let tree = render();
  let retryButton = getRetryButton(tree);
  assert.ok(retryButton, "Unavailable statistics should show a retry button.");
  assert.equal(retryButton.props["aria-label"], "Retry profile statistics");
  assert.equal(retryButton.props["aria-description"], "Refreshes your account and profile statistics.");
  assert.match(renderedTextContent(tree), /Profile statistics unavailable: Network disconnected/);
  assert.match(renderedTextContent(tree), /Verified Player/);

  const retryRequest = retryButton.props.onClick();
  assert.equal(refreshCalls, 1);
  tree = render();
  retryButton = getRetryButton(tree);
  assert.equal(retryButton.props.disabled, true);
  assert.equal(retryButton.props["aria-disabled"], "true");
  assert.equal(retryButton.props["aria-busy"], "true");
  await retryButton.props.onClick();
  assert.equal(refreshCalls, 1, "A second tap during refresh must not start another request.");

  resolveRefresh(refreshedUser);
  await retryRequest;
  tree = render();
  assert.equal(getRetryButton(tree), null);
  assert.doesNotMatch(renderedTextContent(tree), /Profile statistics unavailable:/);
  const statCards = [];
  const visit = (node) => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node.props?.["data-testid"] === "profile-stat-value") {
      statCards.push(renderedTextContent(node.props.children));
    }
    visit(node.props?.children);
  };
  visit(tree);
  assert.deepEqual(statCards, ["27", "11", "94", "🪙640"]);
});

test("Profile keeps unknown Google status separate from unlinked and allows retry after transient failures", async () => {
  const user = {
    id: "verified-player",
    name: "Verified Player",
    email: "verified@example.test",
    coins: 17,
    token: savedSession.token,
  };
  let calls = 0;
  const focusCallbacks = [];
  const react = createHookReact();
  const renderProfile = createProfileScreen(user, {
    react,
    renderComponent: true,
    googleLinkStatus: async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("Temporary server error"), {
          response: { status: 503 },
        });
      }
      if (calls === 2) throw new Error("Network disconnected");
      return false;
    },
    useFocusEffect: (callback) => focusCallbacks.push(callback),
  });
  const render = () => renderHookTree(renderProfile(), react);
  const getStatusRetry = (tree) => findRenderedElement(
    tree,
    (node) => node.type === "button" && node.props["data-testid"] === "profile-google-status-retry",
  );

  let tree = render();
  assert.equal(focusCallbacks.length, 2, "Profile should refresh account data and Google status on focus.");
  focusCallbacks[1]();
  await new Promise((resolve) => setImmediate(resolve));

  tree = render();
  assert.match(renderedTextContent(tree), /Google connection status unavailable/);
  assert.ok(getStatusRetry(tree), "An unavailable status should offer a server-check retry.");
  assert.equal(
    findRenderedElement(tree, (node) => node.props?.["data-testid"] === "profile-google-status-loading"),
    null,
  );

  await getStatusRetry(tree).props.onClick();
  tree = render();
  assert.equal(calls, 2);
  assert.match(renderedTextContent(tree), /Google connection status unavailable/);
  assert.ok(getStatusRetry(tree), "A transient retry failure should remain retryable.");
  assert.doesNotMatch(renderedTextContent(tree), /CONNECT GOOGLE/);

  await getStatusRetry(tree).props.onClick();
  tree = render();
  assert.equal(calls, 3);
  assert.match(renderedTextContent(tree), /CONNECT GOOGLE/);
  assert.match(renderedTextContent(tree), /Link Google to this password account/);
  assert.equal(getStatusRetry(tree), null);
  assert.equal(user.token, savedSession.token, "Status retries must not alter the Daily007 token.");
});

test("Profile keeps the account and unavailable totals after a failed retry", async () => {
  const unavailableUser = {
    id: "verified-player",
    name: "Verified Player",
    email: "verified@example.test",
    coins: 17,
    token: savedSession.token,
    statsError: "Network disconnected",
  };
  const stillUnavailableUser = {
    ...unavailableUser,
    statsError: "Statistics are still unavailable.",
  };
  let currentUser = unavailableUser;
  let refreshCalls = 0;
  const react = createHookReact();
  const renderProfile = createProfileScreen(unavailableUser, {
    react,
    getUser: () => currentUser,
    refresh: async () => {
      refreshCalls += 1;
      currentUser = stillUnavailableUser;
      return stillUnavailableUser;
    },
    renderComponent: true,
  });
  const render = () => renderHookTree(renderProfile(), react);
  let tree = render();
  const retryButton = findRenderedElement(
    tree,
    (node) => node.type === "button" && node.props["data-testid"] === "profile-stats-retry",
  );

  await retryButton.props.onClick();
  tree = render();
  assert.equal(refreshCalls, 1);
  assert.match(renderedTextContent(tree), /Verified Player/);
  assert.match(renderedTextContent(tree), /Profile statistics unavailable: Statistics are still unavailable\./);
  assert.match(renderedTextContent(tree), /—/);
  assert.ok(findRenderedElement(
    tree,
    (node) => node.type === "button" && node.props["data-testid"] === "profile-stats-retry",
  ));
});

test("successful but malformed profile statistics preserve the account and leave totals unavailable", async (t) => {
  const responses = [
    {
      name: "a missing prize coin total",
      stats: { matches: 9, wins: 2, kills: 31 },
    },
    {
      name: "a non-numeric kill total",
      stats: { matches: 9, wins: 2, kills: "many", prizeCoins: 120 },
    },
    {
      name: "a negative match total",
      stats: { matches: -1, wins: 2, kills: 31, prizeCoins: 120 },
    },
    {
      name: "a fractional kill total",
      stats: { matches: 9, wins: 2, kills: 31.5, prizeCoins: 120 },
    },
    {
      name: "a numeric total above the safe-integer boundary",
      stats: {
        matches: Number.MAX_SAFE_INTEGER + 1,
        wins: 2,
        kills: 31,
        prizeCoins: 120,
      },
    },
    {
      name: "a numeric-string total above the safe-integer boundary",
      stats: {
        matches: 9,
        wins: 2,
        kills: "9007199254740993",
        prizeCoins: 120,
      },
    },
    {
      name: "a null kill total",
      stats: { matches: 9, wins: 2, kills: null, prizeCoins: 120 },
    },
    {
      name: "a blank kill total",
      stats: { matches: 9, wins: 2, kills: " ", prizeCoins: 120 },
    },
  ];

  for (const response of responses) {
    await t.test(response.name, async (subtest) => {
      prepareApiSession();
      const requests = mockApiRequests(subtest, {
        statsResponse: response.stats,
      });

      const user = await Api.me();

      assert.deepEqual(requests, ["/auth/me", "/me/stats"]);
      assert.equal(user.id, "verified-player");
      assert.equal(user.name, "Verified Player");
      assert.equal(user.email, "verified@example.test");
      assert.equal(user.coins, 17);
      assert.equal(user.token, savedSession.token);
      assert.equal(user.matches, undefined);
      assert.equal(user.wins, undefined);
      assert.equal(user.kills, undefined);
      assert.equal(user.prizeCoins, undefined);
      assert.equal(user.statsError, "Profile statistics response is incomplete.");
    });
  }
});

test("401 and 403 from profile statistics still reject the session", async (t) => {
  for (const status of [401, 403]) {
    await t.test(`HTTP ${status}`, async (subtest) => {
      prepareApiSession();
      const failure = responseError(status);
      const requests = mockApiRequests(subtest, { statsFailure: failure });

      await assert.rejects(Api.me(), (error) => error === failure);
      assert.deepEqual(requests, ["/auth/me", "/me/stats"]);
    });
  }
});

test("a later successful retry restores the still-saved session", async () => {
  const storage = mockStorage();
  const failedAttempt = await restoreFromMockStorage(storage, async () => {
    throw responseError(503);
  });
  assert.equal(failedAttempt.status, "retry");
  assert.equal(storage.readSession().token, savedSession.token);

  const retry = await restoreFromMockStorage(storage, async () => ({
    ...savedSession,
    name: "Player Back Online",
  }));
  assert.equal(retry.status, "verified");
  assert.equal(retry.session.name, "Player Back Online");
  assert.equal(storage.readSession().token, savedSession.token);
  assert.equal(storage.removeCalls, 0);
});

test("restoring connectivity while verification is paused retries without user input", async () => {
  let networkListener;
  let networkState = { isConnected: false, isInternetReachable: false };
  let retries = 0;
  const network = {
    addNetworkStateListener(listener) {
      networkListener = listener;
      return { remove() {} };
    },
    async getNetworkStateAsync() {
      return networkState;
    },
  };
  const appState = {
    addEventListener() {
      return { remove() {} };
    },
  };

  const unsubscribe = subscribeToSessionVerificationRecovery(
    true,
    () => { retries += 1; },
    network,
    appState,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(retries, 0);

  networkState = { isConnected: true, isInternetReachable: true };
  networkListener(networkState);
  assert.equal(retries, 1);
  unsubscribe();
});

test("returning to the foreground rechecks connectivity and retries automatically", async () => {
  let appStateListener;
  let networkState = { isConnected: false, isInternetReachable: false };
  let retries = 0;
  const network = {
    addNetworkStateListener() {
      return { remove() {} };
    },
    async getNetworkStateAsync() {
      return networkState;
    },
  };
  const appState = {
    addEventListener(_event, listener) {
      appStateListener = listener;
      return { remove() {} };
    },
  };

  const unsubscribe = subscribeToSessionVerificationRecovery(
    true,
    () => { retries += 1; },
    network,
    appState,
  );
  await new Promise((resolve) => setImmediate(resolve));
  networkState = { isConnected: true, isInternetReachable: true };
  appStateListener("background");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(retries, 0);

  appStateListener("active");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(retries, 1);
  unsubscribe();
});

test("simultaneous reconnect and foreground events share one verification request", async (t) => {
  const [appSource, fixtureSource] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/screens/SessionVerificationNativeTest.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /runSingleFlight\(verificationRequest, async \(\) =>/);
  assert.match(fixtureSource, /runSingleFlight\(verificationRequest, async \(\) =>/);

  const outcomes = [
    { name: "verification succeeds", expectedStatus: "verified", fails: false },
    { name: "verification remains retryable", expectedStatus: "retry", fails: true },
  ];
  for (const outcome of outcomes) {
    await t.test(outcome.name, async () => {
      let networkListener;
      let appStateListener;
      let networkState = { isConnected: false, isInternetReachable: false };
      let resolveVerification;
      const verificationGate = new Promise((resolve) => {
        resolveVerification = resolve;
      });
      const requestSlot = { current: null };
      const requests = [];
      let verificationCalls = 0;
      let activeRequests = 0;
      let maximumActiveRequests = 0;

      const network = {
        addNetworkStateListener(listener) {
          networkListener = listener;
          return { remove() {} };
        },
        async getNetworkStateAsync() {
          return networkState;
        },
      };
      const appState = {
        addEventListener(_event, listener) {
          appStateListener = listener;
          return { remove() {} };
        },
      };
      const retry = () => {
        const request = runSingleFlight(requestSlot, async () => restoreDaily007Session(
          async () => savedSession,
          async () => {
            verificationCalls += 1;
            activeRequests += 1;
            maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
            try {
              await verificationGate;
              if (outcome.fails) throw new Error("Temporary network error.");
              return { ...savedSession, name: "Verified Player" };
            } finally {
              activeRequests -= 1;
            }
          },
          async () => {},
        ));
        requests.push(request);
      };

      const unsubscribe = subscribeToSessionVerificationRecovery(
        true,
        retry,
        network,
        appState,
      );
      await new Promise((resolve) => setImmediate(resolve));

      appStateListener("background");
      networkState = { isConnected: true, isInternetReachable: true };
      networkListener(networkState);
      appStateListener("active");
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(requests.length, 2, "Both recovery signals should reach the same retry path.");
      assert.strictEqual(requests[0], requests[1], "Concurrent retries should share one promise.");
      assert.equal(verificationCalls, 1, "Only one API verification should start.");
      assert.equal(activeRequests, 1);
      assert.equal(maximumActiveRequests, 1, "Verification requests must not overlap.");

      resolveVerification();
      const [result] = await Promise.all(requests);
      assert.equal(result.status, outcome.expectedStatus);
      if (outcome.fails) {
        assert.equal(result.session.token, savedSession.token, "A transient failure must retain the saved session.");
      } else {
        assert.equal(result.session.name, "Verified Player");
        assert.equal(result.session.token, savedSession.token);
      }
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(requestSlot.current, null, "The retry gate must clear after settling.");
      assert.equal(activeRequests, 0);
      unsubscribe();
    });
  }
});

test("repeated reconnect and resume events stay retryable until one verification succeeds", async () => {
  let networkListener;
  let appStateListener;
  let networkState = { isConnected: false, isInternetReachable: false };
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  let verificationCalls = 0;
  let verificationGate = Promise.resolve();
  let releaseVerification;
  const requestSlot = { current: null };
  const requests = [];
  const settledResults = [];
  const network = {
    addNetworkStateListener(listener) {
      networkListener = listener;
      return { remove() {} };
    },
    async getNetworkStateAsync() {
      return networkState;
    },
  };
  const appState = {
    addEventListener(_event, listener) {
      appStateListener = listener;
      return { remove() {} };
    },
  };
  const retry = () => {
    const request = runSingleFlight(requestSlot, async () => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      verificationCalls += 1;
      try {
        const result = await restoreDaily007Session(
          async () => savedSession,
          async () => {
            await verificationGate;
            if (verificationCalls <= 2) throw responseError(503);
            return { ...savedSession, name: "Verified after repeated reconnects" };
          },
          async () => {},
        );
        settledResults.push(result);
        return result;
      } finally {
        activeRequests -= 1;
      }
    });
    requests.push(request);
    return request;
  };

  const unsubscribe = subscribeToSessionVerificationRecovery(
    true,
    retry,
    network,
    appState,
  );
  await new Promise((resolve) => setImmediate(resolve));

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) {
      networkState = { isConnected: false, isInternetReachable: false };
      networkListener(networkState);
      appStateListener("background");
      appStateListener("active");
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(requests.length, (attempt - 1) * 2, "Offline and background events must not retry.");
    }

    const previousRequestCount = requests.length;
    verificationGate = new Promise((resolve) => {
      releaseVerification = resolve;
    });
    networkState = { isConnected: true, isInternetReachable: true };
    networkListener(networkState);
    appStateListener("background");
    appStateListener("active");
    await new Promise((resolve) => setImmediate(resolve));

    const cycleRequests = requests.slice(previousRequestCount);
    assert.equal(cycleRequests.length, 2, "Reconnect and resume should both reach the shared retry path.");
    assert.strictEqual(cycleRequests[0], cycleRequests[1], "Both events should share one in-flight request.");
    assert.equal(activeRequests, 1);
    assert.equal(maximumActiveRequests, 1, "Verification requests must never overlap.");
    assert.equal(verificationCalls, attempt, "Only one API verification should run in each cycle.");

    releaseVerification();
    const [result] = await Promise.all(cycleRequests);
    if (attempt < 3) {
      assert.equal(result.status, "retry", "Transient failures must leave the saved session retryable.");
      assert.equal(result.session.token, savedSession.token);
    } else {
      assert.equal(result.status, "verified");
      assert.equal(result.session.name, "Verified after repeated reconnects");
      assert.equal(result.session.token, savedSession.token);
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requestSlot.current, null, "The single-flight gate must reset after every settled attempt.");
    assert.equal(activeRequests, 0);
    assert.equal(settledResults.length, attempt);
    assert.equal(settledResults.at(-1).status, result.status);
  }

  assert.deepEqual(
    settledResults.map((result) => result.status),
    ["retry", "retry", "verified"],
  );
  unsubscribe();
});

test("a successful verification refreshes account data while retaining the saved token", async () => {
  const storage = mockStorage();
  const result = await restoreFromMockStorage(storage, async () => ({
    id: "test-player",
    name: "Updated Test Player",
    email: "player@example.test",
    token: undefined,
    coins: 12,
  }));

  assert.deepEqual(result, {
    status: "verified",
    session: {
      id: "test-player",
      name: "Updated Test Player",
      email: "player@example.test",
      token: savedSession.token,
      coins: 12,
    },
  });
  assert.equal(storage.readSession().token, savedSession.token);
  assert.equal(storage.readSession().name, "Updated Test Player");
});

test("startup discards damaged saved sessions without verification, then restores a later valid sign-in", async (t) => {
  let restartedApi;
  t.after(async () => {
    if (restartedApi) await restartedApi.setSession(null);
    await setSession(null);
  });

  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /restoreDaily007Session\(getSession, Api\.me, setSession\)/);
  assert.match(
    appSource,
    /finally \{\s*if \(mounted\) setBooting\(false\);\s*\}/,
    "Startup must leave its loading state after an empty-session result.",
  );
  assert.match(
    appSource,
    /if \(!user\) return <Auth/,
    "With no restored user or retry state, startup must render sign-in.",
  );

  const damagedRecords = [
    {
      name: "malformed JSON",
      raw: "{broken saved session",
    },
    {
      name: "record missing its token",
      raw: JSON.stringify({ id: "incomplete-player", name: "Incomplete Player" }),
    },
  ];

  for (const record of damagedRecords) {
    await t.test(record.name, async (subtest) => {
      await setSession(null);
      storedSession = record.raw;
      const requests = mockApiRequests(subtest);

      const result = await restoreDaily007Session(getSession, Api.me, setSession);

      assert.deepEqual(result, { status: "empty" });
      assert.equal(storedSession, null, "The damaged saved record must be removed.");
      assert.equal(currentUser(), null, "No player should be authenticated after discarding the record.");
      assert.equal(
        http.defaults.headers.common.Authorization,
        undefined,
        "A damaged record must not install an Authorization header.",
      );
      assert.deepEqual(requests, [], "Startup must not verify a damaged record with the API.");
    });
  }

  const signedInSession = {
    id: "signed-in-after-damaged-session",
    name: "Player Signed In Again",
    email: "signed-in-again@example.test",
    role: "user",
    token: "fresh-sign-in-token",
  };
  const authRevision = captureSessionRevision();
  assert.equal(
    await setSessionForAuthAttempt(signedInSession, authRevision),
    true,
    "A later valid sign-in should save successfully after damaged data is discarded.",
  );
  assert.deepEqual(JSON.parse(storedSession), signedInSession);

  restartedApi = await import("../src/lib/api.ts?fresh-damaged-session-startup");
  const requests = mockApiRequests(t, {
    client: restartedApi.http,
    accountResponse: {
      id: signedInSession.id,
      name: "Verified Again",
      email: signedInSession.email,
    },
    statsResponse: { matches: 4, wins: 2, kills: 8, prizeCoins: 30 },
  });
  const restored = await restoreDaily007Session(
    restartedApi.getSession,
    restartedApi.Api.me,
    restartedApi.setSession,
  );

  assert.equal(restored.status, "verified");
  assert.equal(restored.session.id, signedInSession.id);
  assert.equal(restored.session.name, "Verified Again");
  assert.equal(restored.session.token, signedInSession.token);
  assert.equal(restartedApi.currentUser().token, signedInSession.token);
  assert.equal(JSON.parse(storedSession).token, signedInSession.token);
  assert.deepEqual(requests, ["/auth/me", "/me/stats"]);
});

test("a verified account stays retryable when saving refreshed session data fails", async (t) => {
  t.after(async () => {
    mockedStorage.clearSessionWriteRejection();
    await setSession(null);
  });
  await setSession(savedSession);
  mockedStorage.rejectNextSessionWrites(2);
  const requests = mockApiRequests(t, {
    statsResponse: { matches: 12, wins: 4, kills: 39, prizeCoins: 85 },
  });

  const failedSave = await restoreDaily007Session(
    async () => savedSession,
    Api.me,
    setSession,
  );
  assert.deepEqual(failedSave, { status: "retry", session: savedSession });
  assert.deepEqual(JSON.parse(storedSession), savedSession, "A failed refresh write must retain the full saved session.");
  assert.deepEqual(await getSession(), savedSession, "The in-memory session must retain its previous account data and token.");
  assert.deepEqual(requests, ["/auth/me", "/me/stats"], "Account verification itself should have succeeded.");

  const failedSecondSave = await restoreDaily007Session(
    async () => failedSave.session,
    Api.me,
    setSession,
  );
  assert.deepEqual(
    failedSecondSave,
    { status: "retry", session: savedSession },
    "A second failed write must leave verification retryable with the original session.",
  );
  assert.deepEqual(
    JSON.parse(storedSession),
    savedSession,
    "A second failed refresh write must retain the complete original stored session.",
  );
  assert.deepEqual(
    await getSession(),
    savedSession,
    "A second failed write must retain the original in-memory account data and token.",
  );
  assert.deepEqual(
    requests,
    ["/auth/me", "/me/stats", "/auth/me", "/me/stats"],
    "The second verification attempt should use only mocked API requests.",
  );

  const recovered = await restoreDaily007Session(
    async () => failedSecondSave.session,
    Api.me,
    setSession,
  );
  assert.equal(recovered.status, "verified", "A later successful storage write should complete verification.");
  assert.equal(recovered.session.id, "verified-player");
  assert.equal(recovered.session.name, "Verified Player");
  assert.equal(recovered.session.coins, 17);
  assert.equal(recovered.session.matches, 12);
  assert.equal(recovered.session.token, savedSession.token, "The refreshed account must keep the saved token.");
  const persistedAfterRecovery = JSON.parse(storedSession);
  assert.equal(persistedAfterRecovery.id, recovered.session.id);
  assert.equal(persistedAfterRecovery.name, recovered.session.name);
  assert.equal(persistedAfterRecovery.coins, recovered.session.coins);
  assert.equal(persistedAfterRecovery.matches, recovered.session.matches);
  assert.equal(persistedAfterRecovery.wins, recovered.session.wins);
  assert.equal(persistedAfterRecovery.kills, recovered.session.kills);
  assert.equal(persistedAfterRecovery.prizeCoins, recovered.session.prizeCoins);
  assert.equal(persistedAfterRecovery.token, savedSession.token);
  assert.equal((await getSession()).id, "verified-player");
  assert.deepEqual(
    requests,
    ["/auth/me", "/me/stats", "/auth/me", "/me/stats", "/auth/me", "/me/stats"],
    "The later retry should verify the account again using only mocked API requests.",
  );
});

test("a fresh verification flow recovers after a refreshed-session write fails", async (t) => {
  t.after(async () => {
    mockedStorage.clearSessionWriteRejection();
    await setSession(null);
  });
  await setSession(savedSession);
  mockedStorage.rejectNextSessionWrites();
  const statsResponse = { matches: 12, wins: 4, kills: 39, prizeCoins: 85 };
  const firstRequests = mockApiRequests(t, { statsResponse });

  const firstVerification = await restoreDaily007Session(
    async () => savedSession,
    Api.me,
    setSession,
  );
  assert.deepEqual(firstVerification, { status: "retry", session: savedSession });
  assert.deepEqual(
    JSON.parse(storedSession),
    savedSession,
    "A failed refresh write must leave the saved session available for the next app start.",
  );
  assert.deepEqual(await getSession(), savedSession);
  assert.deepEqual(firstRequests, ["/auth/me", "/me/stats"]);

  const restartedApi = await import("../src/lib/api.ts?fresh-session-verification");
  const restartRequests = mockApiRequests(t, {
    statsResponse,
    client: restartedApi.http,
  });
  const afterRestart = await restoreDaily007Session(
    restartedApi.getSession,
    restartedApi.Api.me,
    restartedApi.setSession,
  );

  assert.equal(afterRestart.status, "verified");
  assert.equal(afterRestart.session.id, "verified-player");
  assert.equal(afterRestart.session.name, "Verified Player");
  assert.equal(afterRestart.session.coins, 17);
  assert.equal(afterRestart.session.matches, 12);
  assert.equal(afterRestart.session.wins, 4);
  assert.equal(afterRestart.session.kills, 39);
  assert.equal(afterRestart.session.prizeCoins, 85);
  assert.equal(afterRestart.session.token, savedSession.token);
  const expectedStoredSession = { ...afterRestart.session };
  delete expectedStoredSession.statsError;
  assert.deepEqual(
    JSON.parse(storedSession),
    expectedStoredSession,
    "The restarted app should persist the full refreshed account with the original token.",
  );
  assert.equal((await restartedApi.getSession()).token, savedSession.token);
  assert.deepEqual(
    restartRequests,
    ["/auth/me", "/me/stats"],
    "The restarted verification should use only the mocked API routes.",
  );
});

test("App keeps the verification retry screen until refreshed session data is saved", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const pausedScreen = await readFile(
    new URL("../src/components/SessionVerificationPaused.tsx", import.meta.url),
    "utf8",
  );
  assert.match(appSource, /result\.status === 'retry'\) setVerificationSession\(result\.session\)/);
  assert.match(appSource, /if \(mounted\) setSessionReadFailed\(true\)/);
  assert.match(appSource, /if \(!user && sessionReadFailed\) return/);
  assert.match(appSource, /else void retrySessionRead\(\)/);
  assert.match(
    appSource,
    /message="Daily007 could not read your saved sign-in from this device\. It has not been cleared\./,
  );
  assert.match(appSource, /if \(result\.status === 'verified'\) \{\s*setVerificationSession\(null\);\s*setUser\(result\.session\);\s*\}/);
  assert.match(appSource, /if \(!user && verificationSession\) return/);
  assert.match(pausedScreen, /Your session is still saved/);
  assert.match(pausedScreen, /testID="session-verification-retry"/);
  assert.match(appSource, /restoreDaily007Session\(\s*async \(\) => savedSession/);
  assert.match(appSource, /subscribeToSessionVerificationRecovery\(/);
  assert.match(appSource, /void retrySessionVerification\(\)/);
  assert.match(appSource, /runSingleFlight\(verificationRequest, async \(\) =>/);
});
