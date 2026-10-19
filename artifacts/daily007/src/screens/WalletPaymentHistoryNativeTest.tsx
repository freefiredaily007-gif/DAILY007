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

const PAYMENT_COUNT = 405;
const PAGE_SIZE = 200;
const Stack = createNativeStackNavigator();

const testUser = {
  id: 'android-wallet-history-test-player',
  name: 'Android Wallet History Test Player',
  email: 'android-wallet-history-test@example.invalid',
  role: 'user' as const,
  wallet_coins: 0,
  phone: '',
  game_uid: '',
  status: 'active',
};

const paymentRequests = Array.from({ length: PAYMENT_COUNT }, (_, index) => {
  const sequence = PAYMENT_COUNT - index;
  return {
    id: `android-wallet-history-${String(sequence).padStart(3, '0')}`,
    userId: testUser.id,
    amount: 1,
    coins: 1,
    txnId: `ANDROID-HISTORY-${String(sequence).padStart(3, '0')}`,
    status: 'pending',
    createdAt: new Date(Date.UTC(2026, 8, 1) + sequence * 1000).toISOString(),
  };
});

const expectedWalletIds = paymentRequests.map((payment) => `pay-${payment.id}`);

function getPage(cursor?: string) {
  const start = cursor === 'page-1' ? PAGE_SIZE : cursor === 'page-2' ? PAGE_SIZE * 2 : 0;
  const items = paymentRequests.slice(start, start + PAGE_SIZE);
  const nextCursor = start + PAGE_SIZE < paymentRequests.length
    ? `page-${start / PAGE_SIZE + 1}`
    : null;
  return { items, nextCursor };
}

function verifyWalletHistory(
  items: readonly any[],
  cursors: { transactionCursor: string | null; paymentCursor: string | null },
): string {
  const ids = items.map((item) => String(item.id));
  const uniqueIds = new Set(ids);
  const exactOrder = items.every((item, index) =>
    item.id === expectedWalletIds[index] &&
    (index === 0 ||
      Date.parse(String(items[index - 1].createdAt)) >= Date.parse(String(item.createdAt))),
  );
  const valid = ids.length === uniqueIds.size &&
    ids.length <= PAYMENT_COUNT &&
    exactOrder &&
    items.every((item) => item.requestType === 'payment' && item.isRequest);
  const hasMore = Boolean(cursors.paymentCursor || cursors.transactionCursor);
  const expectedHasMore = items.length < PAYMENT_COUNT;

  if (valid && hasMore === expectedHasMore) {
    return `Loaded ${items.length} of ${PAYMENT_COUNT} requests; unique and newest-first`;
  }
  return `History check failed at ${items.length} of ${PAYMENT_COUNT} requests`;
}

export default function WalletPaymentHistoryNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <WalletPaymentHistoryFixture />;
}

function WalletPaymentHistoryFixture() {
  const [verification, setVerification] = useState('Loading 405 payment requests');
  const [apiOriginals] = useState(() => {
    const originals = {
      transactionsPage: Api.transactionsPage,
      myPaymentsPage: Api.myPaymentsPage,
      myWithdrawals: Api.myWithdrawals,
      settings: Api.settings,
    };

    (Api as any).transactionsPage = async () => ({ items: [], nextCursor: null });
    (Api as any).myPaymentsPage = async (cursor?: string) => getPage(cursor);
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
  const observeHistory = useCallback<WalletHistoryTestObserver>((items, cursors) => {
    setVerification(verifyWalletHistory(items, cursors));
  }, []);
  const renderWallet = useCallback(
    () => <Wallet onHistoryChange={observeHistory} />,
    [observeHistory],
  );

  return (
    <Ctx.Provider value={context}>
      <View style={styles.screen}>
        <Text testID="wallet-payment-history-fixture-banner" style={styles.banner}>
          Test account with 405 payment requests
        </Text>
        <Text testID="wallet-payment-history-verification" style={styles.verification}>
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
  banner: { color: C.text, paddingHorizontal: 12, paddingTop: 8 },
  verification: { color: C.text, paddingHorizontal: 12, paddingTop: 4 },
  wallet: { flex: 1 },
});
