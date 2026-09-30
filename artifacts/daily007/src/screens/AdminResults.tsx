import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Api, apiError, AdminRegistration, Tournament } from '../lib/api';
import { Btn, Card, C, Empty, Input, Loading, Msg } from '../components/ui';
import { inr, COIN_RATE_TEXT } from '../lib/coins';

export default function AdminResults() {
  const [list, setList] = useState<Tournament[] | null>(null);
  const [sel, setSel] = useState<Tournament | null>(null);
  const [regs, setRegs] = useState<AdminRegistration[] | null>(null);
  const requestId = useRef(0);
  const [regId, setRegId] = useState('');
  const [rank, setRank] = useState('');
  const [kills, setKills] = useState('');
  const [prizeCoins, setPrizeCoins] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  useEffect(() => { Api.tournaments(true).then(setList).catch(() => setList([])); }, []);

  const open = async (t: Tournament) => {
    const currentRequest = ++requestId.current;
    setSel(t); setErr(''); setOkMsg(''); setRegs(null); setRegId(''); setRank(''); setKills(''); setPrizeCoins('');
    try {
      const approved = await Api.adminApprovedRegs(t.id);
      if (requestId.current === currentRequest) setRegs(approved);
    } catch (e: any) {
      if (requestId.current === currentRequest) { setErr(apiError(e)); setRegs([]); }
    }
  };

  const back = () => { requestId.current++; setSel(null); setRegs(null); setRegId(''); };

  const publish = async () => {
    if (!sel) return;
    setErr(''); setOkMsg('');
    if (!regId || !regs?.some((r) => r.id === regId && r.tournamentId === sel.id && r.status === 'approved')) {
      return setErr('Select an approved player for this tournament.');
    }
    if (!rank || !prizeCoins) return setErr('Rank and prize coins are required.');
    setBusy(true);
    try {
      await Api.adminPublishResult({
        tournamentId: sel.id, registrationId: regId,
        rank: Number(rank), kills: Number(kills || 0), prizeCoins: Number(prizeCoins),
      });
      setOkMsg('Result published — prize credited to player');
      setRegId(''); setRank(''); setKills(''); setPrizeCoins('');
      setTimeout(() => setOkMsg(''), 2500);
    } catch (e: any) { setErr(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <Text style={st.h}>🏆 RESULTS</Text>
      <Msg kind="err" text={err} />
      <Msg kind="ok" text={okMsg} />
      {!list ? <Loading /> : !sel ? list.map((t) => (
        <Card key={t.id} style={{ marginBottom: 10 }}>
          <Text style={st.tName}>{t.name}</Text>
          <Text style={st.sub}>{t.date} • {t.time}</Text>
          <View style={{ marginTop: 8 }}><Btn title="ADD RESULT →" small kind="ghost" onPress={() => open(t)} /></View>
        </Card>
      )) : (
        <Card>
          <Text onPress={back} style={{ color: C.neon, fontWeight: '900', marginBottom: 8 }}>← BACK</Text>
          <Text style={st.tName}>{sel.name}</Text>
          {!regs ? <Loading /> : regs.length === 0 ? <Empty text="No approved registrations." /> : (
            <View style={{ marginBottom: 10 }}>
              <Text style={st.lbl}>SELECT PLAYER</Text>
              {regs.map((r) => (
                <Card key={r.id} style={{ padding: 10, marginBottom: 6, borderColor: regId === r.id ? C.neon : C.border }}>
                  <Text onPress={() => setRegId(r.id)} style={{ color: regId === r.id ? C.neon : C.text, fontWeight: '800', fontSize: 13 }}>
                    {regId === r.id ? '✅ ' : ''}{r.playerName}{r.teamName ? ` — ${r.teamName}` : ''} (UID {r.gameUid})
                  </Text>
                </Card>
              ))}
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Input placeholder="Rank *" value={rank} onChangeText={setRank} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><Input placeholder="Kills" value={kills} onChangeText={setKills} keyboardType="number-pad" /></View>
          </View>
          <Input placeholder="Prize coins *" value={prizeCoins} onChangeText={setPrizeCoins} keyboardType="number-pad" />
          {!!prizeCoins && <Text style={st.inrNote}>Prize: {prizeCoins} coins = {inr(Number(prizeCoins))} INR ({COIN_RATE_TEXT})</Text>}
          <Btn title="📢 PUBLISH RESULT" onPress={publish} loading={busy} />
        </Card>
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 30 },
  h: { color: C.text, fontSize: 20, fontWeight: '900', marginBottom: 10, letterSpacing: 1 },
  lbl: { color: C.sub, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  tName: { color: C.text, fontWeight: '900', fontSize: 14 },
  sub: { color: C.sub, fontSize: 11, marginTop: 3 },
  inrNote: { color: C.gold, fontSize: 12, fontWeight: '700', marginBottom: 8 },
});
