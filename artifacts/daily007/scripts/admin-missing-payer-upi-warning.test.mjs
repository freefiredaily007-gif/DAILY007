import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const screenSource = await readFile(new URL('../src/screens/AdminPayments.tsx', import.meta.url), 'utf8');
const routeSource = await readFile(
  new URL('../../api-server/src/routes/daily007-compat-extra.ts', import.meta.url),
  'utf8',
);

test('pending legacy recharge requests show a warning without disabling review decisions', () => {
  assert.match(
    screenSource,
    /p\.kind === 'payment' && p\.status === 'pending' &&\s*\(p\.payerUpiIdMissing === true \|\| !String\(p\.payerUpiId \?\? ''\)\.trim\(\)\)/,
  );
  assert.match(screenSource, /accessibilityRole="alert"/);
  assert.match(screenSource, /testID=\{`missing-payer-upi-warning-\$\{p\.id\}`\}/);
  assert.match(
    screenSource,
    /No payer UPI ID was recorded for this request\. Verify the payment details before approving\./,
  );
  assert.match(screenSource, /title="APPROVE"/);
  assert.match(screenSource, /title="REJECT"/);
});

test('admin payment reads flag blank historical payer UPI IDs without writing them', () => {
  assert.match(
    routeSource,
    /p\.payer_upi_id AS "payerUpiId",\s*NULLIF\(BTRIM\(p\.payer_upi_id\), ''\) IS NULL AS "payerUpiIdMissing"/,
  );
  const paymentActionUpdate = routeSource.match(
    /`UPDATE \$\{table\} SET status = \$2, reviewed_by = \$3, reviewed_at = now\(\),\s*review_reason = \$4[\s\S]*?WHERE id = \$1 RETURNING \*`/,
  );
  assert.ok(paymentActionUpdate, 'the existing review update should remain present');
  assert.doesNotMatch(paymentActionUpdate[0], /payer_upi_id/i);
});
