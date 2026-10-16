import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { Api, apiError, AdminRegistration, Tournament } from '../lib/api';
import { Btn, Card, C, Empty, Input, Loading, Msg } from '../components/ui';
import { CopyUidButton } from '../components/CopyUidButton';
import { inr, COIN_RATE_TEXT } from '../lib/coins';
import { getTournamentLifecycleState, MAX_TIMEOUT_MS } from '../lib/tournamentLifecycle';
import { configuredPrizeForRank } from '../lib/tournamentPrizes';

export default function AdminResults({
  initialTournamentId,
  onInitialTournamentHandled,
}: {
  initialTournamentId?: string | null;
  onInitialTournamentHandled?: () => void;
}) {
  const [list, setList] = useState<Tournament[] | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listLoadError, setListLoadError] = useState('');
  const [hasListLoadFailed, setHasListLoadFailed] = useState(false);
  const [listStatusMessage, setListStatusMessage] = useState('');
  const [sel, setSel] = useState<Tournament | null>(null);
  const [regs, setRegs] = useState<AdminRegistration[] | null>(null);
  const [regsLoading, setRegsLoading] = useState(false);
  const [regLoadError, setRegLoadError] = useState('');
  const [hasRegLoadFailed, setHasRegLoadFailed] = useState(false);
  const requestId = useRef(0);
  const listRequestId = useRef(0);
  const [regId, setRegId] = useState('');
  const [rank, setRank] = useState('1');
  const [kills, setKills] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const announcedErrors = useRef<Record<string, string>>({});
  const [clockNow, setClockNow] = useState(Date.now());
  const initialTournamentHandled = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const messages = [
      ['result', err],
      ['tournament-list', listLoadError],
      ['approved-registrations', regLoadError],
    ] as const;
    for (const [key, message] of messages) {
      if (message && message !== announcedErrors.current[key]) {
        AccessibilityInfo.announceForAccessibilityWithOptions(message, {
          queue: true,
          priority: 'high',
        });
      }
      announcedErrors.current[key] = message;
    }
  }, [err, listLoadError, regLoadError]);

  const loadTournaments = useCallback(async (isRetry = false) => {
    const currentRequest = ++listRequestId.current;
    setListLoading(true);
    setListLoadError('');
    setListStatusMessage(isRetry ? 'Retrying tournaments…' : '');
    try {
      const tournaments = await Api.tournaments();
      if (listRequestId.current === currentRequest) {
        setList(tournaments);
        setClockNow(Date.now());
        setHasListLoadFailed(false);
        setListStatusMessage(isRetry && tournaments.length > 0 ? 'Tournament list loaded.' : '');
      }
    } catch {
      if (listRequestId.current === currentRequest) {
        setListLoadError('Could not load tournaments. Please try again.');
        setHasListLoadFailed(true);
        setListStatusMessage('');
      }
    } finally {
      if (listRequestId.current === currentRequest) setListLoading(false);
    }
  }, []);

  const retryTournaments = () => {
    if (listLoading) return;
    void loadTournaments(true);
  };

  useEffect(() => {
    void loadTournaments();
    return () => { listRequestId.current++; };
  }, [loadTournaments]);

  useEffect(() => {
    if (!list) return;
    const now = Date.now();
    const nextStart = list
      .filter((tournament) => getTournamentLifecycleState(tournament, clockNow) === 'upcoming')
      .map((tournament) => Date.parse(String(tournament.startsAt ?? '')))
      .filter((start) => Number.isFinite(start) && start > now)
      .sort((a, b) => a - b)[0];
    if (nextStart === undefined) return;
    const timer = setTimeout(() => setClockNow(Date.now()), Math.min(MAX_TIMEOUT_MS, Math.max(0, nextStart - now + 20)));
    return () => clearTimeout(timer);
  }, [list, clockNow]);

  const loadApprovedRegistrations = useCallback(async (t: Tournament, currentRequest: number) => {
    setRegs(null);
    setRegLoadError('');
    setRegsLoading(true);
    try {
      const approved = await Api.adminApprovedRegs(t.id);
      if (requestId.current === currentRequest) {
        setRegs(approved);
        setHasRegLoadFailed(false);
      }
    } catch (e: any) {
      if (requestId.current === currentRequest) {
        setRegLoadError(apiError(e));
        setHasRegLoadFailed(true);
      }
    } finally {
      if (requestId.current === currentRequest) setRegsLoading(false);
    }
  }, []);

  const open = useCallback(async (t: Tournament) => {
    if (!['ongoing', 'completed'].includes(getTournamentLifecycleState(t, Date.now()))) {
      setErr('Results can only be entered after the tournament starts.');
      return;
    }
    const currentRequest = ++requestId.current;
    setSel(t); setErr(''); setOkMsg(''); setRegs(null); setRegLoadError('');
    setRegsLoading(true); setHasRegLoadFailed(false);
    setRegId(''); setRank('1'); setKills('');
    await loadApprovedRegistrations(t, currentRequest);
  }, [loadApprovedRegistrations]);

  useEffect(() => {
    if (!initialTournamentId || !list || initialTournamentHandled.current) return;
    initialTournamentHandled.current = true;
    const tournament = list.find((item) => item.id === initialTournamentId);
    if (tournament) void open(tournament);
    else setErr('That tournament is no longer available.');
    onInitialTournamentHandled?.();
  }, [initialTournamentId, list, onInitialTournamentHandled, open]);

  const retryApprovedRegistrations = () => {
    if (!sel || regsLoading) return;
    const currentRequest = ++requestId.current;
    void loadApprovedRegistrations(sel, currentRequest);
  };

  const back = () => {
    requestId.current++;
    setSel(null); setRegs(null); setRegLoadError(''); setRegsLoading(false);
    setHasRegLoadFailed(false); setRegId('');
  };

  const publish = async () => {
    if (!sel) return;
    setErr(''); setOkMsg('');
    if (!regId || !regs?.some((r) => r.id === regId && r.tournamentId === sel.id && r.status === 'approved')) {
      return setErr('Select an approved player for this tournament.');
    }
    const resultRank = Number(rank);
    if (!Number.isInteger(resultRank) || resultRank < 1) return setErr('Enter a valid rank.');
    setBusy(true);
    try {
      await Api.adminPublishResult({
        tournamentId: sel.id, registrationId: regId,
        rank: resultRank, kills: Number(kills || 0),
      });
      const finished = resultRank === 1;
      const previousLifecycle = getTournamentLifecycleState(sel, Date.now());
      const nextStatus = finished ? 'completed' : previousLifecycle;
      setSel((current) => current ? {
        ...current,
        status: nextStatus,
        enabled: finished ? false : current.enabled,
      } : current);
      setList((current) => current?.map((tournament) => tournament.id === sel.id ? {
        ...tournament,
        status: finished ? 'completed' : getTournamentLifecycleState(tournament, Date.now()),
        enabled: finished ? false : tournament.enabled,
      } : tournament) ?? null);
      setOkMsg(finished
        ? 'Winner published — prize credited and tournament finished.'
        : previousLifecycle === 'completed'
          ? 'Placement published for the completed tournament.'
          : 'Placement published — tournament remains ongoing until the winner is declared.');
      setRegId(''); setRank(''); setKills('');
      setTimeout(() => setOkMsg(''), 2500);
    } catch (e: any) { setErr(apiError(e)); }
    finally { setBusy(false); }
  };
  const prizeCoins = sel
    ? configuredPrizeForRank(sel, /^\d+$/.test(rank) ? Number(rank) : 0)
    : 0;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <Text style={st.h}>RESULTS</Text>
      <Msg kind="err" text={err} accessibilityLiveRegion="polite" />
      <Msg kind="err" text={listLoadError} accessibilityLiveRegion="polite" />
      <Text accessibilityLiveRegion="polite" testID="admin-results-list-status">
        {listStatusMessage}
      </Text>
      <Msg kind="ok" text={okMsg} />
      {!list ? (listLoading && !hasListLoadFailed ? <Loading accessibilityLabel="Loading tournaments" /> : (
        <Btn
          title="RETRY TOURNAMENTS"
          accessibilityLabel="Retry tournaments"
          accessibilityHint="Attempts to load the tournament list again."
          accessibilityState={{ busy: listLoading }}
          loading={listLoading}
          preserveAccessibilityFocusWhileLoading
          testID="admin-results-retry-tournaments"
          onPress={retryTournaments}
        />
      )) : !sel ? list.length === 0 ? (
        <Empty
          title="NO TOURNAMENTS TO SHOW"
          text="There are no tournaments available for results."
          accessibilityLabel="No tournaments are available for results."
          accessibilityLiveRegion="polite"
        />
      ) : list.map((t) => {
        const lifecycle = getTournamentLifecycleState(t, clockNow);
        return (
          <Card key={t.id} style={{ marginBottom: 10 }}>
            <Text style={st.tName}>{t.name}</Text>
            <Text style={st.sub}>{t.date} • {t.time} IST • {lifecycle.toUpperCase()}</Text>
            <View style={{ marginTop: 8 }}>
              <Btn
                title={lifecycle === 'completed' ? 'ADD PLACEMENT →' : lifecycle === 'ongoing' ? 'ADD RESULT →' : 'WAIT FOR START'}
                small
                kind="ghost"
                accessibilityHint={lifecycle === 'upcoming' ? 'Results can be entered after the scheduled start.' : undefined}
                disabled={lifecycle !== 'ongoing' && lifecycle !== 'completed'}
                onPress={() => open(t)}
              />
            </View>
          </Card>
        );
      }) : (
        <Card>
          <Text onPress={back} style={{ color: C.neon, fontWeight: '900', marginBottom: 8 }}>← BACK</Text>
          <Text style={st.tName}>{sel.name}</Text>
          {regs === null ? hasRegLoadFailed ? (
            <View>
              <Text accessibilityLiveRegion="polite" style={st.regLoadError}>
                {regLoadError
                  ? `Approved registrations could not be loaded: ${regLoadError} Retry here.`
                  : 'Retrying approved registrations…'}
              </Text>
              <Btn
                title={regsLoading ? 'RETRYING…' : 'RETRY APPROVED PLAYERS'}
                accessibilityLabel="Retry approved registrations"
                accessibilityHint={`Loads approved registrations for ${sel.name}.`}
                accessibilityState={{ disabled: regsLoading, busy: regsLoading }}
                loading={regsLoading}
                preserveAccessibilityFocusWhileLoading
                testID={`retry-approved-registrations-${sel.id}`}
                onPress={retryApprovedRegistrations}
              />
            </View>
          ) : <Loading accessibilityLabel="Loading approved registrations" /> : regs.length === 0 ? (
            <Empty
              title="NO APPROVED PLAYERS"
              text="No approved registrations are available for this tournament."
              accessibilityLabel="No approved registrations are available for this tournament."
              accessibilityLiveRegion="polite"
            />
          ) : (
            <View style={{ marginBottom: 10 }}>
              <Text style={st.lbl}>SELECT PLAYER</Text>
              {regs.map((r) => {
                const selected = regId === r.id;
                const playerLabel = `${r.playerName}${r.teamName ? ` — ${r.teamName}` : ''}`;
                return (
                  <Card key={r.id} style={[st.playerOptionRow, { borderColor: selected ? C.neon : C.border }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${playerLabel} for result entry`}
                      accessibilityState={{ selected }}
                      onPress={() => setRegId(r.id)}
                      style={st.playerOptionSelect}
                    >
                      <Text style={{ color: selected ? C.neon : C.text, fontWeight: '800', fontSize: 13 }}>
                        {selected ? '✓ ' : ''}{playerLabel}
                      </Text>
                      <Text style={st.playerOptionUid}>UID {r.gameUid || '—'}</Text>
                    </Pressable>
                    <CopyUidButton uid={r.gameUid} testID={`copy-result-uid-${r.id}`} />
                  </Card>
                );
              })}
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Input placeholder="Rank *" value={rank} onChangeText={setRank} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><Input placeholder="Kills" value={kills} onChangeText={setKills} keyboardType="number-pad" /></View>
          </View>
          <Text style={st.lbl}>PRIZE COINS · LOCKED TO TOURNAMENT SETTINGS</Text>
          <View accessibilityLabel={`Prize amount: ${prizeCoins} coins; cannot be edited`} style={st.prizeBox}>
            <Text style={st.prizeValue}>{prizeCoins.toLocaleString()} coins</Text>
            <Text style={st.inrNote}>{inr(prizeCoins)} INR ({COIN_RATE_TEXT})</Text>
          </View>
          <Text style={st.prizeHint}>Auto-calculated for rank {rank || '—'} from the saved prize distribution.</Text>
          <Btn
            title={sel.status === 'completed' && Number(rank) === 1
              ? 'WINNER ALREADY DECLARED'
              : Number(rank) === 1 ? 'FINISH & PUBLISH WINNER' : 'PUBLISH PLACEMENT'}
            onPress={publish}
            loading={busy}
            disabled={sel.status === 'completed' && Number(rank) === 1}
          />
        </Card>
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 30 },
  h: { color: C.text, fontSize: 20, fontWeight: '900', marginBottom: 10, letterSpacing: 0.7, fontFamily: 'Inter_700Bold' },
  lbl: { color: C.sub, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  tName: { color: C.text, fontWeight: '900', fontSize: 14 },
  sub: { color: C.sub, fontSize: 11, marginTop: 3 },
  playerOptionRow: {
    padding: 10, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  playerOptionSelect: { flex: 1, minWidth: 0, justifyContent: 'center' },
  playerOptionUid: { color: C.sub, fontSize: 10, fontWeight: '700', marginTop: 3 },
  regLoadError: { color: C.red, fontSize: 13, fontWeight: '700', marginBottom: 10 },
  inrNote: { color: C.gold, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  prizeBox: { backgroundColor: C.bg2, borderColor: C.border, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 5 },
  prizeValue: { color: C.gold, fontWeight: '900', fontSize: 17 },
  prizeHint: { color: C.sub, fontSize: 11, marginBottom: 10 },
});
