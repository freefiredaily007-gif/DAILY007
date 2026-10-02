import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View, Text, ScrollView, StyleSheet, TextInput } from 'react-native';
import { Api, apiError, Tournament } from '../lib/api';
import { Btn, Card, C, Chip, Empty, Input, Loading, Msg, TimePicker } from '../components/ui';
import { inr, COIN_RATE_TEXT } from '../lib/coins';
import { getTournamentLifecycleState, MAX_TIMEOUT_MS } from '../lib/tournamentLifecycle';

const blank = { name: '', mode: 'Battle Royale', teamType: 'Solo', date: '', time: '08:00 PM', entryCoins: '', prizePool: '', totalSlots: '48', rules: '', banner: 'br', prizeDist: '' };

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
  const [form, setForm] = useState<any>(blank);
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [loadError, setLoadError] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());

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
    const timer = setTimeout(() => setClockNow(Date.now()), Math.min(MAX_TIMEOUT_MS, Math.max(0, nextStart - now + 20)));
    return () => clearTimeout(timer);
  }, [list, clockNow]);

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
    Alert.alert(
      'Delete tournament?',
      'Empty tournaments can be permanently deleted. If player or coin records exist, the tournament will only be closed so its history is preserved.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { void removeNow(t); } },
      ],
    );
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={st.h}>TOURNAMENTS</Text>
        <Btn title={showForm ? 'CLOSE' : 'NEW'} small onPress={() => { setShowForm(!showForm); setEditId(null); setForm(blank); }} />
      </View>
      <Text style={st.hint}>FINISH opens winner entry. Publishing rank 1 credits the prize and completes the match.</Text>
      <Msg kind="err" text={err} />
      {!!loadError && <Msg kind="err" text={`Could not load tournaments: ${loadError}`} />}
      <Msg kind="ok" text={okMsg} />

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
          <Input placeholder="Date (YYYY-MM-DD) *" value={form.date} onChangeText={(v) => set('date', v)} />
          <Text style={st.lbl}>TIME (12-HOUR)</Text>
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

      {!list ? <Loading /> : list.length === 0 ? <Empty text="No tournaments yet." /> : list.map((t) => {
        const lifecycle = getTournamentLifecycleState(t, clockNow);
        const finished = lifecycle === 'completed';
        const ongoing = lifecycle === 'ongoing';
        const statusLabel = finished ? 'COMPLETED' : ongoing ? 'ONGOING' : t.enabled ? 'ENABLED' : 'DISABLED';
        return (
          <Card key={t.id} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={st.tName}>{t.name}</Text>
              <Chip label={statusLabel} color={finished ? C.gold : ongoing ? C.red : t.enabled ? C.green : C.red} />
            </View>
            <Text style={st.sub}>{t.mode} • {t.teamType} • {t.date} • {t.time}</Text>
            <Text style={st.sub}>ENTRY {t.entryCoins} ({inr(t.entryCoins)}) • PRIZE POOL {t.prizePool} ({inr(t.prizePool)}) • {t.capacityLabel || `${t.totalSlots} slots`}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <View style={{ flex: 1 }}><Btn title="EDIT" small kind="ghost" onPress={() => { setForm({ ...blank, ...t, entryCoins: String(t.entryCoins), prizePool: String(t.prizePool), totalSlots: String(t.totalSlots) }); setEditId(t.id); setShowForm(true); }} /></View>
              <View style={{ flex: 1 }}><Btn title="DELETE" small kind="danger" onPress={() => remove(t)} /></View>
            </View>
            {ongoing ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                  <Btn title="MANAGE ROOM" small kind="ghost" testID={`manage-room-${t.id}`} onPress={() => onManageRoom?.(t)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Btn title="FINISH & RESULTS" small kind="gold" testID={`finish-tournament-${t.id}`} onPress={() => onFinish?.(t)} />
                </View>
              </View>
            ) : finished ? (
              <View style={{ marginTop: 8 }}>
                <Btn title="FINISHED" small kind="ghost" disabled />
              </View>
            ) : (
              <View style={{ marginTop: 8 }}>
                <Btn title="WAIT FOR START" small kind="ghost" disabled />
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
  h: { color: C.text, fontSize: 20, fontWeight: '900', letterSpacing: 0.7, fontFamily: 'Inter_700Bold' },
  hint: { color: C.sub, fontSize: 11, marginTop: 3, marginBottom: 10 },
  formH: { color: C.neon, fontWeight: '900', letterSpacing: 1, marginBottom: 10 },
  lbl: { color: C.sub, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  area: { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 10, color: C.text, padding: 12, minHeight: 60, marginBottom: 10, fontSize: 14 },
  tName: { color: C.text, fontWeight: '900', flex: 1, fontSize: 14 },
  sub: { color: C.sub, fontSize: 11, marginTop: 3 },
  inrNote: { color: C.gold, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  capacity: { color: C.text, fontSize: 14, fontWeight: '900', marginBottom: 3 },
  capacityNote: { color: C.dim, fontSize: 11, marginBottom: 10 },
});
