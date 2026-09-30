import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Share, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useApp } from '../App';
import { Api } from '../lib/api';

export default function Earn() {
  const { user, refresh } = useApp();
  const [copied, setCopied] = useState(false);
  const [refs, setRefs] = useState<any[]>([]);

  React.useEffect(() => {
    Api.myReferrals().then((d: any) => setRefs(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  const code = (user?.name || 'GAMER').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) + '007';
  const link = 'https://freefire-daily007.app/invite/' + code;

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
      Alert.alert('✓ Copied', 'Referral code copied!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked/unavailable (e.g. preview) — fall back to the share sheet
      try { await Share.share({ message: 'My FreeFire Daily007 referral code: ' + code }); } catch {}
    }
  };

  const tasks = [
    { id: 't1', emoji: '📺', title: 'Watch a Video and Earn', desc: 'Watch 60%+ of any video in the Video tab', reward: 1, done: false },
    { id: 't3', emoji: '👥', title: 'Invite Friends', desc: 'Friend signs up with your code + adds 50 coins', reward: 5, done: false },
  ];

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 14, paddingBottom: 90 }}>
      <Text style={s.hTitle}>💰 EARN COINS</Text>
      <Text style={s.hSub}>Refer friends & complete tasks</Text>

      <View style={s.referCard}>
        <Text style={s.referTitle}>REFER & EARN</Text>
        <Text style={s.referDesc}>Invite friends &amp; earn 5 coins! Your friends get 10 coins on sign up.</Text>
        <View style={s.codeRow}>
          <Text style={s.code}>{code}</Text>
          <Pressable onPress={copy} style={s.shareBtn}><Text style={s.shareTxt}>{copied ? '✓ COPIED' : 'COPY ⧉'}</Text></Pressable>
        </View>
      </View>

      <Text style={s.secTitle}>YOUR INVITES ({refs.length})</Text>
      {refs.length === 0 && (
        <View style={s.task}><Text style={{ fontSize: 22 }}>🫥</Text><View style={{ flex: 1 }}>
          <Text style={s.taskTitle}>No invites yet</Text>
          <Text style={s.taskDesc}>Share your code above — friends appear here.</Text>
        </View></View>
      )}
      {refs.map((r) => {
        const done = r.status === 'Rewarded' || r.status === 'Completed';
        return (
          <View key={r.id} style={s.task}>
            <Text style={{ fontSize: 22 }}>{done ? '✅' : '⏳'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.taskTitle}>{r.referredName || 'Friend'}</Text>
              <Text style={[s.taskDesc, done && { color: '#3ddc97' }]}>{done ? 'Completed — +5 coins credited' : 'First recharge pending'}</Text>
            </View>
            <View style={[s.reward, !done && { backgroundColor: '#ffd16622', borderColor: '#ffd16655' }]}>
              <Text style={[s.rewardTxt, !done && { color: '#ffd166' }]}>{done ? '+5' : '+5'}</Text>
            </View>
          </View>
        );
      })}

      <Text style={s.secTitle}>DAILY TASKS</Text>
      {tasks.map((t) => (
        <View key={t.id} style={s.task}>
          <Text style={{ fontSize: 22 }}>{t.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.taskTitle}>{t.title}</Text>
            <Text style={s.taskDesc}>{t.desc}</Text>
          </View>
          <View style={s.reward}><Text style={s.rewardTxt}>+{t.reward}</Text></View>
        </View>
      ))}

      <View style={s.note}>
        <Text style={s.noteTxt}>Task rewards are credited to your Wallet automatically after verification.</Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#070a12' },
  hTitle: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 1, marginTop: 16 },
  hSub: { color: '#8a93a8', fontSize: 12, marginTop: 2, marginBottom: 14 },
  referCard: { backgroundColor: '#10162b', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#ffd16655', marginBottom: 18 },
  referTitle: { color: '#ffd166', fontWeight: '900', letterSpacing: 1.5, fontSize: 14 },
  referDesc: { color: '#aab2c5', fontSize: 12, marginTop: 6, lineHeight: 17 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  code: { flex: 1, color: '#ffd166', fontWeight: '900', fontSize: 18, letterSpacing: 2, backgroundColor: '#0b1020', borderRadius: 10, borderWidth: 1, borderColor: '#ffd16644', textAlign: 'center', paddingVertical: 10 },
  shareBtn: { backgroundColor: '#ffd166', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  shareTxt: { color: '#1a1408', fontWeight: '900', fontSize: 12 },
  secTitle: { color: '#8a93a8', fontSize: 11, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 },
  task: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#10162b', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#1c2440' },
  taskTitle: { color: '#eef1f8', fontWeight: '800', fontSize: 13.5 },
  taskDesc: { color: '#8a93a8', fontSize: 11.5, marginTop: 2 },
  reward: { backgroundColor: '#3ddc9722', borderWidth: 1, borderColor: '#3ddc9755', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  rewardTxt: { color: '#3ddc97', fontWeight: '900', fontSize: 13 },
  note: { marginTop: 8, padding: 12, borderRadius: 10, backgroundColor: '#141b30' },
  noteTxt: { color: '#8a93a8', fontSize: 11, lineHeight: 16 },
});