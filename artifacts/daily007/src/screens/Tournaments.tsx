import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../lib/api';
import { C, Loading, Empty, GCard, MatchCard, SectionTitle, Msg } from '../components/ui';
import { apiError } from '../lib/api';
import { useApp } from '../App';

export default function Tournaments() {
  const nav: any = useNavigation();
  const route: any = useRoute();
  const { user } = useApp();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const mode = route?.params?.mode as string | undefined;

  const load = useCallback(async () => {
    try {
      const list = await api.tournaments('?enabled=true');
      setItems(Array.isArray(list) ? list : []);
      setError('');
    } catch (e) { setError(apiError(e)); }
    setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load, mode]);

  const filtered = mode ? items.filter((t) => {
    const matchMode = String(t.mode || '').toLowerCase();
    const teamType = String(t.teamType || '').toLowerCase();
    const requested = mode.toLowerCase();
    if (requested === 'battle royale solo') return matchMode.includes('battle royale') && teamType === 'solo';
    if (requested === 'battle royale squad') return matchMode.includes('battle royale') && teamType === 'squad';
    return matchMode === requested;
  }) : items;
  const upcoming = filtered.filter((t) => !['completed', 'cancelled'].includes(String(t.status || 'upcoming').toLowerCase()));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (loading) return <Loading />;

  return (
    <View style={s.root}>
      <FlatList
        data={upcoming}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.neon} />}
        ListHeaderComponent={
          <View>
            <SectionTitle accent={C.neon}>{mode ? `${mode.toUpperCase()} MATCHES` : 'ALL UPCOMING MATCHES'}</SectionTitle>
            {!!error && <Msg kind="err" text={`Could not load tournaments: ${error}`} />}
            {!mode && (
              <View style={s.modeRow}>
                {['Battle Royale Solo', 'Battle Royale', 'Clash Squad'].map((m) => (
                  <Text key={m} style={[s.modeChip, { borderColor: mode === m ? C.neon : C.border, color: mode === m ? C.neon : C.sub }]}>{m}</Text>
                ))}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={<Empty icon="🎮" text={error ? 'Tournament data is unavailable right now. Pull to refresh and try again.' : 'No upcoming tournaments are available right now.'} />}
        renderItem={({ item }) => (
          <MatchCard
            t={item}
            onPress={() => nav.navigate('TDetail', { id: item.id })}
          />
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  modeChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, fontSize: 11, fontWeight: '800', overflow: 'hidden' },
});
