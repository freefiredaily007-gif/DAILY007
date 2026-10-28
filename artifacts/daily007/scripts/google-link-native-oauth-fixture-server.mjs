import { createServer } from "node:http";

const port = Number(process.env.GOOGLE_LINK_OAUTH_FIXTURE_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Set GOOGLE_LINK_OAUTH_FIXTURE_PORT to a valid port.");
  process.exit(2);
}

const callbackToken = "native-google-link-callback-test-token";
const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (requestUrl.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain" }).end("ready");
    return;
  }
  if (requestUrl.pathname !== "/auth") {
    response.writeHead(404).end("Not found");
    return;
  }

  const redirectUri = requestUrl.searchParams.get("redirect_uri");
  if (!redirectUri || !/^(?:exp|daily007):\/\//.test(redirectUri)) {
    response.writeHead(400, { "content-type": "text/plain" }).end("Invalid redirect URI");
    return;
  }

  const callback = new URL(redirectUri);
  callback.searchParams.set("native_google_link_token", callbackToken);
  const safeCallback = JSON.stringify(callback.toString()).replace(/</g, "\\u003c");
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  }).end(`<!doctype html>
<html lang="en">
<head><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daily007 test Google sign-in</title>
<style>
  body { font: 18px sans-serif; margin: 24px; color: #182033; }
  a { display: inline-block; font: inherit; font-weight: 700; padding: 16px 20px; border: 1px solid #667085; border-radius: 8px; color: inherit; text-decoration: none; }
</style></head>
<body>
  <h1>Test Google sign-in</h1>
  <p>This local test page returns to Daily007 without contacting Google.</p>
  <a href=${safeCallback}>Continue with test Google</a>
</body>
</html>`);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Native Google-link OAuth fixture listening on port ${port}.`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
