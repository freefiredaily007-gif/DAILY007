import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import {
  useDaily007AdminListInstagramFollowClaims,
  useDaily007AdminReviewInstagramFollowClaim,
  useDaily007AdminListYoutubeSubscribeClaims,
  useDaily007AdminReviewYoutubeSubscribeClaim,
} from '@workspace/api-client-react';
import type {
  Daily007AdminInstagramFollowClaim,
  Daily007AdminYoutubeSubscribeClaim,
} from '@workspace/api-client-react';
import { A, Btn, Card, ConfirmDialog, ScreenWrap, SectionTitle, StatusTag, useToast } from '../components/adminKit';
import { apiError } from '../lib/api';

type ReviewTarget = {
  claim: Daily007AdminYoutubeSubscribeClaim;
  action: 'approve' | 'reject';
};

type InstagramReviewTarget = {
  claim: Daily007AdminInstagramFollowClaim;
  action: 'approve' | 'reject';
};

export default function AdminEarnTasks() {
  const toast = useToast();
  const claimsQuery = useDaily007AdminListYoutubeSubscribeClaims();
  const reviewMutation = useDaily007AdminReviewYoutubeSubscribeClaim();
  const instagramClaimsQuery = useDaily007AdminListInstagramFollowClaims();
  const instagramReviewMutation = useDaily007AdminReviewInstagramFollowClaim();
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [instagramReviewTarget, setInstagramReviewTarget] = useState<InstagramReviewTarget | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const claims = claimsQuery.data?.claims ?? [];
  const instagramClaims = instagramClaimsQuery.data?.claims ?? [];

  const review = async (target: ReviewTarget) => {
    if (reviewMutation.isPending) return;
    setReviewTarget(null);
    setBusyId(target.claim.id);
    try {
      await reviewMutation.mutateAsync({
        id: target.claim.id,
        action: target.action,
        data: target.action === 'reject'
          ? { reason: 'We could not verify the subscription. Please subscribe and submit a new claim.' }
          : undefined,
      });
      toast(
        target.action === 'approve'
          ? `${target.claim.rewardCoins} coins credited to ${target.claim.userName}.`
          : `Claim rejected for ${target.claim.userName}.`,
        'success',
      );
      await claimsQuery.refetch();
    } catch (error) {
      toast(apiError(error), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const reviewInstagram = async (target: InstagramReviewTarget) => {
    if (instagramReviewMutation.isPending) return;
    setInstagramReviewTarget(null);
    setBusyId(target.claim.id);
    try {
      await instagramReviewMutation.mutateAsync({
        id: target.claim.id,
        action: target.action,
        data: target.action === 'reject'
          ? { reason: 'We could not verify the Instagram follow. Please follow the account and submit a new claim.' }
          : undefined,
      });
      toast(
        target.action === 'approve'
          ? `${target.claim.rewardCoins} coins credited to ${target.claim.userName}.`
          : `Instagram claim rejected for ${target.claim.userName}.`,
        'success',
      );
      await instagramClaimsQuery.refetch();
    } catch (error) {
      toast(apiError(error), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenWrap onRefresh={async () => {
        await Promise.all([claimsQuery.refetch(), instagramClaimsQuery.refetch()]);
      }}>
        <SectionTitle
          title="YOUTUBE SUBSCRIBE TASK"
          sub="Review subscriptions before approving wallet credits."
        />
        <Card style={st.summary}>
          <Text style={st.summaryValue}>{claimsQuery.data?.totalCompleted ?? 0}</Text>
          <Text style={st.summaryLabel}>COMPLETED · REWARD CREDITED</Text>
          <Text style={st.summaryNote}>
            Configure task availability, channel URL, and reward amount in Settings.
          </Text>
        </Card>

        <SectionTitle
          title="CLAIM HISTORY"
          sub={`${claims.length} recent claims`}
        />
        {claimsQuery.isPending && !claimsQuery.data ? (
          <ActivityIndicator color={A.red} style={{ marginTop: 18 }} />
        ) : claimsQuery.error ? (
          <Card><Text style={st.error}>{apiError(claimsQuery.error)}</Text></Card>
        ) : claims.length === 0 ? (
          <Card><Text style={st.empty}>No YouTube task claims yet.</Text></Card>
        ) : (
          claims.map((claim) => (
            <Card key={claim.id} style={st.claimCard}>
              <View style={st.row}>
                <View style={st.identity}>
                  <Text style={st.name}>{claim.userName || 'Player'}</Text>
                  <Text style={st.sub}>{claim.email || 'No email'}</Text>
                </View>
                <StatusTag status={claim.status} />
              </View>
              <Text selectable style={st.detail}>Daily007 user ID: {claim.userId}</Text>
              <Text style={st.detail}>Reward: {claim.rewardCoins} coins</Text>
              <Text style={st.detail}>Submitted: {new Date(claim.createdAt).toLocaleString()}</Text>
              {claim.reviewedAt ? (
                <Text style={st.detail}>Reviewed: {new Date(claim.reviewedAt).toLocaleString()}</Text>
              ) : null}
              {claim.reviewReason ? <Text style={st.reason}>Review note: {claim.reviewReason}</Text> : null}
              {claim.transactionId ? (
                <Text selectable style={st.transaction}>Wallet transaction ID: {claim.transactionId}</Text>
              ) : null}
              {claim.status === 'pending' ? (
                <View style={st.actions}>
                  <View style={{ flex: 1 }}>
                    <Btn
                      title="APPROVE & CREDIT"
                      kind="gold"
                      small
                      loading={busyId === claim.id}
                      disabled={reviewMutation.isPending}
                      onPress={() => setReviewTarget({ claim, action: 'approve' })}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Btn
                      title="REJECT"
                      kind="danger"
                      small
                      loading={busyId === claim.id}
                      disabled={reviewMutation.isPending}
                      onPress={() => setReviewTarget({ claim, action: 'reject' })}
                    />
                  </View>
                </View>
              ) : null}
            </Card>
          ))
        )}

        <SectionTitle
          title="INSTAGRAM FOLLOW TASK"
          sub="Review the submitted Instagram username and proof before approving wallet credits."
        />
        <Card style={st.summary}>
          <Text style={st.summaryValue}>{instagramClaimsQuery.data?.totalCompleted ?? 0}</Text>
          <Text style={st.summaryLabel}>COMPLETED · REWARD CREDITED</Text>
          <Text style={st.summaryNote}>Configure the Instagram account URL and reward amount in Settings.</Text>
        </Card>
        <SectionTitle
          title="CLAIM HISTORY"
          sub={`${instagramClaims.length} recent claims`}
        />
        {instagramClaimsQuery.isPending && !instagramClaimsQuery.data ? (
          <ActivityIndicator color={A.red} style={{ marginTop: 18 }} />
        ) : instagramClaimsQuery.error ? (
          <Card><Text style={st.error}>{apiError(instagramClaimsQuery.error)}</Text></Card>
        ) : instagramClaims.length === 0 ? (
          <Card><Text style={st.empty}>No Instagram task claims yet.</Text></Card>
        ) : (
          instagramClaims.map((claim) => (
            <Card key={claim.id} style={st.claimCard}>
              <View style={st.row}>
                <View style={st.identity}>
                  <Text style={st.name}>{claim.userName || 'Player'}</Text>
                  <Text style={st.sub}>{claim.email || 'No email'}</Text>
                </View>
                <StatusTag status={claim.status} />
              </View>
              <Text selectable style={st.detail}>Daily007 user ID: {claim.userId}</Text>
              <Text selectable style={st.detail}>Instagram username: @{claim.instagramUsername}</Text>
              <Text style={st.detail}>Proof / note: {claim.proofText || 'Not provided'}</Text>
              <Text style={st.detail}>Reward: {claim.rewardCoins} coins</Text>
              <Text style={st.detail}>Submitted: {new Date(claim.createdAt).toLocaleString()}</Text>
              {claim.reviewedAt ? (
                <Text style={st.detail}>Reviewed: {new Date(claim.reviewedAt).toLocaleString()}</Text>
              ) : null}
              {claim.reviewReason ? <Text style={st.reason}>Review note: {claim.reviewReason}</Text> : null}
              {claim.transactionId ? (
                <Text selectable style={st.transaction}>Wallet transaction ID: {claim.transactionId}</Text>
              ) : null}
              {claim.status === 'pending' ? (
                <View style={st.actions}>
                  <View style={{ flex: 1 }}>
                    <Btn
                      title="APPROVE & CREDIT"
                      kind="gold"
                      small
                      loading={busyId === claim.id}
                      disabled={instagramReviewMutation.isPending}
                      onPress={() => setInstagramReviewTarget({ claim, action: 'approve' })}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Btn
                      title="REJECT"
                      kind="danger"
                      small
                      loading={busyId === claim.id}
                      disabled={instagramReviewMutation.isPending}
                      onPress={() => setInstagramReviewTarget({ claim, action: 'reject' })}
                    />
                  </View>
                </View>
              ) : null}
            </Card>
          ))
        )}
      </ScreenWrap>
      <ConfirmDialog
        visible={!!reviewTarget}
        title={reviewTarget?.action === 'approve' ? 'Approve YouTube claim?' : 'Reject YouTube claim?'}
        message={reviewTarget?.action === 'approve'
          ? `After you verify the subscription, this will add ${reviewTarget.claim.rewardCoins} coins to ${reviewTarget.claim.userName}'s wallet and permanently complete the task for this account.`
          : `This claim will be rejected. The user can submit a new claim after subscribing.`}
        confirmTitle={reviewTarget?.action === 'approve' ? 'APPROVE & CREDIT' : 'REJECT CLAIM'}
        danger={reviewTarget?.action === 'reject'}
        onCancel={() => setReviewTarget(null)}
        onConfirm={() => { if (reviewTarget) void review(reviewTarget); }}
      />
      <ConfirmDialog
        visible={!!instagramReviewTarget}
        title={instagramReviewTarget?.action === 'approve' ? 'Approve Instagram claim?' : 'Reject Instagram claim?'}
        message={instagramReviewTarget?.action === 'approve'
          ? `After you verify @${instagramReviewTarget.claim.instagramUsername}, this will add ${instagramReviewTarget.claim.rewardCoins} coins to ${instagramReviewTarget.claim.userName}'s wallet and permanently complete the task for this account.`
          : 'This claim will be rejected. The user can follow the account and submit a new claim.'}
        confirmTitle={instagramReviewTarget?.action === 'approve' ? 'APPROVE & CREDIT' : 'REJECT CLAIM'}
        danger={instagramReviewTarget?.action === 'reject'}
        onCancel={() => setInstagramReviewTarget(null)}
        onConfirm={() => { if (instagramReviewTarget) void reviewInstagram(instagramReviewTarget); }}
      />
    </View>
  );
}

const st = StyleSheet.create({
  summary: { marginBottom: 18 },
  summaryValue: { color: A.gold, fontSize: 28, fontWeight: '900' },
  summaryLabel: { color: A.sub, fontSize: 9, fontWeight: '900', letterSpacing: 0.8, marginTop: 2 },
  summaryNote: { color: A.sub, fontSize: 11, lineHeight: 16, marginTop: 8 },
  claimCard: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  identity: { flex: 1 },
  name: { color: A.text, fontSize: 14, fontWeight: '900' },
  sub: { color: A.sub, fontSize: 10, marginTop: 3 },
  detail: { color: A.sub, fontSize: 10, lineHeight: 15, marginTop: 6 },
  reason: { color: A.danger, fontSize: 10, lineHeight: 15, marginTop: 7 },
  transaction: { color: A.gold, fontSize: 9, lineHeight: 14, marginTop: 7 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  error: { color: A.danger, fontSize: 12 },
  empty: { color: A.sub, textAlign: 'center', fontSize: 12, paddingVertical: 8 },
});