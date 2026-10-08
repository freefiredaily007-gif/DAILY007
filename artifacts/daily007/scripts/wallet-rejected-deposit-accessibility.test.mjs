import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  walletRejectedDepositAccessibilityLabel,
  walletRejectedDepositReasonText,
} from '../src/lib/wallet-transaction-display.ts';

const walletScreenSource = await readFile(
  new URL('../src/screens/Wallet.tsx', import.meta.url),
  'utf8',
);
const rejectedDepositRowSource = await readFile(
  new URL('../src/components/WalletRejectedDepositRow.tsx', import.meta.url),
  'utf8',
);
const nativeTestSource = await readFile(
  new URL('../src/screens/WalletRejectedDepositNativeTest.tsx', import.meta.url),
  'utf8',
);
const maestroFlow = await readFile(
  new URL('../maestro/wallet-rejected-deposit/large-text.yaml', import.meta.url),
  'utf8',
);
const androidTestRunner = await readFile(
  new URL('./run-android-wallet-rejected-deposit.mjs', import.meta.url),
  'utf8',
);
const typographySource = await readFile(
  new URL('../src/components/typography.tsx', import.meta.url),
  'utf8',
);

test('a rejected deposit row announces its decision and payment details together', () => {
  assert.equal(
    walletRejectedDepositAccessibilityLabel({
      rupeeAmount: '₹1,250',
      coins: 250,
      createdAt: '2026-10-05T10:12:30.000Z',
      reference: 'TEST-UPI-554',
      reviewReason: '  UPI   reference did not match. ',
    }),
    'Deposit request. Status: Rejected. Original rupee amount: ₹1,250. Coin amount: 250 coins. Date: 2026-10-05 10:12. UTR: TEST-UPI-554. Rejection reason: UPI reference did not match.',
  );
  assert.match(
    walletRejectedDepositAccessibilityLabel({ rupeeAmount: '₹50', coins: 10 }),
    /Rejection reason: No rejection reason was provided\.$/,
  );
  assert.match(
    walletScreenSource,
    /if \(isRejectedDeposit\)\s*\{\s*return \(\s*<WalletRejectedDepositRow\s+item=\{item\}\s+depositAmountLabel=\{depositAmountLabel \?\? ''\}/,
  );
  assert.match(rejectedDepositRowSource, /accessible\s+accessibilityRole="text"/);
  assert.match(rejectedDepositRowSource, /accessibilityLabel=\{accessibilityLabel\}/);
  assert.match(rejectedDepositRowSource, /testID="wallet-rejected-deposit-row"/);
  assert.match(
    rejectedDepositRowSource,
    /walletRejectedDepositAccessibilityLabel\(\{\s*rupeeAmount: depositAmountLabel,\s*coins: item\.coins,\s*createdAt: item\.createdAt,\s*reference: item\.reference,\s*reviewReason: item\.reviewReason,/,
  );
  assert.match(
    rejectedDepositRowSource,
    /const reason = walletRejectedDepositReasonText\(item\.reviewReason\)/,
  );
  assert.match(
    rejectedDepositRowSource,
    /testID="wallet-rejected-deposit-reason"[\s\S]*?Reason: \{reason\}/,
  );
  assert.doesNotMatch(rejectedDepositRowSource, /\{reason \? \(/);
  for (const reviewReason of [undefined, null, '', ' \t\n ']) {
    const visibleReason = walletRejectedDepositReasonText(reviewReason);
    assert.equal(visibleReason, 'No rejection reason was provided.');
    assert.ok(
      walletRejectedDepositAccessibilityLabel({
        rupeeAmount: '₹50',
        coins: 10,
        reviewReason,
      }).includes(`Rejection reason: ${visibleReason}`),
    );
  }
});

test('Android renders the grouped label and verifies the rejected reason wraps without clipping', () => {
  assert.match(rejectedDepositRowSource, /const \{ fontScale \} = useWindowDimensions\(\)/);
  assert.match(rejectedDepositRowSource, /const largeText = fontScale >= 1\.5/);
  assert.match(rejectedDepositRowSource, /flexDirection: largeText \? 'column' : 'row'/);
  assert.match(rejectedDepositRowSource, /reasonLarge: \{ width: '100%', maxWidth: '100%', flexShrink: 1 \}/);
  assert.match(rejectedDepositRowSource, /onTextLayout=\{\(event\)/);
  assert.match(nativeTestSource, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(nativeTestSource, /lineCount > 1/);
  assert.match(nativeTestSource, /fullReasonIsRendered/);
  assert.match(nativeTestSource, /reasonFitsTextBounds/);
  assert.match(nativeTestSource, /reasonFitsContent/);
  assert.match(nativeTestSource, /testID="wallet-rejected-deposit-layout-check"/);
  assert.doesNotMatch(nativeTestSource, /\bApi\.|\bfetch\s*\(/);

  assert.match(maestroFlow, /wallet-rejected-deposit-test/);
  assert.match(maestroFlow, /Original rupee amount: ₹1,250/);
  assert.match(maestroFlow, /Coin amount: 250 coins/);
  assert.match(maestroFlow, /Status: Rejected/);
  assert.match(maestroFlow, /Rejection reason: The UPI reference/);
  assert.match(maestroFlow, /Reason wraps fully without clipping/);
  assert.match(androidTestRunner, /settings', 'put', 'system', 'font_scale', '1\.5'/);
  assert.match(androidTestRunner, /maestro', \['test', 'maestro\/wallet-rejected-deposit'\]/);
  assert.match(androidTestRunner, /previousFontScale/);
  assert.match(androidTestRunner, /am', 'force-stop', 'host\.exp\.exponent'/);
  assert.match(typographySource, /<NativeText\s+\{\.\.\.props\}/);
  assert.doesNotMatch(typographySource, /allowFontScaling=\{false\}/);
});
