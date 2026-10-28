import React, { useEffect, useMemo, useState } from 'react';
import { Redirect } from 'expo-router';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
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

export default function WithdrawalUpiCopyNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <WithdrawalUpiCopyFixture />;
}

function WithdrawalUpiCopyFixture() {
  const [pastedValues, setPastedValues] = useState<Record<string, string>>({});
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
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'android' ? 'height' : 'padding'}
      >
        <View style={styles.admin}>
          <AdminPayments />
        </View>
        <View style={styles.pasteArea}>
          {FIXTURES.map((fixture, index) => {
            const matches = pastedValues[fixture.id] === fixture.account;
            return (
              <View key={fixture.id} style={styles.pasteCheck}>
                <Text style={styles.label}>
                  {index === 0 ? 'First fixture paste check' : 'Longer fixture paste check'}
                </Text>
                <TextInput
                  accessibilityLabel={`Neutral paste destination ${index + 1}`}
                  autoCapitalize="none"
                  autoCorrect={false}
                  contextMenuHidden={false}
                  onChangeText={(value) => {
                    setPastedValues((current) => ({ ...current, [fixture.id]: value }));
                  }}
                  secureTextEntry
                  testID={`withdrawal-upi-paste-destination-${index + 1}`}
                  value={pastedValues[fixture.id] ?? ''}
                  style={styles.input}
                />
                <Text testID={`withdrawal-upi-paste-check-${index + 1}`}>
                  {matches
                    ? index === 0
                      ? 'First fixture pasted value matches exactly'
                      : 'Longer fixture pasted value matches exactly'
                    : 'Paste the copied value to verify'}
                </Text>
              </View>
            );
          })}
        </View>
      </KeyboardAvoidingView>
    </AdminUiProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  admin: { flex: 1, minHeight: 0 },
  pasteArea: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 10,
    backgroundColor: C.card,
  },
  pasteCheck: { gap: 6 },
  label: { color: C.text, fontWeight: '700' },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: C.text,
    backgroundColor: C.bg,
  },
});
