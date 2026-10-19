import React, { useEffect, useRef, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { NavigationIndependentTree } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import * as AuthSession from 'expo-auth-session';
import * as Network from 'expo-network';
import * as WebBrowser from 'expo-web-browser';
import { StyleSheet, View } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { DailyAppGoogleLinkNativeTest } from '../App';
import type { GoogleSSONativeTestHarness } from '../components/GoogleSSOButton';
import { getSession, http, setSession, type User } from '../lib/api';

const SESSION_BACKUP_KEY = 'daily007_native_google_link_test_backup';
const FIXTURE_SESSION: User = {
  id: 'native-google-link-player',
  name: 'Native Google Link Player',
  email: 'native-google-link@daily007.test',
  role: 'user',
  coins: 42,
  token: 'native-google-link-password-token',
};
const CLERK_TEST_TOKEN = 'native-google-link-clerk-test-token';
const CALLBACK_TEST_TOKEN = 'native-google-link-callback-test-token';

type Diagnostics = {
  phase: string;
  oauthHandoffs: number;
  exchanges: number;
  firstExchange: string;
  secondExchange: string;
  sessionId: string;
  sessionCoins: string;
  sessionToken: string;
  passwordTokenChecks: number;
  invalidPasswordTokenChecks: number;
  linkTokenChecks: number;
  invalidLinkTokenChecks: number;
};

const initialDiagnostics: Diagnostics = {
  phase: 'preparing',
  oauthHandoffs: 0,
  exchanges: 0,
  firstExchange: 'not started',
  secondExchange: 'not started',
  sessionId: '—',
  sessionCoins: '—',
  sessionToken: '—',
  passwordTokenChecks: 0,
  invalidPasswordTokenChecks: 0,
  linkTokenChecks: 0,
  invalidLinkTokenChecks: 0,
};

function requestHeader(config: InternalAxiosRequestConfig, name: string): string | undefined {
  const headers = config.headers;
  const value = typeof headers.get === 'function'
    ? headers.get(name)
    : headers[name] ?? headers[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
}

function makeResponse(config: InternalAxiosRequestConfig, data: unknown) {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
}

export default function GoogleLinkNativeTest() {
  const { scenario } = useLocalSearchParams<{ scenario?: string }>();
  if (!__DEV__) return <Redirect href="/" />;
  if (scenario === 'cleanup') return <RestorePreviousSession />;
  return <GoogleLinkNativeTestFixture />;
}

function GoogleLinkNativeTestFixture() {
  const [ready, setReady] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [diagnostics, setDiagnostics] = useState(initialDiagnostics);
  const stateRef = useRef(diagnostics);
  const activeGoogleSession = useRef<{
    id: string;
    getToken: () => Promise<string>;
  } | null>(null);
  const googleLinked = useRef(false);

  const updateDiagnostics = (updates: Partial<Diagnostics>) => {
    const next = { ...stateRef.current, ...updates };
    stateRef.current = next;
    setDiagnostics(next);
  };

  useEffect(() => {
    let mounted = true;
    const previousAdapter = http.defaults.adapter;
    let previousSession: User | null = null;

    const captureSession = async () => {
      const session = await getSession();
      updateDiagnostics({
        sessionId: session?.id ?? session?.$id ?? 'none',
        sessionCoins: String(session?.coins ?? 'none'),
        sessionToken: session?.token === FIXTURE_SESSION.token ? 'password token preserved' : 'changed',
      });
    };

    const adapter = async (config: InternalAxiosRequestConfig) => {
      const path = String(config.url ?? '').split('?')[0];
      const isGoogleExchange = path.endsWith('/auth/google');
      if (isGoogleExchange) {
        const attempt = stateRef.current.exchanges + 1;
        const validGoogleBearer = requestHeader(config, 'Authorization') === `Bearer ${CLERK_TEST_TOKEN}`;
        const validPasswordBearer = requestHeader(config, 'X-Daily007-Token') === FIXTURE_SESSION.token;
        updateDiagnostics({
          exchanges: attempt,
          firstExchange: attempt === 1 ? 'in progress' : stateRef.current.firstExchange,
          secondExchange: attempt === 2 ? 'in progress' : stateRef.current.secondExchange,
          linkTokenChecks: stateRef.current.linkTokenChecks + 1,
          invalidLinkTokenChecks: stateRef.current.invalidLinkTokenChecks + (validPasswordBearer ? 0 : 1),
        });
        if (!validGoogleBearer) {
          throw new Error('Native Google link test received an unexpected Google bearer token.');
        }
        if (!validPasswordBearer) {
          throw new Error('Native Google link test did not receive the original Daily007 password token.');
        }

        const network = await Network.getNetworkStateAsync();
        if (network.isConnected !== true || network.isInternetReachable === false) {
          updateDiagnostics({
            firstExchange: attempt === 1 ? 'failed while Android was offline' : stateRef.current.firstExchange,
            secondExchange: attempt === 2 ? 'failed while Android was offline' : stateRef.current.secondExchange,
            phase: 'native callback returned; exchange failed offline',
          });
          await captureSession();
          throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
        }

        googleLinked.current = true;
        updateDiagnostics({
          firstExchange: attempt === 1 ? 'succeeded online' : stateRef.current.firstExchange,
          secondExchange: attempt === 2 ? 'succeeded online' : stateRef.current.secondExchange,
          phase: 'Google link exchange succeeded',
        });
        return makeResponse(config, {
          ...FIXTURE_SESSION,
          googleLinked: true,
        });
      }

      const authorization = requestHeader(config, 'Authorization');
      const protectedRequest = !path.endsWith('/settings') &&
        !path.endsWith('/daily007/v2/admin/bootstrap-status');
      if (protectedRequest && path !== '/auth/google') {
        const valid = authorization === `Bearer ${FIXTURE_SESSION.token}`;
        updateDiagnostics({
          passwordTokenChecks: stateRef.current.passwordTokenChecks + 1,
          invalidPasswordTokenChecks: stateRef.current.invalidPasswordTokenChecks + (valid ? 0 : 1),
        });
      }

      if (path.endsWith('/auth/me')) {
        return makeResponse(config, { ...FIXTURE_SESSION, googleLinked: googleLinked.current });
      }
      if (path.endsWith('/me/stats')) {
        return makeResponse(config, { matches: 3, wins: 1, kills: 7, prizeCoins: 0 });
      }
      if (path.endsWith('/wallet/transactions') || path.endsWith('/my/payments')) {
        return makeResponse(config, { items: [], nextCursor: null });
      }
      if (path.endsWith('/my/withdrawals')) return makeResponse(config, []);
      if (path.endsWith('/settings')) return makeResponse(config, {});
      if (path.endsWith('/daily007/v2/admin/bootstrap-status')) {
        return makeResponse(config, { available: false });
      }
      if (path.endsWith('/tournaments') || path.endsWith('/my/registrations')) {
        return makeResponse(config, []);
      }
      return makeResponse(config, {});
    };

    void (async () => {
      try {
        previousSession = await getSession();
        const oldBackup = await AsyncStorage.getItem(SESSION_BACKUP_KEY);
        if (oldBackup === null) {
          await AsyncStorage.setItem(
            SESSION_BACKUP_KEY,
            JSON.stringify({ session: previousSession }),
          );
        }
        await setSession(FIXTURE_SESSION);
        http.defaults.adapter = adapter;
        await captureSession();
        if (mounted) {
          updateDiagnostics({ phase: 'ready' });
          setReady(true);
        }
      } catch {
        if (mounted) setSetupError('Could not prepare the native Google-link test session.');
      }
    })();

    return () => {
      mounted = false;
      http.defaults.adapter = previousAdapter;
    };
  }, []);

  const nativeTestHarness: GoogleSSONativeTestHarness = {
    getActiveSession: () => activeGoogleSession.current,
    startSSOFlow: async (redirectUrl) => {
      const authUrl = process.env.EXPO_PUBLIC_GOOGLE_LINK_TEST_AUTH_URL;
      if (!authUrl) throw new Error('The native Google OAuth test page is not configured.');
      const authPageUrl = `${authUrl}?redirect_uri=${encodeURIComponent(redirectUrl)}`;
      const result = await WebBrowser.openAuthSessionAsync(authPageUrl, redirectUrl);
      if (result.type !== 'success') {
        return { authSessionResult: { type: result.type === 'cancel' ? 'cancel' : 'dismiss' } };
      }
      const callback = new URL(result.url);
      if (callback.searchParams.get('native_google_link_token') !== CALLBACK_TEST_TOKEN) {
        throw new Error('The Android Google OAuth test callback was not verified.');
      }
      updateDiagnostics({
        oauthHandoffs: stateRef.current.oauthHandoffs + 1,
        phase: 'native OAuth callback returned to Daily007',
      });
      return {
        createdSessionId: 'native-google-link-clerk-session',
        setActive: async ({ session }) => {
          if (session !== 'native-google-link-clerk-session') {
            throw new Error('The native test Google session ID did not match.');
          }
          activeGoogleSession.current = {
            id: session,
            getToken: async () => CLERK_TEST_TOKEN,
          };
        },
      };
    },
  };

  if (setupError) return <Text testID="google-link-native-setup-error">{setupError}</Text>;
  if (!ready) return <Text testID="google-link-native-preparing">Preparing native Google-link test…</Text>;

  return (
    <View style={s.page}>
      <View style={s.diagnostics}>
        <Text testID="google-link-native-phase">Native test: {diagnostics.phase}</Text>
        <Text testID="google-link-native-oauth-count">OAuth handoffs: {diagnostics.oauthHandoffs}</Text>
        <Text testID="google-link-native-exchange-count">Google exchanges: {diagnostics.exchanges}</Text>
        <Text testID="google-link-native-first-exchange">First exchange: {diagnostics.firstExchange}</Text>
        <Text testID="google-link-native-second-exchange">Second exchange: {diagnostics.secondExchange}</Text>
        <Text testID="google-link-native-session-id">Daily007 account: {diagnostics.sessionId}</Text>
        <Text testID="google-link-native-session-coins">Saved wallet: {diagnostics.sessionCoins} coins</Text>
        <Text testID="google-link-native-session-token">Password bearer: {diagnostics.sessionToken}</Text>
        <Text testID="google-link-native-request-checks">
          Protected API requests kept password bearer: {diagnostics.passwordTokenChecks > 0 && diagnostics.invalidPasswordTokenChecks === 0 ? 'yes' : 'no'}
        </Text>
        <Text testID="google-link-native-link-token-checks">
          Link requests kept password token: {diagnostics.linkTokenChecks - diagnostics.invalidLinkTokenChecks}/{diagnostics.linkTokenChecks}
        </Text>
      </View>
      <View style={s.app}>
        <NavigationIndependentTree>
          <DailyAppGoogleLinkNativeTest harness={nativeTestHarness} />
        </NavigationIndependentTree>
      </View>
    </View>
  );
}

function RestorePreviousSession() {
  const [message, setMessage] = useState('Restoring the previous saved session…');

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const rawBackup = await AsyncStorage.getItem(SESSION_BACKUP_KEY);
        if (rawBackup === null) throw new Error('No saved-session backup is available.');
        const backup = JSON.parse(rawBackup) as { session?: User | null };
        if (!Object.prototype.hasOwnProperty.call(backup, 'session')) {
          throw new Error('The saved-session backup is invalid.');
        }
        await setSession(backup.session ?? null);
        await AsyncStorage.removeItem(SESSION_BACKUP_KEY);
        if (mounted) setMessage('Previous saved session restored');
      } catch (error) {
        if (mounted) {
          setMessage(error instanceof Error ? error.message : 'Could not restore the previous session.');
        }
      }
    })();
    return () => { mounted = false; };
  }, []);

  return <Text testID="google-link-native-cleaned">{message}</Text>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#070a12' },
  diagnostics: { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 4, backgroundColor: '#10162b' },
  app: { flex: 1 },
});
