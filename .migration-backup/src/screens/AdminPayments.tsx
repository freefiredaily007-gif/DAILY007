import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Api, apiError } from '../lib/api';
import { Btn, Card, C, Chip, Empty, Loading, Msg } from '../components/ui';
import { inr } from '../lib/coins';

const TABS = ['pending', 'approved', 'rejected'] as const;

export default function AdminPayments() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [all, setAll] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [pays, ws] = await Promise.all([Api.adminPayments(), Api.adminWithdrawals()]);
      setAll([
        ...(Array.isArray(pays) ? pays : []).map((p: any) => ({ ...p, kind: 'payment' })),
        ...(Array.isArray(ws) ? ws : []).map((w: any) => ({ ...w, kind: 'withdrawal' })),
      ]);
    } catch (e: any) { setErr(apiError(e)); setAll([]); }
  }, []);
  useEffect(() => { setAll(null); load(); }, [load]);

  const list = (all ?? []).filter((x) => x.status === tab);

  const act = async (id: string, kind: string, action: 'approve' | 'reject') => {
    setErr(''); setOkMsg(''); setBusyId(id);
    try {
      if (kind === 'withdrawal') await Api.adminWithdrawalAction(id, action);
      else await Api.adminPaymentAction(id, action);
      setOkMsg(action === 'approve'
        ? (kind === 'withdrawal' ? 'Withdrawal approved' : 'Payment approved — coins credited')
        : (kind === 'withdrawal' ? 'Withdrawal rejected — coins refunded' : 'Payment rejected'));
      await load();
      setTimeout(() => setOkMsg(''), 2500);
    } catch (e: any) { setErr(apiError(e)); }
    finally { setBusyId(null); }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <Text style={st.h}>💳 PAYMENTS</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {TABS.map((t) => <Chip key={t} label={t.toUpperCase()} color={tab === t ? C.neon : C.sub} onPress={() => setTab(t)} />)}
      </View>
      <Msg kind="err" text={err} />
      <Msg kind="ok" text={okMsg} />
      {!list ? <Loading /> : list.length === 0 ? <Empty text={`No ${tab} requests.`} /> : list.map((p) => (
        <Card key={p.kind + ':' + p.id} style={{ marginBottom: 10 }}>
          <Text style={st.pName}>{p.kind === 'withdrawal' ? '↩ WITHDRAW' : '🪙 ADD'} {p.coins ?? p.amount} coins — {inr(p.coins ?? p.amount)}</Text>
          <Text style={st.sub}>👤 {p.userName || p.userId}</Text>
          <Text style={st.sub}>{p.kind === 'withdrawal' ? `🏦 ${p.method} • ${p.account || '—'}` : `💳 ${p.method} • Ref: ${p.reference || '—'}`}</Text>
          <Text style={st.sub}>{new Date(p.createdAt).toLocaleString()}</Text>
          {tab === 'pending' && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <View style={{ flex: 1 }}><Btn title="✅ APPROVE" small loading={busyId === p.id} onPress={() => act(p.id, p.kind, 'approve')} /></View>
              <View style={{ flex: 1 }}><Btn title="❌ REJECT" small kind="danger" loading={busyId === p.id} onPress={() => act(p.id, p.kind, 'reject')} /></View>
            </View>
          )}
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
