import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { walletRejectedDepositAccessibilityLabel } from '../src/lib/wallet-transaction-display.ts';

const walletScreenSource = await readFile(
  new URL('../src/screens/Wallet.tsx', import.meta.url),
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
  assert.match(walletScreenSource, /testID=\{isRejectedDeposit\s*\?\s*'wallet-rejected-deposit-row'/);
  assert.match(walletScreenSource, /accessible=\{isRejectedDeposit \|\| isCancellationRefund \|\| undefined\}/);
  assert.match(walletScreenSource, /accessibilityRole=\{isRejectedDeposit \|\| isCancellationRefund \? 'text' : undefined\}/);
  assert.match(walletScreenSource, /accessibilityLabel=\{rowAccessibilityLabel\}/);
  assert.match(
    walletScreenSource,
    /walletRejectedDepositAccessibilityLabel\(\{\s*rupeeAmount: depositAmountLabel \?\? '',\s*coins: item\.coins,\s*createdAt: item\.createdAt,\s*reference: item\.reference,\s*reviewReason: item\.reviewReason,/,
  );
});

test('large text gives the rejected deposit reason full width and leaves it untruncated', () => {
  assert.match(walletScreenSource, /const largeRejectedDeposit = isRejectedDeposit && fontScale >= 1\.5/);
  assert.match(walletScreenSource, /flexDirection: largeRejectedDeposit \? 'column' : 'row'/);
  assert.match(walletScreenSource, /largeRejectedDeposit && s\.rejectedDepositContentLarge/);
  assert.match(walletScreenSource, /largeRejectedDeposit && s\.rejectedDepositAmountLarge/);
  assert.match(
    walletScreenSource,
    /<Text style=\{\[\s*s\.reviewText,\s*largeRejectedDeposit && s\.rejectedDepositReasonLarge,\s*\]\}>\s*Reason: \{item\.reviewReason\}\s*<\/Text>/,
  );
  assert.match(
    walletScreenSource,
    /rejectedDepositReasonLarge: \{ width: '100%', maxWidth: '100%', flexShrink: 1 \}/,
  );
  assert.match(typographySource, /<NativeText\s+\{\.\.\.props\}/);
  assert.doesNotMatch(typographySource, /allowFontScaling=\{false\}/);
});
