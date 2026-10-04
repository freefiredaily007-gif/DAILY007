import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { Api } from '../lib/api';
import { Card, C, Empty, Loading } from '../components/ui';

export default function Leaderboard() {
  const { fontScale } = useWindowDimensions();
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { Api.leaderboard().then(setRows).catch(() => setRows([])); }, []);
  const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <Text style={st.h}>🏆 LEADERBOARD</Text>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty text="No players yet." /> : rows.map((r, i) => (
        <View key={r.id || i} style={[st.row, i < 3 && { borderColor: (i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : '#cd7f32') + '88' }]}>
          <Text style={[st.rank, fontScale >= 1.5 && st.rankLarge]}>{medal(i)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={st.name}>{r.name}</Text>
            <Text style={st.sub}>{r.matches ?? 0} matches • {r.wins ?? 0} wins • {r.kills ?? 0} kills</Text>
          </View>
          <Text style={st.prize}>🪙 {r.prizeCoins ?? 0}</Text>
        </View>
      ))}
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}
const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 30 },
  h: { color: C.text, fontSize: 20, fontWeight: '900', marginBottom: 12, letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, marginBottom: 8, gap: 10 },
  rank: { fontSize: 18, width: 36, fontWeight: '900', color: C.orange },
  rankLarge: { width: 56, minWidth: 56 },
  name: { color: C.text, fontWeight: '800', fontSize: 14 },
  sub: { color: C.sub, fontSize: 11, marginTop: 2 },
  prize: { color: C.green, fontWeight: '900', fontSize: 14 },
});
