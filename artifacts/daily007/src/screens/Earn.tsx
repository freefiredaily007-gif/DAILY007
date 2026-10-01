import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useDaily007GetMyReferrals } from '@workspace/api-client-react';
import { C } from '../components/ui';
import { apiError } from '../lib/api';

const rechargeStatusLabel: Record<string, string> = {
  rewarded: 'Approved recharge · reward credited',
  awaiting_approval: 'Recharge submitted · awaiting admin approval',
  eligible_unrewarded: 'Approved recharge · reward not credited',
  below_minimum: 'Recharge below the 50-coin minimum',
  not_started: 'No qualifying recharge yet',
};

export default function Earn() {
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState('');
  const referralsQuery = useDaily007GetMyReferrals();
  const dashboard = referralsQuery.data;
  const referrals = dashboard?.referrals ?? [];

  const copyCode = async () => {
    if (!dashboard?.code) return;
    try {
      await Clipboard.setStringAsync(dashboard.code);
      setCopied(true);
      Alert.alert('Referral code copied', 'Share it with a friend when they create their account.');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setActionError('Could not copy the referral code. Try the share button instead.');
    }
  };

  const shareInvite = async () => {
    if (!dashboard?.code) return;
    setActionError('');
    try {
      await Share.share({
        message: `Join FreeFire Daily007 with my referral code ${dashboard.code} and get 10 bonus coins. I get 5 coins after your first approved recharge of at least 50 coins.\n\nOpen Daily007: ${dashboard.referralLink}`,
      });
    } catch {
      setActionError('Could not open the share sheet. You can copy the code instead.');
    }
  };

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={referralsQuery.isRefetching}
          onRefresh={() => { void referralsQuery.refetch(); }}
          tintColor={C.gold}
        />
      }
    >
      <Text style={s.title}>EARN COINS</Text>
      <Text style={s.subtitle}>Invite friends and track referral rewards</Text>

      <View style={s.ruleCard}>
        <View style={s.ruleRow}>
          <Feather name="gift" size={18} color={C.gold} />
          <Text style={s.ruleTitle}>10 coins for your friend at signup</Text>
        </View>
        <Text style={s.ruleText}>You earn 5 coins once their recharge of at least 50 coins is approved by an administrator.</Text>
      </View>

      {referralsQuery.isPending && !dashboard ? (
        <View style={s.loading}>
          <ActivityIndicator color={C.gold} />
          <Text style={s.muted}>Loading your referral dashboard…</Text>
        </View>
      ) : null}

      {!!referralsQuery.error && (
        <Text style={s.error}>{`Referral data unavailable: ${apiError(referralsQuery.error)}`}</Text>
      )}
      {!!actionError && <Text style={s.error}>{actionError}</Text>}

      {!!dashboard && (
        <>
          <View style={s.codeCard}>
            <Text style={s.sectionLabel}>YOUR REFERRAL CODE</Text>
            <View style={s.codeRow}>
              <Text selectable style={s.code}>{dashboard.code}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copied ? 'Referral code copied' : 'Copy referral code'}
                testID="referral-copy-code"
                onPress={copyCode}
                style={s.iconButton}
              >
                <Feather name={copied ? 'check' : 'copy'} size={18} color={C.gold} />
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              testID="referral-share-invite"
              onPress={shareInvite}
              style={s.shareButton}
            >
              <Feather name="share-2" size={16} color={C.bg} />
              <Text style={s.shareButtonText}>SHARE INVITE LINK</Text>
            </Pressable>
          </View>

          <View style={s.statsGrid}>
            <Stat label="PEOPLE INVITED" value={dashboard.totalPeopleReferred} />
            <Stat label="SUCCESSFUL" value={dashboard.successfulReferrals} />
            <Stat label="PENDING" value={dashboard.pendingReferrals} />
            <Stat label="COINS EARNED" value={dashboard.totalReferralCoinsEarned} />
          </View>

          <Text style={s.sectionHeading}>MY REFERRALS ({dashboard.totalPeopleReferred})</Text>
          {referrals.length === 0 ? (
            <View style={s.emptyCard}>
              <Feather name="users" size={22} color={C.dim} />
              <Text style={s.emptyTitle}>No referrals yet</Text>
              <Text style={s.muted}>Share your code or invite link. New players get 10 coins when they sign up with it.</Text>
            </View>
          ) : (
            referrals.map((referral) => {
              const rewarded = referral.referrerRewardStatus === 'credited';
              const rechargeStatus = rechargeStatusLabel[referral.firstRechargeStatus] ?? 'Recharge status unavailable';
              return (
                <View key={referral.id} style={s.referralCard}>
                  <View style={s.referralHeader}>
                    <View style={s.referralIdentity}>
                      <Text style={s.referralName}>{referral.referredName}</Text>
                      <Text selectable style={s.referralId}>ID {referral.referredUserId}</Text>
                    </View>
                    <View style={[s.statusPill, rewarded ? s.statusSuccess : s.statusPending]}>
                      <Feather name={rewarded ? 'check-circle' : 'clock'} size={13} color={rewarded ? C.green : C.gold} />
                      <Text style={[s.statusText, { color: rewarded ? C.green : C.gold }]}>
                        {rewarded ? 'REWARDED' : 'PENDING'}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.detailText}>Signup: {referral.signupStatus === 'complete' ? 'Complete' : referral.signupStatus}</Text>
                  <Text style={s.detailText}>
                    Signup bonus: {referral.signupBonusStatus === 'credited' ? '10 coins credited' : 'Not credited'}
                  </Text>
                  <Text style={s.detailText}>First qualifying recharge: {rechargeStatus}</Text>
                  <Text style={s.detailText}>
                    Your 5-coin reward: {rewarded ? 'Credited' : 'Pending approved recharge of 50+ coins'}
                  </Text>
                  {referral.qualifyingPaymentId ? (
                    <Text selectable style={s.paymentId}>Recharge transaction ID: {referral.qualifyingPaymentId}</Text>
                  ) : null}
                </View>
              );
            })
          )}
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 14, paddingBottom: 100 },
  title: { color: C.text, fontSize: 22, fontWeight: '900', letterSpacing: 1, marginTop: 16 },
  subtitle: { color: C.sub, fontSize: 12, marginTop: 3, marginBottom: 14 },
  ruleCard: { backgroundColor: C.card2, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ruleTitle: { color: C.gold, fontSize: 13, fontWeight: '800', flex: 1 },
  ruleText: { color: C.sub, fontSize: 12, lineHeight: 18, marginTop: 7 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 18 },
  muted: { color: C.sub, fontSize: 12, lineHeight: 18, marginTop: 4 },
  error: { color: C.red, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  codeCard: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: `${C.gold}77`, marginBottom: 14 },
  sectionLabel: { color: C.gold, fontWeight: '900', letterSpacing: 1.4, fontSize: 11 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  code: { flex: 1, color: C.gold, fontWeight: '900', fontSize: 17, letterSpacing: 1.4, backgroundColor: C.bg2, borderRadius: 10, borderWidth: 1, borderColor: C.border, textAlign: 'center', paddingVertical: 12 },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  shareButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.gold, borderRadius: 10, paddingVertical: 12, marginTop: 10 },
  shareButtonText: { color: C.bg, fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  statCard: { width: '48.5%', minHeight: 72, backgroundColor: C.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border },
  statValue: { color: C.text, fontSize: 20, fontWeight: '900' },
  statLabel: { color: C.sub, fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginTop: 4 },
  sectionHeading: { color: C.sub, fontSize: 11, fontWeight: '900', letterSpacing: 1.3, marginBottom: 10 },
  emptyCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 18, alignItems: 'center' },
  emptyTitle: { color: C.text, fontWeight: '800', fontSize: 13, marginTop: 8 },
  referralCard: { backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  referralHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  referralIdentity: { flex: 1, minWidth: 0 },
  referralName: { color: C.text, fontSize: 14, fontWeight: '800' },
  referralId: { color: C.dim, fontSize: 9, marginTop: 3 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 5 },
  statusSuccess: { borderColor: `${C.green}66`, backgroundColor: `${C.green}12` },
  statusPending: { borderColor: `${C.gold}66`, backgroundColor: `${C.gold}12` },
  statusText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  detailText: { color: C.sub, fontSize: 11, lineHeight: 16, marginTop: 4 },
  paymentId: { color: C.gold, fontSize: 9, lineHeight: 14, marginTop: 7 },
});