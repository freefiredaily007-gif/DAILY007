import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ReadableText as Text } from './typography';
import { C } from './ui';
import { tournamentResultAccessibilityLabel } from '../lib/tournamentResultAccessibility';

type LayoutBox = { x: number; y: number; width: number; height: number };
type LayoutProbeKey =
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

export type TournamentResultLayoutProbe = (
  rank: number,
  key: LayoutProbeKey,
  value: LayoutBox | number,
) => void;

export function TournamentResultRow({
  entry,
  index,
  count,
  fontScale,
  onLayoutProbe,
}: {
  entry: any;
  index: number;
  count: number;
  fontScale: number;
  onLayoutProbe?: TournamentResultLayoutProbe;
}) {
  const gameName = String(entry.gameName || '').trim();
  const teamName = String(entry.teamName || '').trim();
  const winnerName = gameName || teamName || 'Player';
  const resultMeta = [
    teamName ? `TEAM ${teamName}` : '',
    entry.kills != null ? `${entry.kills} KILLS` : '',
  ].filter(Boolean).join(' · ');
  const avatarName = gameName || teamName || 'P';
  const rank = Number(entry.rank) || index + 1;
  const rankStyle = rank === 1
    ? s.rankGold
    : rank === 2
      ? s.rankSilver
      : rank === 3
        ? s.rankBronze
        : s.rankOther;
  const avatarColors = ['#e94721', '#65423b', '#1f675c', '#5c4b7d'];
  const largeText = fontScale >= 1.5;
  const report = (key: LayoutProbeKey) => (event: any) => {
    if (!onLayoutProbe) return;
    const value = key === 'nameLines' || key === 'detailsLines'
      ? event.nativeEvent.lines.length
      : event.nativeEvent.layout;
    onLayoutProbe(rank, key, value);
  };

  return (
    <View
      testID={`my-matches-result-${rank}-${index}`}
      accessible
      accessibilityRole="text"
      accessibilityLabel={tournamentResultAccessibilityLabel({
        rank,
        gameName,
        teamName,
        kills: entry.kills,
        prizeCoins: entry.prizeCoins,
      })}
      onLayout={onLayoutProbe ? report('row') : undefined}
      style={[
        s.resultRow,
        largeText && s.resultRowLarge,
        index === count - 1 && s.resultRowLast,
      ]}
    >
      <View
        onLayout={onLayoutProbe ? report('main') : undefined}
        style={[s.resultMain, largeText && s.resultMainLarge]}
      >
        <View
          onLayout={onLayoutProbe ? report('rank') : undefined}
          style={[s.rankMedal, rankStyle]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text
            onLayout={onLayoutProbe ? report('rankText') : undefined}
            style={s.rankNumber}
          >
            {rank}
          </Text>
        </View>
        <View
          style={[s.resultAvatar, { backgroundColor: avatarColors[index % avatarColors.length] }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={s.resultAvatarInitial}>{avatarName.charAt(0).toUpperCase()}</Text>
        </View>
        <View
          onLayout={onLayoutProbe ? report('identity') : undefined}
          style={s.resultIdentity}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text
            onLayout={onLayoutProbe ? report('name') : undefined}
            onTextLayout={onLayoutProbe ? report('nameLines') : undefined}
            style={s.resultName}
            testID={`my-matches-result-name-${rank}-${index}`}
          >
            {winnerName}
          </Text>
          {!!resultMeta && (
            <Text
              onLayout={onLayoutProbe ? report('details') : undefined}
              onTextLayout={onLayoutProbe ? report('detailsLines') : undefined}
              style={s.resultKills}
              testID={`my-matches-result-details-${rank}-${index}`}
            >
              {resultMeta}
            </Text>
          )}
        </View>
      </View>
      <View
        onLayout={onLayoutProbe ? report('prize') : undefined}
        style={[s.prizeWrap, largeText && s.prizeWrapLarge]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View
          onLayout={onLayoutProbe ? report('prizeAmountRow') : undefined}
          style={[s.prizeAmountRow, largeText && s.prizeAmountRowLarge]}
        >
          <View style={s.coinIcon}><Text style={s.coinStar}>★</Text></View>
          <Text
            onLayout={onLayoutProbe ? report('prizeAmount') : undefined}
            style={s.prizeAmount}
            testID={`my-matches-result-prize-${rank}-${index}`}
          >
            {entry.prizeCoins ?? 0}
          </Text>
        </View>
        <Text
          onLayout={onLayoutProbe ? report('prizeLabel') : undefined}
          style={s.prizeLabel}
        >
          Prize Won
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 78,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#343842',
    gap: 8,
  },
  resultRowLarge: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
  },
  resultRowLast: { borderBottomWidth: 0 },
  resultMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultMainLarge: { flex: 0, width: '100%', alignItems: 'flex-start' },
  rankMedal: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rankGold: { backgroundColor: '#f6bf24', borderColor: '#ffe17c' },
  rankSilver: { backgroundColor: '#cbd0d6', borderColor: '#f1f2f4' },
  rankBronze: { backgroundColor: '#c77b48', borderColor: '#e0a273' },
  rankOther: { backgroundColor: C.card2, borderColor: C.border },
  rankNumber: { color: '#262626', fontSize: 12, fontWeight: '900' },
  resultAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  resultAvatarInitial: { color: '#fff', fontSize: 21, fontWeight: '600' },
  resultIdentity: { flex: 1, minWidth: 0 },
  resultName: { color: C.text, fontSize: 14, fontWeight: '900', letterSpacing: 0.3, flexShrink: 1 },
  resultKills: { color: C.dim, fontSize: 9, fontWeight: '800', letterSpacing: 0.4, marginTop: 3, flexShrink: 1 },
  prizeWrap: { minWidth: 66, alignItems: 'flex-end', flexShrink: 0 },
  prizeWrapLarge: { marginLeft: 92, alignItems: 'flex-start', alignSelf: 'stretch', minWidth: 0 },
  prizeAmountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
  prizeAmountRowLarge: { justifyContent: 'flex-start', flexWrap: 'wrap' },
  coinIcon: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#ffcc42', backgroundColor: '#e79b00', alignItems: 'center', justifyContent: 'center' },
  coinStar: { color: '#fff3ad', fontSize: 10, fontWeight: '900', lineHeight: 12 },
  prizeAmount: { color: C.green, fontSize: 19, fontWeight: '900', lineHeight: 22 },
  prizeLabel: { color: '#848994', fontSize: 10, fontWeight: '600', marginTop: 4 },
});
