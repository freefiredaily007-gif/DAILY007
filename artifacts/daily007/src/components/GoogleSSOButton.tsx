import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View, Platform } from 'react-native';
import { ReadableText as Text } from './typography';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { getClerkInstance } from '@clerk/expo';
import { useSSO } from '@clerk/expo';
import { Api, apiError, SessionPersistenceError, setSession, User } from '../lib/api';
import { runGoogleSSOAttempt, runGoogleSSOFlow } from '../lib/google-sso-flow';
import { C, Input, Msg } from './ui';

WebBrowser.maybeCompleteAuthSession();

const clerkConfigured = !!process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

type Props = {
  onSuccess: (user: User) => void | Promise<void>;
  onError?: (message: string) => void;
  referralCode?: string;
  dailyToken?: string;
  disabled?: boolean;
  label?: string;
  allowRecoveryRequest?: boolean;
};

const RECOVERY_CONFLICT = 'An account already uses this email. Sign in with your password, then connect Google in Profile.';

function reportGoogleError(onError: Props['onError'], message: string) {
  onError?.(message);
  if (onError && Platform.OS === 'android') {
    AccessibilityInfo.announceForAccessibility(message);
  }
}

export default function GoogleSSOButton(props: Props) {
  if (!clerkConfigured) {
    return <UnavailableButton {...props} />;
  }
  return <ConfiguredGoogleButton {...props} />;
}

function GoogleButtonFrame({
  onPress,
  disabled,
  loading,
  label,
}: {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="continue-with-google"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [s.button, (disabled || loading) && s.disabled, pressed && !disabled && s.pressed]}
    >
      {loading
        ? <Text style={s.spinner}>•••</Text>
        : <View style={s.googleMark}><Text style={s.googleG}>G</Text></View>}
      <Text style={s.buttonText}>{loading ? 'CONNECTING TO GOOGLE…' : label}</Text>
    </Pressable>
  );
}

function UnavailableButton({ onError, disabled, label = 'Continue with Google' }: Props) {
  const [error, setError] = useState('');
  const showError = () => {
    const message = 'Google sign-in is not configured in this build. Email and password login are still available.';
    setError(message);
    reportGoogleError(onError, message);
  };

  return (
    <>
      <GoogleButtonFrame label={label} disabled={disabled} onPress={showError} />
      {!!error && !onError && (
        <Msg
          kind="err"
          text={error}
          accessibilityLabel={error}
          accessibilityLiveRegion="assertive"
        />
      )}
    </>
  );
}

function ConfiguredGoogleButton({
  onSuccess,
  onError,
  referralCode,
  dailyToken,
  disabled,
  label = 'Continue with Google',
  allowRecoveryRequest,
}: Props) {
  const { startSSOFlow } = useSSO();
  const [busy, setBusy] = useState(false);
  const googleAttemptInFlight = useRef(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [recoverySubmitted, setRecoverySubmitted] = useState(false);
  const [ownerRecoveryCode, setOwnerRecoveryCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);

  const showError = (message: string) => {
    setError(message);
    reportGoogleError(onError, message);
    if (allowRecoveryRequest && message === RECOVERY_CONFLICT) setRecoveryAvailable(true);
  };

  const authenticateGoogle = async () => {
    if (googleAttemptInFlight.current) return;
    googleAttemptInFlight.current = true;
    try {
      setError('');
      onError?.('');
      setRecoveryAvailable(false);
      setRecoverySubmitted(false);
      setOwnerRecoveryCode('');
      await runGoogleSSOAttempt({
        authenticate: () => runGoogleSSOFlow({
          getActiveSession: () => getClerkInstance().session,
          startSSOFlow: async () => {
            const redirectUrl = Platform.OS === 'web'
              ? AuthSession.makeRedirectUri()
              : AuthSession.makeRedirectUri({ scheme: 'daily007', path: 'sso-callback' });
            return startSSOFlow({
              strategy: 'oauth_google',
              redirectUrl,
            });
          },
          exchangeToken: (clerkJwt) => Api.googleAuth(clerkJwt, {
            ...(dailyToken ? { dailyToken } : {}),
            ...(referralCode?.trim() ? { referralCode: referralCode.trim() } : {}),
          }),
        }),
        setLoading: setBusy,
        showError,
        onSuccess: async (authenticated) => {
          await setSession(authenticated.user);
          return onSuccess(authenticated.user);
        },
        getErrorMessage: (e) => {
          const message = apiError(e);
          if (message === 'Network Error') {
            return 'Could not reach Daily007. Check your connection and try again.';
          }
          if (message === RECOVERY_CONFLICT || /try again/i.test(message)) return message;
          return `${message} Please try again.`;
        },
      });
    } finally {
      googleAttemptInFlight.current = false;
    }
  };

  const requestRecovery = async () => {
    const activeSession = getClerkInstance().session;
    if (!activeSession) {
      showError('Your Google session has expired. Choose Continue with Google and try again.');
      return;
    }
    setRecoveryBusy(true);
    try {
      const clerkJwt = await activeSession.getToken();
      if (!clerkJwt) throw new Error('A verified Google session is required. Please try again.');
      await Api.requestGoogleRecovery(clerkJwt);
      setRecoveryAvailable(false);
      setRecoverySubmitted(true);
      setError('');
      onError?.('');
    } catch (e: any) {
      setRecoveryAvailable(true);
      showError(apiError(e));
    } finally {
      setRecoveryBusy(false);
    }
  };

  const recoverWithOwnerCode = async () => {
    const activeSession = getClerkInstance().session;
    if (!activeSession) {
      showError('Your Google session has expired. Choose Continue with Google and try again.');
      return;
    }
    if (!ownerRecoveryCode.trim()) {
      showError('Enter the owner recovery code stored in Replit Secrets.');
      return;
    }

    setRecoveryBusy(true);
    let recoveryCompleted = false;
    try {
      const clerkJwt = await activeSession.getToken();
      if (!clerkJwt) throw new Error('A verified Google session is required. Please try again.');
      await Api.requestGoogleOwnerRecovery(clerkJwt, ownerRecoveryCode);
      recoveryCompleted = true;
      setOwnerRecoveryCode('');
      setRecoveryAvailable(false);
      setRecoverySubmitted(false);

      const authenticated = await Api.googleAuth(clerkJwt);
      await setSession(authenticated.user);
      setError('');
      onError?.('');
      await onSuccess(authenticated.user);
    } catch (e: any) {
      showError(recoveryCompleted
        ? e instanceof SessionPersistenceError
          ? `Google recovery is complete, but ${e.message}`
          : 'Google recovery is complete, but sign-in did not finish. Choose Continue with Google to sign in.'
        : apiError(e));
    } finally {
      setRecoveryBusy(false);
    }
  };

  return (
    <>
      <GoogleButtonFrame label={label} disabled={disabled || recoveryBusy} loading={busy} onPress={authenticateGoogle} />
      {allowRecoveryRequest && (recoveryAvailable || error === RECOVERY_CONFLICT) && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Request Full Admin account recovery review"
          testID="request-google-account-recovery"
          disabled={recoveryBusy}
          onPress={requestRecovery}
          style={({ pressed }) => [s.recoveryButton, pressed && !recoveryBusy && s.pressed, recoveryBusy && s.disabled]}
        >
          <Text style={s.recoveryButtonText}>{recoveryBusy ? 'SENDING REQUEST…' : 'REQUEST ADMIN REVIEW'}</Text>
        </Pressable>
      )}
      {allowRecoveryRequest && (recoveryAvailable || error === RECOVERY_CONFLICT || recoverySubmitted) && (
        <View style={s.ownerRecovery}>
          <Text style={s.ownerRecoveryLabel}>
            Sole Full Admin? Enter the owner recovery code configured in Replit Secrets. Daily007 does not store the code.
          </Text>
          <Input
            accessibilityLabel="Owner recovery code"
            testID="owner-recovery-code"
            value={ownerRecoveryCode}
            onChangeText={setOwnerRecoveryCode}
            placeholder="Owner recovery code"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            maxLength={256}
            editable={!recoveryBusy}
            style={s.ownerRecoveryInput}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Recover sole Full Admin account with owner code"
            testID="recover-with-owner-code"
            disabled={recoveryBusy || !ownerRecoveryCode.trim()}
            onPress={recoverWithOwnerCode}
            style={({ pressed }) => [
              s.ownerRecoveryButton,
              pressed && !recoveryBusy && s.pressed,
              (recoveryBusy || !ownerRecoveryCode.trim()) && s.disabled,
            ]}
          >
            <Text style={s.recoveryButtonText}>
              {recoveryBusy ? 'VERIFYING OWNER CODE…' : 'VERIFY OWNER CODE & RECOVER'}
            </Text>
          </Pressable>
        </View>
      )}
      {recoverySubmitted && (
        <Text accessibilityRole="text" style={s.recoveryNotice}>
          If an eligible account matches, a Full Admin will review it. Google will not be linked until ownership is verified.
        </Text>
      )}
      {!!error && !onError && (
        <Msg
          kind="err"
          text={error}
          accessibilityLabel={error}
          accessibilityLiveRegion="assertive"
        />
      )}
    </>
  );
}

const s = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.82 },
  googleMark: { position: 'absolute', left: 16 },
  googleG: { color: '#4285F4', fontSize: 19, fontWeight: '900' },
  spinner: { position: 'absolute', left: 20, color: C.sub, fontWeight: '900' },
  buttonText: { color: C.text, fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  recoveryButton: { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 12, marginTop: 2 },
  recoveryButtonText: { color: C.blue, fontSize: 12, fontWeight: '800', letterSpacing: 0.3, textAlign: 'center' },
  recoveryNotice: { color: C.sub, fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: 'center' },
  ownerRecovery: {
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.card,
  },
  ownerRecoveryLabel: { color: C.sub, fontSize: 11, lineHeight: 17 },
  ownerRecoveryInput: {
    minHeight: 46,
    marginTop: 9,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    backgroundColor: C.bg2,
    color: C.text,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  ownerRecoveryButton: {
    minHeight: 46,
    marginTop: 9,
    borderRadius: 10,
    backgroundColor: C.blue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});