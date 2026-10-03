import React, { useCallback, useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import {
  A, Btn, Card, Empty, Input, Loading, ScreenWrap, SectionTitle, StatusTag, useToast,
} from '../components/adminKit';
import { AccountRecoveryRequest, Api, apiError } from '../lib/api';

type ReviewAction = 'approve' | 'reject';

export default function AdminAccountRecovery({ currentUserId }: { currentUserId?: string }) {
  const toast = useToast();
  const [requests, setRequests] = useState<AccountRecoveryRequest[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reviewTarget, setReviewTarget] = useState<{ request: AccountRecoveryRequest; action: ReviewAction } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setRequests(await Api.adminAccountRecoveryRequests());
    } catch (error) {
      setLoadError(apiError(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openReview = (request: AccountRecoveryRequest, action: ReviewAction) => {
    setReviewNote('');
    setReviewTarget({ request, action });
  };

  const submitReview = async () => {
    const review = reviewTarget;
    const note = reviewNote.trim();
    if (!review || note.length < 10 || note.length > 500) return;
    setBusyId(review.request.id);
    try {
      await Api.reviewAdminAccountRecoveryRequest(review.request.id, review.action, note);
      setReviewTarget(null);
      setReviewNote('');
      toast(review.action === 'approve'
        ? 'Google linked to the existing account. Wallet and tournament records were not changed.'
        : 'Recovery request rejected.', 'ok');
      await load();
    } catch (error) {
      toast(apiError(error), 'err');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <ScreenWrap onRefresh={load}>
        <SectionTitle
          title="GOOGLE ACCOUNT RECOVERY"
          sub="Pending requests · Full Admin only"
          icon="key"
          right={<StatusTag status="pending" />}
        />

        <Card style={styles.policyCard}>
          <Text style={styles.policyTitle}>VERIFY OUTSIDE THE APP</Text>
          <Text style={styles.policyText}>
            Matching email is not proof of ownership. Check the account through a known, independent channel.
            A different Full Admin must review the request. Approval links Google to the existing account;
            it does not change the password, wallet, or tournament history.
          </Text>
        </Card>

        {!!loadError && (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{loadError}</Text>
            <Btn title="RETRY" kind="ghost" onPress={() => { void load(); }} small />
          </Card>
        )}

        {requests === null ? <Loading /> : requests.length === 0 ? (
          <Empty text="No Google recovery requests are waiting for review." />
        ) : requests.map((request) => {
          const isSelf = request.userId === currentUserId;
          return (
            <Card key={request.id} style={styles.requestCard}>
              <View style={styles.playerRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{request.accountName || 'Daily007 Player'}</Text>
                  <Text style={styles.email}>{request.accountEmail}</Text>
                </View>
                <StatusTag status="pending" />
              </View>
              <View style={styles.divider} />
              <Text style={styles.detailLabel}>GOOGLE IDENTITY</Text>
              <Text style={styles.detailValue}>{request.googleEmail}</Text>
              {!!request.phone && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>REGISTERED PHONE</Text>
                  <Text style={styles.detailValue}>{request.phone}</Text>
                </View>
              )}
              {!!request.gameUid && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>FREE FIRE UID</Text>
                  <Text style={styles.detailValue}>{request.gameUid}</Text>
                </View>
              )}
              <Text style={styles.createdAt}>
                Requested {new Date(request.createdAt).toLocaleString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })} IST
              </Text>
              {isSelf ? (
                <Text style={styles.selfReview}>
                  Your own request. A different Full Admin must review it.
                </Text>
              ) : (
                <View style={styles.actions}>
                  <View style={{ flex: 1 }}>
                    <Btn
                      title="REJECT"
                      kind="danger"
                      small
                      disabled={busyId !== null}
                      onPress={() => openReview(request, 'reject')}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Btn
                      title="VERIFY & LINK"
                      kind="green"
                      small
                      disabled={busyId !== null}
                      onPress={() => openReview(request, 'approve')}
                    />
                  </View>
                </View>
              )}
            </Card>
          );
        })}
      </ScreenWrap>

      <Modal
        visible={!!reviewTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setReviewTarget(null)}
      >
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {reviewTarget?.action === 'approve' ? 'VERIFY AND LINK GOOGLE' : 'REJECT RECOVERY REQUEST'}
            </Text>
            <Text style={styles.modalCopy}>
              {reviewTarget?.action === 'approve'
                ? `Link ${reviewTarget.request.googleEmail} to ${reviewTarget.request.accountEmail}? Record how you independently verified ownership.`
                : `Record why the request from ${reviewTarget?.request.googleEmail} is being rejected.`}
            </Text>
            <Input
              value={reviewNote}
              onChangeText={setReviewNote}
              multiline
              placeholder="Briefly describe the independent verification or reason for rejection"
              autoCapitalize="sentences"
            />
            <Text style={styles.noteHint}>
              {reviewNote.trim().length}/500 · At least 10 characters. Do not enter passwords, codes, or document details.
            </Text>
            <View style={styles.modalActions}>
              <View style={{ flex: 1 }}>
                <Btn title="CANCEL" kind="ghost" onPress={() => setReviewTarget(null)} disabled={busyId !== null} />
              </View>
              <View style={{ flex: 1 }}>
                <Btn
                  title={reviewTarget?.action === 'approve' ? 'VERIFY & LINK' : 'REJECT'}
                  kind={reviewTarget?.action === 'approve' ? 'green' : 'danger'}
                  onPress={() => { void submitReview(); }}
                  loading={!!reviewTarget && busyId === reviewTarget.request.id}
                  disabled={reviewNote.trim().length < 10 || reviewNote.trim().length > 500}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  policyCard: { marginBottom: 12, borderColor: 'rgba(255,176,32,0.28)' },
  policyTitle: { color: A.gold, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  policyText: { color: A.sub, fontSize: 11, lineHeight: 17, marginTop: 7 },
  errorCard: { marginBottom: 12, borderColor: 'rgba(255,92,92,0.45)', gap: 10 },
  errorText: { color: '#ffb4b4', fontSize: 12, lineHeight: 18 },
  requestCard: { marginBottom: 12 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: A.text, fontSize: 14, fontWeight: '800' },
  email: { color: A.sub, fontSize: 11, marginTop: 3 },
  divider: { height: 1, backgroundColor: A.border, marginVertical: 12 },
  detailLabel: { color: A.sub, fontSize: 9, fontWeight: '800', letterSpacing: 0.6, marginTop: 5 },
  detailValue: { color: A.text, fontSize: 12, marginTop: 3, flexShrink: 1 },
  detailRow: { marginTop: 5 },
  createdAt: { color: A.sub, fontSize: 10, marginTop: 12 },
  selfReview: { color: A.gold, fontSize: 11, lineHeight: 16, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 9, marginTop: 12 },
  overlay: { flex: 1, justifyContent: 'center', padding: 18, backgroundColor: 'rgba(0,0,0,0.72)' },
  modal: { backgroundColor: '#101620', borderColor: 'rgba(77,163,255,0.18)', borderWidth: 1, borderRadius: 16, padding: 18 },
  modalTitle: { color: A.gold, fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  modalCopy: { color: A.sub, fontSize: 12, lineHeight: 18, marginVertical: 12 },
  noteHint: { color: A.sub, fontSize: 10, lineHeight: 15, marginTop: 7 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
});