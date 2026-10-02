// Admin dashboard — real stats, quick actions, pending actions, recent activity
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
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
      <GlassCard style={st.hero}>
        <View style={{ flex: 1 }}>
          <Text style={st.heroKicker}>DAILY007  /  LIVE OPERATIONS</Text>
          <Text style={st.heroTitle}>COMMAND CENTER</Text>
          <Text style={st.heroSub}>Tournament management at a glance</Text>
        </View>
        <View style={st.heroIcon}><Feather name="crosshair" size={22} color={A.orange} /></View>
      </GlassCard>
      {/* PENDING ACTIONS */}
      {(pendingRegs > 0 || pendingPays > 0 || roomsNeeded > 0) && (
        <View style={{ marginBottom: 16 }}>
          <SectionTitle icon="alert-circle">PENDING ACTIONS</SectionTitle>
          {pendingRegs > 0 && (
            <GlassCard style={st.alert} onPress={() => go('registrations')}>
              <View style={[st.alertIcon, { backgroundColor: 'rgba(255,122,26,0.1)' }]}><Feather name="file-text" size={15} color={A.orange} /></View>
              <Text style={st.alertTxt}>{pendingRegs} registration{pendingRegs > 1 ? 's' : ''} waiting for approval</Text>
              <Feather name="chevron-right" size={16} color={A.orange} />
            </GlassCard>
          )}
          {pendingPays > 0 && (
            <GlassCard style={st.alert} onPress={() => go('payments')}>
              <View style={[st.alertIcon, { backgroundColor: 'rgba(255,75,54,0.1)' }]}><Feather name="credit-card" size={15} color={A.red} /></View>
              <Text style={st.alertTxt}>{pendingPays} payment{pendingPays > 1 ? 's' : ''} waiting for approval</Text>
              <Feather name="chevron-right" size={16} color={A.orange} />
            </GlassCard>
          )}
          {roomsNeeded > 0 && (
            <GlassCard style={st.alert} onPress={() => go('rooms')}>
              <View style={[st.alertIcon, { backgroundColor: 'rgba(77,163,255,0.1)' }]}><Feather name="key" size={15} color={A.cyan} /></View>
              <Text style={st.alertTxt}>{roomsNeeded} tournament{roomsNeeded > 1 ? 's' : ''} need room details</Text>
              <Feather name="chevron-right" size={16} color={A.orange} />
            </GlassCard>
          )}
        </View>
      )}

      {/* STATS */}
      <SectionTitle icon="bar-chart-2">OVERVIEW</SectionTitle>
      <View style={st.statGrid}>
        <StatCard icon="users" value={s.totalUsers ?? 0} label="Total Users" tint={A.cyan} onPress={() => go('users')} />
        <StatCard icon="award" value={s.activeTournaments ?? 0} label="Active Tournaments" tint={A.gold} onPress={() => go('tournaments')} />
        <StatCard icon="clock" value={pendingRegs} label="Pending Regs" tint={A.orange} onPress={() => go('registrations')} />
        <StatCard icon="check-circle" value={s.approvedRegistrations ?? 0} label="Approved Regs" tint={A.green} onPress={() => go('registrations')} />
        <StatCard icon="x-circle" value={s.rejectedRegistrations ?? 0} label="Rejected Regs" tint={A.danger} onPress={() => go('registrations')} />
        <StatCard icon="credit-card" value={pendingPays} label="Pending Payments" tint={A.red} onPress={() => go('payments')} />
        <StatCard icon="flag" value={s.completedTournaments ?? 0} label="Completed" tint={A.cyan} onPress={() => go('results')} />
        <StatCard icon="dollar-sign" value={s.coinsDistributed ?? 0} label="Coins Distributed" tint={A.gold} onPress={() => go('wallet')} />
        <StatCard icon="database" value={s.coinsInWallets ?? 0} label="Coins in Wallets" tint={A.gold} onPress={() => go('wallet')} />
        <StatCard icon="gift" value={'₹' + (s.prizeDistributed ?? 0)} label="Prize Distributed" tint={A.green} onPress={() => go('results')} />
        <StatCard icon="calendar" value={s.todayRegistrations ?? 0} label="Today's Regs" tint={A.cyan} onPress={() => go('registrations')} trend={s.todayRegistrations ? '+today' : undefined} />
        <StatCard icon="trending-up" value={'₹' + (s.todayRevenue ?? 0)} label="Today's Revenue" tint={A.green} onPress={() => go('payments')} trend={s.todayRevenue ? '+today' : undefined} />
      </View>

      {/* QUICK ACTIONS */}
      <View style={{ marginTop: 18 }}>
        <SectionTitle icon="zap">QUICK ACTIONS</SectionTitle>
        <View style={st.qaGrid}>
          {[
            { icon: 'plus', label: 'Create Tournament', go: 'tournaments' },
            { icon: 'file-text', label: 'Manage Registrations', go: 'registrations' },
            { icon: 'credit-card', label: 'Approve Payments', go: 'payments' },
            { icon: 'key', label: 'Publish Room', go: 'rooms' },
            { icon: 'award', label: 'Enter Results', go: 'results' },
            { icon: 'gift', label: 'Distribute Prize', go: 'results' },
            { icon: 'users', label: 'Manage Users', go: 'users' },
            { icon: 'bell', label: 'Send Notification', go: 'notifications' },
          ].map((q) => (
            <GlassCard key={q.label} style={st.qa} onPress={() => go(q.go)}>
              <View style={st.qaIcon}><Feather name={q.icon as keyof typeof Feather.glyphMap} size={15} color={A.orange} /></View>
              <Text style={st.qaTxt} numberOfLines={2}>{q.label}</Text>
            </GlassCard>
          ))}
        </View>
      </View>

      {/* RECENT ACTIVITY */}
      <View style={{ marginTop: 18 }}>
        <SectionTitle icon="activity">RECENT ACTIVITY</SectionTitle>
        {activity.length === 0 ? <Empty text="No activity yet" /> : activity.slice(0, 8).map((a, i) => (
          <GlassCard key={i} style={{ marginBottom: 8, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={st.activityIcon}><Feather name="activity" size={13} color={A.cyan} /></View>
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
  hero: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, padding: 16, borderColor: 'rgba(255,122,26,0.28)', backgroundColor: '#11151b', borderTopColor: A.orange },
  heroKicker: { color: A.orange, fontFamily: 'Inter_600SemiBold', fontSize: 8, letterSpacing: 1.35 },
  heroTitle: { color: A.text, fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: 0.6, marginTop: 4 },
  heroSub: { color: A.sub, fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 3 },
  heroIcon: { width: 46, height: 46, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,122,26,0.35)', backgroundColor: 'rgba(255,122,26,0.1)', alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, borderColor: 'rgba(255,122,26,0.28)', backgroundColor: 'rgba(255,122,26,0.055)', paddingVertical: 10 },
  alertIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: A.border },
  alertTxt: { flex: 1, color: A.text, fontSize: 11, fontWeight: '600', fontFamily: 'Inter_500Medium' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  qaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  qa: { flexBasis: '47.5%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, backgroundColor: 'rgba(17,22,32,0.98)' },
  qaIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: 'rgba(255,122,26,0.09)', borderWidth: 1, borderColor: 'rgba(255,122,26,0.2)' },
  qaTxt: { color: A.text, fontWeight: '700', fontSize: 10, flex: 1, fontFamily: 'Inter_500Medium' },
  activityIcon: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: 'rgba(77,163,255,0.1)' },
});