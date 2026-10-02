import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
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
    try {
      setErr('');
      const [tournament, registrations] = await Promise.all([
        api.tournament(id),
        api.myRegistrations(),
      ]);
      const registration = (Array.isArray(registrations) ? registrations : []).find((item: any) =>
        String(item.tournamentId) === String(id) &&
        ['approved', 'pending'].includes(String(item.status ?? '').toLowerCase()),
      );
      setT({ ...tournament, joined: !!registration, myRegistration: registration });
    } catch (e: any) { setErr(e?.message || 'Failed to load'); }
    setLoading(false);
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading) return <View style={s.root} />;
  if (!t) return <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}><Text style={{ color: C.sub }}>Tournament not found.</Text></View>;

  const st = statusOf(t);
  const joined = !!t?.joined;
  const teamType = String(t.teamType || '').toLowerCase();
  const mode = String(t.mode || '').toLowerCase();
  const totalSlots = Number(t.totalSlots ?? (mode.includes('clash') ? 2 : teamType === 'squad' ? 12 : 48));
  const filledSlots = Number(t.filledSlots ?? t.filled ?? 0);
  const tournamentStatus = String(t.status || '').toLowerCase();
  const full = st.key === 'full' || tournamentStatus === 'setup_needed' || (totalSlots > 0 && filledSlots >= totalSlots);
  const coins = user?.coins ?? 0;
  const short = coins < (t.entryCoins ?? 0);

  const join = async () => {
    nav.navigate('JoinForm', { id: t.id });
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.neon} />}>
      {/* HERO */}
      <GCard glowColor={st.key === 'ongoing' ? C.neon : C.orange} style={{ marginBottom: 14 }}>
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
        {st.key === 'completed' || ['closed', 'cancelled'].includes(tournamentStatus) ? (
          <Btn title="MATCH ENDED" kind="ghost" disabled />
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
  statRow: { flexDirection: 'row', borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, marginBottom: 6, overflow: 'hidden' },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statK: { color: C.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  statV: { fontSize: 17, fontWeight: '900', marginTop: 3 },
  statSub: { color: C.dim, fontSize: 9, marginTop: 2 },
  rules: { color: C.sub, fontSize: 12, marginTop: 10, lineHeight: 18 },
});
