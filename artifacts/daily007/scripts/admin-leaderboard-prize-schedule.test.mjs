import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const screenSource = await readFile(
  new URL("../src/screens/AdminLeaderboards.tsx", import.meta.url),
  "utf8",
);

function loadAdminLeaderboards(
  serverSchedules,
  {
    failSaveAttempts = 0,
    approvalPeriods = [],
    failApprovalAttempts = 0,
  } = {},
) {
  const sourceFile = ts.createSourceFile(
    "AdminLeaderboards.tsx",
    screenSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const withoutImports = sourceFile.statements
    .filter((statement) => !ts.isImportDeclaration(statement))
    .map((statement) => statement.getFullText(sourceFile))
    .join("\n")
    .replace("export default function AdminLeaderboards()", "function AdminLeaderboards()");
  const compiled = ts.transpileModule(withoutImports, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const inputType = function Input() {};
  const buttonType = function Btn() {};
  const componentType = () => function Component() {};
  const textType = componentType();
  let stateSlots;
  let stateIndex = 0;
  let refSlots;
  let refIndex = 0;
  let effectIndex = 0;
  const saveCalls = [];
  const toastCalls = [];
  const approvalCalls = [];
  let failedSaveAttempts = failSaveAttempts;
  let failedApprovalAttempts = failApprovalAttempts;

  const React = {
    createElement(type, props, ...children) {
      return {
        type,
        props: {
          ...(props ?? {}),
          ...(children.length
            ? { children: children.length === 1 ? children[0] : children }
            : {}),
        },
      };
    },
    useState(initialValue) {
      const index = stateIndex++;
      if (!(index in stateSlots)) {
        stateSlots[index] =
          typeof initialValue === "function" ? initialValue() : initialValue;
      }
      return [
        stateSlots[index],
        (nextValue) => {
          stateSlots[index] =
            typeof nextValue === "function" ? nextValue(stateSlots[index]) : nextValue;
        },
      ];
    },
    useRef(initialValue) {
      const index = refIndex++;
      if (!(index in refSlots)) refSlots[index] = { current: initialValue };
      return refSlots[index];
    },
  };

  const adminQuery = {
    data: undefined,
    error: null,
    isLoading: false,
    refetchCalls: 0,
    async refetch() {
      this.refetchCalls += 1;
      this.data = makeAdminResponse();
      return { data: this.data };
    },
  };
  function makeAdminResponse() {
    const schedule = (cycle) => ({
      ...serverSchedules[cycle],
      currentPeriodStartsAt: null,
      currentPeriodEndsAt: null,
      currentPeriodStatus: "active",
      latestPeriodStatus: "active",
      canStartNextCycle: false,
    });
    return { weekly: schedule("weekly"), monthly: schedule("monthly") };
  }
  adminQuery.data = makeAdminResponse();

  const rewardsMutation = {
    async mutateAsync({ data }) {
      saveCalls.push(structuredClone(data));
      if (failedSaveAttempts > 0) {
        failedSaveAttempts -= 1;
        throw new Error("Prize settings could not be saved.");
      }
      for (const cycle of ["weekly", "monthly"]) {
        if (data[cycle]) serverSchedules[cycle] = structuredClone(data[cycle]);
      }
    },
  };
  const approvalsQuery = {
    data: { periods: structuredClone(approvalPeriods) },
    error: null,
    isLoading: false,
    refetchCalls: 0,
    async refetch() {
      this.refetchCalls += 1;
      return { data: this.data };
    },
  };
  const approvalMutation = {
    async mutateAsync({ periodId }) {
      approvalCalls.push(periodId);
      if (failedApprovalAttempts > 0) {
        failedApprovalAttempts -= 1;
        throw new Error("Leaderboard approval is temporarily unavailable.");
      }
      const period = approvalsQuery.data.periods.find((candidate) => candidate.id === periodId);
      if (!period) throw new Error("Pending leaderboard cycle was not found.");
      approvalsQuery.data = {
        periods: approvalsQuery.data.periods.filter((candidate) => candidate.id !== periodId),
      };
      return {
        periodId,
        cycleType: period.cycleType,
        alreadyApproved: false,
        payouts: period.rewards.map((reward) => {
          const standing = period.standings.find((candidate) => candidate.rank === reward.rank);
          return {
            rank: reward.rank,
            userId: standing.userId,
            name: standing.name,
            coins: reward.coins,
            balanceAfter: 100 + reward.coins,
          };
        }),
      };
    },
  };

  const scope = {
    React,
    StyleSheet: { create: (styles) => styles },
    View: componentType(),
    Feather: componentType(),
    useEffect(effect) {
      const index = effectIndex++;
      // Ignore the one-minute polling interval in this deterministic form test.
      if (index !== 2) effect();
    },
    useRef: React.useRef,
    useState: React.useState,
    useDaily007AdminApproveLeaderboardPeriod: () => ({
      mutateAsync: approvalMutation.mutateAsync,
      isPending: false,
    }),
    useDaily007AdminGetLeaderboardApprovals: () => approvalsQuery,
    useDaily007AdminGetLeaderboardRewards: () => adminQuery,
    useDaily007AdminStartLeaderboardCycle: () => ({
      mutateAsync: async () => ({}),
      isPending: false,
    }),
    useDaily007AdminUpdateLeaderboardRewards: () => rewardsMutation,
    Text: textType,
    A: { gold: "#gold", green: "#green", red: "#red", text: "#text", sub: "#sub", border: "#border" },
    Btn: buttonType,
    Card: componentType(),
    Empty: componentType(),
    Loading: componentType(),
    ScreenWrap: componentType(),
    SectionTitle: componentType(),
    useToast: () => (message, kind) => toastCalls.push({ message, kind }),
    Input: inputType,
    apiError: (cause) => cause instanceof Error ? cause.message : String(cause),
    setInterval: () => 0,
  };

  const AdminLeaderboards = new Function(
    ...Object.keys(scope),
    `${compiled}\nreturn AdminLeaderboards;`,
  )(...Object.values(scope));

  function render() {
    stateSlots ??= [];
    refSlots ??= [];
    stateIndex = 0;
    refIndex = 0;
    effectIndex = 0;
    return AdminLeaderboards();
  }

  return {
    render,
    inputType,
    buttonType,
    textType,
    serverSchedules,
    saveCalls,
    toastCalls,
    approvalCalls,
    approvalsQuery,
    adminQuery,
  };
}

function descendants(node, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) descendants(child, found);
  } else if (node && typeof node === "object" && "type" in node) {
    found.push(node);
    descendants(node.props?.children, found);
  }
  return found;
}

function textContent(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  return textContent(node.props?.children);
}

function formInputs(app) {
  return descendants(app.render()).filter((element) => element.type === app.inputType);
}

function inputValues(app) {
  return Object.fromEntries(
    formInputs(app).map((input) => [input.props.accessibilityLabel, input.props.value]),
  );
}

async function pressAndSettle(button) {
  await button.props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
}

const initialSchedules = {
  weekly: { firstPlaceCoins: 10, secondPlaceCoins: 20, thirdPlaceCoins: 30 },
  monthly: { firstPlaceCoins: 40, secondPlaceCoins: 50, thirdPlaceCoins: 60 },
};
const sixDigitSchedules = {
  weekly: { firstPlaceCoins: 123456, secondPlaceCoins: 234567, thirdPlaceCoins: 345678 },
  monthly: { firstPlaceCoins: 456789, secondPlaceCoins: 567890, thirdPlaceCoins: 678901 },
};

test("Full Admin form saves distinct six-digit prizes and displays them again after reopening", async () => {
  const persistedSchedules = structuredClone(initialSchedules);
  const app = loadAdminLeaderboards(persistedSchedules);

  // Run once to apply the screen's initial server-data synchronization, then
  // inspect the inputs created from that state.
  formInputs(app);
  let inputs = formInputs(app);
  assert.equal(inputs.length, 6);

  for (const cycle of ["weekly", "monthly"]) {
    for (const [key, label] of [
      ["firstPlaceCoins", "1st place"],
      ["secondPlaceCoins", "2nd place"],
      ["thirdPlaceCoins", "3rd place"],
    ]) {
      const input = inputs.find(
        (candidate) =>
          candidate.props.accessibilityLabel === `${cycle} ${label} reward coins`,
      );
      assert.ok(input, `The ${cycle} ${label} reward should have a form input.`);
      input.props.onChangeText(String(sixDigitSchedules[cycle][key]));
    }
  }

  inputs = formInputs(app);
  const expectedInputValues = Object.fromEntries(
    ["weekly", "monthly"].flatMap((cycle) =>
      [
        ["firstPlaceCoins", "1st place"],
        ["secondPlaceCoins", "2nd place"],
        ["thirdPlaceCoins", "3rd place"],
      ].map(([key, label]) => [
        `${cycle} ${label} reward coins`,
        String(sixDigitSchedules[cycle][key]),
      ]),
    ),
  );
  assert.deepEqual(inputValues(app), expectedInputValues);

  for (const cycle of ["weekly", "monthly"]) {
    const saveButton = descendants(app.render()).find(
      (element) =>
        element.type === app.buttonType &&
        element.props.title === `SAVE ${cycle.toUpperCase()} REWARDS`,
    );
    assert.ok(saveButton, `The ${cycle} reward save action should be rendered.`);
    assert.equal(saveButton.props.disabled, false);
    await pressAndSettle(saveButton);
    assert.deepEqual(persistedSchedules[cycle], sixDigitSchedules[cycle]);
    assert.deepEqual(inputValues(app), expectedInputValues);
  }

  const reopened = loadAdminLeaderboards(persistedSchedules);
  formInputs(reopened);
  assert.deepEqual(
    inputValues(reopened),
    expectedInputValues,
    "A newly opened Full Admin form should load the exact saved rank amounts.",
  );
});

test("Full Admin keeps six-digit prize entries after a failed save and retries the same values", async () => {
  const persistedSchedules = structuredClone(initialSchedules);
  const app = loadAdminLeaderboards(persistedSchedules, { failSaveAttempts: 1 });

  formInputs(app);
  let inputs = formInputs(app);
  for (const cycle of ["weekly", "monthly"]) {
    for (const [key, label] of [
      ["firstPlaceCoins", "1st place"],
      ["secondPlaceCoins", "2nd place"],
      ["thirdPlaceCoins", "3rd place"],
    ]) {
      const input = inputs.find(
        (candidate) =>
          candidate.props.accessibilityLabel === `${cycle} ${label} reward coins`,
      );
      assert.ok(input);
      input.props.onChangeText(String(sixDigitSchedules[cycle][key]));
    }
  }

  const expectedInputValues = Object.fromEntries(
    ["weekly", "monthly"].flatMap((cycle) =>
      [
        ["firstPlaceCoins", "1st place"],
        ["secondPlaceCoins", "2nd place"],
        ["thirdPlaceCoins", "3rd place"],
      ].map(([key, label]) => [
        `${cycle} ${label} reward coins`,
        String(sixDigitSchedules[cycle][key]),
      ]),
    ),
  );
  assert.deepEqual(inputValues(app), expectedInputValues);

  const weeklyPayload = { weekly: sixDigitSchedules.weekly };
  const findWeeklySaveButton = () =>
    descendants(app.render()).find(
      (element) =>
        element.type === app.buttonType &&
        element.props.title === "SAVE WEEKLY REWARDS",
    );
  const failedAttempt = findWeeklySaveButton();
  assert.ok(failedAttempt);
  assert.equal(failedAttempt.props.disabled, false);
  await pressAndSettle(failedAttempt);

  assert.deepEqual(app.saveCalls, [weeklyPayload]);
  assert.deepEqual(app.toastCalls, [{
    message:
      "Could not save weekly leaderboard rewards: Prize settings could not be saved. " +
      "Your entered amounts are still here; retry SAVE WEEKLY REWARDS.",
    kind: "error",
  }], "the failed prize save should create one actionable screen-reader toast");
  assert.deepEqual(inputValues(app), expectedInputValues);
  const visibleError = descendants(app.render()).find(
    (element) =>
      element.type === app.textType &&
      typeof element.props.children === "string" &&
      element.props.children.includes("Prize settings could not be saved."),
  );
  assert.ok(visibleError, "the failed save should leave a visible error");
  assert.deepEqual(persistedSchedules, initialSchedules, "a failed request must not update saved prizes");

  const retry = findWeeklySaveButton();
  assert.ok(retry);
  assert.equal(retry.props.disabled, false);
  await pressAndSettle(retry);

  assert.deepEqual(app.saveCalls, [weeklyPayload, weeklyPayload]);
  assert.equal(app.toastCalls.length, 2, "the failed save and retry should each announce one outcome");
  assert.equal(app.toastCalls[0].kind, "error");
  assert.equal(
    app.toastCalls[0].message,
    "Could not save weekly leaderboard rewards: Prize settings could not be saved. " +
      "Your entered amounts are still here; retry SAVE WEEKLY REWARDS.",
  );
  assert.equal(app.toastCalls[1].kind, "success");
  assert.equal(app.toastCalls[1].message, "weekly leaderboard rewards saved for this cycle.");
  assert.deepEqual(persistedSchedules.weekly, sixDigitSchedules.weekly);
  assert.deepEqual(persistedSchedules.monthly, initialSchedules.monthly);
  assert.deepEqual(
    inputValues(app),
    expectedInputValues,
    "the successful retry must keep all entered amounts visible",
  );
  assert.equal(
    descendants(app.render()).some(
      (element) =>
        element.type === app.textType &&
        typeof element.props.children === "string" &&
        element.props.children.includes("Prize settings could not be saved."),
    ),
    false,
    "the successful retry should clear the failure message",
  );
});

test("Full Admin keeps a failed leaderboard approval pending and retries it successfully", async () => {
  const approvalPeriod = {
    id: "weekly-pending-cycle",
    cycleType: "weekly",
    status: "pending_approval",
    startsAt: "2026-08-24T00:00:00.000Z",
    endsAt: "2026-08-31T00:00:00.000Z",
    standings: [{
      rank: 1,
      userId: "weekly-winner",
      name: "Weekly Winner",
      points: 24,
    }],
    rewards: [{ rank: 1, coins: 40 }],
  };
  const app = loadAdminLeaderboards(structuredClone(initialSchedules), {
    approvalPeriods: [approvalPeriod],
    failApprovalAttempts: 1,
  });
  const findButton = (title) =>
    descendants(app.render()).find(
      (element) => element.type === app.buttonType && element.props.title === title,
    );
  const findVisibleError = () =>
    descendants(app.render()).find(
      (element) =>
        element.type === app.textType &&
        typeof element.props.children === "string" &&
        element.props.children.includes("Could not confirm weekly payout"),
    );

  const reviewButton = findButton("REVIEW APPROVAL");
  assert.ok(reviewButton, "the pending weekly cycle should be available to review");
  await pressAndSettle(reviewButton);
  assert.ok(findButton("CONFIRM & PAY"), "review should open the confirmation actions");

  await pressAndSettle(findButton("CONFIRM & PAY"));

  const failedApprovalMessage =
    "Could not confirm weekly payout: Leaderboard approval is temporarily unavailable. " +
    "The cycle may still be pending; retry CONFIRM & PAY to check its status.";
  assert.equal(findVisibleError()?.props.children, failedApprovalMessage);
  assert.deepEqual(app.toastCalls, [{ message: failedApprovalMessage, kind: "error" }]);
  assert.deepEqual(app.approvalCalls, [approvalPeriod.id]);
  assert.equal(app.approvalsQuery.data.periods.length, 1);
  assert.equal(app.approvalsQuery.data.periods[0].id, approvalPeriod.id);
  assert.equal(app.approvalsQuery.refetchCalls, 0);
  assert.equal(app.adminQuery.refetchCalls, 0);
  assert.ok(findButton("CONFIRM & PAY"), "the same cycle should stay ready for another attempt");
  assert.equal(findButton("CONFIRM & PAY").props.disabled, false);

  await pressAndSettle(findButton("CONFIRM & PAY"));

  assert.deepEqual(app.approvalCalls, [approvalPeriod.id, approvalPeriod.id]);
  assert.equal(app.approvalsQuery.refetchCalls, 1);
  assert.equal(app.adminQuery.refetchCalls, 1);
  assert.deepEqual(app.approvalsQuery.data.periods, []);
  assert.equal(findButton("CONFIRM & PAY"), undefined);
  assert.equal(findVisibleError(), undefined, "the successful retry should clear the failure");
  assert.ok(
    descendants(app.render()).some(
      (element) =>
        element.type === app.textType &&
        element.props.children === "No weekly or monthly cycles are waiting for approval.",
    ),
    "the refreshed pending list should no longer contain the approved cycle",
  );
  assert.ok(
    descendants(app.render()).some(
      (element) =>
        element.type === app.textType &&
        textContent(element).includes("WEEKLY APPROVAL RESULT"),
    ),
    "the successful retry should display the approval result",
  );
  assert.deepEqual(app.toastCalls, [
    { message: failedApprovalMessage, kind: "error" },
    { message: "weekly leaderboard payout approved.", kind: "success" },
  ]);
});
