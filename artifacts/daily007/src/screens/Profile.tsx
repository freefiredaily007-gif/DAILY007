// Profile — avatar, stats, edit profile, notifications, leaderboard, logout
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../App';
import { C, Card, Btn, SectionTitle, KV } from '../components/ui';

export default function Profile() {
  const { user, logout } = useApp();
  const nav = useNavigation<any>();

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <Card style={s.head}>
        <View style={s.avatar}><Text style={s.avatarTxt}>{(user?.name ?? 'P').charAt(0).toUpperCase()}</Text></View>
        <Text style={s.name}>{user?.name ?? 'Player'}</Text>
        <Text style={s.email}>{user?.email ?? ''}</Text>
        {user?.gameUid ? <Text style={s.uid}>FF UID: {user.gameUid}</Text> : null}
      </Card>

      <View style={s.stats}>
        <View style={s.stat}><Text style={s.statV}>{user?.matches ?? 0}</Text><Text style={s.statL}>MATCHES</Text></View>
        <View style={s.stat}><Text style={s.statV}>{user?.wins ?? 0}</Text><Text style={s.statL}>WINS</Text></View>
        <View style={s.stat}><Text style={s.statV}>{user?.kills ?? 0}</Text><Text style={s.statL}>KILLS</Text></View>
        <View style={s.stat}><Text style={s.statV}>🪙{user?.prizeCoins ?? 0}</Text><Text style={s.statL}>PRIZES</Text></View>
      </View>

      <SectionTitle accent={C.blue}>ACCOUNT</SectionTitle>
      <Card>
        <KV k="Phone" v={user?.phone ?? '—'} />
        <KV k="Balance" v={'🪙 ' + (user?.coins ?? 0)} color={C.gold} />
        <KV k="Member since" v={String(user?.$createdAt ?? user?.createdAt ?? '—').slice(0, 10)} />
      </Card>

      <Btn title="✏️ EDIT PROFILE" kind="ghost" onPress={() => nav.navigate('EditProfile')} />
      <Btn title="🔔 NOTIFICATIONS" kind="ghost" onPress={() => nav.navigate('Notifications')} />
      <Btn title="🏆 LEADERBOARD" kind="ghost" onPress={() => nav.navigate('Leaderboard')} />
      <Btn title="LOGOUT" kind="danger" onPress={logout} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { alignItems: 'center', paddingVertical: 22 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.neon, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#fff', fontSize: 32, fontWeight: '900' },
  name: { color: C.text, fontSize: 20, fontWeight: '900', marginTop: 10 },
  email: { color: C.sub, fontSize: 13, marginTop: 2 },
  uid: { color: C.gold, fontSize: 12, marginTop: 6, fontWeight: '700' },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, alignItems: 'center' },
  statV: { color: C.text, fontWeight: '900', fontSize: 16 },
  statL: { color: C.sub, fontSize: 9, letterSpacing: 1, marginTop: 3 },
});
