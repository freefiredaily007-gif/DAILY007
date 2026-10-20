import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import {
  checkPublishedPwa,
  checkPublishedPwaInBrowser,
  EXPECTED_DAILY007_PWA_ID,
} from './pwa-published-smoke.mjs';

const require = createRequire(import.meta.url);
const { injectPwaHead } = require('./pwa-html.js');
const manifest = JSON.parse(
  await readFile(join(import.meta.dirname, '../public/manifest.json'), 'utf8'),
);
const serviceWorkerSource = await readFile(join(import.meta.dirname, '../public/sw.js'), 'utf8');
const icon192 = await readFile(join(import.meta.dirname, '../public/icons/icon-192.png'));
const icon512 = await readFile(join(import.meta.dirname, '../public/icons/icon-512.png'));
const html = '<!doctype html><html><head><title>Daily007</title></head><body></body></html>';

test('keeps the source manifest on the protected Daily007 app identity', () => {
  assert.equal(manifest.id, EXPECTED_DAILY007_PWA_ID);
});

async function withPublishedPwaFixture(
  {
    missingPath,
    wrongContentTypePath,
    manifestOverrides = {},
    redirects = {},
    appPagePaths = ['/daily007/'],
    appPageContents = {},
  } = {},
  run,
) {
  const fixtureManifest = { ...manifest, ...manifestOverrides };
  const page = injectPwaHead(html, fixtureManifest, '/daily007/');
  const requests = [];
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    requests.push({ method: request.method, pathname });
    if (pathname === missingPath) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    if (Object.hasOwn(redirects, pathname)) {
      response.writeHead(302, { location: redirects[pathname] });
      response.end();
      return;
    }

    if (appPagePaths.includes(pathname)) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(appPageContents[pathname] ?? page);
      return;
    }
    if (pathname === '/daily007/manifest.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(fixtureManifest));
      return;
    }
    if (pathname === '/daily007/sw.js') {
      response.writeHead(200, {
        'content-type': pathname === wrongContentTypePath
          ? 'text/html; charset=utf-8'
          : 'application/javascript; charset=utf-8',
      });
      response.end(serviceWorkerSource);
      return;
    }
    if (pathname === '/daily007/icons/icon-192.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(icon192);
      return;
    }
    if (pathname === '/daily007/icons/icon-512.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(icon512);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run(`http://127.0.0.1:${address.port}/daily007/`, { requests });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('adds PWA metadata and service worker registration inside the generated head', () => {
  const result = injectPwaHead(html, manifest);
  const headClose = result.indexOf('</head>');

  assert.ok(result.indexOf('rel="manifest"') < headClose);
  assert.match(result, /href="\/manifest\.json"/);
  assert.match(result, /name="theme-color" content="#070a12"/);
  assert.match(result, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(result, /serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.match(result, /href="\/icons\/icon-192\.png"/);
});

test('respects an app base path and is safe to apply more than once', () => {
  const once = injectPwaHead(html, manifest, '/daily007/');
  const twice = injectPwaHead(once, manifest, '/daily007/');

  assert.equal(twice.match(/rel="manifest"/g)?.length, 1);
  assert.match(twice, /href="\/daily007\/manifest\.json"/);
  assert.match(twice, /serviceWorker\.register\("\/daily007\/sw\.js", \{ scope: "\/daily007\/" \}\)/);
});

test('rejects malformed exported HTML and invalid PWA theme colors', () => {
  assert.throws(() => injectPwaHead('<html><body></body></html>', manifest), /no closing <\/head>/);
  assert.throws(
    () => injectPwaHead(html, { ...manifest, theme_color: 'dark' }),
    /six-digit hex color/,
  );
});

test('checks the published page references, manifest, service worker, and both icons', async () => {
  await withPublishedPwaFixture({}, async (url) => {
    const result = await checkPublishedPwa(url);
    const fixtureOrigin = new URL(result.manifestUrl).origin;
    assert.match(result.manifestUrl, /\/daily007\/manifest\.json$/);
    assert.equal(result.manifestId, `${fixtureOrigin}/daily007/`);
    assert.equal(result.startUrl, `${fixtureOrigin}/daily007/`);
    assert.equal(result.scope, `${fixtureOrigin}/daily007/`);
    assert.equal(result.display, 'standalone');
    assert.match(result.serviceWorkerUrl, /\/daily007\/sw\.js$/);
    assert.equal(result.iconUrls.length, 2);
    assert.ok(result.iconUrls.some((iconUrl) => iconUrl.endsWith('/icon-192.png')));
    assert.ok(result.iconUrls.some((iconUrl) => iconUrl.endsWith('/icon-512.png')));
  });
});

test('fetches the resolved manifest start_url and accepts an in-scope redirect', async () => {
  const launchPath = '/daily007/launch/';
  await withPublishedPwaFixture({
    manifestOverrides: { start_url: './launch/' },
    redirects: { [launchPath]: '/daily007/' },
  }, async (url, { requests }) => {
    const result = await checkPublishedPwa(url);
    assert.equal(result.startUrl, `${new URL(url).origin}${launchPath}`);
    assert.ok(
      requests.some((request) => request.pathname === launchPath),
      'the resolved start_url should be requested',
    );
    assert.ok(
      requests.some((request) => request.pathname === '/daily007/'),
      'the in-scope redirect destination should be requested',
    );
  });
});

test('rejects an unreachable published start_url with a field-specific error', async () => {
  const launchPath = '/daily007/unreachable-launch/';
  await withPublishedPwaFixture({
    manifestOverrides: { start_url: './unreachable-launch/' },
  }, async (url) => {
    const fetchWithUnreachableLaunch = (input, options) => {
      if (new URL(input).pathname === launchPath) {
        throw new TypeError('connect ECONNREFUSED');
      }
      return fetch(input, options);
    };
    await assert.rejects(
      checkPublishedPwa(url, fetchWithUnreachableLaunch),
      /PWA smoke check failed: could not fetch manifest field "start_url".*connect ECONNREFUSED/,
    );
  });
});

test('rejects a published start_url that returns an HTTP error', async () => {
  const launchPath = '/daily007/missing-launch/';
  await withPublishedPwaFixture({
    manifestOverrides: { start_url: './missing-launch/' },
    missingPath: launchPath,
  }, async (url) => {
    await assert.rejects(
      checkPublishedPwa(url),
      /PWA smoke check failed: manifest field "start_url" .* returned HTTP 404/,
    );
  });
});

test('rejects an in-scope HTML page that is not the Daily007 app', async () => {
  const launchPath = '/daily007/not-the-app/';
  await withPublishedPwaFixture({
    manifestOverrides: { start_url: './not-the-app/' },
    appPagePaths: ['/daily007/', launchPath],
    appPageContents: {
      [launchPath]: '<!doctype html><html><head><title>Not found</title></head><body>Error</body></html>',
    },
  }, async (url) => {
    await assert.rejects(
      checkPublishedPwa(url),
      /manifest field "start_url".*did not return the Daily007 app page/,
    );
  });
});

test('rejects start_url redirects outside the published origin or manifest scope', async (t) => {
  const launchPath = '/daily007/launch-redirect/';
  const cases = [
    {
      name: 'scope',
      destination: '/outside-daily007/',
      message: /manifest field "start_url" redirects outside manifest field "scope"/,
    },
    {
      name: 'origin',
      destination: 'https://outside.example/launch/',
      message: /manifest field "start_url" redirects outside the published app origin/,
    },
  ];

  for (const { name, destination, message } of cases) {
    await t.test(`rejects a redirect outside the app ${name}`, async () => {
      await withPublishedPwaFixture({
        manifestOverrides: { start_url: './launch-redirect/' },
        redirects: { [launchPath]: destination },
      }, async (url, { requests }) => {
        await assert.rejects(checkPublishedPwa(url), message);
        assert.equal(
          requests.some((request) => request.pathname === '/outside-daily007/'),
          false,
          'the checker should reject the redirect before requesting an out-of-scope destination',
        );
      });
    });
  }
});

test('published browser check confirms a clean worker install, app-shell cache, and offline shell navigation', async () => {
  await withPublishedPwaFixture({}, async (url) => {
    const result = await checkPublishedPwaInBrowser(url);
    assert.equal(result.pageUrl, `${new URL(url).origin}/daily007/`);
    assert.equal(result.scope, `${new URL(url).origin}/daily007/`);
    assert.equal(result.offlineStatus, 200);
    assert.equal(result.offlineServedByServiceWorker, true);
    assert.deepEqual(
      result.cachedResources.map((resource) => resource.label),
      ['app page', 'manifest', '192x192 icon', '512x512 icon'],
    );
    assert.ok(result.cacheNames.length > 0);
  });
}, { timeout: 90_000 });

test('rejects valid JSON with missing or invalid install-critical manifest fields', async (t) => {
  const cases = [
    {
      field: 'name',
      manifestOverrides: { name: undefined },
      message: /manifest field "name" must be a non-empty string/,
    },
    {
      field: 'short_name',
      manifestOverrides: { short_name: '   ' },
      message: /manifest field "short_name" must be a non-empty string/,
    },
    {
      field: 'id',
      manifestOverrides: { id: undefined },
      message: /manifest field "id" must be a non-empty string/,
    },
    {
      field: 'id',
      manifestOverrides: { id: 'https://other.example/daily007/' },
      message: /manifest field "id" reference must use the published page's origin/,
    },
    {
      field: 'id',
      manifestOverrides: { id: './different-app/' },
      message: /Daily007 app identity mismatch.*Expected manifest field "id".*but it resolves to.*For an intentional identity change/,
    },
    {
      field: 'start_url',
      manifestOverrides: { start_url: undefined },
      message: /manifest field "start_url" must be a non-empty string/,
    },
    {
      field: 'start_url',
      manifestOverrides: { start_url: 'https://other.example/app/' },
      message: /manifest field "start_url" reference must use the published page's origin/,
    },
    {
      field: 'scope',
      manifestOverrides: { scope: undefined },
      message: /manifest field "scope" must be a non-empty string/,
    },
    {
      field: 'scope',
      manifestOverrides: { scope: './restricted/' },
      message: /manifest field "start_url" must resolve within manifest field "scope"/,
    },
    {
      field: 'display',
      manifestOverrides: { display: undefined },
      message: /manifest field "display" must be a non-empty string/,
    },
    {
      field: 'display',
      manifestOverrides: { display: 'browser' },
      message: /manifest field "display" must be "fullscreen", "minimal-ui", or "standalone"/,
    },
  ];

  for (const { field, manifestOverrides, message } of cases) {
    await t.test(`identifies an invalid ${field} field`, async () => {
      await withPublishedPwaFixture({ manifestOverrides }, async (url) => {
        await assert.rejects(checkPublishedPwa(url), message);
      });
    });
  }
});

test('reports a missing published PWA file with its URL and expected response', async () => {
  await withPublishedPwaFixture({ missingPath: '/daily007/sw.js' }, async (url) => {
    await assert.rejects(
      checkPublishedPwa(url),
      /PWA smoke check failed: service worker .* returned HTTP 404 .* expected HTTP 200 and application\/javascript or text\/javascript or application\/x-javascript/,
    );
  });
});

test('rejects a PWA file that returns HTTP 200 with the wrong content type', async () => {
  await withPublishedPwaFixture({ wrongContentTypePath: '/daily007/sw.js' }, async (url) => {
    await assert.rejects(
      checkPublishedPwa(url),
      /PWA smoke check failed: service worker .* returned HTTP 200 with text\/html; expected HTTP 200 and application\/javascript or text\/javascript or application\/x-javascript/,
    );
  });
});
