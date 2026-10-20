import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test, { mock } from "node:test";

let nextPostError = null;
const mockedHttp = {
  defaults: { headers: { common: {} } },
  interceptors: { response: { use() {} } },
  get() {
    assert.fail("The login retry test should not issue a GET request.");
  },
  post(path, body) {
    if (nextPostError) {
      const error = nextPostError;
      nextPostError = null;
      return Promise.reject(error);
    }
    assert.fail(`Unexpected POST to ${path} with ${JSON.stringify(body)}.`);
  },
};

mock.module("axios", {
  defaultExport: { create: () => mockedHttp },
});
mock.module("@react-native-async-storage/async-storage", {
  defaultExport: {
    async getItem() { return null; },
    async setItem() {},
    async removeItem() {},
  },
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

const { Api, apiError, LoginRateLimitError } = await import("../src/lib/api.ts");
const authSource = await readFile(
  new URL("../src/screens/Auth.tsx", import.meta.url),
  "utf8",
);
const throttleTestSource = await readFile(
  new URL("../../api-server/tests/daily007-session-replacement.test.ts", import.meta.url),
  "utf8",
);
const throttleSource = await readFile(
  new URL("../../api-server/src/lib/daily007-login-throttle.ts", import.meta.url),
  "utf8",
);

test("the login client preserves Retry-After seconds with the generic 429 error", async () => {
  const message = "Too many login attempts. Please try again shortly.";
  nextPostError = {
    response: {
      status: 429,
      data: { error: message },
      headers: { "retry-after": "37" },
    },
    message: "Request failed with status code 429",
  };

  await assert.rejects(
    Api.login({ email: "known@example.test", password: "incorrect-password" }),
    (error) => {
      assert.ok(error instanceof LoginRateLimitError);
      assert.equal(error.retryAfterSeconds, 37);
      assert.equal(apiError(error), message);
      assert.doesNotMatch(apiError(error), /known@example\.test/i);
      return true;
    },
  );
});

test("the login client reads Retry-After from AxiosHeaders", async () => {
  nextPostError = {
    response: {
      status: 429,
      data: { error: "Too many login attempts. Please try again shortly." },
      headers: { get: (name) => name.toLowerCase() === "retry-after" ? "4" : null },
    },
  };

  await assert.rejects(
    Api.login({ email: "unknown@example.test", password: "incorrect-password" }),
    (error) => {
      assert.ok(error instanceof LoginRateLimitError);
      assert.equal(error.retryAfterSeconds, 4);
      return true;
    },
  );
});

test("the Auth screen exposes a wait countdown and reenables login at expiry", () => {
  assert.match(authSource, /e instanceof LoginRateLimitError/);
  assert.match(authSource, /setLoginRetryDeadline\(Date\.now\(\) \+ seconds \* 1000\)/);
  assert.match(authSource, /const remainingSeconds = Math\.max\(0, Math\.ceil\(remainingMs \/ 1000\)\)/);
  assert.match(authSource, /setLoginThrottleStatus\('You can try logging in now\.'\)/);
  assert.match(authSource, /loginRetryDeadline > Date\.now\(\)/);
  assert.match(authSource, /disabled=\{googleBusy \|\| \(!isSignup && loginRetryRemaining > 0\)\}/);
  assert.match(authSource, /Login available in \$\{loginRetryRemaining\}/);
  assert.match(authSource, /Wait \$\{seconds\} \$\{seconds === 1 \? 'second' : 'seconds'\} before trying again\./);
  assert.match(authSource, /accessibilityLiveRegion=\{loginRetryRemaining > 0 \? 'assertive' : 'polite'\}/);
  assert.match(authSource, /testID="auth-login-throttle-status"/);
});

test("known and unknown addresses keep the same generic throttling response", () => {
  assert.match(
    throttleTestSource,
    /assert\.deepEqual\(limitedUnknownEmail\.body, limitedKnownEmail\.body\)/,
  );
  assert.match(
    throttleTestSource,
    /limitedKnownEmail\.body,\s*\{ error: DAILY007_LOGIN_RATE_LIMIT_MESSAGE \}/,
  );
  assert.match(
    throttleSource,
    /const DAILY007_LOGIN_RATE_LIMIT_MESSAGE\s*=\s*"Too many login attempts\. Please try again shortly\."/,
  );
});
