// Login / Signup screen
import React, { useState } from 'react';
import { Link } from 'expo-router';
import { AccessibilityInfo, Keyboard, View, StyleSheet, Platform, Pressable, Image, Linking, useWindowDimensions } from 'react-native';
import type { TextInput as NativeTextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ReadableText as Text } from '../components/typography';
import logoImg from '../assets/logo.jpg';
import {
  Api,
  apiError,
  captureSessionRevision,
  LoginRateLimitError,
  SessionPersistenceError,
  setSessionForAuthAttempt,
  User,
} from '../lib/api';
import {
  MAX_SIGNUP_PASSWORD_LENGTH,
  signupPasswordError,
} from '../lib/signup-password-policy';
import { Btn, C, Input, Msg } from '../components/ui';
import GoogleSSOButton from '../components/GoogleSSOButton';
import { KeyboardAwareScrollViewCompat } from '../../components/KeyboardAwareScrollViewCompat';
import { referralSignupFromUrl } from '../lib/referral-invite';


export default function Auth({
  onDone,
  notice,
  devSessionPersistenceFailures,
}: {
  onDone: (u: User) => void;
  notice?: string;
  devSessionPersistenceFailures?: number;
}) {
  const { width, fontScale } = useWindowDimensions();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [refCode, setRefCode] = useState('');
  const [referralCodeApplied, setReferralCodeApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [err, setErr] = useState('');
  const [googleErr, setGoogleErr] = useState('');
  const [loginRetryDeadline, setLoginRetryDeadline] = useState<number | null>(null);
  const [loginRetryRemaining, setLoginRetryRemaining] = useState(0);
  const [loginThrottleMessageBase, setLoginThrottleMessageBase] = useState('');
  const [loginThrottleStatus, setLoginThrottleStatus] = useState('');
  const [pendingSignupSession, setPendingSignupSession] = useState<User | null>(null);
  const [sessionSaveError, setSessionSaveError] = useState(false);
  const [sessionSaveErrorAnnouncement, setSessionSaveErrorAnnouncement] = useState<{
    id: number;
    message: string;
  } | null>(null);
  const sessionSaveAnnouncementId = React.useRef(0);
  const devSessionPersistenceFailuresRemaining = React.useRef(devSessionPersistenceFailures ?? 0);
  const googleAttemptInFlight = React.useRef(false);
  const nameInputRef = React.useRef<NativeTextInput>(null);
  const referralInputRef = React.useRef<NativeTextInput>(null);
  const emailInputRef = React.useRef<NativeTextInput>(null);
  const passwordInputRef = React.useRef<NativeTextInput>(null);
  const isSignup = mode === 'signup';
  const retrySignupSession = isSignup ? pendingSignupSession : null;
  const authInputsDisabled = busy || googleBusy || retrySignupSession !== null;
  const authTabsDisabled = busy || googleBusy || pendingSignupSession !== null;
  const compactLoginLayout = !isSignup && (width <= 360 || fontScale >= 1.5);
  const authErrorTestID = __DEV__ && devSessionPersistenceFailures !== undefined
    ? `auth-error-attempt-${sessionSaveErrorAnnouncement?.id ?? 0}`
    : 'auth-error';

  React.useEffect(() => {
    if (Platform.OS === 'android' && sessionSaveErrorAnnouncement) {
      AccessibilityInfo.announceForAccessibility(sessionSaveErrorAnnouncement.message);
    }
  }, [sessionSaveErrorAnnouncement]);

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
      setReferralCodeApplied(true);
      setMode(invite.mode);
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      applyReferralUrl(window.location.href);
    }
    Linking.getInitialURL().then(applyReferralUrl).catch(() => {});
    const subscription = Linking.addEventListener('url', ({ url }) => applyReferralUrl(url));
    return () => subscription.remove();
  }, []);

  React.useEffect(() => {
    if (loginRetryDeadline === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const updateRemaining = () => {
      const remainingMs = loginRetryDeadline - Date.now();
      const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      setLoginRetryRemaining(remainingSeconds);
      if (remainingMs <= 0) {
        setLoginRetryDeadline(null);
        setLoginThrottleStatus('You can try logging in now.');
        return;
      }
      timer = setTimeout(updateRemaining, Math.min(1000, remainingMs));
    };
    updateRemaining();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [loginRetryDeadline]);

  const submit = async () => {
    if (googleAttemptInFlight.current || googleBusy) return;
    if (busy) return;
    if (mode === 'login' && loginRetryDeadline !== null) {
      if (loginRetryDeadline > Date.now()) return;
      setLoginRetryDeadline(null);
      setLoginRetryRemaining(0);
    }
    setErr('');
    setSessionSaveError(false);
    setGoogleErr('');
    if (mode === 'login') {
      setLoginThrottleMessageBase('');
      setLoginThrottleStatus('');
    }
    if (!retrySignupSession) {
      if (!email.trim() || !password) { setErr('Email and password are required.'); return; }
      if (mode === 'signup' && !name.trim()) { setErr('Name is required.'); return; }
      if (mode === 'signup') {
        const passwordError = signupPasswordError(password);
        if (passwordError) { setErr(passwordError); return; }
      }
    }
    setBusy(true);
    const authRevision = captureSessionRevision();
    try {
      let u: User;
      if (retrySignupSession) {
        u = retrySignupSession;
      } else if (__DEV__ && devSessionPersistenceFailures !== undefined && mode === 'signup') {
        u = {
          id: 'signup-session-accessibility-test',
          name: name.trim(),
          email: email.trim(),
          role: 'user',
          token: 'signup-session-accessibility-test-token',
        };
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
        let saved: boolean;
        if (__DEV__ && devSessionPersistenceFailures !== undefined && mode === 'signup') {
          if (devSessionPersistenceFailuresRemaining.current > 0) {
            devSessionPersistenceFailuresRemaining.current -= 1;
            throw new SessionPersistenceError();
          }
          saved = true;
        } else {
          saved = await setSessionForAuthAttempt(u, authRevision);
        }
        if (!saved) return;
      } catch (e) {
        if (mode === 'signup' && !retrySignupSession && e instanceof SessionPersistenceError) {
          setPendingSignupSession(u);
        }
        throw e;
      }
      if (retrySignupSession) setPendingSignupSession(null);
      onDone(u);
    } catch (e) {
      if (mode === 'signup' && referralCodeApplied && !(e instanceof SessionPersistenceError)) {
        setReferralCodeApplied(false);
      }
      if (mode === 'login' && e instanceof LoginRateLimitError) {
        const seconds = e.retryAfterSeconds;
        const message = apiError(e);
        setLoginRetryDeadline(Date.now() + seconds * 1000);
        setLoginRetryRemaining(seconds);
        setLoginThrottleMessageBase(message);
        setLoginThrottleStatus(
          `${message} Wait ${seconds} ${seconds === 1 ? 'second' : 'seconds'} before trying again.`,
        );
      } else {
        const message = apiError(e);
        setErr(message);
        if (
          Platform.OS === 'android'
          && mode === 'signup'
          && e instanceof SessionPersistenceError
        ) {
          setSessionSaveError(true);
          setSessionSaveErrorAnnouncement({
            id: ++sessionSaveAnnouncementId.current,
            message,
          });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      testID="auth-screen"
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={[
        s.wrap,
        isSignup && s.signupWrap,
        compactLoginLayout && s.compactLoginWrap,
      ]}
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
            disabled={authTabsDisabled}
            onPress={() => {
              if (googleAttemptInFlight.current) return;
              setErr('');
              setGoogleErr('');
              if (loginRetryDeadline !== null) {
                const seconds = Math.max(0, Math.ceil((loginRetryDeadline - Date.now()) / 1000));
                setLoginRetryRemaining(seconds);
                setLoginThrottleStatus(seconds > 0
                  ? `${loginThrottleMessageBase || 'Too many login attempts. Please try again shortly.'} Wait ${seconds} ${seconds === 1 ? 'second' : 'seconds'} before trying again.`
                  : 'You can try logging in now.');
                if (seconds === 0) setLoginRetryDeadline(null);
              }
              setMode('login');
            }}
            style={[s.tab, mode === 'login' && s.tabOn]}
          >
            <Text style={[s.tabText, mode === 'login' && s.tabTextOn]}>LOGIN</Text>
          </Pressable>
          <Pressable
            testID="auth-signup-tab"
            disabled={authTabsDisabled}
            onPress={() => {
              if (googleAttemptInFlight.current) return;
              setErr('');
              setGoogleErr('');
              setMode('signup');
            }}
            style={[s.tab, mode === 'signup' && s.tabOn]}
          >
            <Text style={[s.tabText, mode === 'signup' && s.tabTextOn]}>SIGN UP</Text>
          </Pressable>
        </View>

        <Msg
          kind="err"
          text={err}
          testID={authErrorTestID}
          accessibilityLabel={err || undefined}
          accessibilityLiveRegion={err && !(Platform.OS === 'android' && sessionSaveError)
            ? 'assertive'
            : undefined}
        />
        {googleErr
          ? <Msg
            kind="err"
            text={googleErr}
            accessibilityLiveRegion={Platform.OS === 'web' ? 'assertive' : undefined}
          />
          : null}
        {!isSignup && loginThrottleStatus ? (
          <Msg
            kind={loginRetryRemaining > 0 ? 'err' : 'ok'}
            text={loginThrottleStatus}
            testID="auth-login-throttle-status"
            accessibilityLabel={loginThrottleStatus}
            accessibilityLiveRegion={loginRetryRemaining > 0 ? 'assertive' : 'polite'}
          />
        ) : null}
        {!isSignup && notice ? (
          <Text
            testID="auth-session-notice"
            accessibilityRole="text"
            accessibilityLabel={notice}
            accessibilityLiveRegion="polite"
            style={s.sessionNotice}
          >
            {notice}
          </Text>
        ) : null}
        {!isSignup
          ? <Text style={s.sessionHint}>Signing in here will sign out your other Daily007 sessions.</Text>
          : null}

        <View style={s.googleArea}>
          <Text style={s.googleHint}>{isSignup ? 'Create an account quickly with Google' : 'Sign in quickly with Google'}</Text>
          <GoogleSSOButton
            label={mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}
            disabled={busy || retrySignupSession !== null}
            onBusyChange={(isBusy) => {
              googleAttemptInFlight.current = isBusy;
              setGoogleBusy(isBusy);
            }}
            referralCode={isSignup ? refCode : undefined}
            onError={(message) => {
              setErr('');
              setGoogleErr(message);
              setReferralCodeApplied(false);
            }}
            onSuccess={onDone}
          />
          {__DEV__ && (
            <Link href="/google-recovery-accessibility-test" asChild>
              <Pressable accessibilityRole="link" style={s.devRecoveryTestLink}>
                <Text style={s.devRecoveryTestText}>DEV: Google recovery TalkBack test</Text>
              </Pressable>
            </Link>
          )}
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
                if (referralCodeApplied && refCode.trim()) emailInputRef.current?.focus();
                else referralInputRef.current?.focus();
              }}
              style={s.signupInput}
            />
            {referralCodeApplied && refCode.trim() ? (
              <View style={s.referralApplied}>
                <Text style={s.referralAppliedText}>
                  Referral code {refCode.trim().toUpperCase()} applied
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change referral code"
                  onPress={() => setReferralCodeApplied(false)}
                >
                  <Text style={s.referralChangeText}>Change</Text>
                </Pressable>
              </View>
            ) : (
              <Input
                ref={referralInputRef}
                testID="auth-referral-code"
                accessible
                accessibilityLabel="Referral Code, optional"
                accessibilityHint="If Google sign-up rejects this code, edit it and return to Sign up with Google to retry."
                placeholder="Referral Code (Optional)"
                value={refCode}
                onChangeText={setRefCode}
                editable={!authInputsDisabled}
                autoCapitalize="characters"
                enterKeyHint="next"
                blurOnSubmit={false}
                onSubmitEditing={() => emailInputRef.current?.focus()}
                style={s.signupInput}
              />
            )}
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
              accessibilityLabel="Email"
              placeholder="Enter Email"
              value={email}
              onChangeText={setEmail}
              editable={!authInputsDisabled}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Input
              testID="auth-password"
              accessibilityLabel="Password"
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
          title={retrySignupSession
            ? 'RETRY SAVING SESSION'
            : isSignup
              ? 'CREATE ACCOUNT'
              : loginRetryRemaining > 0
                ? `WAIT ${loginRetryRemaining} ${loginRetryRemaining === 1 ? 'SECOND' : 'SECONDS'}`
                : 'LOGIN'}
          accessibilityLabel={retrySignupSession
            ? 'Retry saving session'
            : isSignup
              ? 'Create Account'
              : loginRetryRemaining > 0
                ? `Login available in ${loginRetryRemaining} ${loginRetryRemaining === 1 ? 'second' : 'seconds'}`
                : 'Login'}
          accessibilityHint={!isSignup && loginRetryRemaining > 0
            ? 'Wait until the countdown ends before trying to log in.'
            : undefined}
          accessibilityState={{
            disabled: busy || googleBusy || (!isSignup && loginRetryRemaining > 0),
          }}
          disabled={googleBusy || (!isSignup && loginRetryRemaining > 0)}
          onPress={submit}
          loading={busy}
          preserveAccessibilityFocusWhileLoading={isSignup}
          style={isSignup && s.signupSubmit}
        />

        <Text style={s.foot}>{isSignup ? 'YOUR NEXT MATCH STARTS HERE' : 'Join tournaments, win prize coins and top the leaderboard 🏆'}</Text>
    </KeyboardAwareScrollViewCompat>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 32, paddingBottom: 36 },
  compactLoginWrap: {
    justifyContent: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
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
  devRecoveryTestLink: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  devRecoveryTestText: { color: C.blue, fontSize: 12, fontWeight: '700', textAlign: 'center' },
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
  referralApplied: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.card, borderRadius: 10, marginBottom: 9, minHeight: 46,
    paddingHorizontal: 12, gap: 10,
  },
  referralAppliedText: { color: C.sub, flex: 1, fontSize: 12, fontWeight: '700' },
  referralChangeText: { color: C.neon, fontSize: 12, fontWeight: '900' },
  signupSubmit: { marginTop: 7 },
  foot: { color: C.dim, textAlign: 'center', marginTop: 18, fontSize: 12 },
});
