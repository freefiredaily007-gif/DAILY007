import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import {
  NavigationContainer,
  NavigationIndependentTree,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ctx, type Ctx as AppContext } from '../App';
import { ReadableText as Text } from '../components/typography';
import { C } from '../components/ui';
import { Api } from '../lib/api';
import type { WalletHistoryTestObserver } from './Wallet';
import Wallet from './Wallet';

const Stack = createNativeStackNavigator();

const testUser = {
  id: 'android-wallet-credit-refund-test-player',
  name: 'Wallet Credit and Refund Test Player',
  email: 'wallet-credit-refund-test@example.invalid',
  role: 'user' as const,
  wallet_coins: 137,
  coins: 137,
  phone: '',
  game_uid: '',
  status: 'active',
};

const transactionFixtures = [
  {
    id: 'manual-credit',
    amount: 12,
    balanceAfter: 112,
    createdAt: '2030-02-03T10:20:00.000Z',
    reason: 'admin_credit:entry fee correction',
    description: 'Admin wallet adjustment — entry fee correction',
  },
  {
    id: 'cancellation-refund',
    amount: 25,
    balanceAfter: 137,
    createdAt: '2030-02-03T10:21:00.000Z',
    reason: 'tournament_cancel_refund',
    description: 'Entry fee refunded — Entry Fee Correction Cup (tournament cancelled)',
  },
];

function verifyEntries(items: readonly any[]): string {
  const entries = items.filter((item) => !item.isRequest);
  const manualCredit = entries.find((item) => item.id === 'manual-credit');
  const cancellationRefund = entries.find((item) => item.id === 'cancellation-refund');
  const distinctEntries = entries.length === 2 && manualCredit !== cancellationRefund;
  const manualCreditIsCorrect = manualCredit?.amount === 12 &&
    manualCredit.reason === 'admin_credit:entry fee correction' &&
    manualCredit.description === 'Admin wallet adjustment — entry fee correction';
  const refundIsCorrect = cancellationRefund?.amount === 25 &&
    cancellationRefund.reason === 'tournament_cancel_refund' &&
    cancellationRefund.description ===
      'Entry fee refunded — Entry Fee Correction Cup (tournament cancelled)';

  return distinctEntries && manualCreditIsCorrect && refundIsCorrect
    ? 'Wallet loaded one separate manual credit and one cancellation refund'
    : 'Wallet credit and refund fixture did not match';
}

export default function WalletAdminCreditRefundNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <WalletAdminCreditRefundFixture />;
}

function WalletAdminCreditRefundFixture() {
  const [verification, setVerification] = useState('Loading wallet entries');
  const [apiOriginals] = useState(() => {
    const originals = {
      transactionsPage: Api.transactionsPage,
      myPaymentsPage: Api.myPaymentsPage,
      myWithdrawals: Api.myWithdrawals,
      settings: Api.settings,
    };

    (Api as any).transactionsPage = async () => ({
      items: transactionFixtures,
      nextCursor: null,
    });
    (Api as any).myPaymentsPage = async () => ({ items: [], nextCursor: null });
    (Api as any).myWithdrawals = async () => [];
    (Api as any).settings = async () => ({ settings: {} });
    return originals;
  });

  useEffect(() => () => {
    Api.transactionsPage = apiOriginals.transactionsPage;
    Api.myPaymentsPage = apiOriginals.myPaymentsPage;
    Api.myWithdrawals = apiOriginals.myWithdrawals;
    Api.settings = apiOriginals.settings;
  }, [apiOriginals]);

  const context = useMemo<AppContext>(() => ({
    user: testUser,
    refresh: async () => testUser,
    logout: () => {},
    googleLinkError: '',
    setGoogleLinkError: () => {},
  }), []);
  const observeHistory = useCallback<WalletHistoryTestObserver>((items) => {
    setVerification(verifyEntries(items));
  }, []);
  const renderWallet = useCallback(
    () => <Wallet onHistoryChange={observeHistory} />,
    [observeHistory],
  );

  return (
    <Ctx.Provider value={context}>
      <View style={styles.screen}>
        <Text testID="wallet-credit-refund-fixture-banner" style={styles.text}>
          Manual credit and cancellation refund · local fixture
        </Text>
        <Text testID="wallet-credit-refund-verification" style={styles.text}>
          {verification}
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
  text: { color: C.text, paddingHorizontal: 12, paddingTop: 8 },
  wallet: { flex: 1 },
});
