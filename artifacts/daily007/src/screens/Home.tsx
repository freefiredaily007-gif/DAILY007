// Home — premium esports landing: header, hero, live matches, game modes, quick actions, social
import React, { useCallback, useState, useRef } from 'react';
import { AccessibilityInfo, AppState, View, ScrollView, Pressable, StyleSheet, RefreshControl, Linking, Image, Animated, Easing, useWindowDimensions } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import bannerSquad from '../assets/banner-squad.jpg';
import bannerClash from '../assets/banner-clash.jpg';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api, Api } from '../lib/api';
import { useApp } from '../App';
import { C, Card, SectionTitle, Loading, Empty, GCard, Badge, CoinCapsule, Msg, glow, Pulse, fmtTime12, getTournamentFormatPresentation } from '../components/ui';
import { inr } from '../lib/coins';
import {
  createHomeRefreshRequestGuard,
  createHomeRefreshSingleFlight,
  didAppReturnToForeground,
  formatHomeRefreshTimestamp,
  getUpcomingHomeTournaments,
  getTournamentLifecycleState,
  HOME_TOURNAMENT_REFRESH_INTERVAL_MS,
  MAX_TIMEOUT_MS,
  shouldRefreshHomeTournaments,
  startHomeTournamentRefreshPolling,
} from '../lib/tournamentLifecycle';
import { getRoomCredentialSchedule } from '../lib/roomCredentialTiming';
import {
  countOpenHomeTournamentsByMode,
  getHomeTournamentPlayerCapacity,
} from '../lib/tournamentFilters';
import HomeGameModeCards from './HomeGameModeCards';
import { WhatsAppIcon, InstagramIcon, YouTubeIcon } from '../components/SocialIcons';
import logoImg from '../assets/logo.jpg';
import HomeLeaderboards from './HomeLeaderboards';
import KnockoutHomeCard from './KnockoutHomeCard';
import { translateExactText } from '../i18n';
import { Feather } from '@expo/vector-icons';
import {
  useDaily007ListPublicKnockoutEvents,
  type Daily007KnockoutEvent,
  type Daily007KnockoutDefaultSettings,
  type Daily007KnockoutEventsResponse,
} from '@workspace/api-client-react';

function fmtDate(d?: string) {
  if (!d) return '';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  if (isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
}
function statusOf(t: any, now: number) {
  const capacity = getHomeTournamentPlayerCapacity(t);
  const filled = Number.isSafeInteger(capacity.filledPlayers) && capacity.filledPlayers >= 0
    ? capacity.filledPlayers
    : 0;
  const total = Number.isSafeInteger(capacity.totalPlayers) && capacity.totalPlayers > 0
    ? capacity.totalPlayers
    : 0;
  const status = String(t.status ?? '').toLowerCase();
  const lifecycle = getTournamentLifecycleState(t, now);
  if (lifecycle === 'ongoing') return { key: 'ONGOING', color: C.red };
  if (lifecycle === 'completed' || lifecycle === 'closed') return { key: 'COMPLETED', color: C.dim };
  if (status === 'setup_needed' || (total > 0 ? filled >= total : status === 'full')) {
    return { key: 'FULL', color: C.orange };
  }
  return { key: 'UPCOMING', color: C.green };
}

function isKillEarnTournament(t: any): boolean {
  const gameMode = String(t?.gameMode ?? t?.mode ?? '')
    .toLowerCase()
    .replace(/[\s&-]+/g, '_');
  return gameMode === 'battle_royale_kill_earn';
}

type HomeTournamentItem = Record<string, any> & { id: string | number; joined: boolean };
type HomeTournamentResponse = Record<string, any> & { id: string | number };

function hasSameHomeTournamentData(
  current: HomeTournamentItem,
  incoming: HomeTournamentResponse,
): boolean {
  const currentKeys = Object.keys(current).filter((key) => key !== 'joined');
  const incomingKeys = Object.keys(incoming).filter((key) => key !== 'joined');
  return currentKeys.length === incomingKeys.length &&
    incomingKeys.every((key) => Object.is(current[key], incoming[key]));
}

export function mergeHomeTournamentItems(
  currentItems: HomeTournamentItem[],
  incomingTournaments: HomeTournamentResponse[],
  joinedIds: ReadonlySet<string>,
): HomeTournamentItem[] {
  const currentById = new Map(
    currentItems.map((tournament) => [String(tournament.id), tournament] as const),
  );
  const nextItems = incomingTournaments.map((tournament) => {
    const current = currentById.get(String(tournament.id));
    const joined = joinedIds.has(String(tournament.id));
    if (current && current.joined === joined && hasSameHomeTournamentData(current, tournament)) {
      return current;
    }
    return { ...tournament, joined };
  });
  return nextItems.length === currentItems.length &&
    nextItems.every((tournament, index) => tournament === currentItems[index])
    ? currentItems
    : nextItems;
}

const HOME_CAROUSEL_CARD_MAX_WIDTH = 340;
const HOME_CAROUSEL_HORIZONTAL_GUTTER = 16;
const HOME_KNOCKOUT_DEFAULTS: Daily007KnockoutDefaultSettings = {
  title: 'Knockout Squad Tournament',
  squadCount: 12,
  playersPerSquad: 4,
  stageCount: 3,
  entryCoins: 10,
  prizePool: 1000,
  prizeDistribution: [
    { rank: 1, squadCoins: 500, playerCoins: 125 },
    { rank: 2, squadCoins: 300, playerCoins: 75 },
    { rank: 3, squadCoins: 200, playerCoins: 50 },
  ],
  pointsPerKill: 1,
  round1Eliminated: 2,
  round2Eliminated: 2,
  totalPlayers: 48,
  squadEntryCoins: 40,
  stages: [
    { name: 'Round 1', squads: 12, eliminated: 2, advance: 10 },
    { name: 'Round 2', squads: 10, eliminated: 2, advance: 8 },
    { name: 'Final', squads: 8, eliminated: 0, advance: 8 },
  ],
};

export default function Home() {
  const { width, fontScale } = useWindowDimensions();
  const largeModeCard = fontScale >= 1.5;
  const narrowLargeText = fontScale >= 1.5 && width <= 340;
  const carouselCardWidth = Math.max(
    0,
    Math.min(HOME_CAROUSEL_CARD_MAX_WIDTH, width - HOME_CAROUSEL_HORIZONTAL_GUTTER * 2),
  );
  const carouselPageSize = width;
  const { user } = useApp();
  const publicKnockoutQuery = useDaily007ListPublicKnockoutEvents({
    query: { queryKey: ["daily007", "knockout", "public"], enabled: false, staleTime: 0, gcTime: 0 },
  });
  const knockoutRefreshRef = useRef(publicKnockoutQuery.refetch);
  knockoutRefreshRef.current = publicKnockoutQuery.refetch;
  const [items, setItems] = useState<any[]>([]);
  const [knockoutInfo, setKnockoutInfo] = useState<Daily007KnockoutEventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [links, setLinks] = useState<any>({});
  const [page, setPage] = useState(0);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState<boolean | null>(null);
  const carouselRef = useRef<ScrollView>(null);
  const pageRef = useRef(0);
  const selectedTournamentIdRef = useRef<string | null>(null);
  const screenReaderEventReceivedRef = useRef(false);
  const loadRequestGuardRef = useRef(createHomeRefreshRequestGuard());
  const loadSingleFlightRef = useRef(createHomeRefreshSingleFlight<void>());
  const activeRequestsRef = useRef(0);
  const homePollInFlightRef = useRef(false);
  const resumeRefreshPendingRef = useRef(false);
  const homeFocusedRef = useRef(false);
  const refreshHomeIfIdleRef = useRef<() => void>(() => {});
  const appStateRef = useRef(AppState.currentState);
  const nav: any = useNavigation();
  const goTab = (k: string) => nav.navigate(k === 'wallet' ? 'Wallet' : k === 'profile' ? 'Profile' : k === 'mymatches' ? 'MyMatches' : k === 'tournaments' ? 'Tournaments' : 'Home');
  const openTournamentDetail = (id: string) => nav.getParent().push('TDetail', { id });
  const openKnockoutSection = (matchId: string | null, section: 'leaderboard' | 'rules') =>
    nav.getParent()?.push('KnockoutDetails', { matchId, section });
  React.useEffect(() => {
    let active = true;
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => {
      screenReaderEventReceivedRef.current = true;
      setScreenReaderEnabled(enabled);
    });
    AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (active && !screenReaderEventReceivedRef.current) setScreenReaderEnabled(enabled);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  const load = useCallback(() => {
    const loadPromise = loadSingleFlightRef.current.run(async () => {
      const requestId = loadRequestGuardRef.current.start();
      activeRequestsRef.current += 1;
      try {
        void knockoutRefreshRef.current()
          .then((knockoutResult) => {
            if (
              loadRequestGuardRef.current.isCurrent(requestId) &&
              knockoutResult.data
            ) {
              setKnockoutInfo(knockoutResult.data);
            }
          })
          .catch(() => {});
        const [tournamentsResult, registrationsResult] = await Promise.allSettled([
          api.tournaments('?enabled=true'),
          api.myRegistrations(),
        ]);
        if (!loadRequestGuardRef.current.isCurrent(requestId)) return;
        if (tournamentsResult.status === 'rejected') throw tournamentsResult.reason;
        if (registrationsResult.status === 'rejected') throw registrationsResult.reason;
        const r = tournamentsResult.value;
        const registrations = registrationsResult.value;
        if (!Array.isArray(registrations)) {
          throw new Error('Registration data could not be read. Please try again.');
        }
        const list = Array.isArray(r) ? r : r?.tournaments || [];
        const joinedIds = new Set(
          registrations
            .filter((registration: any) => ['approved', 'pending'].includes(String(registration.status ?? '').toLowerCase()))
            .map((registration: any) => String(registration.tournamentId)),
        );
        const successfulRefreshAt = Date.now();
        setItems((currentItems) => mergeHomeTournamentItems(
          currentItems,
          Array.isArray(list) ? list : [],
          joinedIds,
        ));
        setLastSuccessfulRefreshAt(successfulRefreshAt);
        setClockNow(successfulRefreshAt);
        setLoadError('');
      } catch (e: any) {
        if (loadRequestGuardRef.current.isCurrent(requestId)) {
          setLoadError(e?.message || 'Could not load tournaments.');
        }
      } finally {
        activeRequestsRef.current -= 1;
        if (loadRequestGuardRef.current.isCurrent(requestId)) setLoading(false);
      }
    });
    return loadPromise.finally(() => {
      if (
        activeRequestsRef.current === 0 &&
        resumeRefreshPendingRef.current &&
        !homePollInFlightRef.current
      ) {
        resumeRefreshPendingRef.current = false;
        refreshHomeIfIdleRef.current();
      }
    });
  }, []);

  const refreshHomeIfIdle = useCallback(() => {
    if (!homeFocusedRef.current || !shouldRefreshHomeTournaments(appStateRef.current)) return;
    if (homePollInFlightRef.current) return;
    if (activeRequestsRef.current > 0) {
      resumeRefreshPendingRef.current = true;
      return;
    }
    homePollInFlightRef.current = true;
    void load().finally(() => {
      homePollInFlightRef.current = false;
      if (activeRequestsRef.current === 0 && resumeRefreshPendingRef.current) {
        resumeRefreshPendingRef.current = false;
        refreshHomeIfIdleRef.current();
      }
    });
  }, [load]);
  refreshHomeIfIdleRef.current = refreshHomeIfIdle;

  useFocusEffect(useCallback(() => {
    homeFocusedRef.current = true;
    appStateRef.current = AppState.currentState;
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      const returnedToApp = didAppReturnToForeground(appStateRef.current, nextState);
      appStateRef.current = nextState;
      if (!shouldRefreshHomeTournaments(nextState)) {
        resumeRefreshPendingRef.current = false;
      }
      if (returnedToApp) {
        setClockNow(Date.now());
        refreshHomeIfIdle();
      }
    });
    const stopPolling = startHomeTournamentRefreshPolling(
      refreshHomeIfIdle,
      () => shouldRefreshHomeTournaments(AppState.currentState) &&
        activeRequestsRef.current === 0 &&
        !homePollInFlightRef.current,
      HOME_TOURNAMENT_REFRESH_INTERVAL_MS,
    );
    if (activeRequestsRef.current > 0) refreshHomeIfIdle();
    void load();
    return () => {
      homeFocusedRef.current = false;
      resumeRefreshPendingRef.current = false;
      appStateSubscription.remove();
      stopPolling();
    };
  }, [load, refreshHomeIfIdle]));

  React.useEffect(() => {
    Api.settings().then((st: any) => setLinks(st?.settings ?? st ?? {})).catch(() => {});
  }, []);
  React.useEffect(() => {
    const now = Date.now();
    const nextStart = getUpcomingHomeTournaments(items, clockNow)
      .map((tournament) => Date.parse(String(tournament.startsAt ?? '')))
      .filter((start) => Number.isFinite(start) && start > now)
      .sort((a, b) => a - b)[0];
    if (nextStart === undefined) return;
    const timer = setTimeout(() => setClockNow(Date.now()), Math.min(MAX_TIMEOUT_MS, Math.max(0, nextStart - now + 20)));
    return () => clearTimeout(timer);
  }, [items, clockNow]);

  const upcomingItems = getUpcomingHomeTournaments(items, clockNow);
  const openTournamentCounts = countOpenHomeTournamentsByMode(items, clockNow);
  const carouselTournamentOrder = JSON.stringify(
    upcomingItems.slice(0, 8).map((tournament) => String(tournament.id)),
  );

  React.useEffect(() => {
    const visibleItems = upcomingItems.slice(0, 8);
    const lastPage = visibleItems.length - 1;
    const selectedPage = selectedTournamentIdRef.current === null
      ? -1
      : visibleItems.findIndex(
          (tournament) => String(tournament.id) === selectedTournamentIdRef.current,
        );
    const selectedTournamentWasRemoved =
      selectedTournamentIdRef.current !== null && selectedPage < 0;
    const nextPage = selectedPage >= 0
      ? selectedPage
      : Math.max(0, Math.min(pageRef.current, lastPage));
    if (nextPage !== pageRef.current) {
      pageRef.current = nextPage;
      setPage(nextPage);
    }
    const nextTournament = visibleItems[nextPage];
    selectedTournamentIdRef.current = nextTournament
      ? String(nextTournament.id)
      : null;
    carouselRef.current?.scrollTo({ x: nextPage * carouselPageSize, animated: false });
    if (selectedTournamentWasRemoved && screenReaderEnabled && nextTournament) {
      AccessibilityInfo.announceForAccessibility(
        translateExactText(
          `Selected Upcoming match: ${nextTournament.name ?? 'Match'}. Match ${nextPage + 1} of ${visibleItems.length}.`,
        ),
      );
    }
  }, [carouselTournamentOrder, carouselPageSize, screenReaderEnabled]);

  const onCarouselScroll = (e: any) => {
    const x = e?.nativeEvent?.contentOffset?.x ?? 0;
    const p = Math.round(x / carouselPageSize);
    if (p !== pageRef.current) {
      pageRef.current = p;
      setPage(p);
      const selectedTournament = upcomingItems[p];
      selectedTournamentIdRef.current = selectedTournament
        ? String(selectedTournament.id)
        : null;
      if (screenReaderEnabled && selectedTournament) {
        AccessibilityInfo.announceForAccessibility(
          translateExactText(
            `Selected Upcoming match: ${selectedTournament.name ?? 'Match'}. Match ${p + 1} of ${Math.min(upcomingItems.length, 8)}.`,
          ),
        );
      }
    }
  };
  // auto-scroll every 3.5s when more than one match
  React.useEffect(() => {
    if (upcomingItems.length <= 1 || screenReaderEnabled !== false) return;
    const iv = setInterval(() => {
      const next = (pageRef.current + 1) % Math.min(upcomingItems.length, 8);
      try { carouselRef.current?.scrollTo({ x: next * carouselPageSize, animated: true }); } catch {}
    }, 3500);
    return () => clearInterval(iv);
  }, [upcomingItems.length, carouselPageSize, screenReaderEnabled]);
  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const social = (url?: string) => { if (url) Linking.openURL(url).catch(() => {}); };
  const lastSuccessfulUpdateText = lastSuccessfulRefreshAt === null
    ? 'The last successful update time is unavailable.'
    : `Last successful update: ${formatHomeRefreshTimestamp(lastSuccessfulRefreshAt)}.`;
  const staleCardWarning =
    `Could not refresh tournaments. The cards shown may be out of date. ${loadError} ${lastSuccessfulUpdateText}`;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 30 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.neon} />}>
      {/* grid pattern backdrop */}
      <View style={s.gridBg} pointerEvents="none" />

      {/* ===== TOP HEADER ===== */}
      <View style={[s.head, fontScale >= 1.5 && s.headLarge]}>
        <View style={s.headGlow} pointerEvents="none" />
        <View style={[s.logoWrap, fontScale >= 1.5 && s.logoWrapLarge]}>
          <View style={[s.logoBadge, glow(C.neon, 14)]}>
            <Image source={logoImg} style={s.logoImg} resizeMode="cover" />
          </View>
          <View style={[s.logoText, fontScale >= 1.5 && s.logoTextLarge]}>
            <Text style={s.logo}>FREE FIRE</Text>
            <Text style={s.logoSub}>DAILY007 TOURNAMENTS</Text>
          </View>
        </View>
        <View style={[s.headerActions, fontScale >= 1.5 && s.headerActionsLarge]}>
          <Pressable
            style={[s.bellBtn, glow(C.neon, 8)]}
            onPress={() => nav.navigate('Notifications')}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Text style={{ fontSize: 16 }}>🔔</Text>
            <View style={s.bellDot} />
          </Pressable>
          <CoinCapsule
            value={user?.coins ?? 0}
            onPress={() => goTab('wallet')}
            wrapForNarrowScreen={narrowLargeText}
          />
          <Pressable style={[s.avatarBtn, glow(C.purple, 8)]} onPress={() => goTab('profile')}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>{(user?.name ?? 'P').charAt(0).toUpperCase()}</Text>
          </Pressable>
        </View>
      </View>
      <View style={s.headLine} pointerEvents="none" />

      {/* ===== UPCOMING MATCHES — auto carousel ===== */}
      <Pressable
        style={({ pressed }) => [
          s.myMatchesButton,
          narrowLargeText && s.myMatchesButtonLarge,
          pressed && { opacity: 0.8 },
        ]}
        onPress={() => goTab('mymatches')}
        accessibilityRole="button"
        accessibilityLabel="Open My Matches for your room details and results"
      >
        <Text style={s.myMatchesButtonText}>🎮 MY MATCHES</Text>
        <Text style={s.myMatchesButtonHint}>ROOM DETAILS & RESULTS →</Text>
      </Pressable>
      <View style={[s.secRow, fontScale >= 1.5 && s.secRowLarge]}>
        <Text style={s.secTitle}>🔥 UPCOMING MATCHES</Text>
        <Pressable onPress={() => goTab('tournaments')} hitSlop={8} style={fontScale >= 1.5 && s.viewAllPressableLarge}>
          <Text style={s.viewAll}>VIEW ALL →</Text>
        </Pressable>
      </View>
      {!loading && !loadError && lastSuccessfulRefreshAt !== null && (
        <View testID="home-last-updated" style={s.homeLastUpdatedRow}>
          <Text
            style={s.homeLastUpdated}
            accessibilityLabel={`Tournament and registration data last updated ${formatHomeRefreshTimestamp(lastSuccessfulRefreshAt)}`}
          >
            Last updated {formatHomeRefreshTimestamp(lastSuccessfulRefreshAt)}
          </Text>
        </View>
      )}
      {!loading && upcomingItems.length > 0 && Boolean(loadError) && (
        <View testID="home-upcoming-refresh-error" style={s.upcomingRefreshNotice}>
          <Msg
            kind="err"
            text={staleCardWarning}
            accessibilityLabel={staleCardWarning}
            accessibilityLiveRegion="polite"
          />
          <Pressable
            testID="home-upcoming-retry"
            onPress={onRefresh}
            disabled={refreshing}
            accessibilityRole="button"
            accessibilityLabel={refreshing ? 'Retrying tournament refresh' : 'Retry tournament refresh'}
            accessibilityHint="Loads the latest tournament cards and registration status."
            accessibilityState={{ disabled: refreshing, busy: refreshing }}
            style={({ pressed }) => [
              s.upcomingRetryButton,
              refreshing && s.upcomingRetryDisabled,
              pressed && !refreshing && { opacity: 0.78 },
            ]}
          >
            <Text style={s.upcomingRetryText}>{refreshing ? 'RETRYING…' : 'RETRY'}</Text>
          </Pressable>
        </View>
      )}
      {loading ? <Loading /> : upcomingItems.length === 0 ? (
        loadError ? (
          <View testID="home-empty-load-error" style={s.homeEmptyError}>
            <Empty
              icon="🎮"
              title="TOURNAMENTS UNAVAILABLE"
              text={`Could not load tournament cards. ${loadError}`}
              accessibilityLabel={`Could not load tournament cards. ${loadError}`}
              accessibilityLiveRegion="polite"
            />
            <View style={s.homeEmptyErrorActions}>
              <Pressable
                testID="home-empty-retry"
                onPress={onRefresh}
                disabled={refreshing}
                accessibilityRole="button"
                accessibilityLabel={refreshing ? 'Retrying tournament refresh' : 'Retry tournament refresh'}
                accessibilityHint="Loads the latest tournament cards and registration status."
                accessibilityState={{ disabled: refreshing, busy: refreshing }}
                style={({ pressed }) => [
                  s.homeEmptyRetryButton,
                  refreshing && s.upcomingRetryDisabled,
                  pressed && !refreshing && { opacity: 0.78 },
                ]}
              >
                <Text style={s.upcomingRetryText}>{refreshing ? 'RETRYING…' : 'RETRY HOME'}</Text>
              </Pressable>
              <Pressable
                testID="home-empty-check-matches"
                onPress={() => goTab('tournaments')}
                accessibilityRole="button"
                accessibilityLabel="Check matches"
                accessibilityHint="Opens the tournament list with upcoming, ongoing, and completed matches."
                style={s.homeEmptyCheckMatchesButton}
              >
                <Text style={s.viewAll}>CHECK MATCHES →</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Empty
            icon="🎮"
            text="No upcoming tournaments are available right now."
            actionLabel="CHECK MATCHES"
            onAction={() => goTab('tournaments')}
          />
        )
      ) : (
        <>
          <ScrollView
            ref={carouselRef}
            testID="home-upcoming-carousel"
            horizontal pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onCarouselScroll}
            scrollEventThrottle={16}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: 0 }}
            decelerationRate="fast">
        {upcomingItems.slice(0, 8).map((t, index) => {
              const capacity = getHomeTournamentPlayerCapacity(t);
              const filled = Number.isSafeInteger(capacity.filledPlayers) && capacity.filledPlayers >= 0
                ? capacity.filledPlayers
                : 0;
              const total = Number.isSafeInteger(capacity.totalPlayers) && capacity.totalPlayers > 0
                ? capacity.totalPlayers
                : 0;
              const spotsLeft = total > 0 ? Math.max(0, total - filled) : 0;
              const fillPercent = total > 0
                ? Math.min(100, Math.max(0, (filled / total) * 100))
                : 0;
              const stt = statusOf(t, clockNow);
              const ongoing = stt.key === 'ONGOING';
              const formatPresentation = getTournamentFormatPresentation(t);
              const showFormatArt = formatPresentation.showFormatBanner;
              const showBattleRoyalePoster = formatPresentation.showBattleRoyalePoster;
              const br = showBattleRoyalePoster;
              const isKillEarn = isKillEarnTournament(t);
              const perKillCoins = Number(t.perKillCoins ?? t.killRewardCoins ?? 0);
              const schedule = getRoomCredentialSchedule(t.startsAt);
              const matchMetaDate = showBattleRoyalePoster
                ? schedule?.date ?? fmtDate(t.date)
                : `${t.teamType ?? ''} • ${schedule?.date ?? fmtDate(t.date)}`;
              const tournamentModeLabel = String(t.mode || t.gameMode || 'CLASH SQUAD')
                .replace(/[_-]+/g, ' ')
                .toUpperCase();
              const capacityFull = stt.key === 'FULL' || (total > 0 && filled >= total);
              const joined = t.joined === true;
              const ctaLabel = joined
                ? capacityFull ? 'JOINED · SLOTS FULL' : 'JOINED'
                : ongoing ? 'VIEW MATCH' : capacityFull ? 'SLOTS FULL' : 'JOIN NOW ›';
          const cardPosition = `Position ${index + 1} of ${Math.min(upcomingItems.length, 8)}`;
          const selected = index === page;
        return (
          <View
            key={t.id}
            style={{
              width,
              paddingHorizontal: HOME_CAROUSEL_HORIZONTAL_GUTTER,
              alignItems: 'center',
            }}
          >
            <GCard
              testID={`home-upcoming-card-${t.id}`}
              onPress={() => openTournamentDetail(t.id)}
               accessibilityLabel={[
                 `Upcoming match: ${t.name ?? 'Match'}.`,
                 isKillEarn ? `${perKillCoins} coins per kill.` : '',
                 `${cardPosition}.`,
               ].filter(Boolean).join(' ')}
              accessibilityHint="Opens match details."
              accessibilityState={{ selected }}
              glowColor={ongoing ? C.red : br ? C.orange : C.purple}
              style={[s.matchCard, { width: carouselCardWidth }]}
            >
            <View
              style={[
                showBattleRoyalePoster ? s.mPosterBanner : showFormatArt ? s.mFormatBanner : s.mBanner,
                showFormatArt
                  ? { height: Math.max(194, 160 * fontScale) }
                  : !showBattleRoyalePoster
                    ? { height: Math.max(110, 120 * fontScale) }
                    : null,
              ]}
            >
              <Image
                source={showBattleRoyalePoster ? formatPresentation.image : showFormatArt ? formatPresentation.image : br ? bannerSquad : bannerClash}
                style={showBattleRoyalePoster ? s.mPosterBannerImg : s.mBannerImg}
                resizeMode={showBattleRoyalePoster || showFormatArt ? 'contain' : 'cover'}
              />
              {!showBattleRoyalePoster && (
                <>
                  <View style={[s.mBannerShade, { height: Math.max(60, 80 * fontScale) }]} />
                  <View style={s.mBadgeRow}>
                    {ongoing ? <Pulse><Badge text="● ONGOING" color={C.red} /></Pulse> : <Badge text={stt.key} color={stt.color} />}
                    <View style={[s.modeBadge, { borderColor: br ? C.orange : C.purple }]}>
                      <Text style={[s.modeBadgeT, { color: br ? C.orange : C.purple }]}>
                        {br ? 'BATTLE ROYALE' : showFormatArt ? tournamentModeLabel : 'CLASH SQUAD'}
                      </Text>
                    </View>
                  </View>
                  {showFormatArt && !largeModeCard ? (
                    <View style={s.mFormatBottomRow}>
                      <Text testID={`home-upcoming-title-${t.id}`} style={s.mFormatTitle}>{t.name ?? 'Match'}</Text>
                      <View style={s.mFormatBadge}>
                        <Text style={s.mFormatBadgeT}>{formatPresentation.label} · {formatPresentation.matchup}</Text>
                      </View>
                    </View>
                  ) : !showFormatArt && !largeModeCard ? (
                    <Text testID={`home-upcoming-title-${t.id}`} style={s.mTitleOnImg}>{t.name ?? 'Match'}</Text>
                  ) : null}
                </>
              )}
            </View>
            <View style={{ padding: 12 }}>
              {showBattleRoyalePoster && (
                <View style={s.mPosterHeader}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={s.mMode}>BATTLE ROYALE • {String(t.teamType ?? 'SOLO').toUpperCase()}</Text>
                    <Text testID={`home-upcoming-title-${t.id}`} style={s.mTitle}>{t.name ?? 'Match'}</Text>
                  </View>
                  {ongoing ? <Pulse><Badge text="● ONGOING" color={C.red} /></Pulse> : <Badge text={stt.key} color={stt.color} />}
                </View>
              )}
              {largeModeCard && !showBattleRoyalePoster && (
                <View style={s.mLargeTitleBlock}>
                  <Text testID={`home-upcoming-title-${t.id}`} style={s.mTitle}>{t.name ?? 'Match'}</Text>
                  {showFormatArt && (
                    <View style={s.mFormatBadge}>
                      <Text style={s.mFormatBadgeT}>{formatPresentation.label} · {formatPresentation.matchup}</Text>
                    </View>
                  )}
                </View>
              )}
              <Text style={s.mSub}>{matchMetaDate} • <Text style={s.mTime}>{fmtTime12(schedule?.startTime24 ?? t.time)} IST</Text></Text>
              <View style={[s.mStats, isKillEarn && s.mStatsKillEarn]}>
                <View style={[s.mStat, isKillEarn && s.mStatKillEarn]}>
                  <Text style={isKillEarn ? s.mStatLKillEarn : s.mStatL}>ENTRY</Text>
                  <Text style={[s.mStatV, isKillEarn && s.mStatVKillEarn, { color: C.orange }]}>🪙 {t.entryCoins ?? 0}</Text>
                </View>
                {isKillEarn && (
                  <View testID={`home-upcoming-per-kill-${t.id}`} style={[s.mStat, s.mStatKillEarn]}>
                    <Text style={s.mStatLKillEarn}>PER KILL</Text>
                    <Text style={[s.mStatV, s.mStatVKillEarn, { color: C.gold }]}>🪙 {perKillCoins}</Text>
                  </View>
                )}
                <View style={[s.mStat, isKillEarn && s.mStatKillEarn]}>
                  <Text style={isKillEarn ? s.mStatLKillEarn : s.mStatL}>PRIZE POOL</Text>
                  <Text style={[s.mStatV, isKillEarn && s.mStatVKillEarn, { color: C.green }]}>🪙 {t.prizePool ?? 0}</Text>
                </View>
                <View
                  testID={`home-upcoming-player-capacity-${t.id}`}
                  style={[s.mStat, s.mStatCapacity, isKillEarn && s.mStatKillEarn]}
                >
                  <Text style={[isKillEarn ? s.mStatLKillEarn : s.mStatL, s.mStatCapacityLabel]}>
                    {translateExactText('PLAYERS')}
                  </Text>
                  <Text style={[s.mStatV, s.mStatCapacityValue, isKillEarn && s.mStatVKillEarn]}>
                    {filled}/{total}
                  </Text>
                </View>
              </View>
              <View
                testID={`home-upcoming-player-progress-${t.id}`}
                style={s.slotBar}
                accessibilityRole="progressbar"
                accessibilityLabel={`${filled}/${total} ${translateExactText('PLAYERS')}`}
                accessibilityValue={total > 0 ? { min: 0, max: total, now: Math.min(filled, total) } : undefined}
              >
                <View
                  style={[
                    s.slotFill,
                    { width: `${fillPercent}%`, backgroundColor: spotsLeft <= 1 ? C.gold : C.green },
                  ]}
                />
              </View>
              {spotsLeft > 0 && (
                <View style={s.slotAvailabilityRow}>
                  <View testID={`home-upcoming-spots-left-${t.id}`} style={s.spotsLeftBadge}>
                    <Text style={s.spotsLeftText}>
                      {spotsLeft} {translateExactText('SPOTS LEFT')}
                    </Text>
                  </View>
                </View>
              )}
              <View
                pointerEvents="none"
                style={[
                  s.joinBtn,
                  joined && { backgroundColor: C.green + '22', borderColor: C.green + '77' },
                  !joined && capacityFull && !ongoing && { backgroundColor: C.card2, borderColor: C.border },
                ]}
              >
                <Text style={[s.joinBtnT, joined && { color: C.green }, !joined && capacityFull && !ongoing && { color: C.dim }]}>{ctaLabel}</Text>
              </View>
            </View>
            </GCard>
          </View>
            ); })}
          </ScrollView>
          {upcomingItems.length > 1 && (
            <View testID="home-upcoming-page-indicators" style={s.dots}>
              {upcomingItems.slice(0, 8).map((_, i) => (
                <View key={i} testID={`home-upcoming-page-dot-${i}`} style={[s.dot, i === page && { backgroundColor: C.neon, width: 16 }]} />
              ))}
            </View>
          )}
        </>
      )}

      {/* ===== KNOCKOUT SQUAD TOURNAMENT ===== */}
      <KnockoutHomeCard
        event={
          knockoutInfo?.events.find((event) => event.registrationOpen) ??
          knockoutInfo?.events.find((event) => event.status === 'ongoing') ??
          knockoutInfo?.events[0] ??
          null
        }
        defaults={knockoutInfo?.defaults ?? HOME_KNOCKOUT_DEFAULTS}
        loading={loading && knockoutInfo === null}
        error={publicKnockoutQuery.isError}
        onJoin={openTournamentDetail}
        onOpen={openKnockoutSection}
      />
      {/* ===== GAME MODES ===== */}
      <SectionTitle accent={C.orange}>GAME MODES</SectionTitle>
      <HomeGameModeCards
        modeCounts={openTournamentCounts}
        modeCountsReady={lastSuccessfulRefreshAt !== null}
        onOpenMode={(params) => nav.push('Tournaments', params)}
      />

      <HomeLeaderboards onOpen={() => nav.navigate('LeaderboardDetails', { cycleType: 'weekly' })} />

      {/* ===== SOCIAL ===== */}
      <SectionTitle accent={C.blue}>JOIN THE COMMUNITY</SectionTitle>
      {[
        { Icon: WhatsAppIcon, label: 'WHATSAPP', action: 'JOIN', color: '#25D366', bg: '#0b2e1a', key: 'whatsapp', settingKey: 'whatsappLink' },
        { Icon: InstagramIcon, label: 'INSTAGRAM', action: 'FOLLOW', color: '#ff4d8d', bg: '#2a0f1e', key: 'instagram', settingKey: 'instagramLink' },
        { Icon: YouTubeIcon, label: 'YOUTUBE', action: 'SUBSCRIBE', color: C.red, bg: '#2a0d0d', key: 'youtube', settingKey: 'youtubeLink' },
      ].map((sc) => (
        <Pressable key={sc.key} style={({ pressed }) => [s.socialBtn, { backgroundColor: sc.bg, borderColor: sc.color + '66' }, glow(sc.color, 10), pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 }]}
          onPress={() => social(links?.[sc.settingKey] || links?.[sc.key] || links?.social?.[sc.key])}>
          <View style={[s.socialIconWrap, { borderColor: sc.color + '55' }, glow(sc.color, 8)]}>
            <sc.Icon size={26} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.socialLabel, { color: sc.color }]}>{sc.label}</Text>
            <Text style={s.socialAction}>{sc.action}</Text>
          </View>
          <Text style={[s.socialChev, { color: sc.color }]}>›</Text>
        </Pressable>
      ))}
      <View style={{ height: 10 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  gridBg: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 420, opacity: 0.35,
    borderTopWidth: 1, borderTopColor: '#70b8ff06',
  },
  head: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12, paddingBottom: 12,
    backgroundColor: '#0d1226', borderBottomWidth: 0, overflow: 'hidden',
  },
  headLarge: { flexWrap: 'wrap', alignItems: 'flex-start' },
  headGlow: { position: 'absolute', top: -60, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: C.neon + '14' },
  headLine: { height: 2, backgroundColor: C.neon + '55', shadowColor: C.neon, shadowOpacity: 0.8, shadowRadius: 8 },
  logoWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  logoWrapLarge: { flexBasis: '100%', width: '100%' },
  logoText: { flex: 1, minWidth: 0 },
  logoTextLarge: { minWidth: 0 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  headerActionsLarge: { width: '100%', flexWrap: 'wrap', justifyContent: 'flex-start', marginTop: 10 },
  logoBadge: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: C.bg2, borderWidth: 1.5,
    borderColor: C.neon, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  logoImg: { width: 40, height: 40 },
  logo: { color: C.text, fontFamily: 'Orbitron_700Bold', fontWeight: '900', fontSize: 15, letterSpacing: 0.6, textShadowColor: C.neon + '88', textShadowRadius: 10 },
  logoSub: { color: C.gold, fontWeight: '900', fontSize: 8, letterSpacing: 1, marginTop: 1 },
  bellBtn: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: C.blue + '12', borderWidth: 1,
    borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  myMatchesButton: {
    marginHorizontal: 16, marginTop: 12, marginBottom: 2, minHeight: 48, borderRadius: 12,
    paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.card, borderWidth: 1, borderColor: C.neon + '66',
  },
  myMatchesButtonLarge: { flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 4, paddingVertical: 10 },
  myMatchesButtonText: { color: C.text, fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  myMatchesButtonHint: { color: C.neon, fontWeight: '800', fontSize: 9, letterSpacing: 0.7 },
  bellDot: { position: 'absolute', top: 7, right: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: C.red, shadowColor: C.red, shadowOpacity: 1, shadowRadius: 4 },
  avatarBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#241533', borderWidth: 1.5,
    borderColor: C.purple, alignItems: 'center', justifyContent: 'center',
  },
  hero: {
    marginHorizontal: 16, borderRadius: 20, borderWidth: 1.5, borderColor: C.neon + '88',
    backgroundColor: '#160a12', overflow: 'hidden', flexDirection: 'row', minHeight: 168,
  },
  heroGlow: { position: 'absolute', top: -40, right: -30, width: 160, height: 160, borderRadius: 80, backgroundColor: C.neon + '22' },
  heroArt: { width: 110, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000033' },
  heroBody: { flex: 1, padding: 16, justifyContent: 'center' },
  heroTitle: { color: '#fff', fontWeight: '900', fontSize: 19, letterSpacing: 1, textShadowColor: C.neon, textShadowRadius: 12 },
  heroSub: { color: C.gold, fontWeight: '900', fontSize: 11, letterSpacing: 3, marginTop: 4 },
  heroDesc: { color: C.sub, fontSize: 11, marginTop: 6, lineHeight: 16 },
  heroBtn: {
    marginTop: 12, alignSelf: 'flex-start', backgroundColor: C.neon, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 20,
  },
  heroBtnText: { color: C.bg, fontWeight: '900', letterSpacing: 1.5, fontSize: 13 },
  matchCard: { padding: 0, overflow: 'hidden' },
  secRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 14, marginBottom: 8 },
  secRowLarge: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  viewAllPressableLarge: { alignSelf: 'flex-end' },
  homeLastUpdatedRow: { paddingHorizontal: 16, marginTop: -3, marginBottom: 8 },
  homeLastUpdated: { color: C.sub, fontSize: 10, letterSpacing: 0.35 },
  upcomingRefreshNotice: { marginHorizontal: 16, marginBottom: 8 },
  upcomingRetryButton: {
    alignSelf: 'flex-start', minHeight: 44, marginTop: 8, paddingHorizontal: 14,
    justifyContent: 'center', borderRadius: 10, borderWidth: 1,
    borderColor: C.orange + '77', backgroundColor: C.orange + '14',
  },
  upcomingRetryDisabled: { opacity: 0.62 },
  upcomingRetryText: { color: C.orange, fontWeight: '900', fontSize: 12, letterSpacing: 1.2 },
  homeEmptyError: { alignItems: 'center' },
  homeEmptyErrorActions: { alignItems: 'center', gap: 6, width: '100%', paddingHorizontal: 24, marginTop: -18, marginBottom: 16 },
  homeEmptyRetryButton: {
    minHeight: 44, width: '100%', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, borderRadius: 10, borderWidth: 1,
    borderColor: C.orange + '77', backgroundColor: C.orange + '14',
  },
  homeEmptyCheckMatchesButton: { minHeight: 44, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  secTitle: { color: C.text, fontWeight: '900', fontSize: 14, letterSpacing: 1.5 },
  viewAll: { color: C.neon, fontWeight: '900', fontSize: 11, letterSpacing: 1 },
  mBanner: { height: 110, backgroundColor: '#0a0e1e' },
  mFormatBanner: { width: '100%', aspectRatio: 16 / 9, backgroundColor: C.bg2, overflow: 'hidden' },
  mPosterBanner: { width: '100%', aspectRatio: 16 / 9, backgroundColor: C.bg2, overflow: 'hidden' },
  mBannerImg: { width: '100%', height: '100%' },
  mPosterBannerImg: { width: '100%', height: '100%' },
  mBannerShade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, backgroundColor: '#00000088' },
  mBadgeRow: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modeBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#000000aa' },
  modeBadgeT: { fontSize: 8.5, fontWeight: '900', letterSpacing: 1 },
  mTitleOnImg: { position: 'absolute', bottom: 8, left: 10, right: 10, color: '#fff', fontWeight: '900', fontSize: 15, textShadowColor: '#000', textShadowRadius: 6 },
  mFormatBottomRow: { position: 'absolute', bottom: 8, left: 10, right: 10, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 },
  mFormatTitle: { flex: 1, minWidth: 0, color: '#fff', fontWeight: '900', fontSize: 15, textShadowColor: '#000', textShadowRadius: 6 },
  mLargeTitleBlock: { alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  mFormatBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4, backgroundColor: C.gold },
  mFormatBadgeT: { color: C.bg, fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  joinBtn: { marginTop: 10, backgroundColor: C.neon, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  joinBtnT: { color: C.bg, fontWeight: '900', letterSpacing: 1.5, fontSize: 12.5 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 14, marginTop: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#2a3350' },
  mTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  mMode: { color: C.orange, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  mTitle: { color: C.text, fontWeight: '900', fontSize: 15, marginTop: 2 },
  mPosterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  mSub: { color: C.sub, fontSize: 11, marginTop: 3 },
  mTime: { color: C.gold, fontSize: 15, fontWeight: '900' },
  mDivider: { height: 1, backgroundColor: C.border, marginVertical: 10 },
  mStats: { flexDirection: 'row' },
  mStatsKillEarn: { alignItems: 'stretch' },
  mStat: { flex: 1, alignItems: 'center' },
  mStatCapacity: { minWidth: 0 },
  mStatCapacityLabel: { color: C.gold },
  mStatCapacityValue: { fontSize: 15, letterSpacing: 0.1 },
  mStatKillEarn: { minWidth: 0, paddingHorizontal: 1 },
  mStatL: { color: C.dim, fontSize: 9, letterSpacing: 1.5, fontWeight: '800' },
  mStatLKillEarn: { color: C.dim, fontSize: 8, letterSpacing: 0.6, fontWeight: '800', textAlign: 'center' },
  mStatV: { color: C.text, fontWeight: '900', fontSize: 14, marginTop: 3 },
  mStatVKillEarn: { fontSize: 12, letterSpacing: -0.4 },
  slotBar: { height: 5, backgroundColor: '#1a2136', borderRadius: 3, marginTop: 9, overflow: 'hidden' },
  slotFill: { height: 4, backgroundColor: C.neon, borderRadius: 2 },
  slotAvailabilityRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 6 },
  spotsLeftBadge: {
    minHeight: 23, justifyContent: 'center', paddingHorizontal: 9,
    borderWidth: 1, borderColor: C.green + '66', borderRadius: 12,
    backgroundColor: C.green + '16',
  },
  spotsLeftText: { color: C.green, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  socialBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 12,
    borderRadius: 16, borderWidth: 1.2, paddingVertical: 12, paddingHorizontal: 14,
  },
  socialIconWrap: {
    width: 46, height: 46, borderRadius: 14, borderWidth: 1.2, backgroundColor: '#70b8ff0a',
    alignItems: 'center', justifyContent: 'center',
  },
  socialLabel: { fontWeight: '900', fontSize: 13, letterSpacing: 1.5 },
  socialAction: { color: C.sub, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginTop: 1 },
  socialChev: { fontSize: 22, fontWeight: '900' },
});
