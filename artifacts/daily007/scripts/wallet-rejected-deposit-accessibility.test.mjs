import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import ts from 'typescript';
import {
  walletRejectedDepositAccessibilityLabel,
  walletRejectedDepositReasonText,
  walletTransactionAmount,
  walletTransactionDescription,
} from '../src/lib/wallet-transaction-display.ts';
import { depositAmountInr } from '../src/lib/coins.ts';

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
const walletScreenSourceFile = ts.createSourceFile(
  'Wallet.tsx',
  walletScreenSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const rejectedDepositRowSourceFile = ts.createSourceFile(
  'WalletRejectedDepositRow.tsx',
  rejectedDepositRowSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function findVariableInitializer(sourceFile, name) {
  let initializer;
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
  visit(sourceFile);
  assert.ok(initializer, `Expected ${name} to have an initializer.`);
  return initializer;
}

function findFlatListRenderItem() {
  let renderItem;
  function visit(node) {
    if (
      ts.isJsxAttribute(node)
      && node.name.getText(walletScreenSourceFile) === 'renderItem'
      && node.initializer
      && ts.isJsxExpression(node.initializer)
      && node.initializer.expression
      && ts.isArrowFunction(node.initializer.expression)
    ) {
      renderItem = node.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(walletScreenSourceFile);
  assert.ok(renderItem, 'Wallet should render its transaction rows through FlatList.');
  return renderItem;
}

function findFunctionDeclaration(sourceFile, name) {
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(declaration, `Expected ${name} to be a function declaration.`);
  return declaration;
}

function evaluateExpression(node, sourceFile, scope) {
  const javascript = ts.transpileModule(
    `const __value = (${node.getText(sourceFile)});`,
    {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  return new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __value;`,
  )(...Object.values(scope));
}

function createProductionRejectedDepositRow() {
  const View = ({ children }) => React.createElement('div', null, children);
  const Text = ({ children, testID }) => React.createElement(
    'span',
    testID ? { 'data-testid': testID } : null,
    children,
  );
  const Card = ({ children, accessibilityRole, accessibilityLabel, testID }) => React.createElement(
    'article',
    {
      role: accessibilityRole,
      'aria-label': accessibilityLabel,
      'data-testid': testID,
    },
    children,
  );
  const javascript = ts.transpileModule(
    findFunctionDeclaration(rejectedDepositRowSourceFile, 'WalletRejectedDepositRow')
      .getText(rejectedDepositRowSourceFile)
      .replace(/^export\s+/, ''),
    {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  return new Function(
    'React',
    'StyleSheet',
    'View',
    'useWindowDimensions',
    'Text',
    'C',
    'Card',
    'styles',
    'walletRejectedDepositAccessibilityLabel',
    'walletRejectedDepositReasonText',
    `${javascript}\nreturn WalletRejectedDepositRow;`,
  )(
    React,
    { create: () => ({}) },
    View,
    () => ({ fontScale: 1 }),
    Text,
    { green: 'green', red: 'red' },
    Card,
    {},
    walletRejectedDepositAccessibilityLabel,
    walletRejectedDepositReasonText,
  );
}

function renderWalletTransaction(item) {
  const Row = createProductionRejectedDepositRow();
  const renderItem = evaluateExpression(
    findFlatListRenderItem(),
    walletScreenSourceFile,
    {
      React,
      WalletRejectedDepositRow: Row,
      walletTransactionDescription,
      walletTransactionAmount,
      depositAmountInr,
      coinToMoneyRate: 1,
      C: { green: 'green', red: 'red' },
      Card: () => null,
      Text: () => null,
      View: () => null,
      s: {},
      fontScale: 1,
    },
  );
  return renderToStaticMarkup(renderItem({ item, index: 0 }));
}

function getVisibleText(markup) {
  return markup
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

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

test('Wallet shows fallback and accessible rejection reasons for legacy API records', () => {
  const olderApiRecords = [
    { id: 'omitted', status: 'rejected', coins: 50, amount: 50 },
    { id: 'null', status: 'rejected', coins: 50, amount: 50, reviewReason: null },
    { id: 'empty', status: 'rejected', coins: 50, amount: 50, reviewReason: '' },
    { id: 'whitespace', status: 'rejected', coins: 50, amount: 50, reviewReason: ' \t\n ' },
  ];
  const walletRequestItems = evaluateExpression(
    findVariableInitializer(walletScreenSourceFile, 'pendingPays'),
    walletScreenSourceFile,
    { pays: olderApiRecords },
  );

  assert.match(walletScreenSource, /data=\{txns\}/);
  assert.match(walletScreenSource, /setTxns\(merged\)/);
  assert.match(
    walletScreenSource,
    /const merged = \[\.\.\.pendingPays, \.\.\.pendingWds, \.\.\.data\]/,
  );
  assert.equal(walletRequestItems.length, olderApiRecords.length);

  for (const item of walletRequestItems) {
    assert.equal(item.status, 'rejected');
    assert.equal(item.isRequest, true);
    assert.equal(item.requestType, 'payment');

    const markup = renderWalletTransaction(item);
    const visibleText = getVisibleText(markup);
    assert.match(visibleText, /Reason: No rejection reason was provided\./, item.id);
    assert.equal(
      (visibleText.match(/No rejection reason was provided\./g) ?? []).length,
      1,
      `Wallet should show one fallback for the ${item.id} API record.`,
    );
    assert.match(markup, /role="text"/);
    assert.match(
      markup,
      /aria-label="Deposit request\. Status: Rejected\. Original rupee amount: ₹50\. Coin amount: 50 coins\. Rejection reason: No rejection reason was provided\."/,
      `Wallet should expose the fallback in the accessible label for the ${item.id} API record.`,
    );
  }
});

test('Wallet preserves the meaning of a nonblank administrator rejection reason', () => {
  const [item] = evaluateExpression(
    findVariableInitializer(walletScreenSourceFile, 'pendingPays'),
    walletScreenSourceFile,
    {
      pays: [{
        id: 'administrator-reason',
        status: 'rejected',
        coins: 50,
        amount: 50,
        reviewReason: '  The UPI   reference did not match. ',
      }],
    },
  );

  const markup = renderWalletTransaction(item);
  assert.match(getVisibleText(markup), /Reason: The UPI reference did not match\./);
  assert.match(
    markup,
    /aria-label="Deposit request\. Status: Rejected\. Original rupee amount: ₹50\. Coin amount: 50 coins\. Rejection reason: The UPI reference did not match\."/,
  );
  assert.doesNotMatch(getVisibleText(markup), /No rejection reason was provided\./);
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
