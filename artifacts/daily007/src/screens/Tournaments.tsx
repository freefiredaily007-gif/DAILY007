import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../lib/api';
import { C, Loading, Empty, MatchCard, SectionTitle, Msg } from '../components/ui';
import { apiError } from '../lib/api';

export default function Tournaments() {
  const nav: any = useNavigation();
  const route: any = useRoute();
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

  const normalize = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  const filtered = mode ? items.filter((t) => {
    const tournamentMode = normalize(t.mode);
    const teamType = normalize(t.teamType);
    const requestedMode = normalize(mode);
    if (requestedMode === 'battleroyalesolo') {
      return teamType === 'solo' && ['battleroyale', 'battleroyalesolo'].includes(tournamentMode);
    }
    if (requestedMode === 'battleroyalesquad') {
      return teamType === 'squad' && ['battleroyale', 'battleroyalesquad'].includes(tournamentMode);
    }
    if (requestedMode === 'clashsquad') return tournamentMode === 'clashsquad';
    return tournamentMode === requestedMode;
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
});
