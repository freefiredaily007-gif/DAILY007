import React, { useEffect, useMemo, useState } from 'react';
import { Redirect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { AdminUiProvider, C } from '../components/ui';
import { ReadableText as Text } from '../components/typography';
import { Api } from '../lib/api';
import AdminPayments from './AdminPayments';

const FIXTURES = [
  {
    id: 'withdrawal-upi-copy-fixture',
    userId: 'withdrawal-upi-copy-player',
    userName: 'Clipboard Test Player',
    coins: 1,
    method: 'UPI',
    account: 'upi-copy-fixture@daily007.invalid',
    status: 'pending' as const,
    payoutStatus: 'not_paid' as const,
    testOnlyRedactAccount: true,
    reviewReason: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    reviewedAt: null,
  },
  {
    id: 'withdrawal-upi-copy-fixture-long',
    userId: 'withdrawal-upi-copy-player-long',
    userName: 'Long Clipboard Test Player',
    coins: 1,
    method: 'UPI',
    account: 'longer.clipboard-check-2026@daily007.invalid',
    status: 'pending' as const,
    payoutStatus: 'not_paid' as const,
    testOnlyRedactAccount: true,
    reviewReason: null,
    createdAt: '2026-10-01T10:01:00.000Z',
    reviewedAt: null,
  },
];

async function readClipboardUntilMatch(expected: string) {
  let value = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    value = await Clipboard.getStringAsync();
    if (value === expected) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return value;
}

export default function WithdrawalUpiCopyNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <WithdrawalUpiCopyFixture />;
}

function WithdrawalUpiCopyFixture() {
  const [clipboardValues, setClipboardValues] = useState<Record<string, string>>({});
  const originalApi = useMemo(() => ({
    adminPayments: Api.adminPayments,
    adminWithdrawals: Api.adminWithdrawals,
    adminSettings: Api.adminSettings,
  }), []);

  // Use the real AdminPayments screen and clipboard API, but never contact the API server.
  (Api as any).adminPayments = async () => [];
  (Api as any).adminWithdrawals = async () => FIXTURES;
  (Api as any).adminSettings = async () => ({ settings: { coinToMoneyRate: 1 } });

  useEffect(() => () => {
    Api.adminPayments = originalApi.adminPayments;
    Api.adminWithdrawals = originalApi.adminWithdrawals;
    Api.adminSettings = originalApi.adminSettings;
  }, [originalApi]);

  return (
    <AdminUiProvider>
      <View style={styles.screen}>
        <View style={styles.admin}>
          <AdminPayments />
        </View>
        <ScrollView
          style={styles.pasteAreaScroll}
          contentContainerStyle={styles.pasteArea}
        >
          {FIXTURES.map((fixture, index) => {
            const matches = clipboardValues[fixture.id] === fixture.account;
            return (
              <View key={fixture.id} style={styles.pasteCheck}>
                <Text style={styles.label}>
                  {index === 0 ? 'First fixture clipboard check' : 'Longer fixture clipboard check'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={async () => {
                    const value = await readClipboardUntilMatch(fixture.account);
                    setClipboardValues((current) => ({ ...current, [fixture.id]: value }));
                  }}
                  style={styles.verifyButton}
                  testID={`withdrawal-upi-clipboard-check-${index + 1}`}
                >
                  <Text style={styles.verifyButtonText}>VERIFY COPIED VALUE</Text>
                </Pressable>
                <Text testID={`withdrawal-upi-clipboard-result-${index + 1}`}>
                  {matches
                    ? index === 0
                      ? 'First fixture clipboard value matches exactly'
                      : 'Longer fixture clipboard value matches exactly'
                    : 'Check the copied clipboard value'}
                </Text>
                {!matches && clipboardValues[fixture.id] !== undefined ? (
                  <Text
                    style={styles.debugReadback}
                    testID={`withdrawal-upi-clipboard-readback-${index + 1}`}
                  >
                    Readback: {JSON.stringify(clipboardValues[fixture.id])}
                  </Text>
                ) : null}
              </View>
            );
          })}
          <View
            accessible
            accessibilityLabel="Clipboard test scroll end"
            testID="withdrawal-upi-clipboard-trailing-space"
            style={styles.trailingScrollSpace}
          />
        </ScrollView>
      </View>
    </AdminUiProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  admin: { flex: 1, minHeight: 0 },
  pasteAreaScroll: { height: 240, flexGrow: 0, backgroundColor: C.card },
  pasteArea: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 10,
    backgroundColor: C.card,
  },
  trailingScrollSpace: { height: 240 },
  pasteCheck: { gap: 6 },
  label: { color: C.text, fontWeight: '700' },
  debugReadback: { color: C.sub, fontSize: 12 },
  verifyButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: C.card,
  },
  verifyButtonText: { color: C.text, fontWeight: '700' },
});
