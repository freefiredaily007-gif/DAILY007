import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Platform,
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../lib/api';
import { C, Loading, MatchCard, SectionTitle, Msg } from '../components/ui';
import { apiError } from '../lib/api';
import { RoomCredentialsPanel } from '../components/RoomCredentialsPanel';
import { getRoomCredentialSchedule } from '../lib/roomCredentialTiming';
import { tournamentListEmptyMessage, tournamentTabsForRoute } from '../lib/tournamentFilters';
import { createLatestRequestGuard } from '../lib/latestRequestGuard';
import {
  compareTournamentStartTime,
  getTournamentLifecycleState,
  MAX_COMPLETED_TOURNAMENTS,
  MAX_TIMEOUT_MS,
  mostRecentCompletedTournaments,
  startTournamentListRefreshPolling,
  TOURNAMENT_LIST_REFRESH_INTERVAL_MS,
  TournamentLifecycleState,
} from '../lib/tournamentLifecycle';
import { takeTournamentStartAnnouncement } from '../lib/tournamentStartAnnouncement';

export default function Tournaments() {
  const nav: any = useNavigation();
  const route: any = useRoute();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.5;
  const [items, setItems] = useState<any[]>([]);
  const [tab, setTab] = useState<Exclude<TournamentLifecycleState, 'closed'>>('upcoming');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [registrationError, setRegistrationError] = useState('');
  const [startAnnouncement, setStartAnnouncement] = useState('');
  const [playerLoadAnnouncement, setPlayerLoadAnnouncement] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());
  const appState = useRef(AppState.currentState);
  const listFocused = useRef(false);
  const announcedTournamentStarts = useRef(new Set<string>());
  const hasLoadedList = useRef(false);
  const initialLoadFailed = useRef(false);
  const loadRequests = useRef(createLatestRequestGuard());
  const refreshingRequest = useRef(false);
  const gameMode = route?.params?.gameMode as string | undefined;
  const legacyMode = route?.params?.mode as string | undefined;
  const teamType = route?.params?.teamType as string | undefined;
  const heading = route?.params?.gameModeLabel || legacyMode || gameMode;

  const load = useCallback(async () => {
    const request = loadRequests.current.begin();
    try {
      const [listResult, registrationsResult] = await Promise.allSettled([
        Promise.resolve().then(() => api.tournaments()),
        Promise.resolve().then(() => api.myRegistrations()),
      ]);
      if (!loadRequests.current.isCurrent(request)) return;
      if (listResult.status === 'rejected') {
        if (!hasLoadedList.current) initialLoadFailed.current = true;
        setError(apiError(listResult.reason));
        return;
      }
      const registrationStatusKnown = registrationsResult.status === 'fulfilled';
      if (!registrationStatusKnown && hasLoadedList.current) {
        setError(apiError(registrationsResult.reason));
        return;
      }
      const recoveredInitialLoad = !hasLoadedList.current && initialLoadFailed.current;
      const registrations = registrationStatusKnown ? registrationsResult.value : [];
      setRegistrationError(
        registrationStatusKnown ? '' : apiError(registrationsResult.reason),
      );
      const registrationByTournament = new Map<string, any>();
      for (const registration of Array.isArray(registrations) ? registrations : []) {
        const status = String(registration.status ?? '').toLowerCase();
        const tournamentId = String(registration.tournamentId ?? '');
        if (!tournamentId || !['approved', 'pending'].includes(status)) continue;
        const previous = registrationByTournament.get(tournamentId);
        if (!previous || status === 'approved') registrationByTournament.set(tournamentId, registration);
      }
      setItems((Array.isArray(listResult.value) ? listResult.value : []).map((tournament: any) => {
        const myRegistration = registrationByTournament.get(String(tournament.id));
        return {
          ...tournament,
          joined: registrationStatusKnown ? Boolean(myRegistration) : undefined,
          joinedStatusUnknown: !registrationStatusKnown,
          myRegistration,
        };
      }));
      hasLoadedList.current = true;
      initialLoadFailed.current = false;
      if (recoveredInitialLoad) setPlayerLoadAnnouncement('Tournaments loaded.');
      setClockNow(Date.now());
      setError('');
    } catch (e) {
      if (loadRequests.current.isCurrent(request)) {
        if (!hasLoadedList.current) initialLoadFailed.current = true;
        setError(apiError(e));
      }
    } finally {
      if (loadRequests.current.isCurrent(request)) setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => {
    listFocused.current = true;
    const stopCompletionPolling = startTournamentListRefreshPolling(
      () => {
        setClockNow(Date.now());
        void load();
      },
      () => listFocused.current && AppState.currentState === 'active',
      TOURNAMENT_LIST_REFRESH_INTERVAL_MS,
    );
    if (AppState.currentState === 'active') void load();
    return () => {
      listFocused.current = false;
      stopCompletionPolling();
    };
  }, [load]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returnedToApp = appState.current !== 'active' && nextState === 'active';
      appState.current = nextState;
      if (returnedToApp && listFocused.current) {
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
      const now = Date.now();
      if (nextTransition <= now && listFocused.current && AppState.currentState === 'active') {
        const announcements = items.flatMap((tournament) => {
          if (lifecycleOf(tournament) !== 'upcoming') return [];
          const schedule = getRoomCredentialSchedule(tournament.startsAt);
          if (schedule?.startsAtMs !== nextTransition) return [];
          const announcement = takeTournamentStartAnnouncement(
            tournament,
            announcedTournamentStarts.current,
          );
          return announcement ? [announcement] : [];
        });
        if (announcements.length > 0) {
          if (Platform.OS === 'ios') {
            announcements.forEach((announcement) => {
              AccessibilityInfo.announceForAccessibilityWithOptions(announcement, {
                queue: true,
                priority: 'low',
              });
            });
          } else {
            setStartAnnouncement(announcements.join(' '));
          }
        }
        setClockNow(now);
        void load();
      }
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
  const emptyMessage = tournamentListEmptyMessage(false, tabLabel[tab], heading, teamType);

  const onRefresh = async () => {
    if (refreshingRequest.current) return;
    refreshingRequest.current = true;
    setRefreshing(true);
    try {
      await load();
    } finally {
      refreshingRequest.current = false;
      setRefreshing(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <View style={s.root}>
      {startAnnouncement ? (
        <Text
          accessible={false}
          accessibilityLiveRegion="polite"
          testID="tournament-start-announcement"
          style={s.screenReaderAnnouncement}
        >
          {startAnnouncement}
        </Text>
      ) : null}
      {playerLoadAnnouncement ? (
        <Text
          accessible={false}
          accessibilityLiveRegion="polite"
          testID="player-tournament-load-announcement"
          style={s.screenReaderAnnouncement}
        >
          {playerLoadAnnouncement}
        </Text>
      ) : null}
      <FlatList
        testID="player-tournament-list"
        data={orderedVisible}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.neon} />}
        ListHeaderComponent={
          <View>
            <SectionTitle accent={C.neon}>{heading ? `${String(heading).toUpperCase()} TOURNAMENTS` : 'ALL TOURNAMENTS'}</SectionTitle>
            <View style={[s.tabs, largeText && s.tabsLarge]}>
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
                    accessibilityLabel={`${tabLabel[value]} tournaments, ${displayedCount}`}
                    onPress={() => setTab(value)}
                    style={[s.tab, largeText && s.tabLarge, selected && s.tabOn]}
                  >
                    <Text style={[s.tabText, largeText && s.tabTextLarge, selected && s.tabTextOn]}>
                      {tabLabel[value]} <Text style={[s.tabCount, selected && s.tabTextOn]}>{displayedCount}</Text>
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!!error && (
              <Msg
                kind="err"
                text={`${hasLoadedList.current ? 'Could not refresh' : 'Could not load'} tournaments: ${error}`}
                testID={hasLoadedList.current ? 'player-tournament-refresh-error' : 'player-tournament-load-error'}
                accessibilityLabel={`${hasLoadedList.current ? 'Could not refresh' : 'Could not load'} tournaments: ${error}`}
                accessibilityLiveRegion="polite"
              />
            )}
            {!!registrationError && (
              <Msg
                kind="err"
                text={`Could not confirm which tournaments you have joined: ${registrationError}. Entry status is unknown; refresh before joining.`}
              />
            )}
          </View>
        }
        ListEmptyComponent={error ? null : (
          <View style={s.emptyState}>
            <Text
              testID="player-tournament-empty-state"
              accessible
              accessibilityRole="text"
              accessibilityLabel={emptyMessage.replace('\n', ' ')}
              style={s.emptyMessage}
            >
              {emptyMessage}
            </Text>
          </View>
        )}
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
  screenReaderAnnouncement: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
  tabs: { flexDirection: 'row', gap: 7, marginBottom: 12 },
  tabsLarge: { flexDirection: 'column', alignItems: 'stretch' },
  tab: {
    flex: 1, minHeight: 38, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card,
  },
  tabLarge: { flex: 0, minHeight: 52, paddingVertical: 10 },
  tabOn: { borderColor: C.neon, backgroundColor: C.neon + '20' },
  tabText: { color: C.sub, fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
  tabTextLarge: { fontSize: 12, letterSpacing: 0, textAlign: 'center' },
  tabTextOn: { color: C.text },
  tabCount: { color: C.dim, fontSize: 9, fontWeight: '700' },
  emptyState: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 24,
  },
  emptyMessage: {
    width: '100%',
    maxWidth: 520,
    flexShrink: 1,
    color: C.sub,
    fontSize: 14,
    textAlign: 'center',
  },
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
