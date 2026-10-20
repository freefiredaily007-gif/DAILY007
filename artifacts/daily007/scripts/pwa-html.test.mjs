import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { checkPublishedPwa } from './pwa-published-smoke.mjs';

const require = createRequire(import.meta.url);
const { injectPwaHead } = require('./pwa-html.js');
const manifest = JSON.parse(
  await readFile(join(import.meta.dirname, '../public/manifest.json'), 'utf8'),
);
const html = '<!doctype html><html><head><title>Daily007</title></head><body></body></html>';

async function withPublishedPwaFixture({ missingPath, wrongContentTypePath } = {}, run) {
  const page = injectPwaHead(html, manifest, '/daily007/');
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === missingPath) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    if (pathname === '/daily007/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(page);
      return;
    }
    if (pathname === '/daily007/manifest.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(manifest));
      return;
    }
    if (pathname === '/daily007/sw.js') {
      response.writeHead(200, {
        'content-type': pathname === wrongContentTypePath
          ? 'text/html; charset=utf-8'
          : 'application/javascript; charset=utf-8',
      });
      response.end('self.addEventListener("install", () => {});');
      return;
    }
    if (pathname === '/daily007/icons/icon-192.png' || pathname === '/daily007/icons/icon-512.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
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
    await run(`http://127.0.0.1:${address.port}/daily007/`);
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
    assert.match(result.manifestUrl, /\/daily007\/manifest\.json$/);
    assert.match(result.serviceWorkerUrl, /\/daily007\/sw\.js$/);
    assert.equal(result.iconUrls.length, 2);
    assert.ok(result.iconUrls.some((iconUrl) => iconUrl.endsWith('/icon-192.png')));
    assert.ok(result.iconUrls.some((iconUrl) => iconUrl.endsWith('/icon-512.png')));
  });
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
