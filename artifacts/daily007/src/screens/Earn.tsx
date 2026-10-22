import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  ActivityIndicator,
  AccessibilityInfo,
  Linking,
  Platform,
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
import { useTranslation } from 'react-i18next';
import { ReadableText as Text } from '../components/typography';
import {
  useDaily007GetInstagramFollowTask,
  useDaily007GetMyReferrals,
  useDaily007GetYoutubeSubscribeTask,
  useDaily007SubmitInstagramFollowClaim,
  useDaily007SubmitYoutubeSubscribeClaim,
} from '@workspace/api-client-react';
import { C, Input } from '../components/ui';
import { apiError } from '../lib/api';
import {
  copyReferralLinkToClipboardWithFallback,
  openReferralInBrowserWithFallback,
  shareReferralInviteWithFallback,
} from '../lib/referral-invite';
import { showLocalizedAlert } from '../i18n/alerts';
import { translateExactText } from '../i18n';

const rechargeStatusLabel: Record<string, string> = {
  rewarded: 'Approved recharge · reward credited',
  awaiting_approval: 'Recharge submitted · awaiting admin approval',
  eligible_unrewarded: 'Approved recharge · reward not credited',
  below_minimum: 'Recharge below the 50-coin minimum',
  not_started: 'No qualifying recharge yet',
};

export default function Earn() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [actionError, setActionError] = useState('');
  const [simulateReferralBrowserOpenFailure, setSimulateReferralBrowserOpenFailure] = useState(false);
  const [simulateReferralLinkCopyFailure, setSimulateReferralLinkCopyFailure] = useState(false);
  const [simulateReferralCodeCopyFailure, setSimulateReferralCodeCopyFailure] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [instagramTaskError, setInstagramTaskError] = useState('');
  const [instagramUsername, setInstagramUsername] = useState('');
  const [instagramProof, setInstagramProof] = useState('');
  const [returnedFromYoutube, setReturnedFromYoutube] = useState(false);
  const [returnedFromInstagram, setReturnedFromInstagram] = useState(false);
  const waitingForYoutubeReturn = useRef(false);
  const waitingForInstagramReturn = useRef(false);
  const appState = useRef(AppState.currentState);
  const referralsQuery = useDaily007GetMyReferrals();
  const youtubeTaskQuery = useDaily007GetYoutubeSubscribeTask();
  const submitYoutubeClaim = useDaily007SubmitYoutubeSubscribeClaim();
  const instagramTaskQuery = useDaily007GetInstagramFollowTask();
  const submitInstagramClaim = useDaily007SubmitInstagramFollowClaim();
  const dashboard = referralsQuery.data;
  const referrals = dashboard?.referrals ?? [];
  const youtubeTask = youtubeTaskQuery.data;
  const instagramTask = instagramTaskQuery.data;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returnedToApp = waitingForYoutubeReturn.current
        && appState.current !== 'active'
        && nextState === 'active';
      const returnedFromInstagramAccount = waitingForInstagramReturn.current
        && appState.current !== 'active'
        && nextState === 'active';
      appState.current = nextState;
      if (returnedToApp) {
        waitingForYoutubeReturn.current = false;
        setReturnedFromYoutube(true);
      }
      if (returnedFromInstagramAccount) {
        waitingForInstagramReturn.current = false;
        setReturnedFromInstagram(true);
      }
    });
    return () => subscription.remove();
  }, []);

  const copyCode = async () => {
    if (!dashboard?.code) return;
    setActionError('');
    try {
      const writeReferralCode = __DEV__ && simulateReferralCodeCopyFailure
        ? async () => { throw new Error('Simulated referral code clipboard failure'); }
        : Clipboard.setStringAsync;
      const copiedSuccessfully = await writeReferralCode(dashboard.code);
      if (!copiedSuccessfully) throw new Error('Clipboard did not confirm the copy.');
      setCopied(true);
      showLocalizedAlert('Referral code copied', 'Share it with a friend when they create their account.');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      showReferralCopyFallback('Could not copy the referral code. Use Share Invite instead.');
    }
  };

  const shareInvite = async () => {
    if (!dashboard?.code || !dashboard.referralLink) return;
    setActionError('');
    await shareReferralInviteWithFallback(
      dashboard.code,
      dashboard.referralLink,
      (content) => Share.share(content),
      (message) => {
        setActionError(message);
        if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(translateExactText(message));
      },
    );
  };

  const showReferralOpenFallback = (message: string) => {
    setActionError(message);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(translateExactText(message));
  };

  const showReferralCopyFallback = (message: string) => {
    setActionError(message);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(translateExactText(message));
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
      __DEV__ && simulateReferralLinkCopyFailure
        ? async () => { throw new Error('Simulated referral link clipboard failure'); }
        : Clipboard.setStringAsync,
      showReferralCopyFallback,
    );
    if (!copiedSuccessfully) return;
    setLinkCopied(true);
    showLocalizedAlert('Invite link copied', 'Send the link to a friend. It opens Daily007 signup with your referral code filled in.');
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
      showLocalizedAlert('Claim submitted', 'An administrator will review your YouTube subscription before adding the coins.');
    } catch (e) {
      setTaskError(`Could not submit your claim: ${apiError(e)}`);
    }
  };

  const openInstagramAccount = async () => {
    if (!instagramTask?.accountUrl) return;
    setInstagramTaskError('');
    waitingForInstagramReturn.current = true;
    setReturnedFromInstagram(false);
    try {
      await Linking.openURL(instagramTask.accountUrl);
    } catch {
      waitingForInstagramReturn.current = false;
      setInstagramTaskError(t('Could not open Instagram. Try again or open the account in your browser.'));
    }
  };

  const submitInstagramTask = async () => {
    setInstagramTaskError('');
    const normalizedUsername = instagramUsername.trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(normalizedUsername)) {
      setInstagramTaskError(t('Enter a valid Instagram username.'));
      return;
    }
    try {
      await submitInstagramClaim.mutateAsync({
        data: {
          instagramUsername: normalizedUsername,
          proofText: instagramProof.trim() || null,
        },
      });
      setReturnedFromInstagram(false);
      setInstagramUsername('');
      setInstagramProof('');
      await instagramTaskQuery.refetch();
      showLocalizedAlert(
        'Claim submitted',
        'An administrator will verify your Instagram follow before adding the coins.',
      );
    } catch (error) {
      setInstagramTaskError(
        t('Could not submit your Instagram claim: {{error}}', { error: apiError(error) }),
      );
    }
  };

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={referralsQuery.isRefetching || youtubeTaskQuery.isRefetching || instagramTaskQuery.isRefetching}
          onRefresh={() => {
            void Promise.all([referralsQuery.refetch(), youtubeTaskQuery.refetch(), instagramTaskQuery.refetch()]);
          }}
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
      {!!actionError && (
        <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={s.error}>
          {actionError}
        </Text>
      )}
      {!!youtubeTaskQuery.error && (
        <Text style={s.error}>{`YouTube task unavailable: ${apiError(youtubeTaskQuery.error)}`}</Text>
      )}
      {!!instagramTaskQuery.error && (
        <Text style={s.error}>
          {t('Instagram task unavailable: {{error}}', { error: apiError(instagramTaskQuery.error) })}
        </Text>
      )}
      {!!taskError && <Text style={s.error}>{taskError}</Text>}

      <View style={s.youtubeCard}>
        <View style={s.youtubeHeading}>
          <Feather name="youtube" size={21} color={C.red} />
          <Text style={s.youtubeTitle}>
            Subscribe to YouTube &amp; Earn {youtubeTask?.rewardCoins ?? 5} Coins
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

      <View style={s.instagramCard}>
        <View style={s.youtubeHeading}>
          <Feather name="instagram" size={21} color={C.purple} />
          <Text style={s.youtubeTitle}>
            {t('Follow on Instagram & Earn {{count}} Coins', {
              count: instagramTask?.rewardCoins ?? 3,
            })}
          </Text>
        </View>
        <Text style={s.youtubeCopy}>
          Follow the official Daily007 Instagram account and submit your username for admin verification before coins are credited.
        </Text>
        {instagramTaskQuery.isPending && !instagramTask ? (
          <View style={s.taskLoading}>
            <ActivityIndicator color={C.gold} />
            <Text style={s.muted}>Loading Instagram task…</Text>
          </View>
        ) : null}
        {!!instagramTaskError && (
          <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={s.error}>
            {instagramTaskError}
          </Text>
        )}
        {instagramTask && !instagramTask.completed && instagramTask.claim?.status !== 'pending' ? (
          <View style={s.taskAction}>
            <Feather name="alert-circle" size={16} color={C.purple} />
            <Text style={[s.taskStatusTitle, { color: C.purple }]}>
              ACTION REQUIRED · FOLLOW AND SUBMIT CLAIM
            </Text>
          </View>
        ) : null}
        {instagramTask?.completed ? (
          <View style={s.taskStatus}>
            <Feather name="check-circle" size={16} color={C.green} />
            <View style={s.taskStatusText}>
              <Text style={s.taskStatusTitle}>
                {t('TASK COMPLETED · {{count}} COINS CREDITED', {
                  count: instagramTask.claim?.rewardCoins ?? instagramTask.rewardCoins,
                })}
              </Text>
              <Text selectable style={s.detailText}>
                {t('Transaction ID: {{id}}', {
                  id: instagramTask.claim?.transactionId ?? t('Recorded'),
                })}
              </Text>
            </View>
          </View>
        ) : instagramTask?.claim?.status === 'pending' ? (
          <View style={s.taskStatus}>
            <Feather name="clock" size={16} color={C.gold} />
            <View style={s.taskStatusText}>
              <Text style={[s.taskStatusTitle, { color: C.gold }]}>CLAIM SUBMITTED · AWAITING REVIEW</Text>
              <Text style={s.detailText}>
                {instagramTask.claim.rewardCoins} coins will be credited if approved.
              </Text>
              <Text style={s.detailText}>
                {t('Instagram username: @{{username}}', { username: instagramTask.claim.instagramUsername })}
              </Text>
              {instagramTask.claim.proofText ? (
                <Text style={s.detailText}>
                  {t('Proof / note: {{proof}}', { proof: instagramTask.claim.proofText })}
                </Text>
              ) : null}
            </View>
          </View>
        ) : instagramTask?.claim?.status === 'rejected' ? (
          <View style={s.taskRejected}>
            <Text style={s.taskStatusTitle}>CLAIM NOT APPROVED</Text>
            <Text style={s.detailText}>
              {instagramTask.claim.reviewReason || t('Please follow the account and submit a new claim.')}
            </Text>
          </View>
        ) : null}
        {instagramTask && !instagramTask.completed && instagramTask.claim?.status !== 'pending' ? (
          instagramTask.enabled ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Open the official Daily007 Instagram account')}
                testID="instagram-task-open-account"
                onPress={openInstagramAccount}
                style={s.instagramButton}
              >
                <Feather name="external-link" size={16} color={C.text} />
                <Text style={s.youtubeButtonText}>FOLLOW ON INSTAGRAM</Text>
              </Pressable>
              <Text style={s.fieldLabel}>Instagram username</Text>
              <Input
                accessibilityLabel={t('Instagram username')}
                testID="instagram-task-username"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={31}
                placeholder="Enter your Instagram username"
                value={instagramUsername}
                onChangeText={setInstagramUsername}
                style={s.taskInput}
              />
              <Text style={s.fieldLabel}>Proof / note (optional)</Text>
              <Input
                accessibilityLabel={t('Proof / note (optional)')}
                testID="instagram-task-proof"
                autoCapitalize="sentences"
                maxLength={1000}
                multiline
                placeholder="Add a verification note or proof link (optional)"
                value={instagramProof}
                onChangeText={setInstagramProof}
                style={[s.taskInput, s.proofInput]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Submit Instagram follow claim for administrator review')}
                testID="instagram-task-submit-claim"
                disabled={!returnedFromInstagram || submitInstagramClaim.isPending}
                onPress={submitInstagramTask}
                style={[
                  s.claimButton,
                  (!returnedFromInstagram || submitInstagramClaim.isPending) && s.claimButtonDisabled,
                ]}
              >
                {submitInstagramClaim.isPending
                  ? <ActivityIndicator color={C.bg} />
                  : <Feather name="send" size={15} color={C.bg} />}
                <Text style={s.claimButtonText}>
                  {submitInstagramClaim.isPending ? 'SUBMITTING…' : 'SUBMIT FOLLOW CLAIM FOR REVIEW'}
                </Text>
              </Pressable>
              {!returnedFromInstagram ? (
                <Text style={s.taskHint}>
                  Follow the account, return to Daily007, then submit your Instagram username for review.
                </Text>
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
                  simulateReferralLinkCopyFailure
                    ? 'Stop simulating invite link copy failures'
                    : 'Simulate invite link copy failure'
                }
                testID="referral-simulate-link-copy-failure"
                onPress={() => setSimulateReferralLinkCopyFailure((current) => !current)}
                style={s.devTestButton}
              >
                <Text accessible={false} style={s.devTestButtonText}>
                  {simulateReferralLinkCopyFailure
                    ? 'DEV TEST: invite link copy failure ON'
                    : 'DEV TEST: simulate invite link copy failure'}
                </Text>
              </Pressable>
            ) : null}
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
              accessibilityLabel="Share invite link"
              accessibilityHint="Opens sharing options for your referral code and invite link."
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
  instagramCard: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: `${C.purple}66` },
  youtubeHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  youtubeTitle: { color: C.text, fontSize: 14, fontWeight: '900', flex: 1 },
  youtubeCopy: { color: C.sub, fontSize: 12, lineHeight: 18, marginTop: 8, marginBottom: 10 },
  taskLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  taskStatus: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.bg2, borderRadius: 10, padding: 11, marginTop: 6, borderWidth: 1, borderColor: `${C.green}55` },
  taskAction: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bg2, borderRadius: 10, padding: 11, marginTop: 6, borderWidth: 1, borderColor: `${C.purple}55` },
  taskStatusText: { flex: 1 },
  taskStatusTitle: { color: C.green, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  taskRejected: { backgroundColor: C.bg2, borderRadius: 10, padding: 11, marginTop: 6, borderWidth: 1, borderColor: `${C.red}55` },
  taskHint: { color: C.dim, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 8 },
  youtubeButton: { minHeight: 44, backgroundColor: `${C.red}22`, borderColor: `${C.red}88`, borderWidth: 1, borderRadius: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8 },
  instagramButton: { minHeight: 44, backgroundColor: `${C.purple}22`, borderColor: `${C.purple}88`, borderWidth: 1, borderRadius: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8 },
  youtubeButtonText: { color: C.text, fontWeight: '900', fontSize: 11, letterSpacing: 0.4 },
  fieldLabel: { color: C.sub, fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginTop: 8, marginBottom: 4 },
  taskInput: { minHeight: 46, backgroundColor: C.bg2, borderColor: C.border, borderWidth: 1, borderRadius: 10, color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  proofInput: { minHeight: 72, textAlignVertical: 'top' },
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