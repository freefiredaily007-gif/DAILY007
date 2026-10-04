import React, { useCallback, useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../lib/api';
import { C, Loading, Empty, MatchCard, SectionTitle, Msg } from '../components/ui';
import { apiError } from '../lib/api';
import { filterTournamentsForRoute, tournamentListEmptyMessage } from '../lib/tournamentFilters';
import {
  compareTournamentStartTime,
  getTournamentLifecycleState,
  MAX_COMPLETED_TOURNAMENTS,
  MAX_TIMEOUT_MS,
  mostRecentCompletedTournaments,
  TournamentLifecycleState,
} from '../lib/tournamentLifecycle';

export default function Tournaments() {
  const nav: any = useNavigation();
  const route: any = useRoute();
  const [items, setItems] = useState<any[]>([]);
  const [tab, setTab] = useState<Exclude<TournamentLifecycleState, 'closed'>>('upcoming');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());
  const gameMode = route?.params?.gameMode as string | undefined;
  const legacyMode = route?.params?.mode as string | undefined;
  const teamType = route?.params?.teamType as string | undefined;
  const heading = route?.params?.gameModeLabel || legacyMode || gameMode;

  const load = useCallback(async () => {
    try {
      const [list, registrations] = await Promise.all([
        api.tournaments(),
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
      setClockNow(Date.now());
      setError('');
    } catch (e) { setError(apiError(e)); }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    const now = Date.now();
    const nextStart = items
      .filter((tournament) => getTournamentLifecycleState(tournament, clockNow) === 'upcoming')
      .map((tournament) => Date.parse(String(tournament.startsAt ?? '')))
      .filter((start) => Number.isFinite(start) && start > now)
      .sort((a, b) => a - b)[0];
    if (nextStart === undefined) return;
    const timer = setTimeout(() => setClockNow(Date.now()), Math.min(MAX_TIMEOUT_MS, Math.max(0, nextStart - now + 20)));
    return () => clearTimeout(timer);
  }, [items, clockNow]);

  const filtered = filterTournamentsForRoute(items, {
    gameMode: gameMode || legacyMode,
    teamType,
  });
  const lifecycleOf = (tournament: any) => getTournamentLifecycleState(tournament, clockNow);
  const visible = filtered.filter((tournament) => lifecycleOf(tournament) === tab);
  const orderedVisible = tab === 'completed'
    ? mostRecentCompletedTournaments(visible)
    : tab === 'ongoing' ? [...visible].sort(compareTournamentStartTime) : visible;
  const tabs: Exclude<TournamentLifecycleState, 'closed'>[] = ['upcoming', 'ongoing', 'completed'];
  const tabLabel: Record<typeof tab, string> = {
    upcoming: 'Upcoming',
    ongoing: 'Ongoing',
    completed: 'Completed',
  };

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (loading) return <Loading />;

  return (
    <View style={s.root}>
      <FlatList
        data={orderedVisible}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.neon} />}
        ListHeaderComponent={
          <View>
            <SectionTitle accent={C.neon}>{heading ? `${String(heading).toUpperCase()} TOURNAMENTS` : 'ALL TOURNAMENTS'}</SectionTitle>
            <View style={s.tabs}>
              {tabs.map((value) => {
                const count = filtered.filter((tournament) => lifecycleOf(tournament) === value).length;
                const displayedCount = value === 'completed' ? Math.min(count, MAX_COMPLETED_TOURNAMENTS) : count;
                const selected = tab === value;
                return (
                  <Pressable
                    key={value}
                    testID={`tournament-tab-${value}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${tabLabel[value]} tournaments, ${count}`}
                    onPress={() => setTab(value)}
                    style={[s.tab, selected && s.tabOn]}
                  >
                    <Text numberOfLines={1} style={[s.tabText, selected && s.tabTextOn]}>
                      {tabLabel[value]} <Text style={[s.tabCount, selected && s.tabTextOn]}>{displayedCount}</Text>
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!!error && <Msg kind="err" text={`Could not load tournaments: ${error}`} />}
          </View>
        }
        ListEmptyComponent={<Empty text={tournamentListEmptyMessage(Boolean(error), tabLabel[tab], heading, teamType)} />}
        renderItem={({ item }) => {
          const state = lifecycleOf(item);
          const cardItem = state === 'ongoing' && item.status !== 'ongoing'
            ? { ...item, status: 'ongoing' }
            : item;
          return (
          <MatchCard
            t={cardItem}
            onPress={() => nav.navigate('TDetail', { id: item.id })}
          />
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  tabs: { flexDirection: 'row', gap: 7, marginBottom: 12 },
  tab: {
    flex: 1, minHeight: 38, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card,
  },
  tabOn: { borderColor: C.neon, backgroundColor: C.neon + '20' },
  tabText: { color: C.sub, fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
  tabTextOn: { color: C.text },
  tabCount: { color: C.dim, fontSize: 9, fontWeight: '700' },
});
