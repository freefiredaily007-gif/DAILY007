// Login / Signup screen
import React, { useState } from 'react';
import { View, StyleSheet, Platform, Pressable, Image, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ReadableText as Text } from '../components/typography';
import logoImg from '../assets/logo.jpg';
import { Api, apiError, setSession, User } from '../lib/api';
import { Btn, C, Input, Msg } from '../components/ui';
import GoogleSSOButton from '../components/GoogleSSOButton';
import { KeyboardAwareScrollViewCompat } from '../../components/KeyboardAwareScrollViewCompat';


export default function Auth({ onDone, notice }: { onDone: (u: User) => void; notice?: string }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [refCode, setRefCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isSignup = mode === 'signup';

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
      contentContainerStyle={[s.wrap, isSignup && s.signupWrap]}
      keyboardShouldPersistTaps="handled"
      bottomOffset={72}
    >
        <View style={[s.logo, isSignup && s.signupLogo]}>
          {isSignup ? (
            <View style={s.signupLogoFrame}>
              <Image source={logoImg} style={s.signupLogoIcon} resizeMode="cover" />
            </View>
          ) : (
            <Image source={logoImg} style={s.logoIcon} resizeMode="contain" />
          )}
          {isSignup ? (
            <>
              <View style={s.signupKickerRow}>
                <View style={s.signupKickerLine} />
                <Text style={s.signupKicker}>PLAYER REGISTRATION</Text>
                <View style={s.signupKickerLine} />
              </View>
              <Text style={s.signupTitle}>ENTER THE ARENA</Text>
              <Text style={s.signupSub}>Create your player profile to join Daily007 tournaments.</Text>
            </>
          ) : (
            <>
              <Text style={s.logoText}>FREE FIRE DAILY007</Text>
              <Text style={s.logoSub}>Daily Tournaments. Win Coins. 🏆</Text>
            </>
          )}
        </View>

        <View style={[s.tabs, isSignup && s.signupTabs]}>
          <Pressable onPress={() => setMode('login')} style={[s.tab, mode === 'login' && s.tabOn]}>
            <Text style={[s.tabText, mode === 'login' && s.tabTextOn]}>LOGIN</Text>
          </Pressable>
          <Pressable onPress={() => setMode('signup')} style={[s.tab, mode === 'signup' && s.tabOn]}>
            <Text style={[s.tabText, mode === 'signup' && s.tabTextOn]}>SIGN UP</Text>
          </Pressable>
        </View>

        <Msg kind="err" text={err} />
        {!isSignup && notice ? <Text style={s.sessionNotice}>{notice}</Text> : null}
        {!isSignup
          ? <Text style={s.sessionHint}>Signing in here will sign out your other Daily007 sessions.</Text>
          : null}

        <View style={s.googleArea}>
          <Text style={s.googleHint}>{isSignup ? 'Create an account quickly with Google' : 'Sign in quickly with Google'}</Text>
          <GoogleSSOButton
            label={mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}
            disabled={busy}
            referralCode={isSignup ? refCode : undefined}
            onError={setErr}
            onSuccess={onDone}
          />
        </View>

        <Text style={s.or}>{isSignup ? 'OR REGISTER WITH EMAIL' : 'OR USE EMAIL'}</Text>

        {isSignup ? (
          <View style={s.signupFields}>
            <View style={s.signupFieldsHeader}>
              <View style={s.signupFieldsIcon}>
                <Feather name="user-plus" size={15} color={C.neon} />
              </View>
              <View style={s.signupFieldsCopy}>
                <Text style={s.signupFieldsTitle}>PLAYER PROFILE</Text>
                <Text style={s.signupFieldsHint}>Your details for tournament entry</Text>
              </View>
              <Text style={s.signupStep}>01 / 01</Text>
            </View>
            <Input placeholder="Enter Name" value={name} onChangeText={setName} autoCapitalize="words" style={s.signupInput} />
            {refCode.trim()
              ? <Text style={s.referralApplied}>Referral code {refCode.trim().toUpperCase()} applied</Text>
              : <Input placeholder="Referral Code (Optional)" value={refCode} onChangeText={setRefCode} autoCapitalize="characters" style={s.signupInput} />}
            <Input placeholder="Enter Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={s.signupInput} />
            <Input placeholder="Password (at least 8 characters)" value={password} onChangeText={setPassword} secureTextEntry style={s.signupInputLast} />
          </View>
        ) : (
          <>
            <Input placeholder="Enter Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <Input placeholder="Enter Password" value={password} onChangeText={setPassword} secureTextEntry />
          </>
        )}

        <Btn title={isSignup ? 'CREATE ACCOUNT' : 'LOGIN'} onPress={submit} loading={busy} style={isSignup && s.signupSubmit} />

        <Text style={s.foot}>{isSignup ? 'YOUR NEXT MATCH STARTS HERE' : 'Join tournaments, win prize coins and top the leaderboard 🏆'}</Text>
    </KeyboardAwareScrollViewCompat>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 32, paddingBottom: 36 },
  signupWrap: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 28 },
  logo: { alignItems: 'center', marginBottom: 24 },
  signupLogo: { marginBottom: 17 },
  logoIcon: { width: 84, height: 84, borderRadius: 18 },
  logoText: { color: C.text, fontSize: 23, fontWeight: '900', letterSpacing: 2, marginTop: 8 },
  logoSub: { color: C.sub, marginTop: 4, fontSize: 13 },
  signupLogoFrame: {
    width: 122, height: 122, padding: 4, borderRadius: 24, borderWidth: 1.5,
    borderColor: C.neon + '88', backgroundColor: C.card,
    shadowColor: C.neon, shadowOpacity: 0.34, shadowRadius: 17,
    shadowOffset: { width: 0, height: 0 }, elevation: 8,
  },
  signupLogoIcon: { width: '100%', height: '100%', borderRadius: 18 },
  signupKickerRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 13 },
  signupKickerLine: { width: 20, height: 1, backgroundColor: C.neon, opacity: 0.7 },
  signupKicker: { color: C.blue, fontSize: 9, fontWeight: '900', letterSpacing: 1.8 },
  signupTitle: { color: C.neon, fontSize: 23, fontWeight: '900', letterSpacing: 1.2, marginTop: 7 },
  signupSub: { color: C.sub, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 4, maxWidth: 300 },
  tabs: { flexDirection: 'row', backgroundColor: C.bg2, borderRadius: 12, padding: 4, marginBottom: 18 },
  sessionNotice: { color: C.gold, textAlign: 'center', fontSize: 12, lineHeight: 18, marginBottom: 8 },
  sessionHint: { color: C.dim, textAlign: 'center', fontSize: 11, lineHeight: 16, marginBottom: 8 },
  signupTabs: { borderWidth: 1, borderColor: C.border, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  tabOn: { backgroundColor: C.neon },
  tabText: { color: C.sub, fontWeight: '800', letterSpacing: 1 },
  tabTextOn: { color: C.bg },
  googleArea: { marginBottom: 2 },
  googleHint: { color: C.sub, textAlign: 'center', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  or: { color: C.dim, textAlign: 'center', fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginTop: 18, marginBottom: 14 },
  signupFields: {
    backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderTopColor: C.neon,
    borderRadius: 16, padding: 13, paddingTop: 12, marginBottom: 5,
  },
  signupFieldsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  signupFieldsIcon: {
    width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.neon + '18', borderWidth: 1, borderColor: C.neon + '55',
  },
  signupFieldsCopy: { flex: 1 },
  signupFieldsTitle: { color: C.text, fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  signupFieldsHint: { color: C.sub, fontSize: 10, marginTop: 2 },
  signupStep: { color: C.neon, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  signupInput: { backgroundColor: C.card, marginBottom: 9, minHeight: 46 },
  signupInputLast: { backgroundColor: C.card, marginBottom: 0, minHeight: 46 },
  referralApplied: { color: C.green, fontSize: 13, fontWeight: '700', textAlign: 'center', marginVertical: 8 },
  signupSubmit: { marginTop: 7 },
  foot: { color: C.dim, textAlign: 'center', marginTop: 18, fontSize: 12 },
});
