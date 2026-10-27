import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, ActivityIndicator, AccessibilityInfo, Platform, AppState, Pressable, useWindowDimensions, Modal, KeyboardAvoidingView } from 'react-native';
import {
  getGetTournamentParticipantsQueryKey,
  getGetTournamentResultsQueryKey,
  getDaily007V2GetSquadSlotsQueryKey,
  useDaily007V2AddSquadTeammate,
  useDaily007V2GetSquadSlots,
  useDaily007V2JoinSquadSlot,
  useDaily007V2RemoveSquadMember,
  useGetTournamentParticipants,
  useGetTournamentResults,
} from '@workspace/api-client-react';
import { ReadableText as Text } from '../components/typography';
import { useFocusEffect, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../lib/api';
import { C, Btn, Card, Chip, Input, KV, Msg, Badge, SectionTitle, GCard, fmtDate, fmtTime12, statusOf } from '../components/ui';
import { inr, COIN_RATE_TEXT } from '../lib/coins';
import { useApp } from '../App';
import { RoomCredentialsPanel } from '../components/RoomCredentialsPanel';
import { ModeSeatSlotsPanel } from '../components/ModeSeatSlotsPanel';
import {
  getRoomCredentialSchedule,
  hasServerAuthorizedRoomCredentials,
} from '../lib/roomCredentialTiming';
import { createRoomCredentialAvailabilityAnnouncementTracker } from '../lib/roomCredentialAvailabilityAnnouncement';
import { getTournamentLifecycleState, MAX_TIMEOUT_MS } from '../lib/tournamentLifecycle';
import {
  createTournamentDetailRefreshController,
  fetchTournamentDetailSnapshot,
} from '../lib/tournament-detail-refresh';
import {
  getTournamentResultsRefreshInterval,
  resolveTournamentWinnerState,
} from '../lib/tournament-winner-details';
import { getTournamentTeamSlotSummary } from '../lib/tournamentTeamSlots';
import { getTournamentSeatLayout } from '../lib/tournamentSeatLayout';
import { getTournamentSeatRefreshInterval } from '../lib/tournamentSeatRefresh';
import { getTournamentFilledPlayerCount, isTournamentCapacityFull } from '../lib/tournamentCapacity';
import { translateExactText } from '../i18n';

const claimRoomDetailsAvailabilityAnnouncement =
  createRoomCredentialAvailabilityAnnouncementTracker();

function SquadSlotsPanel({
  tournamentId,
  entryCoins,
  walletCoins,
  onGoWallet,
  onJoined,
  onRefetchAvailable,
  refreshInterval,
}: {
  tournamentId: string;
  entryCoins: number;
  walletCoins: number;
  onGoWallet: () => void;
  onJoined: () => Promise<void>;
  onRefetchAvailable: (refetch: (() => Promise<unknown>) | null) => void;
  refreshInterval: number | false;
}) {
  const [selected, setSelected] = useState<{ teamNumber: number; slotNumber: number } | null>(null);
  const [joinDetailsOpen, setJoinDetailsOpen] = useState(false);
  const [captainAddOpen, setCaptainAddOpen] = useState(false);
  const [gameName, setGameName] = useState('');
  const [gameUid, setGameUid] = useState('');
  const [teammateName, setTeammateName] = useState('');
  const [teammateUid, setTeammateUid] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<{ teamNumber: number; slotNumber: number } | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [hoveredSlotKey, setHoveredSlotKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const { width, fontScale } = useWindowDimensions();
  const compactLargeText = width <= 400 && fontScale >= 1.5;
  const slotsQuery = useDaily007V2GetSquadSlots(tournamentId, {
    query: {
      queryKey: getDaily007V2GetSquadSlotsQueryKey(tournamentId),
      enabled: Boolean(tournamentId),
      refetchOnMount: 'always',
      refetchInterval: refreshInterval,
      retry: 1,
    },
  });
  const joinMutation = useDaily007V2JoinSquadSlot();
  const addTeammateMutation = useDaily007V2AddSquadTeammate();
  const removeMutation = useDaily007V2RemoveSquadMember();
  const slots = slotsQuery.data;

  useEffect(() => {
    const refetchSlots = () => slotsQuery.refetch();
    onRefetchAvailable(refetchSlots);
    return () => onRefetchAvailable(null);
  }, [onRefetchAvailable, slotsQuery.refetch]);

  const join = async () => {
    if (!selected || busyKey) return;
    setError('');
    setMessage('');
    setBusyKey(`join-${selected.teamNumber}-${selected.slotNumber}`);
    try {
      const result = await joinMutation.mutateAsync({
        id: tournamentId,
        data: {
          teamNumber: selected.teamNumber,
          slotNumber: selected.slotNumber,
          gameName: gameName.trim(),
          gameUid: gameUid.trim(),
        },
      });
      setSelected(null);
      setJoinDetailsOpen(false);
      setGameName('');
      setGameUid('');
      setMessage(
        result.entryCoinsPaid > 0
          ? `Slot confirmed. ${result.entryCoinsPaid} coins were deducted from your wallet.`
          : 'Slot confirmed. No coins were deducted.',
      );
      await Promise.all([slotsQuery.refetch(), onJoined()]);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Could not join this slot. Refresh and try again.');
      void slotsQuery.refetch();
    } finally {
      setBusyKey('');
    }
  };

  const addTeammate = async () => {
    if (!selected || !captainAddOpen || busyKey) return;
    setError('');
    setMessage('');
    setBusyKey(`add-teammate-${selected.teamNumber}-${selected.slotNumber}`);
    try {
      const result = await addTeammateMutation.mutateAsync({
        id: tournamentId,
        teamNumber: selected.teamNumber,
        slotNumber: selected.slotNumber,
        data: {
          gameName: teammateName.trim(),
          gameUid: teammateUid.trim(),
        },
      });
      setCaptainAddOpen(false);
      setSelected(null);
      setTeammateName('');
      setTeammateUid('');
      setMessage(
        result.entryCoinsPaid > 0
          ? `${teammateName.trim()} was added. ${result.entryCoinsPaid} coins were deducted from your wallet.`
          : `${teammateName.trim()} was added. No coins were deducted.`,
      );
      await Promise.all([slotsQuery.refetch(), onJoined()]);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Could not add this teammate. Refresh and try again.');
      void slotsQuery.refetch();
    } finally {
      setBusyKey('');
    }
  };

  const closeCaptainAdd = () => {
    if (busyKey) return;
    setCaptainAddOpen(false);
    setSelected(null);
    setTeammateName('');
    setTeammateUid('');
    setError('');
  };

  const remove = async () => {
    if (!pendingRemoval || busyKey) return;
    const target = pendingRemoval;
    setError('');
    setMessage('');
    setBusyKey(`remove-${target.teamNumber}-${target.slotNumber}`);
    try {
      const result = await removeMutation.mutateAsync({
        id: tournamentId,
        teamNumber: target.teamNumber,
        slotNumber: target.slotNumber,
      });
      setPendingRemoval(null);
      setMessage(result.message);
      await Promise.all([slotsQuery.refetch(), onJoined()]);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Could not remove this player.');
    } finally {
      setBusyKey('');
    }
  };

  if (slotsQuery.isLoading && !slots) {
    return <Card><ActivityIndicator color={C.neon} /><Text style={s.participantsHint}>Loading Squad slots…</Text></Card>;
  }
  if (slotsQuery.isError || !slots) {
    return (
      <Card>
        <Text style={s.participantsHint}>Squad slots couldn’t be loaded. Try again before joining.</Text>
        <Btn title="RETRY SQUAD SLOTS" kind="ghost" onPress={() => { void slotsQuery.refetch(); }}
          loading={slotsQuery.isFetching} style={{ marginTop: 10 }} testID="squad-slots-retry" />
      </Card>
    );
  }

  const selectedTeam = selected
    ? slots.teams.find((team) => team.teamNumber === selected.teamNumber)
    : undefined;
  const selectedSlot = selectedTeam?.slots.find((slot) => slot.slotNumber === selected?.slotNumber);
  const canAfford = walletCoins >= entryCoins;
  return (
    <View>
      <Card style={{ marginBottom: 10 }}>
        <Text style={s.squadCapacity} testID="squad-capacity-summary">
          {translateExactText(
            `${slots.filledPlayers}/${slots.capacity * slots.teamSize} PLAYERS · ${slots.filledTeams}/${slots.capacity} TEAMS`,
          )}
        </Text>
        {slots.alreadyRegistered ? (
          <Text
            accessibilityRole="text"
            testID="squad-registration-status"
            style={s.squadRegistrationStatus}
          >
            {translateExactText(
              slots.myTeamNumber && slots.mySlotNumber
                ? `Your registration: Team ${String(slots.myTeamNumber).padStart(2, '0')}, slot ${slots.mySlotNumber}.`
                : 'Your registration is confirmed.',
            )}
          </Text>
        ) : null}
        <Text style={s.squadNotice}>
          Players can join open slots and pay individually. Captains can pay for teammates from their wallet. Removing a player does not refund the entry fee.
        </Text>
      </Card>
      {!!error && <Msg kind="err" text={error} accessibilityLiveRegion="assertive" />}
      {!!message && <Msg kind="ok" text={message} accessibilityLiveRegion="polite" />}
      {slots.teams.map((team) => {
        const teamNumber = String(team.teamNumber).padStart(2, '0');
        const joinedCount = team.slots.filter((slot) => slot.occupied).length;
        const selectedForTeam = selected?.teamNumber === team.teamNumber;
        const selectedRemoval = pendingRemoval?.teamNumber === team.teamNumber
          ? team.slots.find((slot) => slot.slotNumber === pendingRemoval.slotNumber)
          : undefined;

        return (
          <Card key={team.teamNumber} style={s.squadTeamCard}>
            <View style={s.squadTeamHeader}>
              <View style={s.squadTeamTitleRow}>
                <Text style={s.squadTeamHeading}>TEAM</Text>
                <Text style={s.squadTeamNumber}>{teamNumber}</Text>
                {team.legacy ? (
                  <Text style={s.squadLegacyBadge}>EXISTING TEAM</Text>
                ) : null}
              </View>
              <View
                style={s.squadJoinedBadge}
                accessibilityLabel={translateExactText(
                  `${joinedCount} of ${slots.teamSize} players joined`,
                )}
              >
                <Text style={s.squadJoinedText} testID={`squad-team-${teamNumber}-joined-count`}>
                  {translateExactText(`${joinedCount}/${slots.teamSize} JOINED`)}
                </Text>
              </View>
            </View>

            <View style={[s.squadSlotsRow, compactLargeText && s.squadSlotsRowCompact]} testID="squad-slots-row">
              {team.slots.map((slot) => {
                const slotIsOccupied = Boolean(slot.occupied);
                const canSelectSlot = !slotIsOccupied && (slot.canJoin || slot.canAddTeammate);
                const isSelected = selected?.teamNumber === team.teamNumber &&
                  selected.slotNumber === slot.slotNumber;
                const slotKey = `${team.teamNumber}-${slot.slotNumber}`;
                const isHovered = hoveredSlotKey === slotKey && canSelectSlot;
                const isCaptainSlot = slot.slotNumber === 1;
                const slotTitle = isCaptainSlot ? 'Captain' : String(slot.slotNumber);
                const slotStatus = slotIsOccupied
                  ? slot.gameName || 'Registered player'
                  : 'OPEN • SELECT';
                return (
                  <View
                    key={slot.slotNumber}
                    style={[s.squadSlotColumn, compactLargeText && s.squadSlotColumnCompact]}
                  >
                    <Pressable
                      onHoverIn={() => {
                        if (canSelectSlot) setHoveredSlotKey(slotKey);
                      }}
                      onHoverOut={() => {
                        setHoveredSlotKey((current) => current === slotKey ? null : current);
                      }}
                      onPress={() => {
                        if (canSelectSlot) {
                          setSelected({ teamNumber: team.teamNumber, slotNumber: slot.slotNumber });
                          setJoinDetailsOpen(false);
                          setGameName('');
                          setGameUid('');
                          setCaptainAddOpen(Boolean(slot.canAddTeammate));
                          setTeammateName('');
                          setTeammateUid('');
                          setError('');
                          setMessage('');
                        }
                      }}
                      disabled={!canSelectSlot || Boolean(busyKey)}
                      accessibilityRole="button"
                      accessibilityLabel={`Team ${team.teamNumber}, ${slotTitle}, ${slotIsOccupied ? slot.gameName || 'occupied' : 'open'}${slot.canAddTeammate ? ', add teammate using captain wallet' : slot.canJoin ? ', available to join' : ''}`}
                      accessibilityState={{ disabled: !canSelectSlot || Boolean(busyKey), selected: isSelected && canSelectSlot }}
                      testID={`squad-slot-${team.teamNumber}-${slot.slotNumber}`}
                      style={[
                        s.squadSlot,
                        slotIsOccupied ? s.squadSlotOccupied : s.squadSlotAvailable,
                        compactLargeText && s.squadSlotCompact,
                        isSelected && canSelectSlot && s.squadSlotSelected,
                        isHovered && s.squadSlotHovered,
                        !canSelectSlot && !slotIsOccupied && s.squadSlotUnavailable,
                        Platform.OS === 'web'
                          ? { cursor: canSelectSlot && !busyKey ? 'pointer' : 'not-allowed' } as any
                          : undefined,
                      ]}
                    >
                      <View style={[s.squadSlotTitleRow, compactLargeText && s.squadSlotTitleRowCompact]}>
                        {isCaptainSlot && !compactLargeText ? (
                          <Text
                            style={[
                              s.squadSlotCrown,
                              slotIsOccupied ? s.squadSlotCrownOccupied : s.squadSlotCrownOpen,
                            ]}
                          >
                            ♛
                          </Text>
                        ) : null}
                        <Text
                          style={[
                            s.squadSlotLabel,
                            slotIsOccupied ? s.squadSlotLabelOccupied : s.squadSlotLabelOpen,
                          ]}
                          maxFontSizeMultiplier={compactLargeText ? 1.5 : undefined}
                        >
                          {slotTitle}
                        </Text>
                      </View>
                      <Text
                        style={slotIsOccupied ? s.squadSlotName : s.squadSlotOpen}
                        maxFontSizeMultiplier={
                          !slotIsOccupied && compactLargeText ? 1.5 : undefined
                        }
                      >
                        {slotStatus}
                      </Text>
                    </Pressable>

                    <View style={[
                      s.squadSlotActionArea,
                      compactLargeText && s.squadSlotActionAreaCompact,
                    ]}>
                      {slot.canRemove ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove player from Team ${teamNumber}, slot ${slot.slotNumber}`}
                          accessibilityHint="The removed player's entry fee will not be refunded."
                          disabled={Boolean(busyKey) || slots.registrationClosed}
                          onPress={() => setPendingRemoval({
                            teamNumber: team.teamNumber,
                            slotNumber: slot.slotNumber,
                          })}
                          testID={`squad-remove-${team.teamNumber}-${slot.slotNumber}`}
                          style={[
                            s.squadRemoveButton,
                            compactLargeText && s.squadRemoveButtonCompact,
                          ]}
                        >
                          <Text
                            style={s.squadRemoveButtonText}
                            maxFontSizeMultiplier={compactLargeText ? 1.5 : undefined}
                          >
                            REMOVE
                          </Text>
                        </Pressable>
                      ) : isSelected && slot.canJoin ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Join Team ${teamNumber}`}
                          accessibilityHint="Opens the player details and payment form for this team slot."
                          onPress={() => setJoinDetailsOpen(true)}
                          testID={`squad-join-select-${team.teamNumber}-${slot.slotNumber}`}
                          style={[
                            s.squadSlotJoinButton,
                            compactLargeText && s.squadSlotJoinButtonCompact,
                          ]}
                        >
                          <Text
                            style={s.squadSlotJoinButtonText}
                            maxFontSizeMultiplier={compactLargeText ? 1.5 : undefined}
                          >
                            {compactLargeText
                              ? <>JOIN{"\n"}TEAM{"\n"}{teamNumber}</>
                              : <>JOIN{"\n"}TEAM {teamNumber}</>}
                          </Text>
                        </Pressable>
                      ) : (
                        <View style={s.squadSlotActionSpacer} />
                      )}
                    </View>
                  </View>
                );
              })}
            </View>

            {selectedRemoval && pendingRemoval ? (
              <View style={s.squadConfirmPanel}>
                <Text style={s.squadConfirmText}>
                  Remove this player? Their entry fee will not be refunded.
                </Text>
                <View style={s.squadConfirmRow}>
                  <Btn
                    title="CANCEL"
                    kind="ghost"
                    small
                    onPress={() => setPendingRemoval(null)}
                    testID={`squad-remove-cancel-${team.teamNumber}-${pendingRemoval.slotNumber}`}
                  />
                  <Btn
                    title="REMOVE PLAYER"
                    kind="danger"
                    small
                    loading={busyKey === `remove-${team.teamNumber}-${pendingRemoval.slotNumber}`}
                    onPress={() => { void remove(); }}
                    testID={`squad-remove-confirm-${team.teamNumber}-${pendingRemoval.slotNumber}`}
                  />
                </View>
              </View>
            ) : null}

            {selectedForTeam && selectedSlot?.canJoin && joinDetailsOpen ? (
              <View style={s.squadJoinForm}>
                <Text style={s.squadJoinHeading}>JOIN TEAM {teamNumber}</Text>
                <Text style={s.squadNotice}>
                  Slot: {selectedSlot.slotNumber === 1 ? 'Captain' : selectedSlot.slotNumber} · Entry fee: {entryCoins} coins · Your wallet: {walletCoins} coins
                </Text>
                <Input
                  value={gameName}
                  onChangeText={setGameName}
                  placeholder="Your Free Fire name"
                  accessibilityLabel="Your Free Fire name"
                  autoCapitalize="none"
                  maxLength={100}
                  testID="squad-game-name"
                />
                <Input
                  value={gameUid}
                  onChangeText={setGameUid}
                  placeholder="Your Free Fire UID"
                  accessibilityLabel="Your Free Fire UID"
                  keyboardType="number-pad"
                  maxLength={128}
                  style={{ marginTop: 8 }}
                  testID="squad-game-uid"
                />
                {!canAfford ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={s.squadInsufficient}>Not enough coins for this player’s entry fee.</Text>
                    <Btn title="GO TO WALLET" kind="gold" onPress={onGoWallet} style={{ marginTop: 8 }} />
                  </View>
                ) : (
                  <View style={s.squadJoinActions}>
                    <Btn
                      title="CANCEL"
                      kind="ghost"
                      small
                      onPress={() => {
                        setJoinDetailsOpen(false);
                        setSelected(null);
                      }}
                      testID="squad-join-cancel"
                    />
                    <Btn
                      title={`CONFIRM & PAY ${entryCoins} COINS`}
                      onPress={() => { void join(); }}
                      loading={busyKey.startsWith('join-')}
                      disabled={!gameName.trim() || !gameUid.trim() || Boolean(busyKey) || slots.registrationClosed}
                      accessibilityHint="Pays the entry fee from your wallet and confirms your player slot."
                      style={s.squadJoinConfirm}
                      testID="squad-join-confirm"
                    />
                  </View>
                )}
              </View>
            ) : null}
          </Card>
        );
      })}
      {slots.registrationClosed ? (
        <Text style={s.squadClosed}>Registration is closed. Open slots can no longer be joined.</Text>
      ) : null}
      <Modal
        visible={captainAddOpen && Boolean(selectedSlot?.canAddTeammate)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeCaptainAdd}
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            backgroundColor: 'rgba(3, 7, 20, 0.88)',
            padding: 16,
          }}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: 8 }}
            >
              <Card style={[
                { borderColor: C.squadAccent, borderWidth: 1, padding: 18 },
                compactLargeText && s.captainAddCardCompact,
              ]}>
                <Text style={[s.squadJoinHeading, { marginBottom: 12 }]}>
                  Add Teammate (Slot {selected?.slotNumber ?? ''})
                </Text>
                <Text style={[s.squadNotice, { marginBottom: 12 }]}>
                  Entry fee: {entryCoins} coins. This amount will be deducted from your wallet ({walletCoins} coins available).
                </Text>
                <Input
                  value={teammateName}
                  onChangeText={setTeammateName}
                  placeholder="Player In-Game Name (IGN)"
                  accessibilityLabel="Player In-Game Name (IGN)"
                  autoCapitalize="none"
                  maxLength={100}
                  testID="squad-teammate-name"
                />
                <Input
                  value={teammateUid}
                  onChangeText={setTeammateUid}
                  placeholder="Player Game UID"
                  accessibilityLabel="Player Game UID"
                  keyboardType="number-pad"
                  maxLength={128}
                  style={{ marginTop: 8 }}
                  testID="squad-teammate-uid"
                />
                {!canAfford ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={s.squadInsufficient}>Not enough coins to pay for this teammate’s slot.</Text>
                    <Btn title="GO TO WALLET" kind="gold" onPress={onGoWallet} style={{ marginTop: 8 }} />
                  </View>
                ) : null}
                {!!error && <Msg kind="err" text={error} accessibilityLiveRegion="assertive" />}
                <View style={[
                  s.squadJoinActions,
                  { marginTop: 14 },
                  compactLargeText && s.squadJoinActionsStacked,
                ]}>
                  <Btn
                    title="CANCEL"
                    kind="ghost"
                    small={!compactLargeText}
                    disabled={Boolean(busyKey)}
                    onPress={closeCaptainAdd}
                    testID="squad-teammate-cancel"
                  />
                  <Btn
                    title="PAY & ADD PLAYER"
                    onPress={() => { void addTeammate(); }}
                    loading={busyKey.startsWith('add-teammate-')}
                    disabled={!teammateName.trim() || !teammateUid.trim() || !canAfford || Boolean(busyKey) || slots.registrationClosed}
                    accessibilityHint="Deducts this entry fee from the captain's wallet and books the selected teammate slot."
                    style={[s.squadJoinConfirm, compactLargeText && s.squadJoinConfirmStacked]}
                    testID="squad-teammate-confirm"
                  />
                </View>
              </Card>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

export default function TDetail() {
  const nav: any = useNavigation();
  const route: any = useRoute();
  const isFocused = useIsFocused();
  const { width: detailWidth, fontScale: detailFontScale } = useWindowDimensions();
  const detailLargeText = detailFontScale >= 1.5;
  const stackedDetailHeader = detailLargeText && detailWidth <= 440;
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  const id = route?.params?.id;
  const { user } = useApp();
  const tournamentId = String(id ?? '');
  const [t, setT] = useState<any>(null);
  const latestDetail = useRef<{ tournamentId: string; detail: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [retryingRegistrationStatus, setRetryingRegistrationStatus] = useState(false);
  const [retryingParticipants, setRetryingParticipants] = useState(false);
  const [participantsRetryAnnouncement, setParticipantsRetryAnnouncement] = useState('');
  const [roomDetailsAnnouncement, setRoomDetailsAnnouncement] = useState('');
  const [roomDetailsAnnouncementVersion, setRoomDetailsAnnouncementVersion] = useState<number>(0);
  const retryParticipantsInFlight = useRef(false);
  const participantsScreenFocusedRef = useRef(false);
  const participantsScreenHasBlurredRef = useRef(false);
  const participantsRetryFocusVersion = useRef(0);
  const detailLoadInFlight = useRef(false);
  const squadSlotsRefetchRef = useRef<(() => Promise<unknown>) | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const seatRefreshStatus = t ? getTournamentLifecycleState(t, clockNow) : t?.status;
  const seatRefreshInterval = getTournamentSeatRefreshInterval(
    isFocused,
    isAppActive,
    seatRefreshStatus ?? t?.status,
  );
  const participantsQuery = useGetTournamentParticipants(tournamentId, {
    query: {
      queryKey: getGetTournamentParticipantsQueryKey(tournamentId),
      enabled: Boolean(id),
      refetchOnMount: 'always',
      refetchInterval: seatRefreshInterval,
      retry: 1,
    },
  });
  const resultsQuery = useGetTournamentResults(tournamentId, {
    query: {
      queryKey: getGetTournamentResultsQueryKey(tournamentId),
      enabled: Boolean(id) && isFocused,
      refetchOnMount: 'always',
      refetchInterval: getTournamentResultsRefreshInterval(isFocused && isAppActive),
      retry: 1,
    },
  });
  const isCompleted =
    String(t?.status ?? '').toLowerCase() === 'completed' ||
    String(resultsQuery.data?.status ?? '').toLowerCase() === 'finalized';
  const roomCredentialsAvailable =
    String(t?.myRegistration?.status ?? '').toLowerCase() === 'approved' &&
    String(t?.status ?? '').toLowerCase() !== 'cancelled' &&
    hasServerAuthorizedRoomCredentials(
      t?.myRegistration?.roomId,
      t?.myRegistration?.roomPassword,
    );
  const roomId = t?.myRegistration?.roomId;
  const roomPassword = t?.myRegistration?.roomPassword;

  useFocusEffect(
    useCallback(() => {
      const shouldRefreshParticipants = participantsScreenHasBlurredRef.current;
      participantsScreenHasBlurredRef.current = false;
      participantsScreenFocusedRef.current = true;
      participantsRetryFocusVersion.current += 1;
      setParticipantsRetryAnnouncement('');
      if (shouldRefreshParticipants) void participantsQuery.refetch();
      return () => {
        participantsScreenHasBlurredRef.current = true;
        participantsScreenFocusedRef.current = false;
        participantsRetryFocusVersion.current += 1;
        setParticipantsRetryAnnouncement('');
      };
    }, [participantsQuery.refetch, tournamentId]),
  );

  useEffect(() => {
    if (!isFocused) return;
    const announcementKind = claimRoomDetailsAvailabilityAnnouncement(
      tournamentId,
      roomCredentialsAvailable,
      roomId,
      roomPassword,
    );
    if (!announcementKind) return;
    const announcement = announcementKind === 'available'
      ? 'Room details are now available.'
      : 'Room details have been updated.';
    const localizedAnnouncement = translateExactText(announcement);
    setRoomDetailsAnnouncement(localizedAnnouncement);
    setRoomDetailsAnnouncementVersion((version) => version + 1);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(localizedAnnouncement);
  }, [isFocused, tournamentId, roomCredentialsAvailable, roomId, roomPassword]);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    if (detailLoadInFlight.current) return;
    detailLoadInFlight.current = true;
    try {
      setErr('');
      const currentId = String(id);
      const previousDetail = latestDetail.current?.tournamentId === currentId
        ? latestDetail.current.detail
        : null;
      const tournamentDetails = await fetchTournamentDetailSnapshot(currentId, api, previousDetail);
      latestDetail.current = { tournamentId: currentId, detail: tournamentDetails };
      setT(tournamentDetails);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load');
    } finally {
      detailLoadInFlight.current = false;
      setLoading(false);
    }
  }, [id]);
  const refreshNonSquadData = useCallback(async () => {
    await Promise.all([
      load(),
      participantsQuery.refetch(),
      resultsQuery.refetch(),
    ]);
  }, [load, participantsQuery.refetch, resultsQuery.refetch]);
  const refreshAll = useCallback(async () => {
    const refreshes: Promise<unknown>[] = [
      load(),
      participantsQuery.refetch(),
      resultsQuery.refetch(),
    ];
    const refreshSquadSlots = squadSlotsRefetchRef.current?.();
    if (refreshSquadSlots) refreshes.push(refreshSquadSlots);
    await Promise.all(refreshes);
  }, [load, participantsQuery.refetch, resultsQuery.refetch]);
  const registerSquadSlotsRefetch = useCallback((refetch: (() => Promise<unknown>) | null) => {
    squadSlotsRefetchRef.current = refetch;
  }, []);
  const retryRegistrationStatus = async () => {
    setRetryingRegistrationStatus(true);
    try {
      await load();
    } finally {
      setRetryingRegistrationStatus(false);
    }
  };
  const retryParticipants = async () => {
    if (retryParticipantsInFlight.current || participantsQuery.isFetching) return;
    retryParticipantsInFlight.current = true;
    const focusVersion = participantsRetryFocusVersion.current;
    setRetryingParticipants(true);
    announceParticipantsRetry('Retrying participant list.', focusVersion);
    try {
      const result = await participantsQuery.refetch();
      announceParticipantsRetry(
        result.isSuccess
          ? `Participant list updated. Joined ${teamTournament ? 'teams' : 'players'}: ${result.data.participants.length}.`
          : 'Retry failed. The participant list is still unavailable. You can retry again.',
        focusVersion,
      );
    } catch {
      announceParticipantsRetry(
        'Retry failed. The participant list is still unavailable. You can retry again.',
        focusVersion,
      );
    } finally {
      retryParticipantsInFlight.current = false;
      setRetryingParticipants(false);
    }
  };
  const announceParticipantsRetry = (message: string, focusVersion: number) => {
    if (
      !participantsScreenFocusedRef.current ||
      participantsRetryFocusVersion.current !== focusVersion
    ) return;
    const localizedMessage = translateExactText(message);
    setParticipantsRetryAnnouncement(localizedMessage);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(localizedMessage);
  };
  const refreshAllRef = useRef(refreshAll);
  const detailRefreshController = useRef<ReturnType<typeof createTournamentDetailRefreshController> | null>(null);
  if (!detailRefreshController.current) {
    detailRefreshController.current = createTournamentDetailRefreshController();
  }
  useEffect(() => {
    refreshAllRef.current = refreshAll;
  }, [refreshAll]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setIsAppActive(nextState === 'active');
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    detailRefreshController.current?.update(isFocused, isAppActive, () => {
      setClockNow(Date.now());
      void refreshAllRef.current();
    });
  }, [isFocused, isAppActive]);
  useEffect(
    () => () => detailRefreshController.current?.stop(),
    [],
  );

  useEffect(() => {
    if (!isFocused || !isAppActive) return undefined;
    const schedule = getRoomCredentialSchedule(t?.startsAt);
    if (!schedule) return undefined;
    const nextTransition = [schedule.releaseAtMs, schedule.startsAtMs]
      .filter((time) => time > clockNow)
      .sort((a, b) => a - b)[0];
    if (nextTransition === undefined) return undefined;
    const timer = setTimeout(() => {
      setClockNow(Date.now());
      void load();
    }, Math.min(MAX_TIMEOUT_MS, nextTransition - clockNow));
    return () => clearTimeout(timer);
  }, [t?.startsAt, clockNow, isFocused, isAppActive, load]);

  if (loading) return <View style={s.root} />;
  if (!t) return <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}><Text style={{ color: C.sub }}>Tournament not found.</Text></View>;

  const lifecycle = isCompleted ? 'completed' : getTournamentLifecycleState(t, clockNow);
  const statusTournament = lifecycle === 'ongoing'
    ? { ...t, status: 'ongoing' }
    : isCompleted
      ? { ...t, status: 'completed' }
      : t;
  const st = statusOf(statusTournament);
  const registrationStatusKnown = t.registrationStatusKnown === true;
  const joined = registrationStatusKnown && Boolean(t.joined);
  const teamType = String(t.teamType || '').toLowerCase();
  const mode = String(t.mode || '').toLowerCase();
  const seatLayout = getTournamentSeatLayout(t);
  const individualSquad = seatLayout?.individualSquad ??
    (teamType === 'squad' && (mode.includes('battle royale') || mode === 'battle_royale'));
  const teamSlotBooking = individualSquad || Boolean(seatLayout && seatLayout.slotsPerGroup > 1);
  const individualPlayerSlots = seatLayout?.groupKind === 'player';
  const teamTournament = Number(t.teamSize ?? 1) > 1;
  const participants = participantsQuery.data?.participants ?? [];
  const participantListUnavailable = participantsQuery.isError || (retryingParticipants && participantsQuery.isFetching);
  const participantCountLabel = participantListUnavailable ? 'COUNT UNAVAILABLE' : participants.length;
  const participantCountAccessibilityLabel = participantListUnavailable
    ? `Joined ${teamTournament ? 'teams' : 'players'}. Count unavailable.`
    : `Joined ${teamTournament ? 'teams' : 'players'}: ${participants.length}.`;
  const totalSlots = Number(seatLayout?.groupCount ?? t.totalSlots ?? (mode.includes('clash') ? 2 : teamType === 'squad' ? 12 : 48));
  const filledSlots = Number(t.filledSlots ?? t.filled ?? 0);
  const teamSlotSummary = getTournamentTeamSlotSummary(t);
  const filledPlayers = getTournamentFilledPlayerCount({
    filledSlots,
    teamSize: Number(t.teamSize ?? 1),
    filledPlayerSlots: t.filledPlayerSlots,
    individualPlayerSlots,
  });
  const totalPlayers = Number(seatLayout
    ? seatLayout.groupCount * seatLayout.slotsPerGroup
    : t.totalPlayerSlots ?? totalSlots * Number(t.teamSize ?? 1));
  const tournamentStatus = isCompleted ? 'completed' : String(t.status || '').toLowerCase();
  const winnerState = resolveTournamentWinnerState(
    resultsQuery.isLoading ||
      (isCompleted && resultsQuery.isFetching && resultsQuery.data?.status !== 'finalized'),
    resultsQuery.isError,
    resultsQuery.data?.entries,
  );
  const winner = winnerState.kind === 'winner' ? winnerState.entry : undefined;
  const winnerGameName = winner?.gameName?.trim() ?? '';
  const winnerTeamName = winner?.teamName?.trim() ?? '';
  const winnerName = winnerTeamName || winnerGameName || 'Winner';
  const full = isTournamentCapacityFull({
    filledPlayers,
    totalPlayers,
    filledSlots,
    totalSlots,
    status: tournamentStatus,
  });
  const schedule = getRoomCredentialSchedule(t.startsAt);
  const registrationStatus = String(t.myRegistration?.status ?? '').toLowerCase();
  const canViewRoomDetails = registrationStatus === 'approved' && tournamentStatus !== 'cancelled';
  const roomAccessStatus = tournamentStatus === 'cancelled'
    ? 'cancelled'
    : registrationStatus === 'approved'
      ? 'approved'
      : registrationStatus === 'pending'
        ? 'pending'
        : registrationStatus === 'rejected'
          ? 'rejected'
          : registrationStatusKnown
            ? 'unregistered'
            : 'unknown';
  const scheduledStart = schedule
    ? `${schedule.date} · ${fmtTime12(schedule.startTime24)} IST`
    : `${fmtDate(t.date)} · ${fmtTime12(t.time)} IST`;
  const coins = user?.coins ?? 0;
  const short = coins < (t.entryCoins ?? 0);

  const join = async () => {
    nav.navigate('JoinForm', { id: t.id });
  };

  return (
    <ScrollView
      testID="tournament-detail-scroll"
      style={s.root}
      contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl
        refreshing={loading || participantsQuery.isFetching || (isCompleted && resultsQuery.isFetching)}
        onRefresh={refreshAll}
        tintColor={C.neon}
      />}>
      {/* HERO */}
      <GCard
        glowColor={st.key === 'ongoing' ? C.neon : C.orange}
        style={{ marginBottom: 14 }}
        testID="tournament-detail-hero"
      >
        <View style={[s.heroRow, stackedDetailHeader && s.heroRowStacked]}>
          <View style={[s.heroDetails, stackedDetailHeader && s.heroDetailsStacked]}>
            <Text style={s.mode}>{(t.mode || 'BATTLE ROYALE').toUpperCase()}</Text>
            <Text style={s.name}>{t.name || t.title}</Text>
            <Text style={s.meta}>SCHEDULED START: {scheduledStart}</Text>
          </View>
          <View style={[s.heroBadge, stackedDetailHeader && s.heroBadgeStacked]}>
            <Badge text={st.label} color={st.color} />
          </View>
        </View>
      </GCard>

      {/* STATS */}
      <View style={[s.statRow, detailLargeText && s.statRowLarge]} testID="tournament-detail-stats">
        <View style={[s.stat, detailLargeText && s.statLarge]}>
          <Text style={s.statK}>ENTRY</Text>
          <Text style={[s.statV, { color: C.gold }]}>🪙 {t.entryCoins}</Text>
          <Text style={s.statSub}>{inr(t.entryCoins)}</Text>
        </View>
        <View style={[
          s.stat,
          detailLargeText ? s.statLarge : s.statDivider,
        ]}>
          <Text style={s.statK}>PRIZE POOL</Text>
          <Text style={[s.statV, { color: C.green }]}>🪙 {t.prizePool}</Text>
          <Text style={s.statSub}>{inr(t.prizePool)}</Text>
        </View>
        <View style={[s.stat, detailLargeText && s.statLarge]}>
           <Text style={s.statK}>{individualSquad || individualPlayerSlots ? 'PLAYER SLOTS' : 'TEAM SLOTS'}</Text>
           <Text style={[s.statV, { color: C.blue }]}>{individualSquad ? `${filledPlayers}/${totalPlayers}` : `${filledSlots}/${totalSlots}`}</Text>
           <Text
             testID={individualSquad ? 'tournament-team-slot-count' : undefined}
             style={s.statSub}
           >
             {individualSquad
               ? teamSlotSummary.label
               : t.slotUnit === 'player'
              ? `${filledSlots}/${totalSlots} players`
               : `${filledPlayers}/${totalPlayers} players`}
          </Text>
        </View>
      </View>

      <SectionTitle accent={C.orange}>MATCH INFO</SectionTitle>
      <Card testID="tournament-match-info">
        <KV k="Mode" v={t.mode || '—'} />
        <KV k="Format" v={t.teamType || '—'} />
        <KV k="Map" v={t.map || '—'} />
        <KV k="Per Team" v={t.teamSize ? `${t.teamSize} players` : t.perTeam ? `${t.perTeam} players` : '—'} />
        <KV k="Capacity" v={t.capacityLabel || `${t.totalSlots} slots`} />
        <KV k="Version" v={t.version || '—'} />
        {!!t.rules && <Text style={s.rules}>{t.rules}</Text>}
      </Card>

      {roomDetailsAnnouncement ? (
        <Text
          key={roomDetailsAnnouncementVersion}
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          testID="room-details-announcement"
          style={s.participantsRetryStatus}
        >
          {roomDetailsAnnouncement}
        </Text>
      ) : null}
      <RoomCredentialsPanel
        startsAt={t.startsAt}
        now={clockNow}
        configured={canViewRoomDetails && t.myRegistration?.roomPublished === true}
        roomId={canViewRoomDetails ? t.myRegistration?.roomId : undefined}
        roomPassword={canViewRoomDetails ? t.myRegistration?.roomPassword : undefined}
        accessStatus={roomAccessStatus}
      />

      {teamSlotBooking ? (
        <>
          <SectionTitle accent={C.orange}>{individualSquad ? 'SQUAD TEAM SLOTS' : 'TEAM PLAYER SLOTS'}</SectionTitle>
          <SquadSlotsPanel
            tournamentId={tournamentId}
            entryCoins={Number(t.entryCoins ?? 0)}
            walletCoins={Number(user?.coins ?? 0)}
            onGoWallet={() => nav.navigate('Wallet')}
            onJoined={refreshNonSquadData}
            onRefetchAvailable={registerSquadSlotsRefetch}
            refreshInterval={seatRefreshInterval}
          />
        </>
      ) : null}

      {seatLayout && !teamSlotBooking ? (
        <>
          <SectionTitle accent={C.orange}>TOURNAMENT SLOTS</SectionTitle>
          <ModeSeatSlotsPanel
            key={tournamentId}
            tournamentId={tournamentId}
            layout={seatLayout}
            participants={participants}
            loading={participantsQuery.isFetching || retryingParticipants}
            unavailable={participantsQuery.isError && !participantsQuery.data}
            canSelect={
              registrationStatusKnown &&
              !joined &&
              !full &&
              st.key !== 'ongoing' &&
              !isCompleted &&
              !['closed', 'cancelled'].includes(tournamentStatus)
            }
            onRetry={() => { void retryParticipants(); }}
            onJoinSlot={(seatGroupNumber, seatSlotNumber) =>
              nav.navigate('JoinForm', { id: t.id, seatGroupNumber, seatSlotNumber })}
          />
        </>
      ) : null}

      <SectionTitle
        accent={C.orange}
        icon={teamTournament ? 'users' : 'user'}
        accessibilityLabel={participantCountAccessibilityLabel}
        testID="participant-count-heading"
      >
        {teamTournament ? `JOINED TEAMS · ${participantCountLabel}` : `JOINED PLAYERS · ${participantCountLabel}`}
      </SectionTitle>
      {participantsRetryAnnouncement ? (
        <Text
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          testID="participants-retry-status"
          style={s.participantsRetryStatus}
        >
          {participantsRetryAnnouncement}
        </Text>
      ) : null}
      {participantsQuery.isLoading && !participantsQuery.data && !retryingParticipants ? (
        <Card style={s.participantsLoading}>
          <ActivityIndicator accessible={false} color={C.neon} />
          <Text
            accessible
            accessibilityRole="text"
            accessibilityLabel="Loading participants."
            accessibilityLiveRegion="polite"
            testID="participants-initial-loading-status"
            style={s.participantsHint}
          >
            Loading participants…
          </Text>
        </Card>
      ) : participantListUnavailable ? (
        <Card>
          <Text
            accessible
            accessibilityRole="text"
            accessibilityLabel="Participant list couldn’t be loaded. Try again here or pull down to retry."
            accessibilityLiveRegion="polite"
            testID="participants-error-guidance"
            style={s.participantsHint}
          >
            Participant list couldn’t be loaded. Try again here or pull down to retry.
          </Text>
          <Btn
            title="RETRY PARTICIPANTS"
            kind="ghost"
            onPress={retryParticipants}
            loading={participantsQuery.isFetching}
            preserveAccessibilityFocusWhileLoading
            accessibilityLabel="Retry participant list"
            accessibilityHint="Loads the latest list of joined players and teams."
            accessibilityState={{ busy: participantsQuery.isFetching }}
            style={{ marginTop: 10, alignSelf: 'stretch', minHeight: 48 }}
            testID="participants-retry"
          />
        </Card>
      ) : participants.length === 0 ? (
        <Card>
          <Text style={s.participantsHint}>
            {teamTournament ? 'No teams have joined this match yet.' : 'No players have joined this match yet.'}
          </Text>
        </Card>
      ) : (
        participants.map((participant, index) => {
          const playerNames = participant.players;
          const title = teamTournament
            ? participant.teamName?.trim() || playerNames[0] || `Team ${index + 1}`
            : playerNames[0] || `Player ${index + 1}`;
          return (
            <Card key={`${participant.teamName ?? 'player'}-${index}`} style={s.participantCard}>
              <View style={s.participantHeader}>
                <View style={s.participantNumber}>
                  <Text style={s.participantNumberText}>{String(index + 1).padStart(2, '0')}</Text>
                </View>
                <View style={s.participantTitleWrap}>
                  <Text style={s.participantName}>{title}</Text>
                  {participant.status === 'pending' && (
                    <Text style={s.participantPending}>AWAITING APPROVAL</Text>
                  )}
                </View>
              </View>
              {teamTournament && playerNames.length > 0 && (
                <View style={s.memberList}>
                  {playerNames.map((playerName, playerIndex) => (
                    <View key={`${playerIndex}-${playerName}`} style={s.memberRow}>
                      <View style={s.memberDot} />
                      <Text style={s.memberName}>
                        {playerIndex === 0 ? 'CAPTAIN' : `PLAYER ${playerIndex + 1}`} · {playerName}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>
          );
        })
      )}

      {isCompleted && (
        <>
          <SectionTitle accent={C.gold}>WINNER &amp; PRIZE</SectionTitle>
          {winnerState.kind === 'loading' ? (
            <Card style={s.participantsLoading}>
              <ActivityIndicator color={C.gold} />
              <Text style={s.participantsHint}>Loading winner details…</Text>
            </Card>
          ) : winnerState.kind === 'error' ? (
            <Card>
              <Text style={s.participantsHint}>
                Winner and prize details couldn’t be loaded. Retry here or pull down to try again.
              </Text>
              <Btn
                title="RETRY WINNER DETAILS"
                kind="ghost"
                onPress={() => { void resultsQuery.refetch(); }}
                loading={resultsQuery.isFetching}
                accessibilityState={{ busy: resultsQuery.isFetching }}
                style={{ marginTop: 10 }}
                testID="winner-results-retry"
              />
            </Card>
          ) : winnerState.kind === 'winner' && winner ? (
            <Card style={s.winnerCard}>
              <View style={s.winnerBadge}>
                <Text style={s.winnerBadgeText}>#1</Text>
              </View>
              <View style={s.winnerIdentity}>
                <Text style={s.winnerLabel}>TOURNAMENT WINNER</Text>
                <Text style={s.winnerName} numberOfLines={1}>{winnerName}</Text>
                {!!winnerTeamName && !!winnerGameName && (
                  <Text style={s.winnerSub} numberOfLines={1}>CAPTAIN · {winnerGameName}</Text>
                )}
              </View>
              <View style={s.winnerPrize}>
                <Text style={s.winnerPrizeAmount}>{winner.prizeCoins.toLocaleString()} coins</Text>
                <Text style={s.winnerPrizeLabel}>PRIZE WON</Text>
                <Text style={s.winnerPrizeValue}>{inr(winner.prizeCoins)}</Text>
              </View>
            </Card>
          ) : (
            <Card>
              <Text style={s.participantsHint}>
                No winner was recorded for this completed match.
              </Text>
            </Card>
          )}
        </>
      )}

      <Msg kind="err" text={err} />
      <Msg kind="ok" text={msg} />

      <View style={{ marginTop: 16 }}>
        {teamSlotBooking ? null : !registrationStatusKnown ? (
          <Card testID="tournament-entry-status-unknown">
            <Text
              accessible
              accessibilityRole="text"
              accessibilityLiveRegion="polite"
              style={s.participantsHint}
            >
              We couldn’t confirm whether you’ve joined. Check your entry status again before trying to join.
            </Text>
            <Btn
              title="RETRY ENTRY STATUS"
              kind="ghost"
              onPress={retryRegistrationStatus}
              loading={retryingRegistrationStatus}
              accessibilityLabel="Retry entry status"
              accessibilityHint="Checks whether you have already joined this tournament."
              accessibilityState={{ busy: retryingRegistrationStatus }}
              style={{ marginTop: 10 }}
              testID="tournament-entry-status-retry"
            />
          </Card>
        ) : null}
        {st.key === 'completed' || ['closed', 'cancelled'].includes(tournamentStatus) ? (
          <Btn title="MATCH ENDED" kind="ghost" disabled />
        ) : !registrationStatusKnown ? (
          <Btn title="ENTRY STATUS UNKNOWN" kind="ghost" disabled />
        ) : joined ? (
          <Btn title={full ? 'Joined · Slots Full' : 'Joined'} kind="ghost" disabled />
        ) : st.key === 'ongoing' ? (
          <Btn title="MATCH ONGOING" kind="ghost" disabled />
        ) : full ? (
          <Btn title="Slots Full" kind="ghost" disabled />
        ) : short ? (
          <>
            <Btn title={`INSUFFICIENT COINS — NEED 🪙 ${t.entryCoins}`} kind="danger" disabled />
            <Btn title="GO TO WALLET →" kind="gold" onPress={() => nav.navigate('Wallet')} style={{ marginTop: 10 }} />
          </>
        ) : (
          <Btn
            title={`JOIN NOW — 🪙 ${t.entryCoins} (${inr(t.entryCoins)})`}
            onPress={join}
            loading={busy}
            testID="tournament-detail-join"
          />
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start' },
  heroRowStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  heroDetails: { flex: 1, minWidth: 0, marginRight: 8 },
  heroDetailsStacked: { marginRight: 0, width: '100%' },
  heroBadge: { flexShrink: 0, alignSelf: 'flex-start' },
  heroBadgeStacked: { alignSelf: 'flex-start' },
  mode: { color: C.orange, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  name: { color: C.text, fontSize: 20, fontWeight: '900', marginTop: 2 },
  meta: { color: C.sub, fontSize: 12, marginTop: 6, fontWeight: '600' },
  timeMeta: { color: C.gold, fontSize: 15, fontWeight: '900' },
  statRow: { flexDirection: 'row', borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, marginBottom: 6, overflow: 'hidden' },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statRowLarge: { flexDirection: 'column' },
  statLarge: {
    flex: 0, alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 10,
    borderLeftWidth: 0, borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  statDivider: { borderLeftWidth: 1, borderLeftColor: C.border, borderRightWidth: 1, borderRightColor: C.border },
  statK: { color: C.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  statV: { fontSize: 17, fontWeight: '900', marginTop: 3 },
  statSub: { color: C.dim, fontSize: 9, marginTop: 2 },
  rules: { color: C.sub, fontSize: 12, marginTop: 10, lineHeight: 18 },
  participantsLoading: { alignItems: 'center' },
  participantsHint: { color: C.sub, fontSize: 12, fontWeight: '600', lineHeight: 18 },
  participantsRetryStatus: {
    color: C.sub, fontSize: 12, fontWeight: '600', lineHeight: 18, marginBottom: 8,
  },
  participantCard: { padding: 12, marginBottom: 8 },
  participantHeader: { flexDirection: 'row', alignItems: 'center' },
  participantNumber: {
    width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    marginRight: 10, backgroundColor: C.bg2, borderColor: C.border, borderWidth: 1,
  },
  participantNumberText: { color: C.orange, fontSize: 12, fontWeight: '900' },
  participantTitleWrap: { flex: 1, minWidth: 0 },
  participantName: { color: C.text, fontSize: 14, fontWeight: '900' },
  participantPending: { color: C.gold, fontSize: 9, fontWeight: '900', letterSpacing: 0.5, marginTop: 3 },
  memberList: { borderTopWidth: 1, borderTopColor: C.border, marginTop: 10, paddingTop: 7 },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  memberDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.blue, marginRight: 8 },
  memberName: { color: C.sub, fontSize: 11, fontWeight: '800', flexShrink: 1 },
  winnerCard: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  winnerBadge: {
    width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    marginRight: 10, backgroundColor: C.bg2, borderColor: C.gold, borderWidth: 1,
  },
  winnerBadgeText: { color: C.gold, fontSize: 14, fontWeight: '900' },
  winnerIdentity: { flex: 1, minWidth: 0 },
  winnerLabel: { color: C.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  winnerName: { color: C.text, fontSize: 15, fontWeight: '900', marginTop: 4 },
  winnerSub: { color: C.sub, fontSize: 10, fontWeight: '800', marginTop: 3 },
  winnerPrize: { alignItems: 'flex-end', marginLeft: 8 },
  winnerPrizeAmount: { color: C.green, fontSize: 13, fontWeight: '900' },
  winnerPrizeLabel: { color: C.dim, fontSize: 8, fontWeight: '900', letterSpacing: 0.7, marginTop: 3 },
  winnerPrizeValue: { color: C.text, fontSize: 10, fontWeight: '800', marginTop: 2 },
  squadCapacity: { color: C.squadAccent, fontSize: 12, fontWeight: '900', letterSpacing: 0.7 },
  squadRegistrationStatus: { color: C.green, fontSize: 12, fontWeight: '800', lineHeight: 18, marginTop: 5 },
  squadNotice: { color: C.sub, fontSize: 11, lineHeight: 16, marginTop: 6 },
  squadTeamCard: {
    marginBottom: 10, padding: 12, backgroundColor: C.squadPanel,
    borderColor: C.squadBorder, borderWidth: 1, borderRadius: 16,
  },
  squadTeamHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10, minHeight: 22,
  },
  squadTeamTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, flexShrink: 1 },
  squadTeamHeading: { color: C.sub, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  squadTeamNumber: { color: C.squadAccent, fontSize: 15, fontWeight: '900', letterSpacing: 0.4 },
  squadLegacyBadge: {
    color: C.gold, fontSize: 7, fontWeight: '900', letterSpacing: 0.4, marginLeft: 4,
  },
  squadJoinedBadge: {
    backgroundColor: C.bg2, borderColor: C.squadBorder, borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 6,
  },
  squadJoinedText: { color: C.sub, fontSize: 8, fontWeight: '900', letterSpacing: 0.3 },
  squadSlotsRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  squadSlotColumn: { flex: 1, flexBasis: 0, minWidth: 0 },
  squadSlot: {
    width: '100%', minHeight: 76, borderWidth: 1, borderColor: C.squadBorder, borderRadius: 12,
    backgroundColor: C.squadTile, paddingHorizontal: 3, paddingVertical: 7,
    alignItems: 'center', justifyContent: 'space-between',
  },
  squadSlotAvailable: {
    borderColor: '#2ecc71', backgroundColor: 'rgba(46, 204, 113, 0.12)',
  },
  squadSlotOccupied: {
    borderColor: '#e74c3c', backgroundColor: 'rgba(231, 76, 60, 0.14)',
  },
  squadSlotsRowCompact: { flexWrap: 'wrap', gap: 8 },
  squadSlotColumnCompact: { flexGrow: 0, flexBasis: '47%' },
  squadSlotCompact: { height: 'auto', minHeight: 92 },
  squadSlotSelected: {
    borderColor: '#2ecc71', borderWidth: 2, backgroundColor: 'rgba(46, 204, 113, 0.24)',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0px 0px 12px rgba(46, 204, 113, 0.42)' }
      : {
        shadowColor: '#2ecc71', shadowOpacity: 0.4, shadowRadius: 6,
        shadowOffset: { width: 0, height: 0 }, elevation: 8,
      }),
  },
  squadSlotHovered: {
    borderColor: '#58e68b', backgroundColor: 'rgba(46, 204, 113, 0.24)',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0px 0px 10px rgba(46, 204, 113, 0.32)' }
      : { elevation: 4 }),
  },
  squadSlotUnavailable: { opacity: 0.62 },
  squadSlotTitleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3,
    minHeight: 14, width: '100%',
  },
  squadSlotTitleRowCompact: { minHeight: 22, gap: 0 },
  squadSlotCrown: { fontSize: 10, fontWeight: '900' },
  squadSlotCrownOpen: { color: '#2ecc71' },
  squadSlotCrownOccupied: { color: '#e74c3c' },
  squadSlotLabel: { fontSize: 9, fontWeight: '900', textAlign: 'center' },
  squadSlotLabelOpen: { color: '#2ecc71' },
  squadSlotLabelOccupied: { color: '#e74c3c' },
  squadSlotName: {
    color: '#e74c3c', fontSize: 8, fontWeight: '800', marginTop: 2, textAlign: 'center',
    lineHeight: 10, width: '100%',
  },
  squadSlotOpen: {
    color: '#2ecc71', fontSize: 8, fontWeight: '900', marginTop: 2,
    textAlign: 'center', lineHeight: 9, width: '100%',
  },
  squadSlotActionArea: { height: 38, width: '100%', marginTop: 4 },
  squadSlotActionAreaCompact: { height: 68 },
  squadSlotActionSpacer: { flex: 1 },
  squadSlotJoinButton: {
    minHeight: 34, width: '100%', alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.squadAccent, borderRadius: 8, paddingHorizontal: 1, paddingVertical: 3,
  },
  squadSlotJoinButtonCompact: { minHeight: 62, paddingVertical: 4 },
  squadSlotJoinButtonText: {
    color: C.squadPanel, fontSize: 8, fontWeight: '900', textAlign: 'center', lineHeight: 9,
  },
  squadRemoveButton: {
    minHeight: 34, width: '100%', alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.red + '22', borderColor: C.red + '66', borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 1, paddingVertical: 3,
  },
  squadRemoveButtonCompact: { minHeight: 62, paddingVertical: 4 },
  squadRemoveButtonText: { color: C.red, fontSize: 7, fontWeight: '900', textAlign: 'center' },
  squadConfirmPanel: {
    marginTop: 10, padding: 10, backgroundColor: C.bg, borderColor: C.gold + '66',
    borderWidth: 1, borderRadius: 10,
  },
  squadConfirmRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 8,
  },
  squadConfirmText: { color: C.gold, fontSize: 10, fontWeight: '800', lineHeight: 15 },
  squadJoinForm: {
    marginTop: 10, padding: 12, backgroundColor: C.bg, borderColor: C.squadAccent + '55',
    borderWidth: 1, borderRadius: 12,
  },
  squadJoinHeading: { color: C.squadAccent, fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  squadJoinActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  squadJoinActionsStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 10 },
  squadJoinConfirm: { flex: 1 },
  squadJoinConfirmStacked: { flex: 0, width: '100%' },
  captainAddCardCompact: { padding: 14 },
  squadInsufficient: { color: C.red, fontSize: 12, fontWeight: '800' },
  squadClosed: { color: C.sub, fontSize: 11, lineHeight: 16, marginTop: 6 },
});
