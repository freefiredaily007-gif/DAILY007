import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { previewDependencyBoundaryPlugin } from "./previewDependencyBoundary.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sandboxRoot = path.resolve(scriptDirectory, "..");
const workspaceRoot = path.resolve(sandboxRoot, "../..");
const pending = new Map();
const browserErrors = [];
const externalRequests = [];
const ignoredBrowserErrors = new Set([
  "BackHandler is not supported on web and should not be used.",
  "Unexpected text node: . A text node cannot be a child of a <View>.",
]);
let activeChromium;
let browserOutput = "";
let socket;
let messageId = 0;
const phoneViewport = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
const tournamentDetailOnly = process.argv.includes("--tournament-detail-only");
const instagramClaimOnly = process.argv.includes("--instagram-claim-only");
const previewGroups = [
  {
    config: "vite.admin-narrow.config.ts",
    entries: [
      {
        path: "/admin-narrow-preview.html",
        screen: "Admin",
        markers: ["ADMIN OPS", 'data-testid="admin-tab-users"'],
        phoneMarkers: ["ADMIN OPS"],
      },
      {
        path: "/home-carousel-preview.html",
        screen: "Home carousel",
        markers: ["DAILY007 TOURNAMENTS", "GAME MODES"],
        phoneMarkers: ["DAILY007 TOURNAMENTS", "GAME MODES"],
      },
      {
        path: "/home-carousel-preview.html?screen=MyMatches&my-matches-phone=1",
        screen: "My Matches",
        markers: ["MY MATCHES", 'data-testid="my-matches-tab-completed"'],
        phoneMarkers: ["MY MATCHES", 'data-testid="my-matches-tab-completed"'],
        interaction: {
          selector: '[data-testid="my-matches-tab-completed"]',
          markers: [
            "Daily007 International Championship Grand Finals",
            'data-testid="my-matches-result-1-0"',
            'data-testid="my-matches-result-name-1-0"',
            'data-testid="my-matches-result-details-1-0"',
            'data-testid="my-matches-result-prize-1-0"',
            'data-testid="room-credential-copy-room-id"',
            'data-testid="room-credential-copy-password"',
          ],
          phoneMarkers: [
            "Daily007 International Championship Grand Finals",
            'data-testid="my-matches-result-1-0"',
            'data-testid="my-matches-result-name-1-0"',
            'data-testid="my-matches-result-details-1-0"',
            'data-testid="my-matches-result-prize-1-0"',
            'data-testid="room-credential-copy-room-id"',
            'data-testid="room-credential-copy-password"',
          ],
        },
      },
      {
        path: "/home-carousel-preview.html?screen=TDetail&tournament-detail-phone=1",
        screen: "Tournament Details",
        viewport: { ...phoneViewport, width: 320 },
        largeTextViewport: { ...phoneViewport, width: 390 },
        largeTextScales: [1.5, 2],
        markers: [
          "Daily007 International Championship Tournament Details Phone Preview",
          "SCHEDULED START:",
          "ROOM DETAILS",
          "D7-PHONE-ROOM-48291",
          "PHONE-PREVIEW-PASS-2026",
          'data-testid="room-credential-copy-room-id"',
          'data-testid="room-credential-copy-password"',
          'data-testid="participant-count-heading"',
          "Daily007 Championship Squad",
          "Captain With A Long International Tournament Name",
        ],
        phoneMarkers: [
          "SCHEDULED START:",
          "ROOM DETAILS",
          "D7-PHONE-ROOM-48291",
          "PHONE-PREVIEW-PASS-2026",
          'data-testid="room-credential-copy-room-id"',
          'data-testid="room-credential-copy-password"',
          'data-testid="participant-count-heading"',
          "Daily007 Championship Squad",
          "Captain With A Long International Tournament Name",
        ],
        textMarkers: [
          "SCHEDULED START:",
          "D7-PHONE-ROOM-48291",
          "PHONE-PREVIEW-PASS-2026",
          "Daily007 Championship Squad",
          "Captain With A Long International Tournament Name",
        ],
        interactiveMarkers: [
          { testId: "room-credential-copy-room-id", label: "Copy Room ID" },
          { testId: "room-credential-copy-password", label: "Copy Password" },
        ],
        clipboardChecks: [
          {
            testId: "room-credential-copy-room-id",
            value: "D7-PHONE-ROOM-48291",
            feedback: "Room ID copied to clipboard.",
          },
          {
            testId: "room-credential-copy-password",
            value: "PHONE-PREVIEW-PASS-2026",
            feedback: "Password copied to clipboard.",
          },
        ],
      },
      {
        path: "/keyboard-forms-preview.html",
        screen: "Wallet and Edit Profile",
        markers: ['data-testid="wallet-open-recharge"'],
        phoneMarkers: ['data-testid="wallet-open-recharge"'],
      },
      {
        path: "/tournament-resume-preview.html",
        screen: "Tournament list",
        markers: ["IST Start Boundary", 'data-testid="tournament-tab-upcoming"'],
        phoneMarkers: ['data-testid="tournament-tab-upcoming"'],
      },
    ],
  },
  {
    config: "vite.instagram-claim-preview.config.ts",
    entries: [
      {
        path: "/instagram-claim-preview.html",
        screen: "Instagram claim review",
        scrollMarker: "Instagram Preview Player",
        markers: [
          "INSTAGRAM FOLLOW TASK",
          "Instagram Preview Player",
          "instagram.preview.player@example.invalid",
          "Daily007 user ID: preview-instagram-player-id",
          "Reward: 3 coins",
          "PENDING",
        ],
        phoneMarkers: [
          "Instagram Preview Player",
          "Daily007 user ID: preview-instagram-player-id",
          "Reward: 3 coins",
          "PENDING",
        ],
        textMarkers: [
          "instagram.preview.player@example.invalid",
          "Daily007 user ID: preview-instagram-player-id",
        ],
        interactiveMarkers: [
          { label: "APPROVE & CREDIT" },
          { label: "REJECT" },
        ],
        saveScreenshotBeforeInteraction: true,
        interaction: {
          selector: '[role="button"][aria-label="APPROVE & CREDIT"]',
          markers: [
            "Approve Instagram claim?",
            "verify this Daily007 account's Instagram follow",
            "Instagram Preview Player's wallet",
          ],
          phoneMarkers: [
            "Approve Instagram claim?",
            "verify this Daily007 account's Instagram follow",
          ],
        },
      },
      {
        path: "/instagram-claim-preview.html?review-action=reject",
        screen: "Instagram claim rejection",
        scrollMarker: "Instagram Preview Player",
        markers: [
          "INSTAGRAM FOLLOW TASK",
          "Instagram Preview Player",
          "Daily007 user ID: preview-instagram-player-id",
          "Reward: 3 coins",
          "PENDING",
        ],
        phoneMarkers: [
          "Instagram Preview Player",
          "Daily007 user ID: preview-instagram-player-id",
          "Reward: 3 coins",
          "PENDING",
        ],
        interactiveMarkers: [
          { label: "APPROVE & CREDIT" },
          { label: "REJECT" },
        ],
        interaction: {
          selector: '[role="button"][aria-label="REJECT"]',
          markers: [
            "Reject Instagram claim?",
            "This claim will be rejected.",
            "user can follow the account and submit a new claim",
          ],
          phoneMarkers: [
            "Reject Instagram claim?",
            "This claim will be rejected.",
          ],
        },
      },
    ],
  },
  {
    config: "vite.google-signup-wallet.config.ts",
    entries: [
      {
        path: "/google-signup-wallet-preview.html",
        screen: "Google signup and Wallet",
        markers: ['data-testid="auth-password"', 'data-testid="continue-with-google"'],
        phoneMarkers: ['data-testid="auth-password"', 'data-testid="continue-with-google"'],
      },
    ],
  },
  {
    config: "vite.player-largest-text.config.ts",
    entries: [
      {
        path: "/player-largest-text-preview.html?screen=Home",
        screen: "Player Home",
        fontScale: 2,
        markers: ["GAME MODES", 'data-testid="home-mode-battle-royale"'],
        phoneMarkers: ['data-testid="home-mode-battle-royale"'],
      },
      {
        path: "/player-largest-text-preview.html?screen=Video",
        screen: "Player Video",
        fontScale: 2,
        markers: [
          "VIDEO LIBRARY",
          "DAILY007 APPLICATION RELATED VIDEO",
          "YOUTUBE VIDEOS",
        ],
        phoneMarkers: [
          "VIDEO LIBRARY",
          "DAILY007 APPLICATION RELATED VIDEO",
          "YOUTUBE VIDEOS",
        ],
      },
    ],
  },
  {
    config: "vite.join-form-largest-text.config.ts",
    entries: [
      {
        path: "/player-join-form-largest-text-preview.html",
        screen: "Player Join Form",
        fontScale: 2,
        markers: ["Daily007 Squad Finals", 'data-testid="join-form-submit"'],
        phoneMarkers: ["Daily007 Squad Finals", 'data-testid="join-form-submit"'],
      },
    ],
  },
  {
    config: "vite.signup-keyboard.config.ts",
    entries: [
      {
        path: "/signup-keyboard-preview.html",
        screen: "Signup",
        markers: ['data-testid="auth-password"', "SIGN UP"],
        phoneMarkers: ['data-testid="auth-password"', "SIGN UP"],
      },
    ],
  },
];

async function checkPreviewEntrypointCoverage() {
  const files = await readdir(sandboxRoot);
  const discoveredHtmlEntries = files
    .filter((file) => file.endsWith("-preview.html"))
    .sort();
  const discoveredViteConfigs = files
    .filter((file) => /^vite\..+\.config\.ts$/.test(file))
    .sort();
  const checkedHtmlEntries = [...new Set(
    previewGroups.flatMap((group) =>
      group.entries.map((entry) => path.basename(new URL(entry.path, "http://localhost").pathname)),
    ),
  )].sort();
  const checkedViteConfigs = [...new Set(previewGroups.map((group) => group.config))].sort();
  const missingHtmlEntries = discoveredHtmlEntries.filter(
    (entry) => !checkedHtmlEntries.includes(entry),
  );
  const missingViteConfigs = discoveredViteConfigs.filter(
    (config) => !checkedViteConfigs.includes(config),
  );
  const staleHtmlEntries = checkedHtmlEntries.filter(
    (entry) => !discoveredHtmlEntries.includes(entry),
  );
  const staleViteConfigs = checkedViteConfigs.filter(
    (config) => !discoveredViteConfigs.includes(config),
  );
  const errors = [
    missingHtmlEntries.length > 0
      ? `Preview HTML files missing from previewGroups: ${missingHtmlEntries.join(", ")}.`
      : "",
    missingViteConfigs.length > 0
      ? `Preview Vite configs missing from previewGroups: ${missingViteConfigs.join(", ")}.`
      : "",
    staleHtmlEntries.length > 0
      ? `previewGroups references missing HTML files: ${staleHtmlEntries.join(", ")}.`
      : "",
    staleViteConfigs.length > 0
      ? `previewGroups references missing Vite configs: ${staleViteConfigs.join(", ")}.`
      : "",
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(`Preview entrypoint coverage check failed:\n${errors.join("\n")}`);
  }

  console.log(
    `PASS preview entrypoint coverage — ${discoveredHtmlEntries.length} HTML files, ` +
      `${discoveredViteConfigs.length} Vite configs.`,
  );
}

async function checkPreviewDependencyBoundary() {
  const fixtureRoot = await mkdtemp(
    path.join(sandboxRoot, ".preview-dependency-boundary-fixture-"),
  );
  const previousDependencyCheck = process.env.DAILY007_CHECK_PREVIEW_DEPENDENCIES;
  const fixtureDirectory = path.join(fixtureRoot, "package");
  const fixturePackageName = "@workspace/preview-dependency-boundary-fixture";
  const importer = path.join(fixtureDirectory, "entry.mjs");
  const manifestPath = path.join(fixtureDirectory, "package.json");

  try {
    process.env.DAILY007_CHECK_PREVIEW_DEPENDENCIES = "1";
    await mkdir(fixtureDirectory, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        name: fixturePackageName,
        private: true,
        dependencies: { zod: "*" },
      }),
    );
    await writeFile(importer, 'import "zod";\n');

    const resolvedId = createRequire(importer).resolve("zod");
    assert.ok(resolvedId, "zod must resolve from the fixture workspace");
    const plugin = previewDependencyBoundaryPlugin();
    const result = await plugin.resolveId.call(
      {
        async resolve() {
          return { id: resolvedId, external: false };
        },
        error(message) {
          throw new Error(message);
        },
      },
      "zod",
      importer,
    );
    assert.equal(result, null, "a declared package must pass the boundary check");

    await writeFile(
      manifestPath,
      JSON.stringify({
        name: fixturePackageName,
        private: true,
        dependencies: {},
      }),
    );
    const childSource = `
      import assert from "node:assert/strict";
      import { createRequire } from "node:module";
      import { previewDependencyBoundaryPlugin } from ${JSON.stringify(
        new URL("./previewDependencyBoundary.mjs", import.meta.url).href,
      )};

      const importer = process.env.PREVIEW_BOUNDARY_FIXTURE_IMPORTER;
      const resolvedId = createRequire(importer).resolve("zod");
      assert.ok(resolvedId, "zod must remain resolvable after its declaration is removed");
      const plugin = previewDependencyBoundaryPlugin();
      const outcome = await plugin.resolveId.call(
        {
          async resolve() {
            return { id: resolvedId, external: false };
          },
          error(message) {
            throw new Error(message);
          },
        },
        "zod",
        importer,
      ).then(
        () => ({ blocked: false, message: "" }),
        (error) => ({ blocked: true, message: error.message }),
      );
      assert.equal(outcome.blocked, true, "the undeclared package must be rejected");
      assert.match(
        outcome.message,
        /Preview dependency boundary violation: @workspace\\/preview-dependency-boundary-fixture imports "zod".*does not declare resolved package "zod"/s,
      );
      console.log("PASS preview dependency boundary rejects a resolvable package after declaration removal.");
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", childSource],
      {
        env: {
          ...process.env,
          DAILY007_CHECK_PREVIEW_DEPENDENCIES: "1",
          PREVIEW_BOUNDARY_FIXTURE_IMPORTER: importer,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let childOutput = "";
    child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
    child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });
    const childExitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (childExitCode !== 0) {
      throw new Error(`Undeclared dependency fixture failed:\n${childOutput.trim()}`);
    }
    console.log("PASS preview dependency boundary allows declared packages.");
    console.log(childOutput.trim());
  } finally {
    if (previousDependencyCheck === undefined) {
      delete process.env.DAILY007_CHECK_PREVIEW_DEPENDENCIES;
    } else {
      process.env.DAILY007_CHECK_PREVIEW_DEPENDENCIES = previousDependencyCheck;
    }
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a local preview port.");
  }
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function waitForPreview(url, label, server, getServerOutput) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `${label} exited with code ${server.exitCode}.\n${getServerOutput()}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(
    `${label} did not become ready: ${lastError?.message ?? "timeout"}.\n${getServerOutput()}`,
  );
}

async function waitForBrowser(url, browser, getBrowserOutput) {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    if (browser.exitCode !== null) {
      throw new Error(
        `Chromium exited with code ${browser.exitCode} before becoming ready.\n${getBrowserOutput()}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `Chromium did not become ready: ${lastError?.message ?? "timeout"}.\n${getBrowserOutput()}`,
  );
}

function browserErrorForCdpEvent(method, params = {}) {
  if (method === "Runtime.exceptionThrown") {
    const details = params.exceptionDetails;
    return details?.exception?.description ?? details?.text ?? "Browser exception.";
  }
  if (method !== "Runtime.consoleAPICalled" || params.type !== "error") return null;
  const message =
    params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ")
    || "Browser console error.";
  return ignoredBrowserErrors.has(message) ? null : message;
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    socket = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("Timed out connecting to Chromium DevTools.")), 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      socket.addEventListener("message", ({ data }) => {
        const message = JSON.parse(String(data));
        const browserError = browserErrorForCdpEvent(message.method, message.params);
        if (browserError) browserErrors.push(browserError);
        if (message.method === "Network.requestWillBeSent") {
          const requestUrl = message.params?.request?.url;
          if (typeof requestUrl === "string") {
            try {
              const request = new URL(requestUrl);
              if (
                ["http:", "https:", "ws:", "wss:"].includes(request.protocol)
                && !["127.0.0.1", "localhost"].includes(request.hostname)
              ) {
                externalRequests.push(requestUrl);
              }
            } catch {
              // Ignore browser-internal and non-network URLs.
            }
          }
        }
        if (!message.id) return;
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      });
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Chromium DevTools WebSocket failed."));
    });
  });
}

function cdp(method, params = {}) {
  const id = ++messageId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await cdp("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result?.value;
}

async function startChromium(profilePath) {
  const port = await getFreePort();
  activeChromium = spawn(
    process.env.CHROMIUM_PATH || "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profilePath}`,
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  activeChromium.stderr.on("data", (chunk) => { browserOutput += chunk.toString(); });
  const version = await waitForBrowser(
    `http://127.0.0.1:${port}/json/version`,
    activeChromium,
    () => browserOutput,
  );
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const pageTarget = targets.find((target) => target.type === "page");
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error(`Chromium did not expose a page target. ${JSON.stringify(version)}`);
  }
  await connectCdp(pageTarget.webSocketDebuggerUrl);
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Network.enable");
  await cdp("Emulation.setDeviceMetricsOverride", phoneViewport);
}

async function checkPreviewInteraction(entry) {
  const interaction = entry.interaction;
  if (!interaction) return;
  const selector = JSON.stringify(interaction.selector);
  const clicked = await evaluate(`(() => {
    const control = document.querySelector(${selector});
    if (!control) return false;
    control.click();
    return true;
  })()`);
  if (!clicked) {
    throw new Error(`${entry.screen} preview could not find interaction control ${interaction.selector}.`);
  }

  const markers = JSON.stringify(interaction.markers);
  const phoneMarkers = JSON.stringify(interaction.phoneMarkers ?? interaction.markers);
  const expectedPhoneWidth = (entry.viewport ?? phoneViewport).width;
  const expression = `(() => {
    const text = document.body?.innerText ?? "";
    const html = document.body?.innerHTML ?? "";
    const root = document.documentElement;
    const markers = ${markers};
    const phoneMarkers = ${phoneMarkers};
    const findMarkerElement = (marker) => {
      const testId = marker.match(/^data-testid="([^"]+)"$/)?.[1];
      if (testId) {
        return [...document.querySelectorAll("[data-testid]")]
          .find((element) => element.getAttribute("data-testid") === testId) ?? null;
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue?.includes(marker)) return node.parentElement;
      }
      return [...document.querySelectorAll("body *")]
        .filter((element) => (element.textContent ?? "").includes(marker))
        .sort((left, right) => left.textContent.length - right.textContent.length)[0] ?? null;
    };
    const missing = markers.filter((marker) =>
      marker.startsWith('data-testid="') ? !html.includes(marker) : !text.includes(marker)
    );
    const layoutWidth = root?.clientWidth ?? 0;
    const scrollWidth = Math.max(root?.scrollWidth ?? 0, document.body?.scrollWidth ?? 0);
    const clippedMarkers = phoneMarkers.map((marker) => {
      const element = findMarkerElement(marker);
      if (!element) return { marker, visible: false, clipped: false };
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        marker,
        visible: rect.width > 0 && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden"
          && style.opacity !== "0",
        clipped: rect.left < -1 || rect.right > layoutWidth + 1,
        bounds: {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        },
      };
    }).filter((marker) => !marker.visible || marker.clipped);
    return {
      ready: missing.length === 0,
      missing,
      clippedMarkers,
      layoutWidth,
      scrollWidth,
      overflowPx: Math.max(0, scrollWidth - layoutWidth),
      phoneViewportOk: Boolean(root && document.body)
        && window.innerWidth === ${expectedPhoneWidth}
        && Math.abs(layoutWidth - ${expectedPhoneWidth}) <= 1
        && Math.max(0, scrollWidth - layoutWidth) <= 1
        && clippedMarkers.length === 0,
      text: text.slice(0, 1_200),
    };
  })()`;

  const deadline = Date.now() + 10_000;
  let state;
  while (Date.now() < deadline) {
    if (browserErrors.length > 0) {
      throw new Error(
        `${entry.screen} preview raised a browser error:\n${browserErrors.join("\n")}`,
      );
    }
    if (externalRequests.length > 0) {
      throw new Error(
        `${entry.screen} preview attempted external requests:\n${externalRequests.join("\n")}`,
      );
    }
    state = await evaluate(expression);
    if (state.ready) {
      if (!state.phoneViewportOk) {
        throw new Error(
          `${entry.screen} preview interaction failed phone-width layout checks: ` +
            `${JSON.stringify(state)}.`,
        );
      }
      return;
    }
    await delay(100);
  }
  throw new Error(
    `${entry.screen} preview interaction did not render its expected content.` +
      ` Missing: ${state?.missing?.join(", ") ?? interaction.markers.join(", ")}.` +
      `\nPage text:\n${state?.text ?? "Page did not respond."}`,
  );
}

async function checkPreviewClipboard(entry) {
  if (!entry.clipboardChecks || (entry.viewport ?? phoneViewport).width !== 320) return;
  const expectedValues = [];
  const credentialTestIds = JSON.stringify(entry.clipboardChecks.map(({ testId }) => testId));
  for (const { testId, value, feedback } of entry.clipboardChecks) {
    const selector = JSON.stringify(`[data-testid="${testId}"]`);
    const failureFeedback = `Could not copy ${testId.endsWith("room-id") ? "Room ID" : "Password"}. Please try again.`;
    await evaluate("globalThis.__daily007ClipboardFailuresRemaining = 1");
    const clicked = await evaluate(`(() => {
      const control = document.querySelector(${selector});
      if (!control) return false;
      control.click();
      return true;
    })()`);
    if (!clicked) {
      throw new Error(`${entry.screen} preview could not activate clipboard control ${testId}.`);
    }

    const expectedFailure = JSON.stringify(failureFeedback);
    const expectedValuesBeforeRetry = JSON.stringify(expectedValues);
    const failureExpression = `(() => {
      const feedback = document.querySelector('[data-testid="room-credential-copy-feedback"]');
      const writes = globalThis.__daily007ClipboardWrites ?? [];
      const layoutWidth = document.documentElement?.clientWidth ?? 0;
      const controls = ${credentialTestIds}.map((testId) => {
        const button = [...document.querySelectorAll("[data-testid]")]
          .find((element) => element.getAttribute("data-testid") === testId);
        const rect = button?.getBoundingClientRect();
        const style = button ? window.getComputedStyle(button) : null;
        return {
          testId,
          visible: Boolean(button && rect && rect.width > 0 && rect.height > 0
            && style?.display !== "none" && style?.visibility !== "hidden" && style?.opacity !== "0"),
          inBounds: Boolean(rect && rect.left >= -1 && rect.right <= layoutWidth + 1),
          targetSizeOk: Boolean(rect && rect.width >= 40 && rect.height >= 40),
          usable: Boolean(button && !button.hasAttribute("disabled")
            && button.getAttribute("aria-disabled") !== "true"),
        };
      });
      return {
        ready: feedback?.textContent?.trim() === ${expectedFailure}
          && JSON.stringify(writes) === JSON.stringify(${expectedValuesBeforeRetry})
          && controls.every((control) => control.visible && control.inBounds
            && control.targetSizeOk && control.usable),
        feedback: feedback?.textContent?.trim() ?? null,
        writes,
        controls,
        viewportWidth: window.innerWidth,
      };
    })()`;
    const failureDeadline = Date.now() + 5_000;
    let failureState;
    while (Date.now() < failureDeadline) {
      failureState = await evaluate(failureExpression);
      if (failureState.ready) break;
      await delay(50);
    }
    if (!failureState?.ready || failureState.viewportWidth !== 320) {
      throw new Error(
        `${entry.screen} preview clipboard failure was not recoverable at 320px for ${testId}: ` +
          `${JSON.stringify(failureState)}.`,
      );
    }

    const retryClicked = await evaluate(`(() => {
      const control = document.querySelector(${selector});
      if (!control) return false;
      control.click();
      return true;
    })()`);
    if (!retryClicked) {
      throw new Error(`${entry.screen} preview could not retry clipboard control ${testId}.`);
    }
    expectedValues.push(value);
    const expectedFeedback = JSON.stringify(feedback);
    const expectedClipboardValues = JSON.stringify(expectedValues);
    const expression = `(() => {
      const button = document.querySelector(${selector});
      const feedback = document.querySelector('[data-testid="room-credential-copy-feedback"]');
      const rect = button?.getBoundingClientRect();
      const writes = globalThis.__daily007ClipboardWrites ?? [];
      const root = document.documentElement;
      const layoutWidth = root?.clientWidth ?? 0;
      const controls = ${credentialTestIds}.map((credentialTestId) => {
        const control = [...document.querySelectorAll("[data-testid]")]
          .find((element) => element.getAttribute("data-testid") === credentialTestId);
        const controlRect = control?.getBoundingClientRect();
        return {
          visible: Boolean(control && controlRect && controlRect.width > 0 && controlRect.height > 0),
          inBounds: Boolean(controlRect && controlRect.left >= -1 && controlRect.right <= layoutWidth + 1),
          usable: Boolean(control && !control.hasAttribute("disabled")
            && control.getAttribute("aria-disabled") !== "true"),
        };
      });
      return {
        ready: feedback?.textContent?.trim() === ${expectedFeedback}
          && JSON.stringify(writes) === JSON.stringify(${expectedClipboardValues})
          && controls.every((control) => control.visible && control.inBounds && control.usable),
        feedback: feedback?.textContent?.trim() ?? null,
        writes,
        buttonVisible: Boolean(button && rect && rect.width > 0 && rect.height > 0),
        buttonInBounds: Boolean(rect && rect.left >= -1 && rect.right <= layoutWidth + 1),
        buttonTargetSizeOk: Boolean(rect && rect.width >= 40 && rect.height >= 40),
        viewportWidth: window.innerWidth,
      };
    })()`;
    const deadline = Date.now() + 5_000;
    let state;
    while (Date.now() < deadline) {
      state = await evaluate(expression);
      if (state.ready) break;
      await delay(50);
    }
    if (
      !state?.ready
      || !state.buttonVisible
      || !state.buttonInBounds
      || !state.buttonTargetSizeOk
      || state.viewportWidth !== 320
    ) {
      throw new Error(
        `${entry.screen} preview clipboard action failed at 320px for ${testId}: ` +
          `${JSON.stringify(state)}.`,
      );
    }
  }
}

async function checkPreview(url, entry) {
  await cdp("Page.stopLoading").catch(() => undefined);
  browserErrors.length = 0;
  externalRequests.length = 0;
  const navigation = await cdp("Page.navigate", { url });
  if (navigation.errorText) {
    throw new Error(`${entry.screen} preview navigation failed: ${navigation.errorText}`);
  }
  if (entry.scrollMarker) {
    const marker = JSON.stringify(entry.scrollMarker);
    const scrollDeadline = Date.now() + 10_000;
    let scrolled = false;
    while (Date.now() < scrollDeadline && !scrolled) {
      scrolled = await evaluate(`(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.nodeValue?.includes(${marker})) {
            node.parentElement?.scrollIntoView({ block: "center" });
            return true;
          }
        }
        return false;
      })()`);
      if (!scrolled) await delay(100);
    }
    if (!scrolled) {
      const pageText = await evaluate("document.body?.innerText ?? ''");
      throw new Error(
        `${entry.screen} preview could not scroll to ${entry.scrollMarker}.` +
          ` Browser errors: ${browserErrors.join(" | ") || "none"}.` +
          `\nPage text:\n${String(pageText).slice(0, 2_000)}`,
      );
    }
  }

  const expectedMarkers = JSON.stringify(entry.markers);
  const expectedPhoneMarkers = JSON.stringify(entry.phoneMarkers ?? entry.markers);
  const expectedTextMarkers = JSON.stringify(entry.textMarkers ?? []);
  const expectedInteractiveMarkers = JSON.stringify(entry.interactiveMarkers ?? []);
  const expectedUrl = JSON.stringify(url);
  const expectedPhoneWidth = (entry.viewport ?? phoneViewport).width;
  const expectedFontScale = entry.fontScale ?? 1;
  const expression = `(() => {
    const text = document.body?.innerText ?? "";
    const html = document.body?.innerHTML ?? "";
    const root = document.documentElement;
    const markers = ${expectedMarkers};
    const missing = markers.filter((marker) =>
      marker.startsWith('data-testid="') ? !html.includes(marker) : !text.includes(marker)
    );
    const phoneMarkers = ${expectedPhoneMarkers};
    const textMarkers = ${expectedTextMarkers};
    const interactiveMarkers = ${expectedInteractiveMarkers};
    const findMarkerElement = (marker) => {
      const testId = marker.match(/^data-testid="([^"]+)"$/)?.[1];
      if (testId) {
        return [...document.querySelectorAll("[data-testid]")]
          .find((element) => element.getAttribute("data-testid") === testId) ?? null;
      }
      if (!document.body) return null;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue?.includes(marker)) return node.parentElement;
      }
      return [...document.querySelectorAll("body *")]
        .filter((element) => (element.textContent ?? "").includes(marker))
        .sort((left, right) => left.textContent.length - right.textContent.length)[0] ?? null;
    };
    const layoutWidth = root?.clientWidth ?? 0;
    const scrollWidth = Math.max(
      root?.scrollWidth ?? 0,
      document.body?.scrollWidth ?? 0,
    );
    const overflowPx = Math.max(0, scrollWidth - layoutWidth);
    const fontScale = Number(globalThis.__daily007LargeTextScale ?? 1);
    const fontScaleOk = Math.abs(fontScale - ${expectedFontScale}) < 0.001;
    const markerLayouts = phoneMarkers.map((marker) => {
      const element = findMarkerElement(marker);
      if (!element) return { marker, visible: false, clipped: false };
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        marker,
        visible: rect.width > 0 && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden"
          && style.opacity !== "0",
        clipped: rect.left < -1 || rect.right > layoutWidth + 1,
        bounds: {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      };
    });
    const clippedMarkers = markerLayouts.filter((layout) => !layout.visible || layout.clipped);
    const overflowingTextMarkers = textMarkers
      .map((marker) => {
        const element = findMarkerElement(marker);
        if (!element) return { marker, missing: true };
        return {
          marker,
          missing: false,
          overflowX: element.scrollWidth > element.clientWidth + 1,
          overflowY: element.scrollHeight > element.clientHeight + 1,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        };
      })
      .filter((layout) => layout.missing || layout.overflowX || layout.overflowY);
    const unusableInteractiveMarkers = interactiveMarkers
      .map(({ testId, label }) => {
        const element = testId
          ? [...document.querySelectorAll("[data-testid]")]
              .find((candidate) => candidate.getAttribute("data-testid") === testId)
          : [...document.querySelectorAll('[role="button"]')]
              .find((candidate) => candidate.getAttribute("aria-label") === label);
        if (!element) return { testId, missing: true };
        const rect = element.getBoundingClientRect();
        return {
          testId,
          missing: false,
          role: element.getAttribute("role"),
          label: element.getAttribute("aria-label"),
          disabled: element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true",
          smallTarget: rect.width < 40 || rect.height < 40,
          wrongLabel: element.getAttribute("aria-label") !== label,
          bounds: {
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      })
      .filter((control) =>
        control.missing
        || control.role !== "button"
        || control.disabled
        || control.smallTarget
        || control.wrongLabel
      );
    const overflowingElements = [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const rightOverflow = rect.right - layoutWidth;
        const leftOverflow = -rect.left;
        return {
          tag: element.tagName,
          testId: element.getAttribute("data-testid"),
          id: element.id || null,
          className: typeof element.className === "string" ? element.className.slice(0, 80) : "",
          text: (element.textContent ?? "").trim().slice(0, 80),
          rightOverflow,
          leftOverflow,
          width: rect.width,
        };
      })
      .filter((element) =>
        element.width > 0 && (element.rightOverflow > 1 || element.leftOverflow > 1)
      )
      .sort((left, right) =>
        Math.max(right.rightOverflow, right.leftOverflow)
          - Math.max(left.rightOverflow, left.leftOverflow)
      )
      .slice(0, 8);
    const phoneViewportOk = Boolean(root && document.body)
      && window.innerWidth === ${expectedPhoneWidth}
      && Math.abs(layoutWidth - ${expectedPhoneWidth}) <= 1
      && overflowPx <= 1
      && fontScaleOk
      && clippedMarkers.length === 0
      && overflowingTextMarkers.length === 0
      && unusableInteractiveMarkers.length === 0;
    return {
      url: window.location.href,
      ready: window.location.href === ${expectedUrl} && missing.length === 0,
      missing,
      phoneViewport: { width: window.innerWidth, height: window.innerHeight },
      phoneMetrics: {
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        devicePixelRatio: window.devicePixelRatio,
        fontScale,
        visualWidth: window.visualViewport?.width ?? null,
        visualScale: window.visualViewport?.scale ?? null,
        layoutWidth,
        scrollWidth,
        overflowingElements,
        overflowingTextMarkers,
        unusableInteractiveMarkers,
        metaViewport: document.querySelector('meta[name="viewport"]')?.content ?? null,
      },
      overflowPx,
      clippedMarkers,
      phoneViewportOk,
      hasViteError: Boolean(document.querySelector("vite-error-overlay"))
        || /Internal server error|Failed to resolve import/i.test(text),
      text: text.slice(0, 1_200),
    };
  })()`;

  const deadline = Date.now() + 15_000;
  let state;
  while (Date.now() < deadline) {
    if (browserErrors.length > 0) {
      throw new Error(
        `${entry.screen} preview raised a browser error:\n${browserErrors.join("\n")}`,
      );
    }
    if (externalRequests.length > 0) {
      throw new Error(
        `${entry.screen} preview attempted external requests:\n${externalRequests.join("\n")}`,
      );
    }
    state = await evaluate(expression);
    if (state.hasViteError) {
      throw new Error(`${entry.screen} preview displayed a Vite error:\n${state.text}`);
    }
    if (state.ready) {
      if (!state.phoneViewportOk) {
        throw new Error(
          `${entry.screen} preview failed phone-width layout checks at ` +
            `${state.phoneViewport?.width}×${state.phoneViewport?.height}: ` +
            `${JSON.stringify(state.phoneMetrics)}; ` +
            `${state.overflowPx}px page overflow; ` +
            `clipped or hidden markers: ${JSON.stringify(state.clippedMarkers)}.`,
        );
      }
      await delay(150);
      if (browserErrors.length > 0) {
        throw new Error(
          `${entry.screen} preview raised a browser error:\n${browserErrors.join("\n")}`,
        );
      }
      if (externalRequests.length > 0) {
        throw new Error(
          `${entry.screen} preview attempted external requests:\n${externalRequests.join("\n")}`,
        );
      }
      state = await evaluate(expression);
      if (state.ready && !state.hasViteError && state.phoneViewportOk) {
        if (
          entry.saveScreenshotBeforeInteraction
          && process.env.DAILY007_PREVIEW_SCREENSHOT_PATH
        ) {
          const screenshot = await cdp("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: true,
          });
          await writeFile(
            process.env.DAILY007_PREVIEW_SCREENSHOT_PATH,
            Buffer.from(screenshot.data, "base64"),
          );
        }
        await checkPreviewInteraction(entry);
        await checkPreviewClipboard(entry);
        return;
      }
    }
    await delay(100);
  }

  throw new Error(
    `${entry.screen} preview did not render its expected Daily007 screen.` +
      ` Missing markers: ${state?.missing?.join(", ") ?? entry.markers.join(", ")}.` +
      ` Current URL: ${state?.url ?? "unavailable"}.` +
      (state?.hasViteError ? " A Vite error was displayed." : "") +
      `\nPage text:\n${state?.text ?? "Page did not respond."}`,
  );
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 3_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

let activeVite;
let activeViteOutput = "";
let temporaryRoot;

try {
  await checkPreviewDependencyBoundary();
  await checkPreviewEntrypointCoverage();

  if (!process.argv.includes("--check-entrypoints-only")) {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "daily007-preview-entrypoints-"));
    await startChromium(path.join(temporaryRoot, "chromium-profile"));

    for (const group of previewGroups) {
      const entries = instagramClaimOnly
        ? group.entries.filter((entry) =>
            entry.screen === "Instagram claim review" || entry.screen === "Instagram claim rejection")
        : tournamentDetailOnly
          ? group.entries.filter((entry) => entry.screen === "Tournament Details")
          : group.entries;
      if (entries.length === 0) continue;

      const port = await getFreePort();
      activeViteOutput = "";
      activeVite = spawn(
        "pnpm",
        [
          "--filter",
          "@workspace/mockup-sandbox",
          "exec",
          "vite",
          "--config",
          group.config,
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--strictPort",
        ],
        {
          cwd: workspaceRoot,
          env: {
            ...process.env,
            PORT: String(port),
            DAILY007_CHECK_PREVIEW_DEPENDENCIES: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      activeVite.stdout.on("data", (chunk) => { activeViteOutput += chunk.toString(); });
      activeVite.stderr.on("data", (chunk) => { activeViteOutput += chunk.toString(); });

      for (const entry of entries) {
        const variants = [
          { viewport: entry.viewport ?? phoneViewport, fontScale: entry.fontScale ?? null },
          ...(entry.largeTextScales ?? []).map((fontScale) => ({
            viewport: entry.largeTextViewport ?? entry.viewport ?? phoneViewport,
            fontScale,
          })),
        ];
        for (const variant of variants) {
          const previewUrl = new URL(entry.path, `http://127.0.0.1:${port}`);
          if (variant.fontScale !== null) {
            previewUrl.searchParams.set("fontScale", String(variant.fontScale));
          }
          const url = previewUrl.toString();
          await waitForPreview(url, `${group.config} ${entry.path}`, activeVite, () => activeViteOutput);
          await cdp("Emulation.setDeviceMetricsOverride", variant.viewport);
          await checkPreview(url, { ...entry, viewport: variant.viewport, fontScale: variant.fontScale });
          console.log(
            `PASS ${group.config} ${entry.path} → ${entry.screen} @ ` +
              `${variant.viewport.width}×${variant.viewport.height}` +
              (variant.fontScale === null ? "" : `, ${variant.fontScale}× text`),
          );
        }
      }

      await stopProcess(activeVite);
      activeVite = undefined;
    }
  }
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  if (activeViteOutput.trim()) {
    console.error(`Vite output:\n${activeViteOutput.trim().slice(-4_000)}`);
  }
  if (browserOutput.trim()) {
    console.error(`Chromium output:\n${browserOutput.trim().slice(-2_000)}`);
  }
  process.exitCode = 1;
} finally {
  socket?.close();
  await stopProcess(activeChromium);
  await stopProcess(activeVite);
  if (temporaryRoot) {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}
