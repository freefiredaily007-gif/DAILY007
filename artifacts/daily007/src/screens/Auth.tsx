// Login / Signup screen
import React, { useState } from 'react';
import { Link } from 'expo-router';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Keyboard,
  View,
  StyleSheet,
  Platform,
  Pressable,
  Image,
  Linking,
  useWindowDimensions,
} from 'react-native';
import type { TextInput as NativeTextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ReadableText as Text } from '../components/typography';
import logoImg from '../assets/logo.jpg';
import colors from '../../constants/colors';
import {
  Api,
  apiError,
  captureSessionRevision,
  LoginRateLimitError,
  SessionPersistenceError,
  setDevSessionPersistenceFailuresForTest,
  setSessionForAuthAttempt,
  User,
} from '../lib/api';
import {
  MAX_SIGNUP_PASSWORD_LENGTH,
  signupPasswordError,
} from '../lib/signup-password-policy';
import { Btn, Input, Msg } from '../components/ui';
import GoogleSSOButton from '../components/GoogleSSOButton';
import { KeyboardAwareScrollViewCompat } from '../../components/KeyboardAwareScrollViewCompat';
import { referralSignupFromUrl } from '../lib/referral-invite';

const AUTH = colors.auth;

type AuthFieldProps = Omit<React.ComponentPropsWithoutRef<typeof Input>, 'style'> & {
  icon: React.ComponentProps<typeof Feather>['name'];
  inputRef?: React.Ref<NativeTextInput>;
  wrapperStyle?: any;
};

function AuthField({
  icon,
  inputRef,
  wrapperStyle,
  onFocus,
  onBlur,
  ...inputProps
}: AuthFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[s.field, focused && s.fieldFocused, wrapperStyle]}>
      <Feather accessible={false} name={icon} size={17} color={focused ? AUTH.fire : AUTH.muted} />
      <Input
        ref={inputRef}
        {...inputProps}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        placeholderTextColor={AUTH.placeholder}
        style={s.fieldInput}
      />
    </View>
  );
}

export default function Auth({
  onDone,
  notice,
  devSessionPersistenceFailures,
  devRejectFirstSignupSessionWrite = false,
}: {
  onDone: (u: User) => void;
  notice?: string;
  devSessionPersistenceFailures?: number;
  devRejectFirstSignupSessionWrite?: boolean;
}) {
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
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
  const devSessionWriteFailureInjected = React.useRef(false);
  const googleAttemptInFlight = React.useRef(false);
  const nameInputRef = React.useRef<NativeTextInput>(null);
  const referralInputRef = React.useRef<NativeTextInput>(null);
  const emailInputRef = React.useRef<NativeTextInput>(null);
  const passwordInputRef = React.useRef<NativeTextInput>(null);
  const logoPulse = React.useRef(new Animated.Value(0)).current;
  const modeProgress = React.useRef(new Animated.Value(1)).current;
  const isSignup = mode === 'signup';
  const retrySignupSession = isSignup ? pendingSignupSession : null;
  const authInputsDisabled = busy || googleBusy || retrySignupSession !== null;
  const authTabsDisabled = busy || googleBusy || pendingSignupSession !== null;
  const compactAuthLayout = width <= 360 || fontScale >= 1.5;
  const compactLoginLayout = !isSignup && compactAuthLayout;
  const authErrorTestID = __DEV__ && devSessionPersistenceFailures !== undefined
    ? `auth-error-attempt-${sessionSaveErrorAnnouncement?.id ?? 0}`
    : 'auth-error';
  const logoHaloStyle = {
    opacity: logoPulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] }),
    transform: [{ scale: logoPulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.08] }) }],
  };
  const modeAnimatedStyle = {
    opacity: modeProgress,
    transform: [{ translateY: modeProgress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
  };

  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(logoPulse, {
        toValue: 1,
        duration: 1350,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(logoPulse, {
        toValue: 0,
        duration: 1350,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [logoPulse]);

  React.useEffect(() => {
    modeProgress.setValue(0);
    const transition = Animated.timing(modeProgress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    transition.start();
    return () => transition.stop();
  }, [mode, modeProgress]);

  React.useEffect(() => {
    if (Platform.OS === 'android' && sessionSaveErrorAnnouncement) {
      AccessibilityInfo.announceForAccessibility(sessionSaveErrorAnnouncement.message);
    }
  }, [sessionSaveErrorAnnouncement]);

  React.useEffect(() => {
    if (Platform.OS === 'ios' && err) {
      AccessibilityInfo.announceForAccessibility(err);
    }
  }, [err]);

  React.useEffect(() => {
    if (Platform.OS === 'ios' && notice) {
      AccessibilityInfo.announceForAccessibility(notice);
    }
  }, [notice]);

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
        if (
          __DEV__ &&
          devRejectFirstSignupSessionWrite &&
          mode === 'signup' &&
          !retrySignupSession &&
          !devSessionWriteFailureInjected.current
        ) {
          setDevSessionPersistenceFailuresForTest(1);
          devSessionWriteFailureInjected.current = true;
        }
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
    <View style={s.screen}>
      <LinearGradient
        pointerEvents="none"
        colors={[AUTH.backgroundSoft, AUTH.background, AUTH.background]}
        locations={[0, 0.46, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={s.ambientBackground}>
        <View style={[s.ambientGlow, s.ambientTop]} />
        <View style={[s.ambientGlow, s.ambientBottom]} />
      </View>
      <KeyboardAwareScrollViewCompat
        testID="auth-screen"
        style={s.scroll}
        contentContainerStyle={[
          s.wrap,
          isSignup && s.signupWrap,
          compactLoginLayout && s.compactLoginWrap,
          compactAuthLayout && s.compactAuthWrap,
          {
            paddingTop: Platform.OS === 'web' ? 67 : insets.top + 20,
            paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={72}
      >
        <View style={s.content}>
          <View style={s.logo}>
            <View style={s.badgeWrap}>
              <Animated.View style={[s.logoAura, logoHaloStyle]} />
              <LinearGradient
                colors={[AUTH.gold, AUTH.fire, AUTH.orange]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.logoFrame}
              >
                <Image source={logoImg} style={s.logoIcon} resizeMode="cover" />
              </LinearGradient>
            </View>
            <View style={s.brandPill}>
              <View style={s.brandDot} />
              <Text style={s.brandPillText}>DAILY007 PLAYER NETWORK</Text>
            </View>
            <Text style={s.logoText}>FREE FIRE DAILY007</Text>
            <View style={s.logoSubRow}>
              <Text style={s.logoSub}>Daily Tournaments. Win Coins.</Text>
              <Feather name="award" size={16} color={AUTH.gold} />
            </View>
          </View>

          <View style={s.formCard}>

        <View style={[s.tabs, isSignup && s.signupTabs]}>
          <Pressable
            testID="auth-login-tab"
            disabled={authTabsDisabled}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === 'login', disabled: authTabsDisabled }}
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
            style={({ pressed }) => [s.tab, mode === 'login' && s.tabOn, pressed && s.tabPressed]}
          >
            {mode === 'login' ? (
              <LinearGradient
                pointerEvents="none"
                colors={[AUTH.fire, AUTH.orange]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={s.activeTabGradient}
              />
            ) : null}
            <Text style={[s.tabText, mode === 'login' && s.tabTextOn]}>LOGIN</Text>
          </Pressable>
          <Pressable
            testID="auth-signup-tab"
            disabled={authTabsDisabled}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === 'signup', disabled: authTabsDisabled }}
            onPress={() => {
              if (googleAttemptInFlight.current) return;
              setErr('');
              setGoogleErr('');
              setMode('signup');
            }}
            style={({ pressed }) => [s.tab, mode === 'signup' && s.tabOn, pressed && s.tabPressed]}
          >
            {mode === 'signup' ? (
              <LinearGradient
                pointerEvents="none"
                colors={[AUTH.fire, AUTH.orange]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={s.activeTabGradient}
              />
            ) : null}
            <Text style={[s.tabText, mode === 'signup' && s.tabTextOn]}>SIGN UP</Text>
          </Pressable>
        </View>

        <Animated.View style={[s.formTransition, modeAnimatedStyle]}>
        <Msg
          kind="err"
          text={err}
          testID={authErrorTestID}
          accessibilityLabel={err || undefined}
          accessibilityLiveRegion={err && Platform.OS !== 'ios'
            && !(Platform.OS === 'android' && sessionSaveError)
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
            accessibilityLiveRegion={Platform.OS === 'ios' ? undefined : 'polite'}
            style={s.sessionNotice}
          >
            {notice}
          </Text>
        ) : null}
        {!isSignup
          ? (
            <View style={s.sessionHintCard}>
              <Feather name="alert-circle" size={14} color={AUTH.gold} />
              <Text style={s.sessionHint}>Signing in here will sign out your other Daily007 sessions.</Text>
            </View>
          )
          : null}

        <View style={s.googleArea}>
          <Text style={s.googleHint}>{isSignup ? 'Create an account quickly with Google' : 'Sign in quickly with Google'}</Text>
          <GoogleSSOButton
            label={mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}
            appearance="auth"
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

        <View style={s.divider}>
          <View style={s.dividerLine} />
          <Text style={s.or}>{isSignup ? 'OR REGISTER WITH EMAIL' : 'OR USE EMAIL'}</Text>
          <View style={s.dividerLine} />
        </View>

        {isSignup ? (
          <View style={s.signupFields}>
            <View style={s.signupFieldsHeader}>
              <View style={s.signupFieldsIcon}>
                <Feather name="user-plus" size={15} color={AUTH.orange} />
              </View>
              <View style={s.signupFieldsCopy}>
                <Text style={s.signupFieldsTitle}>PLAYER PROFILE</Text>
                <Text style={s.signupFieldsHint}>Your details for tournament entry</Text>
              </View>
              <Text style={s.signupStep}>01 / 01</Text>
            </View>
            <AuthField
              icon="user"
              inputRef={nameInputRef}
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
              <AuthField
                icon="gift"
                inputRef={referralInputRef}
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
              />
            )}
            <AuthField
              icon="mail"
              inputRef={emailInputRef}
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
            />
            <AuthField
              icon="lock"
              inputRef={passwordInputRef}
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
              wrapperStyle={s.fieldLast}
            />
          </View>
        ) : (
          <View style={s.loginFields}>
            <AuthField
              icon="mail"
              testID="auth-email"
              accessibilityLabel="Email"
              placeholder="Enter Email"
              value={email}
              onChangeText={setEmail}
              editable={!authInputsDisabled}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <AuthField
              icon="lock"
              testID="auth-password"
              accessibilityLabel="Password"
              placeholder="Enter Password"
              value={password}
              onChangeText={setPassword}
              editable={!authInputsDisabled}
              secureTextEntry
              wrapperStyle={s.fieldLast}
            />
          </View>
        )}

        <View style={isSignup ? s.submitGlow : s.loginSubmitGlow}>
          <LinearGradient
            colors={[AUTH.fire, AUTH.orange]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={isSignup ? s.submitGradient : s.loginSubmitGradient}
          >
            <Btn
              testID="auth-submit"
              title={retrySignupSession
                ? 'RETRY SAVING SESSION'
                : isSignup
                  ? 'REGISTER'
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
              preserveAccessibilityFocusWhileLoading={true}
              scaleOnPress
              staticStyle={!isSignup}
              textColor={AUTH.text}
              style={isSignup ? s.submitButton : s.loginSubmitButton}
              textStyle={isSignup ? s.submitText : s.loginSubmitText}
            />
          </LinearGradient>
        </View>

        <View style={s.footRow}>
          <Text style={s.foot}>Join tournaments, win prize coins and top the leaderboard</Text>
          <Feather name="award" size={16} color={AUTH.gold} />
        </View>
          </Animated.View>
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AUTH.background },
  scroll: { flex: 1, backgroundColor: 'transparent' },
  ambientBackground: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  ambientGlow: { position: 'absolute', width: 300, height: 300, borderRadius: 150, opacity: 0.08 },
  ambientTop: { top: -190, left: -100, backgroundColor: AUTH.fire },
  ambientBottom: { bottom: -210, right: -130, backgroundColor: AUTH.orange },
  wrap: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24 },
  compactLoginWrap: { justifyContent: 'flex-start' },
  signupWrap: { paddingHorizontal: 18 },
  compactAuthWrap: { paddingHorizontal: 15, paddingTop: 16, paddingBottom: 20 },
  content: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  logo: { alignItems: 'center', marginBottom: 17 },
  badgeWrap: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  logoAura: {
    position: 'absolute', inset: -5, borderRadius: 38, borderWidth: 2, borderColor: AUTH.gold,
    shadowColor: AUTH.fire, shadowOpacity: 0.55, shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 }, elevation: 7,
  },
  logoFrame: {
    width: 102, height: 102, borderRadius: 29, padding: 3, borderWidth: 1.5,
    borderColor: AUTH.orange, overflow: 'hidden', shadowColor: AUTH.orange,
    shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
  logoIcon: { width: '100%', height: '100%', borderRadius: 25 },
  brandPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1, borderColor: AUTH.borderSoft, backgroundColor: AUTH.panel,
  },
  brandDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: AUTH.orange },
  brandPillText: {
    color: AUTH.muted, fontFamily: 'Rajdhani_700Bold', fontSize: 10, letterSpacing: 1.4,
  },
  logoText: {
    color: AUTH.text, fontFamily: 'Orbitron_700Bold', fontSize: 19, fontWeight: '700',
    letterSpacing: 0.7, marginTop: 9, textAlign: 'center', textShadowColor: AUTH.fire,
    textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 },
  },
  logoSubRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  logoSub: { color: AUTH.muted, fontFamily: 'Rajdhani_600SemiBold', fontSize: 14 },
  formCard: {
    backgroundColor: AUTH.panel, borderRadius: 22, borderWidth: 1, borderColor: AUTH.border,
    borderTopColor: AUTH.highlight, padding: 16, shadowColor: '#000000',
    shadowOpacity: 0.32, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 8,
  },
  tabs: {
    flexDirection: 'row', backgroundColor: AUTH.backgroundSoft, borderRadius: 15,
    borderWidth: 1, borderColor: AUTH.borderSoft, padding: 4, marginBottom: 14,
  },
  signupTabs: { marginBottom: 13 },
  tab: {
    flex: 1, minHeight: 44, borderRadius: 11, alignItems: 'center',
    justifyContent: 'center', overflow: 'hidden',
  },
  tabOn: {
    shadowColor: AUTH.fire, shadowOpacity: 0.35, shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 }, elevation: 4,
  },
  tabPressed: { opacity: 0.86, transform: [{ scale: 0.985 }] },
  activeTabGradient: { ...StyleSheet.absoluteFill, borderRadius: 11 },
  tabText: { color: AUTH.muted, fontFamily: 'Rajdhani_700Bold', fontSize: 13, letterSpacing: 1.2 },
  tabTextOn: { color: AUTH.text },
  formTransition: { width: '100%' },
  sessionNotice: {
    color: AUTH.gold, textAlign: 'center', fontFamily: 'Rajdhani_600SemiBold',
    fontSize: 12, lineHeight: 18, marginBottom: 8,
  },
  sessionHintCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 11, borderWidth: 1,
    borderColor: AUTH.gold + '55', backgroundColor: '#151B35', paddingHorizontal: 10,
    paddingVertical: 8, marginBottom: 10,
  },
  sessionHint: { flex: 1, color: AUTH.gold, fontFamily: 'Rajdhani_600SemiBold', fontSize: 12, lineHeight: 16 },
  googleArea: { marginBottom: 0 },
  googleHint: {
    color: AUTH.muted, textAlign: 'center', fontFamily: 'Rajdhani_600SemiBold',
    fontSize: 13, marginBottom: 0,
  },
  devRecoveryTestLink: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  devRecoveryTestText: { color: AUTH.orange, fontFamily: 'Rajdhani_700Bold', fontSize: 12, textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 17, marginBottom: 14 },
  dividerLine: { flex: 1, height: 1, backgroundColor: AUTH.borderSoft },
  or: {
    color: AUTH.muted, textAlign: 'center', fontFamily: 'Rajdhani_700Bold',
    fontSize: 10, letterSpacing: 1.2,
  },
  signupFields: { backgroundColor: 'transparent', padding: 0, marginBottom: 8 },
  loginFields: { width: '100%' },
  signupFieldsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 11 },
  signupFieldsIcon: {
    width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: AUTH.fire + '22', borderWidth: 1, borderColor: AUTH.fire + '66',
  },
  signupFieldsCopy: { flex: 1 },
  signupFieldsTitle: { color: AUTH.text, fontFamily: 'Rajdhani_700Bold', fontSize: 13, letterSpacing: 0.9 },
  signupFieldsHint: { color: AUTH.muted, fontFamily: 'Rajdhani_500Medium', fontSize: 11, marginTop: 1 },
  signupStep: { color: AUTH.orange, fontFamily: 'Rajdhani_700Bold', fontSize: 10, letterSpacing: 0.6 },
  field: {
    flexDirection: 'row', alignItems: 'center', minHeight: 52, marginBottom: 10,
    paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: AUTH.borderSoft,
    backgroundColor: AUTH.panelRaised,
  },
  fieldFocused: {
    borderColor: AUTH.fire, shadowColor: AUTH.fire, shadowOpacity: 0.3,
    shadowRadius: 11, shadowOffset: { width: 0, height: 0 }, elevation: 4,
  },
  fieldInput: {
    flex: 1, minHeight: 50, marginBottom: 0, paddingHorizontal: 0, paddingVertical: 11,
    borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent', color: AUTH.text,
    fontFamily: 'Rajdhani_600SemiBold', fontSize: 14,
  },
  fieldLast: { marginBottom: 0 },
  referralApplied: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: AUTH.panelRaised, borderWidth: 1, borderColor: AUTH.borderSoft,
    borderRadius: 13, marginBottom: 10, minHeight: 52, paddingHorizontal: 13, gap: 10,
  },
  referralAppliedText: { color: AUTH.muted, flex: 1, fontFamily: 'Rajdhani_600SemiBold', fontSize: 12 },
  referralChangeText: { color: AUTH.orange, fontFamily: 'Rajdhani_700Bold', fontSize: 12 },
  submitGlow: {
    borderRadius: 15, marginTop: 5, shadowColor: AUTH.fire, shadowOpacity: 0.36,
    shadowRadius: 17, shadowOffset: { width: 0, height: 0 }, elevation: 8,
  },
  loginSubmitGlow: {
    alignSelf: 'stretch', borderRadius: 15, marginTop: 12, marginBottom: 8,
    shadowColor: AUTH.orange, shadowOpacity: 0.3, shadowRadius: 15,
    shadowOffset: { width: 0, height: 0 }, elevation: 8,
  },
  submitGradient: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: AUTH.gold },
  loginSubmitGradient: {
    width: '100%', height: 58, alignSelf: 'stretch', borderRadius: 14,
    overflow: 'hidden', borderWidth: 1, borderColor: AUTH.gold,
  },
  submitButton: {
    width: '100%', minHeight: 56, paddingVertical: 15, borderRadius: 13,
    backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center',
    shadowColor: AUTH.fire, shadowOpacity: 0.3,
    shadowRadius: 13, shadowOffset: { width: 0, height: 0 }, elevation: 5,
  },
  loginSubmitButton: {
    width: '100%', height: 56, paddingVertical: 0, borderRadius: 13,
    backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center',
    shadowColor: AUTH.fire, shadowOpacity: 0.3, shadowRadius: 13,
    shadowOffset: { width: 0, height: 0 }, elevation: 5,
  },
  submitText: {
    fontFamily: 'Orbitron_700Bold', fontSize: 14, letterSpacing: 1.1,
    textAlign: 'center', width: '100%',
  },
  loginSubmitText: {
    fontFamily: 'Orbitron_700Bold', fontSize: 16, fontWeight: '700',
    letterSpacing: 1.35, color: AUTH.text, textAlign: 'center',
  },
  footRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, marginTop: 15, paddingHorizontal: 4,
  },
  foot: {
    flexShrink: 1, color: AUTH.muted, textAlign: 'center', fontFamily: 'Rajdhani_600SemiBold',
    marginTop: 0, fontSize: 12, lineHeight: 17,
  },
});
