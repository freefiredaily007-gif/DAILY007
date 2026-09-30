import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../lib/api';
import { C, Btn, Card, Chip, Input, KV, Msg, Badge, SectionTitle, GCard, fmtDate, fmtTime12, statusOf } from '../components/ui';
import { inr, COIN_RATE_TEXT } from '../lib/coins';
import { useApp } from '../App';

export default function TDetail() {
  const nav: any = useNavigation();
  const route: any = useRoute();
  const id = route?.params?.id;
  const { user } = useApp();
  const [t, setT] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    try { setT(await api.tournaments.get(id)); } catch (e: any) { setErr(e?.message || 'Failed to load'); }
    setLoading(false);
  }, [id]);
  React.useEffect(() => { load(); }, [load]);

  if (loading) return <View style={s.root} />;
  if (!t) return <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}><Text style={{ color: C.sub }}>Tournament not found.</Text></View>;

  const st = statusOf(t);
  const joined = !!t?.joined;
  const full = (t.filledSlots ?? 0) >= (t.totalSlots ?? 0);
  const coins = user?.coins ?? 0;
  const short = coins < (t.entryCoins ?? 0);

  const join = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      await api.registrations.create({ tournamentId: t.id });
      setMsg('Registered! Check MY MATCHES for room details.');
      await load();
    } catch (e: any) { setErr(e?.response?.data?.error || e?.message || 'Failed'); }
    setBusy(false);
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.neon} />}>
      {/* HERO */}
      <GCard glowColor={st.key === 'live' ? C.neon : C.orange} style={{ marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={s.mode}>{(t.mode || 'BATTLE ROYALE').toUpperCase()}</Text>
            <Text style={s.name}>{t.name || t.title}</Text>
            <Text style={s.meta}>📅 {fmtDate(t.date)} • {fmtTime12(t.time)}</Text>
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
          <Text style={s.statK}>SLOTS</Text>
          <Text style={[s.statV, { color: C.blue }]}>{t.filledSlots ?? 0}/{t.totalSlots ?? 0}</Text>
          <Text style={s.statSub}>{COIN_RATE_TEXT}</Text>
        </View>
      </View>

      <SectionTitle accent={C.orange}>MATCH INFO</SectionTitle>
      <Card>
        <KV k="Mode" v={t.mode || '—'} />
        <KV k="Map" v={t.map || '—'} />
        <KV k="Per Team" v={t.perTeam ? `${t.perTeam} players` : '—'} />
        <KV k="Version" v={t.version || '—'} />
        {!!t.rules && <Text style={s.rules}>{t.rules}</Text>}
      </Card>

      {t.roomId ? (
        <>
          <SectionTitle accent={C.green}>ROOM DETAILS</SectionTitle>
          <Card glowColor={C.green}>
            <KV k="Room ID" v={t.roomId} color={C.green} />
            <KV k="Password" v={t.roomPass || '—'} color={C.green} />
          </Card>
        </>
      ) : null}

      <Msg kind="err" text={err} />
      <Msg kind="ok" text={msg} />

      <View style={{ marginTop: 16 }}>
        {joined ? (
          <Btn title="✓ ALREADY REGISTERED" kind="ghost" disabled />
        ) : st.key === 'completed' ? (
          <Btn title="MATCH ENDED" kind="ghost" disabled />
        ) : full ? (
          <Btn title="MATCH FULL" kind="ghost" disabled />
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
  statRow: { flexDirection: 'row', borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, marginBottom: 6, overflow: 'hidden' },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statK: { color: C.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  statV: { fontSize: 17, fontWeight: '900', marginTop: 3 },
  statSub: { color: C.dim, fontSize: 9, marginTop: 2 },
  rules: { color: C.sub, fontSize: 12, marginTop: 10, lineHeight: 18 },
});
