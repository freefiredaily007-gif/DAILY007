import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  walletTransactionAccessibilityLabel,
  walletTransactionAmount,
  walletTransactionDescription,
  walletTransactionIsLeaderboardReward,
} from '../src/lib/wallet-transaction-display.ts';

const walletScreenSource = await readFile(
  new URL('../src/screens/Wallet.tsx', import.meta.url),
  'utf8',
);
const refundRowSource = await readFile(
  new URL('../src/components/WalletCancellationRefundRow.tsx', import.meta.url),
  'utf8',
);
const nativeTestSource = await readFile(
  new URL('../src/screens/WalletCancellationRefundNativeTest.tsx', import.meta.url),
  'utf8',
);
const creditRefundScreenTestSource = await readFile(
  new URL('../src/screens/WalletAdminCreditRefundNativeTest.tsx', import.meta.url),
  'utf8',
);
const creditRefundRouteSource = await readFile(
  new URL('../app/wallet-admin-credit-refund-test.tsx', import.meta.url),
  'utf8',
);
const creditRefundMaestroFlow = await readFile(
  new URL('../maestro/wallet-admin-credit-refund/separate-entries.yaml', import.meta.url),
  'utf8',
);
const maestroFlow = await readFile(
  new URL('../maestro/wallet-cancellation-refund/accessibility-label.yaml', import.meta.url),
  'utf8',
);
const iosMaestroFlow = await readFile(
  new URL('../maestro/wallet-cancellation-refund/voiceover-ios.yaml', import.meta.url),
  'utf8',
);
const largeTextMaestroFlow = await readFile(
  new URL('../maestro/wallet-cancellation-refund/large-text.yaml', import.meta.url),
  'utf8',
);
const largeTextAndroidRunner = await readFile(
  new URL('./run-android-wallet-cancellation-refund-large-text.mjs', import.meta.url),
  'utf8',
);
const packageSource = JSON.parse(await readFile(
  new URL('../package.json', import.meta.url),
  'utf8',
));
const androidWorkflow = await readFile(
  new URL('../../../.github/scripts/android-emulator-verification.sh', import.meta.url),
  'utf8',
);

test('Wallet displays the tournament name, refund reason, and exact signed amount', () => {
  const entry = {
    amount: 27,
    balanceAfter: 155,
    createdAt: '2030-02-03T10:20:00.000Z',
    reason: 'tournament_cancel_refund',
    description: 'Entry fee refunded — Legacy Clash Cup (tournament cancelled)',
  };

  const displayedDescription = walletTransactionDescription(entry);
  assert.match(displayedDescription, /Legacy Clash Cup/);
  assert.match(displayedDescription, /Entry fee refunded/);
  assert.match(displayedDescription, /tournament cancelled/);
  assert.equal(walletTransactionAmount(entry), '+27');
  assert.equal(
    walletTransactionAccessibilityLabel(entry),
    'Entry fee refunded — Legacy Clash Cup (tournament cancelled). +27 coins credited. Date: 2030-02-03 10:20. Balance after: 155 coins.',
  );
  assert.match(
    walletScreenSource,
    /if \(isCancellationRefund\)\s*\{\s*return <WalletCancellationRefundRow item=\{item\} \/>;/,
  );
  assert.match(refundRowSource, /<Card\s+accessible\s+accessibilityRole="text"/);
  assert.match(
    refundRowSource,
    /accessibilityLabel=\{walletTransactionAccessibilityLabel\(item\)\}/,
  );
  assert.match(refundRowSource, /testID = 'wallet-cancellation-refund-row'/);
});

test('Wallet screen renders a manual credit and cancellation refund as separate history rows', () => {
  assert.match(creditRefundScreenTestSource, /reason: 'admin_credit:entry fee correction'/);
  assert.match(creditRefundScreenTestSource, /amount: 12/);
  assert.match(creditRefundScreenTestSource, /Admin wallet adjustment — entry fee correction/);
  assert.match(creditRefundScreenTestSource, /reason: 'tournament_cancel_refund'/);
  assert.match(creditRefundScreenTestSource, /amount: 25/);
  assert.match(creditRefundScreenTestSource, /Entry fee refunded — Entry Fee Correction Cup \(tournament cancelled\)/);
  assert.match(creditRefundScreenTestSource, /<Wallet onHistoryChange=\{observeHistory\} \/>/);
  assert.match(creditRefundScreenTestSource, /'Wallet loaded one separate manual credit and one cancellation refund'/);
  assert.match(creditRefundScreenTestSource, /verifyEntries\(items\)/);
  assert.match(creditRefundRouteSource, /WalletAdminCreditRefundNativeTest/);
  assert.match(creditRefundMaestroFlow, /wallet-admin-credit-refund-test/);
  assert.match(creditRefundMaestroFlow, /id: wallet-transaction-manual-credit/);
  assert.match(creditRefundMaestroFlow, /Admin wallet adjustment — entry fee correction/);
  assert.match(creditRefundMaestroFlow, /text: "\+12"/);
  assert.match(creditRefundMaestroFlow, /id: wallet-cancellation-refund-row/);
  assert.match(
    creditRefundMaestroFlow,
    /Entry fee refunded — Entry Fee Correction Cup \(tournament cancelled\)\. \+25 coins credited\. Date: 2030-02-03 10:21\. Balance after: 137 coins\./,
  );
  assert.match(
    packageSource.scripts['test:android-wallet-admin-credit-refund'],
    /^maestro test --test-output-dir=.* maestro\/wallet-admin-credit-refund$/,
  );
});

test('Wallet displays each prize tournament and saved placement in one accessible history item', () => {
  const prize = {
    amount: 100,
    balanceAfter: 242,
    createdAt: '2030-02-03T10:20:00.000Z',
    reason: 'match_prize',
    description: 'Tournament prize — Victory Royale Cup · 2nd place · 7 kills',
  };

  assert.equal(walletTransactionDescription(prize), prize.description);
  assert.equal(walletTransactionAmount(prize), '+100');
  assert.equal(
    walletTransactionAccessibilityLabel(prize),
    'Tournament prize — Victory Royale Cup · 2nd place · 7 kills. +100 coins. Date: 2030-02-03 10:20. Balance after: 242 coins.',
  );
  assert.match(walletScreenSource, /const isMatchPrize = item\.reason === 'match_prize'/);
  assert.match(
    walletScreenSource,
    /isLeaderboardReward \|\| \(isMatchPrize && !prizeMatchId\) \? \{\s*accessible: true,\s*accessibilityRole: 'text' as const,\s*accessibilityLabel: walletTransactionAccessibilityLabel\(item\)/,
  );
});

test('Wallet clearly displays and announces each retried leaderboard reward', () => {
  for (const transaction of [
    {
      amount: 40,
      balanceAfter: 51,
      createdAt: '2030-02-03T10:20:00.000Z',
      reason: 'Weekly Leaderboard Rank #1 Reward',
      description: 'Weekly Leaderboard Rank #1 Reward',
      details: { cycleType: 'weekly', rank: 1 },
    },
    {
      amount: 20,
      balanceAfter: 32,
      createdAt: '2030-02-03T10:21:00.000Z',
      reason: 'Weekly Leaderboard Rank #2 Reward',
      description: 'Weekly Leaderboard Rank #2 Reward',
      details: { cycleType: 'weekly', rank: 2 },
    },
    {
      amount: 10,
      balanceAfter: 23,
      createdAt: '2030-02-03T10:22:00.000Z',
      reason: 'Weekly Leaderboard Rank #3 Reward',
      description: 'Weekly Leaderboard Rank #3 Reward',
      details: { cycleType: 'weekly', rank: 3 },
    },
  ]) {
    assert.equal(walletTransactionIsLeaderboardReward(transaction), true);
    assert.equal(walletTransactionDescription(transaction), transaction.description);
    assert.equal(walletTransactionAmount(transaction), `+${transaction.amount}`);
    assert.equal(
      walletTransactionAccessibilityLabel(transaction),
      `${transaction.description}. +${transaction.amount} coins credited. Date: ${transaction.createdAt.slice(0, 16).replace('T', ' ')}. Balance after: ${transaction.balanceAfter} coins.`,
    );
  }

  assert.match(walletScreenSource, /const isLeaderboardReward = walletTransactionIsLeaderboardReward\(item\)/);
  assert.match(
    walletScreenSource,
    /isLeaderboardReward \|\| \(isMatchPrize && !prizeMatchId\) \? \{\s*accessible: true,\s*accessibilityRole: 'text' as const,\s*accessibilityLabel: walletTransactionAccessibilityLabel\(item\)/,
  );
  assert.match(
    walletScreenSource,
    /isLeaderboardReward\s*\?\s*`\$\{amountLabel\} coins`/,
  );
});

test('Wallet displays the ID fallback and keeps a reason label when the API has no description', () => {
  const missingTournamentId = '00000000-0000-4000-8000-000000000082';
  const fallbackEntry = {
    amount: 19,
    reason: 'tournament_cancel_refund',
    description: `Entry fee refunded — tournament ${missingTournamentId} (tournament cancelled)`,
  };
  assert.equal(walletTransactionDescription(fallbackEntry), fallbackEntry.description);
  assert.equal(walletTransactionAmount(fallbackEntry), '+19');
  assert.equal(
    walletTransactionAccessibilityLabel(fallbackEntry),
    `${fallbackEntry.description}. +19 coins credited.`,
  );

  assert.equal(
    walletTransactionDescription({ amount: 19, reason: 'tournament_cancel_refund' }),
    'Entry fee refunded (tournament cancelled)',
  );
});

test('native fixture exposes the production cancellation-refund row as one complete accessibility item', () => {
  assert.match(nativeTestSource, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(nativeTestSource, /Legacy Clash Cup/);
  assert.match(nativeTestSource, /tournament cancelled/);
  assert.match(nativeTestSource, /amount: 27/);
  assert.match(nativeTestSource, /2030-02-03T10:20:00\.000Z/);
  assert.match(nativeTestSource, /balanceAfter: 155/);
  assert.match(nativeTestSource, /accessibilityDetailsAppearOnce/);
  assert.doesNotMatch(nativeTestSource, /\bApi\.|\bfetch\s*\(/);

  assert.match(maestroFlow, /wallet-cancellation-refund-test/);
  assert.match(maestroFlow, /id: wallet-cancellation-refund-row/);
  assert.match(
    maestroFlow,
    /Entry fee refunded — Legacy Clash Cup \(tournament cancelled\)\. \+27 coins credited\. Date: 2030-02-03 10:20\. Balance after: 155 coins\./,
  );
  const androidRefundSuite = packageSource.scripts['test:android-wallet-cancellation-refund'];
  assert.match(androidRefundSuite, /maestro test --test-output-dir=.*wallet-cancellation-refund\/accessibility-label\.yaml/);
  assert.match(androidRefundSuite, /&& maestro test --test-output-dir=.*wallet-cancellation-refund\/voiceover-ios\.yaml/);
  assert.doesNotMatch(androidRefundSuite, /maestro test .* maestro\/wallet-cancellation-refund$/);
});

test('Android checks every refund detail at 1.5× text and restores the original font scale', () => {
  assert.match(refundRowSource, /fontScale >= 1\.5/);
  assert.match(refundRowSource, /cardLarge:\s*\{\s*flexDirection: 'column'/);
  assert.match(nativeTestSource, /Every refund detail is visible without clipping or overlap at 1\.5×/);
  assert.match(nativeTestSource, /detailsDoNotOverlap/);
  assert.match(nativeTestSource, /detailTextFitsBounds/);
  assert.match(nativeTestSource, /detailsFitCard/);
  assert.match(nativeTestSource, /hasEveryDetail/);
  assert.match(largeTextMaestroFlow, /Cancellation refund fixture · font scale 1\.5/);
  assert.match(largeTextMaestroFlow, /Entry fee refunded — Legacy Clash Cup \(tournament cancelled\)\. \+27 coins credited\. Date: 2030-02-03 10:20\. Balance after: 155 coins\./);
  assert.match(largeTextMaestroFlow, /Every refund detail is visible without clipping or overlap at 1\.5×/);
  assert.match(largeTextAndroidRunner, /settings', 'put', 'system', 'font_scale', '1\.5'/);
  assert.match(largeTextAndroidRunner, /wm', 'size'/);
  assert.match(largeTextAndroidRunner, /320 \* Number\(density\[1\]\) \/ 160/);
  assert.match(largeTextAndroidRunner, /wm', 'size', 'reset'/);
  assert.match(largeTextAndroidRunner, /Restored Android screen size/);
  assert.match(largeTextAndroidRunner, /font_scale',\s*originalFontScale/);
  assert.match(largeTextAndroidRunner, /finally\s*\{/);
  assert.match(largeTextAndroidRunner, /maestro', \['test', 'maestro\/wallet-cancellation-refund\/large-text\.yaml'\]/);
  assert.equal(
    packageSource.scripts['test:android-wallet-cancellation-refund-large-text'],
    'node scripts/run-android-wallet-cancellation-refund-large-text.mjs',
  );
  assert.match(
    androidWorkflow,
    /run_maestro_suite wallet-cancellation-narrow-large-text test:android-wallet-cancellation-refund-large-text/,
  );
});

test('iOS VoiceOver flow exposes adjacent refunds as distinct, complete accessibility items', () => {
  const firstRefundLabel = walletTransactionAccessibilityLabel({
    amount: 27,
    balanceAfter: 155,
    createdAt: '2030-02-03T10:20:00.000Z',
    reason: 'tournament_cancel_refund',
    description: 'Entry fee refunded — Legacy Clash Cup (tournament cancelled)',
  });
  const secondRefundLabel = walletTransactionAccessibilityLabel({
    amount: 41,
    balanceAfter: 196,
    createdAt: '2030-02-03T10:21:00.000Z',
    reason: 'tournament_cancel_refund',
    description: 'Entry fee refunded — Desert Duel Cup (tournament cancelled)',
  });
  assert.equal(
    firstRefundLabel,
    'Entry fee refunded — Legacy Clash Cup (tournament cancelled). +27 coins credited. Date: 2030-02-03 10:20. Balance after: 155 coins.',
  );
  assert.equal(
    secondRefundLabel,
    'Entry fee refunded — Desert Duel Cup (tournament cancelled). +41 coins credited. Date: 2030-02-03 10:21. Balance after: 196 coins.',
  );
  assert.doesNotMatch(firstRefundLabel, /Desert Duel|41 coins|10:21|196 coins/);
  assert.doesNotMatch(secondRefundLabel, /Legacy Clash|27 coins|10:20|155 coins/);
  assert.match(iosMaestroFlow, /appId: host\.exp\.Exponent/);
  assert.match(iosMaestroFlow, /wallet-cancellation-refund-voiceover-test/);
  assert.match(nativeTestSource, /VOICEOVER_FIXTURES\.map/);
  assert.match(nativeTestSource, /wallet-cancellation-refund-row-legacy-clash/);
  assert.match(nativeTestSource, /wallet-cancellation-refund-row-desert-duel/);
  assert.match(iosMaestroFlow, /id: wallet-cancellation-refund-row-legacy-clash/);
  assert.match(
    iosMaestroFlow,
    /Entry fee refunded — Legacy Clash Cup \(tournament cancelled\)\. \+27 coins credited\. Date: 2030-02-03 10:20\. Balance after: 155 coins\./,
  );
  assert.match(iosMaestroFlow, /id: wallet-cancellation-refund-row-desert-duel/);
  assert.match(
    iosMaestroFlow,
    /Entry fee refunded — Desert Duel Cup \(tournament cancelled\)\. \+41 coins credited\. Date: 2030-02-03 10:21\. Balance after: 196 coins\./,
  );
  assert.match(iosMaestroFlow, /Two adjacent cancellation refunds/);
  assert.match(refundRowSource, /testID = 'wallet-cancellation-refund-row'/);
  assert.match(refundRowSource, /accessibilityLabel=\{walletTransactionAccessibilityLabel\(item\)\}/);
  assert.equal(
    packageSource.scripts['test:ios-wallet-cancellation-refund'],
    'maestro test maestro/wallet-cancellation-refund/voiceover-ios.yaml',
  );
});
