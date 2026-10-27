import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isFullMatchRejection,
  joinWithCapacityRefresh,
} from "../src/lib/tournamentJoinRecovery.ts";

const appSource = await readFile(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const joinFormSource = await readFile(
  new URL("../src/screens/JoinForm.tsx", import.meta.url),
  "utf8",
);
const joinValidationSource = await readFile(
  new URL("../src/lib/joinFormValidation.ts", import.meta.url),
  "utf8",
);
const uiSource = await readFile(
  new URL("../src/components/ui.tsx", import.meta.url),
  "utf8",
);
const nativeFixtureSource = await readFile(
  new URL("../src/screens/JoinRecoveryNativeTest.tsx", import.meta.url),
  "utf8",
);
const insufficientBalanceFlow = await readFile(
  new URL("../maestro/join-recovery/insufficient-balance.yaml", import.meta.url),
  "utf8",
);
const localValidationFlow = await readFile(
  new URL("../maestro/join-recovery/local-validation.yaml", import.meta.url),
  "utf8",
);
const lastSlotFlow = await readFile(
  new URL("../maestro/join-recovery/last-slot-taken.yaml", import.meta.url),
  "utf8",
);

const fullMatchErrors = [
  {
    code: "MATCH_FULL",
    message: "This match is already full and is not accepting registrations.",
  },
  {
    code: "MATCH_FULL",
    message: "Registration failed because all tournament places are now taken.",
  },
];

for (const { code, message } of fullMatchErrors) {
  test(`a full-match code refreshes capacity and preserves the server message (${message})`, async () => {
    const joinError = Object.assign(new Error(message), {
      response: { status: 409, data: { code, error: message } },
    });
    assert.equal(isFullMatchRejection(joinError), true);
    const refreshedTournament = {
      id: "match-1",
      status: "full",
      filledSlots: 12,
      availableSlots: 0,
    };
    const fetchedIds = [];
    let visibleTournament = null;

    await assert.rejects(
      joinWithCapacityRefresh(
        async () => { throw joinError; },
        "match-1",
        async (id) => {
          fetchedIds.push(id);
          return refreshedTournament;
        },
        (tournament) => { visibleTournament = tournament; },
      ),
      (error) => error === joinError,
    );

    assert.deepEqual(fetchedIds, ["match-1"]);
    assert.equal(visibleTournament, refreshedTournament);
    assert.equal(visibleTournament.availableSlots, 0);
    assert.equal(joinError.response.data.error, message);
  });
}

for (const [status, message, code] of [
  [400, "Captain Free Fire UID is required.", "INVALID_REGISTRATION"],
  [409, "Insufficient wallet balance.", "INSUFFICIENT_WALLET_BALANCE"],
  [409, "This match is full.", undefined],
]) {
  test(`an unrelated join error remains visible without a tournament refresh (${status})`, async () => {
    const joinError = Object.assign(new Error(message), {
      response: { status, data: { ...(code ? { code } : {}), error: message } },
    });
    assert.equal(isFullMatchRejection(joinError), false);
    const fetchedIds = [];
    let visibleTournament = null;

    await assert.rejects(
      joinWithCapacityRefresh(
        async () => { throw joinError; },
        "match-1",
        async (id) => {
          fetchedIds.push(id);
          return { id, status: "open" };
        },
        (tournament) => { visibleTournament = tournament; },
      ),
      (error) => error === joinError,
    );

    assert.deepEqual(fetchedIds, []);
    assert.equal(visibleTournament, null);
  });
}

test("full-capacity rejection announces the refreshed state through the visible error message", () => {
  const message = joinFormSource.match(/<Msg\b[\s\S]*?\/>/)?.[0];
  assert.ok(message, "the visible error message must remain in the join form");
  assert.match(message, /text=\{err \|\| disabledMessage\}/);
  assert.match(message, /accessibilityLabel=\{capacityAnnouncement\}/);
  assert.match(message, /accessibilityLiveRegion=\{err \? 'polite' : undefined\}/);
  assert.match(
    joinFormSource,
    /setFullCapacityFailure\(isFullMatchRejection\(e\)\)/,
  );
  assert.match(
    joinFormSource,
    /const capacityAnnouncement = fullCapacityFailure\s*\?\s*`\$\{err\} Updated capacity: \$\{capacity\}\. Registration is closed\.`/,
  );
  const messageText = uiSource.match(
    /<Text\s+accessibilityLabel=\{accessibilityLabel\}[\s\S]*?accessibilityLiveRegion=\{accessibilityLiveRegion\}[\s\S]*?>/,
  )?.[0];
  assert.ok(messageText, "the shared message text must carry its announcement label and live region");
  assert.match(joinFormSource, /disabled=\{isUnavailable\}/);
  assert.doesNotMatch(joinFormSource, /AccessibilityInfo\.announceForAccessibility/);
});

test("non-capacity registration errors announce once through their visible error message", () => {
  const message = joinFormSource.match(/<Msg\b[\s\S]*?\/>/)?.[0];
  assert.ok(message, "the visible error message must remain in the join form");
  assert.match(message, /text=\{err \|\| disabledMessage\}/);
  assert.match(message, /accessibilityLiveRegion=\{err \? 'polite' : undefined\}/);

  assert.match(
    joinFormSource,
    /if \(validation\) \{\s*setFieldErrors\(validation\.fieldErrors\);\s*return announceError\(validation\.message\);\s*\}/,
    "local validation failures should continue to populate the visible error",
  );
  assert.match(
    joinValidationSource,
    /fieldErrors\.captainGameName = 'Captain Free Fire in-game name is required\.'/,
    "the local fixture should exercise the missing captain game name validation",
  );
  assert.match(
    joinFormSource,
    /const message = responseData\?\.error \|\| responseData\?\.message \|\| e\?\.message \|\| 'Registration could not be confirmed\. Please try again\.'/,
    "server failures such as insufficient balance should provide the visible error text",
  );
  assert.match(
    joinFormSource,
    /announceError\(getJoinFormSubmissionErrorMessage\(message,/,
    "server failures such as insufficient balance should continue to populate the visible error",
  );
  assert.equal(
    (joinFormSource.match(/<Msg\b/g) ?? []).length,
    1,
    "the form should expose one live visible error message",
  );
  assert.doesNotMatch(
    joinFormSource,
    /announceForAccessibility|setAccessibilityFocus|\.focus\(/,
    "registration errors must not use a second announcement or move focus",
  );
});

test("repeated identical local validation failures refresh one live-region announcement", () => {
  const submit = joinFormSource.match(
    /const submit = async \(\) => \{[\s\S]*?\n  \};/,
  )?.[0];
  assert.ok(submit, "the form must keep its submit handler");
  assert.match(
    joinFormSource,
    /const \[errorAnnouncementId, setErrorAnnouncementId\] = useState\(0\)/,
    "each displayed error needs a distinct live-region identity",
  );
  assert.match(
    joinFormSource,
    /const announceError = \(message: string\) => \{\s*setErrorAnnouncementId\(\(id\) => id \+ 1\);\s*setErr\(message\);\s*\}/,
    "raising the same error again must advance the live-region identity",
  );
  assert.match(
    submit,
    /if \(validation\) \{\s*setFieldErrors\(validation\.fieldErrors\);\s*return announceError\(validation\.message\);\s*\}/,
    "every repeated local validation failure must request a fresh announcement",
  );
  const message = joinFormSource.match(/<Msg\b[\s\S]*?\/>/)?.[0];
  assert.ok(message, "the visible error message must remain in the join form");
  assert.match(message, /key=\{errorAnnouncementId\}/);
  assert.match(message, /accessibilityLiveRegion=\{err \? 'polite' : undefined\}/);
  assert.equal(
    (joinFormSource.match(/<Msg\b/g) ?? []).length,
    1,
    "retrying must not add another live region",
  );
  assert.doesNotMatch(
    submit,
    /announceForAccessibility|setAccessibilityFocus|\.focus\(/,
    "retrying a validation failure must not announce separately or move focus",
  );
});

test("the Android regression route uses only local fixtures and is dev-only", () => {
  const routeSource = nativeFixtureSource.match(
    /export default function JoinRecoveryNativeTest\(\)[\s\S]*?\n}/,
  )?.[0];
  assert.ok(routeSource, "the native test route must have a production guard");
  assert.match(routeSource, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(nativeFixtureSource, /joinWithCapacityRefresh\(/);
  assert.match(nativeFixtureSource, /INSUFFICIENT_WALLET_BALANCE/);
  assert.match(nativeFixtureSource, /join-recovery-wallet-top-up/);
  assert.match(nativeFixtureSource, /join-recovery-pending-response/);
  assert.match(nativeFixtureSource, /join-recovery-complete-success/);
  assert.match(nativeFixtureSource, /pendingJoinResponse\.current = resolve/);
  assert.match(nativeFixtureSource, /resolve\(\{ success: true, status: 'approved' \}\)/);
  const fixtureSubmit = nativeFixtureSource.match(
    /const submitFixtureJoin = async \(\) => \{[\s\S]*?\n  \};/,
  )?.[0];
  assert.ok(fixtureSubmit, "the native fixture should keep its submission flow");
  assert.ok(
    fixtureSubmit.indexOf("await joinWithCapacityRefresh(") <
      fixtureSubmit.indexOf("setConfirmation('Registration confirmed after simulated wallet top-up.')"),
    "the success state must wait for the simulated successful join response",
  );
  assert.match(nativeFixtureSource, /'MATCH_FULL'/);
  assert.match(nativeFixtureSource, /otherPlayerFilledLastSlot\.current = true/);
  assert.match(
    nativeFixtureSource,
    /LOCAL RESPONSES ONLY · NO NETWORK OR WALLET WRITES/,
  );
  assert.doesNotMatch(nativeFixtureSource, /\bApi\.|\bfetch\s*\(/);
  assert.match(insufficientBalanceFlow, /join-form-error/);
  assert.match(insufficientBalanceFlow, /join-recovery-confirmation/);
  assert.match(insufficientBalanceFlow, /Submit attempts: 2/);
  assert.match(insufficientBalanceFlow, /join-recovery-wallet-top-up/);
  assert.match(insufficientBalanceFlow, /join-recovery-pending-response/);
  assert.match(insufficientBalanceFlow, /join-recovery-complete-success/);
  assert.match(insufficientBalanceFlow, /join-form-player-game-name/);
  assert.match(insufficientBalanceFlow, /text: "Native Test Player"/);
  assert.match(insufficientBalanceFlow, /join-form-player-game-uid/);
  assert.doesNotMatch(insufficientBalanceFlow, /join-form-captain-game-name|join-form-team-name|join-form-teammate/);
  assert.match(insufficientBalanceFlow, /Registration confirmed after simulated wallet top-up/);
  assert.match(localValidationFlow, /join-form-error/);
  assert.match(localValidationFlow, /Enter your Free Fire in-game name and UID to continue/);
  assert.match(localValidationFlow, /Submit attempts: 0/);
  assert.match(localValidationFlow, /join-recovery-confirmation/);
  assert.match(lastSlotFlow, /47\/48 players/);
  assert.match(lastSlotFlow, /48\/48 players/);
  assert.match(lastSlotFlow, /This match is already full and is not accepting registrations/);
  assert.match(lastSlotFlow, /join-form-player-game-name/);
  assert.match(lastSlotFlow, /join-form-player-game-uid/);
  assert.doesNotMatch(lastSlotFlow, /join-form-captain-game-name/);
  assert.match(lastSlotFlow, /join-recovery-confirmation/);
  assert.match(joinFormSource, /accessibilityLabel="Captain Free Fire in-game name"[\s\S]*?testID="join-form-captain-game-name"/);
  assert.match(joinFormSource, /accessibilityLabel="Captain Free Fire UID"[\s\S]*?testID="join-form-captain-game-uid"/);
  assert.match(joinFormSource, /accessibilityLabel=\{`\$\{selectedPlayerLabel\} Free Fire in-game name`\}[\s\S]*?testID="join-form-player-game-name"/);
  assert.match(joinFormSource, /accessibilityLabel=\{`\$\{selectedPlayerLabel\} Free Fire UID`\}[\s\S]*?testID="join-form-player-game-uid"/);
  assert.match(nativeFixtureSource, /seatGroupNumber=\{tournament\.filledSlots \+ 1\}[\s\S]*?seatSlotNumber=\{scenario === 'last-slot' \? 1 : 2\}/);
  assert.match(joinFormSource, /testID="join-form-error"/);
  assert.match(uiSource, /<View\s+testID=\{testID\}/);
});

test("the wallet refresh remains after a successful and validated join response", () => {
  const joinStart = appSource.indexOf("const result = await joinWithCapacityRefresh(");
  const walletRefresh = appSource.indexOf("await refresh();", joinStart);
  const registrationConfirmation = appSource.indexOf(
    "showLocalizedAlert('Registration confirmed', message)",
    joinStart,
  );
  assert.ok(joinStart >= 0, "the join result should use capacity recovery");
  assert.ok(walletRefresh > joinStart, "wallet data refresh should follow the join request");
  assert.ok(
    registrationConfirmation > walletRefresh,
    "success confirmation must only appear after the join and wallet refresh succeed",
  );

  const resultValidation = appSource.slice(joinStart, walletRefresh);
  assert.match(resultValidation, /if \(result\?\.success === false \|\| result\?\.ok === false\)/);
  assert.match(
    resultValidation,
    /if \(result\?\.status !== 'approved' && result\?\.status !== 'pending'\)/,
  );
  assert.doesNotMatch(resultValidation, /\bcatch\s*\(|\bfinally\s*\{/);
  assert.doesNotMatch(
    appSource.slice(joinStart, registrationConfirmation),
    /\bcatch\s*\(/,
    "a failed request must escape before the success alert can run",
  );
});

test("a failed capacity refresh preserves the original server rejection", async () => {
  const message = "Capacity has been reached.";
  const joinError = Object.assign(new Error(message), {
    response: { status: 409, data: { code: "MATCH_FULL", error: message } },
  });
  const refreshError = new Error("Tournament refresh failed");
  let visibleTournament = {
    id: "match-1",
    status: "open",
    totalSlots: 12,
    totalPlayerSlots: 48,
    filledSlots: 11,
    filledPlayerSlots: 44,
    availableSlots: 1,
  };

  await assert.rejects(
    joinWithCapacityRefresh(
      async () => { throw joinError; },
      "match-1",
      async () => { throw refreshError; },
      (next) => {
        visibleTournament = typeof next === "function"
          ? next(visibleTournament)
          : next;
      },
    ),
    (error) => error === joinError,
  );
  assert.deepEqual(visibleTournament, {
    id: "match-1",
    status: "full",
    totalSlots: 12,
    totalPlayerSlots: 48,
    filledSlots: 12,
    filledPlayerSlots: 48,
    availableSlots: 0,
  });
});