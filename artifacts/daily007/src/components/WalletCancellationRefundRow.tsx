import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { ReadableText as Text } from './typography';
import { C, Card } from './ui';
import {
  walletTransactionAccessibilityLabel,
  walletTransactionAmount,
  walletTransactionDescription,
} from '../lib/wallet-transaction-display';

type CancellationRefundItem = {
  amount?: unknown;
  balanceAfter?: unknown;
  createdAt?: unknown;
  description?: unknown;
  reason?: unknown;
};

export function WalletCancellationRefundRow({ item }: { item: CancellationRefundItem }) {
  const { fontScale } = useWindowDimensions();
  const description = walletTransactionDescription(item);
  const amountLabel = walletTransactionAmount(item);

  return (
    <Card
      accessible
      accessibilityRole="text"
      accessibilityLabel={walletTransactionAccessibilityLabel(item)}
      testID="wallet-cancellation-refund-row"
      style={styles.card}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={[styles.header, fontScale >= 1.5 && styles.headerLarge]}>
          <Text style={[styles.title, fontScale >= 1.5 && styles.titleLarge]}>{description}</Text>
        </View>
        <Text style={styles.date}>
          {String(item.createdAt ?? '').slice(0, 16).replace('T', ' ')}
        </Text>
        {item.balanceAfter !== undefined && (
          <Text style={styles.date}>Balance after: {String(item.balanceAfter)} coins</Text>
        )}
      </View>
      <Text style={[styles.amount, { color: Number(item.amount) > 0 ? C.green : C.red }]}>
        {amountLabel}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerLarge: { flexDirection: 'column', alignItems: 'flex-start', width: '100%' },
  title: { color: C.text, fontWeight: '700', fontSize: 14 },
  titleLarge: { width: '100%', maxWidth: '100%', flexShrink: 1 },
  date: { color: C.dim, fontSize: 11, marginTop: 3 },
  amount: { fontWeight: '900', fontSize: 16 },
});
