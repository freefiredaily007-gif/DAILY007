import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [toastSource, regsSource, paymentsSource, walletSource, usersSource] = await Promise.all([
  readFile(new URL('../src/components/adminKit.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/AdminRegs.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/AdminPayments.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/AdminWallet.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/AdminUsers.tsx', import.meta.url), 'utf8'),
]);

test('repeated Admin error toasts remain assertive TalkBack alerts', () => {
  assert.match(toastSource, /if \(Platform\.OS === 'ios'\) AccessibilityInfo\.announceForAccessibility\(msg\)/);
  assert.match(toastSource, /accessibilityLabel=\{toast\.msg\}/);
  assert.match(toastSource, /accessibilityRole=\{Platform\.OS !== 'ios' && toast\.kind === 'err' \? 'alert' : undefined\}/);
  assert.match(toastSource, /accessibilityLiveRegion=\{Platform\.OS === 'ios'/);
  assert.match(toastSource, /toast\.kind === 'err' \? 'assertive' : 'polite'/);
  assert.match(toastSource, /toastSequence/);
  assert.match(toastSource, /key=\{toast\.id\}/);
});

test('approved registration removal errors name the player and leave a named retry control', () => {
  assert.match(regsSource, /accessibilityLabel=\{err \|\| undefined\} accessibilityLiveRegion="assertive"/);
  assert.match(regsSource, /Could not remove the registration for \$\{playerName\}: \$\{apiError\(e\)\}/);
  assert.match(regsSource, /use DELETE for \$\{playerName\} to retry/);
  assert.match(regsSource, /accessibilityLabel=\{`Delete registration for \$\{playerName\}`\}/);
});

test('deposit and withdrawal errors identify the request and named retry action', () => {
  assert.match(paymentsSource, /accessibilityLabel=\{err \|\| undefined\} accessibilityLiveRegion="assertive"/);
  assert.match(paymentsSource, /Could not \$\{action\} the \$\{requestType\} request for \$\{userName \|\| 'this player'\}/);
  assert.match(paymentsSource, /Could not reject the \$\{requestType\} request for \$\{target\.userName/);
  assert.match(paymentsSource, /Check its status, then activate REJECT for \$\{target\.userName/);
  assert.match(paymentsSource, /accessibilityLabel=\{`Approve \$\{p\.kind === 'withdrawal' \? 'withdrawal' : 'deposit'\} request for \$\{p\.userName \|\| 'player'\}`\}/);
  assert.match(paymentsSource, /accessibilityLabel=\{`Reject \$\{p\.kind === 'withdrawal' \? 'withdrawal' : 'deposit'\} request for \$\{p\.userName \|\| 'player'\}`\}/);
  assert.match(paymentsSource, /Check its payout status before activating RECORD PAYOUT SENT again/);
});

test('approved withdrawals expose their payout state and announce when it becomes paid', () => {
  assert.match(paymentsSource, /accessibilityLabel=\{`Payout status: \$\{withdrawalPayoutStatusLabel\(p\.payoutStatus\)\}`\}/);
  assert.match(paymentsSource, /accessibilityLiveRegion=\{p\.payoutStatus === 'paid' \? 'polite' : 'none'\}/);
  assert.match(paymentsSource, /testID=\{`withdrawal-payout-status-\$\{p\.id\}`\}/);
  assert.match(paymentsSource, /Manual payout recorded\. Payout status: \$\{withdrawalPayoutStatusLabel\(payoutResult\.payoutStatus\)\}/);
  assert.match(paymentsSource, /for \$\{request\?\.userName \|\| 'this player'\}\./);
  assert.match(paymentsSource, /accessibilityLabel=\{okMsg \|\| undefined\}/);
  assert.match(paymentsSource, /accessibilityLiveRegion="polite"/);
  assert.match(paymentsSource, /testID="admin-payment-action-success"/);
});

test('coin adjustment failures offer a safe retry for the same request in both Admin screens', () => {
  for (const source of [walletSource, usersSource]) {
    assert.match(source, /Use the retry prompt to safely repeat this same request/);
    assert.match(source, /requestId: newAdminAdjustmentRequestId\(\)/);
    assert.match(source, /adjustment\.requestId/);
    assert.match(source, /onConfirm=\{\(\) => \{ if \(retryAdjustment\) void submitAdjustment\(retryAdjustment\); \}\}/);
    assert.match(source, /RETRY SAME REQUEST/);
  }
  assert.match(walletSource, /Could not \$\{action\} \$\{adjustment\.amount\} coins for \$\{adjustment\.user\.name\}/);
  assert.match(usersSource, /Could not \$\{action\} \$\{adjustment\.amount\} coins \$\{adjustment\.delta > 0 \? 'to' : 'from'\} \$\{adjustment\.user\.name\}/);
  assert.match(walletSource, /accessibilityLabel=\{`Add coins to \$\{u\.name\}`\}/);
  assert.match(walletSource, /accessibilityLabel=\{`Deduct coins from \$\{u\.name\}`\}/);
  assert.match(usersSource, /accessibilityLabel=\{`Add coins to \$\{u\.name\}`\}/);
  assert.match(usersSource, /accessibilityLabel=\{`Deduct coins from \$\{u\.name\}`\}/);
});

test('User Management coin actions use a validated modal and sync the server balance in place', () => {
  assert.doesNotMatch(usersSource, /Alert\.prompt/);
  assert.match(usersSource, /visible=\{coinAdjustmentTarget !== null\}/);
  assert.match(usersSource, /keyboardType="number-pad"/);
  assert.ok(usersSource.includes("if (!/^[0-9]+$/.test(amountText))"));
  assert.match(usersSource, /amount <= 0 \|\| amount > 2_147_483_647/);
  assert.match(usersSource, /setUsers\(\(current\) => current\?\.map/);
  assert.match(usersSource, /coins: updatedCoins/);
  assert.match(usersSource, /toast\('Coins updated', 'success'\)/);
});

test('user block and role errors identify the affected account and its retry control', () => {
  assert.match(usersSource, /Could not \$\{action\} \$\{u\.name\}: \$\{errMessage\(e\)\}/);
  assert.match(usersSource, /Check the displayed status, then use \$\{buttonLabel\} for \$\{u\.name\} to retry/);
  assert.match(usersSource, /Could not restrict Full Admin access for \$\{u\.name\}/);
  assert.match(usersSource, /\$\{roleActionLabel\} failed: \$\{message\}/);
  assert.match(usersSource, /accessibilityLabel=\{`\$\{blocked \? 'Unblock' : 'Block'\} \$\{u\.name\}`\}/);
  assert.match(usersSource, /accessibilityLabel=\{roleChangeAccessibilityLabel\(u\)\}/);
});
