import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  copyReferralLinkToClipboard,
  copyReferralLinkToClipboardWithFallback,
  openReferralInBrowserWithFallback,
  referralBrowserOpenFallbackMessage,
  referralInviteCopyFallbackMessage,
  referralShareFallbackMessage,
  referralSignupFromUrl,
  shareReferralInvite,
  shareReferralInviteWithFallback,
} from "../src/lib/referral-invite.ts";

const configuredDomain = "daily007.example.test";
const nativeContext = { platform: "native", configuredDomain };

function loadEarnAction(source, actionName, dependencies) {
  const marker = `  const ${actionName} = async () => {`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Earn should define its ${actionName} action.`);
  const bodyStart = start + marker.length;
  const end = source.indexOf("\n  };", bodyStart);
  assert.notEqual(end, -1, `Earn's ${actionName} action should have a complete body.`);
  const body = source.slice(bodyStart, end);
  return new Function(
    ...Object.keys(dependencies),
    `return async () => {${body}\n};`,
  )(...Object.values(dependencies));
}

test("Earn opens the HTTPS invite URL successfully in Expo's browser without changing the flow", async () => {
  const referralLink = `https://${configuredDomain}/?ref=ABC12`;
  const openedUrls = [];
  const fallbackMessages = [];
  const accessibilityAnnouncements = [];
  const earnSource = await readFile(new URL("../src/screens/Earn.tsx", import.meta.url), "utf8");

  await openReferralInBrowserWithFallback(
    referralLink,
    async (url) => {
      openedUrls.push(url);
      return { type: "opened" };
    },
    (message) => {
      fallbackMessages.push(message);
      accessibilityAnnouncements.push(message);
    },
  );

  assert.equal(new URL(openedUrls[0]).protocol, "https:");
  assert.deepEqual(openedUrls, [referralLink]);
  assert.deepEqual(fallbackMessages, []);
  assert.deepEqual(accessibilityAnnouncements, []);
  assert.match(earnSource, /WebBrowser\.openBrowserAsync\(url\)/);
  assert.match(
    earnSource,
    /openReferralInBrowserWithFallback\(\s*dashboard\.referralLink,\s*async \(url\) => \{\s*if \(__DEV__ && simulateReferralBrowserOpenFailure\) \{\s*throw new Error\('Simulated referral browser open failure'\);\s*\}\s*return WebBrowser\.openBrowserAsync\(url\);\s*\},\s*showReferralOpenFallback/,
  );
  assert.equal((earnSource.match(/showReferralOpenFallback/g) ?? []).length, 2);
  assert.match(earnSource, /testID="referral-open-link"[\s\S]*?onPress=\{openReferralLink\}/);
});

test("a rejected browser open shows Earn's copy/share fallback without network or account requests", async (t) => {
  const referralLink = `https://${configuredDomain}/?ref=ABC12`;
  const openedUrls = [];
  const fallbackMessages = [];
  const accessibilityAnnouncements = [];
  const earnSource = await readFile(new URL("../src/screens/Earn.tsx", import.meta.url), "utf8");
  const inviteHelperSource = await readFile(new URL("../src/lib/referral-invite.ts", import.meta.url), "utf8");
  const networkRequests = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });

  await openReferralInBrowserWithFallback(
    referralLink,
    async (url) => {
      openedUrls.push(url);
      throw new Error("Browser unavailable");
    },
    (message) => {
      fallbackMessages.push(message);
      accessibilityAnnouncements.push(message);
    },
  );

  assert.deepEqual(openedUrls, [referralLink]);
  assert.equal(networkRequests.mock.callCount(), 0);
  assert.deepEqual(fallbackMessages, [referralBrowserOpenFallbackMessage]);
  assert.deepEqual(accessibilityAnnouncements, [referralBrowserOpenFallbackMessage]);
  assert.doesNotMatch(inviteHelperSource, /\b(fetch|axios|useDaily007GetMyReferrals)\b/);
  assert.match(
    earnSource,
    /const showReferralOpenFallback = \(message: string\) => \{\s*setActionError\(message\);\s*AccessibilityInfo\.announceForAccessibility\(message\);\s*\};/,
  );
  assert.match(
    earnSource,
    /openReferralInBrowserWithFallback\(\s*dashboard\.referralLink,\s*async \(url\) => \{\s*if \(__DEV__ && simulateReferralBrowserOpenFailure\) \{\s*throw new Error\('Simulated referral browser open failure'\);\s*\}\s*return WebBrowser\.openBrowserAsync\(url\);\s*\},\s*showReferralOpenFallback,\s*\);/,
  );
  assert.equal((earnSource.match(/AccessibilityInfo\.announceForAccessibility\(message\)/g) ?? []).length, 3);
  assert.equal((earnSource.match(/showReferralOpenFallback/g) ?? []).length, 2);
  assert.match(earnSource, /\{!!actionError && <Text style=\{s\.error\}>\{actionError\}<\/Text>\}/);
  assert.equal(
    fallbackMessages[0],
    "Could not open the invite link. Copy or share it and open it in a browser.",
  );
});

test("Earn's development-only browser failure simulation announces recovery only after Open Invite fails", async () => {
  const referralLink = `https://${configuredDomain}/?ref=ABC12`;
  const errorUpdates = [];
  const openedUrls = [];
  const accessibilityAnnouncements = [];
  const earnSource = await readFile(new URL("../src/screens/Earn.tsx", import.meta.url), "utf8");
  const setActionError = (message) => errorUpdates.push(message);
  const showReferralOpenFallback = (message) => {
    setActionError(message);
    accessibilityAnnouncements.push(message);
  };
  const makeOpenReferralLink = (isDev, simulateFailure) => loadEarnAction(
    earnSource,
    "openReferralLink",
    {
      dashboard: { referralLink },
      setActionError,
      openReferralInBrowserWithFallback,
      WebBrowser: {
        openBrowserAsync: async (url) => {
          openedUrls.push(url);
          return { type: "opened" };
        },
      },
      showReferralOpenFallback,
      __DEV__: isDev,
      simulateReferralBrowserOpenFailure: simulateFailure,
    },
  );

  assert.match(
    earnSource,
    /const \[simulateReferralBrowserOpenFailure, setSimulateReferralBrowserOpenFailure\] = useState\(false\)/,
  );
  assert.match(
    earnSource,
    /\{__DEV__ \? \(\s*<Pressable[\s\S]*?testID="referral-simulate-browser-open-failure"/,
  );
  assert.match(
    earnSource,
    /if \(__DEV__ && simulateReferralBrowserOpenFailure\) \{\s*throw new Error\('Simulated referral browser open failure'\);/,
  );
  assert.match(
    earnSource,
    /onPress=\{\(\) => setSimulateReferralBrowserOpenFailure\(\(current\) => !current\)\}/,
  );
  assert.equal((earnSource.match(/AccessibilityInfo\.announceForAccessibility\(message\)/g) ?? []).length, 3);

  await makeOpenReferralLink(true, true)();
  assert.deepEqual(openedUrls, []);
  assert.deepEqual(errorUpdates, [
    "",
    "Could not open the invite link. Copy or share it and open it in a browser.",
  ]);
  assert.deepEqual(accessibilityAnnouncements, [
    "Could not open the invite link. Copy or share it and open it in a browser.",
  ]);

  await makeOpenReferralLink(true, false)();
  assert.deepEqual(openedUrls, [referralLink]);
  assert.deepEqual(accessibilityAnnouncements, [
    "Could not open the invite link. Copy or share it and open it in a browser.",
  ]);

  await makeOpenReferralLink(false, true)();
  assert.deepEqual(openedUrls, [referralLink, referralLink]);
  assert.deepEqual(accessibilityAnnouncements, [
    "Could not open the invite link. Copy or share it and open it in a browser.",
  ]);
});

test("Earn copies the server-provided HTTPS referral link without changing its code", async () => {
  const referralLink = `https://${configuredDomain}/?ref=ABC12`;
  const copiedValues = [];
  const earnSource = await readFile(new URL("../src/screens/Earn.tsx", import.meta.url), "utf8");

  await copyReferralLinkToClipboard(referralLink, async (value) => {
    copiedValues.push(value);
  });

  assert.deepEqual(copiedValues, [referralLink]);
  assert.equal(new URL(copiedValues[0]).protocol, "https:");
  assert.equal(new URL(copiedValues[0]).searchParams.get("ref"), "ABC12");
  assert.match(earnSource, /const dashboard = referralsQuery\.data;/);
  assert.match(
    earnSource,
    /copyReferralLinkToClipboardWithFallback\(\s*dashboard\.referralLink,\s*__DEV__ && simulateReferralLinkCopyFailure[\s\S]*?: Clipboard\.setStringAsync,\s*showReferralCopyFallback/,
  );
  assert.match(earnSource, /testID="referral-copy-link"[\s\S]*?onPress=\{copyReferralLink\}/);
});

test("Earn shares the same server-provided HTTPS referral link and query code", async () => {
  const referralLink = `https://${configuredDomain}/?ref=ABC12`;
  const sharedValues = [];
  const earnSource = await readFile(new URL("../src/screens/Earn.tsx", import.meta.url), "utf8");

  await shareReferralInvite("ABC12", referralLink, async (content) => {
    sharedValues.push(content);
  });

  assert.equal(sharedValues.length, 1);
  assert.equal(sharedValues[0].url, referralLink);
  assert.equal(new URL(sharedValues[0].url).protocol, "https:");
  assert.equal(new URL(sharedValues[0].url).searchParams.get("ref"), "ABC12");
  assert.ok(sharedValues[0].message.includes(referralLink));
  assert.match(earnSource, /const dashboard = referralsQuery\.data;/);
  assert.match(
    earnSource,
    /shareReferralInviteWithFallback\(\s*dashboard\.code,\s*dashboard\.referralLink,\s*\(content\) => Share\.share\(content\),\s*\(message\) => \{\s*setActionError\(message\);\s*AccessibilityInfo\.announceForAccessibility\(message\);\s*\}/,
  );
  assert.match(earnSource, /testID="referral-share-invite"[\s\S]*?onPress=\{shareInvite\}/);
});

test("a failed referral-link clipboard write shows Earn's share-button fallback without native services or API calls", async (t) => {
  const referralLink = `https://${configuredDomain}/?ref=ABC12`;
  const clipboardValues = [];
  const copiedStates = [];
  const alerts = [];
  const earnSource = await readFile(new URL("../src/screens/Earn.tsx", import.meta.url), "utf8");
  const networkRequests = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });

  let actionError = "";
  let clipboardFailureMode = "reject";
  const accessibilityAnnouncements = [];
  const showReferralCopyFallback = (message) => {
    actionError = message;
    accessibilityAnnouncements.push(message);
  };
  const copyReferralLink = loadEarnAction(earnSource, "copyReferralLink", {
    dashboard: { referralLink },
    setActionError: (message) => { actionError = message; },
    showReferralCopyFallback,
    __DEV__: false,
    simulateReferralLinkCopyFailure: false,
    copyReferralLinkToClipboardWithFallback,
    Clipboard: {
      setStringAsync: async (value) => {
        clipboardValues.push(value);
        if (clipboardFailureMode === "reject") throw new Error("Clipboard unavailable");
        return false;
      },
    },
    setLinkCopied: (value) => copiedStates.push(value),
    Alert: { alert: (...args) => alerts.push(args) },
    setTimeout: () => assert.fail("A failed copy must not schedule copied-success feedback."),
  });

  for (const failureMode of ["reject", "false"]) {
    clipboardFailureMode = failureMode;
    await copyReferralLink();
    assert.equal(actionError, referralInviteCopyFallbackMessage);
  }

  assert.deepEqual(clipboardValues, [referralLink, referralLink]);
  assert.deepEqual(copiedStates, []);
  assert.deepEqual(alerts, []);
  assert.deepEqual(accessibilityAnnouncements, [
    referralInviteCopyFallbackMessage,
    referralInviteCopyFallbackMessage,
  ]);
  assert.equal(
    referralInviteCopyFallbackMessage,
    "Could not copy the invite link. Use Share Invite instead.",
  );
  assert.match(
    earnSource,
    /const showReferralCopyFallback = \(message: string\) => \{\s*setActionError\(message\);\s*AccessibilityInfo\.announceForAccessibility\(message\);\s*\};/,
  );
  assert.match(earnSource, /testID="referral-simulate-link-copy-failure"/);
  assert.match(
    earnSource,
    /__DEV__ && simulateReferralLinkCopyFailure[\s\S]*?throw new Error\('Simulated referral link clipboard failure'\)/,
  );
  assert.equal(networkRequests.mock.callCount(), 0);
  assert.match(
    earnSource,
    /copyReferralLinkToClipboardWithFallback\(\s*dashboard\.referralLink,\s*__DEV__ && simulateReferralLinkCopyFailure[\s\S]*?: Clipboard\.setStringAsync,\s*showReferralCopyFallback/,
  );
  assert.match(earnSource, /{!!actionError && <Text style=\{s\.error\}>\{actionError\}<\/Text>\}/);
  assert.match(earnSource, /testID="referral-share-invite"[\s\S]*?onPress=\{shareInvite\}/);
});

test("a failed referral-code clipboard write preserves Earn's working share fallback without native services or API calls", async (t) => {
  const referralLink = `https://${configuredDomain}/?ref=ABC12`;
  const dashboard = { code: "ABC12", referralLink };
  const clipboardValues = [];
  const copiedStates = [];
  const alerts = [];
  const sharedValues = [];
  const earnSource = await readFile(new URL("../src/screens/Earn.tsx", import.meta.url), "utf8");
  const networkRequests = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });
  let actionError = "";
  let clipboardFailureMode = "reject";
  const setActionError = (message) => { actionError = message; };
  const accessibilityAnnouncements = [];
  const showReferralCopyFallback = (message) => {
    setActionError(message);
    accessibilityAnnouncements.push(message);
  };

  const copyCode = loadEarnAction(earnSource, "copyCode", {
    dashboard,
    Clipboard: {
      setStringAsync: async (value) => {
        clipboardValues.push(value);
        if (clipboardFailureMode === "reject") throw new Error("Clipboard unavailable");
        return false;
      },
    },
    setCopied: (value) => copiedStates.push(value),
    Alert: { alert: (...args) => alerts.push(args) },
    setTimeout: () => assert.fail("A failed copy must not schedule the copied-success state reset."),
    setActionError,
    showReferralCopyFallback,
    __DEV__: false,
    simulateReferralCodeCopyFailure: false,
  });
  await copyCode();

  assert.deepEqual(clipboardValues, ["ABC12"]);
  assert.deepEqual(copiedStates, []);
  assert.deepEqual(alerts, []);
  assert.equal(actionError, "Could not copy the referral code. Use Share Invite instead.");
  assert.deepEqual(accessibilityAnnouncements, [
    "Could not copy the referral code. Use Share Invite instead.",
  ]);
  assert.match(earnSource, /\{!!actionError && <Text style=\{s\.error\}>\{actionError\}<\/Text>\}/);
  assert.match(earnSource, /testID="referral-copy-code"[\s\S]*?onPress=\{copyCode\}/);
  assert.match(
    earnSource,
    /const writeReferralCode = __DEV__ && simulateReferralCodeCopyFailure[\s\S]*?throw new Error\('Simulated referral code clipboard failure'\)[\s\S]*?: Clipboard\.setStringAsync;\s*const copiedSuccessfully = await writeReferralCode\(dashboard\.code\);/,
  );
  assert.match(
    earnSource,
    /testID="referral-simulate-code-copy-failure"[\s\S]*?setSimulateReferralCodeCopyFailure\(\(current\) => !current\)/,
  );

  clipboardFailureMode = "false";
  await copyCode();

  assert.deepEqual(clipboardValues, ["ABC12", "ABC12"]);
  assert.deepEqual(copiedStates, []);
  assert.deepEqual(alerts, []);
  assert.equal(actionError, "Could not copy the referral code. Use Share Invite instead.");
  assert.deepEqual(accessibilityAnnouncements, [
    "Could not copy the referral code. Use Share Invite instead.",
    "Could not copy the referral code. Use Share Invite instead.",
  ]);

  const simulatedCopyCode = loadEarnAction(earnSource, "copyCode", {
    dashboard,
    Clipboard: {
      setStringAsync: async () => assert.fail("The device test switch must reject before calling the real clipboard."),
    },
    setCopied: (value) => copiedStates.push(value),
    Alert: { alert: (...args) => alerts.push(args) },
    setTimeout: () => assert.fail("A simulated copy failure must not schedule success feedback."),
    setActionError,
    showReferralCopyFallback,
    __DEV__: true,
    simulateReferralCodeCopyFailure: true,
  });
  await simulatedCopyCode();
  assert.equal(actionError, "Could not copy the referral code. Use Share Invite instead.");
  assert.deepEqual(accessibilityAnnouncements, [
    "Could not copy the referral code. Use Share Invite instead.",
    "Could not copy the referral code. Use Share Invite instead.",
    "Could not copy the referral code. Use Share Invite instead.",
  ]);
  assert.deepEqual(copiedStates, []);
  assert.deepEqual(alerts, []);

  const shareInvite = loadEarnAction(earnSource, "shareInvite", {
    dashboard,
    Share: {
      share: async (content) => {
        sharedValues.push(content);
      },
    },
    shareReferralInviteWithFallback,
    setActionError,
  });
  await shareInvite();

  assert.equal(actionError, "");
  assert.equal(sharedValues.length, 1);
  assert.equal(sharedValues[0].url, referralLink);
  assert.match(sharedValues[0].message, /referral code ABC12/);

  const dashboardSectionStart = earnSource.indexOf("!!dashboard && (");
  const shareButtonStart = earnSource.indexOf('testID="referral-share-invite"');
  const shareButtonEnd = earnSource.indexOf("</Pressable>", shareButtonStart);
  const shareButtonSource = earnSource.slice(
    earnSource.lastIndexOf("<Pressable", shareButtonStart),
    shareButtonEnd + "</Pressable>".length,
  );
  assert.ok(dashboardSectionStart >= 0 && dashboardSectionStart < shareButtonStart);
  assert.ok(shareButtonEnd > shareButtonStart);
  assert.match(shareButtonSource, /onPress=\{shareInvite\}/);
  assert.match(shareButtonSource, /SHARE INVITE LINK/);
  assert.doesNotMatch(shareButtonSource, /actionError|copied/);
  assert.equal(networkRequests.mock.callCount(), 0);
});

test("successful invite-link and referral-code copies stay silent about failures", async () => {
  const referralLink = `https://${configuredDomain}/?ref=ABC12`;
  const dashboard = { code: "ABC12", referralLink };
  const announcements = [];
  const errors = [];
  const fallback = (message) => {
    errors.push(message);
    announcements.push(message);
  };
  const earnSource = await readFile(new URL("../src/screens/Earn.tsx", import.meta.url), "utf8");
  const copyReferralLink = loadEarnAction(earnSource, "copyReferralLink", {
    dashboard,
    setActionError: (message) => errors.push(message),
    showReferralCopyFallback: fallback,
    copyReferralLinkToClipboardWithFallback,
    Clipboard: { setStringAsync: async () => true },
    setLinkCopied: () => {},
    Alert: { alert() {} },
    setTimeout() {},
    __DEV__: false,
    simulateReferralLinkCopyFailure: false,
  });
  const copyCode = loadEarnAction(earnSource, "copyCode", {
    dashboard,
    setActionError: (message) => errors.push(message),
    showReferralCopyFallback: fallback,
    Clipboard: { setStringAsync: async () => true },
    setCopied: () => {},
    Alert: { alert() {} },
    setTimeout() {},
    __DEV__: false,
    simulateReferralCodeCopyFailure: false,
  });

  await copyReferralLink();
  await copyCode();

  assert.deepEqual(announcements, []);
  assert.deepEqual(errors, ["", ""]);
});

test("Earn announces copy-code recovery once for every rejected share and stays silent after a successful retry", async (t) => {
  const referralLink = `https://${configuredDomain}/?ref=ABC12`;
  const sharedValues = [];
  const fallbackMessages = [];
  const accessibilityAnnouncements = [];
  const errors = [];
  const earnSource = await readFile(new URL("../src/screens/Earn.tsx", import.meta.url), "utf8");
  const networkRequests = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });

  let shareSucceeds = false;
  const shareInvite = loadEarnAction(earnSource, "shareInvite", {
    dashboard: { code: "ABC12", referralLink },
    Share: {
      share: async (content) => {
        sharedValues.push(content);
        if (!shareSucceeds) throw new Error("Share sheet unavailable");
        return { action: "sharedAction" };
      },
    },
    shareReferralInviteWithFallback,
    setActionError: (message) => {
      errors.push(message);
      if (message) fallbackMessages.push(message);
    },
    AccessibilityInfo: {
      announceForAccessibility: (message) => accessibilityAnnouncements.push(message),
    },
  });

  assert.deepEqual(accessibilityAnnouncements, []);
  assert.deepEqual(fallbackMessages, []);

  await shareInvite();
  assert.equal(sharedValues.length, 1);
  assert.deepEqual(fallbackMessages, [referralShareFallbackMessage]);
  assert.deepEqual(accessibilityAnnouncements, [referralShareFallbackMessage]);

  await shareInvite();
  assert.equal(sharedValues.length, 2);
  assert.deepEqual(fallbackMessages, [
    referralShareFallbackMessage,
    referralShareFallbackMessage,
  ]);
  assert.deepEqual(accessibilityAnnouncements, [
    referralShareFallbackMessage,
    referralShareFallbackMessage,
  ]);

  shareSucceeds = true;
  await shareInvite();
  assert.equal(sharedValues.length, 3);
  assert.deepEqual(errors, [
    "",
    referralShareFallbackMessage,
    "",
    referralShareFallbackMessage,
    "",
  ]);
  assert.deepEqual(fallbackMessages, [
    referralShareFallbackMessage,
    referralShareFallbackMessage,
  ]);
  assert.deepEqual(accessibilityAnnouncements, [
    referralShareFallbackMessage,
    referralShareFallbackMessage,
  ]);
  assert.ok(sharedValues.every((content) => content.url === referralLink));
  assert.equal(
    fallbackMessages[1],
    "Could not open the share sheet. You can copy the code instead.",
  );
  assert.equal(networkRequests.mock.callCount(), 0);
  assert.match(
    earnSource,
    /shareReferralInviteWithFallback\(\s*dashboard\.code,\s*dashboard\.referralLink,\s*\(content\) => Share\.share\(content\),\s*\(message\) => \{\s*setActionError\(message\);\s*AccessibilityInfo\.announceForAccessibility\(message\);\s*\}/,
  );
  assert.equal((earnSource.match(/AccessibilityInfo\.announceForAccessibility\(message\)/g) ?? []).length, 3);
  assert.match(earnSource, /{!!actionError && <Text style=\{s\.error\}>\{actionError\}<\/Text>\}/);
  assert.match(earnSource, /testID="referral-copy-code"[\s\S]*?onPress=\{copyCode\}/);
});

test("configured HTTPS invites open signup with the ref code prefilled", () => {
  assert.deepEqual(
    referralSignupFromUrl(`https://${configuredDomain}/?ref=AbC12`, nativeContext),
    { mode: "signup", referralCode: "ABC12" },
  );
});

test("the supported referralCode query parameter also opens signup with the code", () => {
  assert.deepEqual(
    referralSignupFromUrl(
      `https://${configuredDomain}/?referralCode=oldInvite7`,
      nativeContext,
    ),
    { mode: "signup", referralCode: "OLDINVITE7" },
  );
});

test("the same-origin browser invite and legacy Daily007 app links remain supported", () => {
  assert.deepEqual(
    referralSignupFromUrl("https://local.daily007.test/?ref=WEB77", {
      platform: "web",
      currentWebOrigin: "https://local.daily007.test",
    }),
    { mode: "signup", referralCode: "WEB77" },
  );
  assert.deepEqual(
    referralSignupFromUrl("daily007://signup?ref=OLD42", nativeContext),
    { mode: "signup", referralCode: "OLD42" },
  );
});

test("unrelated, unsupported, empty, and malformed URLs do not prefill a referral code", () => {
  for (const url of [
    "https://attacker.example.test/?ref=BAD11",
    `http://${configuredDomain}/?ref=BAD22`,
    "not a URL",
    "https://daily007.example.test/",
    `https://${configuredDomain}/?ref=%20`,
  ]) {
    assert.equal(referralSignupFromUrl(url, nativeContext), null, url);
  }
  assert.equal(referralSignupFromUrl(null, nativeContext), null);
});

test("Auth uses the parsed invite to select signup mode and display its code", async () => {
  const authSource = await readFile(new URL("../src/screens/Auth.tsx", import.meta.url), "utf8");
  assert.match(authSource, /referralSignupFromUrl\(url/);
  assert.match(authSource, /setMode\(invite\.mode\)/);
  assert.match(authSource, /setRefCode\(\(current\) => current \|\| invite\.referralCode\)/);
  assert.match(authSource, /Referral code \{refCode\.trim\(\)\.toUpperCase\(\)\} applied/);
});