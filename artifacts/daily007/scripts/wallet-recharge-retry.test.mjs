import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const walletSource = await readFile(
  new URL('../src/screens/Wallet.tsx', import.meta.url),
  'utf8',
);
const walletSourceFile = ts.createSourceFile(
  'Wallet.tsx',
  walletSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const duplicatePaymentError =
  'This payment reference has already been submitted.';

function findVariableInitializer(name) {
  let initializer = null;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
    ) {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(walletSourceFile);
  assert.ok(initializer, `Expected ${name} to have an initializer.`);
  return initializer;
}

function findFunctionDeclaration(name) {
  let declaration = null;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(walletSourceFile);
  assert.ok(declaration, `Expected ${name} to be a function declaration.`);
  return declaration;
}

function compile(source, scope) {
  const javascript = ts.transpileModule(`const __value = (${source});`, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __value;`,
  )(...Object.values(scope));
}

function loadHelper(name, scope = {}) {
  return compile(findFunctionDeclaration(name).getText(walletSourceFile), scope);
}

function loadSubmitAdd(scope) {
  return compile(findVariableInitializer('submitAdd').getText(walletSourceFile), scope);
}

function createFixture({
  pages,
  createError = duplicatePaymentError,
  payerUpiId = 'player@upi',
  proof = null,
}) {
  const state = {
    amount: '100',
    payerUpiId,
    txnId: ' utr-ab12 ',
    proof,
    submitting: false,
    showSheet: true,
    ok: '',
    error: '',
    rechargeNotice: '',
    createCalls: [],
    pageCursors: [],
    loadCalls: 0,
    uploadCalls: 0,
  };
  const Api = {
    async createPayment(payload) {
      state.createCalls.push(payload);
      throw {
        response: {
          status: 409,
          data: { error: createError },
        },
      };
    },
    async myPaymentsPage(cursor) {
      state.pageCursors.push(cursor);
      const page = pages.shift();
      assert.ok(page, `Unexpected payment-history page request at cursor ${cursor}.`);
      return page;
    },
  };
  const isDuplicatePaymentReferenceError = loadHelper(
    'isDuplicatePaymentReferenceError',
    { DUPLICATE_PAYMENT_REFERENCE_ERROR: duplicatePaymentError },
  );
  const normalizeWalletPaymentReference = loadHelper('normalizeWalletPaymentReference');
  const findExistingPaymentByReference = loadHelper(
    'findExistingPaymentByReference',
    { Api, normalizeWalletPaymentReference },
  );
  const walletPaymentStatusLabel = loadHelper('walletPaymentStatusLabel');
  const submitAdd = loadSubmitAdd({
    PAYER_UPI_ID_PATTERN: /^[a-zA-Z0-9._-]{2,100}@[a-zA-Z0-9.-]{2,100}$/,
    INVALID_PAYER_UPI_ID_MESSAGE:
      'Use 2–100 letters, numbers, dots, underscores, or hyphens before @ and 2–100 letters, numbers, dots, or hyphens after it (for example, name@upi).',
    rechargeEnabled: true,
    paymentUpi: 'merchant@upi',
    paymentQr: 'https://example.test/qr.png',
    coins: 100,
    minPurchase: 1,
    maxPurchase: 5000,
    payerUpiId: state.payerUpiId,
    txnId: state.txnId,
    proof: state.proof,
    setSubmitting: (value) => { state.submitting = value; },
    setError: (value) => { state.error = value; },
    setOk: (value) => { state.ok = value; },
    setRechargeNotice: (value) => { state.rechargeNotice = value; },
    setShowSheet: (value) => { state.showSheet = value; },
    setAmount: (value) => { state.amount = value; },
    setPayerUpiId: (value) => { state.payerUpiId = value; },
    setTxnId: (value) => { state.txnId = value; },
    setProof: (value) => { state.proof = value; },
    uploadWalletImage: async () => {
      state.uploadCalls += 1;
      throw new Error('No payment proof should be uploaded in this fixture.');
    },
    Api,
    apiError: (error) => error?.response?.data?.error ?? error?.message ?? 'Network error.',
    isDuplicatePaymentReferenceError,
    findExistingPaymentByReference,
    walletPaymentStatusLabel,
    load: async () => { state.loadCalls += 1; },
  });
  return { state, submitAdd };
}

test('a malformed payer UPI ID is rejected before upload or payment creation', async () => {
  const { state, submitAdd } = createFixture({
    pages: [],
    payerUpiId: 'payer name@upi',
    proof: { uri: 'file:///payment-proof.png' },
  });

  await submitAdd();

  assert.equal(state.createCalls.length, 0, 'Do not send malformed payer IDs to the API.');
  assert.equal(state.uploadCalls, 0, 'Do not upload proof for a malformed payer ID.');
  assert.match(state.error, /Use 2–100/);
  assert.equal(state.showSheet, true, 'Keep the form open so the player can correct the ID.');
  assert.equal(state.submitting, false);
});

test('a duplicate recharge retry refreshes and identifies the existing request status', async () => {
  const existingPayment = {
    id: 'payment-original',
    txnId: 'UTR-AB12',
    status: 'pending',
  };
  const { state, submitAdd } = createFixture({
    pages: [
      {
        items: [{ id: 'payment-other', txnId: 'UTR-OTHER', status: 'approved' }],
        nextCursor: 'older-payments',
      },
      { items: [existingPayment], nextCursor: null },
    ],
  });

  await submitAdd();

  assert.equal(state.createCalls.length, 1, 'The client must not repeat the payment creation request.');
  assert.deepEqual(state.createCalls[0], {
    coins: 100,
    payerUpiId: 'player@upi',
    txnId: 'utr-ab12',
    reference: 'utr-ab12',
  });
  assert.deepEqual(state.pageCursors, [undefined, 'older-payments']);
  assert.equal(state.loadCalls, 1, 'Wallet history should refresh after reconciling the conflict.');
  assert.equal(
    state.ok,
    'Your recharge request was already saved. Current status: Pending Admin approval. Check Wallet history for the request.',
  );
  assert.match(walletSource, /<Msg kind="ok" text=\{ok\} \/>/);
  assert.equal(state.showSheet, false);
  assert.equal(state.amount, '');
  assert.equal(state.payerUpiId, '');
  assert.equal(state.txnId, '');
  assert.equal(state.error, '');
  assert.equal(state.rechargeNotice, '');
  assert.equal(state.submitting, false);
});

test('a duplicate reference with no matching player request is not treated as a saved deposit', async () => {
  const { state, submitAdd } = createFixture({
    pages: [{ items: [], nextCursor: null }],
  });

  await submitAdd();

  assert.equal(state.createCalls.length, 1);
  assert.equal(state.loadCalls, 1);
  assert.equal(state.showSheet, true, 'Keep the form open so the player can review the transaction ID.');
  assert.equal(state.ok, '');
  assert.match(state.rechargeNotice, /no matching request was found in your Wallet/i);
  assert.match(state.rechargeNotice, /No new request was created/);
  assert.match(
    walletSource,
    /accessibilityRole="alert"[\s\S]*?accessibilityLiveRegion="polite"[\s\S]*?testID="wallet-recharge-reconciliation"/,
  );
  assert.equal(state.error, '');
  assert.equal(state.submitting, false);
});

test('a different recharge conflict is not misreported as a duplicate reference', async () => {
  const { state, submitAdd } = createFixture({
    createError: 'You already have a pending coin recharge request.',
    pages: [],
  });

  await submitAdd();

  assert.equal(state.createCalls.length, 1);
  assert.deepEqual(state.pageCursors, [], 'Only duplicate-reference conflicts should trigger reconciliation.');
  assert.equal(state.loadCalls, 0);
  assert.equal(state.showSheet, true);
  assert.equal(state.ok, '');
  assert.equal(state.rechargeNotice, '');
  assert.equal(state.error, 'You already have a pending coin recharge request.');
  assert.equal(state.submitting, false);
});

