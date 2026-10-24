import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  KillEarnMatch,
  KillEarnParticipant,
  KillEarnRewardRecord,
} from '@workspace/api-client-react';
import { ReadableText as Text } from '../components/typography';
import { A } from '../components/adminKit';
import { Api, apiError } from '../lib/api';

type RewardStatus = KillEarnRewardRecord['status'];
type HistoryFilters = {
  matchId?: string;
  tournament?: string;
  player?: string;
  fromDate?: string;
  toDate?: string;
  status?: RewardStatus;
};

const STATUS_FILTERS: Array<{ value: RewardStatus | 'all'; label: string }> = [
  { value: 'all', label: 'ALL' },
  { value: 'pending', label: 'PENDING' },
  { value: 'approved', label: 'APPROVED' },
  { value: 'rejected', label: 'REJECTED' },
  { value: 'credited', label: 'CREDITED' },
];

function formatIst(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

function statusColor(status: string | null | undefined): string {
  if (status === 'credited') return A.green;
  if (status === 'approved') return A.cyan;
  if (status === 'rejected') return A.red;
  return A.gold;
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return 'NOT SAVED';
  return status.replaceAll('_', ' ').toUpperCase();
}

function isValidEvidenceReference(value: string | null | undefined): value is string {
  if (!value || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function ErrorNotice({ children }: { children: string }) {
  return (
    <View style={styles.errorNotice} accessibilityRole="alert">
      <Feather name="alert-circle" size={15} color={A.red} />
      <Text style={styles.errorText}>{children}</Text>
    </View>
  );
}

function ActionButton({
  title,
  onPress,
  disabled,
  tone = 'blue',
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'blue' | 'green' | 'red' | 'ghost';
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        tone === 'blue' && styles.blueButton,
        tone === 'green' && styles.greenButton,
        tone === 'red' && styles.redButton,
        tone === 'ghost' && styles.ghostButton,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressedButton,
      ]}
    >
      <Text style={[styles.actionButtonText, tone === 'ghost' && styles.ghostButtonText]}>
        {title}
      </Text>
    </Pressable>
  );
}

export default function AdminKillEarnRewards() {
  const queryClient = useQueryClient();
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [draftKills, setDraftKills] = useState<Record<string, string>>({});
  const [draftEvidence, setDraftEvidence] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busyActionRef = useRef(new Set<string>());
  const [rejectingRewardId, setRejectingRewardId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [notice, setNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const [tournamentFilter, setTournamentFilter] = useState('');
  const [playerFilter, setPlayerFilter] = useState('');
  const [fromDateFilter, setFromDateFilter] = useState('');
  const [toDateFilter, setToDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<RewardStatus | 'all'>('all');
  const [appliedHistoryFilters, setAppliedHistoryFilters] = useState<HistoryFilters>({});

  const matchesQuery = useQuery({
    queryKey: ['admin-kill-earn-completed-matches'],
    queryFn: Api.adminKillEarnMatches,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const matches = matchesQuery.data ?? [];
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? null;

  const participantsQuery = useQuery({
    queryKey: ['admin-kill-earn-participants', selectedMatchId],
    queryFn: () => Api.adminKillEarnParticipants(selectedMatchId!),
    enabled: Boolean(selectedMatchId),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const participants = participantsQuery.data ?? [];

  const historyQuery = useQuery({
    queryKey: ['admin-kill-earn-reward-history', appliedHistoryFilters],
    queryFn: () => Api.adminKillEarnRewardHistory(appliedHistoryFilters),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const history = historyQuery.data ?? [];

  const refreshAll = () => {
    void matchesQuery.refetch();
    if (selectedMatchId) void participantsQuery.refetch();
    void historyQuery.refetch();
  };

  const setSelectedMatch = (match: KillEarnMatch) => {
    setSelectedMatchId(match.id);
    setDraftKills({});
    setDraftEvidence({});
    setErrorMessage('');
    setNotice('');
    setRejectingRewardId(null);
    setRejectReason('');
  };

  const saveKills = async (participant: KillEarnParticipant) => {
    const actionKey = `save:${participant.registrationId}`;
    if (busyActionRef.current.has(actionKey)) return;
    const raw = draftKills[participant.registrationId] ?? '';
    if (!/^\d{1,10}$/.test(raw)) {
      setErrorMessage('Enter verified kills as a non-negative whole number.');
      setNotice('');
      return;
    }
    const kills = Number(raw);
    if (!Number.isSafeInteger(kills) || kills > 2_147_483_647) {
      setErrorMessage('The kill count is outside the supported range.');
      setNotice('');
      return;
    }
    const rawEvidence = draftEvidence[participant.registrationId] ??
      participant.evidenceReference ??
      '';
    const evidenceReference = rawEvidence.trim();
    if (evidenceReference && !isValidEvidenceReference(evidenceReference)) {
      setErrorMessage('Enter a valid HTTPS match-end evidence URL (maximum 2048 characters).');
      setNotice('');
      return;
    }
    busyActionRef.current.add(actionKey);
    setBusyAction(actionKey);
    setErrorMessage('');
    setNotice('');
    try {
      const saved = await Api.adminSaveKillEarnKills(
        selectedMatchId!,
        participant.registrationId,
        kills,
        evidenceReference || null,
      );
      setDraftKills((current) => ({
        ...current,
        [participant.registrationId]: String(saved.verifiedKills),
      }));
      setDraftEvidence((current) => ({
        ...current,
        [participant.registrationId]: saved.evidenceReference ?? '',
      }));
      setNotice(`Saved ${saved.verifiedKills} verified kills and evidence for ${saved.playerName}. No coins were credited.`);
      await queryClient.invalidateQueries({ queryKey: ['admin-kill-earn-participants', selectedMatchId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-kill-earn-reward-history'] });
    } catch (error) {
      setErrorMessage(apiError(error));
    } finally {
      busyActionRef.current.delete(actionKey);
      setBusyAction(null);
    }
  };

  const approveReward = async (participant: KillEarnParticipant) => {
    if (!participant.rewardId) {
      setErrorMessage('Save this player’s verified kills before approving a reward.');
      return;
    }
    const pendingEvidenceDraft = draftEvidence[participant.registrationId];
    if (pendingEvidenceDraft !== undefined &&
        pendingEvidenceDraft.trim() !== (participant.evidenceReference ?? '')) {
      setErrorMessage('Save the match-end evidence link before approving this reward.');
      return;
    }
    if (!isValidEvidenceReference(participant.evidenceReference)) {
      setErrorMessage('Save a valid HTTPS match-end evidence link before approving this reward.');
      return;
    }
    const actionKey = `approve:${participant.rewardId}`;
    if (busyActionRef.current.has(actionKey)) return;
    const amount = participant.rewardCoins ?? 0;
    Alert.alert(
      amount > 0 ? 'Approve and credit reward?' : 'Approve zero-coin result?',
      amount > 0
        ? `Credit ${amount} coins to ${participant.playerName} for ${participant.verifiedKills} verified kills?`
        : `Approve ${participant.playerName}'s saved result. No coins will be added.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: amount > 0 ? 'APPROVE & CREDIT' : 'APPROVE',
          onPress: () => { void confirmApprove(participant.rewardId!, actionKey); },
        },
      ],
    );
  };

  const confirmApprove = async (rewardId: string, actionKey: string) => {
    if (busyActionRef.current.has(actionKey)) return;
    busyActionRef.current.add(actionKey);
    setBusyAction(actionKey);
    setErrorMessage('');
    setNotice('');
    try {
      const credited = await Api.adminApproveKillEarnReward(rewardId);
      setNotice(credited.status === 'credited'
        ? `${credited.rewardCoins} coins credited to ${credited.playerName}.`
        : `Reward approved for ${credited.playerName}; no coins were due.`);
      await queryClient.invalidateQueries({ queryKey: ['admin-kill-earn-participants', selectedMatchId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-kill-earn-reward-history'] });
    } catch (error) {
      setErrorMessage(apiError(error));
      await queryClient.invalidateQueries({ queryKey: ['admin-kill-earn-participants', selectedMatchId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-kill-earn-reward-history'] });
    } finally {
      busyActionRef.current.delete(actionKey);
      setBusyAction(null);
    }
  };

  const rejectReward = async (rewardId: string) => {
    const actionKey = `reject:${rewardId}`;
    if (busyActionRef.current.has(actionKey)) return;
    const reason = rejectReason.trim();
    if (reason.length < 3 || reason.length > 500) {
      setErrorMessage('Enter a rejection reason between 3 and 500 characters.');
      return;
    }
    busyActionRef.current.add(actionKey);
    setBusyAction(actionKey);
    setErrorMessage('');
    setNotice('');
    try {
      const rejected = await Api.adminRejectKillEarnReward(rewardId, reason);
      setNotice(`Reward rejected for ${rejected.playerName}. No coins were credited.`);
      setRejectingRewardId(null);
      setRejectReason('');
      await queryClient.invalidateQueries({ queryKey: ['admin-kill-earn-participants', selectedMatchId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-kill-earn-reward-history'] });
    } catch (error) {
      setErrorMessage(apiError(error));
      await queryClient.invalidateQueries({ queryKey: ['admin-kill-earn-participants', selectedMatchId] });
    } finally {
      busyActionRef.current.delete(actionKey);
      setBusyAction(null);
    }
  };

  const applyHistoryFilters = () => {
    const next: HistoryFilters = {};
    if (tournamentFilter.trim()) next.tournament = tournamentFilter.trim();
    if (playerFilter.trim()) next.player = playerFilter.trim();
    if (fromDateFilter.trim()) next.fromDate = fromDateFilter.trim();
    if (toDateFilter.trim()) next.toDate = toDateFilter.trim();
    if (statusFilter !== 'all') next.status = statusFilter;
    setAppliedHistoryFilters(next);
  };

  const clearHistoryFilters = () => {
    setTournamentFilter('');
    setPlayerFilter('');
    setFromDateFilter('');
    setToDateFilter('');
    setStatusFilter('all');
    setAppliedHistoryFilters({});
  };

  const selectedParticipantCount = useMemo(() => participants.length, [participants.length]);
  const openEvidence = (reference: string) => {
    if (!isValidEvidenceReference(reference)) {
      setErrorMessage('This match-end evidence link is not a valid HTTPS URL.');
      return;
    }
    void Linking.openURL(reference).catch(() => {
      setErrorMessage('Could not open the match-end evidence link.');
    });
  };

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={matchesQuery.isRefetching || participantsQuery.isRefetching || historyQuery.isRefetching}
          onRefresh={refreshAll}
          tintColor={A.gold}
          colors={[A.gold, A.cyan]}
        />
      }
    >
      <View style={styles.headingRow}>
        <View style={styles.headingIcon}><Feather name="zap" size={20} color={A.gold} /></View>
        <View style={styles.headingCopy}>
          <Text style={styles.pageTitle}>KILL & EARN RESULTS</Text>
          <Text style={styles.subtitle}>Verify individual kills and review coin payouts.</Text>
        </View>
      </View>

      {errorMessage ? <ErrorNotice>{errorMessage}</ErrorNotice> : null}
      {notice ? (
        <View style={styles.successNotice} accessibilityRole="alert">
          <Feather name="check-circle" size={15} color={A.green} />
          <Text style={styles.successText}>{notice}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>COMPLETED KILL & EARN MATCHES</Text>
        <Text style={styles.sectionHint}>Select a completed tournament to enter each approved player’s verified kills.</Text>
        {matchesQuery.isLoading ? (
          <ActivityIndicator color={A.gold} style={styles.loader} />
        ) : matchesQuery.isError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Could not load completed Kill & Earn tournaments.</Text>
            <ActionButton title="RETRY" tone="ghost" onPress={() => { void matchesQuery.refetch(); }} />
          </View>
        ) : matches.length === 0 ? (
          <View style={styles.emptyCard}>
            <Feather name="target" size={24} color={A.sub} />
            <Text style={styles.emptyTitle}>NO COMPLETED MATCHES</Text>
            <Text style={styles.emptyText}>Completed Kill & Earn tournaments with a published winner will appear here.</Text>
          </View>
        ) : (
          <View style={styles.matchList}>
            {matches.map((match) => (
              <Pressable
                key={match.id}
                accessibilityRole="button"
                accessibilityLabel={`Manage ${match.title}, ${match.submode}, ${match.approvedPlayers} approved players`}
                accessibilityState={{ selected: selectedMatchId === match.id }}
                onPress={() => setSelectedMatch(match)}
                style={[styles.matchCard, selectedMatchId === match.id && styles.matchCardSelected]}
              >
                <View style={styles.matchCardTop}>
                  <Text style={styles.matchTitle}>{match.title}</Text>
                  <Feather
                    name={selectedMatchId === match.id ? 'check-circle' : 'chevron-right'}
                    size={17}
                    color={selectedMatchId === match.id ? A.green : A.sub}
                  />
                </View>
                <Text style={styles.matchMeta}>
                  {match.submode.toUpperCase()} · {match.approvedPlayers} approved player{match.approvedPlayers === 1 ? '' : 's'}
                </Text>
                <Text style={styles.matchMeta}>
                  {formatIst(match.startsAt)} · {match.killRewardCoins} coins per kill
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {selectedMatch ? (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>MANAGE MATCH RESULTS</Text>
            <Text style={styles.countPill}>{selectedParticipantCount} PLAYERS</Text>
          </View>
          <Text style={styles.sectionHint}>
            {selectedMatch.title} · {selectedMatch.submode.toUpperCase()} · {selectedMatch.killRewardCoins} coins per kill
          </Text>
          <View style={styles.formulaCard}>
            <Text style={styles.formulaTitle}>REWARD CALCULATION</Text>
            <Text style={styles.formulaText}>Verified kills × saved reward rate = total coins</Text>
            <Text style={styles.formulaText}>Saving kills never credits coins. Approval credits once.</Text>
          </View>

          {participantsQuery.isLoading ? (
            <ActivityIndicator color={A.gold} style={styles.loader} />
          ) : participantsQuery.isError ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>Could not load the approved player list.</Text>
              <ActionButton title="RETRY" tone="ghost" onPress={() => { void participantsQuery.refetch(); }} />
            </View>
          ) : participants.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>NO APPROVED PLAYERS</Text>
              <Text style={styles.emptyText}>There are no approved registrations to review for this tournament.</Text>
            </View>
          ) : (
            <View style={styles.participantList}>
              {participants.map((participant) => {
                const savedKills = participant.verifiedKills;
                const raw = draftKills[participant.registrationId] ??
                  (savedKills === null ? '' : String(savedKills));
                const evidenceRaw = draftEvidence[participant.registrationId] ??
                  participant.evidenceReference ??
                  '';
                const savedEvidence = participant.evidenceReference ?? '';
                const evidenceChanged = evidenceRaw.trim() !== savedEvidence;
                const validDraft = /^\d{1,10}$/.test(raw) &&
                  Number.isSafeInteger(Number(raw)) &&
                  Number(raw) <= 2_147_483_647;
                const previewCoins = validDraft ? Number(raw) * participant.rewardPerKill : null;
                const isPending = participant.status === null || participant.status === 'pending';
                const canSave = isPending && validDraft &&
                  (!participant.rewardId || Number(raw) !== savedKills || evidenceChanged);
                const evidenceReady = isValidEvidenceReference(participant.evidenceReference) &&
                  !evidenceChanged;
                const saveKey = `save:${participant.registrationId}`;
                const approveKey = `approve:${participant.rewardId ?? ''}`;
                const rejectKey = `reject:${participant.rewardId ?? ''}`;
                const savedPending = Boolean(participant.rewardId && participant.status === 'pending');
                return (
                  <View key={participant.registrationId} style={styles.playerCard}>
                    <View style={styles.playerHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.playerName}>{participant.playerName}</Text>
                        <Text style={styles.playerMeta}>
                          UID {participant.playerUid}
                          {participant.teamNumber ? ` · TEAM ${String(participant.teamNumber).padStart(2, '0')}` : ''}
                        </Text>
                      </View>
                      <View style={[styles.statusPill, { borderColor: `${statusColor(participant.status)}88` }]}>
                        <View style={[styles.statusDot, { backgroundColor: statusColor(participant.status) }]} />
                        <Text style={[styles.statusText, { color: statusColor(participant.status) }]}>
                          {statusLabel(participant.status)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.rewardRow}>
                      <View style={styles.killFieldGroup}>
                        <Text style={styles.fieldLabel}>VERIFIED KILLS</Text>
                        <TextInput
                          accessibilityLabel={`Verified kills for ${participant.playerName}`}
                          value={raw}
                          onChangeText={(value) => setDraftKills((current) => ({
                            ...current,
                            [participant.registrationId]: value.replace(/\D/g, '').slice(0, 10),
                          }))}
                          editable={isPending && busyAction !== saveKey && busyAction !== approveKey}
                          keyboardType="number-pad"
                          maxLength={10}
                          placeholder="0"
                          placeholderTextColor="rgba(211,220,255,0.42)"
                          style={[styles.input, styles.killsInput, !isPending && styles.readOnlyInput]}
                        />
                      </View>
                      <View style={styles.rewardSummary}>
                        <Text style={styles.fieldLabel}>RATE</Text>
                        <Text style={styles.rewardValue}>{participant.rewardPerKill} COINS / KILL</Text>
                        <Text style={styles.previewValue}>
                          {previewCoins === null ? 'Enter kills to calculate' : `TOTAL · ${previewCoins} COINS`}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.evidenceSection}>
                      <Text style={styles.fieldLabel}>MATCH-END EVIDENCE · HTTPS LINK</Text>
                      <TextInput
                        accessibilityLabel={`Match-end evidence URL for ${participant.playerName}, registered UID ${participant.playerUid}`}
                        value={evidenceRaw}
                        onChangeText={(value) => setDraftEvidence((current) => ({
                          ...current,
                          [participant.registrationId]: value,
                        }))}
                        editable={isPending && busyAction !== saveKey && busyAction !== approveKey}
                        keyboardType="url"
                        autoCapitalize="none"
                        autoCorrect={false}
                        maxLength={2048}
                        placeholder="https://…"
                        placeholderTextColor="rgba(211,220,255,0.42)"
                        style={[styles.input, !isPending && styles.readOnlyInput]}
                      />
                      <Text style={styles.evidenceHint}>
                        Use a persistent match-end screenshot or video link. Confirm the registered UID matches the proof before saving.
                      </Text>
                      {evidenceRaw.trim() && !isValidEvidenceReference(evidenceRaw.trim()) ? (
                        <Text style={styles.evidenceError}>Enter a valid HTTPS URL without embedded credentials.</Text>
                      ) : null}
                      {participant.evidenceReference ? (
                        <Pressable
                          accessibilityRole="link"
                          accessibilityLabel={`Open match-end evidence for ${participant.playerName}, registered UID ${participant.playerUid}`}
                          onPress={() => openEvidence(participant.evidenceReference!)}
                          style={styles.evidenceLink}
                        >
                          <Feather name="external-link" size={14} color={A.cyan} />
                          <Text style={styles.evidenceLinkText}>OPEN SAVED MATCH EVIDENCE</Text>
                        </Pressable>
                      ) : (
                        <Text style={styles.evidenceMissing}>No evidence saved. Evidence is required before approval.</Text>
                      )}
                    </View>

                    {participant.status === 'rejected' && participant.rejectionReason ? (
                      <Text style={styles.rejectionText}>Reason: {participant.rejectionReason}</Text>
                    ) : null}
                    {participant.walletTransactionId ? (
                      <Text style={styles.transactionText}>
                        Wallet transaction · {participant.walletTransactionId}
                      </Text>
                    ) : null}
                    {participant.reviewedAt ? (
                      <Text style={styles.playerMeta}>
                        Reviewed {formatIst(participant.reviewedAt)}
                        {participant.reviewedBy ? ` · Admin ${participant.reviewedBy}` : ''}
                      </Text>
                    ) : null}

                    {isPending ? (
                      <View style={styles.actionRow}>
                        <ActionButton
                          title={busyAction === saveKey ? 'SAVING…' : 'SAVE KILLS & EVIDENCE'}
                          onPress={() => { void saveKills(participant); }}
                          disabled={!canSave || busyAction === saveKey}
                          tone="ghost"
                          accessibilityLabel={`Save verified kills for ${participant.playerName}`}
                        />
                        {savedPending ? (
                          <>
                            <ActionButton
                              title={busyAction === approveKey ? 'PROCESSING…' : 'APPROVE & CREDIT'}
                              onPress={() => { void approveReward(participant); }}
                              disabled={!evidenceReady || busyAction === approveKey || busyAction === rejectKey}
                              tone="green"
                              accessibilityLabel={`Approve and credit ${participant.rewardCoins ?? 0} coins to ${participant.playerName}`}
                            />
                            {rejectingRewardId === participant.rewardId ? (
                              <View style={styles.rejectEditor}>
                                <TextInput
                                  accessibilityLabel={`Rejection reason for ${participant.playerName}`}
                                  value={rejectReason}
                                  onChangeText={setRejectReason}
                                  maxLength={500}
                                  multiline
                                  placeholder="Enter rejection reason"
                                  placeholderTextColor="rgba(211,220,255,0.42)"
                                  style={[styles.input, styles.reasonInput]}
                                />
                                <View style={styles.actionRow}>
                                  <ActionButton
                                    title={busyAction === rejectKey ? 'REJECTING…' : 'CONFIRM REJECT'}
                                    onPress={() => { void rejectReward(participant.rewardId!); }}
                                    disabled={busyAction === rejectKey}
                                    tone="red"
                                  />
                                  <ActionButton
                                    title="KEEP PENDING"
                                    onPress={() => { setRejectingRewardId(null); setRejectReason(''); }}
                                    disabled={busyAction === rejectKey}
                                    tone="ghost"
                                  />
                                </View>
                              </View>
                            ) : (
                              <ActionButton
                                title="REJECT"
                                onPress={() => {
                                  setRejectingRewardId(participant.rewardId);
                                  setRejectReason('');
                                  setErrorMessage('');
                                }}
                                disabled={busyAction === approveKey || busyAction === rejectKey}
                                tone="red"
                              />
                            )}
                          </>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Feather name="mouse-pointer" size={20} color={A.sub} />
          <Text style={styles.emptyText}>Select a completed match above to manage individual player results.</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>REWARD HISTORY</Text>
        <Text style={styles.sectionHint}>Search saved results, approvals, rejections, and wallet credits.</Text>
        <TextInput
          accessibilityLabel="Filter history by tournament name or ID"
          value={tournamentFilter}
          onChangeText={setTournamentFilter}
          placeholder="Tournament name or ID"
          placeholderTextColor="rgba(211,220,255,0.42)"
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="Filter history by player name, UID, or account ID"
          value={playerFilter}
          onChangeText={setPlayerFilter}
          placeholder="Player name, UID, or account ID"
          placeholderTextColor="rgba(211,220,255,0.42)"
          style={styles.input}
        />
        <View style={styles.dateRow}>
          <TextInput
            accessibilityLabel="History from date in YYYY-MM-DD format"
            value={fromDateFilter}
            onChangeText={setFromDateFilter}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            placeholder="From · YYYY-MM-DD"
            placeholderTextColor="rgba(211,220,255,0.42)"
            style={[styles.input, styles.dateInput]}
          />
          <TextInput
            accessibilityLabel="History through date in YYYY-MM-DD format"
            value={toDateFilter}
            onChangeText={setToDateFilter}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            placeholder="To · YYYY-MM-DD"
            placeholderTextColor="rgba(211,220,255,0.42)"
            style={[styles.input, styles.dateInput]}
          />
        </View>
        <View style={styles.filterRow}>
          {STATUS_FILTERS.map((filter) => {
            const selected = statusFilter === filter.value;
            return (
              <Pressable
                key={filter.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setStatusFilter(filter.value)}
                style={[styles.filterPill, selected && styles.filterPillSelected]}
              >
                <Text style={[styles.filterText, selected && styles.filterTextSelected]}>{filter.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.actionRow}>
          <ActionButton title="APPLY FILTERS" onPress={applyHistoryFilters} tone="blue" />
          <ActionButton title="CLEAR" onPress={clearHistoryFilters} tone="ghost" />
        </View>

        {historyQuery.isLoading ? (
          <ActivityIndicator color={A.gold} style={styles.loader} />
        ) : historyQuery.isError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Could not load reward history.</Text>
            <ActionButton title="RETRY" tone="ghost" onPress={() => { void historyQuery.refetch(); }} />
          </View>
        ) : history.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No reward records match these filters.</Text>
          </View>
        ) : (
          <View style={styles.historyList}>
            {history.map((record) => (
              <HistoryCard key={record.id} record={record} onOpenEvidence={openEvidence} />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function HistoryCard({
  record,
  onOpenEvidence,
}: {
  record: KillEarnRewardRecord;
  onOpenEvidence: (reference: string) => void;
}) {
  const color = statusColor(record.status);
  return (
    <View style={styles.historyCard}>
      <View style={styles.playerHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.matchTitle}>{record.tournamentName} · {record.submode.toUpperCase()}</Text>
          <Text style={styles.playerMeta}>Tournament ID · {record.matchId}</Text>
        </View>
        <View style={[styles.statusPill, { borderColor: `${color}88` }]}>
          <View style={[styles.statusDot, { backgroundColor: color }]} />
          <Text style={[styles.statusText, { color }]}>{statusLabel(record.status)}</Text>
        </View>
      </View>
      <Text style={styles.playerName}>{record.playerName}</Text>
      <Text style={styles.playerMeta}>UID {record.playerUid} · Player ID {record.userId}</Text>
      {record.evidenceReference ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open match-end evidence for ${record.playerName}, registered UID ${record.playerUid}`}
          onPress={() => onOpenEvidence(record.evidenceReference!)}
          style={styles.evidenceLink}
        >
          <Feather name="external-link" size={14} color={A.cyan} />
          <Text style={styles.evidenceLinkText}>{record.evidenceReference}</Text>
        </Pressable>
      ) : (
        <Text style={styles.evidenceMissing}>No match-end evidence reference recorded.</Text>
      )}
      <Text style={styles.historyCalculation}>
        {record.verifiedKills} kills × {record.rewardPerKill} coins = {record.rewardCoins} coins
      </Text>
      <Text style={styles.playerMeta}>Saved · {formatIst(record.createdAt)}</Text>
      <Text style={styles.playerMeta}>
        Admin · {record.reviewedBy ?? '—'} · {formatIst(record.reviewedAt)}
      </Text>
      {record.creditedAt ? (
        <Text style={styles.playerMeta}>Credited · {formatIst(record.creditedAt)}</Text>
      ) : null}
      {record.walletTransactionId ? (
        <Text style={styles.transactionText}>Wallet transaction · {record.walletTransactionId}</Text>
      ) : null}
      {record.rejectionReason ? (
        <Text style={styles.rejectionText}>Rejection reason · {record.rejectionReason}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: A.bg },
  content: { paddingHorizontal: 14, paddingTop: 15, paddingBottom: 30, gap: 14 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 2 },
  headingIcon: {
    width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,198,54,0.12)', borderWidth: 1, borderColor: 'rgba(255,198,54,0.3)',
  },
  headingCopy: { flex: 1, minWidth: 0 },
  pageTitle: { color: A.gold, fontFamily: 'Orbitron_700Bold', fontSize: 15, letterSpacing: 0.7 },
  subtitle: { color: A.sub, fontSize: 11, marginTop: 4, lineHeight: 16 },
  section: {
    backgroundColor: '#0B1430', borderColor: A.border, borderWidth: 1,
    borderRadius: 15, padding: 13, gap: 10,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { color: A.gold, fontFamily: 'Orbitron_700Bold', fontSize: 12, letterSpacing: 0.6, flexShrink: 1 },
  sectionHint: { color: A.sub, fontSize: 11, lineHeight: 16 },
  countPill: {
    color: A.cyan, fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.45,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12,
    backgroundColor: 'rgba(91,177,255,0.1)', borderWidth: 1, borderColor: 'rgba(91,177,255,0.25)',
  },
  matchList: { gap: 8 },
  matchCard: {
    minHeight: 66, padding: 11, borderRadius: 12, borderWidth: 1,
    borderColor: A.border, backgroundColor: '#0D1938', justifyContent: 'center', gap: 5,
  },
  matchCardSelected: { borderColor: A.cyan, backgroundColor: 'rgba(24,128,255,0.12)' },
  matchCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  matchTitle: { flex: 1, minWidth: 0, color: A.text, fontSize: 13, fontFamily: 'Inter_700Bold' },
  matchMeta: { color: A.sub, fontSize: 10.5, lineHeight: 15 },
  emptyCard: {
    padding: 16, minHeight: 90, alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, borderColor: A.border, backgroundColor: '#0D1938',
  },
  emptyTitle: { color: A.gold, fontFamily: 'Orbitron_700Bold', fontSize: 11, textAlign: 'center' },
  emptyText: { color: A.sub, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  loader: { paddingVertical: 18 },
  formulaCard: { padding: 11, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,198,54,0.23)', backgroundColor: 'rgba(255,198,54,0.06)', gap: 4 },
  formulaTitle: { color: A.gold, fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5 },
  formulaText: { color: A.text, fontSize: 10.5, lineHeight: 15 },
  participantList: { gap: 9 },
  playerCard: { padding: 11, borderRadius: 12, borderWidth: 1, borderColor: A.border, backgroundColor: '#0D1938', gap: 10 },
  playerHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  playerName: { color: A.text, fontFamily: 'Inter_700Bold', fontSize: 13, lineHeight: 18 },
  playerMeta: { color: A.sub, fontSize: 10, lineHeight: 15, marginTop: 2 },
  statusPill: {
    minHeight: 26, flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 7, paddingVertical: 4,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 8, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },
  rewardRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  killFieldGroup: { width: 105, gap: 5 },
  rewardSummary: { flex: 1, minWidth: 0, gap: 5, paddingBottom: 5 },
  fieldLabel: { color: A.sub, fontFamily: 'Inter_700Bold', fontSize: 8, letterSpacing: 0.7 },
  input: {
    minHeight: 44, borderWidth: 1, borderColor: A.border, borderRadius: 10,
    backgroundColor: '#08122B', color: A.text, paddingHorizontal: 11, paddingVertical: 9,
    fontFamily: 'Inter_600SemiBold', fontSize: 12,
  },
  killsInput: { textAlign: 'center', fontSize: 16, color: A.gold, fontFamily: 'Orbitron_700Bold' },
  readOnlyInput: { color: A.sub, opacity: 0.8 },
  rewardValue: { color: A.cyan, fontFamily: 'Inter_700Bold', fontSize: 11 },
  previewValue: { color: A.green, fontFamily: 'Inter_700Bold', fontSize: 10.5 },
  evidenceSection: {
    gap: 6, padding: 9, borderRadius: 10, borderWidth: 1,
    borderColor: 'rgba(91,177,255,0.2)', backgroundColor: 'rgba(8,18,43,0.58)',
  },
  evidenceHint: { color: A.sub, fontSize: 9.5, lineHeight: 14 },
  evidenceError: { color: '#FF98A8', fontSize: 9.5, lineHeight: 14 },
  evidenceMissing: { color: A.gold, fontSize: 9.5, lineHeight: 14 },
  evidenceLink: {
    minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7,
    borderRadius: 9, borderWidth: 1, borderColor: 'rgba(91,177,255,0.28)',
    backgroundColor: 'rgba(91,177,255,0.07)', paddingHorizontal: 10, paddingVertical: 8,
  },
  evidenceLinkText: { flex: 1, minWidth: 0, color: A.cyan, fontSize: 9.5, lineHeight: 14, fontFamily: 'Inter_600SemiBold' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center' },
  actionButton: {
    minHeight: 44, minWidth: 92, flexGrow: 1, flexBasis: '30%',
    borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 10, paddingVertical: 8,
  },
  actionButtonText: { color: '#FFF', fontFamily: 'Inter_700Bold', fontSize: 9, textAlign: 'center', letterSpacing: 0.25 },
  blueButton: { backgroundColor: '#087FF2', borderColor: '#2E9AFF' },
  greenButton: { backgroundColor: 'rgba(22,179,120,0.24)', borderColor: A.green },
  redButton: { backgroundColor: 'rgba(221,60,84,0.17)', borderColor: A.red },
  ghostButton: { backgroundColor: 'rgba(91,177,255,0.06)', borderColor: A.border },
  ghostButtonText: { color: A.cyan },
  disabledButton: { opacity: 0.42 },
  pressedButton: { transform: [{ scale: 0.985 }] },
  rejectEditor: { width: '100%', gap: 7 },
  reasonInput: { minHeight: 60, textAlignVertical: 'top' },
  rejectionText: { color: '#FF98A8', fontSize: 10.5, lineHeight: 15 },
  transactionText: { color: A.cyan, fontSize: 9.5, lineHeight: 14, fontFamily: 'Inter_600SemiBold' },
  historyList: { gap: 8, marginTop: 2 },
  historyCard: { padding: 11, borderRadius: 12, borderWidth: 1, borderColor: A.border, backgroundColor: '#0D1938', gap: 5 },
  historyCalculation: { color: A.gold, fontFamily: 'Inter_700Bold', fontSize: 11.5, marginTop: 3 },
  dateRow: { flexDirection: 'row', gap: 8 },
  dateInput: { flex: 1, minWidth: 0, fontSize: 10.5 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filterPill: { minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, borderWidth: 1, borderColor: A.border, paddingHorizontal: 10 },
  filterPillSelected: { backgroundColor: 'rgba(255,198,54,0.12)', borderColor: A.gold },
  filterText: { color: A.sub, fontSize: 8, fontFamily: 'Inter_700Bold' },
  filterTextSelected: { color: A.gold },
  errorNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 11, padding: 10, borderWidth: 1, borderColor: 'rgba(255,113,135,0.38)', backgroundColor: 'rgba(255,67,97,0.09)' },
  errorText: { flex: 1, color: '#FF9AAA', fontSize: 11, lineHeight: 16 },
  successNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 11, padding: 10, borderWidth: 1, borderColor: 'rgba(56,220,165,0.3)', backgroundColor: 'rgba(56,220,165,0.08)' },
  successText: { flex: 1, color: A.green, fontSize: 11, lineHeight: 16 },
});
