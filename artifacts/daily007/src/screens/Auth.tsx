// Login / Signup screen
import React, { useState } from 'react';
import { View, Text, StyleSheet, Platform, Pressable, Image, Linking } from 'react-native';
import logoImg from '../assets/logo.jpg';
import { Api, apiError, setSession, User } from '../lib/api';
import { Btn, C, Input, Msg } from '../components/ui';
import GoogleSSOButton from '../components/GoogleSSOButton';
import { KeyboardAwareScrollViewCompat } from '../../components/KeyboardAwareScrollViewCompat';


export default function Auth({ onDone }: { onDone: (u: User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [refCode, setRefCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  React.useEffect(() => {
    const applyReferralUrl = (url: string | null) => {
      if (!url) return;
      try {
        const parsed = new URL(url);
        const isAppLink = parsed.protocol === 'daily007:';
        const isCurrentWebPage = Platform.OS === 'web' &&
          typeof window !== 'undefined' &&
          parsed.origin === window.location.origin;
        const isConfiguredWebInvite = parsed.protocol === 'https:' &&
          !!process.env.EXPO_PUBLIC_DOMAIN &&
          parsed.hostname === process.env.EXPO_PUBLIC_DOMAIN;
        const isWebInvite = isCurrentWebPage || isConfiguredWebInvite;
        if (!isAppLink && !isWebInvite) return;
        const code = parsed.searchParams.get('ref') ?? parsed.searchParams.get('referralCode');
        if (!code?.trim()) return;
        setRefCode((current) => current || code.trim().toUpperCase());
        setMode('signup');
      } catch {
        // Ignore malformed or unrelated incoming links.
      }
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      applyReferralUrl(window.location.href);
    }
    Linking.getInitialURL().then(applyReferralUrl).catch(() => {});
    const subscription = Linking.addEventListener('url', ({ url }) => applyReferralUrl(url));
    return () => subscription.remove();
  }, []);

  const submit = async () => {
    setErr('');
    if (!email.trim() || !password) { setErr('Email and password are required.'); return; }
    if (mode === 'signup' && !name.trim()) { setErr('Name is required.'); return; }
    if (mode === 'signup' && password.length < 8) { setErr('Password must be at least 8 characters long.'); return; }
    setBusy(true);
    try {
      const r: any = mode === 'login'
        ? await Api.login({ email: email.trim(), password })
        : await Api.register({
          name: name.trim(),
          email: email.trim(),
          password,
          ...(refCode.trim() ? { referralCode: refCode.trim() } : {}),
        });
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
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={s.wrap}
      keyboardShouldPersistTaps="handled"
      bottomOffset={72}
    >
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

        <View style={s.googleArea}>
          <Text style={s.googleHint}>{mode === 'signup' ? 'Create an account quickly with Google' : 'Sign in quickly with Google'}</Text>
          <GoogleSSOButton
            label={mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}
            disabled={busy}
            referralCode={mode === 'signup' ? refCode : undefined}
            onError={setErr}
            onSuccess={onDone}
          />
        </View>

        <Text style={s.or}>OR USE EMAIL</Text>

        {mode === 'signup' && (
          <>
            <Input placeholder="Enter Name" value={name} onChangeText={setName} autoCapitalize="words" />
            {refCode.trim()
              ? <Text style={s.referralApplied}>Referral code {refCode.trim().toUpperCase()} applied</Text>
              : <Input placeholder="Referral Code (Optional)" value={refCode} onChangeText={setRefCode} autoCapitalize="characters" />}
          </>
        )}
        <Input placeholder="Enter Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <Input placeholder={mode === 'signup' ? 'Password (at least 8 characters)' : 'Enter Password'} value={password} onChangeText={setPassword} secureTextEntry />

        <Btn title={mode === 'login' ? 'LOGIN' : 'CREATE ACCOUNT'} onPress={submit} loading={busy} />

        <Text style={s.foot}>Join tournaments, win prize coins and top the leaderboard 🏆</Text>
    </KeyboardAwareScrollViewCompat>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 32, paddingBottom: 36 },
  logo: { alignItems: 'center', marginBottom: 24 },
  logoIcon: { width: 84, height: 84, borderRadius: 18 },
  logoText: { color: C.text, fontSize: 23, fontWeight: '900', letterSpacing: 3, marginTop: 8 },
  logoSub: { color: C.sub, marginTop: 4, fontSize: 13 },
  tabs: { flexDirection: 'row', backgroundColor: C.bg2, borderRadius: 12, padding: 4, marginBottom: 18 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  tabOn: { backgroundColor: C.neon },
  tabText: { color: C.sub, fontWeight: '800', letterSpacing: 1 },
  tabTextOn: { color: '#fff' },
  googleArea: { marginBottom: 2 },
  googleHint: { color: C.sub, textAlign: 'center', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  or: { color: C.dim, textAlign: 'center', fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginTop: 18, marginBottom: 14 },
  referralApplied: { color: C.green, fontSize: 13, fontWeight: '700', textAlign: 'center', marginVertical: 8 },
  foot: { color: C.dim, textAlign: 'center', marginTop: 18, fontSize: 12 },
});
