import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Redirect } from 'expo-router';
import { NavigationContainer, NavigationIndependentTree } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ctx, type Ctx as AppContext } from '../App';
import { ReadableText as Text } from '../components/typography';
import { C } from '../components/ui';
import { Api, type User } from '../lib/api';
import {
  mergeNativeTextScaleLayout,
  nativeTextScaleLayoutsFit,
  type NativeTextScaleLayout,
} from '../lib/nativeTextScaleLayout';
import Profile from './Profile';

const Stack = createNativeStackNavigator();

const testUser: User = {
  id: 'android-profile-text-scale-player',
  name: 'International Free Fire Champion With A Long Player Name',
  email: 'android-player-text-scale@daily007-test.example.invalid',
  role: 'user',
  status: 'active',
  coins: 123456789,
  token: 'android-profile-text-scale-token',
  phone: '9876543210',
  gameUid: '123456789012',
  createdAt: '2024-01-15T00:00:00.000Z',
  matches: 123456,
  wins: 9876,
  kills: 1234567,
  prizeCoins: 123456789,
};

const REQUIRED_LAYOUTS = [
  'profile:name',
  'profile:email',
  'profile:game-uid',
  'profile:stat:matches:value',
  'profile:stat:matches:label',
  'profile:stat:wins:value',
  'profile:stat:wins:label',
  'profile:stat:kills:value',
  'profile:stat:kills:label',
  'profile:stat:prizes:value',
  'profile:stat:prizes:label',
  'profile:action:password',
];

export default function ProfileTextScaleNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <ProfileTextScaleFixture />;
}

function ProfileTextScaleFixture() {
  const { fontScale } = useWindowDimensions();
  const [layouts, setLayouts] = useState<Record<string, NativeTextScaleLayout>>({});
  const layoutVerified = fontScale >= 2 &&
    nativeTextScaleLayoutsFit(layouts, REQUIRED_LAYOUTS);
  const [apiOriginals] = useState(() => {
    const originals = {
      adminBootstrapStatus: Api.adminBootstrapStatus,
      googleLinkStatus: Api.googleLinkStatus,
    };
    (Api as any).adminBootstrapStatus = async () => ({ available: false });
    (Api as any).googleLinkStatus = async () => true;
    return originals;
  });

  useEffect(() => () => {
    Api.adminBootstrapStatus = apiOriginals.adminBootstrapStatus;
    Api.googleLinkStatus = apiOriginals.googleLinkStatus;
  }, [apiOriginals]);

  const context = useMemo<AppContext>(() => ({
    user: testUser,
    refresh: async () => testUser,
    logout: () => {},
    googleLinkError: '',
    setGoogleLinkError: () => {},
  }), []);
  const observeLayout = useCallback((key: string, update: NativeTextScaleLayout) => {
    setLayouts((current) => mergeNativeTextScaleLayout(current, key, update));
  }, []);
  const renderProfile = useCallback(
    () => <Profile onTextScaleLayout={observeLayout} />,
    [observeLayout],
  );

  return (
    <Ctx.Provider value={context}>
      <View style={styles.screen}>
        <Text testID="profile-text-scale-banner" style={styles.banner}>
          Profile text scale fixture · font scale {fontScale.toFixed(2)}
        </Text>
        <Text testID="profile-text-scale-layout-check" style={styles.check}>
          {layoutVerified
            ? 'Profile key text fits available widths at 2.00×'
            : 'Checking Profile text widths at 2.00×'}
        </Text>
        <View style={styles.profile}>
          <NavigationIndependentTree>
            <NavigationContainer>
              <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Profile">{renderProfile}</Stack.Screen>
              </Stack.Navigator>
            </NavigationContainer>
          </NavigationIndependentTree>
        </View>
      </View>
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  banner: { color: C.text, paddingHorizontal: 10, paddingTop: 4 },
  check: { color: C.sub, paddingHorizontal: 10, paddingVertical: 2, fontSize: 10 },
  profile: { flex: 1, minHeight: 0 },
});
