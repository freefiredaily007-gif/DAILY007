import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../lib/api';
import { C, Loading, Empty, GCard, MatchCard, SectionTitle } from '../components/ui';
import { useApp } from '../App';

export default function Tournaments() {
  const nav: any = useNavigation();
  const route: any = useRoute();
  const { user } = useApp();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const mode = route?.params?.mode as string | undefined;

  const load = useCallback(async () => {
    try {
      const list = await api.tournaments('?enabled=true');
      setItems(Array.isArray(list) ? list : []);
    } catch { setItems([]); }
    setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load, mode]);

  const filtered = mode ? items.filter((t) => t.mode === mode) : items;
  const upcoming = filtered.filter((t) => (t.status || 'upcoming') !== 'completed');

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
            {!mode && (
              <View style={s.modeRow}>
                {['Battle Royale Solo', 'Battle Royale', 'Clash Squad'].map((m) => (
                  <Text key={m} style={[s.modeChip, { borderColor: mode === m ? C.neon : C.border, color: mode === m ? C.neon : C.sub }]}>{m}</Text>
                ))}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <Empty icon="🎮" text="NO MATCHES LIVE — New tournaments are coming soon." />
        }
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
