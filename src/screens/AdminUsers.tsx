import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Alert, ActivityIndicator } from 'react-native';
import { Api, errMessage } from '../lib/api';
import { Card, Btn, ScreenWrap, useToast, SectionTitle } from '../components/adminKit';

export default function AdminUsers() {
  const toast = useToast();
  const [users, setUsers] = useState<any[] | null>(null);
  const [regs, setRegs] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const [u, r] = await Promise.all([Api.adminUsers(), Api.adminRegistrations()]);
      setUsers(u ?? []);
      setRegs(r ?? []);
    } catch (e) { toast(errMessage(e), 'error'); setUsers([]); setRegs([]); }
  };
  useEffect(() => { load(); }, []);

  const toggleBlock = (u: any) => {
    const block = u.status !== 'blocked';
    Alert.alert(block ? 'Block user?' : 'Unblock user?', u.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: block ? 'Block' : 'Unblock', style: 'destructive', onPress: async () => {
        setBusy(u.$id);
        try { await Api.adminSetUser(u.$id, { status: block ? 'blocked' : 'active' }); toast(`${u.name} ${block ? 'blocked' : 'unblocked'}`, 'success'); load(); }
        catch (e) { toast(errMessage(e), 'error'); }
        setBusy(null);
      } },
    ]);
  };

  const adjust = (u: any, sign: 1 | -1) => {
    Alert.prompt(sign > 0 ? 'Add coins' : 'Deduct coins', `Enter amount for ${u.name}`, async (v: string) => {
      const n = parseInt(v || '0', 10);
      if (!n || n <= 0) return;
      setBusy(u.$id);
      try { await Api.adminAdjustCoins(u.$id, sign * n, sign > 0 ? 'Admin added coins' : 'Admin deducted coins'); toast('Coins updated', 'success'); load(); }
      catch (e) { toast(errMessage(e), 'error'); }
      setBusy(null);
    });
  };

  const filtered = (users ?? []).filter((u) => (u.name || '').toLowerCase().includes(q.toLowerCase()) || (u.email || '').toLowerCase().includes(q.toLowerCase()));

  return (
    <ScreenWrap onRefresh={load}>
      <SectionTitle title="USER MANAGEMENT" sub={`${filtered.length} users`} />
      <Card>
        <TextInput placeholder="Search name or email…" placeholderTextColor="#5b6478" value={q} onChangeText={setQ} style={st.search} />
      </Card>
      {users === null ? (
        <ActivityIndicator color="#ff3d3d" style={{ marginTop: 30 }} />
      ) : filtered.map((u) => {
        const mine = (regs ?? []).filter((g) => g.userId === u.$id);
        const approved = mine.filter((g) => g.status === 'approved').length;
        const blocked = u.status === 'blocked';
        return (
          <Card key={u.$id}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={st.name}>{u.name} {blocked && <Text style={{ color: '#ff3d3d', fontSize: 10 }}>· BLOCKED</Text>}</Text>
                <Text style={st.sub}>{u.email}</Text>
                <Text style={st.sub}>Joined {String(u.createdAt || '').slice(0, 10)}</Text>
              </View>
              <Text style={st.coins}>{u.coins ?? 0} 🪙</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 14, marginTop: 8 }}>
              <Text style={st.stat}>🎮 {mine.length} joined</Text>
              <Text style={st.stat}>✓ {approved} approved</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <View style={{ flex: 1 }}><Btn title="+ COINS" onPress={() => adjust(u, 1)} loading={busy === u.$id} /></View>
              <View style={{ flex: 1 }}><Btn title="− COINS" kind="ghost" onPress={() => adjust(u, -1)} loading={busy === u.$id} /></View>
              <View style={{ flex: 1 }}><Btn title={blocked ? 'UNBLOCK' : 'BLOCK'} kind="danger" onPress={() => toggleBlock(u)} loading={busy === u.$id} /></View>
            </View>
          </Card>
        );
      })}
    </ScreenWrap>
  );
}

const st = StyleSheet.create({
  search: { backgroundColor: '#0d1326', borderRadius: 10, color: '#e6e9ef', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#232c47' },
  name: { color: '#e6e9ef', fontWeight: '900', fontSize: 14 },
  sub: { color: '#5b6478', fontSize: 11, marginTop: 2 },
  coins: { color: '#FFC107', fontWeight: '900', fontSize: 15 },
  stat: { color: '#9aa3b2', fontSize: 11, fontWeight: '700' },
});