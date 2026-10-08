// Login / Signup screen
import React, { useState } from 'react';
import { Keyboard, View, StyleSheet, Platform, Pressable, Image, Linking } from 'react-native';
import type { TextInput as NativeTextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ReadableText as Text } from '../components/typography';
import logoImg from '../assets/logo.jpg';
import { Api, apiError, SessionPersistenceError, setSession, User } from '../lib/api';
import {
  MAX_SIGNUP_PASSWORD_LENGTH,
  signupPasswordError,
} from '../lib/signup-password-policy';
import { Btn, C, Input, Msg } from '../components/ui';
import GoogleSSOButton from '../components/GoogleSSOButton';
import { KeyboardAwareScrollViewCompat } from '../../components/KeyboardAwareScrollViewCompat';
import { referralSignupFromUrl } from '../lib/referral-invite';


export default function Auth({ onDone, notice }: { onDone: (u: User) => void; notice?: string }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [refCode, setRefCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pendingSignupSession, setPendingSignupSession] = useState<User | null>(null);
  const nameInputRef = React.useRef<NativeTextInput>(null);
  const referralInputRef = React.useRef<NativeTextInput>(null);
  const emailInputRef = React.useRef<NativeTextInput>(null);
  const passwordInputRef = React.useRef<NativeTextInput>(null);
  const isSignup = mode === 'signup';
  const retrySignupSession = isSignup ? pendingSignupSession : null;
  const authInputsDisabled = busy || retrySignupSession !== null;

  React.useEffect(() => {
    const applyReferralUrl = (url: string | null) => {
      const invite = referralSignupFromUrl(url, {
        platform: Platform.OS === 'web' ? 'web' : 'native',
        currentWebOrigin: Platform.OS === 'web' && typeof window !== 'undefined'
          ? window.location.origin
          : undefined,
        configuredDomain: process.env.EXPO_PUBLIC_DOMAIN,
      });
      if (!invite) return;
      setRefCode((current) => current || invite.referralCode);
      setMode(invite.mode);
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
    if (!retrySignupSession) {
      if (!email.trim() || !password) { setErr('Email and password are required.'); return; }
      if (mode === 'signup' && !name.trim()) { setErr('Name is required.'); return; }
      if (mode === 'signup') {
        const passwordError = signupPasswordError(password);
        if (passwordError) { setErr(passwordError); return; }
      }
    }
    setBusy(true);
    try {
      let u: User;
      if (retrySignupSession) {
        u = retrySignupSession;
      } else {
        const r: any = mode === 'login'
          ? await Api.login({ email: email.trim(), password })
          : await Api.register({
            name: name.trim(),
            email: email.trim(),
            password,
            ...(refCode.trim() ? { referralCode: refCode.trim() } : {}),
          });
        u = { ...r.user, token: r.token };
      }
      try {
        await setSession(u);
      } catch (e) {
        if (mode === 'signup' && !retrySignupSession && e instanceof SessionPersistenceError) {
          setPendingSignupSession(u);
        }
        throw e;
      }
      if (retrySignupSession) setPendingSignupSession(null);
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
          <Pressable
            testID="auth-login-tab"
            disabled={busy || pendingSignupSession !== null}
            onPress={() => setMode('login')}
            style={[s.tab, mode === 'login' && s.tabOn]}
          >
            <Text style={[s.tabText, mode === 'login' && s.tabTextOn]}>LOGIN</Text>
          </Pressable>
          <Pressable
            testID="auth-signup-tab"
            disabled={busy || pendingSignupSession !== null}
            onPress={() => setMode('signup')}
            style={[s.tab, mode === 'signup' && s.tabOn]}
          >
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
            disabled={busy || retrySignupSession !== null}
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
            <Input
              ref={nameInputRef}
              testID="auth-name"
              accessibilityLabel="Name"
              placeholder="Enter Name"
              value={name}
              onChangeText={setName}
              editable={!authInputsDisabled}
              autoCapitalize="words"
              enterKeyHint="next"
              blurOnSubmit={false}
              onSubmitEditing={() => {
                if (refCode.trim()) emailInputRef.current?.focus();
                else referralInputRef.current?.focus();
              }}
              style={s.signupInput}
            />
            {refCode.trim()
              ? <Text style={s.referralApplied}>Referral code {refCode.trim().toUpperCase()} applied</Text>
              : <Input
                ref={referralInputRef}
                testID="auth-referral-code"
                accessibilityLabel="Referral Code, optional"
                placeholder="Referral Code (Optional)"
                value={refCode}
                onChangeText={setRefCode}
                editable={!authInputsDisabled}
                autoCapitalize="characters"
                enterKeyHint="next"
                blurOnSubmit={false}
                onSubmitEditing={() => emailInputRef.current?.focus()}
                style={s.signupInput}
              />}
            <Input
              ref={emailInputRef}
              testID="auth-email"
              accessibilityLabel="Email"
              placeholder="Enter Email"
              value={email}
              onChangeText={setEmail}
              editable={!authInputsDisabled}
              autoCapitalize="none"
              keyboardType="email-address"
              enterKeyHint="next"
              blurOnSubmit={false}
              onSubmitEditing={() => passwordInputRef.current?.focus()}
              style={s.signupInput}
            />
            <Input
              ref={passwordInputRef}
              testID="auth-password"
              accessibilityLabel="Password"
              placeholder="Password (8–200 characters)"
              value={password}
              onChangeText={setPassword}
              editable={!authInputsDisabled}
              secureTextEntry
              maxLength={MAX_SIGNUP_PASSWORD_LENGTH}
              enterKeyHint="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              style={s.signupInputLast}
            />
          </View>
        ) : (
          <>
            <Input
              testID="auth-email"
              placeholder="Enter Email"
              value={email}
              onChangeText={setEmail}
              editable={!authInputsDisabled}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Input
              testID="auth-password"
              placeholder="Enter Password"
              value={password}
              onChangeText={setPassword}
              editable={!authInputsDisabled}
              secureTextEntry
            />
          </>
        )}

        <Btn
          testID="auth-submit"
          title={retrySignupSession ? 'RETRY SAVING SESSION' : isSignup ? 'CREATE ACCOUNT' : 'LOGIN'}
          accessibilityLabel={retrySignupSession ? 'Retry saving session' : isSignup ? 'Create Account' : 'Login'}
          onPress={submit}
          loading={busy}
          style={isSignup && s.signupSubmit}
        />

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
