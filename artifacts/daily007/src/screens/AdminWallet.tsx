import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { Api, errMessage } from '../lib/api';
import { Card, Btn, Chip, ScreenWrap, useToast, SectionTitle, PromptDialog } from '../components/adminKit';
import { inr } from '../lib/coins';

export default function AdminWallet() {
  const toast = useToast();
  const [users, setUsers] = useState<any[] | null>(null);
  const [txns, setTxns] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{ u: any; sign: 1 | -1 } | null>(null);
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
    } catch (e) { toast(errMessage(e), 'error'); setUsers([]); setTxns([]); }
  };
  useEffect(() => { load(); }, []);

  const adjust = (u: any, sign: 1 | -1) => {
    setPrompt({ u, sign });
  };

  const confirmAdjust = async (v: string) => {
    const { u, sign } = prompt || { u: null, sign: 1 };
    if (!u) return;
    const n = parseInt(v || '0', 10);
    setPrompt(null);
    if (!n || n <= 0) return;
    setBusy(u.$id);
    try {
      await Api.adminAdjustCoins(u.$id, sign * n, sign > 0 ? 'Admin added coins' : 'Admin deducted coins');
      toast(`${sign > 0 ? '+' : '-'}${n} coins for ${u.name}`, 'success');
      load();
    } catch (e) { toast(errMessage(e), 'error'); }
    setBusy(null);
  };

  const filtered = (users ?? []).filter((u) => (u.name || '').toLowerCase().includes(q.toLowerCase()) || (u.email || '').toLowerCase().includes(q.toLowerCase()));

  return (
    <View style={{ flex: 1 }}>
    <ScreenWrap onRefresh={load}>
      <SectionTitle title="WALLET MANAGEMENT" sub={`1 coin = ${inr(1, coinToMoneyRate)} · add or deduct coins`} />
      <Card>
        <TextInput placeholder="Search user…" placeholderTextColor="#5b6478" value={q} onChangeText={setQ} style={st.search} />
      </Card>
      {users === null ? (
        <ActivityIndicator color="#ff3d3d" style={{ marginTop: 30 }} />
      ) : filtered.length === 0 ? (
        <Card><Text style={st.empty}>No users found.</Text></Card>
      ) : filtered.map((u) => (
        <Card key={u.$id}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={st.name}>{u.name}</Text>
              <Text style={st.sub}>{u.email}</Text>
            </View>
            <Text style={st.coins}>{u.coins ?? 0} 🪙</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1 }}><Btn title="+ ADD" onPress={() => adjust(u, 1)} loading={busy === u.$id} /></View>
            <View style={{ flex: 1 }}><Btn title="− DEDUCT" kind="ghost" onPress={() => adjust(u, -1)} loading={busy === u.$id} /></View>
          </View>
        </Card>
      ))}
      <SectionTitle title="RECENT TRANSACTIONS" />
      {(txns ?? []).slice(0, 20).map((t) => (
        <Card key={t.$id}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: '#e6e9ef', fontSize: 12.5, fontWeight: '700' }}>{t.title || t.note || 'Transaction'}</Text>
            <Text style={{ color: Number(t.coins || 0) >= 0 ? '#22c55e' : '#ff3d3d', fontWeight: '900' }}>
              {Number(t.coins || 0) >= 0 ? '+' : ''}{t.coins} 🪙
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
    </View>
  );
}

const st = StyleSheet.create({
  search: { backgroundColor: '#0d1326', borderRadius: 10, color: '#e6e9ef', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#232c47' },
  name: { color: '#e6e9ef', fontWeight: '900', fontSize: 14 },
  sub: { color: '#5b6478', fontSize: 11, marginTop: 2 },
  coins: { color: '#FFC107', fontWeight: '900', fontSize: 15 },
  empty: { color: '#5b6478', textAlign: 'center', paddingVertical: 10 },
});