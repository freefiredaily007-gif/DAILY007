import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const workerSource = await readFile(
  join(import.meta.dirname, '../public/sw.js'),
  'utf8',
);

class MockResponse {
  constructor(body, { status = 200, type = 'basic' } = {}) {
    this.body = body;
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.type = type;
  }

  clone() {
    return new MockResponse(this.body, {
      status: this.status,
      type: this.type,
    });
  }

  async text() {
    return this.body;
  }

  static error() {
    return new MockResponse('', { status: 0, type: 'error' });
  }
}

function createServiceWorkerHarness() {
  const registrations = new Map();
  const cacheStorage = new Map();
  let online = true;
  let shellVersion = 'release-1';
  let skipWaitingCalled = false;
  let clientsClaimed = false;

  const origin = 'https://daily007.example';
  const scope = `${origin}/`;
  const registration = { scope };

  const normalizeRequest = (request) =>
    typeof request === 'string' ? request : request.url;

  const cacheFor = (name) => {
    if (!cacheStorage.has(name)) {
      const entries = new Map();
      cacheStorage.set(name, {
        async addAll(urls) {
          for (const url of urls) {
            const response = await networkFetch({
              url: new URL(url, origin).href,
              method: 'GET',
            });
            if (!response.ok) throw new Error(`Failed to cache ${url}`);
            entries.set(new URL(url, origin).href, response.clone());
          }
        },
        async match(request) {
          const response = entries.get(normalizeRequest(request));
          return response?.clone();
        },
        async put(request, response) {
          entries.set(normalizeRequest(request), response.clone());
        },
      });
    }
    return cacheStorage.get(name);
  };

  const caches = {
    async open(name) {
      return cacheFor(name);
    },
    async keys() {
      return [...cacheStorage.keys()];
    },
    async delete(name) {
      return cacheStorage.delete(name);
    },
    async match(request) {
      for (const cache of cacheStorage.values()) {
        const response = await cache.match(request);
        if (response) return response;
      }
      return undefined;
    },
  };

  const self = {
    location: new URL(origin),
    registration,
    clients: {
      async claim() {
        clientsClaimed = true;
      },
    },
    addEventListener(name, callback) {
      registrations.set(name, callback);
    },
    async skipWaiting() {
      skipWaitingCalled = true;
    },
  };

  async function networkFetch(request) {
    if (!online) throw new Error('Network unavailable');

    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new MockResponse(`<main>${shellVersion}</main>`);
    }
    if (url.pathname.endsWith('/manifest.json')) {
      return new MockResponse('{"name":"Daily007"}');
    }
    if (url.pathname.includes('/icons/')) {
      return new MockResponse('icon');
    }
    return new MockResponse('asset');
  }

  vm.runInNewContext(workerSource, {
    self,
    caches,
    fetch: networkFetch,
    URL,
    Response: MockResponse,
  });

  async function dispatchLifecycle(eventName) {
    let work;
    registrations.get(eventName)({
      waitUntil(promise) {
        work = promise;
      },
    });
    await work;
  }

  async function dispatchNavigation(pathname = '/') {
    let responsePromise;
    const request = {
      url: new URL(pathname, origin).href,
      method: 'GET',
      mode: 'navigate',
    };
    registrations.get('fetch')({
      request,
      respondWith(promise) {
        responsePromise = promise;
      },
    });
    return responsePromise;
  }

  return {
    cacheStorage,
    dispatchLifecycle,
    dispatchNavigation,
    setOffline() {
      online = false;
    },
    setShellVersion(version) {
      shellVersion = version;
    },
    get lifecycleState() {
      return { skipWaitingCalled, clientsClaimed };
    },
  };
}

test('an installed worker refreshes the existing app shell and serves that release offline', async () => {
  const harness = createServiceWorkerHarness();
  await harness.dispatchLifecycle('install');
  await harness.dispatchLifecycle('activate');

  assert.deepEqual(harness.lifecycleState, {
    skipWaitingCalled: true,
    clientsClaimed: true,
  });
  assert.equal(harness.cacheStorage.size, 1);

  const firstNavigation = await harness.dispatchNavigation('/');
  assert.equal(await firstNavigation.text(), '<main>release-1</main>');

  // Publishing updates the response served at the same app URL. The browser
  // keeps its existing cache; the next online navigation refreshes its shell.
  harness.setShellVersion('release-2');
  const updatedNavigation = await harness.dispatchNavigation('/');
  assert.equal(await updatedNavigation.text(), '<main>release-2</main>');
  assert.equal(harness.cacheStorage.size, 1);

  harness.setOffline();
  const offlineNavigation = await harness.dispatchNavigation('/matches');
  assert.equal(await offlineNavigation.text(), '<main>release-2</main>');
});
