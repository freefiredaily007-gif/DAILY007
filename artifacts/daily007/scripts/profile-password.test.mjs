import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  isProfilePasswordChangeOutcomeUncertain,
  PROFILE_PASSWORD_CHANGE_UNCERTAIN_MESSAGE,
  PROFILE_PASSWORD_MAX_LENGTH,
  submitProfilePasswordChange,
} from "../src/lib/profilePassword.ts";
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
    if (
      ts.isJsxOpeningElement(node)
      && ["Pressable", "AnimatedPressable"].includes(node.tagName.getText(uiSourceFile))
    ) {
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

test("Profile distinguishes a lost password-change response from a server rejection", () => {
  assert.equal(
    isProfilePasswordChangeOutcomeUncertain(new TypeError("Failed to fetch")),
    true,
    "A transport error without an HTTP response has an unknown outcome.",
  );
  assert.equal(
    isProfilePasswordChangeOutcomeUncertain({ response: { status: 401 } }),
    false,
    "A server rejection has a known outcome and should keep its real error message.",
  );
  assert.equal(
    isProfilePasswordChangeOutcomeUncertain(new Error("That current password does not match.")),
    false,
    "An ordinary server message should not be relabeled as a connection failure.",
  );
  assert.equal(
    PROFILE_PASSWORD_CHANGE_UNCERTAIN_MESSAGE,
    "Connection lost before Daily007 confirmed the change. Your password may already be updated. Keep this form open and press UPDATE PASSWORD again to safely confirm it.",
  );
});

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
  const dependencies = {
    isProfilePasswordChangeOutcomeUncertain,
    PROFILE_PASSWORD_CHANGE_UNCERTAIN_MESSAGE,
    ...scope,
  };
  return new Function(
    ...Object.keys(dependencies),
    `${javascript}\nreturn __callback;`,
  )(...Object.values(dependencies));
}

function getPasswordModalRequestCloseHandlerName() {
  let handlerName;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(profileSourceFile) === "Modal") {
      const attributes = node.openingElement.attributes.properties;
      const visibleAttribute = attributes.find(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(profileSourceFile) === "visible",
      );
      const visibleExpression =
        visibleAttribute && ts.isJsxAttribute(visibleAttribute) && ts.isJsxExpression(visibleAttribute.initializer)
          ? visibleAttribute.initializer.expression?.getText(profileSourceFile)
          : undefined;
      if (visibleExpression === "passwordModalVisible") {
        const requestCloseAttribute = attributes.find(
          (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(profileSourceFile) === "onRequestClose",
        );
        const requestCloseExpression =
          requestCloseAttribute &&
          ts.isJsxAttribute(requestCloseAttribute) &&
          ts.isJsxExpression(requestCloseAttribute.initializer)
            ? requestCloseAttribute.initializer.expression
            : undefined;
        if (requestCloseExpression && ts.isIdentifier(requestCloseExpression)) {
          handlerName = requestCloseExpression.text;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(profileSourceFile);
  assert.ok(handlerName, "The password modal should expose its system-dismiss callback.");
  return handlerName;
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
  assert.equal(PROFILE_PASSWORD_MAX_LENGTH, 200);
});

test("Profile exposes password-change API errors through one polite TalkBack announcement", () => {
  assert.match(
    profileSource,
    /catch \(e\) \{\s*setPasswordError\([\s\S]*?isProfilePasswordChangeOutcomeUncertain\(e\)[\s\S]*?PROFILE_PASSWORD_CHANGE_UNCERTAIN_MESSAGE[\s\S]*?apiError\(e\)/,
    "Profile should distinguish an uncertain connection outcome from a server rejection.",
  );
  const passwordErrorMarkup = profileSource.match(
    /<Text style=\{s\.modalError\}[^>]*>\{passwordError\}<\/Text>/,
  )?.[0];
  assert.ok(passwordErrorMarkup, "Profile should render password errors in the password modal.");
  assert.match(
    passwordErrorMarkup,
    /accessibilityLiveRegion="polite"/,
    "TalkBack should politely announce the current-password rejection.",
  );
  assert.equal(
    (passwordErrorMarkup.match(/accessibilityLiveRegion=/g) ?? []).length,
    1,
    "The rejection should have exactly one live-region announcement.",
  );
  assert.doesNotMatch(passwordErrorMarkup, /accessibilityRole="alert"/);
  assert.doesNotMatch(profileSource, /setAccessibilityFocus/);
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
    passwordChangeInFlight: { current: false },
    changePassword: mockedMutation,
    submitProfilePasswordChange,
    apiError: () => "synthetic mutation error",
    ...setters,
  });
  const closePasswordModal = loadProfileCallback("closePasswordModal", {
    passwordBusy: false,
    passwordChangeInFlight: { current: false },
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
    /<Btn\s+testID="profile-password-cancel"\s+title="CANCEL"\s+kind="ghost"\s+disabled=\{passwordBusy\}\s+onPress=\{closePasswordModal\}\s*\/>/,
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
  const passwordChangeInFlight = { current: false };
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
    passwordChangeInFlight,
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

test("the confirmation field cannot submit again until its password request settles", async () => {
  const passwordChangeInFlight = { current: false };
  let mutationCalls = 0;
  const mutationResolvers = [];
  const changePassword = async () => {
    mutationCalls += 1;
    await new Promise((resolve) => mutationResolvers.push(resolve));
  };
  const submitPasswordChange = loadProfileCallback("submitPasswordChange", {
    currentPassword: "synthetic-current-entry",
    newPassword: "synthetic-new-entry",
    confirmNewPassword: "synthetic-new-entry",
    passwordChangeInFlight,
    changePassword,
    submitProfilePasswordChange,
    apiError: () => "synthetic mutation error",
    setPasswordError: () => {},
    setPasswordMessage: () => {},
    setPasswordModalVisible: () => {},
    setCurrentPassword: () => {},
    setNewPassword: () => {},
    setConfirmNewPassword: () => {},
  });
  const confirmationInput = profileSource.match(
    /<Input(?:(?!<Input)[\s\S])*?onSubmitEditing=\{submitPasswordChange\}[\s\S]*?\/>/,
  )?.[0];
  assert.ok(confirmationInput, "The confirmation field should submit through the guarded handler.");
  assert.match(confirmationInput, /onSubmitEditing=\{submitPasswordChange\}/);

  const submitFromConfirmationField = () => submitPasswordChange();
  const firstSubmission = submitFromConfirmationField();
  assert.equal(mutationCalls, 1, "The first keyboard submit should start one request.");
  assert.equal(passwordChangeInFlight.current, true, "The handler should synchronously lock before awaiting.");

  await submitFromConfirmationField();
  assert.equal(mutationCalls, 1, "A queued keyboard submit must not send a second request.");

  mutationResolvers[0]();
  await firstSubmission;
  assert.equal(passwordChangeInFlight.current, false, "The guard should clear when the request settles.");

  const retrySubmission = submitFromConfirmationField();
  assert.equal(mutationCalls, 2, "The keyboard submit should work again after the pending request settles.");
  mutationResolvers[1]();
  await retrySubmission;
  assert.equal(passwordChangeInFlight.current, false);
});

for (const scenario of [
  {
    name: "missing current password",
    invalid: { currentPassword: "", newPassword: "valid-new-password", confirmNewPassword: "valid-new-password" },
    corrected: { currentPassword: "valid-current-password", newPassword: "valid-new-password", confirmNewPassword: "valid-new-password" },
    message: "Enter your current Daily007 password.",
  },
  {
    name: "invalid new password",
    invalid: { currentPassword: "valid-current-password", newPassword: "short", confirmNewPassword: "short" },
    corrected: { currentPassword: "valid-current-password", newPassword: "valid-new-password", confirmNewPassword: "valid-new-password" },
    message: "Your new password must be 8–200 characters.",
  },
  {
    name: "mismatched confirmation",
    invalid: { currentPassword: "valid-current-password", newPassword: "valid-new-password", confirmNewPassword: "different-password" },
    corrected: { currentPassword: "valid-current-password", newPassword: "valid-new-password", confirmNewPassword: "valid-new-password" },
    message: "The new passwords do not match.",
  },
]) {
  test(`Profile allows a retry after ${scenario.name} feedback`, async () => {
    const passwordChangeInFlight = { current: false };
    let mutationCalls = 0;
    const errors = [];
    const changePassword = async () => { mutationCalls += 1; };
    const makeSubmitPasswordChange = (values) => loadProfileCallback("submitPasswordChange", {
      ...values,
      passwordChangeInFlight,
      changePassword,
      submitProfilePasswordChange,
      apiError: () => "synthetic mutation error",
      setPasswordError: (message) => { errors.push(message); },
      setPasswordMessage: () => {},
      setPasswordModalVisible: () => {},
      setCurrentPassword: () => {},
      setNewPassword: () => {},
      setConfirmNewPassword: () => {},
    });

    await makeSubmitPasswordChange(scenario.invalid)();

    assert.equal(errors.at(-1), scenario.message, "Profile should expose the expected local validation feedback.");
    assert.equal(mutationCalls, 0, "Invalid local fields must not reach the mocked mutation.");
    assert.equal(passwordChangeInFlight.current, false, "Local validation feedback must release the submit guard.");

    await makeSubmitPasswordChange(scenario.corrected)();

    assert.equal(mutationCalls, 1, "A later submit with corrected fields must reach the mocked mutation.");
    assert.equal(passwordChangeInFlight.current, false, "The guard should release after the corrected submission.");
  });
}

test("successful Profile password change closes and clears the form and announces success once", async () => {
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
  const passwordChangeInFlight = { current: false };
  const submitPasswordChange = loadProfileCallback("submitPasswordChange", {
    currentPassword,
    newPassword,
    confirmNewPassword,
    passwordChangeInFlight,
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
  const successMessageMarkup = profileSource.match(
    /<Text style=\{s\.connected\}[^>]*>\{passwordMessage\}<\/Text>/,
  )?.[0];
  assert.ok(successMessageMarkup, "Profile should render the success message state.");
  assert.match(
    successMessageMarkup,
    /accessibilityLiveRegion="polite"/,
    "TalkBack should politely announce the successful password change.",
  );
  assert.equal(
    (successMessageMarkup.match(/accessibilityLiveRegion=/g) ?? []).length,
    1,
    "The success message should have exactly one live-region announcement.",
  );
  assert.doesNotMatch(
    successMessageMarkup,
    /accessibilityRole="alert"/,
    "Success feedback should remain polite rather than interrupting speech.",
  );
  assert.doesNotMatch(
    profileSource,
    /setAccessibilityFocus|announceForAccessibility/,
    "Success feedback should not add a redundant announcement or force a focus jump.",
  );
  assert.match(
    profileSource,
    /\{!!passwordMessage && <Text style=\{s\.connected\} accessibilityLiveRegion="polite">\{passwordMessage\}<\/Text>\}/,
    "Profile should conditionally render the single polite success announcement.",
  );
});

test("a lost password-change reply keeps the form and a safe retry confirms success", async () => {
  const currentPassword = "correct-current-password";
  const newPassword = "replacement-password-after-lost-reply";
  const state = {
    modalVisible: true,
    currentPassword,
    newPassword,
    confirmNewPassword: newPassword,
    passwordError: "",
    passwordMessage: "",
  };
  let activePassword = currentPassword;
  const requests = [];
  const visibility = [];
  const submitPasswordChange = loadProfileCallback("submitPasswordChange", {
    currentPassword,
    newPassword,
    confirmNewPassword: newPassword,
    passwordChangeInFlight: { current: false },
    changePassword: async ({ data }) => {
      requests.push(data);
      if (requests.length === 1) {
        activePassword = data.newPassword;
        throw new TypeError("Failed to fetch");
      }
      if (data.newPassword === activePassword) {
        return { message: "Password change already applied." };
      }
      throw new Error("The requested password is not active.");
    },
    submitProfilePasswordChange,
    apiError: (error) => error.message,
    setPasswordError: (value) => { state.passwordError = value; },
    setPasswordMessage: (value) => { state.passwordMessage = value; },
    setPasswordModalVisible: (value) => {
      state.modalVisible = value;
      visibility.push(value);
    },
    setCurrentPassword: (value) => { state.currentPassword = value; },
    setNewPassword: (value) => { state.newPassword = value; },
    setConfirmNewPassword: (value) => { state.confirmNewPassword = value; },
  });

  await submitPasswordChange();

  assert.equal(state.passwordError, PROFILE_PASSWORD_CHANGE_UNCERTAIN_MESSAGE);
  assert.equal(state.modalVisible, true, "The form should remain open when the reply is uncertain.");
  assert.equal(state.currentPassword, currentPassword);
  assert.equal(state.newPassword, newPassword);
  assert.equal(state.confirmNewPassword, newPassword);
  assert.deepEqual(visibility, [], "An uncertain reply should not close or reset the form.");

  await submitPasswordChange();

  assert.deepEqual(requests, [
    { currentPassword, newPassword },
    { currentPassword, newPassword },
  ], "Recovery should retry the same password-change request.");
  assert.equal(state.passwordError, "");
  assert.equal(state.passwordMessage, "Password changed. Other sessions stay active until the next sign-in.");
  assert.equal(state.modalVisible, false);
  assert.equal(state.currentPassword, "");
  assert.equal(state.newPassword, "");
  assert.equal(state.confirmNewPassword, "");
  assert.deepEqual(visibility, [false]);
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
  const passwordChangeInFlight = { current: false };
  const submitForCurrentPassword = (currentPassword) => loadProfileCallback("submitPasswordChange", {
    currentPassword,
    newPassword,
    confirmNewPassword,
    passwordChangeInFlight,
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

test("canceling after a rejected password change clears all entries before reopening", async () => {
  const state = {
    modalVisible: false,
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: "",
    passwordError: "",
  };
  let mutationCalls = 0;
  const setters = {
    setPasswordModalVisible: (value) => { state.modalVisible = value; },
    setCurrentPassword: (value) => { state.currentPassword = value; },
    setNewPassword: (value) => { state.newPassword = value; },
    setConfirmNewPassword: (value) => { state.confirmNewPassword = value; },
    setPasswordError: (value) => { state.passwordError = value; },
    setPasswordMessage: () => {},
  };
  const passwordChangeInFlight = { current: false };
  const openPasswordModal = loadProfileCallback("openPasswordModal", setters);
  const closePasswordModal = loadProfileCallback("closePasswordModal", {
    passwordBusy: false,
    passwordChangeInFlight: { current: false },
    ...setters,
  });
  openPasswordModal();
  state.currentPassword = "synthetic-current-entry";
  state.newPassword = "synthetic-new-entry";
  state.confirmNewPassword = state.newPassword;

  const submitPasswordChange = loadProfileCallback("submitPasswordChange", {
    currentPassword: state.currentPassword,
    newPassword: state.newPassword,
    confirmNewPassword: state.confirmNewPassword,
    passwordChangeInFlight,
    changePassword: async () => {
      mutationCalls += 1;
      throw new Error("Mocked password request rejected.");
    },
    submitProfilePasswordChange,
    apiError: () => "That current password does not match.",
    ...setters,
  });

  await submitPasswordChange();

  assert.equal(mutationCalls, 1, "The mocked rejected password request should run once.");
  assert.equal(state.modalVisible, true, "A rejected change should leave the form open until canceled.");
  assert.equal(state.passwordError, "That current password does not match.");
  assert.equal(state.currentPassword.length > 0, true);
  assert.equal(state.newPassword.length > 0, true);
  assert.equal(state.confirmNewPassword.length > 0, true);

  closePasswordModal();

  assert.equal(state.modalVisible, false, "Cancel should close the rejected form.");
  assert.equal(state.currentPassword, "", "Cancel should clear the current-password entry.");
  assert.equal(state.newPassword, "", "Cancel should clear the new-password entry.");
  assert.equal(state.confirmNewPassword, "", "Cancel should clear the confirmation entry.");
  assert.equal(state.passwordError, "", "Cancel should clear the rejected-change error.");

  openPasswordModal();

  assert.equal(state.modalVisible, true, "The password form should reopen.");
  assert.equal(state.currentPassword, "", "The reopened current-password field should be empty.");
  assert.equal(state.newPassword, "", "The reopened new-password field should be empty.");
  assert.equal(state.confirmNewPassword, "", "The reopened confirmation field should be empty.");
  closePasswordModal();
  assert.equal(mutationCalls, 1, "Canceling and reopening must not send another mutation.");

  for (const field of ["currentPassword", "newPassword", "confirmNewPassword"]) {
    assert.match(
      profileSource,
      new RegExp(`value=\\{${field}\\}`),
      `The ${field} input should display the state cleared by cancellation.`,
    );
  }
  assert.match(
    profileSource,
    /<Btn\s+testID="profile-password-cancel"\s+title="CANCEL"\s+kind="ghost"\s+disabled=\{passwordBusy\}\s+onPress=\{closePasswordModal\}\s*\/>/,
    "The visible Cancel action should use the tested close handler.",
  );
});

test("Android Back cannot dismiss a password form before its deferred request settles", async () => {
  const entries = {
    currentPassword: "synthetic-current-entry",
    newPassword: "synthetic-new-entry",
    confirmNewPassword: "synthetic-new-entry",
  };
  const state = {
    modalVisible: false,
    ...entries,
    passwordError: "",
  };
  let passwordBusy = false;
  let mutationCalls = 0;
  const passwordChangeInFlight = { current: false };
  let resolveRequestStarted;
  let rejectRequest;
  const requestStarted = new Promise((resolve) => { resolveRequestStarted = resolve; });
  const pendingRequest = new Promise((_, reject) => { rejectRequest = reject; });
  const setters = {
    setPasswordModalVisible: (value) => { state.modalVisible = value; },
    setCurrentPassword: (value) => { state.currentPassword = value; },
    setNewPassword: (value) => { state.newPassword = value; },
    setConfirmNewPassword: (value) => { state.confirmNewPassword = value; },
    setPasswordError: (value) => { state.passwordError = value; },
    setPasswordMessage: () => {},
  };
  const openPasswordModal = loadProfileCallback("openPasswordModal", setters);
  openPasswordModal();
  Object.assign(state, entries);

  const submitPasswordChange = loadProfileCallback("submitPasswordChange", {
    ...entries,
    passwordChangeInFlight,
    changePassword: async () => {
      mutationCalls += 1;
      passwordBusy = true;
      resolveRequestStarted();
      try {
        await pendingRequest;
      } finally {
        passwordBusy = false;
      }
    },
    submitProfilePasswordChange,
    apiError: () => "The mocked password request failed.",
    ...setters,
  });

  const cancelButton = profileSource.match(
    /<Btn\s+testID="profile-password-cancel"[\s\S]*?\/>/,
  )?.[0];
  assert.ok(cancelButton, "Profile should render its password Cancel control.");
  assert.match(cancelButton, /disabled=\{passwordBusy\}/);
  assert.match(cancelButton, /onPress=\{closePasswordModal\}/);
  assert.equal(profileSource.includes("onRequestClose={closePasswordModal}"), true);

  const submission = submitPasswordChange();
  const immediateBack = loadProfileCallback("closePasswordModal", {
    passwordBusy: false,
    passwordChangeInFlight,
    ...setters,
  });
  immediateBack();
  assert.equal(
    state.modalVisible,
    true,
    "Android Back must leave the form open when the synchronous in-flight ref is set but rendered busy state is stale.",
  );
  const immediateCancel = loadProfileCallback("closePasswordModal", {
    passwordBusy: false,
    passwordChangeInFlight,
    ...setters,
  });
  immediateCancel();
  assert.equal(
    state.modalVisible,
    true,
    "Cancel must also leave the form open before the rendered busy state catches up.",
  );
  assert.equal(passwordBusy, true, "The mocked request should be pending even before a rendered busy-state update.");
  await requestStarted;
  assert.equal(mutationCalls, 1, "Submitting should start exactly one controlled request.");
  assert.equal(passwordBusy, true, "The mocked request should remain pending.");

  const closeWhilePending = loadProfileCallback("closePasswordModal", {
    passwordBusy,
    passwordChangeInFlight,
    ...setters,
  });
  closeWhilePending(); // The visible Cancel handler must be safe even if invoked while disabled.
  assert.equal(state.modalVisible, true, "Cancel must leave the form open while the request is pending.");
  assert.equal(
    state.currentPassword === entries.currentPassword
      && state.newPassword === entries.newPassword
      && state.confirmNewPassword === entries.confirmNewPassword,
    true,
    "Cancel must preserve all three entries while the request is pending.",
  );

  const onRequestClose = loadProfileCallback(getPasswordModalRequestCloseHandlerName(), {
    passwordBusy,
    passwordChangeInFlight,
    ...setters,
  });
  onRequestClose();
  assert.equal(state.modalVisible, true, "Modal dismissal must leave the form open while pending.");
  assert.equal(
    state.currentPassword === entries.currentPassword
      && state.newPassword === entries.newPassword
      && state.confirmNewPassword === entries.confirmNewPassword,
    true,
    "Modal dismissal must preserve all three entries while the request is pending.",
  );

  rejectRequest(new Error("Mocked password request rejected."));
  await submission;
  assert.equal(passwordBusy, false, "The mocked request should no longer be pending after rejection.");
  assert.equal(state.modalVisible, true, "A rejected request should leave the form available to dismiss.");

  const closeAfterSettle = loadProfileCallback("closePasswordModal", {
    passwordBusy,
    passwordChangeInFlight,
    ...setters,
  });
  closeAfterSettle();
  assert.equal(state.modalVisible, false, "Cancel should dismiss the form after the request settles.");
  assert.equal(
    [state.currentPassword, state.newPassword, state.confirmNewPassword].every((value) => value === ""),
    true,
    "Dismissing after settlement should clear all three entries.",
  );
  assert.equal(mutationCalls, 1, "Dismissal should not send another password request.");
});

test("Android Back after a rejected password change closes and clears the form before reopening", async () => {
  const state = {
    modalVisible: false,
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: "",
    passwordError: "",
  };
  let mutationCalls = 0;
  const setters = {
    setPasswordModalVisible: (value) => { state.modalVisible = value; },
    setCurrentPassword: (value) => { state.currentPassword = value; },
    setNewPassword: (value) => { state.newPassword = value; },
    setConfirmNewPassword: (value) => { state.confirmNewPassword = value; },
    setPasswordError: (value) => { state.passwordError = value; },
    setPasswordMessage: () => {},
  };
  const openPasswordModal = loadProfileCallback("openPasswordModal", setters);
  openPasswordModal();
  state.currentPassword = "synthetic-current-entry";
  state.newPassword = "synthetic-new-entry";
  state.confirmNewPassword = state.newPassword;

  const submitPasswordChange = loadProfileCallback("submitPasswordChange", {
    currentPassword: state.currentPassword,
    newPassword: state.newPassword,
    confirmNewPassword: state.confirmNewPassword,
    passwordChangeInFlight: { current: false },
    changePassword: async () => {
      mutationCalls += 1;
      throw new Error("Mocked password request rejected.");
    },
    submitProfilePasswordChange,
    apiError: () => "That current password does not match.",
    ...setters,
  });

  await submitPasswordChange();
  assert.equal(mutationCalls, 1, "The mocked rejected password request should run once.");
  assert.equal(state.modalVisible, true, "A rejected change should leave the form open.");
  assert.equal(state.passwordError, "That current password does not match.");
  assert.equal(
    [state.currentPassword, state.newPassword, state.confirmNewPassword].every((value) => value.length > 0),
    true,
    "The rejected form should still contain entries before Android Back dismisses it.",
  );

  const requestCloseHandlerName = getPasswordModalRequestCloseHandlerName();
  assert.equal(requestCloseHandlerName, "closePasswordModal");
  const onRequestClose = loadProfileCallback(requestCloseHandlerName, {
    passwordBusy: false,
    passwordChangeInFlight: { current: false },
    ...setters,
  });
  onRequestClose();

  assert.equal(state.modalVisible, false, "Android Back should close the rejected password form.");
  assert.equal(
    [state.currentPassword, state.newPassword, state.confirmNewPassword].every((value) => value === ""),
    true,
    "Android Back should clear all three password fields.",
  );
  assert.equal(state.passwordError, "", "Android Back should clear the rejected-change error.");

  openPasswordModal();
  assert.equal(state.modalVisible, true, "The password form should be available to reopen.");
  assert.equal(
    [state.currentPassword, state.newPassword, state.confirmNewPassword].every((value) => value === ""),
    true,
    "Reopening after Android Back should show empty password fields.",
  );
  assert.equal(mutationCalls, 1, "Reopening must not send another password mutation.");
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
