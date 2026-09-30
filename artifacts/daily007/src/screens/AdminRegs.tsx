import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Api, apiError } from '../lib/api';
import { Btn, Card, C, Chip, Empty, Loading, Msg } from '../components/ui';

const TABS = ['pending', 'approved', 'rejected'] as const;

export default function AdminRegs() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [all, setAll] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    setAll(await Api.adminRegistrations());
  }, []);
  useEffect(() => {
    setAll(null);
    load().catch((e) => { setErr(apiError(e)); setAll([]); });
  }, [load]);

  const list = (all ?? []).filter((x) => x.status === tab);

  const act = async (id: string, action: 'approve' | 'reject') => {
    if (busyId) return;
    setErr(''); setOkMsg(''); setBusyId(id);
    try {
      await Api.adminRegAction(id, action);
      setOkMsg(action === 'approve' ? 'Registration approved' : 'Registration rejected — coins refunded');
      setTimeout(() => setOkMsg(''), 2500);
      try { await load(); }
      catch (e: any) { setErr(`Could not refresh registrations: ${apiError(e)}`); }
    } catch (e: any) { setErr(apiError(e)); }
    finally { setBusyId(null); }
  };

  const del = async (id: string) => {
    if (busyId) return;
    setErr(''); setOkMsg(''); setBusyId(id);
    try {
      await Api.adminDeleteRegistration(id);
      setOkMsg('Registration deleted');
      setTimeout(() => setOkMsg(''), 2500);
      try { await load(); }
      catch (e: any) { setErr(`Could not refresh registrations: ${apiError(e)}`); }
    } catch (e: any) { setErr(apiError(e)); }
    finally { setBusyId(null); }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <Text style={st.h}>📝 REGISTRATIONS</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {TABS.map((t) => <Chip key={t} label={t.toUpperCase()} color={tab === t ? C.neon : C.sub} onPress={() => setTab(t)} />)}
      </View>
      <Msg kind="err" text={err} />
      <Msg kind="ok" text={okMsg} />
      {all === null ? <Loading /> : err && all.length === 0 ? null : list.length === 0 ? <Empty text={`No ${tab} registrations.`} /> : list.map((r) => (
        <Card key={r.id} style={{ marginBottom: 10 }}>
          <Text style={st.pName}>{r.playerName}{r.teamName ? ` — ${r.teamName}` : ''}</Text>
          <Text style={st.sub}>🎮 UID: {r.gameUid}</Text>
          <Text style={st.sub}>🎯 {r.tournamentName || r.tournamentId} • {r.mode || ''} {r.teamType || ''}</Text>
          <Text style={st.sub}>🪙 Entry: {r.entryCoins} • {new Date(r.createdAt).toLocaleString()}</Text>
          {r.teamMembers && r.teamMembers !== '[]' && (
            <Text style={st.sub}>👥 {r.teamMembers}</Text>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {tab === 'pending' && (
              <>
                <View style={{ flex: 1 }}><Btn title="✅ APPROVE" small loading={busyId === r.id} disabled={busyId !== null} onPress={() => act(r.id, 'approve')} /></View>
                <View style={{ flex: 1 }}><Btn title="❌ REJECT" small kind="danger" loading={busyId === r.id} disabled={busyId !== null} onPress={() => act(r.id, 'reject')} /></View>
              </>
            )}
            {tab !== 'pending' && (
              <View style={{ flex: 1 }}><Btn title="🗑 DELETE" small kind="danger" loading={busyId === r.id} disabled={busyId !== null} onPress={() => del(r.id)} /></View>
            )}
          </View>
        </Card>
      ))}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 30 },
  h: { color: C.text, fontSize: 20, fontWeight: '900', marginBottom: 10, letterSpacing: 1 },
  pName: { color: C.text, fontWeight: '900', fontSize: 14 },
  sub: { color: C.sub, fontSize: 11, marginTop: 3 },
});
