import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isValidWalletUtr, sanitizeWalletUtrInput } from '../src/lib/wallet-utr.ts';

test('UTR input accepts only ASCII digits and truncates at 12 characters', () => {
  assert.equal(sanitizeWalletUtrInput('12a3-456 7890123'), '123456789012');
  assert.equal(sanitizeWalletUtrInput('１２3'), '3');
});

test('UTR validation requires exactly 12 digits', () => {
  assert.equal(isValidWalletUtr('123456789012'), true);
  assert.equal(isValidWalletUtr('12345678901'), false);
  assert.equal(isValidWalletUtr('1234567890123'), false);
  assert.equal(isValidWalletUtr('12345678901a'), false);
  assert.equal(isValidWalletUtr(''), false);
});

test('Add Coins uses the UTR label, numeric keyboard, 12-character limit, and inline validation', async () => {
  const walletSource = await readFile(
    new URL('../src/screens/Wallet.tsx', import.meta.url),
    'utf8',
  );

  assert.match(walletSource, /testID="wallet-utr"[\s\S]*?placeholder="Enter UTR"[\s\S]*?keyboardType="number-pad"[\s\S]*?maxLength=\{12\}/);
  assert.match(walletSource, /onChangeText=\{\(value\) => \{\s*const sanitized = sanitizeWalletUtrInput\(value\)/);
  assert.match(walletSource, /if \(!isValidWalletUtr\(txnId\)\)/);
  assert.match(walletSource, /testID="wallet-utr-error"[\s\S]*?\{utrError\}/);
  assert.match(walletSource, /setUtrError\('UTR number must be exactly 12 digits'\)/);
  assert.doesNotMatch(walletSource, /placeholder="Transaction ID \/ reference"/);
});

test('Wallet history and Admin payment review display the unchanged payment reference', async () => {
  const walletSource = await readFile(
    new URL('../src/screens/Wallet.tsx', import.meta.url),
    'utf8',
  );
  const adminPaymentsSource = await readFile(
    new URL('../src/screens/AdminPayments.tsx', import.meta.url),
    'utf8',
  );

  assert.match(walletSource, /reference: payment\.txnId/);
  assert.match(walletSource, /item\.isRequest && item\.reference && <Text[^>]*>UTR: \{item\.reference\}<\/Text>/);
  assert.match(
    adminPaymentsSource,
    /Transaction ID: \{p\.txnId \|\| p\.transactionId \|\| p\.reference \|\| '—'\}/,
  );
});
