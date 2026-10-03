// My Matches — upcoming / live / completed tabs with room details
import React, { useCallback, useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Api, apiError } from '../lib/api';
import { C, Btn, Empty, Loading, GCard, Badge, SectionTitle, fmtDate, fmtTime12 } from '../components/ui';
import { canEditRegistrationTeam, getTeamEditCutoff } from '../lib/teamEditWindow';
import { compareTournamentStartTime, getTournamentLifecycleState, MAX_TIMEOUT_MS } from '../lib/tournamentLifecycle';

const ROOM_CREDENTIAL_REVEAL_LEAD_MS = 5 * 60 * 1000;

export default function MyMatches() {
  const navigation: any = useNavigation();
  const [regs, setRegs] = useState<any[]>([]);
  const [tab, setTab] = useState<'upcoming' | 'ongoing' | 'completed'>('upcoming');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await Api.myRegistrations();
      setRegs(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setClockNow(Date.now());
    void load();
  }, [load]));

  useEffect(() => {
    const transitions = regs.flatMap((registration) => {
      const startsAt = registration.tournament?.startsAt ?? registration.startsAt;
      const startMs = Date.parse(String(startsAt ?? ''));
      return [
        getTeamEditCutoff(startsAt),
        startMs - ROOM_CREDENTIAL_REVEAL_LEAD_MS,
        startMs,
      ];
    });
    const nextTransition = transitions
      .filter((time): time is number => time !== null && Number.isFinite(time) && time > clockNow)
      .sort((a, b) => a - b)[0];
    if (nextTransition === undefined) return;
    const timer = setTimeout(() => {
      setClockNow(Date.now());
      void load();
    }, Math.min(MAX_TIMEOUT_MS, nextTransition - clockNow + 20));
    return () => clearTimeout(timer);
  }, [regs, clockNow, load]);

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
          <Text key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabOn]}>{t.toUpperCase()}</Text>
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
            const published = item.roomPublished === true || (item.roomPublished == null && t.roomPublished === true);
            const startsAt = t.startsAt ?? item.startsAt;
            const startMs = startsAt ? new Date(startsAt).getTime() : Number.NaN;
            const roomWindowOpen = Number.isFinite(startMs) && clockNow >= startMs - ROOM_CREDENTIAL_REVEAL_LEAD_MS;
            const roomReady = status === 'approved' && published && !!roomId && !!roomPassword && roomWindowOpen;
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
                <Text style={s.meta}>📅 {fmtDate(t.date)} • <Text style={s.timeMeta}>{fmtTime12(t.time)} IST</Text></Text>
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
                <View style={s.room}>
                  {roomReady ? (
                    <>
                       <Text style={s.roomLine}>ROOM ID: <Text style={s.roomVal}>{roomId}</Text></Text>
                       <Text style={s.roomLine}>PASSWORD: <Text style={s.roomVal}>{roomPassword}</Text></Text>
                    </>
                  ) : (
                    <Text style={s.roomLocked}>
                       {status === 'approved'
                         ? !published
                           ? '🔒 Room details have not been saved yet.'
                           : !Number.isFinite(startMs)
                             ? '🔒 Match start time is unavailable; room details remain hidden.'
                             : !roomWindowOpen
                               ? '🔒 Room details unlock automatically five minutes before scheduled start.'
                               : '🔒 Room credentials are not available.'
                        : status === 'pending'
                          ? 'Entry is pending admin approval.'
                          : status === 'rejected'
                            ? 'Registration rejected; the entry fee was refunded.'
                            : 'Registration status is unavailable.'}
                    </Text>
                  )}
                </View>
                  {results.length > 0 ? (
                    <View style={s.results}>
                      <Text style={s.resultsTitle}>TOURNAMENT RESULTS</Text>
                      {results.map((entry: any, index: number) => {
                        const gameName = String(entry.gameName || '').trim();
                        const playerName = String(entry.playerName || '').trim();
                        const teamName = String(entry.teamName || '').trim();
                        const winnerName = gameName || playerName || teamName || 'Player';
                        const secondaryName = gameName && playerName && gameName.toLowerCase() !== playerName.toLowerCase()
                          ? playerName
                          : '';
                        const resultMeta = [
                          teamName ? `TEAM ${teamName}` : '',
                          entry.kills != null ? `${entry.kills} KILLS` : '',
                        ].filter(Boolean).join(' · ');
                        const avatarName = playerName || gameName || teamName || 'P';
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
                            style={[s.resultRow, index === results.length - 1 && s.resultRowLast]}
                          >
                            <View style={[s.rankMedal, rankStyle]}>
                              <Text style={s.rankNumber}>{rank}</Text>
                            </View>
                            <View style={[s.resultAvatar, { backgroundColor: avatarColors[index % avatarColors.length] }]}>
                              <Text style={s.resultAvatarInitial}>{avatarName.charAt(0).toUpperCase()}</Text>
                            </View>
                            <View style={s.resultIdentity}>
                              <Text style={s.resultName} numberOfLines={1}>{winnerName}</Text>
                              {!!secondaryName && <Text style={s.resultSub} numberOfLines={1}>{secondaryName}</Text>}
                              {!!resultMeta && <Text style={s.resultKills} numberOfLines={1}>{resultMeta}</Text>}
                            </View>
                            <View style={s.prizeWrap}>
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
  tabs: { flexDirection: 'row', paddingHorizontal: 14, gap: 8, marginBottom: 6 },
  tab: { color: C.sub, fontWeight: '800', fontSize: 11, letterSpacing: 1, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, overflow: 'hidden', backgroundColor: '#151a29' },
  tabOn: { color: C.bg, backgroundColor: C.neon },
  err: { color: '#ef4444', textAlign: 'center', marginTop: 40, paddingHorizontal: 20 },
  mode: { color: C.orange, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  tName: { color: C.text, fontWeight: '900', fontSize: 16, marginTop: 2 },
  meta: { color: C.sub, fontSize: 12, marginTop: 4 },
  timeMeta: { color: C.gold, fontSize: 15, fontWeight: '900' },
  room: { backgroundColor: '#0d1120', borderRadius: 10, padding: 10, marginTop: 10, borderWidth: 1, borderColor: C.border },
  roomLine: { color: C.sub, fontSize: 12, fontWeight: '700', marginTop: 2 },
  roomVal: { color: '#22c55e', fontWeight: '900' },
  roomLocked: { color: '#f59e0b', fontSize: 12, fontWeight: '600' },
  results: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border },
  resultsTitle: { color: '#fbbf24', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginBottom: 4 },
  result: { color: '#fbbf24', fontWeight: '800', marginTop: 8, fontSize: 13 },
  resultRow: { flexDirection: 'row', alignItems: 'center', minHeight: 78, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#343842', gap: 8 },
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
  prizeAmountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
  coinIcon: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#ffcc42', backgroundColor: '#e79b00', alignItems: 'center', justifyContent: 'center' },
  coinStar: { color: '#fff3ad', fontSize: 10, fontWeight: '900', lineHeight: 12 },
  prizeAmount: { color: C.green, fontSize: 19, fontWeight: '900', lineHeight: 22 },
  prizeLabel: { color: '#848994', fontSize: 10, fontWeight: '600', marginTop: 4 },
});
