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
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import * as Network from 'expo-network';
import { ReadableText as Text } from '../components/typography';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../lib/api';
import { C, Loading, MatchCard, SectionTitle, Msg } from '../components/ui';
import { apiError } from '../lib/api';
import { RoomCredentialsPanel } from '../components/RoomCredentialsPanel';
import {
  getNextRoomCredentialRefreshAtMs,
  getRoomCredentialSchedule,
  hasServerAuthorizedRoomCredentials,
} from '../lib/roomCredentialTiming';
import {
  isHomeTournamentOpenForRegistration,
  tournamentListEmptyMessage,
  tournamentTabsForRoute,
} from '../lib/tournamentFilters';
import { createLatestRequestGuard } from '../lib/latestRequestGuard';
import {
  createNetworkEventRevision,
  isUsableNetworkState,
} from '../lib/focusedRetry';
import { createFocusedRefreshCoalescer } from '../lib/focusedLatestRequest';
import {
  compareTournamentStartTime,
  createTournamentRefreshSingleFlight,
  getTournamentLifecycleState,
  MAX_COMPLETED_TOURNAMENTS,
  MAX_TIMEOUT_MS,
  mostRecentCompletedTournaments,
  startTournamentListRefreshPolling,
  TOURNAMENT_LIST_REFRESH_INTERVAL_MS,
  TournamentLifecycleState,
} from '../lib/tournamentLifecycle';
import {
  takeTournamentStartAnnouncement,
  takeTournamentStartAnnouncements,
} from '../lib/tournamentStartAnnouncement';
import { createTournamentRoomDetailsAnnouncementTracker } from '../lib/tournamentRoomDetailsAnnouncement';
import { translateExactText } from '../i18n';

const GAME_MODE_FILTERS = [
  { key: 'all', title: 'ALL', name: 'ALL TOURNAMENTS', gameMode: undefined, accent: C.gold },
  { key: 'battle_royale_kill_earn', title: 'BR KILL & EARN', name: 'BATTLE ROYALE KILL & EARN', gameMode: 'battle_royale_kill_earn', accent: C.orange },
  { key: 'battle_royale', title: 'BR CLASSIC', name: 'BATTLE ROYALE CLASSIC', gameMode: 'battle_royale', accent: C.gold },
  { key: 'clash_squad', title: 'CLASH SQUAD', name: 'CLASH SQUAD', gameMode: 'clash_squad', accent: C.neon },
  { key: 'lone_wolf', title: 'LONE WOLF', name: 'LONE WOLF', gameMode: 'lone_wolf', accent: C.purple },
] as const;

function normalizeModeFilter(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveModeFilter(value: unknown): (typeof GAME_MODE_FILTERS)[number]['key'] {
  const normalized = normalizeModeFilter(value);
  if (!normalized) return 'all';
  return GAME_MODE_FILTERS.find((filter) =>
    filter.key !== 'all' && normalizeModeFilter(filter.gameMode) === normalized,
  )?.key ?? 'all';
}

function announcePlayerLoadStatusOnIOS(message: string): void {
  if (Platform.OS !== 'ios') return;
  AccessibilityInfo.announceForAccessibilityWithOptions(translateExactText(message), {
    queue: true,
    priority: 'low',
  });
}

const ROOM_DETAILS_AVAILABLE_ANNOUNCEMENT =
  'Room details are now available for your approved tournament entry.';

type TournamentLoadTrigger =
  | 'focus'
  | 'scheduled'
  | 'room-release'
  | 'resume'
  | 'connectivity'
  | 'manual';

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
  const [roomDetailsAnnouncementVersion, setRoomDetailsAnnouncementVersion] = useState(0);
  const [playerLoadAnnouncement, setPlayerLoadAnnouncement] = useState('');
  const [playerRefreshAnnouncementVersion, setPlayerRefreshAnnouncementVersion] = useState(0);
  const [missedStartCheckVersion, setMissedStartCheckVersion] = useState(0);
  const [clockNow, setClockNow] = useState(Date.now());
  const [connectivityRefreshes] = useState(createFocusedRefreshCoalescer);
  const [completionRefresh] = useState(createTournamentRefreshSingleFlight);
  const appState = useRef(AppState.currentState);
  const listFocused = useRef(false);
  const announcedTournamentStarts = useRef(new Set<string>());
  const roomDetailsAnnouncementTracker = useRef(
    createTournamentRoomDetailsAnnouncementTracker(),
  );
  const missedStartCheckPending = useRef(false);
  const hasLoadedList = useRef(false);
  const hasConfirmedRegistrationStatus = useRef(false);
  const initialLoadFailed = useRef(false);
  const latestLoadFailed = useRef(false);
  const announcedInitialLoadFailure = useRef(false);
  const announcedInitialLoadRecovery = useRef(false);
  const failedManualRefresh = useRef(false);
  const loadRequests = useRef(createLatestRequestGuard());
  const activeLoad = useRef<Promise<void> | null>(null);
  const activeLoadTrigger = useRef<TournamentLoadTrigger | null>(null);
  const roomReleaseRefresh = useRef<Promise<void> | null>(null);
  const refreshingRequest = useRef(false);
  const gameMode = route?.params?.gameMode as string | undefined;
  const legacyMode = route?.params?.mode as string | undefined;
  const teamType = route?.params?.teamType as string | undefined;
  const routeModeFilter = resolveModeFilter(gameMode || legacyMode);
  const [selectedModeFilter, setSelectedModeFilter] = useState<string>(routeModeFilter);
  const selectedMode = GAME_MODE_FILTERS.find((filter) => filter.key === selectedModeFilter) ?? GAME_MODE_FILTERS[0];
  const heading = selectedMode.key === 'all' ? undefined : translateExactText(selectedMode.name);
  useEffect(() => {
    setSelectedModeFilter(routeModeFilter);
    setTab('upcoming');
  }, [routeModeFilter]);
  const registrationOnly = route?.params?.registrationOnly === true &&
    selectedMode.key !== 'all';

  const loadLatest = useCallback(async (trigger: TournamentLoadTrigger) => {
    const request = loadRequests.current.begin();
    try {
      const [listResult, registrationsResult] = await Promise.allSettled([
        Promise.resolve().then(() => api.tournaments()),
        Promise.resolve().then(() => api.myRegistrations()),
      ]);
      if (!loadRequests.current.isCurrent(request)) return;
      if (listResult.status === 'rejected') {
        latestLoadFailed.current = true;
        if (!hasLoadedList.current) initialLoadFailed.current = true;
        else if (refreshingRequest.current) failedManualRefresh.current = true;
        setError(apiError(listResult.reason));
        return;
      }
      const registrationStatusKnown =
        registrationsResult.status === 'fulfilled' && Array.isArray(registrationsResult.value);
      if (registrationStatusKnown) hasConfirmedRegistrationStatus.current = true;
      const registrationErrorMessage = registrationStatusKnown
        ? ''
        : registrationsResult.status === 'rejected'
          ? apiError(registrationsResult.reason)
          : 'Invalid registrations response.';
      latestLoadFailed.current = !registrationStatusKnown;
      if (!registrationStatusKnown && hasLoadedList.current) {
        if (refreshingRequest.current) failedManualRefresh.current = true;
        setError('');
        setRegistrationError(registrationErrorMessage);
        return;
      }
      const recoveredInitialLoad = !hasLoadedList.current && initialLoadFailed.current;
      const registrations = registrationStatusKnown ? registrationsResult.value as any[] : [];
      setRegistrationError(registrationErrorMessage);
      const registrationByTournament = new Map<string, any>();
      for (const registration of registrations) {
        const status = String(registration.status ?? '').toLowerCase();
        const tournamentId = String(registration.tournamentId ?? '');
        if (!tournamentId || !['approved', 'pending'].includes(status)) continue;
        const previous = registrationByTournament.get(tournamentId);
        if (!previous || status === 'approved') registrationByTournament.set(tournamentId, registration);
      }
      if (registrationStatusKnown) {
        const newlyAvailableCount = roomDetailsAnnouncementTracker.current(
          trigger,
          [...registrationByTournament.values()].map((registration: any) => ({
            ...registration,
            credentialsAvailable: hasServerAuthorizedRoomCredentials(
              registration.roomId,
              registration.roomPassword,
            ),
          })),
        );
        if (newlyAvailableCount > 0) {
          setRoomDetailsAnnouncementVersion((version) => version + 1);
          if (Platform.OS === 'ios') {
            AccessibilityInfo.announceForAccessibilityWithOptions(
              translateExactText(ROOM_DETAILS_AVAILABLE_ANNOUNCEMENT),
              { queue: true, priority: 'low' },
            );
          }
        }
      }
      const refreshedItems = (Array.isArray(listResult.value) ? listResult.value : []).map((tournament: any) => {
        const myRegistration = registrationByTournament.get(String(tournament.id));
        return {
          ...tournament,
          joined: registrationStatusKnown ? Boolean(myRegistration) : undefined,
          joinedStatusUnknown: !registrationStatusKnown,
          myRegistration,
        };
      });
      setItems(refreshedItems);
      hasLoadedList.current = true;
      initialLoadFailed.current = false;
      latestLoadFailed.current = !registrationStatusKnown;
      if (recoveredInitialLoad) setPlayerLoadAnnouncement('Tournaments loaded.');
      if (failedManualRefresh.current) {
        failedManualRefresh.current = false;
        setPlayerRefreshAnnouncementVersion((version) => version + 1);
      }
      setClockNow(Date.now());
      if (missedStartCheckPending.current) {
        setMissedStartCheckVersion((version) => version + 1);
      }
      setError('');
    } catch (e) {
      if (loadRequests.current.isCurrent(request)) {
        latestLoadFailed.current = true;
        if (!hasLoadedList.current) initialLoadFailed.current = true;
        else if (refreshingRequest.current) failedManualRefresh.current = true;
        setError(apiError(e));
      }
    } finally {
      if (loadRequests.current.isCurrent(request)) setLoading(false);
    }
  }, []);

  const load = useCallback((trigger: TournamentLoadTrigger = 'focus'): Promise<void> => {
    const pending = activeLoad.current;
    if (pending && trigger === 'room-release') {
      if (activeLoadTrigger.current === 'room-release') return pending;
      if (roomReleaseRefresh.current) return roomReleaseRefresh.current;

      const startAfterPending = async (): Promise<void> => {
        roomReleaseRefresh.current = null;
        if (!listFocused.current || AppState.currentState !== 'active') return;
        await load('room-release');
      };
      const refreshAfterPending: Promise<void> = pending.then(startAfterPending, startAfterPending);
      roomReleaseRefresh.current = refreshAfterPending;
      return refreshAfterPending;
    }
    // Let a pull supersede a scheduled poll without duplicating an in-flight
    // focus, resume, or connectivity recovery request.
    const manualSupersedesScheduledPoll =
      trigger === 'manual' && activeLoadTrigger.current === 'scheduled';
    if (pending && trigger !== 'focus' && !manualSupersedesScheduledPoll) return pending;

    const promise = loadLatest(trigger);
    activeLoad.current = promise;
    activeLoadTrigger.current = trigger;
    const clearActiveLoad = () => {
      if (activeLoad.current !== promise) return;
      activeLoad.current = null;
      activeLoadTrigger.current = null;
    };
    void promise.then(clearActiveLoad, clearActiveLoad);
    return promise;
  }, [loadLatest]);

  useEffect(() => {
    if (
      Platform.OS !== 'ios' ||
      !error ||
      hasLoadedList.current ||
      !initialLoadFailed.current ||
      announcedInitialLoadFailure.current
    ) {
      return;
    }
    announcedInitialLoadFailure.current = true;
    announcePlayerLoadStatusOnIOS(`Could not load tournaments: ${error}`);
  }, [error]);

  useEffect(() => {
    if (
      Platform.OS !== 'ios' ||
      !playerLoadAnnouncement ||
      announcedInitialLoadRecovery.current
    ) {
      return;
    }
    announcedInitialLoadRecovery.current = true;
    announcePlayerLoadStatusOnIOS(playerLoadAnnouncement);
  }, [playerLoadAnnouncement]);

  useFocusEffect(useCallback(() => {
    listFocused.current = true;
    connectivityRefreshes.setFocused(true);
    let active = true;
    const stopCompletionPolling = startTournamentListRefreshPolling(
      () => {
        setClockNow(Date.now());
        return completionRefresh.run(() => load('scheduled'));
      },
      () => listFocused.current && AppState.currentState === 'active',
      TOURNAMENT_LIST_REFRESH_INTERVAL_MS,
    );
    const updateNetworkState = (
      networkState: Parameters<typeof isUsableNetworkState>[0],
      refreshAfterFailure: boolean,
    ) => {
      const usable = isUsableNetworkState(networkState);
      if (!usable) connectivityRefreshes.cancelPending();
      if (usable && refreshAfterFailure) {
        connectivityRefreshes.request(() => {
          if (!active || !listFocused.current || AppState.currentState !== 'active') return;
          setClockNow(Date.now());
          return load('connectivity');
        });
      }
    };
    const networkEventRevision = createNetworkEventRevision();
    const initialNetworkEventRevision = networkEventRevision.capture();
    const networkSubscription = Network.addNetworkStateListener((networkState) => {
      if (!active) return;
      networkEventRevision.recordEvent();
      updateNetworkState(networkState, true);
    });
    void Network.getNetworkStateAsync().then((networkState) => {
      if (!active || !networkEventRevision.isCurrent(initialNetworkEventRevision)) return;
      updateNetworkState(networkState, latestLoadFailed.current);
    }).catch(() => {});
    if (AppState.currentState === 'active') void load('focus');
    return () => {
      active = false;
      listFocused.current = false;
      missedStartCheckPending.current = true;
      connectivityRefreshes.setFocused(false);
      stopCompletionPolling();
      networkSubscription.remove();
    };
  }, [completionRefresh, connectivityRefreshes, load]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returnedToApp = appState.current !== 'active' && nextState === 'active';
      if (appState.current === 'active' && nextState !== 'active' && listFocused.current) {
        missedStartCheckPending.current = true;
      }
      appState.current = nextState;
      if (returnedToApp && listFocused.current) {
        setClockNow(Date.now());
        void load('resume');
      }
    });
    return () => subscription.remove();
  }, [load]);

  useEffect(() => {
    if (
      missedStartCheckVersion === 0 ||
      !missedStartCheckPending.current ||
      !listFocused.current ||
      AppState.currentState !== 'active'
    ) {
      return;
    }
    const announcements = takeTournamentStartAnnouncements(
      items,
      (tournament) => lifecycleOf(tournament) === 'ongoing',
      announcedTournamentStarts.current,
    );
    missedStartCheckPending.current = false;
    if (announcements.length === 0) return;
    if (Platform.OS === 'ios') {
        announcements.forEach((announcement) => {
        AccessibilityInfo.announceForAccessibilityWithOptions(translateExactText(announcement), {
          queue: true,
          priority: 'low',
        });
      });
    } else {
      setStartAnnouncement(announcements.map(translateExactText).join(' '));
    }
  }, [items, clockNow, missedStartCheckVersion]);

  useEffect(() => {
    const now = Date.now();
    const transitions = items.flatMap((tournament) => {
      const schedule = getRoomCredentialSchedule(tournament.startsAt);
      if (!schedule) return [];
      const roomRefreshAt = getNextRoomCredentialRefreshAtMs(
        schedule.startsAtMs,
        schedule.releaseAtMs,
        tournament.myRegistration?.status,
        now,
      );
      const releaseTransition = roomRefreshAt === null ? [] : [roomRefreshAt];
      return [...releaseTransition, schedule.startsAtMs];
    });
    const nextTransition = transitions
      .filter((time) => Number.isFinite(time) && time > now)
      .sort((a, b) => a - b)[0];
    if (nextTransition === undefined) return;
    const timer = setTimeout(() => {
      const now = Date.now();
      if (nextTransition <= now && listFocused.current && AppState.currentState === 'active') {
        const isRoomReleaseTransition = items.some((tournament) => {
          const schedule = getRoomCredentialSchedule(tournament.startsAt);
          const registrationStatus = String(tournament.myRegistration?.status ?? '').toLowerCase();
          return schedule !== null &&
            schedule.releaseAtMs === nextTransition &&
            ['approved', 'pending'].includes(registrationStatus);
        });
        const announcements = takeTournamentStartAnnouncements(
          items,
          (tournament) =>
            lifecycleOf(tournament) === 'upcoming' &&
            getRoomCredentialSchedule(tournament.startsAt)?.startsAtMs === nextTransition,
          announcedTournamentStarts.current,
        );
        if (announcements.length > 0) {
          if (Platform.OS === 'ios') {
            announcements.forEach((announcement) => {
              AccessibilityInfo.announceForAccessibilityWithOptions(translateExactText(announcement), {
                queue: true,
                priority: 'low',
              });
            });
          } else {
            setStartAnnouncement(announcements.map(translateExactText).join(' '));
          }
        }
        setClockNow(now);
        void load(isRoomReleaseTransition ? 'room-release' : 'scheduled');
      }
    }, Math.min(MAX_TIMEOUT_MS, Math.max(0, nextTransition - now + 20)));
    return () => clearTimeout(timer);
  }, [items, clockNow, load]);

  const lifecycleOf = (tournament: any) => getTournamentLifecycleState(tournament, clockNow);
  const registrationOpenItems = registrationOnly
    ? items.filter((tournament) => isHomeTournamentOpenForRegistration(tournament, clockNow))
    : items;
  const modeScopedTabs = tournamentTabsForRoute(registrationOpenItems, {
    gameMode: selectedMode.gameMode,
    teamType: registrationOnly ? teamType : undefined,
  }, lifecycleOf);
  const visible = registrationOnly ? modeScopedTabs.upcoming : modeScopedTabs[tab];
  const orderedVisible = registrationOnly
    ? visible
    : tab === 'completed'
    ? mostRecentCompletedTournaments(visible)
    : tab === 'ongoing' ? [...visible].sort(compareTournamentStartTime) : visible;
  const tabs: Exclude<TournamentLifecycleState, 'closed'>[] = ['upcoming', 'ongoing', 'completed'];
  const tabLabel: Record<typeof tab, string> = {
    upcoming: 'Upcoming',
    ongoing: 'Ongoing',
    completed: 'Completed',
  };
  const emptyMessage = registrationOnly
    ? 'NO LIVE TOURNAMENTS AVAILABLE'
    : tournamentListEmptyMessage(false, tabLabel[tab], heading);
  const modeFilterCounts: Record<string, number> = {
    all: modeScopedTabs.upcoming.length + modeScopedTabs.ongoing.length + modeScopedTabs.completed.length,
  };
  for (const filter of GAME_MODE_FILTERS) {
    if (filter.key === 'all') continue;
    const counts = tournamentTabsForRoute(
      registrationOpenItems,
      { gameMode: filter.gameMode },
      lifecycleOf,
    );
    modeFilterCounts[filter.key] = counts.upcoming.length + counts.ongoing.length + counts.completed.length;
  }
  const renderModeFilter = (filter: (typeof GAME_MODE_FILTERS)[number]) => {
    const count = modeFilterCounts[filter.key] ?? 0;
    const selected = selectedModeFilter === filter.key;
    return (
      <Pressable
        key={filter.key}
        testID={`tournament-mode-tab-${filter.key}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${filter.name} tournaments, ${count}`}
        onPress={() => {
          setSelectedModeFilter(filter.key);
          setRegistrationError('');
        }}
        style={[
          s.modeFilterTab,
          largeText && s.modeFilterTabLarge,
          selected && { borderColor: filter.accent, backgroundColor: `${filter.accent}22` },
        ]}
      >
        <Text style={[
          s.modeFilterText,
          largeText && s.modeFilterTextLarge,
          selected && { color: filter.accent },
        ]}>
          {translateExactText(filter.title)} <Text style={[s.modeFilterCount, selected && { color: filter.accent }]}>{count}</Text>
        </Text>
      </Pressable>
    );
  };

  const onRefresh = async () => {
    if (refreshingRequest.current) return;
    refreshingRequest.current = true;
    setRefreshing(true);
    try {
      await load('manual');
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
      {Platform.OS === 'android' && roomDetailsAnnouncementVersion > 0 ? (
        <Text
          key={roomDetailsAnnouncementVersion}
          accessible={false}
          accessibilityLiveRegion="polite"
          testID="tournament-room-details-announcement"
          style={s.screenReaderAnnouncement}
        >
          {ROOM_DETAILS_AVAILABLE_ANNOUNCEMENT}
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
      {Platform.OS === 'android' && playerRefreshAnnouncementVersion > 0 ? (
        <Text
          key={playerRefreshAnnouncementVersion}
          accessible={false}
          accessibilityLiveRegion="polite"
          testID="player-tournament-refresh-announcement"
          style={s.screenReaderAnnouncement}
        >
          Tournaments updated.
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
            {largeText ? (
              <View style={s.modeFilterWrap}>{GAME_MODE_FILTERS.map(renderModeFilter)}</View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.modeFilterContent}
                style={s.modeFilterScroll}
              >
                {GAME_MODE_FILTERS.map(renderModeFilter)}
              </ScrollView>
            )}
            {!registrationOnly && (
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
            )}
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
                text={`Could not confirm which tournaments you have joined: ${registrationError}. ${hasConfirmedRegistrationStatus.current ? 'Showing your last confirmed status; refresh to try again.' : 'Entry status is unknown; refresh before joining.'}`}
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
          const tournamentCancelled = String(item.status ?? '').toLowerCase() === 'cancelled';
          const roomAccessStatus = tournamentCancelled
            ? 'cancelled'
            : registrationStatus === 'approved'
              ? 'approved'
              : registrationStatus === 'pending'
                ? 'pending'
                : registrationStatus === 'rejected'
                  ? 'rejected'
                  : item.joinedStatusUnknown === true
                    ? 'unknown'
                    : 'unregistered';
          const roomDetails = (
            <RoomCredentialsPanel
              startsAt={item.startsAt}
              now={clockNow}
              configured={roomAccessStatus === 'approved' && registration?.roomPublished === true}
              roomId={roomAccessStatus === 'approved' ? registration?.roomId : undefined}
              roomPassword={roomAccessStatus === 'approved' ? registration?.roomPassword : undefined}
              accessStatus={roomAccessStatus}
            />
          );
          return (
          <MatchCard
            t={cardItem}
            largeText={largeText}
            variant="browse"
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
  modeFilterScroll: { marginBottom: 10 },
  modeFilterContent: { gap: 8, paddingRight: 8, paddingBottom: 2 },
  modeFilterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  modeFilterTab: {
    minWidth: 88,
    minHeight: 38,
    paddingHorizontal: 11,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  modeFilterTabLarge: { flexBasis: '47%', flexGrow: 1, minWidth: 0, minHeight: 50 },
  modeFilterText: { color: C.sub, fontSize: 10, fontWeight: '900', letterSpacing: 0.3, textAlign: 'center' },
  modeFilterTextLarge: { fontSize: 12, letterSpacing: 0 },
  modeFilterCount: { color: C.dim, fontSize: 9, fontWeight: '800' },
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
});
