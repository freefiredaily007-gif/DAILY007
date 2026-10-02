import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
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
  const gameMode = route?.params?.gameMode as string | undefined;
  const teamType = route?.params?.teamType as string | undefined;
  const legacyMode = route?.params?.mode as string | undefined;
  const heading = [route?.params?.gameModeLabel || legacyMode || gameMode, teamType]
    .filter(Boolean).join(' · ');

  const load = useCallback(async () => {
    try {
      const [list, registrations] = await Promise.all([
        api.tournaments('?enabled=true'),
        api.myRegistrations(),
      ]);
      const joinedIds = new Set(
        (Array.isArray(registrations) ? registrations : [])
          .filter((registration: any) => ['approved', 'pending'].includes(String(registration.status ?? '').toLowerCase()))
          .map((registration: any) => String(registration.tournamentId)),
      );
      setItems((Array.isArray(list) ? list : []).map((tournament: any) => ({
        ...tournament,
        joined: joinedIds.has(String(tournament.id)),
      })));
      setError('');
    } catch (e) { setError(apiError(e)); }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const normalize = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  const requestedMode = normalize(gameMode || legacyMode);
  const requestedTeam = normalize(teamType);
  const filtered = requestedMode ? items.filter((t) => {
    const tournamentMode = normalize(t.gameMode || t.mode);
    const actualTeam = normalize(t.teamType);
    return tournamentMode === requestedMode && (!requestedTeam || actualTeam === requestedTeam);
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
            <SectionTitle accent={C.neon}>{heading ? `${heading.toUpperCase()} TOURNAMENTS` : 'ALL UPCOMING MATCHES'}</SectionTitle>
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
