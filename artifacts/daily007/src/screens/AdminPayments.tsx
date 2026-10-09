import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Image, ScrollView, StyleSheet } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import * as Clipboard from 'expo-clipboard';
import { Api, apiError, type AdminWithdrawal, type AdminWithdrawalPayoutResult } from '../lib/api';
import { Btn, Card, C, Chip, Empty, Loading, Msg } from '../components/ui';
import { depositAmountInr, inr } from '../lib/coins';
import { ConfirmDialog, PromptDialog } from '../components/adminKit';
import { copyWithdrawalUpi, getWithdrawalUpiCopyLabel } from '../lib/withdrawal-upi-copy';

const TABS = ['pending', 'approved', 'rejected'] as const;

function withdrawalPayoutStatusLabel(status: AdminWithdrawal['payoutStatus'] | undefined): string {
  if (status === 'paid') return 'Paid';
  if (status === 'manual_payout_required') return 'Manual payout required';
  return 'Status unavailable';
}

export default function AdminPayments() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const okMsgTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ id: string; kind: string; userName: string } | null>(null);
  const [rejectBusy, setRejectBusy] = useState(false);
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  const [proofLoading, setProofLoading] = useState<string | null>(null);
  const [payoutTarget, setPayoutTarget] = useState<string | null>(null);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [coinToMoneyRate, setCoinToMoneyRate] = useState(1);
  const [copiedUpiId, setCopiedUpiId] = useState<string | null>(null);
  const [copyAnnouncementSequence, setCopyAnnouncementSequence] = useState(0);

  const [all, setAll] = useState<any[] | null>(null);

  const clearOkMsgTimeout = () => {
    if (okMsgTimeout.current !== null) clearTimeout(okMsgTimeout.current);
    okMsgTimeout.current = null;
  };
  const showOkMsg = (message: string, clearAfterMs?: number) => {
    clearOkMsgTimeout();
    setOkMsg(message);
    if (clearAfterMs !== undefined) {
      okMsgTimeout.current = setTimeout(() => {
        okMsgTimeout.current = null;
        setOkMsg('');
      }, clearAfterMs);
    }
  };

  const load = useCallback(async () => {
    try {
      const [pays, ws, settings] = await Promise.all([
        Api.adminPayments(), Api.adminWithdrawals(), Api.adminSettings(),
      ]);
      const config = settings?.settings ?? settings ?? {};
      setCoinToMoneyRate(Number(config.coinToMoneyRate) > 0 ? Number(config.coinToMoneyRate) : 1);
      setAll([
        ...(Array.isArray(pays) ? pays : []).map((p: any) => ({ ...p, kind: 'payment' })),
        ...(Array.isArray(ws) ? ws : []).map((w: any) => ({ ...w, kind: 'withdrawal' })),
      ]);
    } catch (e: any) {
      setErr(apiError(e));
      setAll((current) => current ?? []);
    }
  }, []);
  useEffect(() => { setAll(null); load(); }, [load]);
  useEffect(() => () => {
    if (okMsgTimeout.current !== null) clearTimeout(okMsgTimeout.current);
  }, []);

  const list = (all ?? []).filter((x) => x.status === tab);

  const act = async (id: string, kind: string, action: 'approve' | 'reject', userName: string) => {
    if (action === 'reject') {
      setRejectTarget({ id, kind, userName });
      return;
    }
    setErr(''); clearOkMsgTimeout(); setOkMsg(''); setBusyId(id);
    try {
      if (kind === 'withdrawal') await Api.adminWithdrawalAction(id, action);
      else await Api.adminPaymentAction(id, action);
      showOkMsg(action === 'approve'
        ? (kind === 'withdrawal' ? 'Withdrawal approved' : 'Payment approved — coins credited')
        : (kind === 'withdrawal' ? 'Withdrawal rejected — coins refunded' : 'Payment rejected'), 2500);
      await load();
    } catch (e: any) {
      const requestType = kind === 'withdrawal' ? 'withdrawal' : 'deposit';
      const actionLabel = action === 'approve' ? 'APPROVE' : 'REJECT';
      setErr(
        `Could not ${action} the ${requestType} request for ${userName || 'this player'}: ${apiError(e)}. ` +
        `The request remains in this list. Check its status, then activate ${actionLabel} for ${userName || 'this player'} to retry.`,
      );
    }
    finally { setBusyId(null); }
  };

  const reject = async (reason: string) => {
    const target = rejectTarget;
    if (!target) return;
    if (!reason.trim()) { setErr('A rejection reason is required.'); return; }
    setRejectBusy(true); setErr(''); clearOkMsgTimeout(); setOkMsg('');
    try {
      if (target.kind === 'withdrawal') await Api.adminWithdrawalAction(target.id, 'reject', reason.trim());
      else await Api.adminPaymentAction(target.id, 'reject', reason.trim());
      setRejectTarget(null);
      showOkMsg(target.kind === 'withdrawal' ? 'Withdrawal rejected — coins refunded' : 'Payment rejected');
      await load();
    } catch (e: any) {
      setRejectTarget(null);
      const requestType = target.kind === 'withdrawal' ? 'withdrawal' : 'deposit';
      setErr(
        `Could not reject the ${requestType} request for ${target.userName || 'this player'}: ${apiError(e)}. ` +
        `The request remains in this list. Check its status, then activate REJECT for ${target.userName || 'this player'} to retry.`,
      );
    }
    finally { setRejectBusy(false); }
  };

  const showProof = async (id: string) => {
    setProofLoading(id); setErr('');
    try {
      const result = await Api.adminPaymentProofUrl(id);
      setProofUrls((current) => ({ ...current, [id]: String(result?.url ?? '') }));
    } catch (e: any) {
      const request = all?.find((item) => item.kind === 'payment' && item.id === id);
      setErr(
        `Could not load the payment screenshot for ${request?.userName || 'this player'}: ${apiError(e)}. ` +
        `The request remains in this list; activate VIEW PAYMENT SCREENSHOT to retry.`,
      );
    }
    finally { setProofLoading(null); }
  };

  const markPaid = async () => {
    const targetId = payoutTarget;
    if (!targetId) return;
    const request = all?.find((item) => item.kind === 'withdrawal' && item.id === targetId);
    setPayoutBusy(true); setErr(''); clearOkMsgTimeout(); setOkMsg('');
    try {
      const payoutResult: AdminWithdrawalPayoutResult = await Api.adminMarkWithdrawalPaid(targetId);
      setAll((current) => current?.map((item) =>
        item.kind === 'withdrawal' && item.id === targetId
          ? { ...item, payoutStatus: payoutResult.payoutStatus }
          : item,
      ) ?? current);
      setPayoutTarget(null);
      showOkMsg(
        `Manual payout recorded. Payout status: ${withdrawalPayoutStatusLabel(payoutResult.payoutStatus)} ` +
        `for ${request?.userName || 'this player'}.`,
      );
      await load();
    } catch (e: any) {
      setPayoutTarget(null);
      setErr(
        `Could not record the manual payout for ${request?.userName || 'this player'}: ${apiError(e)}. ` +
        `The withdrawal remains in this list. Check its payout status before activating RECORD MANUAL PAYOUT SENT again.`,
      );
    }
    finally { setPayoutBusy(false); }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <Text style={st.h}>COIN DEPOSITS &amp; WITHDRAWALS</Text>
      <Text style={st.notice}>Payment approval is manual. Withdrawal approval does not send money automatically; arrange the payout separately.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {TABS.map((t) => <Chip key={t} testID={`admin-payment-filter-${t}`} label={t.toUpperCase()} color={tab === t ? C.neon : C.sub} onPress={() => setTab(t)} />)}
      </View>
      <Msg kind="err" text={err} accessibilityLabel={err || undefined} accessibilityLiveRegion="assertive" />
      <Msg
        kind="ok"
        text={okMsg}
        accessibilityLabel={okMsg || undefined}
        accessibilityLiveRegion="polite"
        testID="admin-payment-action-success"
      />
      <Msg
        key={`withdrawal-upi-copy-success-${copyAnnouncementSequence}`}
        kind="ok"
        text={copiedUpiId ? 'Withdrawal UPI ID copied' : ''}
        accessibilityLiveRegion="polite"
        testID="withdrawal-upi-copy-success"
      />
      {!list ? <Loading /> : list.length === 0 ? <Empty text={`No ${tab} requests.`} /> : list.map((p) => (
        <Card key={p.kind + ':' + p.id} style={{ marginBottom: 10 }}>
          <Text style={st.pName}>
            {p.kind === 'withdrawal' ? 'WITHDRAW' : 'ADD'} {p.coins ?? p.amount} coins —{' '}
            {p.kind === 'payment'
              ? depositAmountInr(Number(p.coins ?? p.amount ?? 0), p.amount, coinToMoneyRate)
              : inr(Number(p.coins ?? p.amount ?? 0), coinToMoneyRate)}
          </Text>
          <Text style={st.sub}>{p.userName || 'Player'} · User ID: {p.userId}</Text>
          {p.kind === 'withdrawal' && <Text style={st.sub}>Estimated manual payout: {inr(p.coins, coinToMoneyRate)}</Text>}
          {p.kind === 'withdrawal' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text selectable style={[st.sub, { flex: 1, minWidth: 0 }]}>
                {String(p.method || '').toLowerCase() === 'upi' ? 'UPI ID' : p.method || 'Account'}: {p.account || '—'}
              </Text>
              {String(p.method || '').toLowerCase() === 'upi' && p.account ? (
                <Btn
                  title={getWithdrawalUpiCopyLabel(String(p.id), copiedUpiId)}
                  small
                  kind="ghost"
                  accessibilityLabel="Copy withdrawal UPI ID"
                  testID={`copy-withdrawal-upi-${p.id}`}
                  onPress={() => {
                    void copyWithdrawalUpi(
                      String(p.id),
                      String(p.account),
                      Clipboard,
                      setCopiedUpiId,
                      setErr,
                      setCopyAnnouncementSequence,
                    );
                  }}
                />
              ) : null}
            </View>
          ) : <Text style={st.sub}>Paid from UPI ID: {p.payerUpiId || '—'}</Text>}
          {p.kind === 'payment' && <Text style={st.sub}>Transaction ID: {p.txnId || p.transactionId || p.reference || '—'}</Text>}
          <Text style={st.sub}>{new Date(p.createdAt).toLocaleString()}</Text>
          {p.reviewReason && <Text style={st.reason}>Review note: {p.reviewReason}</Text>}
          {p.kind === 'payment' && p.proofAvailable && (
            <View style={{ marginTop: 8 }}>
              {proofUrls[p.id]
                ? <Image source={{ uri: proofUrls[p.id] }} resizeMode="contain" style={st.proof} />
                : <Btn title="VIEW PAYMENT SCREENSHOT" small kind="ghost" loading={proofLoading === p.id} accessibilityLabel={`View payment screenshot for ${p.userName || 'player'}`} onPress={() => showProof(p.id)} />}
            </View>
          )}
          {p.kind === 'withdrawal' && p.status === 'approved' && (
            <Text
              accessible
              accessibilityLabel={`Payout status: ${withdrawalPayoutStatusLabel(p.payoutStatus)}`}
              accessibilityLiveRegion={p.payoutStatus === 'paid' ? 'polite' : 'none'}
              testID={`withdrawal-payout-status-${p.id}`}
              style={[
                st.payoutStatus,
                p.payoutStatus === 'paid'
                  ? st.payoutStatusPaid
                  : p.payoutStatus === 'manual_payout_required'
                    ? st.payoutStatusManual
                    : st.payoutStatusUnknown,
              ]}
            >
              {withdrawalPayoutStatusLabel(p.payoutStatus).toUpperCase()}
            </Text>
          )}
          {p.kind === 'withdrawal' && p.status === 'approved' && p.payoutStatus === 'manual_payout_required' && (
            <Btn title="RECORD MANUAL PAYOUT SENT" small kind="gold" loading={payoutBusy && payoutTarget === p.id} accessibilityLabel={`Record manual payout sent for ${p.userName || 'player'}`} accessibilityHint="Check payout status before retrying if an error is announced." onPress={() => setPayoutTarget(p.id)} style={{ marginTop: 10 }} />
          )}
          {tab === 'pending' && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
               <View style={{ flex: 1 }}><Btn title="APPROVE" small loading={busyId === p.id} accessibilityLabel={`Approve ${p.kind === 'withdrawal' ? 'withdrawal' : 'deposit'} request for ${p.userName || 'player'}`} accessibilityHint="If an error is announced, check this request's status before trying again." onPress={() => act(p.id, p.kind, 'approve', p.userName)} /></View>
               <View style={{ flex: 1 }}><Btn title="REJECT" small kind="danger" loading={busyId === p.id} accessibilityLabel={`Reject ${p.kind === 'withdrawal' ? 'withdrawal' : 'deposit'} request for ${p.userName || 'player'}`} accessibilityHint="If an error is announced, check this request's status before trying again." onPress={() => act(p.id, p.kind, 'reject', p.userName)} /></View>
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
  h: { color: C.text, fontSize: 20, fontWeight: '900', marginBottom: 10, letterSpacing: 0.7, fontFamily: 'Inter_700Bold' },
  notice: { color: C.gold, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  pName: { color: C.text, fontWeight: '900', fontSize: 14 },
  sub: { color: C.sub, fontSize: 11, marginTop: 3 },
  payoutStatus: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexShrink: 1,
    marginTop: 8,
    marginBottom: 2,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    borderWidth: 1,
    overflow: 'hidden',
    fontSize: 11,
    fontWeight: '900',
  },
  payoutStatusManual: {
    color: C.gold,
    backgroundColor: C.gold + '14',
    borderColor: C.gold + '66',
  },
  payoutStatusPaid: {
    color: C.green,
    backgroundColor: C.green + '14',
    borderColor: C.green + '66',
  },
  payoutStatusUnknown: {
    color: C.sub,
    backgroundColor: C.sub + '14',
    borderColor: C.sub + '66',
  },
  reason: { color: C.red, fontSize: 11, marginTop: 5, lineHeight: 15 },
  proof: { width: '100%', height: 240, borderRadius: 10, backgroundColor: '#70B8FF' },
});
