import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Redirect } from 'expo-router';
import { ReadableText as Text } from '../components/typography';
import {
  TournamentResultRow,
  type TournamentResultLayoutProbe,
} from '../components/TournamentResultRow';
import { C } from '../components/ui';
import { MY_MATCHES_TEXT_SCALE_RESULTS } from '../lib/myMatchesTextScaleFixture';

type LayoutBox = { x: number; y: number; width: number; height: number };
type LayoutKey =
  | 'row'
  | 'main'
  | 'rank'
  | 'rankText'
  | 'identity'
  | 'name'
  | 'nameLines'
  | 'details'
  | 'detailsLines'
  | 'prize'
  | 'prizeAmountRow'
  | 'prizeAmount'
  | 'prizeLabel';
type LayoutValue = LayoutBox | number;
type RowMeasurements = Partial<Record<LayoutKey, LayoutValue>>;

function fitsWithin(child: LayoutBox, parent: LayoutBox) {
  return child.x >= -1
    && child.y >= -1
    && child.x + child.width <= parent.width + 1
    && child.y + child.height <= parent.height + 1;
}

export default function MyMatchesNativeTextScaleTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <NativeFixture />;
}

function NativeFixture() {
  const { fontScale } = useWindowDimensions();
  const [measurements, setMeasurements] = useState<Record<number, RowMeasurements>>({});
  const reportLayout = useCallback<TournamentResultLayoutProbe>((rank, key, value) => {
    setMeasurements((current) => ({
      ...current,
      [rank]: { ...current[rank], [key]: value },
    }));
  }, []);
  const reportsComplete = MY_MATCHES_TEXT_SCALE_RESULTS.every((entry) => {
    const result = measurements[entry.rank];
    return result?.row
      && result.main
      && result.rank
      && result.rankText
      && result.identity
      && result.name
      && result.nameLines
      && result.details
      && result.detailsLines
      && result.prize
      && result.prizeAmountRow
      && result.prizeAmount
      && result.prizeLabel;
  });
  const allRowsFit = reportsComplete && MY_MATCHES_TEXT_SCALE_RESULTS.every((entry) => {
    const result = measurements[entry.rank]!;
    const row = result.row as LayoutBox;
    const main = result.main as LayoutBox;
    const rank = result.rank as LayoutBox;
    const rankText = result.rankText as LayoutBox;
    const identity = result.identity as LayoutBox;
    const name = result.name as LayoutBox;
    const details = result.details as LayoutBox;
    const prize = result.prize as LayoutBox;
    const prizeAmountRow = result.prizeAmountRow as LayoutBox;
    const prizeAmount = result.prizeAmount as LayoutBox;
    const prizeLabel = result.prizeLabel as LayoutBox;
    return Number(result.nameLines) > 1
      && Number(result.detailsLines) > 1
      && fitsWithin(main, row)
      && fitsWithin(rank, main)
      && fitsWithin(rankText, rank)
      && fitsWithin(identity, main)
      && fitsWithin(name, identity)
      && fitsWithin(details, identity)
      && details.y >= name.y + name.height
      && fitsWithin(prize, row)
      && prize.y >= main.y + main.height
      && fitsWithin(prizeAmountRow, prize)
      && fitsWithin(prizeAmount, prizeAmountRow)
      && fitsWithin(prizeLabel, prize)
      && prizeLabel.y >= prizeAmountRow.y + prizeAmountRow.height;
  });
  const completedRows = Object.values(measurements).filter((result) =>
    result.row
      && result.main
      && result.rank
      && result.rankText
      && result.identity
      && result.name
      && result.nameLines
      && result.details
      && result.detailsLines
      && result.prize
      && result.prizeAmountRow
      && result.prizeAmount
      && result.prizeLabel,
  ).length;
  const checkText = fontScale < 2
    ? 'Set Android text scale to 2.00×'
    : allRowsFit
      ? 'All 10 result rows fit within bounds at 2.00×'
      : reportsComplete
        ? 'Result row layout failed at 2.00×'
        : `Checking result layout: ${completedRows} of 10 rows`;

  return (
    <View style={styles.screen}>
      <Text testID="my-matches-text-scale-banner" style={styles.banner}>
        My Matches result fixture · font scale {fontScale.toFixed(2)}
      </Text>
      <Text testID="my-matches-layout-check" style={styles.check}>
        {checkText}
      </Text>
      <FlatList
        testID="my-matches-text-scale-results"
        data={MY_MATCHES_TEXT_SCALE_RESULTS}
        keyExtractor={(item) => String(item.rank)}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <TournamentResultRow
            entry={item}
            index={index}
            count={MY_MATCHES_TEXT_SCALE_RESULTS.length}
            fontScale={fontScale}
            onLayoutProbe={reportLayout}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, backgroundColor: C.bg, padding: 12 },
  banner: { color: C.sub, fontSize: 10, paddingBottom: 6 },
  check: { color: C.green, fontSize: 12, fontWeight: '800', paddingBottom: 6 },
  list: { padding: 10, borderRadius: 10, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border },
});
