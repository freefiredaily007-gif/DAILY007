const PWA_BLOCK_START = '<!-- Daily007 PWA support start -->';
const PWA_BLOCK_END = '<!-- Daily007 PWA support end -->';

function escapeAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function normalizeAppRoot(basePath) {
  const segments = String(basePath || '/')
    .split('/')
    .filter(Boolean);
  return `/${segments.join('/')}${segments.length ? '/' : ''}`;
}

function injectPwaHead(html, manifest, basePath = '/') {
  if (typeof html !== 'string') {
    throw new TypeError('Expected the exported web HTML as a string.');
  }
  if (typeof manifest?.theme_color !== 'string') {
    throw new TypeError('The PWA manifest must provide a theme_color.');
  }
  if (typeof manifest?.short_name !== 'string') {
    throw new TypeError('The PWA manifest must provide a short_name.');
  }
  if (!/^#[\da-f]{6}$/i.test(manifest.theme_color)) {
    throw new TypeError('The PWA theme_color must be a six-digit hex color.');
  }

  const appRoot = normalizeAppRoot(basePath);
  const escapedRoot = escapeAttribute(appRoot);
  const escapedThemeColor = escapeAttribute(manifest.theme_color);
  const escapedName = escapeAttribute(manifest.short_name);
  const registerScript = [
    'if ("serviceWorker" in navigator) {',
    '  window.addEventListener("load", function () {',
    `    navigator.serviceWorker.register(${JSON.stringify(`${appRoot}sw.js`)}, { scope: ${JSON.stringify(appRoot)} })`,
    '      .catch(function (error) {',
    '        console.error("Daily007 service worker registration failed", error);',
    '      });',
    '  });',
    '}',
  ].join('\n');
  const block = [
    PWA_BLOCK_START,
    `<meta name="theme-color" content="${escapedThemeColor}" />`,
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    `<meta name="apple-mobile-web-app-title" content="${escapedName}" />`,
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    `<link rel="manifest" href="${escapedRoot}manifest.json" />`,
    `<link rel="icon" type="image/png" sizes="192x192" href="${escapedRoot}icons/icon-192.png" />`,
    `<link rel="apple-touch-icon" href="${escapedRoot}icons/icon-192.png" />`,
    `<script>\n${registerScript}\n</script>`,
    PWA_BLOCK_END,
  ].join('\n');

  const withoutPreviousPwaBlock = html.replace(
    /<!-- Daily007 PWA support start -->[\s\S]*?<!-- Daily007 PWA support end -->/g,
    '',
  );
  const headClose = /<\/head\s*>/i.exec(withoutPreviousPwaBlock);
  if (!headClose || headClose.index === undefined) {
    throw new Error('The exported Daily007 web HTML has no closing </head> tag.');
  }

  return (
    withoutPreviousPwaBlock.slice(0, headClose.index) +
    `${block}\n` +
    withoutPreviousPwaBlock.slice(headClose.index)
  );
}

module.exports = { injectPwaHead };
