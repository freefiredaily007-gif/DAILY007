// Admin shell — premium header + bottom nav hosting all admin screens
import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView, Image } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { Feather } from '@expo/vector-icons';
import { Api, apiError, User } from '../lib/api';
import { useApp } from '../App';
import { A, AdminToastHost, Loading } from '../components/adminKit';
import { AdminUiProvider } from '../components/ui';
import AdminDashboard from './AdminDashboard';
import AdminTournaments from './AdminTournaments';
import AdminRegs from './AdminRegs';
import AdminPayments from './AdminPayments';
import AdminWallet from './AdminWallet';
import AdminUsers from './AdminUsers';
import AdminNotifications from './AdminNotifications';
import AdminSettings from './AdminSettings';
import AdminEarnTasks from './AdminEarnTasks';
import AdminVideos from './AdminVideos';
import AdminLeaderboards from './AdminLeaderboards';
import logoImg from '../assets/logo.jpg';

const NAV: { key: string; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { key: 'leaderboards', label: 'Rewards', icon: 'award' },
  { key: 'tournaments', label: 'Tournaments', icon: 'award' },
  { key: 'registrations', label: 'Regs', icon: 'file-text' },
  { key: 'payments', label: 'Payments', icon: 'credit-card' },
  { key: 'wallet', label: 'Wallet', icon: 'database' },
  { key: 'earnTasks', label: 'Earn', icon: 'youtube' },
  { key: 'videos', label: 'Videos', icon: 'video' },
  { key: 'users', label: 'Users', icon: 'users' },
  { key: 'notifications', label: 'Notify', icon: 'bell' },
  { key: 'settings', label: 'Settings', icon: 'sliders' },
];
// Tournament Admins use the tournament cards for room and result actions.
const TOURNAMENT_ADMIN_SCREENS = new Set(['tournaments', 'registrations']);

export default function AdminApp({ onLogout: onLogoutProp }: { onLogout?: () => void }) {
  const { logout: ctxLogout } = useApp();
  const onLogout = onLogoutProp || ctxLogout;
  const [screen, setScreen] = useState('dashboard');
  const [user, setUser] = useState<User | null>(null);
  const [err, setErr] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const navScrollRef = useRef<ScrollView | null>(null);
  const navItemOffsets = useRef<Record<string, number>>({});
  const navSelection = user?.role === 'tournament_admin' && !TOURNAMENT_ADMIN_SCREENS.has(screen)
    ? 'tournaments'
    : screen;

  useEffect(() => { Api.me().then(setUser).catch((e) => setErr(apiError(e))); }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const targetX = navItemOffsets.current[navSelection];
      if (targetX !== undefined) {
        navScrollRef.current?.scrollTo({ x: Math.max(0, targetX - 8), animated: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [navSelection]);

  if (err) return <View style={st.center}><Text style={{ color: '#fca5a5' }}>{err}</Text></View>;
  if (!user) return <Loading />;

  const tournamentOnly = user.role === 'tournament_admin';
  const activeScreen = tournamentOnly && !TOURNAMENT_ADMIN_SCREENS.has(screen) ? 'tournaments' : screen;
  const visibleNav = tournamentOnly ? NAV.filter((item) => TOURNAMENT_ADMIN_SCREENS.has(item.key)) : NAV;
  const navigate = (next: string) => {
    if (!tournamentOnly || TOURNAMENT_ADMIN_SCREENS.has(next)) setScreen(next);
  };
  const Screen: any = {
    dashboard: AdminDashboard, leaderboards: AdminLeaderboards, tournaments: AdminTournaments, registrations: AdminRegs,
    payments: AdminPayments, wallet: AdminWallet, earnTasks: AdminEarnTasks, videos: AdminVideos,
    users: AdminUsers, notifications: AdminNotifications, settings: AdminSettings,
  }[activeScreen] || AdminDashboard;

  return (
    <AdminUiProvider>
      <AdminToastHost>
        <View style={st.shell}>
        {/* HEADER */}
        <View style={st.header}>
          <View style={st.logoFrame}>
            <Image source={logoImg} style={st.logo} resizeMode="cover" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.kicker}>FREE FIRE  /  ADMIN OPS</Text>
            <Text style={st.title}>DAILY<Text style={{ color: A.orange }}>007</Text></Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh admin screen" onPress={() => setRefreshKey((k) => k + 1)} style={st.hBtn}>
            <Feather name="refresh-cw" size={16} color={A.gold} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Log out" onPress={onLogout} style={st.hBtn}>
            <Feather name="log-out" size={16} color={A.sub} />
          </Pressable>
        </View>
        <View style={st.adminRow}>
          <View style={st.badge}><Feather name="shield" size={14} color={A.orange} /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.adminName}>{user.name || 'Admin'}</Text>
            <Text style={st.adminMail}>{tournamentOnly ? 'TOURNAMENT ADMIN · ' : ''}{user.email}</Text>
          </View>
          <View style={st.liveBadge}><View style={st.liveDot} /><Text style={st.liveTxt}>LIVE</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Log out" onPress={onLogout} style={st.logoutBtn}>
            <Feather name="log-out" size={12} color={A.red} />
            <Text style={st.logoutTxt}>LOGOUT</Text>
          </Pressable>
        </View>

        <View style={{ flex: 1 }} key={refreshKey}>
          <Screen
            go={navigate}
            onLogout={onLogout}
            currentUserId={user.id}
          />
        </View>

        {/* BOTTOM NAV */}
        <View style={st.navWrap}>
          <ScrollView ref={navScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.nav}>
            {visibleNav.map((n) => {
              const active = activeScreen === n.key;
              return (
                <Pressable
                  key={n.key}
                  onLayout={(event) => { navItemOffsets.current[n.key] = event.nativeEvent.layout.x; }}
                  onPress={() => navigate(n.key)}
                  style={[st.navItem, active && st.navActive]}
                >
                  <View style={[st.navIcon, active && st.navIconActive]}>
                    {active && <View style={st.navIconGlow} />}
                    <Feather name={n.icon} size={19} color={active ? A.gold : A.sub} />
                  </View>
                  <Text style={[st.navLabel, active && st.navLabelActive]}>{n.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
        </View>
      </AdminToastHost>
    </AdminUiProvider>
  );
}

const st = StyleSheet.create({
  shell: { flex: 1, backgroundColor: A.bg },
  center: { flex: 1, backgroundColor: A.bg, alignItems: 'center', justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 9, backgroundColor: '#0d1118', borderBottomWidth: 1, borderBottomColor: A.border, borderTopWidth: 2, borderTopColor: A.orange },
  logoFrame: { width: 44, height: 44, borderRadius: 14, padding: 2, borderWidth: 1, borderColor: 'rgba(255,122,26,0.65)', backgroundColor: '#15120e', shadowColor: A.orange, shadowOpacity: 0.2, shadowRadius: 9, shadowOffset: { width: 0, height: 0 }, elevation: 3 },
  logo: { width: '100%', height: '100%', borderRadius: 11 },
  kicker: { color: A.sub, fontFamily: 'Inter_600SemiBold', fontSize: 7.5, letterSpacing: 1.35, marginBottom: 2 },
  title: { color: A.text, fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: 0.8 },
  hBtn: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  adminRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(255,122,26,0.035)', borderBottomWidth: 1, borderBottomColor: A.border },
  badge: { width: 30, height: 30, borderRadius: 10, backgroundColor: 'rgba(255,122,26,0.1)', borderWidth: 1, borderColor: 'rgba(255,122,26,0.32)', alignItems: 'center', justifyContent: 'center' },
  adminName: { color: A.text, fontWeight: '700', fontSize: 11.5, fontFamily: 'Inter_600SemiBold' },
  adminMail: { color: A.sub, fontSize: 9, fontFamily: 'Inter_400Regular' },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(46,204,113,0.08)', borderColor: 'rgba(46,204,113,0.25)', borderWidth: 1, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4 },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: A.green },
  liveTxt: { color: A.green, fontSize: 8, fontWeight: '900', letterSpacing: 0.9, fontFamily: 'Inter_700Bold' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,75,54,0.08)', borderWidth: 1, borderColor: 'rgba(255,75,54,0.23)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  logoutTxt: { color: A.red, fontSize: 8, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'Inter_700Bold' },
  navWrap: { borderTopWidth: 1, borderTopColor: '#2a3558', backgroundColor: '#0d1220ee', shadowColor: '#ff3d3d', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
  nav: { paddingHorizontal: 8, paddingVertical: 6, gap: 4 },
  navItem: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, minWidth: 66, borderWidth: 1, borderColor: 'transparent' },
  navActive: { backgroundColor: 'rgba(255,176,32,0.08)', borderColor: 'rgba(255,176,32,0.3)' },
  navIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  navIconActive: { backgroundColor: 'rgba(255,176,32,0.14)', borderColor: 'rgba(255,176,32,0.42)', shadowColor: A.gold, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  navIconGlow: { position: 'absolute', width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,176,32,0.14)' },
  navLabel: { color: A.sub, fontSize: 8.5, fontWeight: '700', marginTop: 3, letterSpacing: 0.25, fontFamily: 'Inter_500Medium' },
  navLabelActive: { color: A.gold, fontFamily: 'Inter_700Bold' },
});