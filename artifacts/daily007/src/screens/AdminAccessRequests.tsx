import React from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import {
  useDaily007AdminListTournamentAdminAccessRequests,
  useDaily007AdminReviewTournamentAdminAccessRequest,
} from '@workspace/api-client-react';
import type { Daily007AdminAccessRequest } from '@workspace/api-client-react';
import { A, Btn, Card, ScreenWrap, SectionTitle, StatusTag, useToast } from '../components/adminKit';
import { apiError } from '../lib/api';

type ReviewAction = 'approve' | 'reject';

export default function AdminAccessRequests() {
  const toast = useToast();
  const requestsQuery = useDaily007AdminListTournamentAdminAccessRequests();
  const reviewMutation = useDaily007AdminReviewTournamentAdminAccessRequest();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const requests = requestsQuery.data ?? [];

  const review = async (request: Daily007AdminAccessRequest, action: ReviewAction) => {
    if (reviewMutation.isPending) return;
    setBusyId(request.id);
    try {
      await reviewMutation.mutateAsync({ id: request.id, action });
      toast(
        action === 'approve'
          ? `${request.name} now has Tournament Admin access.`
          : `Access request from ${request.name} rejected.`,
        'success',
      );
      await requestsQuery.refetch();
    } catch (error) {
      toast(apiError(error), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const confirmReview = (request: Daily007AdminAccessRequest, action: ReviewAction) => {
    const approving = action === 'approve';
    Alert.alert(
      approving ? 'Approve Tournament Admin access?' : 'Reject access request?',
      approving
        ? `${request.name} will be able to manage tournament operations only. Wallet, payments, withdrawals, and earn rewards remain Full-Admin-only.`
        : `Keep ${request.name} as a regular player?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: approving ? 'Approve' : 'Reject',
          style: approving ? 'default' : 'destructive',
          onPress: () => { void review(request, action); },
        },
      ],
    );
  };

  return (
    <ScreenWrap onRefresh={async () => { await requestsQuery.refetch(); }}>
      <SectionTitle
        title="TOURNAMENT ADMIN ACCESS"
        sub={`${requests.length} pending request${requests.length === 1 ? '' : 's'}`}
      />
      <Card>
        <Text style={st.note}>
          Requests submitted from player accounts appear here. Approval grants tournament-only permissions; it does not grant access to general wallet or payment tools.
        </Text>
      </Card>

      {requestsQuery.isPending && !requestsQuery.data ? (
        <ActivityIndicator color={A.red} style={{ marginTop: 24 }} />
      ) : requestsQuery.error ? (
        <Card><Text style={st.error}>Could not load access requests: {apiError(requestsQuery.error)}</Text></Card>
      ) : requests.length === 0 ? (
        <Card><Text style={st.empty}>No pending Tournament Admin access requests.</Text></Card>
      ) : (
        requests.map((request) => {
          const blocked = request.userStatus === 'blocked';
          return (
            <Card key={request.id} style={st.requestCard}>
              <View style={st.topRow}>
                <View style={{ flex: 1 }}>
                  <Text style={st.name}>{request.name || 'Player'}</Text>
                  <Text style={st.email}>{request.email}</Text>
                </View>
                <StatusTag status={blocked ? 'blocked' : 'pending'} />
              </View>
              <Text style={st.meta}>Submitted {new Date(request.createdAt).toLocaleString()}</Text>
              {blocked && <Text style={st.blocked}>This account is blocked. Unblock it before approving access.</Text>}
              <View style={st.actions}>
                <View style={{ flex: 1 }}>
                  <Btn
                    title="APPROVE ACCESS"
                    kind="gold"
                    small
                    disabled={blocked || reviewMutation.isPending}
                    loading={busyId === request.id && reviewMutation.isPending}
                    onPress={() => confirmReview(request, 'approve')}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Btn
                    title="REJECT"
                    kind="danger"
                    small
                    disabled={reviewMutation.isPending}
                    loading={busyId === request.id && reviewMutation.isPending}
                    onPress={() => confirmReview(request, 'reject')}
                  />
                </View>
              </View>
            </Card>
          );
        })
      )}
    </ScreenWrap>
  );
}

const st = StyleSheet.create({
  note: { color: A.sub, fontSize: 11, lineHeight: 17 },
  empty: { color: A.sub, fontSize: 12, textAlign: 'center', paddingVertical: 10 },
  error: { color: A.danger, fontSize: 12, lineHeight: 18 },
  requestCard: { gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: A.text, fontSize: 14, fontWeight: '900' },
  email: { color: A.sub, fontSize: 11, marginTop: 3 },
  meta: { color: A.sub, fontSize: 10 },
  blocked: { color: A.danger, fontSize: 11, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
});