import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, ActivityIndicator, AccessibilityInfo, Platform, AppState } from 'react-native';
import {
  getGetTournamentParticipantsQueryKey,
  getGetTournamentResultsQueryKey,
  useGetTournamentParticipants,
  useGetTournamentResults,
} from '@workspace/api-client-react';
import { ReadableText as Text } from '../components/typography';
import { useFocusEffect, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../lib/api';
import { C, Btn, Card, Chip, Input, KV, Msg, Badge, SectionTitle, GCard, fmtDate, fmtTime12, statusOf } from '../components/ui';
import { inr, COIN_RATE_TEXT } from '../lib/coins';
import { useApp } from '../App';
import { RoomCredentialsPanel } from '../components/RoomCredentialsPanel';
import {
  getRoomCredentialSchedule,
  hasServerAuthorizedRoomCredentials,
} from '../lib/roomCredentialTiming';
import { createRoomCredentialAvailabilityAnnouncementTracker } from '../lib/roomCredentialAvailabilityAnnouncement';
import { getTournamentLifecycleState, MAX_TIMEOUT_MS } from '../lib/tournamentLifecycle';
import {
  createTournamentDetailRefreshController,
  fetchTournamentDetailSnapshot,
} from '../lib/tournament-detail-refresh';
import {
  getTournamentResultsRefreshInterval,
  resolveTournamentWinnerState,
} from '../lib/tournament-winner-details';

const claimRoomDetailsAvailabilityAnnouncement =
  createRoomCredentialAvailabilityAnnouncementTracker();

export default function TDetail() {
  const nav: any = useNavigation();
  const route: any = useRoute();
  const isFocused = useIsFocused();
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  const id = route?.params?.id;
  const { user } = useApp();
  const tournamentId = String(id ?? '');
  const [t, setT] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [retryingRegistrationStatus, setRetryingRegistrationStatus] = useState(false);
  const [retryingParticipants, setRetryingParticipants] = useState(false);
  const [participantsRetryAnnouncement, setParticipantsRetryAnnouncement] = useState('');
  const [roomDetailsAvailabilityAnnouncement, setRoomDetailsAvailabilityAnnouncement] = useState('');
  const retryParticipantsInFlight = useRef(false);
  const participantsScreenFocusedRef = useRef(false);
  const participantsRetryFocusVersion = useRef(0);
  const detailLoadInFlight = useRef(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const participantsQuery = useGetTournamentParticipants(tournamentId, {
    query: {
      queryKey: getGetTournamentParticipantsQueryKey(tournamentId),
      enabled: Boolean(id),
      refetchOnMount: 'always',
      retry: 1,
    },
  });
  const resultsQuery = useGetTournamentResults(tournamentId, {
    query: {
      queryKey: getGetTournamentResultsQueryKey(tournamentId),
      enabled: Boolean(id) && isFocused,
      refetchOnMount: 'always',
      refetchInterval: getTournamentResultsRefreshInterval(isFocused && isAppActive),
      retry: 1,
    },
  });
  const isCompleted =
    String(t?.status ?? '').toLowerCase() === 'completed' ||
    String(resultsQuery.data?.status ?? '').toLowerCase() === 'finalized';
  const roomCredentialsAvailable =
    String(t?.myRegistration?.status ?? '').toLowerCase() === 'approved' &&
    String(t?.status ?? '').toLowerCase() !== 'cancelled' &&
    hasServerAuthorizedRoomCredentials(
      t?.myRegistration?.roomId,
      t?.myRegistration?.roomPassword,
    );

  useFocusEffect(
    useCallback(() => {
      participantsScreenFocusedRef.current = true;
      participantsRetryFocusVersion.current += 1;
      setParticipantsRetryAnnouncement('');
      return () => {
        participantsScreenFocusedRef.current = false;
        participantsRetryFocusVersion.current += 1;
        setParticipantsRetryAnnouncement('');
      };
    }, [tournamentId]),
  );

  useEffect(() => {
    if (!isFocused || !claimRoomDetailsAvailabilityAnnouncement(tournamentId, roomCredentialsAvailable)) {
      return;
    }
    const announcement = 'Room details are now available.';
    setRoomDetailsAvailabilityAnnouncement(announcement);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(announcement);
  }, [isFocused, tournamentId, roomCredentialsAvailable]);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    if (detailLoadInFlight.current) return;
    detailLoadInFlight.current = true;
    try {
      setErr('');
      const tournamentDetails = await fetchTournamentDetailSnapshot(String(id), api);
      setT(tournamentDetails);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load');
    } finally {
      detailLoadInFlight.current = false;
      setLoading(false);
    }
  }, [id]);
  const refreshAll = useCallback(async () => {
    await Promise.all([
      load(),
      participantsQuery.refetch(),
      resultsQuery.refetch(),
    ]);
  }, [load, participantsQuery.refetch, resultsQuery.refetch]);
  const retryRegistrationStatus = async () => {
    setRetryingRegistrationStatus(true);
    try {
      await load();
    } finally {
      setRetryingRegistrationStatus(false);
    }
  };
  const retryParticipants = async () => {
    if (retryParticipantsInFlight.current || participantsQuery.isFetching) return;
    retryParticipantsInFlight.current = true;
    const focusVersion = participantsRetryFocusVersion.current;
    setRetryingParticipants(true);
    announceParticipantsRetry('Retrying participant list.', focusVersion);
    try {
      const result = await participantsQuery.refetch();
      announceParticipantsRetry(
        result.isSuccess
          ? `Participant list updated. Joined ${teamTournament ? 'teams' : 'players'}: ${result.data.participants.length}.`
          : 'Retry failed. The participant list is still unavailable. You can retry again.',
        focusVersion,
      );
    } catch {
      announceParticipantsRetry(
        'Retry failed. The participant list is still unavailable. You can retry again.',
        focusVersion,
      );
    } finally {
      retryParticipantsInFlight.current = false;
      setRetryingParticipants(false);
    }
  };
  const announceParticipantsRetry = (message: string, focusVersion: number) => {
    if (
      !participantsScreenFocusedRef.current ||
      participantsRetryFocusVersion.current !== focusVersion
    ) return;
    setParticipantsRetryAnnouncement(message);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  };
  const refreshAllRef = useRef(refreshAll);
  const detailRefreshController = useRef<ReturnType<typeof createTournamentDetailRefreshController> | null>(null);
  if (!detailRefreshController.current) {
    detailRefreshController.current = createTournamentDetailRefreshController();
  }
  useEffect(() => {
    refreshAllRef.current = refreshAll;
  }, [refreshAll]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setIsAppActive(nextState === 'active');
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    detailRefreshController.current?.update(isFocused, isAppActive, () => {
      setClockNow(Date.now());
      void refreshAllRef.current();
    });
  }, [isFocused, isAppActive]);
  useEffect(
    () => () => detailRefreshController.current?.stop(),
    [],
  );

  useEffect(() => {
    if (!isFocused || !isAppActive) return undefined;
    const schedule = getRoomCredentialSchedule(t?.startsAt);
    if (!schedule) return undefined;
    const nextTransition = [schedule.releaseAtMs, schedule.startsAtMs]
      .filter((time) => time > clockNow)
      .sort((a, b) => a - b)[0];
    if (nextTransition === undefined) return undefined;
    const timer = setTimeout(() => {
      setClockNow(Date.now());
      void load();
    }, Math.min(MAX_TIMEOUT_MS, nextTransition - clockNow));
    return () => clearTimeout(timer);
  }, [t?.startsAt, clockNow, isFocused, isAppActive, load]);

  if (loading) return <View style={s.root} />;
  if (!t) return <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}><Text style={{ color: C.sub }}>Tournament not found.</Text></View>;

  const lifecycle = isCompleted ? 'completed' : getTournamentLifecycleState(t, clockNow);
  const statusTournament = lifecycle === 'ongoing'
    ? { ...t, status: 'ongoing' }
    : isCompleted
      ? { ...t, status: 'completed' }
      : t;
  const st = statusOf(statusTournament);
  const registrationStatusKnown = t.registrationStatusKnown === true;
  const joined = registrationStatusKnown && Boolean(t.joined);
  const teamType = String(t.teamType || '').toLowerCase();
  const mode = String(t.mode || '').toLowerCase();
  const teamTournament = Number(t.teamSize ?? 1) > 1;
  const participants = participantsQuery.data?.participants ?? [];
  const participantListUnavailable = participantsQuery.isError || (retryingParticipants && participantsQuery.isFetching);
  const participantCountLabel = participantListUnavailable ? 'COUNT UNAVAILABLE' : participants.length;
  const participantCountAccessibilityLabel = participantListUnavailable
    ? `Joined ${teamTournament ? 'teams' : 'players'}. Count unavailable.`
    : `Joined ${teamTournament ? 'teams' : 'players'}: ${participants.length}.`;
  const totalSlots = Number(t.totalSlots ?? (mode.includes('clash') ? 2 : teamType === 'squad' ? 12 : 48));
  const filledSlots = Number(t.filledSlots ?? t.filled ?? 0);
  const tournamentStatus = isCompleted ? 'completed' : String(t.status || '').toLowerCase();
  const winnerState = resolveTournamentWinnerState(
    resultsQuery.isLoading ||
      (isCompleted && resultsQuery.isFetching && resultsQuery.data?.status !== 'finalized'),
    resultsQuery.isError,
    resultsQuery.data?.entries,
  );
  const winner = winnerState.kind === 'winner' ? winnerState.entry : undefined;
  const winnerGameName = winner?.gameName?.trim() ?? '';
  const winnerTeamName = winner?.teamName?.trim() ?? '';
  const winnerName = winnerTeamName || winnerGameName || 'Winner';
  const full = st.key === 'full' || tournamentStatus === 'setup_needed' || (totalSlots > 0 && filledSlots >= totalSlots);
  const schedule = getRoomCredentialSchedule(t.startsAt);
  const registrationStatus = String(t.myRegistration?.status ?? '').toLowerCase();
  const canViewRoomDetails = registrationStatus === 'approved' && tournamentStatus !== 'cancelled';
  const scheduledStart = schedule
    ? `${schedule.date} · ${fmtTime12(schedule.startTime24)} IST`
    : `${fmtDate(t.date)} · ${fmtTime12(t.time)} IST`;
  const coins = user?.coins ?? 0;
  const short = coins < (t.entryCoins ?? 0);

  const join = async () => {
    nav.navigate('JoinForm', { id: t.id });
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl
        refreshing={loading || participantsQuery.isFetching || (isCompleted && resultsQuery.isFetching)}
        onRefresh={refreshAll}
        tintColor={C.neon}
      />}>
      {/* HERO */}
      <GCard glowColor={st.key === 'ongoing' ? C.neon : C.orange} style={{ marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={s.mode}>{(t.mode || 'BATTLE ROYALE').toUpperCase()}</Text>
            <Text style={s.name}>{t.name || t.title}</Text>
            <Text style={s.meta}>SCHEDULED START: {scheduledStart}</Text>
          </View>
          <Badge text={st.label} color={st.color} />
        </View>
      </GCard>

      {/* STATS */}
      <View style={s.statRow}>
        <View style={s.stat}>
          <Text style={s.statK}>ENTRY</Text>
          <Text style={[s.statV, { color: C.gold }]}>🪙 {t.entryCoins}</Text>
          <Text style={s.statSub}>{inr(t.entryCoins)}</Text>
        </View>
        <View style={[s.stat, { borderLeftWidth: 1, borderLeftColor: C.border, borderRightWidth: 1, borderRightColor: C.border }]}>
          <Text style={s.statK}>PRIZE POOL</Text>
          <Text style={[s.statV, { color: C.green }]}>🪙 {t.prizePool}</Text>
          <Text style={s.statSub}>{inr(t.prizePool)}</Text>
        </View>
        <View style={s.stat}>
          <Text style={s.statK}>{t.slotUnit === 'player' ? 'PLAYER SLOTS' : 'TEAM SLOTS'}</Text>
          <Text style={[s.statV, { color: C.blue }]}>{filledSlots}/{totalSlots}</Text>
          <Text style={s.statSub}>
            {t.slotUnit === 'player'
              ? `${filledSlots}/${totalSlots} players`
              : `${t.filledPlayerSlots ?? filledSlots * (t.teamSize ?? 1)}/${t.totalPlayerSlots ?? totalSlots * (t.teamSize ?? 1)} players`}
          </Text>
        </View>
      </View>

      <SectionTitle accent={C.orange}>MATCH INFO</SectionTitle>
      <Card>
        <KV k="Mode" v={t.mode || '—'} />
        <KV k="Format" v={t.teamType || '—'} />
        <KV k="Map" v={t.map || '—'} />
        <KV k="Per Team" v={t.teamSize ? `${t.teamSize} players` : t.perTeam ? `${t.perTeam} players` : '—'} />
        <KV k="Capacity" v={t.capacityLabel || `${t.totalSlots} slots`} />
        <KV k="Version" v={t.version || '—'} />
        {!!t.rules && <Text style={s.rules}>{t.rules}</Text>}
      </Card>

      <SectionTitle
        accent={C.orange}
        icon={teamTournament ? 'users' : 'user'}
        accessibilityLabel={participantCountAccessibilityLabel}
        testID="participant-count-heading"
      >
        {teamTournament ? `JOINED TEAMS · ${participantCountLabel}` : `JOINED PLAYERS · ${participantCountLabel}`}
      </SectionTitle>
      {participantsRetryAnnouncement ? (
        <Text
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          testID="participants-retry-status"
          style={s.participantsRetryStatus}
        >
          {participantsRetryAnnouncement}
        </Text>
      ) : null}
      {participantsQuery.isLoading && !participantsQuery.data && !retryingParticipants ? (
        <Card style={s.participantsLoading}>
          <ActivityIndicator accessible={false} color={C.neon} />
          <Text
            accessible
            accessibilityRole="text"
            accessibilityLabel="Loading participants."
            accessibilityLiveRegion="polite"
            testID="participants-initial-loading-status"
            style={s.participantsHint}
          >
            Loading participants…
          </Text>
        </Card>
      ) : participantListUnavailable ? (
        <Card>
          <Text
            accessible
            accessibilityRole="text"
            accessibilityLabel="Participant list couldn’t be loaded. Try again here or pull down to retry."
            accessibilityLiveRegion="polite"
            testID="participants-error-guidance"
            style={s.participantsHint}
          >
            Participant list couldn’t be loaded. Try again here or pull down to retry.
          </Text>
          <Btn
            title="RETRY PARTICIPANTS"
            kind="ghost"
            onPress={retryParticipants}
            loading={participantsQuery.isFetching}
            preserveAccessibilityFocusWhileLoading
            accessibilityLabel="Retry participant list"
            accessibilityHint="Loads the latest list of joined players and teams."
            accessibilityState={{ busy: participantsQuery.isFetching }}
            style={{ marginTop: 10, alignSelf: 'stretch', minHeight: 48 }}
            testID="participants-retry"
          />
        </Card>
      ) : participants.length === 0 ? (
        <Card>
          <Text style={s.participantsHint}>
            {teamTournament ? 'No teams have joined this match yet.' : 'No players have joined this match yet.'}
          </Text>
        </Card>
      ) : (
        participants.map((participant, index) => {
          const playerNames = participant.players;
          const title = teamTournament
            ? participant.teamName?.trim() || playerNames[0] || `Team ${index + 1}`
            : playerNames[0] || `Player ${index + 1}`;
          return (
            <Card key={`${participant.teamName ?? 'player'}-${index}`} style={s.participantCard}>
              <View style={s.participantHeader}>
                <View style={s.participantNumber}>
                  <Text style={s.participantNumberText}>{String(index + 1).padStart(2, '0')}</Text>
                </View>
                <View style={s.participantTitleWrap}>
                  <Text style={s.participantName}>{title}</Text>
                  {participant.status === 'pending' && (
                    <Text style={s.participantPending}>AWAITING APPROVAL</Text>
                  )}
                </View>
              </View>
              {teamTournament && playerNames.length > 0 && (
                <View style={s.memberList}>
                  {playerNames.map((playerName, playerIndex) => (
                    <View key={`${playerIndex}-${playerName}`} style={s.memberRow}>
                      <View style={s.memberDot} />
                      <Text style={s.memberName}>
                        {playerIndex === 0 ? 'CAPTAIN' : `PLAYER ${playerIndex + 1}`} · {playerName}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>
          );
        })
      )}

      {isCompleted && (
        <>
          <SectionTitle accent={C.gold}>WINNER &amp; PRIZE</SectionTitle>
          {winnerState.kind === 'loading' ? (
            <Card style={s.participantsLoading}>
              <ActivityIndicator color={C.gold} />
              <Text style={s.participantsHint}>Loading winner details…</Text>
            </Card>
          ) : winnerState.kind === 'error' ? (
            <Card>
              <Text style={s.participantsHint}>
                Winner and prize details couldn’t be loaded. Retry here or pull down to try again.
              </Text>
              <Btn
                title="RETRY WINNER DETAILS"
                kind="ghost"
                onPress={() => { void resultsQuery.refetch(); }}
                loading={resultsQuery.isFetching}
                accessibilityState={{ busy: resultsQuery.isFetching }}
                style={{ marginTop: 10 }}
                testID="winner-results-retry"
              />
            </Card>
          ) : winnerState.kind === 'winner' && winner ? (
            <Card style={s.winnerCard}>
              <View style={s.winnerBadge}>
                <Text style={s.winnerBadgeText}>#1</Text>
              </View>
              <View style={s.winnerIdentity}>
                <Text style={s.winnerLabel}>TOURNAMENT WINNER</Text>
                <Text style={s.winnerName} numberOfLines={1}>{winnerName}</Text>
                {!!winnerTeamName && !!winnerGameName && (
                  <Text style={s.winnerSub} numberOfLines={1}>CAPTAIN · {winnerGameName}</Text>
                )}
              </View>
              <View style={s.winnerPrize}>
                <Text style={s.winnerPrizeAmount}>{winner.prizeCoins.toLocaleString()} coins</Text>
                <Text style={s.winnerPrizeLabel}>PRIZE WON</Text>
                <Text style={s.winnerPrizeValue}>{inr(winner.prizeCoins)}</Text>
              </View>
            </Card>
          ) : (
            <Card>
              <Text style={s.participantsHint}>
                No winner was recorded for this completed match.
              </Text>
            </Card>
          )}
        </>
      )}

      {canViewRoomDetails ? (
        <>
          {roomDetailsAvailabilityAnnouncement ? (
            <Text
              accessible
              accessibilityRole="text"
              accessibilityLiveRegion="polite"
              testID="room-details-availability-announcement"
              style={s.participantsRetryStatus}
            >
              {roomDetailsAvailabilityAnnouncement}
            </Text>
          ) : null}
          <RoomCredentialsPanel
            startsAt={t.startsAt}
            now={clockNow}
            configured={t.myRegistration?.roomPublished === true}
            roomId={t.myRegistration?.roomId}
            roomPassword={t.myRegistration?.roomPassword}
          />
        </>
      ) : null}

      <Msg kind="err" text={err} />
      <Msg kind="ok" text={msg} />

      <View style={{ marginTop: 16 }}>
        {!registrationStatusKnown ? (
          <Card testID="tournament-entry-status-unknown">
            <Text
              accessible
              accessibilityRole="text"
              accessibilityLiveRegion="polite"
              style={s.participantsHint}
            >
              We couldn’t confirm whether you’ve joined. Check your entry status again before trying to join.
            </Text>
            <Btn
              title="RETRY ENTRY STATUS"
              kind="ghost"
              onPress={retryRegistrationStatus}
              loading={retryingRegistrationStatus}
              accessibilityLabel="Retry entry status"
              accessibilityHint="Checks whether you have already joined this tournament."
              accessibilityState={{ busy: retryingRegistrationStatus }}
              style={{ marginTop: 10 }}
              testID="tournament-entry-status-retry"
            />
          </Card>
        ) : null}
        {st.key === 'completed' || ['closed', 'cancelled'].includes(tournamentStatus) ? (
          <Btn title="MATCH ENDED" kind="ghost" disabled />
        ) : !registrationStatusKnown ? (
          <Btn title="ENTRY STATUS UNKNOWN" kind="ghost" disabled />
        ) : joined ? (
          <Btn title={full ? 'Joined · Slots Full' : 'Joined'} kind="ghost" disabled />
        ) : st.key === 'ongoing' ? (
          <Btn title="MATCH ONGOING" kind="ghost" disabled />
        ) : full ? (
          <Btn title="Slots Full" kind="ghost" disabled />
        ) : short ? (
          <>
            <Btn title={`INSUFFICIENT COINS — NEED 🪙 ${t.entryCoins}`} kind="danger" disabled />
            <Btn title="GO TO WALLET →" kind="gold" onPress={() => nav.navigate('Wallet')} style={{ marginTop: 10 }} />
          </>
        ) : (
          <Btn title={`JOIN NOW — 🪙 ${t.entryCoins} (${inr(t.entryCoins)})`} onPress={join} loading={busy} />
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  mode: { color: C.orange, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  name: { color: C.text, fontSize: 20, fontWeight: '900', marginTop: 2 },
  meta: { color: C.sub, fontSize: 12, marginTop: 6, fontWeight: '600' },
  timeMeta: { color: C.gold, fontSize: 15, fontWeight: '900' },
  statRow: { flexDirection: 'row', borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, marginBottom: 6, overflow: 'hidden' },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statK: { color: C.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  statV: { fontSize: 17, fontWeight: '900', marginTop: 3 },
  statSub: { color: C.dim, fontSize: 9, marginTop: 2 },
  rules: { color: C.sub, fontSize: 12, marginTop: 10, lineHeight: 18 },
  participantsLoading: { alignItems: 'center' },
  participantsHint: { color: C.sub, fontSize: 12, fontWeight: '600', lineHeight: 18 },
  participantsRetryStatus: {
    color: C.sub, fontSize: 12, fontWeight: '600', lineHeight: 18, marginBottom: 8,
  },
  participantCard: { padding: 12, marginBottom: 8 },
  participantHeader: { flexDirection: 'row', alignItems: 'center' },
  participantNumber: {
    width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    marginRight: 10, backgroundColor: C.bg2, borderColor: C.border, borderWidth: 1,
  },
  participantNumberText: { color: C.orange, fontSize: 12, fontWeight: '900' },
  participantTitleWrap: { flex: 1, minWidth: 0 },
  participantName: { color: C.text, fontSize: 14, fontWeight: '900' },
  participantPending: { color: C.gold, fontSize: 9, fontWeight: '900', letterSpacing: 0.5, marginTop: 3 },
  memberList: { borderTopWidth: 1, borderTopColor: C.border, marginTop: 10, paddingTop: 7 },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  memberDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.blue, marginRight: 8 },
  memberName: { color: C.sub, fontSize: 11, fontWeight: '800', flexShrink: 1 },
  winnerCard: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  winnerBadge: {
    width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    marginRight: 10, backgroundColor: C.bg2, borderColor: C.gold, borderWidth: 1,
  },
  winnerBadgeText: { color: C.gold, fontSize: 14, fontWeight: '900' },
  winnerIdentity: { flex: 1, minWidth: 0 },
  winnerLabel: { color: C.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  winnerName: { color: C.text, fontSize: 15, fontWeight: '900', marginTop: 4 },
  winnerSub: { color: C.sub, fontSize: 10, fontWeight: '800', marginTop: 3 },
  winnerPrize: { alignItems: 'flex-end', marginLeft: 8 },
  winnerPrizeAmount: { color: C.green, fontSize: 13, fontWeight: '900' },
  winnerPrizeLabel: { color: C.dim, fontSize: 8, fontWeight: '900', letterSpacing: 0.7, marginTop: 3 },
  winnerPrizeValue: { color: C.text, fontSize: 10, fontWeight: '800', marginTop: 2 },
});
