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
    /openReferralInBrowserWithFallback\(\s*dashboard\.referralLink,\s*\(url\) => WebBrowser\.openBrowserAsync\(url\),\s*showReferralOpenFallback/,
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
    /openReferralInBrowserWithFallback\(\s*dashboard\.referralLink,\s*\(url\) => WebBrowser\.openBrowserAsync\(url\),\s*showReferralOpenFallback,\s*\);/,
  );
  assert.equal((earnSource.match(/AccessibilityInfo\.announceForAccessibility\(message\)/g) ?? []).length, 1);
  assert.equal((earnSource.match(/showReferralOpenFallback/g) ?? []).length, 2);
  assert.match(earnSource, /\{!!actionError && <Text style=\{s\.error\}>\{actionError\}<\/Text>\}/);
  assert.equal(
    fallbackMessages[0],
    "Could not open the invite link. Copy or share it and open it in a browser.",
  );
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
    /copyReferralLinkToClipboardWithFallback\(\s*dashboard\.referralLink,\s*Clipboard\.setStringAsync,\s*setActionError/,
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
    /shareReferralInviteWithFallback\(\s*dashboard\.code,\s*dashboard\.referralLink,\s*\(content\) => Share\.share\(content\),\s*setActionError/,
  );
  assert.match(earnSource, /testID="referral-share-invite"[\s\S]*?onPress=\{shareInvite\}/);
});

test("a clipboard rejection shows Earn's share-button fallback without native services or API calls", async (t) => {
  const referralLink = `https://${configuredDomain}/?ref=ABC12`;
  const clipboardValues = [];
  const fallbackMessages = [];
  const earnSource = await readFile(new URL("../src/screens/Earn.tsx", import.meta.url), "utf8");
  const networkRequests = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });

  const copied = await copyReferralLinkToClipboardWithFallback(
    referralLink,
    async (value) => {
      clipboardValues.push(value);
      throw new Error("Clipboard unavailable");
    },
    (message) => fallbackMessages.push(message),
  );

  assert.equal(copied, false);
  assert.deepEqual(clipboardValues, [referralLink]);
  assert.deepEqual(fallbackMessages, [referralInviteCopyFallbackMessage]);
  assert.equal(
    fallbackMessages[0],
    "Could not copy the invite link. Try the share button instead.",
  );
  assert.equal(networkRequests.mock.callCount(), 0);
  assert.match(
    earnSource,
    /copyReferralLinkToClipboardWithFallback\(\s*dashboard\.referralLink,\s*Clipboard\.setStringAsync,\s*setActionError/,
  );
  assert.match(earnSource, /{!!actionError && <Text style=\{s\.error\}>\{actionError\}<\/Text>\}/);
  assert.match(earnSource, /testID="referral-share-invite"[\s\S]*?onPress=\{shareInvite\}/);
});

test("a rejected share sheet shows Earn's copy-code fallback without native services or API calls", async (t) => {
  const referralLink = `https://${configuredDomain}/?ref=ABC12`;
  const sharedValues = [];
  const fallbackMessages = [];
  const earnSource = await readFile(new URL("../src/screens/Earn.tsx", import.meta.url), "utf8");
  const networkRequests = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });

  const shared = await shareReferralInviteWithFallback(
    "ABC12",
    referralLink,
    async (content) => {
      sharedValues.push(content);
      throw new Error("Share sheet unavailable");
    },
    (message) => fallbackMessages.push(message),
  );

  assert.equal(shared, false);
  assert.equal(sharedValues.length, 1);
  assert.equal(sharedValues[0].url, referralLink);
  assert.deepEqual(fallbackMessages, [referralShareFallbackMessage]);
  assert.equal(
    fallbackMessages[0],
    "Could not open the share sheet. You can copy the code instead.",
  );
  assert.equal(networkRequests.mock.callCount(), 0);
  assert.match(
    earnSource,
    /shareReferralInviteWithFallback\(\s*dashboard\.code,\s*dashboard\.referralLink,\s*\(content\) => Share\.share\(content\),\s*setActionError/,
  );
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