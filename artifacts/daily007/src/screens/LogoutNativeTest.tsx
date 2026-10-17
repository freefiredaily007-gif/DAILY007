import React, { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationIndependentTree } from '@react-navigation/native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import {
  DailyAppLogoutNativeTest,
  type LogoutNativeTestControls,
} from '../App';
import { getSession, setSession, type User } from '../lib/api';

const SESSION_BACKUP_KEY = 'daily007_native_logout_test_backup';
const FIXTURE_SESSION: User = {
  id: 'native-clerk-logout-player',
  name: 'Native Logout Test Player',
  email: 'native-clerk-logout@daily007.test',
  role: 'admin',
  token: 'native-clerk-logout-token',
};

type Outcome = 'success' | 'failure';

export default function LogoutNativeTest() {
  const { scenario } = useLocalSearchParams<{ scenario?: string }>();
  if (!__DEV__) return <Redirect href="/" />;
  if (scenario === 'cleanup') return <RestorePreviousSession />;
  const outcome = scenario === 'failure' ? 'failure' : 'success';
  return <PrepareLogoutTest key={outcome} outcome={outcome} />;
}

function PrepareLogoutTest({ outcome }: { outcome: Outcome }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [signOutCalls, setSignOutCalls] = useState(0);
  const pendingSignOut = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const existingBackup = await AsyncStorage.getItem(SESSION_BACKUP_KEY);
        if (existingBackup === null) {
          await AsyncStorage.setItem(
            SESSION_BACKUP_KEY,
            JSON.stringify({ session: await getSession() }),
          );
        }
        await setSession(FIXTURE_SESSION);
        if (mounted) setReady(true);
      } catch {
        if (mounted) setError('Could not prepare the saved session for the native logout test.');
      }
    })();
    return () => { mounted = false; };
  }, []);

  const signOutClerk = useCallback((): Promise<void> => {
    setSignOutCalls((count) => count + 1);
    return new Promise<void>((resolve, reject) => {
      pendingSignOut.current = { resolve, reject };
    });
  }, []);

  const finishSignOut = (result: Outcome) => {
    const pending = pendingSignOut.current;
    if (!pending) return;
    pendingSignOut.current = null;
    if (result === 'success') pending.resolve();
    else pending.reject(new Error('Simulated Clerk sign-out failure.'));
  };

  const controls: LogoutNativeTestControls = {
    signOutCalls,
    onResolveClerkSignOut: () => finishSignOut('success'),
    onRejectClerkSignOut: () => finishSignOut('failure'),
  };

  if (error) return <Text testID="logout-test-setup-error">{error}</Text>;
  if (!ready) return <Text testID="logout-test-preparing">Preparing native logout test…</Text>;

  return (
    <NavigationIndependentTree>
      <DailyAppLogoutNativeTest signOutClerk={signOutClerk} controls={controls} />
    </NavigationIndependentTree>
  );
}

function RestorePreviousSession() {
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState('');

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
        if (mounted) setRestored(true);
      } catch (caught) {
        if (mounted) {
          setError(caught instanceof Error ? caught.message : 'Could not restore the previous saved session.');
        }
      }
    })();
    return () => { mounted = false; };
  }, []);

  if (error) return <Text testID="logout-test-cleanup-error">{error}</Text>;
  if (!restored) return <Text testID="logout-test-cleaning">Restoring the previous saved session…</Text>;
  return (
    <View>
      <Text testID="logout-test-cleaned">Previous saved session restored</Text>
    </View>
  );
}
