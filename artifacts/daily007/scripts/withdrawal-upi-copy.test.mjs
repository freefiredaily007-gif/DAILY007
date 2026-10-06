import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  copyWithdrawalUpi,
  getWithdrawalUpiCopyLabel,
} from '../src/lib/withdrawal-upi-copy.ts';

const screenSource = await readFile(
  new URL('../src/screens/AdminPayments.tsx', import.meta.url),
  'utf8',
);
const copyHelperSource = await readFile(
  new URL('../src/lib/withdrawal-upi-copy.ts', import.meta.url),
  'utf8',
);
const uiSource = await readFile(
  new URL('../src/components/ui.tsx', import.meta.url),
  'utf8',
);

test('the withdrawal copy button reports errors and stays separate from payout actions', () => {
  const copyPress = screenSource.match(
    /onPress=\{\(\) => \{([\s\S]*?)\n\s*\}\}\s*\/>/,
  );

  assert.match(
    screenSource,
    /title=\{getWithdrawalUpiCopyLabel\(String\(p\.id\), copiedUpiId\)\}/,
  );
  assert.ok(copyPress, 'The copy button must retain its own press handler.');
  assert.match(
    copyPress[1],
    /void copyWithdrawalUpi\(\s*String\(p\.id\),\s*String\(p\.account\),\s*Clipboard,/,
  );
  assert.match(copyPress[1], /setCopiedUpiId,\s*setErr,/);
  assert.match(
    screenSource,
    /<Msg kind="err" text=\{err\} accessibilityLiveRegion="assertive" \/>/,
  );
  assert.match(uiSource, /accessibilityLiveRegion=\{accessibilityLiveRegion\}/);
  assert.doesNotMatch(
    copyPress[1],
    /\bApi\.|adminWithdrawalAction|adminPaymentAction|adminMarkWithdrawalPaid/,
  );
  assert.match(
    screenSource,
    /testID=\{`copy-withdrawal-upi-\$\{p\.id\}`\}/,
  );
  assert.doesNotMatch(
    copyHelperSource,
    /adminWithdrawalAction|adminPaymentAction|adminMarkWithdrawalPaid/,
  );
});

test('payment and withdrawal success feedback is polite without changing payout actions or styling', () => {
  assert.match(
    screenSource,
    /<Msg kind="ok" text=\{okMsg\} accessibilityLiveRegion="polite" \/>/,
    'Payment, rejection, and manual-payout confirmations must use a polite live region.',
  );
  assert.match(uiSource, /accessibilityLiveRegion=\{accessibilityLiveRegion\}/);
  assert.match(
    uiSource,
    /style=\{\[\{ color: ok \? C\.green : C\.red, fontSize: 13, fontWeight: '600' \}, adminSurface && adminSt\.bodyText\]\}/,
    'The shared confirmation message must keep its existing visible text styling.',
  );

  const approvalStart = screenSource.indexOf('const act = async');
  const approvalEnd = screenSource.indexOf('\n  const reject = async', approvalStart);
  const approvalAction = screenSource.slice(approvalStart, approvalEnd);
  assert.match(approvalAction, /Api\.adminWithdrawalAction\(id, action\)/);
  assert.match(approvalAction, /Api\.adminPaymentAction\(id, action\)/);
  assert.match(approvalAction, /setOkMsg\(action === 'approve'/);

  const rejectionStart = screenSource.indexOf('const reject = async');
  const rejectionEnd = screenSource.indexOf('\n  const showProof = async', rejectionStart);
  const rejectionAction = screenSource.slice(rejectionStart, rejectionEnd);
  assert.match(rejectionAction, /Api\.adminWithdrawalAction\(target\.id, 'reject', reason\.trim\(\)\)/);
  assert.match(rejectionAction, /Api\.adminPaymentAction\(target\.id, 'reject', reason\.trim\(\)\)/);
  assert.match(rejectionAction, /setOkMsg\(target\.kind === 'withdrawal'/);

  const payoutStart = screenSource.indexOf('const markPaid = async');
  const payoutEnd = screenSource.indexOf('\n\n  return', payoutStart);
  const payoutAction = screenSource.slice(payoutStart, payoutEnd);
  assert.match(payoutAction, /Api\.adminMarkWithdrawalPaid\(payoutTarget\)/);
  assert.match(payoutAction, /setOkMsg\('Manual payout recorded'\)/);
});

test('copy sends the exact account text and only shows COPIED after clipboard success', async () => {
  const requestId = 'withdrawal-42';
  const account = '  Player.Name+pay@bank  ';
  const events = [];
  let copiedRequestId = null;
  let resolveClipboard;
  const clipboard = {
    setStringAsync(value) {
      events.push(['clipboard', value]);
      return new Promise((resolve) => {
        resolveClipboard = resolve;
      });
    },
  };
  const setCopiedUpiId = (id) => {
    copiedRequestId = id;
    events.push(['copied', id]);
  };
  const setErr = (message) => events.push(['error', message]);
  const button = {
    title: getWithdrawalUpiCopyLabel(requestId, copiedRequestId),
    onPress: () => {
      void copyWithdrawalUpi(
        requestId,
        account,
        clipboard,
        setCopiedUpiId,
        setErr,
      );
    },
  };

  assert.equal(button.title, 'COPY UPI');
  button.onPress();
  assert.deepEqual(events, [
    ['copied', null],
    ['error', ''],
    ['clipboard', account],
  ]);
  assert.equal(
    getWithdrawalUpiCopyLabel(requestId, copiedRequestId),
    'COPY UPI',
  );

  resolveClipboard(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    ['copied', null],
    ['error', ''],
    ['clipboard', account],
    ['copied', requestId],
  ]);
  assert.equal(getWithdrawalUpiCopyLabel(requestId, copiedRequestId), 'COPIED');
  assert.equal(
    getWithdrawalUpiCopyLabel('another-withdrawal', copiedRequestId),
    'COPY UPI',
  );
});

test('a rejected clipboard write reaches an assertive live region without marking copied', async () => {
  const events = [];
  let copiedRequestId = null;

  await copyWithdrawalUpi(
    'withdrawal-failed',
    'player@bank',
    { setStringAsync: async () => { throw new Error('clipboard unavailable'); } },
    (id) => {
      copiedRequestId = id;
      events.push(['copied', id]);
    },
    (message) => events.push(['error', message]),
  );

  assert.deepEqual(events, [
    ['copied', null],
    ['error', ''],
    ['error', 'Could not copy this UPI ID.'],
  ]);
  assert.match(screenSource, /<Msg kind="err" text=\{err\} accessibilityLiveRegion="assertive" \/>/);
  assert.match(uiSource, /accessibilityLiveRegion=\{accessibilityLiveRegion\}/);
  assert.equal(
    getWithdrawalUpiCopyLabel('withdrawal-failed', copiedRequestId),
    'COPY UPI',
  );
});

test('a rejected repeat copy clears earlier COPIED feedback and reports the failure', async () => {
  const requestId = 'withdrawal-previously-copied';
  const account = 'player@bank';
  const events = [];
  let copiedRequestId = null;
  let rejectNextWrite = false;
  const clipboard = {
    async setStringAsync(value) {
      events.push(['clipboard', value]);
      if (rejectNextWrite) throw new Error('clipboard unavailable');
      return true;
    },
  };
  const setCopiedUpiId = (id) => {
    copiedRequestId = id;
    events.push(['copied', id]);
  };
  const setErr = (message) => events.push(['error', message]);

  await copyWithdrawalUpi(
    requestId,
    account,
    clipboard,
    setCopiedUpiId,
    setErr,
  );
  assert.equal(getWithdrawalUpiCopyLabel(requestId, copiedRequestId), 'COPIED');

  events.length = 0;
  rejectNextWrite = true;
  await copyWithdrawalUpi(
    requestId,
    account,
    clipboard,
    setCopiedUpiId,
    setErr,
  );

  assert.deepEqual(events, [
    ['copied', null],
    ['error', ''],
    ['clipboard', account],
    ['error', 'Could not copy this UPI ID.'],
  ]);
  assert.equal(copiedRequestId, null);
  assert.equal(getWithdrawalUpiCopyLabel(requestId, copiedRequestId), 'COPY UPI');
});

test('a clipboard write that resolves false never marks the request as copied', async () => {
  const events = [];
  let copiedRequestId = null;

  await copyWithdrawalUpi(
    'withdrawal-unconfirmed',
    'player@bank',
    { setStringAsync: async () => false },
    (id) => {
      copiedRequestId = id;
      events.push(['copied', id]);
    },
    (message) => events.push(['error', message]),
  );

  assert.deepEqual(events, [
    ['copied', null],
    ['error', ''],
    ['error', 'Could not copy this UPI ID.'],
  ]);
  assert.equal(
    getWithdrawalUpiCopyLabel('withdrawal-unconfirmed', copiedRequestId),
    'COPY UPI',
  );
});