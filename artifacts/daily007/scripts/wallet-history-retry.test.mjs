import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const walletSource = await readFile(
  new URL('../src/screens/Wallet.tsx', import.meta.url),
  'utf8',
);

test('Wallet history failures keep a dedicated error and retryable state', () => {
  assert.match(walletSource, /const \[historyLoadError, setHistoryLoadError\] = useState\(''\)/);
  assert.match(walletSource, /if \(requestIsCurrent\(\)\) \{\s*setHistoryLoadError\(apiError\(e\)\);\s*return false;/);
  assert.match(walletSource, /setHistoryLoadError\(''\);\s*return true;/);
  assert.match(walletSource, /testID="wallet-history-error"/);
  assert.match(walletSource, /testID="wallet-history-retry"/);
  assert.match(walletSource, /accessibilityLabel=\{loading \? 'Retrying transaction history' : 'Retry transaction history'\}/);
  assert.match(walletSource, /accessibilityHint="Loads your latest wallet transaction history\."/);
});

test('Wallet retry reports progress and both recovery outcomes', () => {
  assert.match(walletSource, /announceHistoryRetryStatus\('Retrying transaction history\.'\)/);
  assert.match(walletSource, /announceHistoryRetryStatus\('Transaction history updated\.'\)/);
  assert.match(
    walletSource,
    /announceHistoryRetryStatus\('Transaction history could not be loaded\. Use Retry transaction history to try again\.'\)/,
  );
  assert.match(walletSource, /testID="wallet-history-retry-status"/);
  assert.match(walletSource, /AccessibilityInfo\.announceForAccessibilityWithOptions\(message/);
});

test('Wallet pull-to-refresh still uses the same history loader and failures are not shown as empty history', () => {
  assert.match(walletSource, /const refreshHistory = useCallback\(\(\) => \{\s*setHistoryRetryStatus\(''\);\s*load\(\);/);
  assert.match(walletSource, /refreshControl=\{<RefreshControl refreshing=\{loading\} onRefresh=\{refreshHistory\}/);
  assert.match(walletSource, /: historyLoadError\s*\?\s*null/);
});
