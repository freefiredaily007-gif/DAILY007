import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import * as Network from 'expo-network';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { ReadableText as Text } from '../components/typography';
import { SessionVerificationPaused } from '../components/SessionVerificationPaused';
import type { User } from '../lib/api';
import {
  restoreDaily007Session,
  subscribeToSessionVerificationRecovery,
} from '../lib/session-verification';

const FIXTURE_SESSION: User = {
  id: 'native-session-recovery-player',
  name: 'Native Session Recovery Player',
  email: 'native-session-recovery@daily007.test',
  token: 'native-session-recovery-token',
};

type Scenario = 'network' | 'resume' | 'transient';

export default function SessionVerificationNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <NativeSessionVerificationFixture />;
}

function NativeSessionVerificationFixture() {
  const { scenario: requestedScenario } = useLocalSearchParams<{ scenario?: string }>();
  const scenario: Scenario = requestedScenario === 'resume' || requestedScenario === 'transient'
    ? requestedScenario
    : 'network';
  const savedSession = useRef<User | null>(FIXTURE_SESSION);
  const verificationRequest = useRef<Promise<void> | null>(null);
  const verificationAttempts = useRef(0);
  const manualRetry = useRef(false);
  const [verificationSession, setVerificationSession] = useState<User | null>(null);
  const [verifiedSession, setVerifiedSession] = useState<User | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [booting, setBooting] = useState(true);

  const persistSession = useCallback(async (session: User | null) => {
    savedSession.current = session;
  }, []);

  const verifyWithApi = useCallback(async (): Promise<User> => {
    const attempt = verificationAttempts.current + 1;
    verificationAttempts.current = attempt;
    setAttemptCount(attempt);

    const networkState = await Network.getNetworkStateAsync();
    if (networkState.isConnected !== true || networkState.isInternetReachable === false) {
      throw new Error('Fixture verification is temporarily unavailable while offline.');
    }
    if (scenario === 'resume' && AppState.currentState !== 'active') {
      throw new Error('Fixture verification waits until the app returns to the foreground.');
    }
    if (scenario === 'transient' && attempt <= 2) {
      throw Object.assign(new Error('Temporary fixture server error.'), {
        response: { status: 503 },
      });
    }
    return {
      ...FIXTURE_SESSION,
      name: 'Verified Native Test Player',
      token: undefined,
    };
  }, [scenario]);

  const retrySessionVerification = useCallback((): Promise<void> => {
    if (verificationRequest.current) return verificationRequest.current;
    const session = verificationSession;
    if (!session) return Promise.resolve();

    setRetrying(true);
    const request = (async () => {
      try {
        const result = await restoreDaily007Session(
          async () => session,
          verifyWithApi,
          persistSession,
        );
        if (result.status === 'verified') {
          setVerificationSession(null);
          setVerifiedSession(result.session);
        } else if (result.status === 'rejected' || result.status === 'empty') {
          setVerificationSession(null);
          setVerifiedSession(null);
        } else {
          setVerificationSession(result.session);
        }
      } catch {
        setVerificationSession(session);
      } finally {
        setRetrying(false);
      }
    })();
    verificationRequest.current = request;
    void request.finally(() => {
      if (verificationRequest.current === request) verificationRequest.current = null;
    });
    return request;
  }, [persistSession, verificationSession, verifyWithApi]);

  useEffect(() => {
    let mounted = true;
    void restoreDaily007Session(
      async () => savedSession.current,
      verifyWithApi,
      persistSession,
    ).then((result) => {
      if (!mounted) return;
      if (result.status === 'verified') setVerifiedSession(result.session);
      else if (result.status === 'retry') setVerificationSession(result.session);
      else if (result.status === 'rejected' || result.status === 'empty') {
        setVerificationSession(null);
        setVerifiedSession(null);
      }
    }).finally(() => {
      if (mounted) setBooting(false);
    });
    return () => { mounted = false; };
  }, [persistSession, verifyWithApi]);

  useEffect(
    () => subscribeToSessionVerificationRecovery(
      !!verificationSession,
      () => { void retrySessionVerification(); },
      Network,
      AppState,
    ),
    [retrySessionVerification, verificationSession],
  );

  if (booting) {
    return <Text testID="session-verification-test-loading">Checking saved test session…</Text>;
  }

  if (verifiedSession) {
    return (
      <View style={{ flex: 1, backgroundColor: '#070a12', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text testID="session-verification-test-verified" style={{ color: '#FFD54D', fontSize: 20, fontWeight: '900' }}>
          Saved session automatically verified
        </Text>
        <Text style={{ color: '#F5F7FF', marginTop: 12 }}>{verifiedSession.name}</Text>
        <Text testID="session-verification-test-no-manual-retry" style={{ color: '#F5F7FF', marginTop: 8 }}>
          {manualRetry.current ? 'Verified after tapping Retry' : 'Verified without tapping Retry'}
        </Text>
        <Text testID="session-verification-test-attempt-count" style={{ color: '#F5F7FF', marginTop: 8 }}>
          Verification attempts: {attemptCount}
        </Text>
      </View>
    );
  }

  if (verificationSession) {
    return (
      <SessionVerificationPaused
        onRetry={() => {
          manualRetry.current = true;
          void retrySessionVerification();
        }}
        retrying={retrying}
      >
        <Text testID="session-verification-test-saved-token" style={{ color: '#F5F7FF', marginTop: 16 }}>
          Saved test session token: {savedSession.current?.token ?? 'missing'}
        </Text>
        <Text testID="session-verification-test-attempt-count" style={{ color: '#F5F7FF', marginTop: 8 }}>
          Verification attempts: {attemptCount}
        </Text>
        {!retrying && (
          <Text testID="session-verification-test-retry-ready" style={{ color: '#F5F7FF', marginTop: 8 }}>
            Retry is available
          </Text>
        )}
      </SessionVerificationPaused>
    );
  }

  return <Text testID="session-verification-test-unavailable">No saved test session is available.</Text>;
}
