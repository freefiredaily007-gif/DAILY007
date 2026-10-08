import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

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
const previewGroups = [
  {
    config: "vite.admin-narrow.config.ts",
    entries: [
      {
        path: "/admin-narrow-preview.html",
        screen: "Admin",
        markers: ["ADMIN OPS", 'data-testid="admin-tab-users"'],
      },
      {
        path: "/home-carousel-preview.html",
        screen: "Home carousel",
        markers: ["DAILY007 TOURNAMENTS", "GAME MODES"],
      },
      {
        path: "/keyboard-forms-preview.html",
        screen: "Wallet and Edit Profile",
        markers: ['data-testid="wallet-open-recharge"'],
      },
      {
        path: "/tournament-resume-preview.html",
        screen: "Tournament list",
        markers: ["IST Start Boundary", 'data-testid="tournament-tab-upcoming"'],
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
      },
    ],
  },
  {
    config: "vite.player-largest-text.config.ts",
    entries: [
      {
        path: "/player-largest-text-preview.html?screen=Home",
        screen: "Player Home",
        markers: ["GAME MODES", 'data-testid="home-mode-battle-royale"'],
      },
    ],
  },
  {
    config: "vite.join-form-largest-text.config.ts",
    entries: [
      {
        path: "/player-join-form-largest-text-preview.html",
        screen: "Player Join Form",
        markers: ["Daily007 Squad Finals", 'data-testid="join-form-submit"'],
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
      },
    ],
  },
];

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
    "chromium",
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
}

async function checkPreview(url, entry) {
  await cdp("Page.stopLoading").catch(() => undefined);
  browserErrors.length = 0;
  externalRequests.length = 0;
  const navigation = await cdp("Page.navigate", { url });
  if (navigation.errorText) {
    throw new Error(`${entry.screen} preview navigation failed: ${navigation.errorText}`);
  }

  const expectedMarkers = JSON.stringify(entry.markers);
  const expectedUrl = JSON.stringify(url);
  const expression = `(() => {
    const text = document.body?.innerText ?? "";
    const html = document.body?.innerHTML ?? "";
    const markers = ${expectedMarkers};
    const missing = markers.filter((marker) =>
      marker.startsWith('data-testid="') ? !html.includes(marker) : !text.includes(marker)
    );
    return {
      url: window.location.href,
      ready: window.location.href === ${expectedUrl} && missing.length === 0,
      missing,
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
      if (state.ready && !state.hasViteError) return;
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
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "daily007-preview-entrypoints-"));
  await startChromium(path.join(temporaryRoot, "chromium-profile"));

  for (const group of previewGroups) {
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
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    activeVite.stdout.on("data", (chunk) => { activeViteOutput += chunk.toString(); });
    activeVite.stderr.on("data", (chunk) => { activeViteOutput += chunk.toString(); });

    for (const entry of group.entries) {
      const url = `http://127.0.0.1:${port}${entry.path}`;
      await waitForPreview(url, `${group.config} ${entry.path}`, activeVite, () => activeViteOutput);
      await checkPreview(url, entry);
      console.log(`PASS ${group.config} ${entry.path} → ${entry.screen}`);
    }

    await stopProcess(activeVite);
    activeVite = undefined;
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
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
}
