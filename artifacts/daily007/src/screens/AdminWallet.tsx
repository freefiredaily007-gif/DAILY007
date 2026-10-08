import { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, ActivityIndicator, RefreshControl, useWindowDimensions } from 'react-native';
import { ReadableText as Text, ReadableTextInput as TextInput } from '../components/typography';
import { Api, errMessage, newAdminAdjustmentRequestId } from '../lib/api';
import { AdminSearchAnnouncement, Card, Btn, Chip, ScreenWrap, useToast, SectionTitle, ConfirmDialog, PromptDialog } from '../components/adminKit';
import { inr } from '../lib/coins';

type CoinAdjustment = {
  user: any;
  delta: number;
  amount: number;
  note: string;
  requestId: string;
  error?: string;
};

export default function AdminWallet() {
  const toast = useToast();
  const { fontScale } = useWindowDimensions();
  const stackUserBalance = fontScale >= 1.5;
  const [users, setUsers] = useState<any[] | null>(null);
  const [txns, setTxns] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{ u: any; sign: 1 | -1 } | null>(null);
  const [retryAdjustment, setRetryAdjustment] = useState<CoinAdjustment | null>(null);
  const [coinToMoneyRate, setCoinToMoneyRate] = useState(1);

  const load = async () => {
    try {
      const [u, t, settings] = await Promise.all([
        Api.adminUsers(), Api.adminTransactions(), Api.adminSettings(),
      ]);
      const config = settings?.settings ?? settings ?? {};
      setCoinToMoneyRate(Number(config.coinToMoneyRate) > 0 ? Number(config.coinToMoneyRate) : 1);
      setUsers(u ?? []);
      setTxns(t ?? []);
    } catch (e) {
      toast(`Could not load wallet data: ${errMessage(e)}. Pull down to refresh and retry.`, 'error');
      setUsers([]); setTxns([]);
    }
  };
  useEffect(() => { load(); }, []);

  const adjust = (u: any, sign: 1 | -1) => {
    setPrompt({ u, sign });
  };

  const submitAdjustment = async (adjustment: CoinAdjustment) => {
    if (busy === adjustment.user.$id) return;
    setBusy(adjustment.user.$id);
    try {
      await Api.adminAdjustCoins(
        adjustment.user.$id,
        adjustment.delta,
        adjustment.note,
        adjustment.requestId,
      );
      setRetryAdjustment(null);
      toast(`${adjustment.delta > 0 ? '+' : ''}${adjustment.delta} coins for ${adjustment.user.name}`, 'success');
      load();
    } catch (e) {
      const action = adjustment.delta > 0 ? 'add' : 'deduct';
      const error = errMessage(e);
      setRetryAdjustment({ ...adjustment, error });
      toast(
        `Could not ${action} ${adjustment.amount} coins for ${adjustment.user.name}: ${error}. ` +
        'Use the retry prompt to safely repeat this same request.',
        'error',
      );
    } finally {
      setBusy(null);
    }
  };

  const confirmAdjust = async (v: string) => {
    const { u, sign } = prompt || { u: null, sign: 1 };
    if (!u) return;
    const n = parseInt(v || '0', 10);
    setPrompt(null);
    if (!n || n <= 0) return;
    const delta = sign * n;
    await submitAdjustment({
      user: u,
      delta,
      amount: n,
      note: sign > 0 ? 'Admin added coins' : 'Admin deducted coins',
      requestId: newAdminAdjustmentRequestId(),
    });
  };

  const filtered = (users ?? []).filter((u) => (u.name || '').toLowerCase().includes(q.toLowerCase()) || (u.email || '').toLowerCase().includes(q.toLowerCase()));

  return (
    <View style={{ flex: 1 }}>
    <ScreenWrap onRefresh={load}>
      <SectionTitle title="WALLET MANAGEMENT" sub={`1 coin = ${inr(1, coinToMoneyRate)} · add or deduct coins`} />
      <Card>
        <TextInput
          testID="admin-wallet-user-search"
          placeholder="Search user…"
          placeholderTextColor="#5b6478"
          value={q}
          onChangeText={setQ}
          style={st.search}
        />
      </Card>
      <AdminSearchAnnouncement
        query={q}
        count={filtered.length}
        resultIds={filtered.map((u) => String(u.$id)).sort().join('|')}
        ready={users !== null}
      />
      {users === null ? (
        <ActivityIndicator color="#ff3d3d" style={{ marginTop: 30 }} />
      ) : filtered.length === 0 ? (
        <Card><Text style={st.empty}>No users found.</Text></Card>
      ) : filtered.map((u) => (
        <Card key={u.$id}>
          <View style={{
            flexDirection: stackUserBalance ? 'column' : 'row',
            alignItems: stackUserBalance ? 'stretch' : 'center',
            gap: stackUserBalance ? 4 : 0,
          }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.name}>{u.name}</Text>
              <Text style={st.sub}>{u.email}</Text>
            </View>
            <Text style={[st.coins, stackUserBalance && { alignSelf: 'flex-start' }]}>{u.coins ?? 0} COINS</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1 }}><Btn title="+ ADD" accessibilityLabel={`Add coins to ${u.name}`} accessibilityHint="If an error is announced, use the retry prompt to safely repeat the same adjustment." onPress={() => adjust(u, 1)} loading={busy === u.$id} /></View>
            <View style={{ flex: 1 }}><Btn title="− DEDUCT" kind="ghost" accessibilityLabel={`Deduct coins from ${u.name}`} accessibilityHint="If an error is announced, use the retry prompt to safely repeat the same adjustment." onPress={() => adjust(u, -1)} loading={busy === u.$id} /></View>
          </View>
        </Card>
      ))}
      <SectionTitle title="RECENT TRANSACTIONS" />
      {(txns ?? []).slice(0, 20).map((t) => (
        <Card key={t.$id}>
          <View style={{
            flexDirection: stackUserBalance ? 'column' : 'row',
            alignItems: stackUserBalance ? 'stretch' : 'center',
            gap: stackUserBalance ? 4 : 0,
          }}>
            <Text style={{ flex: 1, minWidth: 0, color: '#e6e9ef', fontSize: 12.5, fontWeight: '700' }}>{t.title || t.note || 'Transaction'}</Text>
            <Text style={[
              { color: Number(t.coins || 0) >= 0 ? '#22c55e' : '#ff3d3d', fontWeight: '900' },
              stackUserBalance && { alignSelf: 'flex-start' },
            ]}>
              {Number(t.coins || 0) >= 0 ? '+' : ''}{t.coins} COINS
            </Text>
          </View>
          <Text style={st.sub}>{String(t.createdAt || '').slice(0, 16).replace('T', ' ')}</Text>
        </Card>
      ))}
    </ScreenWrap>
      <PromptDialog
        visible={!!prompt}
        title={prompt?.sign === 1 ? 'Add coins' : 'Deduct coins'}
        message={`Enter amount for ${prompt?.u?.name || ''} (1 coin = ${inr(1, coinToMoneyRate)})`}
        keyboardType="number-pad"
        confirmTitle={prompt?.sign === 1 ? 'ADD' : 'DEDUCT'}
        onCancel={() => setPrompt(null)}
        onSubmit={confirmAdjust}
      />
      <ConfirmDialog
        visible={retryAdjustment !== null}
        title="Adjustment not confirmed"
        message={retryAdjustment
          ? `The server may already have applied this adjustment. Retry the same request safely, or dismiss it before starting a separate adjustment.${retryAdjustment.error ? ` Last response: ${retryAdjustment.error}` : ''}`
          : ''}
        confirmTitle="RETRY SAME REQUEST"
        onCancel={() => setRetryAdjustment(null)}
        onConfirm={() => { if (retryAdjustment) void submitAdjustment(retryAdjustment); }}
        cancelTestID="dismiss-wallet-coin-adjustment-retry"
        confirmTestID="retry-wallet-coin-adjustment"
        confirmAccessibilityLabel={retryAdjustment
          ? `Retry the same ${retryAdjustment.amount}-coin adjustment for ${retryAdjustment.user.name}`
          : undefined}
        confirmAccessibilityHint="This uses the same request ID so the balance and transaction are not changed twice."
      />
    </View>
  );
}

const st = StyleSheet.create({
  search: { minHeight: 48, backgroundColor: '#0d1326', borderRadius: 10, color: '#e6e9ef', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#232c47' },
  name: { color: '#e6e9ef', fontWeight: '900', fontSize: 14 },
  sub: { color: '#5b6478', fontSize: 11, marginTop: 2 },
  coins: { color: '#FFC107', fontWeight: '900', fontSize: 15 },
  empty: { color: '#5b6478', textAlign: 'center', paddingVertical: 10 },
});