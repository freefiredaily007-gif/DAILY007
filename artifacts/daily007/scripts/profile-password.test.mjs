import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PROFILE_PASSWORD_MAX_LENGTH, submitProfilePasswordChange } from "../src/lib/profilePassword.ts";
import {
  customFetch,
  setAuthExpiredHandler,
  setAuthTokenGetter,
  setBaseUrl,
} from "../../../lib/api-client-react/src/custom-fetch.ts";

const profileSource = await readFile(
  new URL("../src/screens/Profile.tsx", import.meta.url),
  "utf8",
);
const uiSource = await readFile(
  new URL("../src/components/ui.tsx", import.meta.url),
  "utf8",
);
const uiSourceFile = ts.createSourceFile(
  "ui.tsx",
  uiSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const apiSource = await readFile(
  new URL("../src/lib/api.ts", import.meta.url),
  "utf8",
);
const profileSourceFile = ts.createSourceFile(
  "Profile.tsx",
  profileSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const apiSourceFile = ts.createSourceFile(
  "api.ts",
  apiSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function getBtnDisabledExpression() {
  const btnDeclaration = uiSourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "Btn",
  );
  assert.ok(btnDeclaration, "Expected the shared Btn implementation.");
  let disabledExpression;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(uiSourceFile) === "Pressable") {
      const attribute = node.attributes.properties.find(
        (property) => ts.isJsxAttribute(property) && property.name.getText(uiSourceFile) === "disabled",
      );
      if (attribute && ts.isJsxAttribute(attribute) && ts.isJsxExpression(attribute.initializer)) {
        disabledExpression = attribute.initializer.expression;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(btnDeclaration);
  assert.ok(disabledExpression, "The shared Btn should pass a disabled state to Pressable.");
  return disabledExpression.getText(uiSourceFile);
}

const btnDisabledExpression = getBtnDisabledExpression();

function evaluateBtnDisabled({ disabled, loading, preserveAccessibilityFocusWhileLoading }) {
  const javascript = ts.transpileModule(
    `const __disabled = (${btnDisabledExpression});`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  return new Function(
    "disabled",
    "loading",
    "preserveAccessibilityFocusWhileLoading",
    `${javascript}\nreturn __disabled;`,
  )(disabled, loading, preserveAccessibilityFocusWhileLoading);
}

function loadProfileCallback(callbackName, scope) {
  let declaration;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === callbackName
    ) {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(profileSourceFile);

  assert.ok(
    declaration?.initializer && ts.isArrowFunction(declaration.initializer),
    `Expected ${callbackName} to be an arrow function in Profile.`,
  );
  const javascript = ts.transpileModule(
    `const __callback = (${declaration.initializer.getText(profileSourceFile)});`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  return new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __callback;`,
  )(...Object.values(scope));
}

function loadApiError() {
  let declaration;
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node)
      && node.name?.text === "errMessage"
    ) {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(apiSourceFile);

  assert.ok(declaration, "Expected the production API error formatter.");
  const javascript = ts.transpileModule(
    `const __apiError = function ${declaration.name.text}(${declaration.parameters
      .map((parameter) => parameter.getText(apiSourceFile))
      .join(", ")}) ${declaration.body.getText(apiSourceFile)};`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  return new Function(`${javascript}\nreturn __apiError;`)();
}

function makePassword(length) {
  return "p".repeat(length);
}

async function runSubmission(
  newPassword,
  confirmNewPassword = newPassword,
  currentPassword = "current-test-value",
) {
  const requests = [];
  const changePassword = async (request) => {
    requests.push(request);
  };

  const result = await submitProfilePasswordChange({
    currentPassword,
    newPassword,
    confirmNewPassword,
    changePassword,
  });

  return { result, requests, currentPassword, newPassword, confirmNewPassword };
}

for (const length of [8, 200]) {
  test(`submits a ${length}-character password exactly once`, async () => {
    const { result, requests, currentPassword, newPassword } =
      await runSubmission(makePassword(length));

    assert.equal(result, null);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0]?.data?.currentPassword === currentPassword &&
        requests[0]?.data?.newPassword === newPassword,
      true,
      "The mutation should receive the current/new password payload unchanged.",
    );
    assert.deepEqual(Object.keys(requests[0].data).sort(), [
      "currentPassword",
      "newPassword",
    ]);
  });
}

test("rejects different valid-length password confirmation without submitting", async () => {
  const { result, requests } = await runSubmission(
    makePassword(8),
    `q${makePassword(7)}`,
  );

  assert.equal(result, "The new passwords do not match.");
  assert.equal(requests.length, 0);
});

for (const length of [7, 201]) {
  test(`rejects a ${length}-character password without submitting`, async () => {
    const { result, requests } = await runSubmission(makePassword(length));

    assert.equal(result, "Your new password must be 8–200 characters.");
    assert.equal(requests.length, 0);
  });
}

for (const length of [200, 201]) {
  test(`handles a ${length}-character current password at the boundary`, async () => {
    const { result, requests, currentPassword, newPassword } = await runSubmission(
      makePassword(8),
      undefined,
      makePassword(length),
    );

    if (length === 200) {
      assert.equal(result, null);
      assert.equal(requests.length, 1, "The maximum-length current password should submit once.");
      assert.equal(
        requests[0]?.data?.currentPassword === currentPassword
          && requests[0]?.data?.newPassword === newPassword,
        true,
        "The mocked mutation should receive the accepted password payload unchanged.",
      );
      return;
    }

    assert.equal(result, "Enter your current Daily007 password.");
    assert.equal(requests.length, 0, "An overlong current password must not reach the mutation.");
  });
}

test("Profile wires its password inputs to the shared 200-character limit", () => {
  assert.equal(
    (profileSource.match(/maxLength=\{PROFILE_PASSWORD_MAX_LENGTH\}/g) ?? []).length,
    3,
    "Current, new, and confirmation inputs should share the same input cap.",
  );
  assert.match(profileSource, /submitProfilePasswordChange\(\{[\s\S]*?changePassword,/);
  assert.match(
    profileSource,
    /if \(validationError\) \{\s*setPasswordError\(validationError\);\s*return;\s*\}/,
    "Profile should show the validation message and stop before reporting success.",
  );
  const passwordErrorMarkup = profileSource.match(
    /<Text style=\{s\.modalError\}[^>]*>\{passwordError\}<\/Text>/,
  )?.[0];
  assert.ok(passwordErrorMarkup, "Profile should render validation errors in the password modal.");
  assert.match(
    passwordErrorMarkup,
    /accessibilityLiveRegion="polite"/,
    "The password conflict should be announced without interrupting TalkBack.",
  );
  assert.equal(
    (passwordErrorMarkup.match(/accessibilityLiveRegion=/g) ?? []).length,
    1,
    "The password error should have exactly one live-region announcement.",
  );
  assert.doesNotMatch(passwordErrorMarkup, /accessibilityRole="alert"/);
  assert.doesNotMatch(profileSource, /setAccessibilityFocus/);
  assert.equal(PROFILE_PASSWORD_MAX_LENGTH, 200);
});

test("canceling Profile password change closes and clears every field without calling the mutation", () => {
  const state = {
    modalVisible: false,
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: "",
    passwordError: "",
    passwordMessage: "",
  };
  let mutationCalls = 0;
  const mockedMutation = async () => { mutationCalls += 1; };
  const setters = {
    setPasswordModalVisible: (value) => { state.modalVisible = value; },
    setCurrentPassword: (value) => { state.currentPassword = value; },
    setNewPassword: (value) => { state.newPassword = value; },
    setConfirmNewPassword: (value) => { state.confirmNewPassword = value; },
    setPasswordError: (value) => { state.passwordError = value; },
    setPasswordMessage: (value) => { state.passwordMessage = value; },
  };

  const openPasswordModal = loadProfileCallback("openPasswordModal", setters);
  openPasswordModal();
  assert.equal(state.modalVisible, true);

  state.currentPassword = "synthetic-current-value";
  state.newPassword = "synthetic-new-value";
  state.confirmNewPassword = "synthetic-confirmation-value";
  state.passwordError = "synthetic-validation-error";

  const submitPasswordChange = loadProfileCallback("submitPasswordChange", {
    currentPassword: state.currentPassword,
    newPassword: state.newPassword,
    confirmNewPassword: state.confirmNewPassword,
    changePassword: mockedMutation,
    submitProfilePasswordChange,
    apiError: () => "synthetic mutation error",
    ...setters,
  });
  const closePasswordModal = loadProfileCallback("closePasswordModal", {
    passwordBusy: false,
    changePassword: mockedMutation,
    ...setters,
  });
  closePasswordModal();

  assert.equal(typeof submitPasswordChange, "function");
  assert.equal(state.modalVisible, false, "Cancel should close the password form.");
  assert.equal(state.currentPassword, "", "Cancel should clear the current-password field.");
  assert.equal(state.newPassword, "", "Cancel should clear the new-password field.");
  assert.equal(state.confirmNewPassword, "", "Cancel should clear the confirmation field.");
  assert.equal(state.passwordError, "", "Cancel should clear any password-form error.");
  assert.equal(mutationCalls, 0, "Cancel must not submit the mocked password mutation.");

  openPasswordModal();
  assert.equal(state.modalVisible, true, "The form should be available to reopen.");
  assert.equal(state.currentPassword, "");
  assert.equal(state.newPassword, "");
  assert.equal(state.confirmNewPassword, "");
  assert.equal(mutationCalls, 0);

  assert.match(
    profileSource,
    /<Btn title="CANCEL" kind="ghost" disabled=\{passwordBusy\} onPress=\{closePasswordModal\} \/>/,
    "The visible Cancel action should use the exercised close handler.",
  );
  assert.match(profileSource, /onRequestClose=\{closePasswordModal\}/);
  assert.match(
    profileSource,
    /<Btn testID="profile-password-submit"[^>]*onPress=\{submitPasswordChange\}/,
    "Only the explicit Update Password action should submit the mutation.",
  );
});

test("Profile update control blocks a second submit while the mocked request is pending", async () => {
  const currentPassword = "synthetic-current-entry";
  const newPassword = "synthetic-new-entry";
  let passwordBusy = false;
  let mutationCalls = 0;
  let resolveMutation;
  const pendingMutation = new Promise((resolve) => { resolveMutation = resolve; });
  const changePassword = async () => {
    mutationCalls += 1;
    passwordBusy = true;
    try {
      await pendingMutation;
    } finally {
      passwordBusy = false;
    }
  };
  const setters = {
    setPasswordError: () => {},
    setPasswordMessage: () => {},
    setPasswordModalVisible: () => {},
    setCurrentPassword: () => {},
    setNewPassword: () => {},
    setConfirmNewPassword: () => {},
  };
  const submitPasswordChange = loadProfileCallback("submitPasswordChange", {
    currentPassword,
    newPassword,
    confirmNewPassword: newPassword,
    changePassword,
    submitProfilePasswordChange,
    apiError: () => "synthetic mutation error",
    ...setters,
  });
  const updateButton = profileSource.match(
    /<Btn testID="profile-password-submit"[^>]*\/>/,
  )?.[0];
  assert.ok(updateButton, "Profile should render its password update control.");
  assert.match(updateButton, /loading=\{passwordBusy\}/);
  assert.match(updateButton, /onPress=\{submitPasswordChange\}/);

  const pressUpdateButton = () => {
    const disabled = evaluateBtnDisabled({
      disabled: false,
      loading: passwordBusy,
      preserveAccessibilityFocusWhileLoading: false,
    });
    return disabled ? undefined : submitPasswordChange();
  };

  const firstSubmission = pressUpdateButton();
  assert.ok(firstSubmission instanceof Promise, "The first press should start the password request.");
  assert.equal(mutationCalls, 1);
  assert.equal(passwordBusy, true, "The mocked mutation should remain pending.");
  assert.equal(
    evaluateBtnDisabled({
      disabled: false,
      loading: passwordBusy,
      preserveAccessibilityFocusWhileLoading: false,
    }),
    true,
    "The shared button should become disabled while its loading state is true.",
  );

  assert.equal(pressUpdateButton(), undefined, "A disabled update control must ignore another press.");
  assert.equal(mutationCalls, 1, "Only one password request should be sent while the first is pending.");

  resolveMutation();
  await firstSubmission;
  assert.equal(passwordBusy, false);
  assert.equal(mutationCalls, 1);
});

test("successful Profile password change closes and clears the form and shows success feedback", async () => {
  const currentPassword = "mock-current-password";
  const newPassword = "mock-new-password";
  const confirmNewPassword = newPassword;
  const calls = {
    mutation: 0,
    validMutationPayload: false,
    modalVisibility: [],
    currentPassword: [],
    newPassword: [],
    confirmNewPassword: [],
    successMessage: [],
  };
  const setters = {
    setPasswordError: () => {},
    setPasswordMessage: (value) => calls.successMessage.push(value),
    setPasswordModalVisible: (value) => calls.modalVisibility.push(value),
    setCurrentPassword: (value) => calls.currentPassword.push(value),
    setNewPassword: (value) => calls.newPassword.push(value),
    setConfirmNewPassword: (value) => calls.confirmNewPassword.push(value),
  };
  const submitPasswordChange = loadProfileCallback("submitPasswordChange", {
    currentPassword,
    newPassword,
    confirmNewPassword,
    changePassword: async ({ data }) => {
      calls.mutation += 1;
      calls.validMutationPayload =
        data.currentPassword === currentPassword
        && data.newPassword === newPassword
        && Object.keys(data).sort().join(",") === "currentPassword,newPassword";
    },
    submitProfilePasswordChange,
    apiError: () => "Password change failed.",
    ...setters,
  });

  await submitPasswordChange();

  assert.equal(calls.mutation, 1, "The mocked password mutation should run once.");
  assert.equal(calls.validMutationPayload, true, "The mocked mutation should receive the expected payload.");
  assert.equal(calls.modalVisibility.at(-1), false, "The password form should close after success.");
  assert.equal(calls.currentPassword.at(-1), "", "The current password field should be cleared.");
  assert.equal(calls.newPassword.at(-1), "", "The new password field should be cleared.");
  assert.equal(calls.confirmNewPassword.at(-1), "", "The confirmation field should be cleared.");
  assert.equal(
    calls.successMessage.at(-1),
    "Password changed. Other sessions stay active until the next sign-in.",
    "Profile should set its success feedback after the mutation resolves.",
  );
  assert.match(
    profileSource,
    /<Modal\s+visible=\{passwordModalVisible\}/,
    "The password form should use the visibility state updated by the success handler.",
  );
  for (const field of ["currentPassword", "newPassword", "confirmNewPassword"]) {
    assert.match(
      profileSource,
      new RegExp(`value=\\{${field}\\}`),
      `The ${field} input should be controlled by the state cleared after success.`,
    );
  }
  assert.match(
    profileSource,
    /\{!!passwordMessage && <Text style=\{s\.connected\}>\{passwordMessage\}<\/Text>\}/,
    "Profile should render the success message state.",
  );
});

test("wrong-current-password 401 keeps the form and session available for retry", async () => {
  const incorrectCurrentPassword = "incorrect-current-password";
  const newPassword = "replacement-password-for-retry";
  const confirmNewPassword = newPassword;
  const calls = {
    mutationPayloads: [],
    apiStatus: undefined,
    errors: [],
    modalVisibility: [],
    currentPassword: [],
    newPassword: [],
    confirmNewPassword: [],
    logout: 0,
    sessionExpired: 0,
    requests: [],
  };
  const setters = {
    setPasswordError: (value) => calls.errors.push(value),
    setPasswordMessage: () => {},
    setPasswordModalVisible: (value) => calls.modalVisibility.push(value),
    setCurrentPassword: (value) => calls.currentPassword.push(value),
    setNewPassword: (value) => calls.newPassword.push(value),
    setConfirmNewPassword: (value) => calls.confirmNewPassword.push(value),
  };
  const productionApiError = loadApiError();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  const submitForCurrentPassword = (currentPassword) => loadProfileCallback("submitPasswordChange", {
    currentPassword,
    newPassword,
    confirmNewPassword,
    changePassword: async ({ data }) => {
      calls.mutationPayloads.push(data);
      return customFetch("/api/auth/me/password", {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    submitProfilePasswordChange,
    apiError: (error) => {
      calls.apiStatus = error?.response?.status;
      return productionApiError(error);
    },
    logout: () => { calls.logout += 1; },
    ...setters,
  });

  try {
    setBaseUrl("https://daily007.test");
    setAuthTokenGetter(() => "active-daily007-session");
    setAuthExpiredHandler(() => { calls.sessionExpired += 1; });
    globalThis.fetch = async (input, init) => {
      calls.requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body,
      });
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(JSON.stringify({
          error: "That current password does not match.",
          code: "CURRENT_PASSWORD_INCORRECT",
        }), {
          status: 401,
          statusText: "Unauthorized",
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await submitForCurrentPassword(incorrectCurrentPassword)();

    assert.equal(calls.apiStatus, 401, "Profile should receive the actual client error for the API's 401.");
    assert.equal(calls.errors.at(-1), "That current password does not match.");
    assert.deepEqual(calls.modalVisibility, [], "The rejected change should leave the form open.");
    assert.deepEqual(calls.currentPassword, [], "The current-password entry should not be cleared.");
    assert.deepEqual(calls.newPassword, [], "The new-password entry should remain for retry.");
    assert.deepEqual(calls.confirmNewPassword, [], "The confirmation entry should remain for retry.");
    assert.equal(calls.sessionExpired, 0, "A wrong password must not trigger the app's session-expired handler.");
    assert.equal(calls.logout, 0, "A wrong password must not log the player out.");

    for (const field of ["currentPassword", "newPassword", "confirmNewPassword"]) {
      assert.match(
        profileSource,
        new RegExp(`value=\\{${field}\\}`),
        `The ${field} input should remain bound to its preserved form state.`,
      );
    }

    await submitForCurrentPassword("correct-current-password")();

    assert.deepEqual(calls.mutationPayloads, [
      { currentPassword: incorrectCurrentPassword, newPassword },
      { currentPassword: "correct-current-password", newPassword },
    ], "Retrying should only require correcting the current password.");
    assert.deepEqual(calls.requests.map(({ url, method }) => ({ url, method })), [
      { url: "https://daily007.test/api/auth/me/password", method: "PATCH" },
      { url: "https://daily007.test/api/auth/me/password", method: "PATCH" },
    ]);
    assert.deepEqual(calls.modalVisibility, [false], "A successful retry should close the form.");
    assert.deepEqual(calls.newPassword, [""], "The form should clear new-password entries after success.");
    assert.deepEqual(calls.confirmNewPassword, [""], "The form should clear confirmation after success.");
    assert.equal(calls.sessionExpired, 0, "The session should remain active through rejection and retry.");
    assert.equal(calls.logout, 0);
  } finally {
    globalThis.fetch = originalFetch;
    setAuthTokenGetter(null);
    setAuthExpiredHandler(null);
    setBaseUrl(null);
  }
});

test("an expired-token 401 without the wrong-password code still expires the session on password change", async () => {
  let expiredSessionCalls = 0;
  const originalFetch = globalThis.fetch;

  try {
    setBaseUrl("https://daily007.test");
    setAuthTokenGetter(() => "active-daily007-session");
    setAuthExpiredHandler(() => { expiredSessionCalls += 1; });
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "Authentication is required." }), {
      status: 401,
      statusText: "Unauthorized",
      headers: { "content-type": "application/json" },
    });

    await assert.rejects(
      customFetch("/api/auth/me/password", {
        method: "PATCH",
        body: JSON.stringify({
          currentPassword: "current-password",
          newPassword: "new-password-value",
        }),
      }),
      (error) => error?.status === 401,
    );
    assert.equal(expiredSessionCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    setAuthTokenGetter(null);
    setAuthExpiredHandler(null);
    setBaseUrl(null);
  }
});

test("the shared Input component forwards maxLength to the native text input", () => {
  const inputComponent = uiSource.match(
    /export const Input = React\.forwardRef[\s\S]*?placeholderTextColor=\{props\.placeholderTextColor \|\| C\.dim\}/,
  )?.[0];

  assert.ok(inputComponent, "Expected the shared Input component.");
  assert.match(inputComponent, /<TextInput[\s\S]*?\{\.\.\.props\}/);
});
