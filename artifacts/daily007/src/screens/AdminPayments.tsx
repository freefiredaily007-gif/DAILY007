import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, ScrollView, StyleSheet } from 'react-native';
import { Api, apiError } from '../lib/api';
import { Btn, Card, C, Chip, Empty, Loading, Msg } from '../components/ui';
import { inr } from '../lib/coins';
import { ConfirmDialog, PromptDialog } from '../components/adminKit';

const TABS = ['pending', 'approved', 'rejected'] as const;

export default function AdminPayments() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [rejectTarget, setRejectTarget] = useState<{ id: string; kind: string } | null>(null);
  const [rejectBusy, setRejectBusy] = useState(false);
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  const [proofLoading, setProofLoading] = useState<string | null>(null);
  const [payoutTarget, setPayoutTarget] = useState<string | null>(null);
  const [payoutBusy, setPayoutBusy] = useState(false);

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
    if (action === 'reject') {
      setRejectTarget({ id, kind });
      return;
    }
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

  const reject = async (reason: string) => {
    const target = rejectTarget;
    if (!target) return;
    if (!reason.trim()) { setErr('A rejection reason is required.'); return; }
    setRejectBusy(true); setErr(''); setOkMsg('');
    try {
      if (target.kind === 'withdrawal') await Api.adminWithdrawalAction(target.id, 'reject', reason.trim());
      else await Api.adminPaymentAction(target.id, 'reject', reason.trim());
      setRejectTarget(null);
      setOkMsg(target.kind === 'withdrawal' ? 'Withdrawal rejected — coins refunded' : 'Payment rejected');
      await load();
    } catch (e: any) { setErr(apiError(e)); }
    finally { setRejectBusy(false); }
  };

  const showProof = async (id: string) => {
    setProofLoading(id); setErr('');
    try {
      const result = await Api.adminPaymentProofUrl(id);
      setProofUrls((current) => ({ ...current, [id]: String(result?.url ?? '') }));
    } catch (e: any) { setErr(apiError(e)); }
    finally { setProofLoading(null); }
  };

  const markPaid = async () => {
    if (!payoutTarget) return;
    setPayoutBusy(true); setErr(''); setOkMsg('');
    try {
      await Api.adminMarkWithdrawalPaid(payoutTarget);
      setPayoutTarget(null);
      setOkMsg('Manual payout recorded');
      await load();
    } catch (e: any) { setErr(apiError(e)); }
    finally { setPayoutBusy(false); }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <Text style={st.h}>💳 PAYMENTS</Text>
      <Text style={st.notice}>Payment approval is manual. Withdrawal approval does not send money automatically; arrange the payout separately.</Text>
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
          {p.kind === 'payment' && <Text style={st.sub}>🧾 Transaction ID: {p.txnId || p.transactionId || p.reference || '—'}</Text>}
          <Text style={st.sub}>{new Date(p.createdAt).toLocaleString()}</Text>
          {p.reviewReason && <Text style={st.reason}>Review note: {p.reviewReason}</Text>}
          {p.kind === 'payment' && p.proofAvailable && (
            <View style={{ marginTop: 8 }}>
              {proofUrls[p.id]
                ? <Image source={{ uri: proofUrls[p.id] }} resizeMode="contain" style={st.proof} />
                : <Btn title="VIEW PAYMENT SCREENSHOT" small kind="ghost" loading={proofLoading === p.id} onPress={() => showProof(p.id)} />}
            </View>
          )}
          {p.kind === 'withdrawal' && p.status === 'approved' && p.payoutStatus === 'manual_payout_required' && (
            <Btn title="RECORD MANUAL PAYOUT SENT" small kind="gold" loading={payoutBusy && payoutTarget === p.id} onPress={() => setPayoutTarget(p.id)} style={{ marginTop: 10 }} />
          )}
          {tab === 'pending' && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <View style={{ flex: 1 }}><Btn title="✅ APPROVE" small loading={busyId === p.id} onPress={() => act(p.id, p.kind, 'approve')} /></View>
              <View style={{ flex: 1 }}><Btn title="❌ REJECT" small kind="danger" loading={busyId === p.id} onPress={() => act(p.id, p.kind, 'reject')} /></View>
            </View>
          )}
        </Card>
      ))}
      <View style={{ height: 30 }} />
      <PromptDialog
        visible={!!rejectTarget}
        title="Reject request"
        message="Enter a reason the player can see. This is required."
        confirmTitle={rejectBusy ? 'SAVING…' : 'REJECT'}
        onCancel={() => setRejectTarget(null)}
        onSubmit={(reason) => { void reject(reason); }}
      />
      <ConfirmDialog
        visible={!!payoutTarget}
        title="Record manual payout"
        message="Only confirm after the money has actually been sent. This action records the payout in the request history."
        confirmTitle={payoutBusy ? 'SAVING…' : 'MARK PAID'}
        onCancel={() => setPayoutTarget(null)}
        onConfirm={() => { void markPaid(); }}
      />
    </ScrollView>
  );
}
const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 30 },
  h: { color: C.text, fontSize: 20, fontWeight: '900', marginBottom: 10, letterSpacing: 1 },
  notice: { color: C.gold, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  pName: { color: C.text, fontWeight: '900', fontSize: 14 },
  sub: { color: C.sub, fontSize: 11, marginTop: 3 },
  reason: { color: C.red, fontSize: 11, marginTop: 5, lineHeight: 15 },
  proof: { width: '100%', height: 240, borderRadius: 10, backgroundColor: '#fff' },
});
