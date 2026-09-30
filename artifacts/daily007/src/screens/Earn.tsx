import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Share, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Api, apiError } from '../lib/api';

export default function Earn() {
  const [copied, setCopied] = useState(false);
  const [refs, setRefs] = useState<any[]>([]);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    Api.myReferrals()
      .then((response: any) => {
        setCode(typeof response?.code === 'string' ? response.code : '');
        setRefs(Array.isArray(response?.referrals) ? response.referrals : []);
        setMessage(typeof response?.message === 'string' ? response.message : '');
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));
  }, []);

  const copy = async () => {
    if (!code) return;
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

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 14, paddingBottom: 90 }}>
      <Text style={s.hTitle}>💰 EARN COINS</Text>
      <Text style={s.hSub}>Refer friends & complete tasks</Text>

      <View style={s.referCard}>
        <Text style={s.referTitle}>REFERRAL CODE</Text>
        <Text style={s.referDesc}>This code is provided by the server. Referral rewards are currently unavailable.</Text>
        <View style={s.codeRow}>
          <Text style={s.code}>{loading ? 'Loading…' : code || 'Not available'}</Text>
          {!!code && <Pressable onPress={copy} style={s.shareBtn}><Text style={s.shareTxt}>{copied ? '✓ COPIED' : 'COPY ⧉'}</Text></Pressable>}
        </View>
        {!!message && <Text style={s.referDesc}>{message}</Text>}
        {!!error && <Text style={s.error}>{`Referral data unavailable: ${error}`}</Text>}
      </View>

      <Text style={s.secTitle}>REFERRAL TRACKING ({refs.length})</Text>
      {!loading && !error && refs.length === 0 && (
        <View style={s.task}><Text style={{ fontSize: 22 }}>🫥</Text><View style={{ flex: 1 }}>
          <Text style={s.taskTitle}>No referral activity</Text>
          <Text style={s.taskDesc}>No referred accounts are currently reported by the server.</Text>
        </View></View>
      )}
      {refs.map((r) => {
        return (
          <View key={r.id} style={s.task}>
            <Text style={{ fontSize: 22 }}>⏳</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.taskTitle}>{r.referredName || 'Referral'}</Text>
              <Text style={s.taskDesc}>{String(r.status || 'Pending')} tracking · no bonus claim available</Text>
            </View>
          </View>
        );
      })}

      <View style={s.note}>
        <Text style={s.noteTxt}>No referral bonus is currently claimable. The server reports referral tracking only.</Text>
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
  note: { marginTop: 8, padding: 12, borderRadius: 10, backgroundColor: '#141b30' },
  noteTxt: { color: '#8a93a8', fontSize: 11, lineHeight: 16 },
  error: { color: '#ff6b78', fontSize: 12, marginTop: 8 },
});