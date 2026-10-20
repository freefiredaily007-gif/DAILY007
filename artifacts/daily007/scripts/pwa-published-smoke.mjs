import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const HTML_CONTENT_TYPES = ['text/html'];
const JSON_CONTENT_TYPES = ['application/json', 'application/manifest+json'];
const JAVASCRIPT_CONTENT_TYPES = [
  'application/javascript',
  'text/javascript',
  'application/x-javascript',
];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_START_URL_REDIRECTS = 10;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const responseTimeouts = new WeakMap();
// Keep this value in sync with public/manifest.json. Change both only when
// intentionally changing the identity of the installed Daily007 app.
export const EXPECTED_DAILY007_PWA_ID = './';
const appConfig = JSON.parse(
  await readFile(fileURLToPath(new URL('../app.json', import.meta.url)), 'utf8'),
);
export const EXPECTED_DAILY007_WEB_RELEASE_MARKER =
  appConfig.expo?.extra?.daily007WebReleaseMarker;
if (
  typeof EXPECTED_DAILY007_WEB_RELEASE_MARKER !== 'string'
  || !EXPECTED_DAILY007_WEB_RELEASE_MARKER.trim()
) {
  throw new Error(
    'PWA smoke check failed: app.json must define expo.extra.daily007WebReleaseMarker.',
  );
}
if (!EXPECTED_DAILY007_WEB_RELEASE_MARKER.startsWith(`${appConfig.expo?.version}+web.`)) {
  throw new Error(
    'PWA smoke check failed: expo.extra.daily007WebReleaseMarker must begin with the app version followed by "+web.".',
  );
}

function mimeType(response) {
  return (response.headers.get('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function readAttribute(tag, name) {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return match?.slice(1).find((value) => value !== undefined);
}

function sameOriginUrl(reference, baseUrl, label) {
  let resolved;
  try {
    resolved = new URL(reference, baseUrl);
  } catch {
    throw new Error(`PWA smoke check failed: the ${label} reference "${reference}" is not a valid URL.`);
  }
  if (resolved.origin !== baseUrl.origin) {
    throw new Error(
      `PWA smoke check failed: the ${label} reference must use the published page's origin (${baseUrl.origin}).`,
    );
  }
  return resolved;
}

async function checkedGet(fetchImpl, label, url, acceptedContentTypes, options = {}) {
  let response;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const fetchOptions = { ...options };
  delete fetchOptions.requestTimeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      ...fetchOptions,
      signal,
    });
  } catch (cause) {
    if (signal.aborted) {
      throw new Error(
        `PWA smoke check failed: timed out after ${timeoutMs}ms while fetching ${label} at ${url.href}.`,
        { cause },
      );
    }
    throw new Error(
      `PWA smoke check failed: could not fetch ${label} at ${url.href}: ${cause instanceof Error ? cause.message : String(cause)}.`,
    );
  }
  responseTimeouts.set(response, { signal, timeoutMs });

  const actualType = mimeType(response);
  if (response.status !== 200 || !acceptedContentTypes.includes(actualType)) {
    const expectedTypes = acceptedContentTypes.join(' or ');
    throw new Error(
      `PWA smoke check failed: ${label} at ${url.href} returned HTTP ${response.status} with ${actualType || 'no content type'}; expected HTTP 200 and ${expectedTypes}. Check that the published Daily007 web build serves this file at the referenced path.`,
    );
  }
  return response;
}

async function readResponse(response, label, url, read) {
  try {
    return await read();
  } catch (cause) {
    const timeout = responseTimeouts.get(response);
    if (timeout?.signal.aborted) {
      throw new Error(
        `PWA smoke check failed: timed out after ${timeout.timeoutMs}ms while reading ${label} at ${url.href}.`,
        { cause },
      );
    }
    throw new Error(
      `PWA smoke check failed: could not read ${label} at ${url.href}: ${cause instanceof Error ? cause.message : String(cause)}.`,
    );
  }
}

function manifestReference(html) {
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    const rel = readAttribute(tag, 'rel');
    if (rel?.split(/\s+/).some((part) => part.toLowerCase() === 'manifest')) {
      const href = readAttribute(tag, 'href');
      if (!href) {
        throw new Error('PWA smoke check failed: the manifest link has no href.');
      }
      return href;
    }
  }
  throw new Error('PWA smoke check failed: the published page has no <link rel="manifest"> reference.');
}

function serviceWorkerReference(html) {
  const match = html.match(
    /navigator\.serviceWorker\.register\(\s*("(?:\\.|[^"\\])*")/i,
  );
  if (!match) {
    throw new Error('PWA smoke check failed: the published page has no service-worker registration reference.');
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    throw new Error('PWA smoke check failed: the service-worker registration URL is malformed.');
  }
}

function scriptReferences(html) {
  return (html.match(/<script\b[^>]*>/gi) || [])
    .map((tag) => readAttribute(tag, 'src'))
    .filter((reference) => typeof reference === 'string' && reference.trim());
}

function cacheBustedUrl(url) {
  const result = new URL(url);
  result.searchParams.set('_daily007_release_check', String(Date.now()));
  return result;
}

async function verifyWebRelease(fetchImpl, html, pageUrl, requestTimeoutMs) {
  const scripts = scriptReferences(html)
    .map((reference) => {
      try {
        return new URL(reference, pageUrl);
      } catch {
        return null;
      }
    })
    .filter((url) => url?.origin === pageUrl.origin);
  if (scripts.length === 0) {
    throw new Error(
      'PWA smoke check failed: the published page has no same-origin JavaScript bundle reference.',
    );
  }

  for (const scriptUrl of scripts) {
    const freshUrl = cacheBustedUrl(scriptUrl);
    const response = await checkedGet(
      fetchImpl,
      'web app JavaScript bundle',
      freshUrl,
      JAVASCRIPT_CONTENT_TYPES,
      {
        cache: 'no-store',
        headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
        requestTimeoutMs,
      },
    );
    const finalUrl = response.url ? new URL(response.url) : freshUrl;
    if (finalUrl.origin !== pageUrl.origin) {
      throw new Error(
        `PWA smoke check failed: the web app JavaScript bundle redirected outside the published page's origin to ${finalUrl.href}.`,
      );
    }
    const bundle = await readResponse(
      response,
      'web app JavaScript bundle',
      finalUrl,
      () => response.text(),
    );
    if (bundle.includes(EXPECTED_DAILY007_WEB_RELEASE_MARKER)) {
      return scriptUrl.href;
    }
  }

  throw new Error(
    `PWA smoke check failed: the cache-busted JavaScript bundles referenced by the published page do not contain the current Daily007 release marker "${EXPECTED_DAILY007_WEB_RELEASE_MARKER}". The public site is serving an older web release.`,
  );
}

function iconForSize(manifest, size) {
  const icon = manifest.icons?.find((entry) =>
    typeof entry?.sizes === 'string' && entry.sizes.split(/\s+/).includes(size),
  );
  if (!icon || typeof icon.src !== 'string' || !icon.src.trim()) {
    throw new Error(`PWA smoke check failed: the manifest has no icon entry for ${size}.`);
  }
  if (icon.type && icon.type.toLowerCase() !== 'image/png') {
    throw new Error(`PWA smoke check failed: the ${size} icon must declare image/png.`);
  }
  return icon;
}

function requiredManifestString(manifest, field) {
  const value = manifest[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(
      `PWA smoke check failed: manifest field "${field}" must be a non-empty string.`,
    );
  }
  return value;
}

function manifestFieldUrl(manifest, field, manifestUrl) {
  return sameOriginUrl(
    requiredManifestString(manifest, field),
    manifestUrl,
    `manifest field "${field}"`,
  );
}

function isWithinScope(url, scopeUrl) {
  if (url.origin !== scopeUrl.origin) return false;
  const scopePath = scopeUrl.pathname.endsWith('/')
    ? scopeUrl.pathname
    : `${scopeUrl.pathname}/`;
  return url.pathname === scopeUrl.pathname || url.pathname.startsWith(scopePath);
}

function validateInstallManifest(manifest, manifestUrl) {
  requiredManifestString(manifest, 'name');
  requiredManifestString(manifest, 'short_name');

  const idUrl = manifestFieldUrl(manifest, 'id', manifestUrl);
  const expectedIdUrl = new URL(EXPECTED_DAILY007_PWA_ID, manifestUrl);
  if (idUrl.href !== expectedIdUrl.href) {
    throw new Error(
      `PWA smoke check failed: Daily007 app identity mismatch. ` +
      `Expected manifest field "id" to resolve to ${expectedIdUrl.href}, ` +
      `but it resolves to ${idUrl.href}. For an intentional identity change, ` +
      `update EXPECTED_DAILY007_PWA_ID in scripts/pwa-published-smoke.mjs and public/manifest.json together.`,
    );
  }
  const startUrl = manifestFieldUrl(manifest, 'start_url', manifestUrl);
  const scopeUrl = manifestFieldUrl(manifest, 'scope', manifestUrl);
  if (!isWithinScope(startUrl, scopeUrl)) {
    throw new Error(
      'PWA smoke check failed: manifest field "start_url" must resolve within manifest field "scope".',
    );
  }

  const display = requiredManifestString(manifest, 'display');
  if (!['fullscreen', 'minimal-ui', 'standalone'].includes(display)) {
    throw new Error(
      'PWA smoke check failed: manifest field "display" must be "fullscreen", "minimal-ui", or "standalone" for an installable app.',
    );
  }

  return { idUrl, startUrl, scopeUrl };
}

async function verifyStartUrl(
  fetchImpl,
  startUrl,
  scopeUrl,
  expectedManifestUrl,
  expectedWorkerUrl,
  requestTimeoutMs,
) {
  let currentUrl = startUrl;
  let redirectsFollowed = 0;

  while (true) {
    let response;
    const signal = AbortSignal.timeout(requestTimeoutMs);
    try {
      response = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal,
      });
    } catch (cause) {
      if (signal.aborted) {
        throw new Error(
          `PWA smoke check failed: timed out after ${requestTimeoutMs}ms while fetching manifest field "start_url" at ${currentUrl.href}.`,
          { cause },
        );
      }
      throw new Error(
        `PWA smoke check failed: could not fetch manifest field "start_url" at ${currentUrl.href}: ${cause instanceof Error ? cause.message : String(cause)}.`,
      );
    }
    responseTimeouts.set(response, { signal, timeoutMs: requestTimeoutMs });

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(
          `PWA smoke check failed: manifest field "start_url" at ${currentUrl.href} returned HTTP ${response.status} without a Location header.`,
        );
      }

      let nextUrl;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        throw new Error(
          `PWA smoke check failed: manifest field "start_url" at ${currentUrl.href} returned an invalid redirect URL.`,
        );
      }

      if (!isWithinScope(nextUrl, scopeUrl)) {
        const boundary = nextUrl.origin !== scopeUrl.origin
          ? `the published app origin (${scopeUrl.origin})`
          : `manifest field "scope" (${scopeUrl.href})`;
        throw new Error(
          `PWA smoke check failed: manifest field "start_url" redirects outside ${boundary} to ${nextUrl.href}.`,
        );
      }

      redirectsFollowed += 1;
      if (redirectsFollowed > MAX_START_URL_REDIRECTS) {
        throw new Error(
          `PWA smoke check failed: manifest field "start_url" exceeded ${MAX_START_URL_REDIRECTS} redirects while fetching ${startUrl.href}.`,
        );
      }
      currentUrl = nextUrl;
      continue;
    }

    let finalUrl;
    try {
      finalUrl = response.url ? new URL(response.url) : currentUrl;
    } catch {
      throw new Error(
        `PWA smoke check failed: manifest field "start_url" at ${currentUrl.href} returned an invalid final URL.`,
      );
    }
    if (!isWithinScope(finalUrl, scopeUrl)) {
      const boundary = finalUrl.origin !== scopeUrl.origin
        ? `the published app origin (${scopeUrl.origin})`
        : `manifest field "scope" (${scopeUrl.href})`;
      throw new Error(
        `PWA smoke check failed: manifest field "start_url" resolved outside ${boundary} to ${finalUrl.href}.`,
      );
    }

    const actualType = mimeType(response);
    if (response.status !== 200 || !HTML_CONTENT_TYPES.includes(actualType)) {
      throw new Error(
        `PWA smoke check failed: manifest field "start_url" at ${finalUrl.href} returned HTTP ${response.status} with ${actualType || 'no content type'}; expected HTTP 200 and text/html.`,
      );
    }

    const startPageHtml = await readResponse(
      response,
      'manifest field "start_url"',
      finalUrl,
      () => response.text(),
    );

    let startPageManifestUrl;
    let startPageWorkerUrl;
    try {
      startPageManifestUrl = sameOriginUrl(
        manifestReference(startPageHtml),
        finalUrl,
        'start_url manifest',
      );
      startPageWorkerUrl = sameOriginUrl(
        serviceWorkerReference(startPageHtml),
        finalUrl,
        'start_url service-worker',
      );
    } catch (cause) {
      throw new Error(
        `PWA smoke check failed: manifest field "start_url" at ${finalUrl.href} did not return the Daily007 app page: ${cause instanceof Error ? cause.message : String(cause)}.`,
      );
    }
    if (
      startPageManifestUrl.href !== expectedManifestUrl.href
      || startPageWorkerUrl.href !== expectedWorkerUrl.href
    ) {
      throw new Error(
        `PWA smoke check failed: manifest field "start_url" at ${finalUrl.href} returned a different PWA page; expected the Daily007 manifest and service worker.`,
      );
    }
    return;
  }
}

async function verifyPng(fetchImpl, label, url, requestTimeoutMs) {
  const response = await checkedGet(fetchImpl, label, url, ['image/png'], { requestTimeoutMs });
  const bytes = new Uint8Array(
    await readResponse(response, label, url, () => response.arrayBuffer()),
  );
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((byte, index) => bytes[index] !== byte)) {
    throw new Error(
      `PWA smoke check failed: ${label} at ${url.href} is not a valid PNG file. Rebuild or restore the published Daily007 icon asset.`,
    );
  }
}

export async function checkPublishedPwa(
  input,
  fetchImpl = fetch,
  { requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {},
) {
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error('PWA smoke check failed: requestTimeoutMs must be a positive finite number.');
  }
  let baseUrl;
  try {
    baseUrl = new URL(input);
  } catch {
    throw new Error('PWA smoke check failed: provide a valid published Daily007 URL (https://…).');
  }
  if (baseUrl.protocol !== 'https:' && baseUrl.protocol !== 'http:') {
    throw new Error('PWA smoke check failed: the published URL must use HTTP or HTTPS.');
  }
  baseUrl.search = '';
  baseUrl.hash = '';
  if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';

  const freshPageUrl = cacheBustedUrl(baseUrl);
  const pageResponse = await checkedGet(
    fetchImpl,
    'published page',
    freshPageUrl,
    HTML_CONTENT_TYPES,
    {
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
      requestTimeoutMs,
    },
  );
  const pageHtml = await readResponse(
    pageResponse,
    'published page',
    freshPageUrl,
    () => pageResponse.text(),
  );
  const pageUrl = new URL(pageResponse.url || baseUrl.href);
  const webBundleUrl = await verifyWebRelease(fetchImpl, pageHtml, pageUrl, requestTimeoutMs);

  const manifestUrl = sameOriginUrl(manifestReference(pageHtml), pageUrl, 'manifest');
  const workerUrl = sameOriginUrl(serviceWorkerReference(pageHtml), pageUrl, 'service-worker');
  const manifestResponse = await checkedGet(
    fetchImpl,
    'manifest',
    manifestUrl,
    JSON_CONTENT_TYPES,
    { requestTimeoutMs },
  );

  let manifest;
  try {
    const manifestText = await readResponse(
      manifestResponse,
      'manifest',
      manifestUrl,
      () => manifestResponse.text(),
    );
    manifest = JSON.parse(manifestText);
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out after')) throw error;
    throw new Error(
      `PWA smoke check failed: the manifest at ${manifestUrl.href} did not contain valid JSON.`,
    );
  }
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.icons)) {
    throw new Error(
      `PWA smoke check failed: the manifest at ${manifestUrl.href} must contain an icons array.`,
    );
  }
  const installSettings = validateInstallManifest(manifest, manifestUrl);

  await verifyStartUrl(
    fetchImpl,
    installSettings.startUrl,
    installSettings.scopeUrl,
    manifestUrl,
    workerUrl,
    requestTimeoutMs,
  );

  const icon192 = iconForSize(manifest, '192x192');
  const icon512 = iconForSize(manifest, '512x512');
  const icon192Url = sameOriginUrl(icon192.src, manifestUrl, '192x192 icon');
  const icon512Url = sameOriginUrl(icon512.src, manifestUrl, '512x512 icon');

  await checkedGet(
    fetchImpl,
    'service worker',
    workerUrl,
    JAVASCRIPT_CONTENT_TYPES,
    { requestTimeoutMs },
  );
  await Promise.all([
    verifyPng(fetchImpl, '192x192 icon', icon192Url, requestTimeoutMs),
    verifyPng(fetchImpl, '512x512 icon', icon512Url, requestTimeoutMs),
  ]);

  return {
    pageUrl: pageUrl.href,
    origin: pageUrl.origin,
    webReleaseMarker: EXPECTED_DAILY007_WEB_RELEASE_MARKER,
    webBundleUrl,
    manifestUrl: manifestUrl.href,
    manifestId: installSettings.idUrl.href,
    startUrl: installSettings.startUrl.href,
    scope: installSettings.scopeUrl.href,
    display: manifest.display,
    serviceWorkerUrl: workerUrl.href,
    iconUrls: [icon192Url.href, icon512Url.href],
  };
}

function browserSmokeUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('PWA browser smoke check failed at published URL: provide a valid Daily007 URL (https://…).');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('PWA browser smoke check failed at published URL: the URL must use HTTP or HTTPS.');
  }
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('could not allocate a local Chromium debugging port');
  }
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

async function waitForBrowserEndpoint(url, browserProcess, output) {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null) {
      throw new Error(`Chromium exited with code ${browserProcess.exitCode}.${output()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Chromium DevTools did not become ready: ${lastError?.message || 'timed out'}.${output()}`);
}

function cdpConnection(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Set();
  let nextId = 0;
  let opened = false;

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out connecting to Chromium DevTools')), 10_000);
    socket.addEventListener('open', () => {
      opened = true;
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Chromium DevTools WebSocket failed'));
    }, { once: true });
  });

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    for (const listener of listeners) listener(message);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  return {
    ready,
    close() {
      if (opened) socket.close();
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }));
      });
    },
    async evaluate(expression) {
      const response = await this.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (response.exceptionDetails) {
        throw new Error(
          response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
        );
      }
      return response.result?.value;
    },
  };
}

async function waitForBrowserCondition(connection, expression, stage, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await connection.evaluate(expression)) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `${stage} did not complete within ${timeoutMs}ms${lastError ? `: ${lastError.message}` : '.'}`,
  );
}

function stageError(stage, cause) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(`PWA browser smoke check failed at ${stage}: ${detail}`, { cause });
}

async function checkedBrowserStage(stage, action) {
  try {
    return await action();
  } catch (error) {
    throw stageError(stage, error);
  }
}

/**
 * Launches a brand-new Chromium profile and verifies the published PWA's
 * service-worker control, app-shell cache, and offline navigation behavior.
 * This is deliberately separate from checkPublishedPwa's manifest/installability
 * validation.
 */
export async function checkPublishedPwaInBrowser(
  input,
  { chromiumPath = process.env.CHROMIUM_PATH || 'chromium' } = {},
) {
  const pageUrl = browserSmokeUrl(input);
  const debugPort = await getFreePort();
  const profilePath = await mkdtemp(path.join(os.tmpdir(), 'daily007-pwa-smoke-'));
  let browser;
  let connection;
  let browserOutput = '';
  let offlineNavigationUrl;
  let offlineDocumentResponse;

  const output = () => browserOutput.trim() ? `\nChromium output:\n${browserOutput.trim()}` : '';
  try {
    await checkedBrowserStage('fresh Chromium startup', async () => {
      browser = spawn(chromiumPath, [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-allow-origins=*',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profilePath}`,
        'about:blank',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      browser.stdout.on('data', (chunk) => { browserOutput += chunk.toString(); });
      browser.stderr.on('data', (chunk) => { browserOutput += chunk.toString(); });

      const versionResponse = await waitForBrowserEndpoint(
        `http://127.0.0.1:${debugPort}/json/version`,
        browser,
        output,
      );
      const version = await versionResponse.json();
      const targetsResponse = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (!targetsResponse.ok) {
        throw new Error(`Chromium page targets returned HTTP ${targetsResponse.status}`);
      }
      const targets = await targetsResponse.json();
      const pageTarget = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
        || (version.webSocketDebuggerUrl ? {
          webSocketDebuggerUrl: version.webSocketDebuggerUrl,
        } : null);
      if (!pageTarget?.webSocketDebuggerUrl) {
        throw new Error('Chromium did not expose a DevTools page target');
      }
      connection = cdpConnection(pageTarget.webSocketDebuggerUrl);
      await connection.ready;
      await connection.send('Page.enable');
      await connection.send('Runtime.enable');
      await connection.send('Network.enable');
      connection.onMessage((message) => {
        if (
          message.method === 'Network.responseReceived'
          && message.params.type === 'Document'
          && message.params.response.url === offlineNavigationUrl
        ) {
          offlineDocumentResponse = message.params.response;
        }
      });
    });

    await checkedBrowserStage(`published page load (${pageUrl.href})`, async () => {
      await connection.send('Page.navigate', { url: pageUrl.href });
      await waitForBrowserCondition(
        connection,
        'document.readyState === "complete" && location.href.startsWith(' +
          `${JSON.stringify(pageUrl.href)})`,
        'published page load',
      );
    });

    const worker = await checkedBrowserStage('service-worker activation and page control', async () => {
      await waitForBrowserCondition(
        connection,
        `(async () => {
          const registration = await navigator.serviceWorker.getRegistration(location.href);
          return registration?.active?.state === "activated" && Boolean(navigator.serviceWorker.controller);
        })()`,
        'service worker activation and page control',
      );
      return connection.evaluate(`(async () => {
        const registration = await navigator.serviceWorker.getRegistration(location.href);
        return {
          scope: registration.scope,
          scriptURL: registration.active.scriptURL,
          state: registration.active.state,
          controllerScriptURL: navigator.serviceWorker.controller?.scriptURL ?? null,
        };
      })()`);
    });

    const shell = await checkedBrowserStage('app-shell cache inventory', async () => {
      const data = await connection.evaluate(`(async () => {
        const link = document.querySelector('link[rel~="manifest"]');
        if (!link?.href) throw new Error("published page has no manifest link");
        const manifestUrl = new URL(link.href);
        if (manifestUrl.origin !== location.origin) throw new Error("manifest is not on the published page origin");
        const response = await fetch(manifestUrl);
        if (!response.ok) throw new Error("manifest fetch returned HTTP " + response.status);
        let manifest;
        try { manifest = await response.json(); }
        catch { throw new Error("manifest response is not valid JSON"); }
        if (!Array.isArray(manifest.icons)) throw new Error("manifest has no icons array");
        const iconForSize = (size) => {
          const icon = manifest.icons.find((item) =>
            typeof item?.sizes === "string" && item.sizes.trim().split(/\\s+/).includes(size));
          if (!icon?.src) throw new Error("manifest has no " + size + " icon reference");
          const url = new URL(icon.src, manifestUrl);
          if (url.origin !== location.origin) throw new Error(size + " icon is not on the published page origin");
          return { size, url: url.href };
        };
        const scope = new URL((await navigator.serviceWorker.getRegistration(location.href)).scope);
        return {
          scope: scope.href,
          resources: [
            { label: "app page", url: scope.href, contentType: "text/html" },
            { label: "manifest", url: manifestUrl.href, contentType: "application/json" },
            { label: "192x192 icon", ...iconForSize("192x192"), contentType: "image/png" },
            { label: "512x512 icon", ...iconForSize("512x512"), contentType: "image/png" },
          ],
          cacheNames: await caches.keys(),
        };
      })()`);
      if (!data?.resources || !data.cacheNames?.length) {
        throw new Error('service worker did not create an app-shell cache');
      }
      return data;
    });

    const cachedResources = [];
    for (const resource of shell.resources) {
      const cached = await checkedBrowserStage(`cached ${resource.label}`, async () => {
        const result = await connection.evaluate(`(async () => {
          const response = await caches.match(${JSON.stringify(resource.url)});
          if (!response) return { error: "no Cache Storage entry" };
          return {
            status: response.status,
            contentType: (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(),
          };
        })()`);
        if (result?.error) throw new Error(`${resource.url}: ${result.error}`);
        if (result?.status !== 200) {
          throw new Error(`${resource.url}: expected cached HTTP 200, received ${result?.status ?? 'no response'}`);
        }
        const allowedTypes = resource.label === 'manifest'
          ? ['application/json', 'application/manifest+json']
          : [resource.contentType];
        if (!allowedTypes.includes(result.contentType)) {
          throw new Error(
            `${resource.url}: expected cached ${allowedTypes.join(' or ')}, received ${result.contentType || 'no content type'}`,
          );
        }
        return { ...resource, status: result.status, actualContentType: result.contentType };
      });
      cachedResources.push(cached);
    }

    offlineNavigationUrl = new URL('__daily007_pwa_offline_smoke__', worker.scope).href;
    await checkedBrowserStage('offline navigation to cached shell', async () => {
      await connection.send('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
        connectionType: 'none',
      });
      const targets = await connection.send('Target.getTargets');
      const workerTarget = targets.targetInfos?.find((target) =>
        target.type === 'service_worker' && target.url.startsWith(worker.scriptURL),
      );
      if (!workerTarget) {
        throw new Error(`could not find the active service-worker target for ${worker.scriptURL}`);
      }
      const attached = await connection.send('Target.attachToTarget', {
        targetId: workerTarget.targetId,
        flatten: true,
      });
      if (!attached.sessionId) {
        throw new Error('Chromium did not provide a service-worker debugging session');
      }
      await connection.send('Network.enable', {}, attached.sessionId);
      await connection.send('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
        connectionType: 'none',
      }, attached.sessionId);
      await waitForBrowserCondition(
        connection,
        'navigator.onLine === false',
        'Chromium offline mode',
        5_000,
      );
      await connection.send('Page.navigate', { url: offlineNavigationUrl });
      await waitForBrowserCondition(
        connection,
        `document.readyState === "complete" && location.href === ${JSON.stringify(offlineNavigationUrl)} &&
          Boolean(document.documentElement && document.body)`,
        'offline nested-route document load',
      );
      if (!offlineDocumentResponse) {
        throw new Error('Chromium reported no document response for the offline navigation');
      }
      if (offlineDocumentResponse.status !== 200 || !offlineDocumentResponse.fromServiceWorker) {
        throw new Error(
          `expected an HTTP 200 document served by the service worker, received HTTP ${offlineDocumentResponse.status}` +
          `${offlineDocumentResponse.fromServiceWorker ? ' from the service worker' : ' without service-worker control'} ` +
          `(status text: ${offlineDocumentResponse.statusText || 'none'}, URL: ${offlineDocumentResponse.url})`,
        );
      }
    });

    return {
      pageUrl: pageUrl.href,
      scope: worker.scope,
      serviceWorkerUrl: worker.scriptURL,
      controllerScriptURL: worker.controllerScriptURL,
      cacheNames: shell.cacheNames,
      cachedResources,
      offlineNavigationUrl,
      offlineStatus: offlineDocumentResponse.status,
      offlineServedByServiceWorker: offlineDocumentResponse.fromServiceWorker,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PWA browser smoke check failed at ')) {
      throw error;
    }
    throw stageError('browser smoke run', error);
  } finally {
    connection?.close();
    if (browser && browser.exitCode === null) {
      browser.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => browser.once('exit', resolve)),
        delay(2_000),
      ]);
      if (browser.exitCode === null) browser.kill('SIGKILL');
    }
    await rm(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/**
 * Checks Chrome's desktop installability signal against the published page.
 * This does not reproduce Android Chrome's "Install app" menu.
 */
export async function checkPublishedPwaInstallability(
  input,
  { chromiumPath = process.env.CHROMIUM_PATH || 'chromium' } = {},
) {
  const pageUrl = browserSmokeUrl(input);
  const debugPort = await getFreePort();
  const profilePath = await mkdtemp(path.join(os.tmpdir(), 'daily007-pwa-installability-'));
  let browser;
  let connection;
  let browserVersion = '';
  let browserOutput = '';
  const output = () => browserOutput.trim() ? `\nChromium output:\n${browserOutput.trim()}` : '';

  try {
    await checkedBrowserStage('fresh Chromium startup', async () => {
      browser = spawn(chromiumPath, [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-allow-origins=*',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profilePath}`,
        'about:blank',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      browser.stdout.on('data', (chunk) => { browserOutput += chunk.toString(); });
      browser.stderr.on('data', (chunk) => { browserOutput += chunk.toString(); });

      const versionResponse = await waitForBrowserEndpoint(
        `http://127.0.0.1:${debugPort}/json/version`,
        browser,
        output,
      );
      const version = await versionResponse.json();
      browserVersion = version.Browser || 'unknown Chromium version';
      const targetsResponse = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (!targetsResponse.ok) {
        throw new Error(`Chromium page targets returned HTTP ${targetsResponse.status}`);
      }
      const targets = await targetsResponse.json();
      const pageTarget = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (!pageTarget?.webSocketDebuggerUrl) {
        throw new Error('Chromium did not expose a DevTools page target');
      }

      connection = cdpConnection(pageTarget.webSocketDebuggerUrl);
      await connection.ready;
      await connection.send('Page.enable');
      await connection.send('Runtime.enable');
      await connection.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__daily007Installability = { beforeInstallPromptFired: false };
          window.addEventListener("beforeinstallprompt", () => {
            window.__daily007Installability.beforeInstallPromptFired = true;
          });`,
      });
    });

    await checkedBrowserStage(`published page load (${pageUrl.href})`, async () => {
      const navigation = await connection.send('Page.navigate', { url: pageUrl.href });
      if (navigation.errorText) throw new Error(navigation.errorText);
      await waitForBrowserCondition(
        connection,
        `document.readyState === "complete" && location.href.startsWith(${JSON.stringify(pageUrl.href)})`,
        'published page load',
      );
    });

    const appManifest = await checkedBrowserStage('Chrome manifest inspection', async () => {
      const result = await connection.send('Page.getAppManifest');
      if (!result.url || !result.manifest) {
        throw new Error('Chrome did not return a parsed web app manifest for the published page');
      }
      return result;
    });
    const manifestErrors = Array.isArray(appManifest.errors) ? appManifest.errors : [];

    const installability = await checkedBrowserStage('Chrome installability criteria', async () => {
      const result = await connection.send('Page.getInstallabilityErrors');
      if (!Array.isArray(result.installabilityErrors)) {
        throw new Error('Chrome did not return its installability criteria results');
      }
      return result;
    });
    const installabilityErrors = installability.installabilityErrors;

    if (manifestErrors.length || installabilityErrors.length) {
      throw new Error(
        `Chrome reported manifest errors: ${JSON.stringify(manifestErrors)}; ` +
        `installability errors: ${JSON.stringify(installabilityErrors)}.`,
      );
    }

    try {
      await waitForBrowserCondition(
        connection,
        'window.__daily007Installability?.beforeInstallPromptFired === true',
        'Chrome beforeinstallprompt event',
        15_000,
      );
    } catch (cause) {
      throw new Error(
        `Chrome did not fire beforeinstallprompt for ${pageUrl.href}. ` +
        `Manifest errors: ${JSON.stringify(manifestErrors)}; ` +
        `installability errors: ${JSON.stringify(installabilityErrors)}.`,
        { cause },
      );
    }

    return {
      pageUrl: pageUrl.href,
      browserVersion,
      manifestUrl: appManifest.url,
      manifestErrors,
      installabilityErrors,
      beforeInstallPromptFired: true,
      androidInstallMenuVerified: false,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PWA browser smoke check failed at ')) {
      throw error;
    }
    throw stageError('Chrome installability check', error);
  } finally {
    connection?.close();
    if (browser && browser.exitCode === null) {
      browser.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => browser.once('exit', resolve)),
        delay(2_000),
      ]);
      if (browser.exitCode === null) browser.kill('SIGKILL');
    }
    await rm(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function isCliEntry() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCliEntry()) {
  const args = process.argv.slice(2).filter((argument) => argument !== '--');
  const browserMode = args.includes('--browser');
  const installabilityMode = args.includes('--installability');
  const input = args.find((argument) => argument !== '--browser' && argument !== '--installability')
    || process.env.DAILY007_PUBLISHED_URL;
  if (browserMode && installabilityMode) {
    console.error('Choose either --browser or --installability, not both.');
    process.exitCode = 2;
  } else if (!input) {
    console.error(
      `Usage: pnpm --filter @workspace/daily007 run test:pwa:published${browserMode ? ':browser' : installabilityMode ? ':installability' : ''} -- <published-url>\n` +
      'Or set DAILY007_PUBLISHED_URL to the published Daily007 URL.',
    );
    process.exitCode = 2;
  } else {
    try {
      const result = browserMode
        ? await checkPublishedPwaInBrowser(input)
        : installabilityMode
          ? await checkPublishedPwaInstallability(input)
          : await checkPublishedPwa(input);
      if (browserMode) {
        console.log('PASS: Daily007 published PWA worker control, app-shell cache, and offline navigation verified.');
        console.log(`Page: ${result.pageUrl}`);
        console.log(`Origin: ${new URL(result.pageUrl).origin}`);
        console.log(`Scope: ${result.scope}`);
        console.log(`Service worker: ${result.serviceWorkerUrl} (activated and controlling)`);
        for (const resource of result.cachedResources) {
          console.log(`Cached ${resource.label}: ${resource.url}`);
        }
        console.log(
          `Offline navigation: ${result.offlineNavigationUrl} (HTTP ${result.offlineStatus}, service worker)`,
        );
      } else if (installabilityMode) {
        console.log('PASS: Desktop Chromium reports Daily007 as installable.');
        console.log(`Page: ${result.pageUrl}`);
        console.log(`Browser: ${result.browserVersion}`);
        console.log(`Manifest: ${result.manifestUrl}`);
        console.log('Manifest errors: none');
        console.log('Installability errors: none');
        console.log('beforeinstallprompt: fired');
        console.log('Android Chrome "Install app" menu: not verified; that UI requires a real Android device.');
      } else {
        console.log('PASS: Daily007 published PWA files are available.');
        console.log(`Page: ${result.pageUrl}`);
        console.log(`Origin: ${result.origin}`);
        console.log(`Web release: ${result.webReleaseMarker}`);
        console.log(`Web bundle: ${result.webBundleUrl}`);
        console.log(`Manifest: ${result.manifestUrl}`);
        console.log(`Service worker: ${result.serviceWorkerUrl}`);
        for (const icon of result.iconUrls) console.log(`Icon: ${icon}`);
      }
    } catch (cause) {
      console.error(cause instanceof Error ? cause.message : String(cause));
      process.exitCode = 1;
    }
  }
}
