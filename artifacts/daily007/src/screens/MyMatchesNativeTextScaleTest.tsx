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
type LayoutKey = 'row' | 'main' | 'nameLines' | 'detailsLines' | 'prize';
type LayoutValue = LayoutBox | number;
type RowMeasurements = Partial<Record<LayoutKey, LayoutValue>>;

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
    return result?.row && result.main && result.nameLines && result.detailsLines && result.prize;
  });
  const allRowsFit = reportsComplete && MY_MATCHES_TEXT_SCALE_RESULTS.every((entry) => {
    const result = measurements[entry.rank]!;
    const row = result.row as LayoutBox;
    const main = result.main as LayoutBox;
    const prize = result.prize as LayoutBox;
    return Number(result.nameLines) > 1
      && Number(result.detailsLines) > 1
      && main.width <= row.width
      && prize.x + prize.width <= row.width + 1
      && prize.y >= main.y + main.height
      && prize.y + prize.height <= row.height + 1;
  });
  const completedRows = Object.values(measurements).filter((result) =>
    result.row && result.main && result.nameLines && result.detailsLines && result.prize,
  ).length;
  const checkText = fontScale < 1.5
    ? 'Set Android text scale to 1.50×'
    : allRowsFit
      ? 'All 10 result rows wrap within bounds at 1.50×'
      : reportsComplete
        ? 'Result row layout failed at 1.50×'
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
