// Login / Signup screen
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Pressable, ActivityIndicator, Alert, Image } from 'react-native';
import logoImg from '../assets/logo.jpg';
import { Api, apiError, setSession, User } from '../lib/api';
import { Btn, C, Input, Msg, glow } from '../components/ui';


export default function Auth({ onDone }: { onDone: (u: User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  
  const [password, setPassword] = useState('');
  const [refCode, setRefCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (!email.trim() || !password) { setErr('Email and password are required.'); return; }
    if (mode === 'signup' && (!name.trim() || !phone.trim())) { setErr('Name and phone are required.'); return; }
    setBusy(true);
    try {
      const r: any = mode === 'login'
        ? await Api.login({ email: email.trim(), password })
        : await Api.register({ name: name.trim(), email: email.trim(), phone: phone.trim(), password, referralCode: refCode.trim() });
      const u: User = { ...r.user, token: r.token };
      setSession(u);
      onDone(u);
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <View style={s.logo}>
          <Image source={logoImg} style={s.logoIcon} resizeMode="contain" />
          <Text style={s.logoText}>FREE FIRE DAILY007</Text>
          <Text style={s.logoSub}>Daily Tournaments. Win Coins. 🏆</Text>
        </View>

        <View style={s.tabs}>
          <Pressable onPress={() => setMode('login')} style={[s.tab, mode === 'login' && s.tabOn]}>
            <Text style={[s.tabText, mode === 'login' && s.tabTextOn]}>LOGIN</Text>
          </Pressable>
          <Pressable onPress={() => setMode('signup')} style={[s.tab, mode === 'signup' && s.tabOn]}>
            <Text style={[s.tabText, mode === 'signup' && s.tabTextOn]}>SIGN UP</Text>
          </Pressable>
        </View>

        <Msg kind="err" text={err} />

        {mode === 'signup' && (
          <>
            <Input placeholder="Enter Name" value={name} onChangeText={setName} autoCapitalize="words" />
            <Input placeholder="Enter Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <Input placeholder="Referral Code (Optional)" value={refCode} onChangeText={setRefCode} autoCapitalize="characters" />
          </>
        )}
        <Input placeholder="Enter Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <Input placeholder="Enter Password" value={password} onChangeText={setPassword} secureTextEntry />

        <Btn title={mode === 'login' ? 'LOGIN' : 'CREATE ACCOUNT'} onPress={submit} loading={busy} />

        <Text style={s.foot}>Join tournaments, win prize coins and top the leaderboard 🏆</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 60 },
  logo: { alignItems: 'center', marginBottom: 30 },
  logoIcon: { width: 96, height: 96, borderRadius: 20 },
  logoText: { color: C.text, fontSize: 26, fontWeight: '900', letterSpacing: 3, marginTop: 8 },
  logoSub: { color: C.sub, marginTop: 4, fontSize: 13 },
  tabs: { flexDirection: 'row', backgroundColor: C.bg2, borderRadius: 12, padding: 4, marginBottom: 18 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  tabOn: { backgroundColor: C.neon },
  tabText: { color: C.sub, fontWeight: '800', letterSpacing: 1 },
  tabTextOn: { color: '#fff' },
  foot: { color: C.dim, textAlign: 'center', marginTop: 18, fontSize: 12 },
});
