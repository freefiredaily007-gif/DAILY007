import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Android Wallet fixture pages through 405 payment requests in the real Wallet screen', async () => {
  const [wallet, fixture, route, maestro, packageSource, workflow] = await Promise.all([
    read('src/screens/Wallet.tsx'),
    read('src/screens/WalletPaymentHistoryNativeTest.tsx'),
    read('app/wallet-payment-history-test.tsx'),
    read('maestro/wallet-payment-history/loads-all-payment-pages.yaml'),
    read('package.json'),
    read('../../.github/scripts/android-emulator-verification.sh'),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.match(wallet, /onHistoryChange\?: WalletHistoryTestObserver/);
  assert.match(wallet, /if \(__DEV__ && onHistoryChange\)/);
  assert.match(fixture, /const PAYMENT_COUNT = 405/);
  assert.match(fixture, /const PAGE_SIZE = 200/);
  assert.match(fixture, /<Wallet onHistoryChange=\{observeHistory\} \/>/);
  assert.match(fixture, /new Set\(ids\)/);
  assert.match(fixture, /exactOrder/);
  assert.match(route, /WalletPaymentHistoryNativeTest/);

  assert.match(maestro, /wallet-payment-history-test/);
  assert.match(maestro, /wallet-load-older-transactions/);
  assert.equal((maestro.match(/- tapOn:\s*\n\s+id: wallet-load-older-transactions/g) ?? []).length, 2);
  assert.match(maestro, /Loaded 200 of 405 requests; unique and newest-first/);
  assert.match(maestro, /Loaded 400 of 405 requests; unique and newest-first/);
  assert.match(maestro, /Loaded 405 of 405 requests; unique and newest-first/);
  assert.match(maestro, /wallet-transaction-pay-android-wallet-history-001/);
  assert.match(maestro, /assertNotVisible:\s*\n\s+id: wallet-load-older-transactions/);

  assert.match(
    packageJson.scripts['test:android-wallet-payment-history'],
    /^maestro test .*maestro\/wallet-payment-history$/,
  );
  assert.match(
    packageJson.scripts['test:wallet-payment-history-native'],
    /wallet-payment-history-native\.test\.mjs/,
  );
  assert.match(
    workflow,
    /run_maestro_suite wallet-payment-history test:android-wallet-payment-history/,
  );
});
