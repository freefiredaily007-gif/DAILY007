import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  ActivityIndicator,
  AccessibilityInfo,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { ReadableText as Text } from '../components/typography';
import {
  useDaily007GetMyReferrals,
  useDaily007GetYoutubeSubscribeTask,
  useDaily007SubmitYoutubeSubscribeClaim,
} from '@workspace/api-client-react';
import { C } from '../components/ui';
import { apiError } from '../lib/api';
import {
  copyReferralLinkToClipboardWithFallback,
  openReferralInBrowserWithFallback,
  shareReferralInviteWithFallback,
} from '../lib/referral-invite';

const rechargeStatusLabel: Record<string, string> = {
  rewarded: 'Approved recharge · reward credited',
  awaiting_approval: 'Recharge submitted · awaiting admin approval',
  eligible_unrewarded: 'Approved recharge · reward not credited',
  below_minimum: 'Recharge below the 50-coin minimum',
  not_started: 'No qualifying recharge yet',
};

export default function Earn() {
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [actionError, setActionError] = useState('');
  const [simulateReferralBrowserOpenFailure, setSimulateReferralBrowserOpenFailure] = useState(false);
  const [simulateReferralCodeCopyFailure, setSimulateReferralCodeCopyFailure] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [returnedFromYoutube, setReturnedFromYoutube] = useState(false);
  const waitingForYoutubeReturn = useRef(false);
  const appState = useRef(AppState.currentState);
  const referralsQuery = useDaily007GetMyReferrals();
  const youtubeTaskQuery = useDaily007GetYoutubeSubscribeTask();
  const submitYoutubeClaim = useDaily007SubmitYoutubeSubscribeClaim();
  const dashboard = referralsQuery.data;
  const referrals = dashboard?.referrals ?? [];
  const youtubeTask = youtubeTaskQuery.data;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returnedToApp = waitingForYoutubeReturn.current
        && appState.current !== 'active'
        && nextState === 'active';
      appState.current = nextState;
      if (returnedToApp) {
        waitingForYoutubeReturn.current = false;
        setReturnedFromYoutube(true);
      }
    });
    return () => subscription.remove();
  }, []);

  const copyCode = async () => {
    if (!dashboard?.code) return;
    try {
      const writeReferralCode = __DEV__ && simulateReferralCodeCopyFailure
        ? async () => { throw new Error('Simulated referral code clipboard failure'); }
        : Clipboard.setStringAsync;
      const copiedSuccessfully = await writeReferralCode(dashboard.code);
      if (!copiedSuccessfully) throw new Error('Clipboard did not confirm the copy.');
      setCopied(true);
      Alert.alert('Referral code copied', 'Share it with a friend when they create their account.');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setActionError('Could not copy the referral code. Try the share button instead.');
    }
  };

  const shareInvite = async () => {
    if (!dashboard?.code || !dashboard.referralLink) return;
    setActionError('');
    await shareReferralInviteWithFallback(
      dashboard.code,
      dashboard.referralLink,
      (content) => Share.share(content),
      setActionError,
    );
  };

  const showReferralOpenFallback = (message: string) => {
    setActionError(message);
    AccessibilityInfo.announceForAccessibility(message);
  };

  const openReferralLink = async () => {
    if (!dashboard?.referralLink) return;
    setActionError('');
    await openReferralInBrowserWithFallback(
      dashboard.referralLink,
      async (url) => {
        if (__DEV__ && simulateReferralBrowserOpenFailure) {
          throw new Error('Simulated referral browser open failure');
        }
        return WebBrowser.openBrowserAsync(url);
      },
      showReferralOpenFallback,
    );
  };

  const copyReferralLink = async () => {
    if (!dashboard?.referralLink) return;
    setActionError('');
    const copiedSuccessfully = await copyReferralLinkToClipboardWithFallback(
      dashboard.referralLink,
      Clipboard.setStringAsync,
      setActionError,
    );
    if (!copiedSuccessfully) return;
    setLinkCopied(true);
    Alert.alert('Invite link copied', 'Send the link to a friend. It opens Daily007 signup with your referral code filled in.');
    setTimeout(() => setLinkCopied(false), 1800);
  };

  const openYoutubeChannel = async () => {
    if (!youtubeTask?.channelUrl) return;
    setTaskError('');
    waitingForYoutubeReturn.current = true;
    setReturnedFromYoutube(false);
    try {
      await Linking.openURL(youtubeTask.channelUrl);
    } catch {
      waitingForYoutubeReturn.current = false;
      setTaskError('Could not open YouTube. Try again or open the channel in your browser.');
    }
  };

  const submitYoutubeTask = async () => {
    setTaskError('');
    try {
      await submitYoutubeClaim.mutateAsync(undefined);
      setReturnedFromYoutube(false);
      await youtubeTaskQuery.refetch();
      Alert.alert('Claim submitted', 'An administrator will review your YouTube subscription before adding the coins.');
    } catch (e) {
      setTaskError(`Could not submit your claim: ${apiError(e)}`);
    }
  };

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={referralsQuery.isRefetching || youtubeTaskQuery.isRefetching}
          onRefresh={() => { void Promise.all([referralsQuery.refetch(), youtubeTaskQuery.refetch()]); }}
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
      {!!youtubeTaskQuery.error && (
        <Text style={s.error}>{`YouTube task unavailable: ${apiError(youtubeTaskQuery.error)}`}</Text>
      )}
      {!!taskError && <Text style={s.error}>{taskError}</Text>}

      <View style={s.youtubeCard}>
        <View style={s.youtubeHeading}>
          <Feather name="youtube" size={21} color={C.red} />
          <Text style={s.youtubeTitle}>
            Subscribe to YouTube &amp; Earn {youtubeTask?.rewardCoins ?? 2} Coins
          </Text>
        </View>
        <Text style={s.youtubeCopy}>
          Subscribe to the Daily007 channel, then submit your claim. An administrator will verify it before crediting your wallet.
        </Text>
        {youtubeTaskQuery.isPending && !youtubeTask ? (
          <View style={s.taskLoading}>
            <ActivityIndicator color={C.gold} />
            <Text style={s.muted}>Loading YouTube task…</Text>
          </View>
        ) : null}
        {youtubeTask?.completed ? (
          <View style={s.taskStatus}>
            <Feather name="check-circle" size={16} color={C.green} />
            <View style={s.taskStatusText}>
              <Text style={s.taskStatusTitle}>TASK COMPLETED · {youtubeTask.claim?.rewardCoins ?? youtubeTask.rewardCoins} COINS CREDITED</Text>
              <Text selectable style={s.detailText}>Transaction ID: {youtubeTask.claim?.transactionId ?? 'Recorded'}</Text>
            </View>
          </View>
        ) : youtubeTask?.claim?.status === 'pending' ? (
          <View style={s.taskStatus}>
            <Feather name="clock" size={16} color={C.gold} />
            <View style={s.taskStatusText}>
              <Text style={[s.taskStatusTitle, { color: C.gold }]}>CLAIM SUBMITTED · AWAITING REVIEW</Text>
              <Text style={s.detailText}>{youtubeTask.claim.rewardCoins} coins will be credited if approved.</Text>
            </View>
          </View>
        ) : youtubeTask?.claim?.status === 'rejected' ? (
          <View style={s.taskRejected}>
            <Text style={s.taskStatusTitle}>CLAIM NOT APPROVED</Text>
            <Text style={s.detailText}>{youtubeTask.claim.reviewReason || 'Please subscribe to the channel and submit again.'}</Text>
          </View>
        ) : null}
        {youtubeTask && !youtubeTask.completed && youtubeTask.claim?.status !== 'pending' ? (
          youtubeTask.enabled ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open the Daily007 YouTube channel"
                testID="youtube-task-open-channel"
                onPress={openYoutubeChannel}
                style={s.youtubeButton}
              >
                <Feather name="external-link" size={16} color={C.text} />
                <Text style={s.youtubeButtonText}>SUBSCRIBE ON YOUTUBE</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Submit YouTube subscription for administrator review"
                testID="youtube-task-submit-claim"
                disabled={!returnedFromYoutube || submitYoutubeClaim.isPending}
                onPress={submitYoutubeTask}
                style={[s.claimButton, (!returnedFromYoutube || submitYoutubeClaim.isPending) && s.claimButtonDisabled]}
              >
                {submitYoutubeClaim.isPending
                  ? <ActivityIndicator color={C.bg} />
                  : <Feather name="send" size={15} color={C.bg} />}
                <Text style={s.claimButtonText}>
                  {submitYoutubeClaim.isPending ? 'SUBMITTING…' : 'I SUBSCRIBED · SUBMIT FOR REVIEW'}
                </Text>
              </Pressable>
              {!returnedFromYoutube ? (
                <Text style={s.taskHint}>Subscribe on YouTube, then return to Daily007 to submit for review.</Text>
              ) : null}
            </>
          ) : (
            <Text style={s.taskHint}>This task is temporarily unavailable.</Text>
          )
        ) : null}
      </View>

      {!!dashboard && (
        <>
          <View style={s.codeCard}>
            <Text style={s.sectionLabel}>YOUR 5-LETTER REFERRAL CODE</Text>
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
            <Text style={[s.sectionLabel, { marginTop: 16 }]}>CLICKABLE INVITE LINK</Text>
            <View style={s.linkRow}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Open Daily007 referral signup link"
                testID="referral-open-link"
                onPress={openReferralLink}
                style={s.linkButton}
              >
                <Text selectable style={s.linkText}>{dashboard.referralLink}</Text>
                <Feather name="external-link" size={16} color={C.gold} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={linkCopied ? 'Referral link copied' : 'Copy referral link'}
                testID="referral-copy-link"
                onPress={copyReferralLink}
                style={s.iconButton}
              >
                <Feather name={linkCopied ? 'check' : 'copy'} size={18} color={C.gold} />
              </Pressable>
            </View>
            {__DEV__ ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  simulateReferralBrowserOpenFailure
                    ? 'Stop simulating invite browser failures'
                    : 'Simulate invite browser failure'
                }
                accessibilityHint="Development-only: make Open Invite fail so you can test the copy and share recovery message."
                testID="referral-simulate-browser-open-failure"
                onPress={() => setSimulateReferralBrowserOpenFailure((current) => !current)}
                style={s.devTestButton}
              >
                <Text accessible={false} style={s.devTestButtonText}>
                  {simulateReferralBrowserOpenFailure
                    ? 'DEV TEST: browser failure ON'
                    : 'DEV TEST: simulate browser failure'}
                </Text>
              </Pressable>
            ) : null}
            {__DEV__ ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  simulateReferralCodeCopyFailure
                    ? 'Stop simulating referral code copy failures'
                    : 'Simulate referral code copy failure'
                }
                testID="referral-simulate-code-copy-failure"
                onPress={() => setSimulateReferralCodeCopyFailure((current) => !current)}
                style={s.devTestButton}
              >
                <Text accessible={false} style={s.devTestButtonText}>
                  {simulateReferralCodeCopyFailure
                    ? 'DEV TEST: referral code copy failure ON'
                    : 'DEV TEST: simulate referral code copy failure'}
                </Text>
              </Pressable>
            ) : null}
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
  youtubeCard: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: `${C.red}66` },
  youtubeHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  youtubeTitle: { color: C.text, fontSize: 14, fontWeight: '900', flex: 1 },
  youtubeCopy: { color: C.sub, fontSize: 12, lineHeight: 18, marginTop: 8, marginBottom: 10 },
  taskLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  taskStatus: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.bg2, borderRadius: 10, padding: 11, marginTop: 6, borderWidth: 1, borderColor: `${C.green}55` },
  taskStatusText: { flex: 1 },
  taskStatusTitle: { color: C.green, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  taskRejected: { backgroundColor: C.bg2, borderRadius: 10, padding: 11, marginTop: 6, borderWidth: 1, borderColor: `${C.red}55` },
  taskHint: { color: C.dim, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 8 },
  youtubeButton: { minHeight: 44, backgroundColor: `${C.red}22`, borderColor: `${C.red}88`, borderWidth: 1, borderRadius: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8 },
  youtubeButtonText: { color: C.text, fontWeight: '900', fontSize: 11, letterSpacing: 0.4 },
  claimButton: { minHeight: 44, backgroundColor: C.gold, borderRadius: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8, paddingHorizontal: 8 },
  claimButtonDisabled: { opacity: 0.45 },
  claimButtonText: { flex: 1, minWidth: 0, flexShrink: 1, textAlign: 'center', color: C.bg, fontWeight: '900', fontSize: 10, letterSpacing: 0.25 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 18 },
  muted: { color: C.sub, fontSize: 12, lineHeight: 18, marginTop: 4 },
  error: { color: C.red, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  codeCard: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: `${C.gold}77`, marginBottom: 14 },
  sectionLabel: { color: C.gold, fontWeight: '900', letterSpacing: 1.4, fontSize: 11 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  code: { flex: 1, color: C.gold, fontWeight: '900', fontSize: 17, letterSpacing: 1.4, backgroundColor: C.bg2, borderRadius: 10, borderWidth: 1, borderColor: C.border, textAlign: 'center', paddingVertical: 12 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  linkButton: { minHeight: 48, flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.bg2, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 8 },
  linkText: { flex: 1, minWidth: 0, flexShrink: 1, color: C.blue, fontSize: 11, lineHeight: 16, textDecorationLine: 'underline' },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  devTestButton: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', borderWidth: 1, borderColor: C.gold, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7, marginTop: 6 },
  devTestButtonText: { color: C.gold, fontSize: 11, fontWeight: '800' },
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