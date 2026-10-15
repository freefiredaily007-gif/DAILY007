import React, { useState } from 'react';
import { Redirect } from 'expo-router';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type TextLayoutEventData,
} from 'react-native';
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

const EXPECTED_DETAILS = {
  description: FIXTURE.description,
  date: '2030-02-03 10:20',
  balance: 'Balance after: 155 coins',
  amount: '+27',
} as const;

type RefundDetail = keyof typeof EXPECTED_DETAILS;
type RefundLayout = { y: number; height: number; width: number };
type RefundLine = Pick<TextLayoutEventData['lines'][number], 'text' | 'y' | 'height' | 'width'>;
type RefundDetails = Record<RefundDetail, string>;
type RefundLayouts = Record<RefundDetail, RefundLayout>;
type RefundLines = Record<RefundDetail, RefundLine[]>;

export default function WalletCancellationRefundNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <CancellationRefundFixture />;
}

export function WalletCancellationRefundVoiceOverNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <View style={styles.screen}>
      <Text testID="wallet-cancellation-refund-voiceover-fixture-banner" style={styles.text}>
        Two adjacent cancellation refunds · local fixture
      </Text>
      {VOICEOVER_FIXTURES.map(({ testID, ...item }) => (
        <WalletCancellationRefundRow key={testID} item={item} testID={testID} />
      ))}
    </View>
  );
}

const VOICEOVER_FIXTURES = [
  {
    testID: 'wallet-cancellation-refund-row-legacy-clash',
    amount: 27,
    balanceAfter: 155,
    createdAt: '2030-02-03T10:20:00.000Z',
    reason: 'tournament_cancel_refund',
    description: 'Entry fee refunded — Legacy Clash Cup (tournament cancelled)',
  },
  {
    testID: 'wallet-cancellation-refund-row-desert-duel',
    amount: 41,
    balanceAfter: 196,
    createdAt: '2030-02-03T10:21:00.000Z',
    reason: 'tournament_cancel_refund',
    description: 'Entry fee refunded — Desert Duel Cup (tournament cancelled)',
  },
] as const;

function CancellationRefundFixture() {
  const { fontScale } = useWindowDimensions();
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [layouts, setLayouts] = useState<Partial<RefundLayouts>>({});
  const [lines, setLines] = useState<Partial<RefundLines>>({});

  const label = walletTransactionAccessibilityLabel(FIXTURE);
  const accessibilityDetailsAppearOnce = [
    'Legacy Clash Cup',
    'tournament cancelled',
    '+27 coins credited',
    'Date: 2030-02-03 10:20',
    'Balance after: 155 coins',
  ].every((detail) => label.split(detail).length - 1 === 1);
  const fixtureIsValid = label === EXPECTED_LABEL && accessibilityDetailsAppearOnce;
  const hasEveryDetail = (Object.keys(EXPECTED_DETAILS) as RefundDetail[]).every((detail) => {
    const renderedText = lines[detail]?.map((line) => line.text).join('');
    return renderedText?.replace(/\s+/g, '') === EXPECTED_DETAILS[detail].replace(/\s+/g, '');
  });
  const orderedDetails: RefundDetail[] = ['description', 'date', 'balance', 'amount'];
  const detailsDoNotOverlap = orderedDetails.every((detail, index) => {
    const layout = layouts[detail];
    const nextLayout = layouts[orderedDetails[index + 1]];
    return !nextLayout || !layout || layout.y + layout.height <= nextLayout.y + 1;
  });
  const detailTextFitsBounds = orderedDetails.every((detail) => {
    const layout = layouts[detail];
    const detailLines = lines[detail];
    if (!layout || !detailLines?.length) return false;
    const lastLineBottom = detailLines.reduce(
      (bottom, line) => Math.max(bottom, line.y + line.height),
      0,
    );
    return layout.height + 1 >= lastLineBottom &&
      detailLines.every((line) => line.width <= layout.width + 1);
  });
  const detailsFitCard = contentHeight !== null &&
    orderedDetails.every((detail) => {
      const layout = layouts[detail];
      return layout !== undefined && layout.y + layout.height <= contentHeight + 1;
    });
  const layoutVerified = fontScale >= 1.5 &&
    label === EXPECTED_LABEL &&
    hasEveryDetail &&
    detailsDoNotOverlap &&
    detailTextFitsBounds &&
    detailsFitCard;

  return (
    <View style={styles.screen}>
      <Text testID="wallet-cancellation-refund-fixture-banner" style={styles.text}>
        {`Cancellation refund fixture · font scale ${fontScale.toFixed(1)}`}
      </Text>
      <WalletCancellationRefundRow
        item={FIXTURE}
        onContentLayout={setContentHeight}
        onDetailLayout={(detail, layout) => {
          setLayouts((previous) => ({ ...previous, [detail]: layout }));
        }}
        onDetailTextLayout={(detail, detailLines) => {
          setLines((previous) => ({ ...previous, [detail]: detailLines }));
        }}
      />
      <Text testID="wallet-cancellation-refund-fixture-result" style={styles.text}>
        {fixtureIsValid ? 'Refund details appear once in the row label' : 'Refund fixture is invalid'}
      </Text>
      <Text testID="wallet-cancellation-refund-large-text-result" style={styles.text}>
        {layoutVerified
          ? 'Every refund detail is visible without clipping or overlap at 1.5×'
          : 'Refund details layout check is incomplete'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 14, gap: 14, backgroundColor: C.bg },
  text: { color: C.text },
});
