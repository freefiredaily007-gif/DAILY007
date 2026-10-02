import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, Platform } from 'react-native';
import { ReadableText as Text } from './typography';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { getClerkInstance } from '@clerk/expo';
import { useSSO } from '@clerk/expo';
import { Api, apiError, setSession, User } from '../lib/api';
import { C, Msg } from './ui';

WebBrowser.maybeCompleteAuthSession();

const clerkConfigured = !!process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

type Props = {
  onSuccess: (user: User) => void | Promise<void>;
  onError?: (message: string) => void;
  referralCode?: string;
  dailyToken?: string;
  disabled?: boolean;
  label?: string;
};

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
  return (
    <GoogleButtonFrame
      label={label}
      disabled={disabled}
      onPress={() => onError?.('Google sign-in is not configured in this build. Email and password login are still available.')}
    />
  );
}

function ConfiguredGoogleButton({
  onSuccess,
  onError,
  referralCode,
  dailyToken,
  disabled,
  label = 'Continue with Google',
}: Props) {
  const { startSSOFlow } = useSSO();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);

  const showError = (message: string) => {
    setError(message);
    onError?.(message);
  };

  const authenticateGoogle = async () => {
    setError('');
    setBusy(true);
    try {
      // A saved Clerk session can outlive the Daily007 account session. Reuse
      // it rather than starting a second OAuth flow, which Clerk rejects.
      const existingSession = getClerkInstance().session;
      let expectedSessionId: string | null | undefined = existingSession?.id;

      if (!existingSession) {
        const redirectUrl = Platform.OS === 'web'
          ? AuthSession.makeRedirectUri()
          : AuthSession.makeRedirectUri({ scheme: 'daily007', path: 'sso-callback' });
        const sso = await startSSOFlow({
          strategy: 'oauth_google',
          redirectUrl,
        });

        expectedSessionId = sso.createdSessionId;
        if (!expectedSessionId) {
          const resultType = sso.authSessionResult?.type;
          if (resultType === 'cancel' || resultType === 'dismiss') return;
          if (sso.signUp?.status === 'missing_requirements') {
            const fields = sso.signUp.missingFields?.join(', ');
            showError(fields
              ? `Google sign-up needs more information: ${fields}. Please complete those account details and try again.`
              : 'Google sign-up needs additional account details. Please complete them and try again.');
            return;
          }
          showError('Google sign-in did not complete. Please try again.');
          return;
        }

        if (!sso.setActive) {
          showError('Google sign-in completed, but the session could not be activated. Please try again.');
          return;
        }
        await sso.setActive({ session: expectedSessionId });
      }

      const activeSession = getClerkInstance().session;
      if (!expectedSessionId || !activeSession || activeSession.id !== expectedSessionId) {
        showError('Google sign-in finished, but Clerk did not activate the expected session. Please try again.');
        return;
      }
      const clerkJwt = await activeSession.getToken();
      if (!clerkJwt) {
        showError('Google sign-in completed, but a verified Clerk session token was not available. Please try again.');
        return;
      }

      const authenticated = await Api.googleAuth(clerkJwt, {
        ...(dailyToken ? { dailyToken } : {}),
        ...(referralCode?.trim() ? { referralCode: referralCode.trim() } : {}),
      });
      setSession(authenticated.user);
      await onSuccess(authenticated.user);
    } catch (e: any) {
      const message = apiError(e);
      showError(message === 'Network Error'
        ? 'Could not reach Daily007. Check your connection and try again.'
        : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <GoogleButtonFrame label={label} disabled={disabled} loading={busy} onPress={authenticateGoogle} />
      {!!error && !onError && <Msg kind="err" text={error} />}
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
});