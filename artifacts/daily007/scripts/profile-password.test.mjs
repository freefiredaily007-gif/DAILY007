import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PROFILE_PASSWORD_MAX_LENGTH, submitProfilePasswordChange } from "../src/lib/profilePassword.ts";

const profileSource = await readFile(
  new URL("../src/screens/Profile.tsx", import.meta.url),
  "utf8",
);
const uiSource = await readFile(
  new URL("../src/components/ui.tsx", import.meta.url),
  "utf8",
);
const profileSourceFile = ts.createSourceFile(
  "Profile.tsx",
  profileSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

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

function makePassword(length) {
  return "p".repeat(length);
}

async function runSubmission(newPassword, confirmNewPassword = newPassword) {
  const requests = [];
  const changePassword = async (request) => {
    requests.push(request);
  };
  const currentPassword = "current-test-value";

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
  assert.match(
    profileSource,
    /\{!!passwordError && <Text style=\{s\.modalError\}>\{passwordError\}<\/Text>\}/,
    "Profile should render validation errors in the password modal.",
  );
  assert.equal(PROFILE_PASSWORD_MAX_LENGTH, 200);
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

test("the shared Input component forwards maxLength to the native text input", () => {
  const inputComponent = uiSource.match(
    /export const Input = React\.forwardRef[\s\S]*?placeholderTextColor=\{props\.placeholderTextColor \|\| C\.dim\}/,
  )?.[0];

  assert.ok(inputComponent, "Expected the shared Input component.");
  assert.match(inputComponent, /<TextInput[\s\S]*?\{\.\.\.props\}/);
});
