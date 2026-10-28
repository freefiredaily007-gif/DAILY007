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
const nativeFixtureSource = await readFile(
  new URL('../src/screens/WithdrawalUpiCopyNativeTest.tsx', import.meta.url),
  'utf8',
);
const maestroFlow = await readFile(
  new URL('../maestro/withdrawal-upi-copy/copy-and-paste.yaml', import.meta.url),
  'utf8',
);
const packageSource = await readFile(
  new URL('../package.json', import.meta.url),
  'utf8',
);
const workflowSource = await readFile(
  new URL('../../../.github/scripts/android-emulator-verification.sh', import.meta.url),
  'utf8',
);

test('the Android route uses two local fixtures and compares native clipboard values exactly', () => {
  assert.match(nativeFixtureSource, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  const fixtureAccounts = [...nativeFixtureSource.matchAll(/account: '([^']+)'/g)]
    .map((match) => match[1]);
  assert.equal(fixtureAccounts.length, 2);
  assert.ok(
    fixtureAccounts[1].length > fixtureAccounts[0].length,
    'The second synthetic UPI ID must be longer than the original.',
  );
  assert.ok(
    nativeFixtureSource.includes("account: 'upi-copy-fixture@daily007.invalid'"),
    'The fixture should use a non-sensitive synthetic UPI ID.',
  );
  assert.ok(
    nativeFixtureSource.includes("account: 'longer.clipboard-check-2026@daily007.invalid'"),
    'The longer fixture should be synthetic and distinct from the original fixture.',
  );
  assert.match(nativeFixtureSource, /const FIXTURES = \[/);
  assert.match(nativeFixtureSource, /\(Api as any\)\.adminWithdrawals = async \(\) => FIXTURES/);
  assert.match(nativeFixtureSource, /\(Api as any\)\.adminPayments = async \(\) => \[\]/);
  assert.equal((nativeFixtureSource.match(/testOnlyRedactAccount: true/g) ?? []).length, 2);
  assert.match(nativeFixtureSource, /Clipboard\.getStringAsync\(\)/);
  assert.match(nativeFixtureSource, /clipboardValues\[fixture\.id\] === fixture\.account/);
  assert.match(nativeFixtureSource, /withdrawal-upi-clipboard-check-\$\{index \+ 1\}/);
  assert.match(nativeFixtureSource, /<ScrollView[\s\S]*?pasteAreaScroll[\s\S]*?trailingScrollSpace/);
  assert.doesNotMatch(nativeFixtureSource, /TextInput|KeyboardAvoidingView/);
  assert.match(nativeFixtureSource, /<AdminPayments \/>/);
  assert.match(screenSource, /p\.testOnlyRedactAccount \? 'Test fixture hidden' : p\.account/);
  assert.doesNotMatch(nativeFixtureSource, /adminMarkWithdrawalPaid|adminWithdrawalAction|adminPaymentAction/);
});

test('the Android flow copies and verifies both native clipboard values safely', () => {
  assert.match(maestroFlow, /withdrawal-upi-copy-test/);
  assert.match(maestroFlow, /copy-withdrawal-upi-withdrawal-upi-copy-fixture/);
  assert.match(maestroFlow, /copy-withdrawal-upi-withdrawal-upi-copy-fixture-long/);
  assert.match(maestroFlow, /withdrawal-upi-clipboard-check-1/);
  assert.match(maestroFlow, /withdrawal-upi-clipboard-check-2/);
  assert.doesNotMatch(maestroFlow, /longPressOn:|text: "Paste"|hideKeyboard/);
  assert.equal(
    (maestroFlow.match(/text: "\.\*Withdrawal UPI ID copied\.\*"/g) ?? []).length,
    2,
    'The copy success selector must allow the decorative checkmark in the visible message.',
  );
  assert.match(maestroFlow, /First fixture clipboard value matches exactly/);
  assert.match(maestroFlow, /Longer fixture clipboard value matches exactly/);
  assert.doesNotMatch(maestroFlow, /upi-copy-fixture@daily007\.invalid|clipboard-check-2026|takeScreenshot|screenshot|approve|payout/i);
  assert.ok(packageSource.includes('"test:android-withdrawal-upi-copy"'));
  assert.ok(packageSource.includes('maestro/withdrawal-upi-copy'));
  assert.match(
    workflowSource,
    /run_maestro_suite withdrawal-upi-copy test:android-withdrawal-upi-copy/,
  );
});

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
    /<Msg kind="err" text=\{err\} accessibilityLabel=\{err \|\| undefined\} accessibilityLiveRegion="assertive" \/>/,
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
    /<Msg\s+kind="ok"\s+text=\{okMsg\}\s+accessibilityLabel=\{okMsg \|\| undefined\}\s+accessibilityLiveRegion="polite"\s+testID="admin-payment-action-success"\s*\/>/,
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
  assert.match(approvalAction, /showOkMsg\(action === 'approve'/);

  const rejectionStart = screenSource.indexOf('const reject = async');
  const rejectionEnd = screenSource.indexOf('\n  const showProof = async', rejectionStart);
  const rejectionAction = screenSource.slice(rejectionStart, rejectionEnd);
  assert.match(rejectionAction, /Api\.adminWithdrawalAction\(target\.id, 'reject', reason\.trim\(\)\)/);
  assert.match(rejectionAction, /Api\.adminPaymentAction\(target\.id, 'reject', reason\.trim\(\)\)/);
  assert.match(rejectionAction, /showOkMsg\(target\.kind === 'withdrawal'/);

  const payoutStart = screenSource.indexOf('const markPaid = async');
  const payoutEnd = screenSource.indexOf('\n\n  return', payoutStart);
  const payoutAction = screenSource.slice(payoutStart, payoutEnd);
  assert.match(payoutAction, /Api\.adminMarkWithdrawalPaid\(targetId\)/);
  assert.match(payoutAction, /showOkMsg\(/);
});

test('failed deposit and withdrawal actions announce an assertive error without false success', () => {
  assert.match(
    screenSource,
    /<Msg kind="err" text=\{err\} accessibilityLabel=\{err \|\| undefined\} accessibilityLiveRegion="assertive" \/>/,
    'The full failure message must be the assertive live-region label.',
  );
  assert.match(uiSource, /accessibilityLabel=\{accessibilityLabel\}/);
  assert.match(uiSource, /accessibilityLiveRegion=\{accessibilityLiveRegion\}/);

  const approvalStart = screenSource.indexOf('const act = async');
  const approvalEnd = screenSource.indexOf('\n  const reject = async', approvalStart);
  const approvalAction = screenSource.slice(approvalStart, approvalEnd);
  const approvalCatch = approvalAction.match(/catch \(e: any\) \{([\s\S]*?)\n\s*\}\n\s*finally/)?.[1];
  assert.ok(approvalCatch, 'Approval failures must be handled in their own catch path.');
  assert.match(approvalAction, /await Api\.adminPaymentAction\(id, action\)/);
  assert.match(approvalAction, /await Api\.adminWithdrawalAction\(id, action\)/);
  assert.match(approvalCatch, /Could not \$\{action\} the \$\{requestType\} request for/);
  assert.match(approvalCatch, /The request remains in this list/);
  assert.match(approvalCatch, /activate \$\{actionLabel\} for \$\{userName \|\| 'this player'\} to retry/);
  assert.doesNotMatch(approvalCatch, /showOkMsg|setAll|load\(/);

  const rejectionStart = screenSource.indexOf('const reject = async');
  const rejectionEnd = screenSource.indexOf('\n  const showProof = async', rejectionStart);
  const rejectionAction = screenSource.slice(rejectionStart, rejectionEnd);
  const rejectionCatch = rejectionAction.match(/catch \(e: any\) \{([\s\S]*?)\n\s*\}\n\s*finally/)?.[1];
  assert.ok(rejectionCatch, 'Rejection failures must be handled in their own catch path.');
  assert.match(rejectionAction, /await Api\.adminPaymentAction\(target\.id, 'reject', reason\.trim\(\)\)/);
  assert.match(rejectionAction, /await Api\.adminWithdrawalAction\(target\.id, 'reject', reason\.trim\(\)\)/);
  assert.match(rejectionCatch, /setRejectTarget\(null\)/);
  assert.match(rejectionCatch, /Could not reject the \$\{requestType\} request for/);
  assert.match(rejectionCatch, /activate REJECT for \$\{target\.userName \|\| 'this player'\} to retry/);
  assert.doesNotMatch(rejectionCatch, /showOkMsg|setAll|load\(/);

  for (const actionBlock of [approvalAction, rejectionAction]) {
    const tryBlock = actionBlock.slice(actionBlock.indexOf('try {'), actionBlock.indexOf('} catch'));
    assert.match(tryBlock, /showOkMsg\(/, 'Only the successful API path can show confirmation.');
  }

  assert.match(screenSource, /accessibilityLabel=\{`Approve \$\{p\.kind === 'withdrawal' \? 'withdrawal' : 'deposit'\} request for \$\{p\.userName \|\| 'player'\}`\}/);
  assert.match(screenSource, /accessibilityLabel=\{`Reject \$\{p\.kind === 'withdrawal' \? 'withdrawal' : 'deposit'\} request for \$\{p\.userName \|\| 'player'\}`\}/);
  assert.match(screenSource, /key=\{p\.kind \+ ':' \+ p\.id\}/);
});

test('a failed payout record announces the error and leaves the payout action available', () => {
  const payoutStart = screenSource.indexOf('const markPaid = async');
  const payoutEnd = screenSource.indexOf('\n\n  return', payoutStart);
  const payoutAction = screenSource.slice(payoutStart, payoutEnd);
  const payoutCatch = payoutAction.match(/catch \(e: any\) \{([\s\S]*?)\n\s*\}\n\s*finally/)?.[1];

  assert.ok(payoutCatch, 'Manual payout failures must be handled in their own catch path.');
  assert.match(payoutAction, /await Api\.adminMarkWithdrawalPaid\(targetId\)/);
  assert.match(payoutCatch, /setPayoutTarget\(null\)/);
  assert.match(payoutCatch, /Could not record the payout as sent for/);
  assert.match(payoutCatch, /The withdrawal remains in this list/);
  assert.match(payoutCatch, /Check its payout status before activating RECORD PAYOUT SENT again/);
  assert.doesNotMatch(payoutCatch, /showOkMsg|setAll|load\(/);
  assert.match(
    payoutAction.slice(payoutAction.indexOf('try {'), payoutAction.indexOf('} catch')),
    /showOkMsg\(/,
    'Manual payout confirmation must only follow a successful API response.',
  );
  assert.match(screenSource, /accessibilityLabel=\{`Record payout sent for \$\{p\.userName \|\| 'player'\}`\}/);
  assert.match(screenSource, /title="RECORD PAYOUT SENT"/);
});

test('approved withdrawals distinguish payout pending from a recorded payout sent', () => {
  assert.match(screenSource, /if \(status === 'paid'\) return 'Payout sent'/);
  assert.match(screenSource, /return 'Payout pending'/);
  assert.match(screenSource, /p\.kind === 'withdrawal' && p\.status === 'approved' && p\.payoutStatus !== 'paid'/);
  assert.match(screenSource, /title="RECORD PAYOUT SENT"/);
  assert.match(screenSource, /title="Record payout sent"/);
});

test('successful UPI copying announces politely without changing the focused button label', () => {
  assert.match(
    screenSource,
    /<Msg\s+key=\{`withdrawal-upi-copy-success-\$\{copyAnnouncementSequence\}`\}\s+kind="ok"\s+text=\{copiedUpiId \? 'Withdrawal UPI ID copied' : ''\}\s+accessibilityLiveRegion="polite"\s+testID="withdrawal-upi-copy-success"\s*\/>/,
    'Each confirmed copy must mount a fresh polite status message.',
  );
  assert.match(screenSource, /accessibilityLabel="Copy withdrawal UPI ID"/);
  assert.match(screenSource, /<Msg kind="err" text=\{err\} accessibilityLabel=\{err \|\| undefined\} accessibilityLiveRegion="assertive" \/>/);
});

test('repeated successful copies replay the polite announcement and leave the button available', async () => {
  const copyButtonTitle = screenSource.indexOf(
    'title={getWithdrawalUpiCopyLabel',
  );
  const copyButtonStart = screenSource.lastIndexOf('<Btn', copyButtonTitle);
  const copyButtonEnd = screenSource.indexOf('/>', copyButtonStart);
  const copyButton = screenSource.slice(copyButtonStart, copyButtonEnd + 2);
  assert.ok(copyButton, 'The withdrawal UPI copy button must remain rendered.');
  assert.match(copyButton, /accessibilityLabel="Copy withdrawal UPI ID"/);
  assert.match(copyButton, /testID=\{`copy-withdrawal-upi-\$\{p\.id\}`\}/);
  assert.match(copyButton, /onPress=/);
  assert.doesNotMatch(copyButton, /\bdisabled=/);
  assert.doesNotMatch(copyButton, /\bkey=/, 'The button must not be replaced to replay the status.');
  assert.doesNotMatch(copyButton, /setAccessibilityFocus/);
  assert.match(
    copyButton,
    /setCopyAnnouncementSequence,/,
    'Successful copies must advance the live-message key without moving focus.',
  );

  const requestId = 'withdrawal-repeat-success';
  const account = 'player.name@bank';
  const events = [];
  let copiedRequestId = null;
  let announcementSequence = 0;
  const clipboard = {
    async setStringAsync(value) {
      events.push(['clipboard', value]);
      return true;
    },
  };
  const setCopiedUpiId = (id) => {
    copiedRequestId = id;
    events.push(['copied', id]);
  };
  const setCopyAnnouncementSequence = (update) => {
    announcementSequence = update(announcementSequence);
    events.push(['announcement-sequence', announcementSequence]);
  };
  const setErr = (message) => events.push(['error', message]);

  for (const expectedSequence of [1, 2]) {
    events.length = 0;
    await copyWithdrawalUpi(
      requestId,
      account,
      clipboard,
      setCopiedUpiId,
      setErr,
      setCopyAnnouncementSequence,
    );

    assert.deepEqual(events, [
      ['copied', null],
      ['error', ''],
      ['clipboard', account],
      ['copied', requestId],
      ['announcement-sequence', expectedSequence],
    ]);
    assert.equal(getWithdrawalUpiCopyLabel(requestId, copiedRequestId), 'COPIED');
  }
  assert.equal(announcementSequence, 2);
  assert.equal(
    events.filter(([type]) => type === 'announcement-sequence').length,
    1,
    'The second successful copy must create exactly one new announcement event.',
  );
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
        () => {},
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
    () => {},
  );

  assert.deepEqual(events, [
    ['copied', null],
    ['error', ''],
    ['error', 'Could not copy this UPI ID.'],
  ]);
  assert.match(screenSource, /<Msg kind="err" text=\{err\} accessibilityLabel=\{err \|\| undefined\} accessibilityLiveRegion="assertive" \/>/);
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
    () => {},
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
    () => {},
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
    () => {},
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