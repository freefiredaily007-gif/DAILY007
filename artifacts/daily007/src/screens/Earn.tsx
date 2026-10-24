import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  ActivityIndicator,
  AccessibilityInfo,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
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
import { KeyboardAwareScrollViewCompat } from '../../components/KeyboardAwareScrollViewCompat';

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
  const [focusedInstagramField, setFocusedInstagramField] = useState<'username' | 'proof' | null>(null);
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
    <KeyboardAwareScrollViewCompat
      style={s.root}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      bottomOffset={60}
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
      <View style={s.header}>
        <View style={s.headerCoin}>
          <FontAwesome5 name="coins" size={20} color={C.bg} />
        </View>
        <View style={s.headerCopy}>
          <Text style={s.title}>EARN COINS</Text>
          <Text style={s.subtitle}>Complete Tasks • Invite Friends • Earn Rewards</Text>
        </View>
      </View>

      <View style={s.ruleCard}>
        <View style={s.ruleTop}>
          <View style={s.ruleIcon}>
            <Feather name="gift" size={20} color={C.gold} />
          </View>
          <View style={s.ruleContent}>
            <Text style={s.ruleTitle}>10 coins for your friend at signup</Text>
            <Text style={s.ruleText}>
              You earn 5 coins once their recharge of at least 50 coins is approved by an administrator.
            </Text>
          </View>
          <View style={s.ruleBadge}>
            <Text style={s.ruleBadgeValue}>10</Text>
            <Text style={s.ruleBadgeLabel}>COINS</Text>
          </View>
        </View>
        <View style={s.ruleDivider} />
        <View style={s.rewardReasonRow}>
          <FontAwesome5 name="coins" size={13} color={C.gold} />
          <Text style={s.rewardReason}>5 coins for you after an approved 50+ coin recharge</Text>
        </View>
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
          <View style={[s.taskIconShell, s.youtubeIconShell]}>
            <Feather name="youtube" size={21} color={C.red} />
          </View>
          <Text style={s.youtubeTitle}>
            Subscribe to YouTube &amp; Earn {youtubeTask?.rewardCoins ?? 5} Coins
          </Text>
        </View>
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
                style={({ pressed }) => [s.youtubeButton, pressed && s.buttonPressed]}
              >
                <LinearGradient
                  colors={[C.red, `${C.red}CC`]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.taskButtonGradient}
                >
                  <Feather name="youtube" size={17} color={C.text} />
                  <Text style={s.youtubeButtonText}>SUBSCRIBE ON YOUTUBE</Text>
                </LinearGradient>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Submit YouTube subscription for administrator review"
                testID="youtube-task-submit-claim"
                disabled={!returnedFromYoutube || submitYoutubeClaim.isPending}
                onPress={submitYoutubeTask}
                style={[
                  s.claimButton,
                  (!returnedFromYoutube || submitYoutubeClaim.isPending) && s.claimButtonDisabled,
                ]}
              >
                <LinearGradient
                  colors={[C.gold, `${C.gold}CC`]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.claimButtonGradient}
                >
                  {submitYoutubeClaim.isPending
                    ? <ActivityIndicator color={C.bg} />
                    : <Feather name="send" size={15} color={C.bg} />}
                  <Text style={s.claimButtonText}>
                    {submitYoutubeClaim.isPending ? 'SUBMITTING…' : 'I SUBSCRIBED · SUBMIT FOR REVIEW'}
                  </Text>
                </LinearGradient>
              </Pressable>
            </>
          ) : (
            <Text style={s.taskHint}>This task is temporarily unavailable.</Text>
          )
        ) : null}
      </View>

      <View style={s.instagramCard}>
        <View style={s.youtubeHeading}>
          <View style={[s.taskIconShell, s.instagramIconShell]}>
            <Feather name="instagram" size={21} color={C.purple} />
          </View>
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
                style={({ pressed }) => [s.instagramButton, pressed && s.buttonPressed]}
              >
                <LinearGradient
                  colors={[C.purple, C.red]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.taskButtonGradient}
                >
                  <Feather name="instagram" size={17} color={C.text} />
                  <Text style={s.youtubeButtonText}>FOLLOW ON INSTAGRAM</Text>
                </LinearGradient>
              </Pressable>
              <Text style={s.fieldLabel}>Instagram username</Text>
              <View style={[s.taskInputShell, focusedInstagramField === 'username' && s.taskInputShellFocused]}>
                <Feather name="at-sign" size={16} color={C.purple} />
                <Input
                  accessibilityLabel={t('Instagram username')}
                  testID="instagram-task-username"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={31}
                  placeholder="Enter your Instagram username"
                  value={instagramUsername}
                  onChangeText={setInstagramUsername}
                  onFocus={() => setFocusedInstagramField('username')}
                  onBlur={() => setFocusedInstagramField((current) => current === 'username' ? null : current)}
                  style={s.taskInput}
                />
              </View>
              <Text style={s.fieldLabel}>Proof / note (optional)</Text>
              <View
                style={[
                  s.taskInputShell,
                  s.proofInputShell,
                  focusedInstagramField === 'proof' && s.taskInputShellFocused,
                ]}
              >
                <Feather name="message-square" size={16} color={C.purple} />
                <Input
                  accessibilityLabel={t('Proof / note (optional)')}
                  testID="instagram-task-proof"
                  autoCapitalize="sentences"
                  maxLength={1000}
                  multiline
                  placeholder="Add a verification note or proof link (optional)"
                  value={instagramProof}
                  onChangeText={setInstagramProof}
                  onFocus={() => setFocusedInstagramField('proof')}
                  onBlur={() => setFocusedInstagramField((current) => current === 'proof' ? null : current)}
                  style={[s.taskInput, s.proofInput]}
                />
              </View>
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
                <LinearGradient
                  colors={[C.gold, `${C.gold}CC`]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.claimButtonGradient}
                >
                  {submitInstagramClaim.isPending
                    ? <ActivityIndicator color={C.bg} />
                    : <Feather name="send" size={15} color={C.bg} />}
                  <Text style={s.claimButtonText}>
                    {submitInstagramClaim.isPending ? 'SUBMITTING…' : 'SUBMIT FOLLOW CLAIM FOR REVIEW'}
                  </Text>
                </LinearGradient>
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
            <View style={s.inviteCardHeader}>
              <View style={s.inviteIconShell}>
                <Feather name="send" size={17} color={C.gold} />
              </View>
              <Text style={s.inviteTitle}>INVITE &amp; EARN</Text>
            </View>
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
              style={({ pressed }) => [s.shareButton, pressed && s.buttonPressed]}
            >
              <LinearGradient
                colors={[C.gold, `${C.gold}CC`]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={s.shareButtonGradient}
              >
                <Feather name="share-2" size={16} color={C.bg} />
                <Text style={s.shareButtonText}>SHARE INVITE LINK</Text>
              </LinearGradient>
            </Pressable>
          </View>

          <View style={s.statsGrid}>
            <Stat icon="users" label="PEOPLE INVITED" value={dashboard.totalPeopleReferred} />
            <Stat icon="check-circle" label="SUCCESSFUL" value={dashboard.successfulReferrals} />
            <Stat icon="clock" label="PENDING" value={dashboard.pendingReferrals} />
            <Stat icon="award" label="COINS EARNED" value={dashboard.totalReferralCoinsEarned} />
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
    </KeyboardAwareScrollViewCompat>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: 'users' | 'check-circle' | 'clock' | 'award';
  label: string;
  value: number;
}) {
  return (
    <View style={s.statCard}>
      <View style={s.statTopRow}>
        <View style={s.statIcon}>
          <Feather name={icon} size={14} color={C.gold} />
        </View>
        <Text style={s.statValue}>{value}</Text>
      </View>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 122 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  headerCoin: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.gold,
    borderWidth: 2,
    borderColor: `${C.gold}88`,
    shadowColor: C.gold,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 5,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: C.gold, fontSize: 22, fontWeight: '900', letterSpacing: 1.2 },
  subtitle: { color: C.sub, fontSize: 11, lineHeight: 16, marginTop: 3 },
  ruleCard: {
    backgroundColor: C.card2,
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: `${C.gold}66`,
    shadowColor: C.gold,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 2,
  },
  ruleTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ruleIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: `${C.gold}18`,
    borderWidth: 1,
    borderColor: `${C.gold}44`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleContent: { flex: 1, minWidth: 0 },
  ruleTitle: { color: C.text, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  ruleText: { color: C.sub, fontSize: 11, lineHeight: 16, marginTop: 5 },
  ruleBadge: {
    minWidth: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: `${C.gold}18`,
    borderWidth: 1,
    borderColor: `${C.gold}55`,
  },
  ruleBadgeValue: { color: C.gold, fontSize: 20, lineHeight: 22, fontWeight: '900' },
  ruleBadgeLabel: { color: C.gold, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  ruleDivider: { height: 1, backgroundColor: `${C.gold}30`, marginVertical: 12 },
  rewardReasonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rewardReason: { flex: 1, minWidth: 0, color: C.gold, fontSize: 10, lineHeight: 15, fontWeight: '800' },
  youtubeCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: `${C.red}66`,
    shadowColor: C.red,
    shadowOpacity: 0.09,
    shadowRadius: 12,
    elevation: 2,
  },
  instagramCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: `${C.purple}66`,
    shadowColor: C.purple,
    shadowOpacity: 0.09,
    shadowRadius: 12,
    elevation: 2,
  },
  youtubeHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  taskIconShell: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  youtubeIconShell: { backgroundColor: `${C.red}18`, borderWidth: 1, borderColor: `${C.red}44` },
  instagramIconShell: { backgroundColor: `${C.purple}18`, borderWidth: 1, borderColor: `${C.purple}44` },
  youtubeTitle: { color: C.text, fontSize: 14, lineHeight: 19, fontWeight: '900', flex: 1, minWidth: 0 },
  youtubeCopy: { color: C.sub, fontSize: 11, lineHeight: 17, marginTop: 9, marginBottom: 8 },
  taskLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  taskStatus: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: C.bg2,
    borderRadius: 12,
    padding: 11,
    marginTop: 6,
    borderWidth: 1,
    borderColor: `${C.green}55`,
  },
  taskAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.bg2,
    borderRadius: 12,
    padding: 11,
    marginTop: 6,
    borderWidth: 1,
    borderColor: `${C.purple}55`,
  },
  taskStatusText: { flex: 1, minWidth: 0 },
  taskStatusTitle: { color: C.green, fontSize: 10, lineHeight: 15, fontWeight: '900', letterSpacing: 0.35 },
  taskRejected: { backgroundColor: C.bg2, borderRadius: 12, padding: 11, marginTop: 6, borderWidth: 1, borderColor: `${C.red}55` },
  taskHint: { color: C.dim, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 8 },
  youtubeButton: {
    minHeight: 48,
    borderRadius: 13,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: `${C.red}99`,
    marginTop: 9,
  },
  instagramButton: {
    minHeight: 48,
    borderRadius: 13,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: `${C.purple}99`,
    marginTop: 9,
  },
  taskButtonGradient: {
    minHeight: 46,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
  },
  youtubeButtonText: { color: C.text, fontWeight: '900', fontSize: 11, letterSpacing: 0.5 },
  buttonPressed: { transform: [{ scale: 0.985 }], opacity: 0.92 },
  fieldLabel: { color: C.sub, fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginTop: 10, marginBottom: 5 },
  taskInputShell: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: C.bg2,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
  },
  taskInputShellFocused: {
    borderColor: C.purple,
    shadowColor: C.purple,
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 3,
  },
  proofInputShell: { alignItems: 'flex-start', paddingTop: 10 },
  taskInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderWidth: 0,
    borderRadius: 0,
    color: C.text,
    paddingHorizontal: 0,
    paddingVertical: 10,
    fontSize: 13,
  },
  proofInput: { minHeight: 78, textAlignVertical: 'top' },
  claimButton: { minHeight: 48, borderRadius: 13, overflow: 'hidden', marginTop: 10 },
  claimButtonDisabled: { opacity: 0.48 },
  claimButtonGradient: {
    minHeight: 48,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: `${C.gold}99`,
    borderRadius: 13,
  },
  claimButtonText: { flex: 1, minWidth: 0, flexShrink: 1, textAlign: 'center', color: C.bg, fontWeight: '900', fontSize: 10, letterSpacing: 0.25 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  muted: { color: C.sub, fontSize: 11, lineHeight: 17, marginTop: 4 },
  error: { color: C.red, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  codeCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: `${C.gold}66`,
    marginBottom: 12,
  },
  inviteCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  inviteIconShell: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: `${C.gold}18`,
    borderWidth: 1,
    borderColor: `${C.gold}44`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteTitle: { color: C.gold, fontWeight: '900', letterSpacing: 1.2, fontSize: 13 },
  sectionLabel: { color: C.gold, fontWeight: '900', letterSpacing: 1.1, fontSize: 10 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 },
  code: {
    flex: 1,
    minWidth: 0,
    color: C.gold,
    fontWeight: '900',
    fontSize: 18,
    letterSpacing: 1.5,
    backgroundColor: C.bg2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${C.gold}44`,
    textAlign: 'center',
    paddingVertical: 11,
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 },
  linkButton: {
    minHeight: 48,
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.bg2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  linkText: { flex: 1, minWidth: 0, flexShrink: 1, color: C.blue, fontSize: 10, lineHeight: 15, textDecorationLine: 'underline' },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  devTestButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: C.gold, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7, marginTop: 6 },
  devTestButtonText: { color: C.gold, fontSize: 11, fontWeight: '800' },
  shareButton: { minHeight: 50, borderRadius: 13, overflow: 'hidden', marginTop: 11 },
  shareButtonGradient: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: `${C.gold}AA`,
    borderRadius: 13,
  },
  shareButtonText: { color: C.bg, fontWeight: '900', fontSize: 11, letterSpacing: 0.6 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  statCard: {
    flexBasis: '48%',
    flexGrow: 1,
    minWidth: 140,
    minHeight: 76,
    backgroundColor: C.card,
    borderRadius: 15,
    padding: 11,
    borderWidth: 1,
    borderColor: C.border,
  },
  statTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: `${C.gold}16`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: { color: C.gold, fontSize: 20, fontWeight: '900' },
  statLabel: { color: C.sub, fontSize: 9, fontWeight: '800', letterSpacing: 0.65, marginTop: 7 },
  sectionHeading: { color: C.gold, fontSize: 12, fontWeight: '900', letterSpacing: 1.1, marginBottom: 10 },
  emptyCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    alignItems: 'center',
    marginBottom: 10,
  },
  emptyTitle: { color: C.text, fontWeight: '900', fontSize: 13, marginTop: 8 },
  referralCard: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border },
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