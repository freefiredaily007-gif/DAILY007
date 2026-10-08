import React from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type TextLayoutEventData,
} from 'react-native';
import { ReadableText as Text } from './typography';
import { C, Card } from './ui';
import {
  walletRejectedDepositAccessibilityLabel,
  walletRejectedDepositReasonText,
} from '../lib/wallet-transaction-display';

type RejectedDepositItem = {
  description?: string;
  amount?: unknown;
  coins: unknown;
  createdAt?: unknown;
  reference?: unknown;
  reviewReason?: unknown;
};

type ReasonLine = Pick<TextLayoutEventData['lines'][number], 'text' | 'y' | 'height'>;

export function WalletRejectedDepositRow({
  item,
  depositAmountLabel,
  onContentLayout,
  onReasonLayout,
  onReasonTextLayout,
}: {
  item: RejectedDepositItem;
  depositAmountLabel: string;
  onContentLayout?: (height: number) => void;
  onReasonLayout?: (layout: { y: number; height: number }) => void;
  onReasonTextLayout?: (lines: ReasonLine[]) => void;
}) {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.5;
  const reason = walletRejectedDepositReasonText(item.reviewReason);
  const accessibilityLabel = walletRejectedDepositAccessibilityLabel({
    rupeeAmount: depositAmountLabel,
    coins: item.coins,
    createdAt: item.createdAt,
    reference: item.reference,
    reviewReason: item.reviewReason,
  });

  return (
    <Card
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      testID="wallet-rejected-deposit-row"
      style={[
        {
          flexDirection: largeText ? 'column' : 'row',
          alignItems: largeText ? 'stretch' : 'center',
          justifyContent: largeText ? 'flex-start' : 'space-between',
        },
        largeText && styles.largeCard,
      ]}
    >
      <View
        style={[{ flex: 1, minWidth: 0 }, largeText && styles.contentLarge]}
        onLayout={(event) => onContentLayout?.(event.nativeEvent.layout.height)}
      >
        <View style={[styles.header, largeText && styles.headerLarge]}>
          <Text style={[styles.title, largeText && styles.titleLarge]}>
            {item.description || 'Coin recharge request'}
          </Text>
          <View style={[styles.status, largeText && styles.statusLarge]}>
            <Text style={styles.statusText}>REJECTED</Text>
          </View>
        </View>
        <Text style={styles.date}>
          {String(item.createdAt ?? '').slice(0, 16).replace('T', ' ')}
        </Text>
        <Text style={styles.date}>{String(item.coins ?? 0)} coins</Text>
        {item.reference ? <Text style={styles.date}>UTR: {String(item.reference)}</Text> : null}
        <Text
          testID="wallet-rejected-deposit-reason"
          style={[styles.reason, largeText && styles.reasonLarge]}
          onLayout={(event: LayoutChangeEvent) => {
            const { y, height } = event.nativeEvent.layout;
            onReasonLayout?.({ y, height });
          }}
          onTextLayout={(event) => {
            onReasonTextLayout?.(
              event.nativeEvent.lines.map(({ text, y, height }) => ({ text, y, height })),
            );
          }}
        >
          Reason: {reason}
        </Text>
      </View>
      <Text
        style={[
          styles.amount,
          { color: Number(item.amount) > 0 ? C.green : C.red },
          largeText && styles.amountLarge,
        ]}
      >
        {depositAmountLabel}
      </Text>
    </Card>
  );
}
const styles = StyleSheet.create({
  largeCard: { gap: 6 },
  contentLarge: { flex: 0, width: '100%', maxWidth: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerLarge: { flexDirection: 'column', alignItems: 'flex-start', width: '100%' },
  title: { color: C.text, fontWeight: '700', fontSize: 14 },
  titleLarge: { width: '100%', maxWidth: '100%', flexShrink: 1 },
  date: { color: C.dim, fontSize: 11, marginTop: 3 },
  status: {
    backgroundColor: C.red + '22',
    borderColor: C.red,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusLarge: { maxWidth: '100%', flexWrap: 'wrap' },
  statusText: { maxWidth: '100%', flexShrink: 1, color: C.red, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  reason: { color: C.red, fontSize: 11, marginTop: 3, lineHeight: 15 },
  reasonLarge: { width: '100%', maxWidth: '100%', flexShrink: 1 },
  amount: { fontWeight: '900', fontSize: 16 },
  amountLarge: { width: '100%', maxWidth: '100%', flexShrink: 1, textAlign: 'left' },
});
