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
  assert.match(toastSource, /accessibilityLabel=\{toast\.msg\}/);
  assert.match(toastSource, /accessibilityRole=\{toast\.kind === 'err' \? 'alert' : undefined\}/);
  assert.match(toastSource, /accessibilityLiveRegion=\{toast\.kind === 'err' \? 'assertive' : 'polite'\}/);
  assert.match(toastSource, /toastSequence/);
  assert.match(toastSource, /key=\{toast\.id\}/);
});

test('registration errors name the action and leave a named retry control in the list', () => {
  assert.match(regsSource, /accessibilityLabel=\{err \|\| undefined\} accessibilityLiveRegion="assertive"/);
  assert.match(regsSource, /Could not \$\{action\} registration for \$\{playerName\}: \$\{apiError\(e\)\}/);
  assert.match(regsSource, /activate \$\{actionLabel\} for \$\{playerName\} to retry/);
  assert.match(regsSource, /accessibilityLabel=\{`Approve registration for \$\{r\.playerName\}`\}/);
  assert.match(regsSource, /accessibilityLabel=\{`Reject registration for \$\{r\.playerName\}`\}/);
  assert.match(regsSource, /accessibilityLabel=\{`Delete registration for \$\{r\.playerName\}`\}/);
});

test('deposit and withdrawal errors identify the request and named retry action', () => {
  assert.match(paymentsSource, /accessibilityLabel=\{err \|\| undefined\} accessibilityLiveRegion="assertive"/);
  assert.match(paymentsSource, /Could not \$\{action\} the \$\{requestType\} request for \$\{userName \|\| 'this player'\}/);
  assert.match(paymentsSource, /Could not reject the \$\{requestType\} request for \$\{target\.userName/);
  assert.match(paymentsSource, /Check its status, then activate REJECT for \$\{target\.userName/);
  assert.match(paymentsSource, /accessibilityLabel=\{`Approve \$\{p\.kind === 'withdrawal' \? 'withdrawal' : 'deposit'\} request for \$\{p\.userName \|\| 'player'\}`\}/);
  assert.match(paymentsSource, /accessibilityLabel=\{`Reject \$\{p\.kind === 'withdrawal' \? 'withdrawal' : 'deposit'\} request for \$\{p\.userName \|\| 'player'\}`\}/);
  assert.match(paymentsSource, /Check its payout status before activating RECORD MANUAL PAYOUT SENT again/);
});

test('wallet failures explain how to retry without losing the selected user row', () => {
  assert.match(walletSource, /Could not \$\{action\} \$\{n\} coins to \$\{u\.name\}/);
  assert.match(walletSource, /\$\{u\.name\}'s row remains available/);
  assert.match(walletSource, /use \$\{buttonLabel\} for \$\{u\.name\} to retry/);
  assert.match(walletSource, /accessibilityLabel=\{`Add coins to \$\{u\.name\}`\}/);
  assert.match(walletSource, /accessibilityLabel=\{`Deduct coins from \$\{u\.name\}`\}/);
});

test('user block and role errors identify the affected account and its retry control', () => {
  assert.match(usersSource, /Could not \$\{action\} \$\{u\.name\}: \$\{errMessage\(e\)\}/);
  assert.match(usersSource, /Check the displayed status, then use \$\{buttonLabel\} for \$\{u\.name\} to retry/);
  assert.match(usersSource, /Could not restrict Full Admin access for \$\{u\.name\}/);
  assert.match(usersSource, /\$\{roleActionLabel\} failed: \$\{message\}/);
  assert.match(usersSource, /accessibilityLabel=\{`\$\{blocked \? 'Unblock' : 'Block'\} \$\{u\.name\}`\}/);
  assert.match(usersSource, /accessibilityLabel=\{roleChangeAccessibilityLabel\(u\)\}/);
});
