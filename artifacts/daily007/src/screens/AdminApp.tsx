// Admin shell — premium header + bottom nav hosting all admin screens
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image } from 'react-native';
import { Api, apiError, User } from '../lib/api';
import { useApp } from '../App';
import { A, AdminToastHost, Loading } from '../components/adminKit';
import AdminDashboard from './AdminDashboard';
import AdminTournaments from './AdminTournaments';
import AdminRegs from './AdminRegs';
import AdminPayments from './AdminPayments';
import AdminWallet from './AdminWallet';
import AdminRooms from './AdminRooms';
import AdminResults from './AdminResults';
import AdminUsers from './AdminUsers';
import AdminNotifications from './AdminNotifications';
import AdminSettings from './AdminSettings';
import AdminEarnTasks from './AdminEarnTasks';
import logoImg from '../assets/logo.jpg';

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: '📊' },
  { key: 'tournaments', label: 'Tournaments', icon: '🏆' },
  { key: 'registrations', label: 'Regs', icon: '📝' },
  { key: 'payments', label: 'Payments', icon: '💳' },
  { key: 'wallet', label: 'Wallet', icon: '🪙' },
  { key: 'earnTasks', label: 'Earn', icon: 'YT' },
  { key: 'rooms', label: 'Rooms', icon: '🚪' },
  { key: 'results', label: 'Results', icon: '🥇' },
  { key: 'users', label: 'Users', icon: '👥' },
  { key: 'notifications', label: 'Notify', icon: '🔔' },
  { key: 'settings', label: 'Settings', icon: '⚙️' },
];

export default function AdminApp({ onLogout: onLogoutProp }: { onLogout?: () => void }) {
  const { logout: ctxLogout } = useApp();
  const onLogout = onLogoutProp || ctxLogout;
  const [screen, setScreen] = useState('dashboard');
  const [user, setUser] = useState<User | null>(null);
  const [err, setErr] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { Api.me().then(setUser).catch((e) => setErr(apiError(e))); }, []);

  if (err) return <View style={st.center}><Text style={{ color: '#fca5a5' }}>{err}</Text></View>;
  if (!user) return <Loading />;

  const Screen: any = {
    dashboard: AdminDashboard, tournaments: AdminTournaments, registrations: AdminRegs,
    payments: AdminPayments, wallet: AdminWallet, earnTasks: AdminEarnTasks, rooms: AdminRooms, results: AdminResults,
    users: AdminUsers, notifications: AdminNotifications, settings: AdminSettings,
  }[screen] || AdminDashboard;

  return (
    <AdminToastHost>
      <View style={{ flex: 1, backgroundColor: A.bg }}>
        {/* HEADER */}
        <View style={st.header}>
          <Image source={logoImg} style={st.logo} resizeMode="cover" />
          <View style={{ flex: 1 }}>
            <Text style={st.title}>FREEFIRE <Text style={{ color: A.red }}>DAILY007</Text></Text>
            <Text style={st.sub}>ADMIN DASHBOARD</Text>
          </View>
          <Pressable onPress={() => setRefreshKey((k) => k + 1)} style={st.hBtn}><Text style={{ fontSize: 15 }}>🔄</Text></Pressable>
          <Pressable onPress={onLogout} style={st.hBtn}><Text style={{ fontSize: 15 }}>⏻</Text></Pressable>
        </View>
        <View style={st.adminRow}>
          <View style={st.badge}><Text style={{ fontSize: 12 }}>🛡️</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={st.adminName}>{user.name || 'Admin'}</Text>
            <Text style={st.adminMail}>{user.email}</Text>
          </View>
          <View style={st.liveBadge}><Text style={st.liveTxt}>● LIVE</Text></View>
          <Pressable onPress={onLogout} style={st.logoutBtn}>
            <Text style={st.logoutTxt}>⏻ LOGOUT</Text>
          </Pressable>
        </View>

        <View style={{ flex: 1 }} key={refreshKey}>
          <Screen go={setScreen} onLogout={onLogout} />
        </View>

        {/* BOTTOM NAV */}
        <View style={st.navWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.nav}>
            {NAV.map((n) => {
              const active = screen === n.key;
              return (
                <Pressable key={n.key} onPress={() => setScreen(n.key)} style={[st.navItem, active && st.navActive]}>
                  <Text style={[st.navIcon, active && { opacity: 1 }]}>{n.icon}</Text>
                  <Text style={[st.navLabel, active && { color: A.red }]}>{n.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </AdminToastHost>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, backgroundColor: A.bg, alignItems: 'center', justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, backgroundColor: 'rgba(10,14,26,0.9)', borderBottomWidth: 1, borderBottomColor: A.border },
  logo: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: A.red + '66' },
  title: { color: A.text, fontWeight: '900', fontSize: 14, letterSpacing: 0.5 },
  sub: { color: A.red, fontSize: 9, fontWeight: '900', letterSpacing: 2, marginTop: 1 },
  hBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: A.border, alignItems: 'center', justifyContent: 'center' },
  adminRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(255,45,85,0.05)', borderBottomWidth: 1, borderBottomColor: A.border },
  badge: { width: 30, height: 30, borderRadius: 15, backgroundColor: A.redSoft, borderWidth: 1, borderColor: A.red + '55', alignItems: 'center', justifyContent: 'center' },
  adminName: { color: A.text, fontWeight: '800', fontSize: 12 },
  adminMail: { color: A.sub, fontSize: 10 },
  liveBadge: { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.4)', borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  liveTxt: { color: A.green, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  logoutBtn: { backgroundColor: A.redSoft, borderWidth: 1, borderColor: A.red + '66', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  logoutTxt: { color: A.red, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  navWrap: { borderTopWidth: 1, borderTopColor: A.border, backgroundColor: 'rgba(10,14,26,0.98)' },
  nav: { paddingHorizontal: 8, paddingVertical: 6, gap: 4 },
  navItem: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, minWidth: 64 },
  navActive: { backgroundColor: A.redSoft, borderWidth: 1, borderColor: A.red + '55' },
  navIcon: { fontSize: 16, opacity: 0.55 },
  navLabel: { color: A.sub, fontSize: 8.5, fontWeight: '800', marginTop: 2, letterSpacing: 0.3 },
});