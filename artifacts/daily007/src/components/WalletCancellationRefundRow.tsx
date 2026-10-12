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
  walletTransactionAccessibilityLabel,
  walletTransactionAmount,
  walletTransactionDescription,
} from '../lib/wallet-transaction-display';

type RefundDetail = 'description' | 'date' | 'balance' | 'amount';
type RefundTextLine = Pick<TextLayoutEventData['lines'][number], 'text' | 'y' | 'height' | 'width'>;

type CancellationRefundItem = {
  amount?: unknown;
  balanceAfter?: unknown;
  createdAt?: unknown;
  description?: unknown;
  reason?: unknown;
};

export function WalletCancellationRefundRow({
  item,
  onContentLayout,
  onDetailLayout,
  onDetailTextLayout,
}: {
  item: CancellationRefundItem;
  onContentLayout?: (height: number) => void;
  onDetailLayout?: (detail: RefundDetail, layout: { y: number; height: number; width: number }) => void;
  onDetailTextLayout?: (detail: RefundDetail, lines: RefundTextLine[]) => void;
}) {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.5;
  const description = walletTransactionDescription(item);
  const amountLabel = walletTransactionAmount(item);
  const detailProps = (detail: RefundDetail) => ({
    onLayout: (event: LayoutChangeEvent) => {
      const { y, height, width } = event.nativeEvent.layout;
      onDetailLayout?.(detail, { y, height, width });
    },
    onTextLayout: (event: { nativeEvent: TextLayoutEventData }) => {
      onDetailTextLayout?.(
        detail,
        event.nativeEvent.lines.map(({ text, y, height, width }) => ({ text, y, height, width })),
      );
    },
  });
  const amount = (
    <Text
      testID="wallet-cancellation-refund-amount"
      style={[styles.amount, { color: Number(item.amount) > 0 ? C.green : C.red }, largeText && styles.amountLarge]}
      {...detailProps('amount')}
    >
      {amountLabel}
    </Text>
  );

  return (
    <Card
      accessible
      accessibilityRole="text"
      accessibilityLabel={walletTransactionAccessibilityLabel(item)}
      testID="wallet-cancellation-refund-row"
      style={[styles.card, largeText && styles.cardLarge]}
    >
      <View
        style={[styles.content, largeText && styles.contentLarge]}
        onLayout={(event) => onContentLayout?.(event.nativeEvent.layout.height)}
      >
        <Text
          testID="wallet-cancellation-refund-description"
          style={[styles.title, largeText && styles.titleLarge]}
          {...detailProps('description')}
        >
          {description}
        </Text>
        <Text testID="wallet-cancellation-refund-date" style={styles.date} {...detailProps('date')}>
          {String(item.createdAt ?? '').slice(0, 16).replace('T', ' ')}
        </Text>
        {item.balanceAfter !== undefined && (
          <Text
            testID="wallet-cancellation-refund-balance"
            style={styles.date}
            {...detailProps('balance')}
          >
            Balance after: {String(item.balanceAfter)} coins
          </Text>
        )}
        {largeText && amount}
      </View>
      {!largeText && amount}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, minWidth: 0 },
  contentLarge: { flex: 0, width: '100%', maxWidth: '100%' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLarge: {
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    gap: 6,
  },
  title: { color: C.text, fontWeight: '700', fontSize: 14 },
  titleLarge: { width: '100%', maxWidth: '100%', flexShrink: 1 },
  date: { color: C.dim, fontSize: 11, marginTop: 3 },
  amount: { fontWeight: '900', fontSize: 16 },
  amountLarge: { width: '100%', maxWidth: '100%', flexShrink: 1, textAlign: 'left', marginTop: 3 },
});
