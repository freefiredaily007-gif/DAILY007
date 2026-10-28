import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
const previewEventScopes = [];
const executionContextScopes = new Map();
const networkLoaderScopes = new Map();
const frameScopes = new Map();
const ignoredBrowserErrors = new Set([
  "BackHandler is not supported on web and should not be used.",
  "Unexpected text node: . A text node cannot be a child of a <View>.",
]);
let activeChromium;
let browserOutput = "";
let activePreviewEventScope;
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

function findDuplicatePreviewEntrypointErrors(groups) {
  const configGroups = new Map();
  const htmlEntries = new Map();

  groups.forEach((group, groupIndex) => {
    const configIndexes = configGroups.get(group.config) ?? [];
    configIndexes.push(groupIndex + 1);
    configGroups.set(group.config, configIndexes);

    group.entries.forEach((entry) => {
      const url = new URL(entry.path, "http://localhost");
      const entryPath = `${url.pathname}${url.search}`;
      const occurrences = htmlEntries.get(entryPath) ?? [];
      occurrences.push(`${group.config} (${entry.screen})`);
      htmlEntries.set(entryPath, occurrences);
    });
  });

  return [
    ...[...htmlEntries.entries()]
      .filter(([, occurrences]) => occurrences.length > 1)
      .map(([entryPath, occurrences]) =>
        `Duplicate preview HTML entries: ${entryPath} (${occurrences.join("; ")}).`,
      ),
    ...[...configGroups.entries()]
      .filter(([, indexes]) => indexes.length > 1)
      .map(([config, indexes]) =>
        `Duplicate preview Vite config groups: ${config} (groups ${indexes.join(", ")}).`,
      ),
  ];
}

async function checkPreviewEntrypointCoverage(groups = previewGroups) {
  const files = await readdir(sandboxRoot);
  const discoveredHtmlEntries = files
    .filter((file) => file.endsWith("-preview.html"))
    .sort();
  const discoveredViteConfigs = files
    .filter((file) => /^vite\..+\.config\.ts$/.test(file))
    .sort();
  const checkedHtmlEntries = [...new Set(
    groups.flatMap((group) =>
      group.entries.map((entry) => path.basename(new URL(entry.path, "http://localhost").pathname)),
    ),
  )].sort();
  const checkedViteConfigs = [...new Set(groups.map((group) => group.config))].sort();
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
    ...findDuplicatePreviewEntrypointErrors(groups),
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

async function testPreviewEntrypointDuplicates() {
  const fixtureGroups = [
    {
      config: "vite.duplicate-fixture.config.ts",
      entries: [{ path: "/duplicate-fixture-preview.html?screen=Home", screen: "Home" }],
    },
    {
      config: "vite.duplicate-fixture.config.ts",
      entries: [{ path: "/duplicate-fixture-preview.html?screen=Home", screen: "Home copy" }],
    },
  ];

  await assert.rejects(
    checkPreviewEntrypointCoverage(fixtureGroups),
    (error) => {
      assert.match(error.message, /Duplicate preview HTML entries: \/duplicate-fixture-preview\.html\?screen=Home/);
      assert.match(error.message, /Duplicate preview Vite config groups: vite\.duplicate-fixture\.config\.ts/);
      return true;
    },
    "duplicate preview entries and config groups must fail coverage before browser startup",
  );
  console.log("PASS duplicate preview entries and config groups are rejected before Chromium startup.");
}

function formatPreviewFailureSummary(failures) {
  const groupedFailures = new Map();
  for (const failure of failures) {
    const entries = groupedFailures.get(failure.config) ?? [];
    entries.push(failure);
    groupedFailures.set(failure.config, entries);
  }

  return [
    `Preview run failed: ${failures.length} entr${failures.length === 1 ? "y" : "ies"} across ` +
      `${groupedFailures.size} config${groupedFailures.size === 1 ? "" : "s"}.`,
    ...[...groupedFailures.entries()].flatMap(([config, entries]) => [
      `FAIL ${config}`,
      ...entries.map((failure) =>
        `  ${failure.entry.path} — ${failure.entry.screen}: ${failure.message}`,
      ),
      ...(entries.find((failure) => failure.viteOutput)?.viteOutput
        ? [`  Vite output:\n${entries.find((failure) => failure.viteOutput).viteOutput}`]
        : []),
      ...(entries.find((failure) => failure.browserOutput)?.browserOutput
        ? [`  Chromium output:\n${entries.find((failure) => failure.browserOutput).browserOutput}`]
        : []),
    ]),
  ].join("\n");
}

async function runPreviewEntries({
  config,
  entries,
  runEntry,
  getDiagnostics,
  shouldStopAfterFailure,
}) {
  const failures = [];
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex];
    try {
      await runEntry(entry);
    } catch (error) {
      failures.push({
        config,
        entry,
        message: error instanceof Error ? error.message : String(error),
        ...getDiagnostics(),
      });

      if (shouldStopAfterFailure()) {
        for (const remainingEntry of entries.slice(entryIndex + 1)) {
          failures.push({
            config,
            entry: remainingEntry,
            message: `Not run because ${config} stopped after ${entry.screen} failed.`,
            ...getDiagnostics(),
          });
        }
        break;
      }
    }
  }
  return failures;
}

function isPreviewBrowserAvailable() {
  return Boolean(
    activeChromium
    && activeChromium.exitCode === null
    && socket?.readyState === WebSocket.OPEN,
  );
}

async function testPreviewFailureSummary() {
  const attempted = [];
  const continuedFailures = await runPreviewEntries({
    config: "vite.continue-fixture.config.ts",
    entries: [
      { path: "/broken-preview.html", screen: "Broken screen" },
      { path: "/later-preview.html", screen: "Later screen" },
    ],
    runEntry: async (entry) => {
      attempted.push(entry.screen);
      if (entry.screen === "Broken screen") throw new Error("expected fixture failure");
    },
    getDiagnostics: () => ({ viteOutput: "", browserOutput: "" }),
    shouldStopAfterFailure: () => false,
  });
  assert.deepEqual(attempted, ["Broken screen", "Later screen"]);
  assert.equal(continuedFailures.length, 1);
  assert.equal(continuedFailures[0].entry.screen, "Broken screen");

  const stoppedFailures = await runPreviewEntries({
    config: "vite.stopped-fixture.config.ts",
    entries: [
      { path: "/failed-preview.html", screen: "Failed screen" },
      { path: "/skipped-preview.html", screen: "Skipped screen" },
    ],
    runEntry: async () => { throw new Error("browser disconnected"); },
    getDiagnostics: () => ({ viteOutput: "", browserOutput: "" }),
    shouldStopAfterFailure: () => true,
  });
  assert.equal(stoppedFailures.length, 2);
  assert.match(stoppedFailures[1].message, /Not run because vite\.stopped-fixture\.config\.ts stopped/);

  const summary = formatPreviewFailureSummary([
    ...continuedFailures.map((failure) => ({
      ...failure,
      config: "vite.first.config.ts",
      entry: { path: "/first-preview.html", screen: "First screen" },
      message: "missing marker",
      viteOutput: "Vite detail",
    })),
    {
      config: "vite.second.config.ts",
      entry: { path: "/second-preview.html?screen=Home", screen: "Second screen" },
      message: "browser error",
      browserOutput: "Chromium detail",
    },
  ]);

  assert.match(summary, /2 entries across 2 configs/);
  assert.match(summary, /vite\.first\.config\.ts[\s\S]*\/first-preview\.html — First screen: missing marker/);
  assert.match(summary, /Vite output:\nVite detail/);
  assert.match(summary, /vite\.second\.config\.ts[\s\S]*\/second-preview\.html\?screen=Home — Second screen: browser error/);
  assert.match(summary, /Chromium output:\nChromium detail/);
  console.log("PASS preview failure summary includes every failed config and entrypoint.");
}

async function testChromiumPreflightFailure() {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "daily007-chromium-preflight-"));
  const binDirectory = path.join(fixtureRoot, "bin");
  const missingChromium = path.join(fixtureRoot, "missing-chromium");
  const viteMarker = path.join(fixtureRoot, "vite-started");
  const childOutput = [];

  try {
    await mkdir(binDirectory);
    await writeFile(
      path.join(binDirectory, "pnpm"),
      `#!/bin/sh
printf started > "$DAILY007_PREVIEW_VITE_MARKER"
exit 0
`,
      { mode: 0o755 },
    );

    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "--test-chromium-preflight-fixture"],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          CHROMIUM_PATH: missingChromium,
          DAILY007_PREVIEW_VITE_MARKER: viteMarker,
          PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (chunk) => { childOutput.push(chunk.toString()); });
    child.stderr.on("data", (chunk) => { childOutput.push(chunk.toString()); });

    const startedAt = Date.now();
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Chromium spawn failure took too long to report."));
      }, 5_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });
    const elapsed = Date.now() - startedAt;
    const output = childOutput.join("");

    assert.notEqual(result.code, 0, "missing Chromium must fail the preview check");
    assert.match(output, /Chromium could not be started/);
    assert.match(output, /missing-chromium/);
    assert.ok(elapsed < 5_000, "missing Chromium must fail before the browser readiness timeout");
    await assert.rejects(
      readFile(viteMarker),
      { code: "ENOENT" },
      "Vite must not start when Chromium preflight fails",
    );
    console.log("PASS missing Chromium fails promptly before any Vite preview server starts.");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function runPreviewProcessCleanupFixture(scenario) {
  const reportPath = process.env.DAILY007_PREVIEW_PROCESS_REPORT;
  assert.ok(reportPath, "the process cleanup fixture requires a report path");
  const workerPort = await getFreePort();
  const workerScript = [
    'const http = require("node:http");',
    'const mode = process.env.DAILY007_PREVIEW_WORKER_MODE;',
    'if (mode === "startup-failure") process.exit(17);',
    'if (mode === "browser-failure" || mode === "browser-ready" || mode === "vite-ready") {',
    '  const server = http.createServer((_request, response) => {',
    '    response.statusCode = mode === "browser-failure" ? 503 : 200;',
    '    response.end(JSON.stringify({ Browser: "fixture" }));',
    '  });',
    '  server.listen(Number(process.env.DAILY007_PREVIEW_WORKER_PORT), "127.0.0.1");',
    '  process.on("SIGTERM", () => server.close(() => process.exit(0)));',
    '}',
    'setInterval(() => {}, 1000);',
  ].join("\n");
  const startWorker = (mode, port) => spawn(
    process.execPath,
    ["-e", workerScript],
    {
      env: {
        ...process.env,
        DAILY007_PREVIEW_WORKER_MODE: mode,
        DAILY007_PREVIEW_WORKER_PORT: String(port),
      },
      stdio: "ignore",
    },
  );
  const processes = [];
  let safeLaterGroupRan = false;

  try {
    activeChromium = startWorker(
      scenario === "browser-failure" ? "browser-failure" : "browser-ready",
      workerPort,
    );
    activeChromium.executable = "fixture-chromium";
    processes.push({ name: "Chromium", child: activeChromium });

    if (scenario !== "browser-failure") {
      await waitForBrowser(
        `http://127.0.0.1:${workerPort}/json/version`,
        activeChromium,
        () => "",
        1_500,
      );
    }

    const vitePort = await getFreePort();
    activeVite = startWorker(
      scenario === "vite-startup-failure" ? "startup-failure" : "vite-ready",
      vitePort,
    );
    processes.push({ name: "Vite", child: activeVite });

    const failures = await runPreviewEntries({
      config: `vite.${scenario}.config.ts`,
      entries: [{ path: "/failure-fixture", screen: "Controlled failure" }],
      runEntry: async () => {
        if (scenario === "browser-failure") {
          await waitForBrowser(
            `http://127.0.0.1:${workerPort}/json/version`,
            activeChromium,
            () => "",
            300,
          );
          return;
        }
        if (scenario === "vite-startup-failure") {
          await waitForPreview(
            `http://127.0.0.1:${vitePort}/`,
            "Fixture Vite startup",
            activeVite,
            () => "",
            1_500,
          );
          return;
        }

        await waitForPreview(
          `http://127.0.0.1:${vitePort}/`,
          "Fixture Vite runtime",
          activeVite,
          () => "",
          1_500,
        );
        activeVite.kill("SIGTERM");
        await new Promise((resolve) => activeVite.once("exit", resolve));
        await waitForPreview(
          `http://127.0.0.1:${vitePort}/`,
          "Fixture Vite runtime",
          activeVite,
          () => "",
          300,
        );
      },
      getDiagnostics: () => ({ viteOutput: "", browserOutput: "" }),
      shouldStopAfterFailure: () =>
        activeVite.exitCode !== null || scenario === "browser-failure",
    });

    assert.equal(failures.length, 1, `${scenario} must be recorded as a preview failure`);
    await stopProcess(activeVite);
    activeVite = undefined;

    if (scenario !== "browser-failure") {
      const safePort = await getFreePort();
      activeVite = startWorker("vite-ready", safePort);
      processes.push({ name: "later Vite", child: activeVite });
      await waitForPreview(
        `http://127.0.0.1:${safePort}/`,
        "Safe later preview group",
        activeVite,
        () => "",
        1_500,
      );
      safeLaterGroupRan = true;
      await stopProcess(activeVite);
      activeVite = undefined;
    }
  } finally {
    await cleanupPreviewProcesses();
    await writeFile(
      reportPath,
      JSON.stringify({
        scenario,
        safeLaterGroupRan,
        processes: processes.map(({ name, child }) => ({
          name,
          pid: child.pid,
          exitCode: child.exitCode,
          signalCode: child.signalCode,
        })),
      }, null, 2),
    );
  }
}

async function testPreviewProcessCleanup() {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "daily007-preview-process-cleanup-"));

  try {
    for (const scenario of ["vite-startup-failure", "vite-runtime-failure", "browser-failure"]) {
      const reportPath = path.join(fixtureRoot, `${scenario}.json`);
      const childOutput = [];
      const child = spawn(
        process.execPath,
        [fileURLToPath(import.meta.url), "--test-preview-process-cleanup-fixture", scenario],
        {
          cwd: workspaceRoot,
          env: { ...process.env, DAILY007_PREVIEW_PROCESS_REPORT: reportPath },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout.on("data", (chunk) => { childOutput.push(chunk.toString()); });
      child.stderr.on("data", (chunk) => { childOutput.push(chunk.toString()); });
      const result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`${scenario} cleanup fixture timed out.`));
        }, 8_000);
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once("close", (code, signal) => {
          clearTimeout(timeout);
          resolve({ code, signal });
        });
      });

      assert.equal(
        result.code,
        0,
        `${scenario} fixture failed (${result.signal ?? "no signal"}):\n${childOutput.join("")}`,
      );
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.scenario, scenario);
      assert.ok(report.processes.some(({ name }) => name === "Vite"));
      assert.ok(report.processes.some(({ name }) => name === "Chromium"));
      for (const processReport of report.processes) {
        assert.ok(
          processReport.exitCode !== null || processReport.signalCode !== null,
          `${scenario} left ${processReport.name} running (pid ${processReport.pid})`,
        );
        assert.throws(
          () => process.kill(processReport.pid, 0),
          { code: "ESRCH" },
          `${scenario} left ${processReport.name} process ${processReport.pid} alive`,
        );
      }
      if (scenario !== "browser-failure") {
        assert.equal(report.safeLaterGroupRan, true, "a safe later preview group must still run");
      }
    }
    console.log("PASS preview Vite and Chromium processes close after controlled failures.");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function checkPreviewDependencyBoundaryPlugin() {
  const configs = [...new Set(previewGroups.map((group) => group.config))].sort();
  const errors = [];

  for (const config of configs) {
    const source = await readFile(path.join(sandboxRoot, config), "utf8");
    const importsPlugin =
      /import\s*\{\s*previewDependencyBoundaryPlugin\s*\}\s*from\s*["']\.\/scripts\/previewDependencyBoundary\.mjs["']/.test(source);
    const installsPlugin =
      /plugins\s*:\s*\[[^\]]*\bpreviewDependencyBoundaryPlugin\s*\(\s*\)/.test(source);

    if (!importsPlugin || !installsPlugin) {
      const missing = [
        ...(!importsPlugin ? ["import previewDependencyBoundaryPlugin"] : []),
        ...(!installsPlugin ? ["install previewDependencyBoundaryPlugin() in the Vite plugins array"] : []),
      ];
      errors.push(`${config} must ${missing.join(" and ")}.`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Preview dependency-boundary plugin check failed:\n${errors.join("\n")}`);
  }

  console.log(
    `PASS preview dependency-boundary plugin — ${configs.length} Vite configs.`,
  );
}

async function checkPreviewDependencyBoundary() {
  const fixtureRoot = await mkdtemp(
    path.join(sandboxRoot, ".preview-dependency-boundary-fixture-"),
  );
  const previousDependencyCheck = process.env.DAILY007_CHECK_PREVIEW_DEPENDENCIES;
  const workspaceManifestPath = path.join(workspaceRoot, "package.json");
  const workspaceManifestBefore = await readFile(workspaceManifestPath, "utf8");
  const fixtureDirectory = path.join(fixtureRoot, "package");
  const fixturePackageName = "@workspace/preview-dependency-boundary-fixture";
  const importer = path.join(fixtureDirectory, "entry.mjs");
  const manifestPath = path.join(fixtureDirectory, "package.json");
  const scopedPackageName = "@radix-ui/react-accordion";

  try {
    process.env.DAILY007_CHECK_PREVIEW_DEPENDENCIES = "1";
    await mkdir(fixtureDirectory, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        name: fixturePackageName,
        private: true,
        dependencies: { zod: "*", [scopedPackageName]: "*" },
      }),
    );
    await writeFile(importer, `import "zod";\nimport "${scopedPackageName}";\n`);

    const requireFromFixture = createRequire(importer);
    const resolvedId = requireFromFixture.resolve("zod");
    const resolvedScopedId = requireFromFixture.resolve(scopedPackageName);
    assert.ok(resolvedId, "zod must resolve from the fixture workspace");
    assert.ok(
      resolvedScopedId,
      `${scopedPackageName} must resolve from the fixture workspace`,
    );
    const plugin = previewDependencyBoundaryPlugin();
    for (const [packageName, packageId] of [
      ["zod", resolvedId],
      [scopedPackageName, resolvedScopedId],
    ]) {
      const result = await plugin.resolveId.call(
        {
          async resolve() {
            return { id: packageId, external: false };
          },
          error(message) {
            throw new Error(message);
          },
        },
        packageName,
        importer,
      );
      assert.equal(
        result,
        null,
        `declared package ${packageName} must pass the boundary check`,
      );
    }

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
      const fixturePackageName = ${JSON.stringify(fixturePackageName)};
      const requireFromFixture = createRequire(importer);
      const packages = [
        { name: "zod", external: false },
        { name: "@radix-ui/react-accordion", external: true },
      ].map((dependency) => ({
        ...dependency,
        resolvedId: requireFromFixture.resolve(dependency.name),
      }));
      const plugin = previewDependencyBoundaryPlugin();
      for (const dependency of packages) {
        assert.ok(
          dependency.resolvedId,
          dependency.name + " must remain resolvable after its declaration is removed",
        );
        const outcome = await plugin.resolveId.call(
          {
            async resolve() {
              return { id: dependency.resolvedId, external: dependency.external };
            },
            error(message) {
              throw new Error(message);
            },
          },
          dependency.name,
          importer,
        ).then(
          () => ({ blocked: false, message: "" }),
          (error) => ({ blocked: true, message: error.message }),
        );
        assert.equal(
          outcome.blocked,
          true,
          "undeclared package " + dependency.name + " must be rejected",
        );
        assert.ok(
          outcome.message.includes(
            "Preview dependency boundary violation: " + fixturePackageName
              + " imports " + JSON.stringify(dependency.name),
          ) && outcome.message.includes(
            "does not declare resolved package " + JSON.stringify(dependency.name),
          ),
          "the boundary diagnostic must name " + dependency.name + ": " + outcome.message,
        );
      }
      console.log(
        "PASS preview dependency boundary rejects resolvable unscoped and scoped packages after declaration removal.",
      );
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
    assert.equal(
      await readFile(workspaceManifestPath, "utf8"),
      workspaceManifestBefore,
      "the preview dependency fixture must not modify the workspace manifest",
    );
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

async function waitForPreview(url, label, server, getServerOutput, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (server.spawnError) {
      throw new Error(`${label} could not start: ${server.spawnError.message}`);
    }
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

async function waitForBrowser(url, browser, getBrowserOutput, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  const throwIfSpawnFailed = () => {
    if (browser.spawnError) {
      throw new Error(
        `Chromium could not be started with "${browser.executable}": ` +
          `${browser.spawnError.message}. Install Chromium or set CHROMIUM_PATH to a usable executable.`,
      );
    }
  };
  throwIfSpawnFailed();
  while (Date.now() < deadline) {
    throwIfSpawnFailed();
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
    throwIfSpawnFailed();
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

function createPreviewEventScope(config, entry, url) {
  const scope = {
    config,
    entry: { path: entry.path, screen: entry.screen },
    url,
    events: [],
  };
  previewEventScopes.push(scope);
  return scope;
}

function setActivePreviewEventScope(scope) {
  activePreviewEventScope = scope;
}

function previewScopeForCdpEvent(message) {
  const { method, params = {} } = message;
  if (method === "Runtime.exceptionThrown" || method === "Runtime.consoleAPICalled") {
    const executionContextId = method === "Runtime.exceptionThrown"
      ? params.exceptionDetails?.executionContextId
      : params.executionContextId;
    if (executionContextScopes.has(executionContextId)) {
      return executionContextScopes.get(executionContextId);
    }
  }
  if (
    method === "Network.requestWillBeSent"
    && networkLoaderScopes.has(params.loaderId)
  ) {
    return networkLoaderScopes.get(params.loaderId);
  }
  if (method === "Page.frameNavigated") {
    const loaderId = params.frame?.loaderId;
    if (loaderId && networkLoaderScopes.has(loaderId)) return networkLoaderScopes.get(loaderId);
  }
  if (method === "Runtime.executionContextCreated") {
    const frameId = params.context?.auxData?.frameId;
    if (frameId && frameScopes.has(frameId)) return frameScopes.get(frameId);
  }
  return activePreviewEventScope;
}

function trackCdpEvent(message) {
  const { method, params = {} } = message;
  let scope = previewScopeForCdpEvent(message);

  if (method === "Network.requestWillBeSent" && params.loaderId && scope) {
    if (!networkLoaderScopes.has(params.loaderId)) {
      networkLoaderScopes.set(params.loaderId, scope);
    } else {
      scope = networkLoaderScopes.get(params.loaderId);
    }
  } else if (method === "Page.frameNavigated" && params.frame?.id && scope) {
    frameScopes.set(params.frame.id, scope);
    if (params.frame.loaderId && !networkLoaderScopes.has(params.frame.loaderId)) {
      networkLoaderScopes.set(params.frame.loaderId, scope);
    }
  } else if (
    method === "Runtime.executionContextCreated"
    && params.context?.id !== undefined
    && scope
  ) {
    executionContextScopes.set(params.context.id, scope);
  }

  const browserError = browserErrorForCdpEvent(method, params);
  if (browserError && scope) {
    scope.events.push({ type: "browser-error", message: browserError });
  }

  if (method === "Network.requestWillBeSent" && scope) {
    const requestUrl = params.request?.url;
    if (typeof requestUrl === "string") {
      try {
        const request = new URL(requestUrl);
        if (
          ["http:", "https:", "ws:", "wss:"].includes(request.protocol)
          && !["127.0.0.1", "localhost"].includes(request.hostname)
        ) {
          scope.events.push({ type: "external-request", message: requestUrl });
        }
      } catch {
        // Ignore browser-internal and non-network URLs.
      }
    }
  }
}

function previewEventDiagnostics(scope) {
  const browserErrors = [...new Set(
    scope.events.filter(({ type }) => type === "browser-error").map(({ message }) => message),
  )];
  const externalRequests = [...new Set(
    scope.events.filter(({ type }) => type === "external-request").map(({ message }) => message),
  )];
  return [
    ...(browserErrors.length
      ? [`${scope.entry.screen} preview raised a browser error:\n${browserErrors.join("\n")}`]
      : []),
    ...(externalRequests.length
      ? [`${scope.entry.screen} preview attempted external requests:\n${externalRequests.join("\n")}`]
      : []),
  ];
}

function assertNoPreviewEvents(scope) {
  const diagnostics = previewEventDiagnostics(scope);
  if (diagnostics.length) throw new Error(diagnostics.join("\n"));
}

function addPreviewEventFailures(failures, scopes) {
  const grouped = new Map();
  for (const scope of scopes) {
    const diagnostics = previewEventDiagnostics(scope);
    if (!diagnostics.length) continue;
    const key = `${scope.config}\0${scope.entry.path}\0${scope.entry.screen}`;
    const group = grouped.get(key) ?? {
      config: scope.config,
      entry: scope.entry,
      diagnostics: [],
    };
    for (const diagnostic of diagnostics) {
      if (!group.diagnostics.includes(diagnostic)) group.diagnostics.push(diagnostic);
    }
    grouped.set(key, group);
  }

  for (const group of grouped.values()) {
    const diagnostic = group.diagnostics.join("\n");
    const priorFailure = failures.find((failure) =>
      failure.config === group.config
      && failure.entry.path === group.entry.path
      && failure.entry.screen === group.entry.screen
    );
    if (priorFailure) {
      if (!priorFailure.message.includes(diagnostic)) {
        priorFailure.message = `${priorFailure.message}\n${diagnostic}`;
      }
      continue;
    }
    failures.push({
      config: group.config,
      entry: group.entry,
      message: diagnostic,
      viteOutput: "",
      browserOutput: "",
    });
  }
}

async function testPreviewEventAttribution() {
  const first = createPreviewEventScope(
    "vite.first-fixture.config.ts",
    { path: "/first-preview.html", screen: "First preview" },
    "http://127.0.0.1/first-preview.html",
  );
  setActivePreviewEventScope(first);
  trackCdpEvent({
    method: "Runtime.executionContextCreated",
    params: { context: { id: 101, auxData: { frameId: "main-frame" } } },
  });
  trackCdpEvent({
    method: "Network.requestWillBeSent",
    params: {
      loaderId: "first-loader",
      request: { url: "http://127.0.0.1/first-preview.html" },
    },
  });
  trackCdpEvent({
    method: "Page.frameNavigated",
    params: { frame: { id: "main-frame", loaderId: "first-loader" } },
  });

  const second = createPreviewEventScope(
    "vite.second-fixture.config.ts",
    { path: "/second-preview.html?screen=Home", screen: "Second preview" },
    "http://127.0.0.1/second-preview.html?screen=Home",
  );
  setActivePreviewEventScope(second);
  trackCdpEvent({
    method: "Page.frameNavigated",
    params: { frame: { id: "main-frame", loaderId: "second-loader" } },
  });
  trackCdpEvent({
    method: "Runtime.executionContextCreated",
    params: { context: { id: 202, auxData: { frameId: "main-frame" } } },
  });
  trackCdpEvent({
    method: "Runtime.consoleAPICalled",
    params: {
      type: "error",
      executionContextId: 101,
      args: [{ value: "Late first-preview console error." }],
    },
  });
  trackCdpEvent({
    method: "Runtime.exceptionThrown",
    params: {
      exceptionDetails: {
        executionContextId: 101,
        exception: { description: "Late first-preview exception." },
      },
    },
  });
  trackCdpEvent({
    method: "Network.requestWillBeSent",
    params: {
      loaderId: "first-loader",
      request: { url: "https://outside.example.invalid/late-request" },
    },
  });

  assert.equal(first.events.length, 3, "late CDP events should stay with their originating preview");
  assert.equal(second.events.length, 0, "late CDP events must not contaminate the current preview");
  const failures = [];
  addPreviewEventFailures(failures, [first, second]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].config, "vite.first-fixture.config.ts");
  assert.equal(failures[0].entry.path, "/first-preview.html");
  assert.match(failures[0].message, /Late first-preview console error\./);
  assert.match(failures[0].message, /Late first-preview exception\./);
  assert.match(failures[0].message, /outside\.example\.invalid\/late-request/);

  const summary = formatPreviewFailureSummary(failures);
  assert.match(summary, /vite\.first-fixture\.config\.ts/);
  assert.match(summary, /\/first-preview\.html — First preview/);
  assert.doesNotMatch(summary, /vite\.second-fixture\.config\.ts/);
  console.log("PASS late browser errors and external requests retain their originating config and entrypoint.");
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    socket = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("Timed out connecting to Chromium DevTools.")), 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      socket.addEventListener("message", ({ data }) => {
        const message = JSON.parse(String(data));
        trackCdpEvent(message);
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
  const chromiumExecutable = process.env.CHROMIUM_PATH || "chromium";
  activeChromium = spawn(
    chromiumExecutable,
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
  activeChromium.executable = chromiumExecutable;
  activeChromium.once("error", (error) => { activeChromium.spawnError = error; });
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

async function checkPreviewInteraction(entry, eventScope) {
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
    assertNoPreviewEvents(eventScope);
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

async function checkPreview(url, entry, eventScope) {
  await cdp("Page.stopLoading").catch(() => undefined);
  setActivePreviewEventScope(eventScope);
  const navigation = await cdp("Page.navigate", { url });
  if (navigation.errorText) {
    throw new Error(`${entry.screen} preview navigation failed: ${navigation.errorText}`);
  }
  if (navigation.loaderId) {
    networkLoaderScopes.set(navigation.loaderId, eventScope);
  }
  if (navigation.frameId) frameScopes.set(navigation.frameId, eventScope);
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
          ` Browser events: ${previewEventDiagnostics(eventScope).join(" | ") || "none"}.` +
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
    assertNoPreviewEvents(eventScope);
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
      assertNoPreviewEvents(eventScope);
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
        await checkPreviewInteraction(entry, eventScope);
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
const previewFailures = [];

async function cleanupPreviewProcesses() {
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

try {
  const duplicateTestOnly = process.argv.includes("--test-preview-duplicates-only");
  const failureSummaryOnly = process.argv.includes("--test-preview-failure-summary-only");
  const previewEventAttributionTestOnly = process.argv.includes("--test-preview-event-attribution-only");
  const chromiumPreflightTestOnly = process.argv.includes("--test-chromium-preflight-only");
  const chromiumPreflightFixtureOnly = process.argv.includes("--test-chromium-preflight-fixture");
  const processCleanupTestOnly = process.argv.includes("--test-preview-process-cleanup-only");
  const processCleanupFixtureOnly = process.argv.includes("--test-preview-process-cleanup-fixture");
  if (previewEventAttributionTestOnly) {
    await testPreviewEventAttribution();
  } else if (failureSummaryOnly) {
    await testPreviewFailureSummary();
  } else if (duplicateTestOnly) {
    await testPreviewEntrypointDuplicates();
  } else if (chromiumPreflightTestOnly) {
    await testChromiumPreflightFailure();
  } else if (processCleanupTestOnly) {
    await testPreviewProcessCleanup();
  } else if (processCleanupFixtureOnly) {
    await runPreviewProcessCleanupFixture(process.argv.at(-1));
  } else if (!chromiumPreflightFixtureOnly && !previewEventAttributionTestOnly) {
    await checkPreviewDependencyBoundary();
    await checkPreviewEntrypointCoverage();
    await checkPreviewDependencyBoundaryPlugin();
  }

  if (
    !duplicateTestOnly
    && !failureSummaryOnly
    && !previewEventAttributionTestOnly
    && !chromiumPreflightTestOnly
    && !processCleanupTestOnly
    && !processCleanupFixtureOnly
    && !process.argv.includes("--check-entrypoints-only")
  ) {
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
      if (!isPreviewBrowserAvailable()) {
        for (const entry of entries) {
          previewFailures.push({
            config: group.config,
            entry,
            message: "Not run because Chromium became unavailable after an earlier preview failure.",
            viteOutput: "",
            browserOutput: browserOutput.trim().slice(-2_000),
          });
        }
        continue;
      }

      let port;
      try {
        port = await getFreePort();
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
        activeVite.on("error", (error) => { activeVite.spawnError = error; });
        activeVite.stdout.on("data", (chunk) => { activeViteOutput += chunk.toString(); });
        activeVite.stderr.on("data", (chunk) => { activeViteOutput += chunk.toString(); });
      } catch (error) {
        for (const entry of entries) {
          previewFailures.push({
            config: group.config,
            entry,
            message: `Vite config could not be started: ${error instanceof Error ? error.message : String(error)}`,
            viteOutput: activeViteOutput.trim().slice(-4_000),
            browserOutput: "",
          });
        }
        continue;
      }

      try {
        previewFailures.push(...await runPreviewEntries({
          config: group.config,
          entries,
          runEntry: async (entry) => {
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
              const eventScope = createPreviewEventScope(group.config, entry, url);
              await checkPreview(
                url,
                { ...entry, viewport: variant.viewport, fontScale: variant.fontScale },
                eventScope,
              );
              console.log(
                `PASS ${group.config} ${entry.path} → ${entry.screen} @ ` +
                  `${variant.viewport.width}×${variant.viewport.height}` +
                  (variant.fontScale === null ? "" : `, ${variant.fontScale}× text`),
              );
            }
          },
          getDiagnostics: () => ({
            viteOutput: activeViteOutput.trim().slice(-4_000),
            browserOutput: browserOutput.trim().slice(-2_000),
          }),
          shouldStopAfterFailure: () =>
            activeVite.exitCode !== null
            || activeVite.spawnError
            || !isPreviewBrowserAvailable(),
        }));
      } finally {
        await stopProcess(activeVite);
        activeVite = undefined;
      }
    }

    await delay(150);
    addPreviewEventFailures(previewFailures, previewEventScopes);
    if (previewFailures.length > 0) {
      console.error(formatPreviewFailureSummary(previewFailures));
      process.exitCode = 1;
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
  await cleanupPreviewProcesses();
}
