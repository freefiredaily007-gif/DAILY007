import React, { useCallback, useMemo, useState } from 'react';
import { Redirect } from 'expo-router';
import { NavigationContainer, NavigationIndependentTree } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ctx, type Ctx as AppContext } from '../App';
import { ReadableText as Text } from '../components/typography';
import { C } from '../components/ui';
import { type User } from '../lib/api';
import {
  mergeNativeTextScaleLayout,
  nativeTextScaleLayoutsFit,
  type NativeTextScaleLayout,
} from '../lib/nativeTextScaleLayout';
import Wallet, {
  type WalletHistoryTestApi,
  type WalletInitialTestSettings,
} from './Wallet';

const Stack = createNativeStackNavigator();

const testUser: User = {
  id: 'android-wallet-text-scale-player',
  name: 'Android Wallet Text Scale Player',
  email: 'android-wallet-text-scale@example.invalid',
  role: 'user',
  status: 'active',
  coins: 123456789,
  token: 'android-wallet-text-scale-token',
  phone: '9876543210',
  gameUid: '123456789012',
  matches: 17,
  wins: 4,
  kills: 123,
  prizeCoins: 250,
};

const walletTestSettings: WalletInitialTestSettings = {
  upiId: 'daily007-test@upi',
  upiQrUrl: 'https://daily007.invalid/test-qr.png',
  rechargeEnabled: true,
  withdrawalEnabled: true,
};

const REQUIRED_LAYOUTS = [
  'wallet:balance-label',
  'wallet:balance',
  'wallet:action:add',
  'wallet:action:withdraw',
  'wallet:filter:all',
  'wallet:filter:deposits',
  'wallet:filter:withdrawals',
  'wallet:filter:refunds',
];

export default function WalletTextScaleNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <WalletTextScaleFixture />;
}

function WalletTextScaleFixture() {
  const { fontScale } = useWindowDimensions();
  const [layouts, setLayouts] = useState<Record<string, NativeTextScaleLayout>>({});
  const layoutVerified = fontScale >= 2 &&
    nativeTextScaleLayoutsFit(layouts, REQUIRED_LAYOUTS);
  const historyTestApi = useMemo<WalletHistoryTestApi>(() => ({
    transactionsPage: async () => ({ items: [], nextCursor: null }),
    myPaymentsPage: async () => ({ items: [], nextCursor: null }),
    myWithdrawals: async () => [],
    settings: async () => ({ settings: walletTestSettings }),
  }), []);

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
  const renderWallet = useCallback(
    () => (
      <Wallet
        historyTestApi={historyTestApi}
        initialTestSettings={walletTestSettings}
        onTextScaleLayout={observeLayout}
      />
    ),
    [historyTestApi, observeLayout],
  );

  return (
    <Ctx.Provider value={context}>
      <View style={styles.screen}>
        <Text testID="wallet-text-scale-banner" style={styles.banner}>
          Wallet text scale fixture · font scale {fontScale.toFixed(2)}
        </Text>
        <Text testID="wallet-text-scale-layout-check" style={styles.check}>
          {layoutVerified
            ? 'Wallet key text fits available widths at 2.00×'
            : 'Checking Wallet text widths at 2.00×'}
        </Text>
        <View style={styles.wallet}>
          <NavigationIndependentTree>
            <NavigationContainer>
              <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Wallet">{renderWallet}</Stack.Screen>
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
  wallet: { flex: 1, minHeight: 0 },
});
