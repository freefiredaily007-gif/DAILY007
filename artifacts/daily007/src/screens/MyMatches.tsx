// My Matches — upcoming / live / completed tabs with room details
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View, FlatList, StyleSheet, RefreshControl, Pressable, useWindowDimensions } from 'react-native';
import * as Network from 'expo-network';
import { ReadableText as Text } from '../components/typography';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Api, apiError } from '../lib/api';
import { C, Btn, Empty, Loading, GCard, Badge, SectionTitle, fmtDate, fmtTime12 } from '../components/ui';
import { RoomCredentialsPanel } from '../components/RoomCredentialsPanel';
import {
  getRoomCredentialReleaseDelayMs,
  getRoomCredentialSchedule,
  hasServerAuthorizedRoomCredentials,
} from '../lib/roomCredentialTiming';
import { canEditRegistrationTeam, getTeamEditCutoff } from '../lib/teamEditWindow';
import {
  compareTournamentStartTime,
  didAppReturnToForeground,
  getTournamentLifecycleState,
  MAX_TIMEOUT_MS,
} from '../lib/tournamentLifecycle';

export default function MyMatches() {
  const { fontScale } = useWindowDimensions();
  const navigation: any = useNavigation();
  const [regs, setRegs] = useState<any[]>([]);
  const [tab, setTab] = useState<'upcoming' | 'ongoing' | 'completed'>('upcoming');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());
  const [serverNowMs, setServerNowMs] = useState<number | null>(null);
  const appState = useRef(AppState.currentState);

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await Api.myRegistrations();
      const registrations = Array.isArray(data) ? data : [];
      setRegs(registrations);
      const timeSample = registrations.find((registration: any) =>
        Number.isFinite(registration.serverNowMs),
      )?.serverNowMs;
      setServerNowMs(Number.isFinite(timeSample) ? timeSample : null);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshMatches = useCallback(() => {
    setClockNow(Date.now());
    void load();
  }, [load]);

  useFocusEffect(useCallback(() => {
    appState.current = AppState.currentState;
    refreshMatches();
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returnedToApp = didAppReturnToForeground(appState.current, nextState);
      appState.current = nextState;
      if (returnedToApp) refreshMatches();
    });
    const networkSubscription = Network.addNetworkStateListener((networkState) => {
      if (networkState.isConnected === true && networkState.isInternetReachable !== false) {
        refreshMatches();
      }
    });
    return () => {
      subscription.remove();
      networkSubscription.remove();
    };
  }, [refreshMatches]));

  useEffect(() => {
    const transitions = regs.flatMap((registration) => {
      const startsAt = registration.tournament?.startsAt ?? registration.startsAt;
      const schedule = getRoomCredentialSchedule(startsAt);
      return [
        getTeamEditCutoff(startsAt),
        schedule?.startsAtMs ?? null,
      ];
    });
    const nextTransition = transitions
      .filter((time): time is number => time !== null && Number.isFinite(time) && time > clockNow)
      .sort((a, b) => a - b)[0];
    if (nextTransition === undefined) return;
    const timer = setTimeout(() => {
      refreshMatches();
    }, Math.min(MAX_TIMEOUT_MS, nextTransition - clockNow));
    return () => clearTimeout(timer);
  }, [regs, clockNow, refreshMatches]);

  useEffect(() => {
    if (serverNowMs === null) return;
    const nextReleaseDelay = regs.flatMap((registration) => {
      const status = String(registration.status ?? '').toLowerCase();
      const tournament = registration.tournament ?? {};
      const cancelled = String(tournament.status ?? '').toLowerCase() === 'cancelled';
      const roomConfigured = registration.roomPublished === true || tournament.roomPublished === true;
      if (status !== 'approved' || cancelled || !roomConfigured) return [];
      const roomId = registration.roomId ?? tournament.roomId;
      const roomPassword = registration.roomPassword ?? tournament.roomPassword;
      if (hasServerAuthorizedRoomCredentials(roomId, roomPassword)) return [];
      const startsAt = tournament.startsAt ?? registration.startsAt;
      const schedule = getRoomCredentialSchedule(startsAt);
      const delay = schedule
        ? getRoomCredentialReleaseDelayMs(schedule.releaseAtMs, serverNowMs)
        : null;
      return delay === null ? [] : [delay];
    }).sort((a, b) => a - b)[0];
    if (nextReleaseDelay === undefined) return;
    const timer = setTimeout(
      refreshMatches,
      Math.min(MAX_TIMEOUT_MS, nextReleaseDelay),
    );
    return () => clearTimeout(timer);
  }, [regs, serverNowMs, refreshMatches]);

  const filtered = regs.filter((r) => {
    const state = getTournamentLifecycleState(r.tournament, clockNow);
    if (tab === 'upcoming') return state === 'upcoming';
    if (tab === 'ongoing') return state === 'ongoing';
    return state === 'completed' || String(r.tournament?.status ?? '').toLowerCase() === 'cancelled';
  });
  const orderedMatches = tab === 'ongoing'
    ? [...filtered].sort((a, b) => compareTournamentStartTime(
      { startsAt: a.tournament?.startsAt ?? a.startsAt },
      { startsAt: b.tournament?.startsAt ?? b.startsAt },
    ))
    : filtered;

  return (
    <View style={s.wrap}>
      <SectionTitle accent={C.purple}>MY MATCHES</SectionTitle>
      <View style={s.tabs}>
        {(['upcoming', 'ongoing', 'completed'] as const).map((t) => (
          <Pressable
            key={t}
            testID={`my-matches-tab-${t}`}
            accessibilityRole="button"
            accessibilityLabel={`${t} matches`}
            accessibilityState={{ selected: tab === t }}
            onPress={() => setTab(t)}
            style={[s.tab, tab === t && s.tabOn]}
          >
            <Text style={[s.tabText, tab === t && s.tabTextOn]}>{t.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      {loading ? <Loading /> : error ? (
        <Text style={s.err}>{error}</Text>
      ) : filtered.length === 0 ? (
        <Empty icon="📋" text={'No ' + tab + ' matches yet. Join a tournament to get started!'} actionLabel="CHECK MATCHES" onAction={() => {}} />
      ) : (
        <FlatList
          data={orderedMatches}
          keyExtractor={(r, i) => String(r.id ?? i)}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.neon} />}
          contentContainerStyle={{ padding: 14, gap: 12 }}
          renderItem={({ item }) => {
            const t = item.tournament ?? {};
            const status = String(item.status ?? '').toLowerCase();
            const tournamentStatus = String(t.status ?? '').toLowerCase();
            const lifecycle = getTournamentLifecycleState(t, clockNow);
            const cancelled = tournamentStatus === 'cancelled';
            const matchFinished = lifecycle === 'completed' || cancelled;
            const roomId = item.roomId ?? t.roomId;
            const roomPassword = item.roomPassword ?? t.roomPassword;
            const startsAt = t.startsAt ?? item.startsAt;
            const schedule = getRoomCredentialSchedule(startsAt);
            const startMs = schedule?.startsAtMs ?? Number.NaN;
            const roomConfigured = item.roomPublished === true || t.roomPublished === true;
            const roomReady = status === 'approved' && !cancelled &&
              hasServerAuthorizedRoomCredentials(roomId, roomPassword);
            const registrationActive = ['approved', 'pending'].includes(status);
            const editEligible = registrationActive && t.enabled !== false && lifecycle === 'upcoming';
            const canEditTeam = editEligible && canEditRegistrationTeam(t, status, clockNow);
            const editCutoff = getTeamEditCutoff(startsAt);
            const teamEditLocked = editEligible && editCutoff !== null && clockNow >= editCutoff;
            const result = typeof item.result === 'string'
              ? item.result
              : item.result?.description ?? item.result?.result ?? item.result?.placement;
            const results = Array.isArray(t.results) ? t.results : [];
            return (
              <GCard key={item.id} glowColor={roomReady ? C.green : undefined}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={s.mode}>{String(t.mode ?? '').toUpperCase()} • {String(t.teamType ?? '').toUpperCase()}</Text>
                    <Text style={s.tName}>{t.name ?? 'Tournament'}</Text>
                  </View>
                    <Badge
                      text={cancelled ? 'CANCELLED' : matchFinished ? 'COMPLETED' : lifecycle === 'ongoing' ? 'ONGOING' : status === 'approved' ? 'CONFIRMED' : status.toUpperCase()}
                      color={cancelled ? C.red : matchFinished ? C.gold : lifecycle === 'ongoing' ? C.red : status === 'approved' ? C.green : status === 'rejected' ? C.red : C.gold}
                    />
                </View>
                <Text style={s.meta}>SCHEDULED START: {schedule?.date ?? fmtDate(t.date)} • <Text style={s.timeMeta}>{fmtTime12(schedule?.startTime24 ?? t.time)} IST</Text></Text>
                {cancelled ? <Text style={s.meta}>Any entry fee paid was refunded to the paying account.</Text> : null}
                {item.teamName ? <Text style={s.meta}>Team: {item.teamName}</Text> : null}
                {canEditTeam ? (
                  <Btn
                    title="EDIT TEAM"
                    kind="ghost"
                    small
                    accessibilityLabel={`Edit your team for ${t.name ?? 'this tournament'}`}
                    onPress={() => navigation.navigate('JoinForm', { id: t.id ?? item.tournamentId, registration: item })}
                    style={{ marginTop: 10 }}
                  />
                ) : teamEditLocked ? (
                  <Btn title="TEAM EDITING LOCKED" kind="ghost" small disabled style={{ marginTop: 10 }} />
                ) : null}
                {status === 'approved' && !cancelled ? (
                  <RoomCredentialsPanel
                    startsAt={startsAt}
                    now={clockNow}
                    configured={roomConfigured}
                    roomId={roomId}
                    roomPassword={roomPassword}
                  />
                ) : !cancelled ? (
                  <View style={s.room}>
                    <Text style={s.roomLocked}>
                      {status === 'pending'
                        ? 'Entry is pending admin approval.'
                        : status === 'rejected'
                          ? 'Registration rejected; the entry fee was refunded.'
                          : 'Registration status is unavailable.'}
                    </Text>
                  </View>
                ) : null}
                  {results.length > 0 ? (
                    <View style={s.results}>
                      <Text style={s.resultsTitle}>TOURNAMENT RESULTS</Text>
                      {results.map((entry: any, index: number) => {
                        const gameName = String(entry.gameName || '').trim();
                        const teamName = String(entry.teamName || '').trim();
                        const winnerName = gameName || teamName || 'Player';
                        const resultMeta = [
                          teamName ? `TEAM ${teamName}` : '',
                          entry.kills != null ? `${entry.kills} KILLS` : '',
                        ].filter(Boolean).join(' · ');
                        const avatarName = gameName || teamName || 'P';
                        const rank = Number(entry.rank) || index + 1;
                        const rankStyle = rank === 1
                          ? s.rankGold
                          : rank === 2
                            ? s.rankSilver
                            : rank === 3
                              ? s.rankBronze
                              : s.rankOther;
                        const avatarColors = ['#e94721', '#65423b', '#1f675c', '#5c4b7d'];
                        return (
                          <View
                            key={`${entry.rank ?? 'rank'}-${index}`}
                            style={[
                              s.resultRow,
                              fontScale >= 1.5 && s.resultRowLarge,
                              index === results.length - 1 && s.resultRowLast,
                            ]}
                          >
                            <View style={[s.rankMedal, rankStyle]}>
                              <Text style={s.rankNumber}>{rank}</Text>
                            </View>
                            <View style={[s.resultAvatar, { backgroundColor: avatarColors[index % avatarColors.length] }]}>
                              <Text style={s.resultAvatarInitial}>{avatarName.charAt(0).toUpperCase()}</Text>
                            </View>
                            <View style={s.resultIdentity}>
                              <Text style={s.resultName}>{winnerName}</Text>
                              {!!resultMeta && <Text style={s.resultKills}>{resultMeta}</Text>}
                            </View>
                              <View style={[s.prizeWrap, fontScale >= 1.5 && s.prizeWrapLarge]}>
                              <View style={s.prizeAmountRow}>
                                <View style={s.coinIcon}><Text style={s.coinStar}>★</Text></View>
                                <Text style={s.prizeAmount}>{entry.prizeCoins ?? 0}</Text>
                              </View>
                              <Text style={s.prizeLabel}>Prize Won</Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ) : result ? <Text style={s.result}>🏆 {String(result)}</Text> : null}
              </GCard>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  h1: { color: C.text, fontSize: 22, fontWeight: '900', letterSpacing: 1, padding: 14, paddingBottom: 4 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14, gap: 8, marginBottom: 6 },
  tab: { flexGrow: 1, flexShrink: 1, minWidth: 96, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#151a29' },
  tabText: { color: C.sub, fontWeight: '800', fontSize: 11, letterSpacing: 1, textAlign: 'center' },
  tabTextOn: { color: C.bg },
  tabOn: { backgroundColor: C.neon },
  err: { color: '#ef4444', textAlign: 'center', marginTop: 40, paddingHorizontal: 20 },
  mode: { color: C.orange, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  tName: { color: C.text, fontWeight: '900', fontSize: 16, marginTop: 2 },
  meta: { color: C.sub, fontSize: 12, marginTop: 4 },
  timeMeta: { color: C.gold, fontSize: 15, fontWeight: '900' },
  room: { backgroundColor: C.bg2, borderRadius: 10, padding: 10, marginTop: 10, borderWidth: 1, borderColor: C.border },
  roomLocked: { color: '#f59e0b', fontSize: 12, fontWeight: '600' },
  results: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border },
  resultsTitle: { color: '#fbbf24', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginBottom: 4 },
  result: { color: '#fbbf24', fontWeight: '800', marginTop: 8, fontSize: 13 },
  resultRow: { flexDirection: 'row', alignItems: 'center', minHeight: 78, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#343842', gap: 8 },
  resultRowLarge: { flexWrap: 'wrap', alignItems: 'flex-start' },
  resultRowLast: { borderBottomWidth: 0 },
  rankMedal: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rankGold: { backgroundColor: '#f6bf24', borderColor: '#ffe17c' },
  rankSilver: { backgroundColor: '#cbd0d6', borderColor: '#f1f2f4' },
  rankBronze: { backgroundColor: '#c77b48', borderColor: '#e0a273' },
  rankOther: { backgroundColor: C.card2, borderColor: C.border },
  rankNumber: { color: '#262626', fontSize: 12, fontWeight: '900' },
  resultAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  resultAvatarInitial: { color: '#fff', fontSize: 21, fontWeight: '600' },
  resultIdentity: { flex: 1, minWidth: 0 },
  resultName: { color: C.text, fontSize: 14, fontWeight: '900', letterSpacing: 0.3 },
  resultSub: { color: '#848994', fontSize: 11, fontWeight: '600', letterSpacing: 0.2, marginTop: 4 },
  resultKills: { color: C.dim, fontSize: 9, fontWeight: '800', letterSpacing: 0.4, marginTop: 3 },
  prizeWrap: { minWidth: 66, alignItems: 'flex-end', flexShrink: 0 },
  prizeWrapLarge: { marginLeft: 84, alignItems: 'flex-start' },
  prizeAmountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
  coinIcon: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#ffcc42', backgroundColor: '#e79b00', alignItems: 'center', justifyContent: 'center' },
  coinStar: { color: '#fff3ad', fontSize: 10, fontWeight: '900', lineHeight: 12 },
  prizeAmount: { color: C.green, fontSize: 19, fontWeight: '900', lineHeight: 22 },
  prizeLabel: { color: '#848994', fontSize: 10, fontWeight: '600', marginTop: 4 },
});
