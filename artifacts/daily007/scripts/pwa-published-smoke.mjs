import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HTML_CONTENT_TYPES = ['text/html'];
const JSON_CONTENT_TYPES = ['application/json', 'application/manifest+json'];
const JAVASCRIPT_CONTENT_TYPES = [
  'application/javascript',
  'text/javascript',
  'application/x-javascript',
];

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

async function checkedGet(fetchImpl, label, url, acceptedContentTypes) {
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', redirect: 'follow' });
  } catch (cause) {
    throw new Error(
      `PWA smoke check failed: could not fetch ${label} at ${url.href}: ${cause instanceof Error ? cause.message : String(cause)}.`,
    );
  }

  const actualType = mimeType(response);
  if (response.status !== 200 || !acceptedContentTypes.includes(actualType)) {
    const expectedTypes = acceptedContentTypes.join(' or ');
    throw new Error(
      `PWA smoke check failed: ${label} at ${url.href} returned HTTP ${response.status} with ${actualType || 'no content type'}; expected HTTP 200 and ${expectedTypes}. Check that the published Daily007 web build serves this file at the referenced path.`,
    );
  }
  return response;
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

async function verifyPng(fetchImpl, label, url) {
  const response = await checkedGet(fetchImpl, label, url, ['image/png']);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((byte, index) => bytes[index] !== byte)) {
    throw new Error(
      `PWA smoke check failed: ${label} at ${url.href} is not a valid PNG file. Rebuild or restore the published Daily007 icon asset.`,
    );
  }
}

export async function checkPublishedPwa(input, fetchImpl = fetch) {
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

  const pageResponse = await checkedGet(fetchImpl, 'published page', baseUrl, HTML_CONTENT_TYPES);
  const pageHtml = await pageResponse.text();
  const pageUrl = new URL(pageResponse.url || baseUrl.href);

  const manifestUrl = sameOriginUrl(manifestReference(pageHtml), pageUrl, 'manifest');
  const workerUrl = sameOriginUrl(serviceWorkerReference(pageHtml), pageUrl, 'service-worker');
  const manifestResponse = await checkedGet(fetchImpl, 'manifest', manifestUrl, JSON_CONTENT_TYPES);

  let manifest;
  try {
    manifest = await manifestResponse.json();
  } catch {
    throw new Error(
      `PWA smoke check failed: the manifest at ${manifestUrl.href} did not contain valid JSON.`,
    );
  }
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.icons)) {
    throw new Error(
      `PWA smoke check failed: the manifest at ${manifestUrl.href} must contain an icons array.`,
    );
  }

  const icon192 = iconForSize(manifest, '192x192');
  const icon512 = iconForSize(manifest, '512x512');
  const icon192Url = sameOriginUrl(icon192.src, manifestUrl, '192x192 icon');
  const icon512Url = sameOriginUrl(icon512.src, manifestUrl, '512x512 icon');

  await checkedGet(fetchImpl, 'service worker', workerUrl, JAVASCRIPT_CONTENT_TYPES);
  await Promise.all([
    verifyPng(fetchImpl, '192x192 icon', icon192Url),
    verifyPng(fetchImpl, '512x512 icon', icon512Url),
  ]);

  return {
    pageUrl: pageUrl.href,
    manifestUrl: manifestUrl.href,
    serviceWorkerUrl: workerUrl.href,
    iconUrls: [icon192Url.href, icon512Url.href],
  };
}

function isCliEntry() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCliEntry()) {
  const input = process.argv.slice(2).find((argument) => argument !== '--')
    || process.env.DAILY007_PUBLISHED_URL;
  if (!input) {
    console.error(
      'Usage: pnpm --filter @workspace/daily007 run test:pwa:published -- <published-url>\n' +
      'Or set DAILY007_PUBLISHED_URL to the published Daily007 URL.',
    );
    process.exitCode = 2;
  } else {
    try {
      const result = await checkPublishedPwa(input);
      console.log('PASS: Daily007 published PWA files are available.');
      console.log(`Page: ${result.pageUrl}`);
      console.log(`Manifest: ${result.manifestUrl}`);
      console.log(`Service worker: ${result.serviceWorkerUrl}`);
      for (const icon of result.iconUrls) console.log(`Icon: ${icon}`);
    } catch (cause) {
      console.error(cause instanceof Error ? cause.message : String(cause));
      process.exitCode = 1;
    }
  }
}
