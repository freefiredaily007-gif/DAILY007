import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  openReferralInBrowser,
  referralSignupFromUrl,
} from "../src/lib/referral-invite.ts";

const configuredDomain = "daily007.example.test";
const nativeContext = { platform: "native", configuredDomain };

test("Earn sends its HTTPS invite URL to Expo's browser opener", async () => {
  const referralLink = `https://${configuredDomain}/?ref=ABC12`;
  const openedUrls = [];
  const earnSource = await readFile(new URL("../src/screens/Earn.tsx", import.meta.url), "utf8");

  await openReferralInBrowser(referralLink, async (url) => {
    openedUrls.push(url);
    return { type: "opened" };
  });

  assert.equal(new URL(openedUrls[0]).protocol, "https:");
  assert.deepEqual(openedUrls, [referralLink]);
  assert.match(earnSource, /WebBrowser\.openBrowserAsync\(url\)/);
  assert.match(earnSource, /openReferralInBrowser\([\s\S]*?dashboard\.referralLink/);
  assert.match(earnSource, /testID="referral-open-link"[\s\S]*?onPress=\{openReferralLink\}/);
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