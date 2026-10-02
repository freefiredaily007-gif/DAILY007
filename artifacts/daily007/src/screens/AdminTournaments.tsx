import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, View, Text, ScrollView, StyleSheet, TextInput, Pressable } from 'react-native';
import {
  getDaily007ListAdminResultLogsQueryKey,
  useDaily007ListAdminResultLogs,
  useUpdateTournamentLifecycle,
} from '@workspace/api-client-react';
import { Api, apiError, Tournament } from '../lib/api';
import { Btn, Card, C, Chip, Empty, Input, Loading, Msg, TimePicker } from '../components/ui';
import { inr, COIN_RATE_TEXT } from '../lib/coins';
import { getTournamentLifecycleState, MAX_TIMEOUT_MS } from '../lib/tournamentLifecycle';

const blank = { name: '', mode: 'Battle Royale', teamType: 'Solo', date: '', time: '08:00 PM', entryCoins: '', prizePool: '', totalSlots: '48', rules: '', banner: 'br', prizeDist: '' };
const TOURNAMENT_TABS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'ongoing', label: 'Ongoing' },
  { id: 'completed', label: 'Completed' },
] as const;
type TournamentAdminTab = (typeof TOURNAMENT_TABS)[number]['id'];

function confirmDestructiveAction(
  title: string,
  message: string,
  cancelLabel: string,
  confirmLabel: string,
  onConfirm: () => void,
) {
  if (Platform.OS === 'web') {
    // React Native Web's Alert.alert is intentionally a no-op.
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

function capacityFor(mode: string, teamType: string) {
  const size = teamType === 'Solo' ? 1 : teamType === 'Duo' ? 2 : 4;
  if (mode === 'Battle Royale') {
    if (teamType === 'Solo') return { slots: 48, label: '48 player slots' };
    return {
      slots: teamType === 'Duo' ? 24 : 12,
      label: `${teamType === 'Duo' ? 24 : 12} team slots · 48 players`,
    };
  }
  return { slots: 2, label: `2 team slots · ${size * 2} players` };
}

export default function AdminTournaments({
  onFinish,
  onManageRoom,
}: {
  onFinish?: (tournament: Tournament) => void;
  onManageRoom?: (tournament: Tournament) => void;
}) {
  const [list, setList] = useState<Tournament[] | null>(null);
  const [tab, setTab] = useState<TournamentAdminTab>('upcoming');
  const [form, setForm] = useState<any>(blank);
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [loadError, setLoadError] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());
  const cancelLifecycle = useUpdateTournamentLifecycle();
  const resultLogsQuery = useDaily007ListAdminResultLogs({
    query: { enabled: tab === 'completed', queryKey: getDaily007ListAdminResultLogsQueryKey() },
  });
  const resultLogs = resultLogsQuery.data?.data ?? [];
  const visibleTournaments = (list ?? []).filter(
    (tournament) => getTournamentLifecycleState(tournament, clockNow) === tab,
  );

  const load = useCallback(async () => {
    try {
      const response = await Api.tournaments();
      setList(Array.isArray(response) ? response : []);
      setClockNow(Date.now());
      setLoadError('');
    } catch (e: any) {
      setList([]);
      setLoadError(apiError(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!list) return;
    const now = Date.now();
    const nextStart = list
      .filter((tournament) => getTournamentLifecycleState(tournament, clockNow) === 'upcoming')
      .map((tournament) => Date.parse(String(tournament.startsAt ?? '')))
      .filter((start) => Number.isFinite(start) && start > now)
      .sort((a, b) => a - b)[0];
    if (nextStart === undefined) return;
    const timer = setTimeout(() => { void load(); }, Math.min(MAX_TIMEOUT_MS, Math.max(0, nextStart - now + 20)));
    return () => clearTimeout(timer);
  }, [list, clockNow, load]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    setErr(''); setOkMsg('');
    if (!form.name.trim() || !form.date.trim() || form.entryCoins === '') {
      return setErr('Name, date and entry coins are required.');
    }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(), mode: form.mode, teamType: form.teamType, date: form.date.trim(), time: form.time,
        entryCoins: Number(form.entryCoins), prizePool: Number(form.prizePool || 0), totalSlots: capacityFor(form.mode, form.teamType).slots,
        rules: form.rules, banner: form.banner, prizeDist: form.prizeDist,
      };
      if (editId) { await Api.updateTournament(editId, payload); setOkMsg('Tournament updated successfully'); }
      else { await Api.createTournament(payload); setOkMsg('Tournament created successfully'); }
      setShowForm(false); setEditId(null); setForm(blank); await load();
      setTimeout(() => setOkMsg(''), 2500);
    } catch (e: any) { setErr(apiError(e)); }
    finally { setBusy(false); }
  };

  const removeNow = async (t: Tournament) => {
    setErr(''); setOkMsg('');
    try {
      const result = await Api.deleteTournament(t.id);
      setOkMsg(result?.deleted === false
        ? 'Player or coin records exist, so the tournament was closed and its history was kept.'
        : 'Tournament deleted.');
      await load();
      setTimeout(() => setOkMsg(''), 3000);
    } catch (e: any) { setErr(apiError(e)); }
  };
  const remove = (t: Tournament) => {
    confirmDestructiveAction(
      'Delete tournament?',
      'Empty tournaments can be permanently deleted. If player or coin records exist, the tournament will only be closed so its history is preserved.',
      'Cancel',
      'Delete',
      () => { void removeNow(t); },
    );
  };
  const cancelNow = async (t: Tournament) => {
    setErr(''); setOkMsg('');
    try {
      const result = await cancelLifecycle.mutateAsync({
        id: t.id,
        data: { status: 'cancelled' },
      });
      const data = result?.data;
      const coinsRefunded = Number(data?.coinsRefunded ?? 0);
      const accountsRefunded = Number(data?.accountsRefunded ?? 0);
      setOkMsg(`Tournament cancelled. Refunded ${coinsRefunded} coins to ${accountsRefunded} payer account${accountsRefunded === 1 ? '' : 's'}.`);
      await load();
      setTimeout(() => setOkMsg(''), 4000);
    } catch (e: any) { setErr(apiError(e)); }
  };
  const cancel = (t: Tournament) => {
    confirmDestructiveAction(
      'Cancel tournament and refund players?',
      'This is available only after the scheduled start when at least one slot is vacant. Each recorded entry fee will be refunded to the account that paid it. This cannot be undone.',
      'Keep tournament',
      'Cancel and refund',
      () => { void cancelNow(t); },
    );
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={st.h}>TOURNAMENTS</Text>
        {tab === 'upcoming' && (
          <Btn title={showForm ? 'CLOSE' : 'NEW'} small onPress={() => { setShowForm(!showForm); setEditId(null); setForm(blank); }} />
        )}
      </View>
      <Text style={st.hint}>FINISH opens winner entry. Publishing rank 1 credits the prize and completes the match.</Text>
      <Msg kind="err" text={err} />
      {!!loadError && <Msg kind="err" text={`Could not load tournaments: ${loadError}`} />}
      <Msg kind="ok" text={okMsg} />
      <View style={st.tabs}>
        {TOURNAMENT_TABS.map(({ id, label }) => {
          const selected = tab === id;
          const count = (list ?? []).filter(
            (tournament) => getTournamentLifecycleState(tournament, clockNow) === id,
          ).length;
          return (
            <Pressable
              key={id}
              testID={`admin-tournament-tab-${id}`}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: showForm }}
              accessibilityLabel={`${label} tournaments, ${count}`}
              disabled={showForm}
              onPress={() => setTab(id)}
              style={[st.tab, selected && st.tabOn, showForm && st.tabDisabled]}
            >
              <Text numberOfLines={1} style={[st.tabText, selected && st.tabTextOn]}>
                {label} <Text style={[st.tabCount, selected && st.tabTextOn]}>{count}</Text>
              </Text>
            </Pressable>
          );
        })}
      </View>
      {tab === 'completed' && resultLogsQuery.isError && (
        <Msg kind="err" text={`Could not load completed result logs: ${apiError(resultLogsQuery.error)}`} />
      )}

      {showForm && (
        <Card style={{ marginBottom: 14 }}>
          <Text style={st.formH}>{editId ? 'EDIT TOURNAMENT' : 'CREATE TOURNAMENT'}</Text>
          <Input placeholder="Tournament name *" value={form.name} onChangeText={(v) => set('name', v)} />
          <Text style={st.lbl}>GAME MODE</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {['Battle Royale', 'Clash Squad', 'Lone Wolf'].map((m) => (
              <Chip key={m} label={m} color={form.mode === m ? C.neon : C.sub} onPress={() => {
                setForm((f: any) => ({
                  ...f,
                  mode: m,
                  banner: m === 'Battle Royale' ? 'br' : m === 'Clash Squad' ? 'cs' : 'lw',
                }));
              }} />
            ))}
          </View>
          <Text style={st.lbl}>FORMAT</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            {['Solo', 'Duo', 'Squad'].map((m) => (
              <Chip key={m} label={m} color={form.teamType === m ? C.purple : C.sub} onPress={() => set('teamType', m)} />
            ))}
          </View>
          <Input placeholder="Date (YYYY-MM-DD, IST) *" value={form.date} onChangeText={(v) => set('date', v)} />
          <Text style={st.lbl}>TIME (IST · 12-HOUR)</Text>
          <TimePicker variant="admin" value={form.time} onChange={(v) => set('time', v)} />
          <Text style={st.lbl}>ENTRY FEE & PRIZE ({COIN_RATE_TEXT})</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Input placeholder="Entry coins *" value={form.entryCoins} onChangeText={(v) => set('entryCoins', v)} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><Input placeholder="Prize pool" value={form.prizePool} onChangeText={(v) => set('prizePool', v)} keyboardType="number-pad" /></View>
          </View>
          {!!form.entryCoins && <Text style={st.inrNote}>Entry fee: {form.entryCoins} coins = {inr(Number(form.entryCoins))} INR</Text>}
          {!!form.prizePool && <Text style={st.inrNote}>Prize pool: {form.prizePool} coins = {inr(Number(form.prizePool))} INR</Text>}
          <Text style={st.lbl}>CANONICAL CAPACITY</Text>
          <Text style={st.capacity}>{capacityFor(form.mode, form.teamType).label}</Text>
          <Text style={st.capacityNote}>Capacity follows the selected mode and team type; team entry fees are charged once to the captain.</Text>
          <TextInput style={st.area} placeholder="Rules (one per line)" placeholderTextColor={C.sub} value={form.rules} onChangeText={(v) => set('rules', v)} multiline />
          <TextInput style={st.area} placeholder="Prize distribution (e.g. 1st: 500 coins)" placeholderTextColor={C.sub} value={form.prizeDist} onChangeText={(v) => set('prizeDist', v)} multiline />
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            {['br', 'cs', 'lw'].map((b) => (
              <Chip key={b} label={`${b.toUpperCase()} banner`} color={form.banner === b ? C.orange : C.sub} onPress={() => set('banner', b)} />
            ))}
          </View>
          <Btn title={editId ? 'SAVE CHANGES' : 'CREATE'} onPress={save} loading={busy} />
        </Card>
      )}

      {!list ? <Loading /> : visibleTournaments.length === 0 ? <Empty text={`No ${tab} tournaments.`} /> : visibleTournaments.map((t) => {
        const lifecycle = getTournamentLifecycleState(t, clockNow);
        const finished = lifecycle === 'completed';
        const ongoing = lifecycle === 'ongoing';
        const cancellable = ongoing && Number(t.filledSlots ?? 0) < Number(t.totalSlots ?? 0);
        const tournamentResults = resultLogs
          .filter((entry) => entry.tournamentId === t.id)
          .sort((a, b) => Number(a.rank) - Number(b.rank));
        const winner = tournamentResults.find((entry) => Number(entry.rank) === 1);
        const winnerName = String(winner?.gameName || winner?.playerName || winner?.teamName || 'Winner');
        const statusLabel = finished ? 'COMPLETED' : ongoing ? 'ONGOING' : 'UPCOMING';
        return (
          <Card key={t.id} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={st.tName}>{t.name}</Text>
              <Chip label={statusLabel} color={finished ? C.gold : ongoing ? C.red : C.green} />
            </View>
            <Text style={st.sub}>{t.mode} • {t.teamType} • {t.date} • {t.time} IST</Text>
            <Text style={st.sub}>ENTRY {t.entryCoins} ({inr(t.entryCoins)}) • PRIZE POOL {t.prizePool} ({inr(t.prizePool)}) • {t.capacityLabel || `${t.totalSlots} slots`}</Text>
            {tab === 'upcoming' && (
              <>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Btn
                      title="EDIT"
                      small
                      kind="ghost"
                      testID={`edit-tournament-${t.id}`}
                      onPress={() => {
                        setForm({ ...blank, ...t, entryCoins: String(t.entryCoins), prizePool: String(t.prizePool), totalSlots: String(t.totalSlots) });
                        setEditId(t.id);
                        setShowForm(true);
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Btn title="DELETE" small kind="danger" testID={`delete-tournament-${t.id}`} onPress={() => remove(t)} />
                  </View>
                </View>
                <View style={{ marginTop: 8 }}>
                  <Btn title="ROOM SETUP" small kind="ghost" testID={`manage-room-${t.id}`} onPress={() => onManageRoom?.(t)} />
                </View>
              </>
            )}
            {tab === 'ongoing' && (
              <>
                {cancellable && (
                  <View style={{ marginTop: 10 }}>
                    <Btn
                      title="CANCEL & REFUND"
                      small
                      kind="danger"
                      testID={`cancel-tournament-${t.id}`}
                      loading={cancelLifecycle.isPending}
                      onPress={() => cancel(t)}
                    />
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: cancellable ? 8 : 10 }}>
                  <View style={{ flex: 1 }}>
                    <Btn title="SHARE ROOM" small kind="ghost" testID={`manage-room-${t.id}`} onPress={() => onManageRoom?.(t)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Btn title="INPUT RESULTS" small kind="gold" testID={`finish-tournament-${t.id}`} onPress={() => onFinish?.(t)} />
                  </View>
                </View>
              </>
            )}
            {tab === 'completed' && (
              <View testID={`completed-result-log-${t.id}`} style={st.resultLog}>
                <Text style={st.resultTitle}>WINNER & RESULT LOG</Text>
                {resultLogsQuery.isLoading ? (
                  <Text style={st.resultLine}>Loading published results…</Text>
                ) : resultLogsQuery.isError ? (
                  <View>
                    <Text style={st.resultLine}>Result logs are unavailable right now.</Text>
                    <View style={{ marginTop: 6 }}>
                      <Btn title="RETRY LOGS" small kind="ghost" onPress={() => { void resultLogsQuery.refetch(); }} />
                    </View>
                  </View>
                ) : winner ? (
                  <>
                    <Text style={st.winnerName}>WINNER · {winnerName}</Text>
                    <Text style={st.resultSettlement}>PRIZE SETTLED · {Number(winner.prizeCoins).toLocaleString()} COINS</Text>
                    {tournamentResults.map((entry) => {
                      const playerName = String(entry.gameName || entry.playerName || entry.teamName || 'Player');
                      const team = entry.teamName && entry.teamName !== playerName ? ` · ${entry.teamName}` : '';
                      return (
                        <Text key={entry.registrationId} style={st.resultLine}>
                          {`#${entry.rank} ${playerName}${team} · ${Number(entry.kills)} kills · ${Number(entry.prizeCoins).toLocaleString()} coins`}
                        </Text>
                      );
                    })}
                  </>
                ) : (
                  <Text style={st.resultLine}>No published result entries were returned for this completed tournament.</Text>
                )}
              </View>
            )}
          </Card>
        );
      })}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 30 },
  tabs: { flexDirection: 'row', gap: 7, marginBottom: 12 },
  tab: {
    flex: 1, minHeight: 38, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card,
  },
  tabOn: { borderColor: C.neon, backgroundColor: C.neon + '20' },
  tabDisabled: { opacity: 0.5 },
  tabText: { color: C.sub, fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
  tabTextOn: { color: C.text },
  tabCount: { color: C.dim, fontSize: 9, fontWeight: '700' },
  h: { color: C.text, fontSize: 20, fontWeight: '900', letterSpacing: 0.7, fontFamily: 'Inter_700Bold' },
  hint: { color: C.sub, fontSize: 11, marginTop: 3, marginBottom: 10 },
  formH: { color: C.neon, fontWeight: '900', letterSpacing: 1, marginBottom: 10 },
  lbl: { color: C.sub, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  area: { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 10, color: C.text, padding: 12, minHeight: 60, marginBottom: 10, fontSize: 14 },
  tName: { color: C.text, fontWeight: '900', flex: 1, fontSize: 14 },
  sub: { color: C.sub, fontSize: 11, marginTop: 3 },
  inrNote: { color: C.gold, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  resultLog: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border },
  resultTitle: { color: C.gold, fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginBottom: 5 },
  winnerName: { color: C.text, fontSize: 13, fontWeight: '900' },
  resultSettlement: { color: C.green, fontSize: 10, fontWeight: '800', marginTop: 3, marginBottom: 4 },
  resultLine: { color: C.sub, fontSize: 10, lineHeight: 15, marginTop: 2 },
  capacity: { color: C.text, fontSize: 14, fontWeight: '900', marginBottom: 3 },
  capacityNote: { color: C.dim, fontSize: 11, marginBottom: 10 },
});
