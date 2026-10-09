import React from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { WalletCancellationRefundRow } from '../components/WalletCancellationRefundRow';
import { C } from '../components/ui';
import { walletTransactionAccessibilityLabel } from '../lib/wallet-transaction-display';

const FIXTURE = {
  amount: 27,
  balanceAfter: 155,
  createdAt: '2030-02-03T10:20:00.000Z',
  reason: 'tournament_cancel_refund',
  description: 'Entry fee refunded — Legacy Clash Cup (tournament cancelled)',
};

const EXPECTED_LABEL =
  'Entry fee refunded — Legacy Clash Cup (tournament cancelled). +27 coins credited. Date: 2030-02-03 10:20. Balance after: 155 coins.';

export default function WalletCancellationRefundNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  const label = walletTransactionAccessibilityLabel(FIXTURE);
  const details = [
    'Legacy Clash Cup',
    'tournament cancelled',
    '+27 coins credited',
    'Date: 2030-02-03 10:20',
    'Balance after: 155 coins',
  ];
  const eachDetailAppearsOnce = details.every(
    (detail) => label.split(detail).length - 1 === 1,
  );
  const fixtureIsValid = label === EXPECTED_LABEL && eachDetailAppearsOnce;

  return (
    <View style={styles.screen}>
      <Text testID="wallet-cancellation-refund-fixture-banner" style={styles.text}>
        Cancellation refund native accessibility fixture
      </Text>
      <WalletCancellationRefundRow item={FIXTURE} />
      <Text testID="wallet-cancellation-refund-fixture-result" style={styles.text}>
        {fixtureIsValid ? 'Refund details appear once in the row label' : 'Refund fixture is invalid'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 14, gap: 14, backgroundColor: C.bg },
  text: { color: C.text },
});
