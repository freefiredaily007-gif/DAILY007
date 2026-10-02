/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with these routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → Daily007 browser app
 * - GET /install → Expo Go install/launch instructions
 * - Native bundles/manifests → static files from ./static-build/
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const STATIC_ROOT = path.resolve(__dirname, '..', 'static-build');
const WEB_STATIC_ROOT = path.join(STATIC_ROOT, 'web');
const TEMPLATE_PATH = path.resolve(__dirname, 'templates', 'landing-page.html');
const basePath = (process.env.BASE_PATH || '/').replace(/\/+$/, '');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json',
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, '..', 'app.json');
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
    return typeof appJson.expo?.name === 'string'
      ? appJson.expo.name
      : 'App Landing Page';
  } catch {
    return 'App Landing Page';
  }
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toScriptString(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function serveManifest(platform, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, 'utf-8');
  res.writeHead(200, {
    'content-type': 'application/json',
    'cache-control': 'no-cache',
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
  });
  res.end(manifest);
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = forwardedProto || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `exps://${host}${basePath}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_ATTRIBUTE_PLACEHOLDER/g, escapeHtml(expsUrl))
    .replace(/EXPS_URL_JSON_PLACEHOLDER/g, toScriptString(expsUrl))
    .replace(/APP_NAME_PLACEHOLDER/g, escapeHtml(appName));

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function resolveStaticPath(root, urlPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  const rootPath = path.resolve(root);
  const relativePath = decodedPath.replace(/^[/\\]+/, '');
  const filePath = path.resolve(rootPath, relativePath);
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${path.sep}`)) {
    return null;
  }
  return filePath;
}

function sendFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  const isHashedAsset = /[.-][a-f0-9]{8,}[.-]/i.test(filename);
  const isVersionedNativeAsset = /[/\\]\d+-\d+[/\\]_expo[/\\]/.test(filePath);
  const cacheControl =
    ext === '.html' || ext === '.json' || (!isHashedAsset && !isVersionedNativeAsset)
      ? 'no-cache'
      : 'public, max-age=31536000, immutable';
  res.writeHead(200, {
    'content-type': contentType,
    'cache-control': cacheControl,
  });
  res.end(content);
}

function serveStaticFile(urlPath, res, root = STATIC_ROOT) {
  const filePath = resolveStaticPath(root, urlPath);

  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  sendFile(filePath, res);
}

function serveWebApp(urlPath, res) {
  const entryPath = path.join(WEB_STATIC_ROOT, 'index.html');
  if (!fs.existsSync(entryPath)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Daily007 web build is missing. Rebuild the app before serving it.');
    return;
  }

  const requestedPath = urlPath === '/' ? '/index.html' : urlPath;
  const requestedFile = resolveStaticPath(WEB_STATIC_ROOT, requestedPath);
  if (!requestedFile) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(requestedFile) && fs.statSync(requestedFile).isFile()) {
    sendFile(requestedFile, res);
    return;
  }

  if (path.extname(urlPath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  sendFile(entryPath, res);
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
const appName = getAppName();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
    pathname = pathname.slice(basePath.length) || '/';
  }

  if (pathname === '/' || pathname === '/manifest') {
    const platform = req.headers['expo-platform'];
    if (platform === 'ios' || platform === 'android') {
      return serveManifest(platform, res);
    }

    if (pathname === '/manifest') {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
  }

  if (pathname === '/install') {
    return serveLandingPage(req, res, landingPageTemplate, appName);
  }

  if (
    /^\/(?:ios|android)(?:\/|$)/.test(pathname) ||
    /^\/\d+-\d+\/_expo\//.test(pathname)
  ) {
    return serveStaticFile(pathname, res);
  }

  serveWebApp(pathname, res);
});

const port = parseInt(process.env.PORT || '3000', 10);
server.listen(port, '0.0.0.0', () => {
  console.log(`Serving Daily007 web app, Expo manifests, and native assets on port ${port}`);
});
