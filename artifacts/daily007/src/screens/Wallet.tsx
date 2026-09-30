// Wallet — balance, add coins (manual input + UPI payment), withdraw coins (min 100), transaction history
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Modal, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Api, apiError } from '../lib/api';
import { useApp } from '../App';
import { C, Card, Btn, Empty, Loading, Msg, Input, SectionTitle, GCard, glow } from '../components/ui';
import { COIN_RATE_TEXT, inr } from '../lib/coins';

const MIN_WITHDRAW = 100;

export default function Wallet() {
  const { user, refresh } = useApp();
  const [txns, setTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [showSheet, setShowSheet] = useState(false);
  const [tab, setTab] = useState<'add' | 'withdraw'>('add');
  const [amount, setAmount] = useState('');
  const [txnId, setTxnId] = useState('');
  const [account, setAccount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [hasPendingWithdraw, setHasPendingWithdraw] = useState(false);
  const [paymentUpi, setPaymentUpi] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const [data, pays, wds, settings] = await Promise.all([
        Api.transactions(),
        Api.myPayments().catch(() => []),
        Api.myWithdrawals().catch(() => []),
        Api.settings().catch(() => null),
      ]);
      setPaymentUpi(String(settings?.settings?.upiId ?? settings?.upiId ?? settings?.upi_id ?? '').trim());
      const paysArr = Array.isArray(pays) ? pays : [];
      const wdsArr = Array.isArray(wds) ? wds : [];
      setHasPending(paysArr.some((p: any) => p.status === 'pending'));
      setHasPendingWithdraw(wdsArr.some((w: any) => w.status === 'pending'));
      const pendingPays = paysArr
        .filter((p: any) => p.status === 'pending')
        .map((p: any) => ({ id: 'pay-' + p.id, description: 'Add coins — under verification', amount: Number(p.amount || 0), createdAt: p.createdAt, pending: true }));
      const pendingWds = wdsArr
        .filter((w: any) => w.status === 'pending')
        .map((w: any) => ({ id: 'wd-' + w.id, description: 'Withdrawal — under verification', amount: -Number(w.coins || 0), createdAt: w.createdAt, pending: true }));
      const merged = [...pendingPays, ...pendingWds, ...(Array.isArray(data) ? data : [])];
      setTxns(merged);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openSheet = (t: 'add' | 'withdraw') => {
    if (t === 'add' && !paymentUpi) {
      setError('Coin purchases are unavailable: the administrator has not configured a payment UPI ID yet.');
      return;
    }
    setOk(''); setError(''); setAmount(''); setTxnId(''); setAccount('');
    setTab(t); setShowSheet(true);
  };

  const coins = Math.floor(Number(amount) || 0);

  const submitAdd = async () => {
    if (!paymentUpi) { setError('Coin purchases are unavailable until the administrator configures a payment UPI ID.'); return; }
    if (!coins || coins <= 0) { setError('Enter the number of coins you want to add.'); return; }
    if (!txnId.trim()) { setError('Please enter the transaction ID of your payment.'); return; }
    setSubmitting(true); setError('');
    try {
      await Api.createPayment({ coins, amount: coins, txnId: txnId.trim(), reference: txnId.trim() } as any);
      setOk('Payment request submitted! Your request is currently under verification. Coins will be credited once approved by the admin.');
      setShowSheet(false); setAmount(''); setTxnId('');
      load();
    } catch (e) { setError(apiError(e)); } finally { setSubmitting(false); }
  };

  const balance = Number(user?.coins ?? 0);
  const belowMinBalance = balance < MIN_WITHDRAW;

  const submitWithdraw = async () => {
    if (belowMinBalance) { setError('Minimum balance required to withdraw is 100 coins.'); return; }
    if (!coins || coins <= 0) { setError('Enter the number of coins you want to withdraw.'); return; }
    if (coins < MIN_WITHDRAW) { setError('Minimum withdrawal amount is 100 coins.'); return; }
    if (coins > balance) { setError('You cannot withdraw more than your available balance.'); return; }
    if (!account.trim()) { setError('Enter your UPI ID / account details for the payout.'); return; }
    setSubmitting(true); setError('');
    try {
      await Api.withdrawCoins({ coins, method: 'upi', account: account.trim() });
      setOk('Withdrawal request submitted for manual admin review. Payout is not automatic.');
      setShowSheet(false); setAmount(''); setAccount('');
      load(); refresh();
    } catch (e) { setError(apiError(e)); } finally { setSubmitting(false); }
  };

  const earned = txns.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const spent = txns.filter((t) => t.amount < 0).reduce((a, t) => a + Math.abs(t.amount), 0);

  return (
    <View style={s.wrap}>
      <FlatList
        data={txns}
        keyExtractor={(t, i) => String(t.id ?? i)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.neon} />}
        contentContainerStyle={{ padding: 14, gap: 12 }}
        ListHeaderComponent={
          <>
            <GCard glowColor={C.gold} style={s.balCard}>
              <Text style={s.balLabel}>TOTAL BALANCE</Text>
              <Text style={[s.bal, glow(C.gold, 12)]}>🪙 {user?.coins ?? 0}</Text>
              <Text style={s.rateNote}>{COIN_RATE_TEXT}</Text>
              <View style={s.row}>
                <View style={s.stat}><Text style={s.statV}>+{earned}</Text><Text style={s.statL}>EARNED</Text></View>
                <View style={s.stat}><Text style={s.statV}>-{spent}</Text><Text style={s.statL}>SPENT</Text></View>
              </View>
              <View style={s.btnRow}>
                <View style={{ flex: 1 }}><Btn title="+ ADD COINS" onPress={() => openSheet('add')} disabled={!paymentUpi} /></View>
                <View style={{ flex: 1 }}><Btn title="↩ WITHDRAW" kind="gold" onPress={() => openSheet('withdraw')} /></View>
              </View>
              {!paymentUpi && <Text style={s.minWarn}>Coin purchases are disabled until an administrator configures a payment UPI ID.</Text>}
            </GCard>
            <Msg kind="ok" text={ok} />
            <Msg kind="err" text={error} />
            <SectionTitle>TRANSACTIONS</SectionTitle>
          </>
        }
        ListEmptyComponent={loading ? <Loading /> : <Empty icon="🧾" text="No transactions yet. Add coins or join a tournament!" />}
        renderItem={({ item }) => {
          const pos = item.amount > 0;
          return (
            <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={s.txTitle}>{item.description ?? (pos ? 'Coins added' : 'Tournament entry')}</Text>
                  {item.pending && <View style={s.pendingTag}><Text style={s.pendingTagText}>PENDING</Text></View>}
                </View>
                <Text style={s.txDate}>{String(item.createdAt ?? '').slice(0, 16).replace('T', ' ')}</Text>
              </View>
              <Text style={[s.txAmount, { color: pos ? C.green : C.red }]}>
                {pos ? '+' : ''}{item.amount}
              </Text>
            </Card>
          );
        }}
      />

      <Modal visible={showSheet} animationType="slide" transparent>
        <View style={s.modalBg}>
          <View style={s.modal}>
            <View style={s.tabs}>
              <PressableTab label="ADD COINS" active={tab === 'add'} onPress={() => { setTab('add'); setError(''); }} />
              <PressableTab label="WITHDRAW" active={tab === 'withdraw'} onPress={() => { setTab('withdraw'); setError(''); }} />
            </View>

            {tab === 'add' ? (
              <>
                {!paymentUpi ? (
                  <Text style={s.minWarn}>Coin purchases are disabled because no payment UPI ID is configured. Contact the administrator.</Text>
                ) : (
                  <>
                    <Text style={s.mSub}>Pay manually using the configured UPI ID, then submit your transaction reference. Coin credit requires admin review.</Text>
                    <Text style={s.mUpi}>UPI ID: <Text style={s.mUpiV}>{paymentUpi}</Text></Text>
                    <Input placeholder="Enter coins (e.g. 250)" value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" />
                    {coins > 0 && <Text style={s.amountHint}>You pay {inr(coins)} for {coins} coins</Text>}
                    <Input placeholder="Transaction ID / reference" value={txnId} onChangeText={setTxnId} />
                  </>
                )}
                <Btn
                  title={hasPending ? 'PENDING' : `ADD COINS${coins > 0 ? ` (${inr(coins)})` : ''}`}
                  onPress={submitAdd}
                  loading={submitting}
                  disabled={hasPending || !paymentUpi}
                />
                {hasPending && <Text style={s.pendingNote}>A previous request is under verification. Coins will be credited once approved by the admin.</Text>}
              </>
            ) : (
              <>
                <Text style={s.mSub}>Minimum withdrawal is {MIN_WITHDRAW} coins. Enter your payout details below. Requests are manually reviewed; payouts are not automatic.</Text>
                <Input placeholder={`Enter coins (min ${MIN_WITHDRAW})`} value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" />
                {belowMinBalance && <Text style={s.minWarn}>Minimum balance required to withdraw is 100 coins.</Text>}
                {coins > 0 && coins < MIN_WITHDRAW && <Text style={s.minWarn}>Minimum withdrawal amount is 100 coins.</Text>}
                {coins > balance && <Text style={s.minWarn}>You cannot withdraw more than your available balance.</Text>}
                {coins >= MIN_WITHDRAW && coins <= balance && <Text style={s.amountHint}>You receive {inr(coins)}</Text>}
                <Input placeholder="UPI ID" value={account} onChangeText={setAccount} />
                <Btn
                  title={hasPendingWithdraw ? 'PENDING' : `WITHDRAW${coins >= MIN_WITHDRAW && coins <= balance ? ` (${coins} 🪙)` : ''}`}
                  kind="gold"
                  onPress={submitWithdraw}
                  loading={submitting}
                  disabled={hasPendingWithdraw || belowMinBalance}
                />
                {hasPendingWithdraw && <Text style={s.pendingNote}>Your withdrawal request is pending manual review. Approval does not mean an automatic payout.</Text>}
              </>
            )}
            <View style={{ height: 8 }} />
            <Btn title="CLOSE" kind="ghost" onPress={() => { setShowSheet(false); setError(''); }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PressableTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.tab, active && s.tabActive]}>
      <Text style={[s.tabText, active && s.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  balCard: { alignItems: 'center', borderWidth: 1, borderColor: C.gold + '44' },
  balLabel: { color: C.sub, fontSize: 11, letterSpacing: 2, fontWeight: '800' },
  bal: { color: C.gold, fontSize: 40, fontWeight: '900', marginVertical: 8 },
  row: { flexDirection: 'row', gap: 12, alignSelf: 'stretch', marginBottom: 14 },
  stat: { flex: 1, backgroundColor: C.bg2, borderRadius: 10, padding: 10, alignItems: 'center' },
  statV: { color: C.text, fontWeight: '900', fontSize: 16 },
  statL: { color: C.sub, fontSize: 10, letterSpacing: 1, marginTop: 2 },
  btnRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  txTitle: { color: C.text, fontWeight: '700', fontSize: 14 },
  txDate: { color: C.dim, fontSize: 11, marginTop: 3 },
  txAmount: { fontWeight: '900', fontSize: 16 },
  modalBg: { flex: 1, backgroundColor: '#000a', justifyContent: 'flex-end' },
  modal: { backgroundColor: C.bg2, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '85%' },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: 'center', backgroundColor: C.bg },
  tabActive: { borderColor: C.gold, backgroundColor: C.gold + '22' },
  tabText: { color: C.sub, fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },
  tabTextActive: { color: C.gold },
  mSub: { color: C.sub, fontSize: 13, marginBottom: 10, lineHeight: 19 },
  mUpi: { color: C.text, fontWeight: '800', marginBottom: 12 },
  mUpiV: { color: C.gold },
  amountHint: { color: C.green, fontSize: 12, fontWeight: '700', marginTop: -6, marginBottom: 8 },
  minWarn: { color: C.red, fontSize: 12, fontWeight: '700', marginTop: -6, marginBottom: 8 },
  rateNote: { color: C.sub, fontSize: 11, marginBottom: 10, letterSpacing: 0.5 },
  pendingTag: { backgroundColor: C.gold + '22', borderColor: C.gold, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  pendingTagText: { color: C.gold, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  pendingNote: { color: C.gold, fontSize: 11, marginTop: 8, lineHeight: 15, textAlign: 'center' },
});