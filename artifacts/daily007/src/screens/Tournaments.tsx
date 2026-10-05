import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View, FlatList, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../lib/api';
import { C, Loading, Empty, MatchCard, SectionTitle, Msg } from '../components/ui';
import { apiError } from '../lib/api';
import { RoomCredentialsPanel } from '../components/RoomCredentialsPanel';
import { getRoomCredentialSchedule } from '../lib/roomCredentialTiming';
import { tournamentListEmptyMessage, tournamentTabsForRoute } from '../lib/tournamentFilters';
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
  const appState = useRef(AppState.currentState);
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
      const registrationByTournament = new Map<string, any>();
      for (const registration of Array.isArray(registrations) ? registrations : []) {
        const status = String(registration.status ?? '').toLowerCase();
        const tournamentId = String(registration.tournamentId ?? '');
        if (!tournamentId || !['approved', 'pending'].includes(status)) continue;
        const previous = registrationByTournament.get(tournamentId);
        if (!previous || status === 'approved') registrationByTournament.set(tournamentId, registration);
      }
      setItems((Array.isArray(list) ? list : []).map((tournament: any) => {
        const myRegistration = registrationByTournament.get(String(tournament.id));
        return {
          ...tournament,
          joined: Boolean(myRegistration),
          myRegistration,
        };
      }));
      setClockNow(Date.now());
      setError('');
    } catch (e) { setError(apiError(e)); }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returnedToApp = appState.current !== 'active' && nextState === 'active';
      appState.current = nextState;
      if (returnedToApp) {
        setClockNow(Date.now());
        void load();
      }
    });
    return () => subscription.remove();
  }, [load]);

  useEffect(() => {
    const now = Date.now();
    const transitions = items.flatMap((tournament) => {
      const schedule = getRoomCredentialSchedule(tournament.startsAt);
      if (!schedule) return [];
      const releaseTransition = String(tournament.myRegistration?.status ?? '').toLowerCase() === 'approved'
        ? [schedule.releaseAtMs]
        : [];
      return [...releaseTransition, schedule.startsAtMs];
    });
    const nextTransition = transitions
      .filter((time) => Number.isFinite(time) && time > now)
      .sort((a, b) => a - b)[0];
    if (nextTransition === undefined) return;
    const timer = setTimeout(() => {
      setClockNow(Date.now());
      void load();
    }, Math.min(MAX_TIMEOUT_MS, Math.max(0, nextTransition - now + 20)));
    return () => clearTimeout(timer);
  }, [items, clockNow, load]);

  const lifecycleOf = (tournament: any) => getTournamentLifecycleState(tournament, clockNow);
  const modeScopedTabs = tournamentTabsForRoute(items, {
    gameMode: gameMode || legacyMode,
    teamType,
  }, lifecycleOf);
  const visible = modeScopedTabs[tab];
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
                const count = modeScopedTabs[value].length;
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
                    <Text style={[s.tabText, selected && s.tabTextOn]}>
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
          const registration = item.myRegistration;
          const registrationStatus = String(registration?.status ?? '').toLowerCase();
          const roomDetails = registrationStatus === 'approved' ? (
            <RoomCredentialsPanel
              startsAt={item.startsAt}
              now={clockNow}
              configured={registration.roomPublished === true}
              roomId={registration.roomId}
              roomPassword={registration.roomPassword}
            />
          ) : registrationStatus === 'pending' ? (
            <View style={s.roomPending}>
              <Text style={s.roomPendingText}>Your entry is awaiting approval. Room details are available only after approval.</Text>
            </View>
          ) : undefined;
          return (
          <MatchCard
            t={cardItem}
            roomDetails={roomDetails}
            onPress={() => nav.push('TDetail', { id: item.id })}
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
  roomPending: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.border,
  },
  roomPendingText: { color: C.gold, fontSize: 12, fontWeight: '700', lineHeight: 18 },
});
