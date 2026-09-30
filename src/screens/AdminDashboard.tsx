// Admin dashboard — real stats, quick actions, pending actions, recent activity
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { Api, apiError } from '../lib/api';
import { A, GlassCard, Loading, SectionTitle, StatCard, Empty, useAdminToast } from '../components/adminKit';

export default function AdminDashboard({ go }: { go: (s: string) => void }) {
  const toast = useAdminToast();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setErr('');
      const d: any = await Api.adminStats();
      setData(d);
    } catch (e) { setErr(apiError(e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (err) return <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}><Empty text={err} /></ScrollView>;
  if (!data) return <Loading />;

  const s = data.stats || {};
  const pendingRegs = s.pendingRegistrations ?? 0;
  const pendingPays = s.pendingPayments ?? 0;
  const roomsNeeded = s.tournamentsNeedingRoom ?? 0;
  const activity: any[] = data.activity || [];

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={A.red} />}>
      {/* PENDING ACTIONS */}
      {(pendingRegs > 0 || pendingPays > 0 || roomsNeeded > 0) && (
        <View style={{ marginBottom: 16 }}>
          <SectionTitle>⚡ PENDING ACTIONS</SectionTitle>
          {pendingRegs > 0 && (
            <GlassCard style={st.alert} onPress={() => go('registrations')}>
              <Text style={{ fontSize: 16 }}>📝</Text>
              <Text style={st.alertTxt}>{pendingRegs} registration{pendingRegs > 1 ? 's' : ''} waiting for approval</Text>
              <Text style={st.alertArrow}>›</Text>
            </GlassCard>
          )}
          {pendingPays > 0 && (
            <GlassCard style={st.alert} onPress={() => go('payments')}>
              <Text style={{ fontSize: 16 }}>💳</Text>
              <Text style={st.alertTxt}>{pendingPays} payment{pendingPays > 1 ? 's' : ''} waiting for approval</Text>
              <Text style={st.alertArrow}>›</Text>
            </GlassCard>
          )}
          {roomsNeeded > 0 && (
            <GlassCard style={st.alert} onPress={() => go('rooms')}>
              <Text style={{ fontSize: 16 }}>🚪</Text>
              <Text style={st.alertTxt}>{roomsNeeded} tournament{roomsNeeded > 1 ? 's' : ''} need room details</Text>
              <Text style={st.alertArrow}>›</Text>
            </GlassCard>
          )}
        </View>
      )}

      {/* STATS */}
      <SectionTitle>📊 OVERVIEW</SectionTitle>
      <View style={st.statGrid}>
        <StatCard icon="👥" value={s.totalUsers ?? 0} label="Total Users" tint={A.cyan} onPress={() => go('users')} />
        <StatCard icon="🏆" value={s.activeTournaments ?? 0} label="Active Tournaments" tint={A.gold} onPress={() => go('tournaments')} />
        <StatCard icon="⏳" value={pendingRegs} label="Pending Regs" tint={A.orange} onPress={() => go('registrations')} />
        <StatCard icon="✅" value={s.approvedRegistrations ?? 0} label="Approved Regs" tint={A.green} onPress={() => go('registrations')} />
        <StatCard icon="❌" value={s.rejectedRegistrations ?? 0} label="Rejected Regs" tint={A.danger} onPress={() => go('registrations')} />
        <StatCard icon="💳" value={pendingPays} label="Pending Payments" tint={A.red} onPress={() => go('payments')} />
        <StatCard icon="🏁" value={s.completedTournaments ?? 0} label="Completed" tint={A.cyan} onPress={() => go('results')} />
        <StatCard icon="🪙" value={s.coinsDistributed ?? 0} label="Coins Distributed" tint={A.gold} onPress={() => go('wallet')} />
        <StatCard icon="👛" value={s.coinsInWallets ?? 0} label="Coins in Wallets" tint={A.gold} onPress={() => go('wallet')} />
        <StatCard icon="🎁" value={'₹' + (s.prizeDistributed ?? 0)} label="Prize Distributed" tint={A.green} onPress={() => go('results')} />
        <StatCard icon="📅" value={s.todayRegistrations ?? 0} label="Today's Regs" tint={A.cyan} onPress={() => go('registrations')} trend={s.todayRegistrations ? '+today' : undefined} />
        <StatCard icon="💰" value={'₹' + (s.todayRevenue ?? 0)} label="Today's Revenue" tint={A.green} onPress={() => go('payments')} trend={s.todayRevenue ? '+today' : undefined} />
      </View>

      {/* QUICK ACTIONS */}
      <View style={{ marginTop: 18 }}>
        <SectionTitle>⚡ QUICK ACTIONS</SectionTitle>
        <View style={st.qaGrid}>
          {[
            { icon: '➕', label: 'Create Tournament', go: 'tournaments' },
            { icon: '📝', label: 'Manage Registrations', go: 'registrations' },
            { icon: '💳', label: 'Approve Payments', go: 'payments' },
            { icon: '🚪', label: 'Publish Room', go: 'rooms' },
            { icon: '🥇', label: 'Enter Results', go: 'results' },
            { icon: '🎁', label: 'Distribute Prize', go: 'results' },
            { icon: '👥', label: 'Manage Users', go: 'users' },
            { icon: '🔔', label: 'Send Notification', go: 'notifications' },
          ].map((q) => (
            <GlassCard key={q.label} style={st.qa} onPress={() => go(q.go)}>
              <Text style={{ fontSize: 17 }}>{q.icon}</Text>
              <Text style={st.qaTxt} numberOfLines={2}>{q.label}</Text>
            </GlassCard>
          ))}
        </View>
      </View>

      {/* RECENT ACTIVITY */}
      <View style={{ marginTop: 18 }}>
        <SectionTitle>🕐 RECENT ACTIVITY</SectionTitle>
        {activity.length === 0 ? <Empty text="No activity yet" /> : activity.slice(0, 8).map((a, i) => (
          <GlassCard key={i} style={{ marginBottom: 8, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 14 }}>{a.icon || '•'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: A.text, fontSize: 12, fontWeight: '700' }}>{a.text}</Text>
              <Text style={{ color: A.sub, fontSize: 10 }}>{a.time}</Text>
            </View>
          </GlassCard>
        ))}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  alert: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, borderColor: A.orange + '55', backgroundColor: 'rgba(255,159,10,0.08)' },
  alertTxt: { flex: 1, color: A.text, fontSize: 12, fontWeight: '700' },
  alertArrow: { color: A.orange, fontSize: 16, fontWeight: '900' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  qaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  qa: { flexBasis: '47.5%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12 },
  qaTxt: { color: A.text, fontWeight: '800', fontSize: 11, flex: 1 },
});