import React, { useState } from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { WalletRejectedDepositRow } from '../components/WalletRejectedDepositRow';
import { C } from '../components/ui';

const FIXTURE = {
  description: 'Coin recharge request',
  amount: 1250,
  coins: 250,
  createdAt: '2026-10-05T10:12:30.000Z',
  reference: 'TEST-UPI-554',
  reviewReason:
    'The UPI reference on the payment receipt does not match the reference in the request. Contact support and include your payment date to request another review.',
};

const EXPECTED_VISIBLE_REASON = `Reason: ${FIXTURE.reviewReason}`;

type ReasonLine = { text: string; y: number; height: number };

export default function WalletRejectedDepositNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <RejectedDepositFixture />;
}

function RejectedDepositFixture() {
  const { fontScale } = useWindowDimensions();
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [reasonLayout, setReasonLayout] = useState<{ y: number; height: number } | null>(null);
  const [reasonLines, setReasonLines] = useState<ReasonLine[] | null>(null);

  const fullReasonIsRendered = reasonLines?.map((line) => line.text).join('').replace(/\s+/g, '') ===
    EXPECTED_VISIBLE_REASON.replace(/\s+/g, '');
  const lineCount = reasonLines?.length ?? 0;
  const lastLineBottom = reasonLines?.reduce(
    (bottom, line) => Math.max(bottom, line.y + line.height),
    0,
  ) ?? 0;
  const reasonFitsTextBounds = reasonLayout !== null &&
    reasonLayout.height + 1 >= lastLineBottom;
  const reasonFitsContent = contentHeight !== null && reasonLayout !== null &&
    reasonLayout.y + reasonLayout.height <= contentHeight + 1;
  const layoutVerified = fontScale >= 1.5 &&
    lineCount > 1 &&
    fullReasonIsRendered &&
    reasonFitsTextBounds &&
    reasonFitsContent;

  return (
    <View style={styles.screen}>
      <Text testID="wallet-rejected-deposit-fixture-banner" style={styles.banner}>
        Local rejected-payment fixture · font scale {fontScale.toFixed(1)}
      </Text>
      <WalletRejectedDepositRow
        item={FIXTURE}
        depositAmountLabel="₹1,250"
        onContentLayout={setContentHeight}
        onReasonLayout={setReasonLayout}
        onReasonTextLayout={setReasonLines}
      />
      <Text testID="wallet-rejected-deposit-layout-check" style={styles.check}>
        {layoutVerified
          ? 'Reason wraps fully without clipping'
          : 'Reason layout check is incomplete'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 14,
    gap: 14,
    backgroundColor: C.bg,
  },
  banner: { color: C.text },
  check: { color: C.text },
});
