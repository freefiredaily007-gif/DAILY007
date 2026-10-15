import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { injectPwaHead } = require('./pwa-html.js');
const manifest = JSON.parse(
  await readFile(join(import.meta.dirname, '../public/manifest.json'), 'utf8'),
);
const html = '<!doctype html><html><head><title>Daily007</title></head><body></body></html>';

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
