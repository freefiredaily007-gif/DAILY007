import React, { useEffect, useMemo, useState } from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, TextInput, View } from 'react-native';
import { AdminUiProvider, C } from '../components/ui';
import { ReadableText as Text } from '../components/typography';
import { Api } from '../lib/api';
import AdminPayments from './AdminPayments';

const FIXTURE = {
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
};

export default function WithdrawalUpiCopyNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <WithdrawalUpiCopyFixture />;
}

function WithdrawalUpiCopyFixture() {
  const [pastedValue, setPastedValue] = useState('');
  const [matches, setMatches] = useState(false);
  const originalApi = useMemo(() => ({
    adminPayments: Api.adminPayments,
    adminWithdrawals: Api.adminWithdrawals,
    adminSettings: Api.adminSettings,
  }), []);

  // Use the real AdminPayments screen and clipboard API, but never contact the API server.
  (Api as any).adminPayments = async () => [];
  (Api as any).adminWithdrawals = async () => [FIXTURE];
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
        <View style={styles.pasteArea}>
          <Text style={styles.label}>Neutral paste check</Text>
          <TextInput
            accessibilityLabel="Neutral paste destination"
            autoCapitalize="none"
            autoCorrect={false}
            contextMenuHidden={false}
            onChangeText={(value) => {
              setPastedValue(value);
              setMatches(value === FIXTURE.account);
            }}
            secureTextEntry
            testID="withdrawal-upi-paste-destination"
            value={pastedValue}
            style={styles.input}
          />
          <Text testID="withdrawal-upi-paste-check">
            {matches ? 'Pasted value matches exactly' : 'Paste the copied value to verify'}
          </Text>
        </View>
      </View>
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
    gap: 6,
    backgroundColor: C.card,
  },
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
