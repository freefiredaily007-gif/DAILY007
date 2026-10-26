import React, { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useDaily007AdminConfirmKnockoutProgression,
  useDaily007AdminGetKnockoutRoundResults,
  useDaily007AdminGetKnockoutPrizeStatus,
  useDaily007AdminApproveKnockoutPrizes,
  useDaily007AdminGetKnockoutAudit,
  useDaily007AdminPublishKnockoutRoundResult,
  useDaily007AdminSaveKnockoutRoundResult,
  type Daily007KnockoutProgressionBody,
  type Daily007KnockoutEvent,
  type Daily007KnockoutRound,
  type Daily007KnockoutPrizePayoutResponse,
  type Daily007KnockoutAuditEntry,
} from "@workspace/api-client-react";
import { ReadableText as Text, ReadableTextInput as TextInput } from "../components/typography";
import { A } from "../components/adminKit";

const ROUNDS: Array<{ value: Daily007KnockoutRound; label: string }> = [
  { value: "round_1", label: "ROUND 1" },
  { value: "round_2", label: "ROUND 2" },
  { value: "final", label: "FINAL" },
];

function requestError(error: unknown): string {
  const value = error as { response?: { data?: { error?: string } }; message?: string };
  return value.response?.data?.error || value.message || "The request failed. Please try again.";
}

function placementPoints(placement: number): number {
  return [12, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0][placement - 1] ?? 0;
}

export default function AdminKnockoutResults({ events }: { events: Daily007KnockoutEvent[] }) {
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [round, setRound] = useState<Daily007KnockoutRound>("round_1");
  const [selectedTeamNumber, setSelectedTeamNumber] = useState<number | null>(null);
  const [editKey, setEditKey] = useState("");
  const [placementInput, setPlacementInput] = useState("");
  const [killsInput, setKillsInput] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [tieOrder, setTieOrder] = useState<number[]>([]);
  const [tieReason, setTieReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const queryClient = useQueryClient();
  const selectedEvent = events.find((event) => event.matchId === selectedMatchId) ?? events[0] ?? null;
  const matchId = selectedEvent?.matchId ?? "";
  const resultsQuery = useDaily007AdminGetKnockoutRoundResults(
    matchId,
    { round },
    { query: {
      queryKey: ["daily007", "knockout", "admin-results", matchId, round],
      enabled: Boolean(matchId),
      staleTime: 0,
      refetchOnMount: "always",
    } },
  );
  const prizesQuery = useDaily007AdminGetKnockoutPrizeStatus(matchId, {
    query: {
      queryKey: ["daily007", "knockout", "admin-prizes", matchId],
      enabled: Boolean(matchId),
      staleTime: 0,
      refetchOnMount: "always",
    },
  });
  const auditQuery = useDaily007AdminGetKnockoutAudit(matchId, {
    query: {
      queryKey: ["daily007", "knockout", "admin-audit", matchId],
      enabled: Boolean(matchId),
      staleTime: 0,
      refetchOnMount: "always",
    },
  });
  const saveMutation = useDaily007AdminSaveKnockoutRoundResult();
  const publishMutation = useDaily007AdminPublishKnockoutRoundResult();
  const progressionMutation = useDaily007AdminConfirmKnockoutProgression();
  const prizesMutation = useDaily007AdminApproveKnockoutPrizes();
  const squads = resultsQuery.data?.squads ?? [];
  const progression = resultsQuery.data?.progression;
  const eligibleSquads = useMemo(() => squads.filter((squad) => squad.eligible), [squads]);
  const selectedSquad =
    eligibleSquads.find((squad) => squad.teamNumber === selectedTeamNumber) ??
    eligibleSquads[0] ??
    null;
  const savedResult = selectedSquad
    ? resultsQuery.data?.results.find((result) => result.teamNumber === selectedSquad.teamNumber)
    : undefined;
  const formKey = `${matchId}:${round}:${selectedSquad?.teamNumber ?? ""}`;
  const isEditing = editKey === formKey;
  const placementText = isEditing ? placementInput : savedResult ? String(savedResult.placement) : "";
  const killsText = isEditing ? killsInput : savedResult ? String(savedResult.squadKills) : "";
  const placement = Number(placementText);
  const squadKills = Number(killsText);
  const validInput =
    Number.isSafeInteger(placement) &&
    placement >= 1 &&
    placement <= eligibleSquads.length &&
    Number.isSafeInteger(squadKills) &&
    squadKills >= 0 &&
    squadKills <= 100_000;
  const previewPoints = validInput
    ? placementPoints(placement) * 1 + squadKills * (resultsQuery.data?.pointsPerKill ?? selectedEvent?.pointsPerKill ?? 1)
    : null;
  const saving = saveMutation.isPending || publishMutation.isPending || progressionMutation.isPending;
  const prizeSaving = prizesMutation.isPending;
  const boundaryTie = progression?.boundaryTieTeamNumbers ?? [];
  const effectiveTieOrder = tieOrder.length === boundaryTie.length &&
    tieOrder.every((teamNumber) => boundaryTie.includes(teamNumber))
    ? tieOrder
    : boundaryTie;
  const tieDecisionReady = boundaryTie.length > 0 &&
    tieReason.trim().length >= 5 &&
    tieReason.trim().length <= 500 &&
    effectiveTieOrder.length === boundaryTie.length;
  const canConfirmProgression = Boolean(
    progression &&
    !progression.transitionConfirmed &&
    progression.priorStageConfirmed &&
    progression.eligibleSquadCount === progression.expectedSquads &&
    progression.publishedResultCount === progression.expectedSquads &&
    (boundaryTie.length ? tieDecisionReady : progression.canConfirm),
  );
  const needsCorrectionReason = Boolean(
    savedResult &&
    (savedResult.status === "published" ||
      (validInput &&
        (savedResult.placement !== placement || savedResult.squadKills !== squadKills))),
  );
  const correctionReasonValid = !needsCorrectionReason ||
    (correctionReason.trim().length >= 5 && correctionReason.trim().length <= 500);

  const selectEvent = (id: string) => {
    setSelectedMatchId(id);
    setSelectedTeamNumber(null);
    setEditKey("");
    setError("");
    setNotice("");
    setTieOrder([]);
    setTieReason("");
    setCorrectionReason("");
  };
  const selectRound = (value: Daily007KnockoutRound) => {
    setRound(value);
    setSelectedTeamNumber(null);
    setEditKey("");
    setError("");
    setNotice("");
    setTieOrder([]);
    setTieReason("");
    setCorrectionReason("");
  };
  const editField = (kind: "placement" | "kills", value: string) => {
    setEditKey(formKey);
    if (kind === "placement") setPlacementInput(value.replace(/\D/g, "").slice(0, 2));
    else setKillsInput(value.replace(/\D/g, "").slice(0, 6));
    setError("");
    setNotice("");
  };
  const saveDraft = async () => {
    if (!selectedEvent || !selectedSquad || !validInput) {
      setError("Choose an eligible squad and enter a valid placement and total squad kills.");
      return;
    }
    setError("");
    setNotice("");
    try {
      await saveMutation.mutateAsync({
        id: selectedEvent.matchId,
        data: {
          round,
          teamNumber: selectedSquad.teamNumber,
          placement,
          squadKills,
          ...(savedResult ? { correctionReason: correctionReason.trim() } : {}),
        },
      });
      setEditKey("");
      setCorrectionReason("");
      setNotice("Draft saved. It will not affect official rankings until published.");
      await Promise.all([
        resultsQuery.refetch(),
        prizesQuery.refetch(),
        auditQuery.refetch(),
      ]);
    } catch (cause) {
      setError(requestError(cause));
    }
  };
  const publish = async () => {
    if (!selectedEvent || !savedResult || savedResult.status !== "draft" || progression?.transitionConfirmed) return;
    setError("");
    setNotice("");
    try {
      const result = await publishMutation.mutateAsync({
        id: selectedEvent.matchId,
        resultId: savedResult.id,
      });
      setNotice(result.alreadyPublished ? "This result is already published." : "Result published to official rankings.");
      await Promise.all([resultsQuery.refetch(), auditQuery.refetch()]);
    } catch (cause) {
      setError(requestError(cause));
    }
  };
  const confirmProgression = async () => {
    if (!selectedEvent || !canConfirmProgression) return;
    const data: Daily007KnockoutProgressionBody = {
      round,
      confirmed: true,
      ...(boundaryTie.length
        ? { tieBreakOrder: effectiveTieOrder, decisionReason: tieReason.trim() }
        : {}),
    };
    setError("");
    setNotice("");
    try {
      const result = await progressionMutation.mutateAsync({ id: selectedEvent.matchId, data });
      const outcome = round === "final"
        ? `Final top three confirmed: ${result.winnerTeamNumbers.map((number) => `Team ${String(number).padStart(2, "0")}`).join(", ")}.`
        : `${result.advancedTeamNumbers.length} squads advanced; ${result.eliminatedTeamNumbers.length} eliminated.`;
      setNotice(result.alreadyConfirmed ? "This stage was already confirmed. No duplicate advancement was applied." : outcome);
      await Promise.all([
        resultsQuery.refetch(),
        prizesQuery.refetch(),
        auditQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["daily007", "knockout", "admin"] }),
      ]);
    } catch (cause) {
      setError(requestError(cause));
    }
  };
  const requestProgressionConfirmation = () => {
    if (!selectedEvent || !canConfirmProgression) return;
    const title = round === "final" ? "Confirm final top three?" : "Confirm eliminations and advance?";
    const detail = round === "final"
      ? "This will publish the official final ranking and mark the tournament completed."
      : `This will lock ${progression?.eliminatedCount} eliminated squads and advance ${progression?.advanceCount} squads.`;
    Alert.alert(title, detail, [
      { text: "Review", style: "cancel" },
      { text: "Confirm", onPress: () => void confirmProgression() },
    ]);
  };
  const approvePrizes = async () => {
    if (!selectedEvent || !prizesQuery.data?.canApprove) return;
    setError("");
    setNotice("");
    try {
      const result = await prizesMutation.mutateAsync({
        id: selectedEvent.matchId,
        data: { confirm: true },
      });
      setNotice(
        result.alreadyCredited
          ? "Knockout prizes were already credited. No duplicate wallet credit was applied."
          : "1,000 wallet coins credited to the top-three rosters. No cash transfer was made.",
      );
      await Promise.all([
        prizesQuery.refetch(),
        auditQuery.refetch(),
        resultsQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["daily007", "knockout", "public"] }),
      ]);
    } catch (cause) {
      setError(requestError(cause));
    }
  };
  const requestPrizeApproval = () => {
    if (!prizesQuery.data?.canApprove) return;
    Alert.alert(
      "Approve Knockout wallet prizes?",
      "This credits exactly 1,000 Daily007 wallet coins (₹500/₹300/₹200 squad awards) to the approved recipients. It does not transfer cash.",
      [
        { text: "Review", style: "cancel" },
        { text: "Approve & Credit", onPress: () => void approvePrizes() },
      ],
    );
  };
  const moveTieTeam = (index: number, direction: -1 | 1) => {
    const next = effectiveTieOrder.slice();
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setTieOrder(next);
  };

  return (
    <View style={styles.panel} testID="admin-knockout-results">
      <Text style={styles.heading}>MANAGE MATCH RESULTS</Text>
      <Text style={styles.hint}>Enter one placement and one squad-wide kill total. Drafts do not appear in official standings.</Text>

      {events.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {events.map((event) => {
            const active = event.matchId === (selectedEvent?.matchId ?? "");
            return (
              <Pressable
                key={event.matchId}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => selectEvent(event.matchId)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                  {event.title}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <Text style={styles.empty}>Create a Knockout tournament before entering results.</Text>
      )}

      {selectedEvent ? (
        <>
          <View style={styles.rounds}>
            {ROUNDS.map((item) => (
              <Pressable
                key={item.value}
                accessibilityRole="button"
                accessibilityState={{ selected: round === item.value }}
                onPress={() => selectRound(item.value)}
                style={[styles.roundChip, round === item.value && styles.roundChipActive]}
              >
                <Text style={[styles.roundText, round === item.value && styles.roundTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          {resultsQuery.isLoading ? <Text style={styles.empty}>Loading squads and saved results…</Text> : null}
          {resultsQuery.isError ? (
            <Text accessibilityRole="alert" style={styles.error}>{requestError(resultsQuery.error)}</Text>
          ) : null}

          {!resultsQuery.isLoading && !resultsQuery.isError ? (
            <>
              <Text style={styles.sectionLabel}>
                {round === "round_1" ? "ROUND 1 ENTRIES" : round === "round_2" ? "ROUND 2 QUALIFIERS" : "FINALISTS"}
                {" · "}{progression?.eligibleSquadCount ?? 0} / {progression?.expectedSquads ?? "—"}
              </Text>
              {progression ? (
                <View style={styles.stageSummary}>
                  <Text style={styles.stageSummaryText}>
                    {round === "final"
                      ? `${progression.expectedSquads} finalists · Publish the official top ${progression.advanceCount}`
                      : `${progression.advanceCount} advance · ${progression.eliminatedCount} eliminated`}
                  </Text>
                  <Text style={styles.stageSummaryMeta}>
                    {progression.publishedResultCount}/{progression.expectedSquads} results published
                    {progression.transitionConfirmed ? " · STAGE LOCKED" : ""}
                  </Text>
                </View>
              ) : null}
              {progression?.rankedResults.length ? (
                <View style={styles.previewList}>
                  <Text style={styles.sectionLabel}>PROVISIONAL STAGE RANKING · NOT LOCKED</Text>
                  {progression.rankedResults.map((row) => {
                    const squad = squads.find((item) => item.teamNumber === row.teamNumber);
                    const atBoundary = progression.boundaryTieTeamNumbers.includes(row.teamNumber);
                    return (
                      <View key={row.teamNumber} style={styles.previewRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.previewTeam}>#{row.rank} · {squad?.teamName ?? `Team ${String(row.teamNumber).padStart(2, "0")}`}</Text>
                          <Text style={styles.previewMeta}>
                            {squad?.captainName ?? "—"} · #{row.placement} placement · {row.squadKills} kills · {row.roundPoints} pts
                          </Text>
                        </View>
                        <Text style={[styles.previewStatus, atBoundary ? styles.pending : styles.paid]}>
                          {atBoundary ? "TIE DECISION" : row.status.toUpperCase()}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}
              {squads.length ? (
                <View style={styles.teamList}>
                  {squads.map((squad) => {
                    const active = squad.teamNumber === selectedSquad?.teamNumber;
                    return (
                      <Pressable
                        key={squad.teamNumber}
                        accessibilityRole={squad.eligible ? "button" : undefined}
                        accessibilityState={{ disabled: !squad.eligible, selected: active }}
                        disabled={!squad.eligible}
                        onPress={() => {
                          setSelectedTeamNumber(squad.teamNumber);
                          setEditKey("");
                          setCorrectionReason("");
                          setError("");
                          setNotice("");
                        }}
                        style={[
                          styles.teamCard,
                          active && styles.teamCardActive,
                          !squad.eligible && styles.teamCardIncomplete,
                        ]}
                      >
                        <View style={styles.teamTitleRow}>
                          <Text style={styles.teamName}>{squad.teamName}</Text>
                          <Text style={[styles.teamBadge, squad.eligible ? styles.paid : styles.pending]}>
                            {squad.stageStatus}
                          </Text>
                        </View>
                        <Text style={styles.captainName}>CAPTAIN · {squad.captainName}</Text>
                        {squad.players.map((player) => (
                          <View key={player.slotNumber} style={styles.playerRow}>
                            <Text style={styles.playerName} numberOfLines={1}>
                              {player.slotNumber}. {player.playerName}
                            </Text>
                            <View style={styles.paymentInfo}>
                              <Text style={[styles.payment, player.paymentStatus === "paid" ? styles.paid : styles.pending]}>
                                {player.paymentStatus.toUpperCase()}
                              </Text>
                              {player.paidByCaptain ? <Text style={styles.captainPaid}>CAPTAIN PAID</Text> : null}
                            </View>
                          </View>
                        ))}
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.empty}>No registered squads yet.</Text>
              )}

              {selectedSquad ? (
                <View style={styles.form}>
                  <Text style={styles.sectionLabel}>
                    {selectedSquad.teamName} · {round.replace("_", " ").toUpperCase()}
                  </Text>
                  <View style={styles.inputs}>
                    <View style={styles.inputBlock}>
                      <Text style={styles.fieldLabel}>PLACEMENT</Text>
                      <TextInput
                        testID="knockout-result-placement"
                        accessibilityLabel="Squad placement"
                        keyboardType="number-pad"
                        maxLength={2}
                        value={placementText}
                        onChangeText={(value) => editField("placement", value)}
                        placeholder={`1–${eligibleSquads.length}`}
                        placeholderTextColor={A.sub}
                        style={styles.input}
                      />
                    </View>
                    <View style={styles.inputBlock}>
                      <Text style={styles.fieldLabel}>TOTAL SQUAD KILLS</Text>
                      <TextInput
                        testID="knockout-result-squad-kills"
                        accessibilityLabel="Total squad kills"
                        keyboardType="number-pad"
                        maxLength={6}
                        value={killsText}
                        onChangeText={(value) => editField("kills", value)}
                        placeholder="0"
                        placeholderTextColor={A.sub}
                        style={styles.input}
                      />
                    </View>
                  </View>
                  <View style={styles.preview}>
                    <Text style={styles.previewLabel}>CALCULATED ROUND POINTS</Text>
                    <Text style={styles.previewValue}>{previewPoints ?? "—"}</Text>
                    <Text style={styles.previewFormula}>
                      Placement points + kills × {resultsQuery.data?.pointsPerKill ?? selectedEvent.pointsPerKill}
                    </Text>
                  </View>
                  {savedResult ? (
                    <Text style={[styles.status, savedResult.status === "published" ? styles.paid : styles.pending]}>
                      {savedResult.status === "published" ? "PUBLISHED" : "DRAFT"}
                      {savedResult.status === "published" ? ` · ${savedResult.roundPoints} POINTS` : ""}
                    </Text>
                  ) : null}
                  {savedResult ? (
                    <View style={styles.correctionBlock}>
                      <Text style={styles.fieldLabel}>CORRECTION REASON · REQUIRED WHEN CHANGING A SAVED RESULT</Text>
                      <TextInput
                        testID="knockout-result-correction-reason"
                        accessibilityLabel="Reason for correcting this result"
                        value={correctionReason}
                        onChangeText={(value) => setCorrectionReason(value.slice(0, 500))}
                        placeholder="Explain the correction (5–500 characters)"
                        placeholderTextColor={A.sub}
                        multiline
                        style={[styles.input, styles.tieReason]}
                      />
                    </View>
                  ) : null}
                  {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
                  {notice ? <Text accessibilityLiveRegion="polite" style={styles.success}>{notice}</Text> : null}
                  <View style={styles.actions}>
                    <Pressable
                      testID="knockout-result-save-draft"
                      accessibilityRole="button"
                      accessibilityState={{ disabled: saving || !validInput || !correctionReasonValid }}
                      disabled={saving || !validInput || !correctionReasonValid}
                      onPress={() => void saveDraft()}
                      style={[styles.button, styles.saveButton, (saving || !validInput || !correctionReasonValid) && styles.disabled]}
                    >
                      <Feather name="save" size={14} color={A.bg} />
                      <Text style={styles.saveText}>{savedResult?.status === "published" ? "SAVE AS DRAFT" : "SAVE DRAFT"}</Text>
                    </Pressable>
                    <Pressable
                      testID="knockout-result-publish"
                      accessibilityRole="button"
                      accessibilityState={{ disabled: saving || savedResult?.status !== "draft" || progression?.transitionConfirmed }}
                      disabled={saving || savedResult?.status !== "draft" || progression?.transitionConfirmed}
                      onPress={() => void publish()}
                      style={[styles.button, styles.publishButton, (saving || savedResult?.status !== "draft" || progression?.transitionConfirmed) && styles.disabled]}
                    >
                      <Feather name="check-circle" size={14} color={A.text} />
                      <Text style={styles.publishText}>{saving ? "SAVING…" : "PUBLISH RESULT"}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <View style={styles.savedList}>
                <Text style={styles.sectionLabel}>SAVED ROUND RESULTS · PROVISIONAL UNTIL CONFIRMED</Text>
                {resultsQuery.data?.results.length ? resultsQuery.data.results.map((result) => (
                  <View key={result.id} style={styles.savedRow}>
                    <Text style={styles.savedName}>Team {String(result.teamNumber).padStart(2, "0")} · #{result.placement}</Text>
                    <Text style={styles.savedMeta}>{result.squadKills} kills · {result.roundPoints} pts · {result.status.toUpperCase()}</Text>
                  </View>
                )) : <Text style={styles.empty}>No results entered for this round.</Text>}
              </View>

              {boundaryTie.length > 0 ? (
                <View style={styles.tiePanel}>
                  <Text style={styles.tieTitle}>TIE AT THE ADVANCEMENT / WINNER CUTOFF</Text>
                  <Text style={styles.tieHint}>
                    Higher kills and then better placement have already been applied. Order the remaining tied squads and record the admin decision reason.
                  </Text>
                  {effectiveTieOrder.map((teamNumber, index) => (
                    <View key={teamNumber} style={styles.tieRow}>
                      <Text style={styles.tieTeam}>#{index + 1} · Team {String(teamNumber).padStart(2, "0")}</Text>
                      <View style={styles.tieArrows}>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Move Team ${teamNumber} up`} disabled={index === 0} onPress={() => moveTieTeam(index, -1)} style={styles.tieArrow}>
                          <Feather name="chevron-up" size={16} color={index === 0 ? A.sub : A.text} />
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Move Team ${teamNumber} down`} disabled={index === effectiveTieOrder.length - 1} onPress={() => moveTieTeam(index, 1)} style={styles.tieArrow}>
                          <Feather name="chevron-down" size={16} color={index === effectiveTieOrder.length - 1 ? A.sub : A.text} />
                        </Pressable>
                      </View>
                    </View>
                  ))}
                  <TextInput
                    accessibilityLabel="Recorded admin tie-break reason"
                    value={tieReason}
                    onChangeText={(value) => setTieReason(value.slice(0, 500))}
                    placeholder="Admin reason for final order (5–500 characters)"
                    placeholderTextColor={A.sub}
                    multiline
                    style={[styles.input, styles.tieReason]}
                  />
                </View>
              ) : null}

              {progression?.transitionConfirmed ? (
                <Text style={styles.lockedNotice}>
                  {round === "final" ? "OFFICIAL FINAL RANKING PUBLISHED" : "ROUND CONFIRMED · ADVANCEMENT LOCKED"}
                </Text>
              ) : (
                <Pressable
                  testID="knockout-confirm-progression"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: saving || !canConfirmProgression }}
                  disabled={saving || !canConfirmProgression}
                  onPress={requestProgressionConfirmation}
                  style={[styles.confirmButton, (saving || !canConfirmProgression) && styles.disabled]}
                >
                  <Feather name={round === "final" ? "award" : "shuffle"} size={15} color={A.bg} />
                  <Text style={styles.confirmText}>
                    {saving
                      ? "CONFIRMING…"
                      : round === "final"
                        ? "CONFIRM FINAL TOP 3 WINNERS"
                        : "CONFIRM ELIMINATIONS & ADVANCE"}
                  </Text>
                </Pressable>
              )}
            </>
          ) : null}
          <PrizeStatusPanel
            event={selectedEvent}
            data={prizesQuery.data}
            isLoading={prizesQuery.isLoading}
            isError={prizesQuery.isError}
            saving={prizeSaving}
            onApprove={requestPrizeApproval}
          />
          <KnockoutAuditPanel
            entries={auditQuery.data?.entries ?? []}
            isLoading={auditQuery.isLoading}
            isError={auditQuery.isError}
          />
        </>
      ) : null}
    </View>
  );
}

function PrizeStatusPanel({
  event,
  data,
  isLoading,
  isError,
  saving,
  onApprove,
}: {
  event: Daily007KnockoutEvent;
  data: Daily007KnockoutPrizePayoutResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  saving: boolean;
  onApprove: () => void;
}) {
  return (
    <View style={styles.prizePanel} testID="admin-knockout-prizes">
      <Text style={styles.sectionLabel}>TOP 3 PRIZE STATUS</Text>
      <Text style={styles.prizeNotice}>
        Fixed distribution · 1,000 wallet coins total · wallet credit only, not a cash transfer.
      </Text>
      <View style={styles.prizeTiers}>
        {event.prizeDistribution.map((tier) => (
          <View key={tier.rank} style={styles.prizeTier}>
            <Text style={styles.prizeRank}>RANK {tier.rank}</Text>
            <Text style={styles.prizeAmount}>₹{tier.squadCoins} / squad</Text>
            <Text style={styles.prizeMember}>{tier.playerCoins} coins / player</Text>
          </View>
        ))}
      </View>
      {isLoading ? <Text style={styles.empty}>Loading final prize status…</Text> : null}
      {isError ? <Text accessibilityRole="alert" style={styles.error}>Could not load prize status. Refresh and retry.</Text> : null}
      {!isLoading && !isError && data ? (
        <>
          <Text style={[
            styles.payoutStatus,
            data.status === "credited" ? styles.paid : data.status === "blocked" ? styles.pending : null,
          ]}>
            {data.status === "credited"
              ? "CREDITED TO DAILY007 WALLETS"
              : data.status === "pending_approval"
                ? "PENDING ADMIN APPROVAL"
                : data.status === "blocked"
                  ? "PAYOUT BLOCKED · REVIEW REQUIRED"
                  : "AWAITING FINAL RESULTS"}
          </Text>
          <Text style={styles.prizeNotice}>{data.message}</Text>
          {data.awards.map((award) => (
            <View key={award.registrationId} style={styles.awardRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.awardPlayer}>
                  #{award.rank} · Team {String(award.teamNumber).padStart(2, "0")} · Slot {award.slotNumber}
                </Text>
                <Text style={styles.awardRecipient} numberOfLines={2}>
                  {award.playerName}
                  {award.recipientName !== award.playerName ? ` · credited to ${award.recipientName}` : ""}
                </Text>
              </View>
              <View style={styles.awardAmountBlock}>
                <Text style={styles.awardAmount}>{award.playerPrizeCoins} coins</Text>
                <Text style={[styles.awardStatus, award.status === "credited" ? styles.paid : styles.pending]}>
                  {award.status === "credited" ? "CREDITED" : "PENDING"}
                </Text>
              </View>
            </View>
          ))}
          {data.approvedAt ? <Text style={styles.prizeNotice}>Approved {formatAuditTime(data.approvedAt)}</Text> : null}
          {data.canApprove ? (
            <Pressable
              testID="knockout-prize-approve"
              accessibilityRole="button"
              accessibilityState={{ disabled: saving }}
              disabled={saving}
              onPress={onApprove}
              style={[styles.confirmButton, saving && styles.disabled]}
            >
              <Feather name="credit-card" size={15} color={A.bg} />
              <Text style={styles.confirmText}>{saving ? "CREDITING…" : "APPROVE & CREDIT 1,000 COINS"}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function KnockoutAuditPanel({
  entries,
  isLoading,
  isError,
}: {
  entries: Daily007KnockoutAuditEntry[];
  isLoading: boolean;
  isError: boolean;
}) {
  return (
    <View style={styles.auditPanel} testID="admin-knockout-audit">
      <Text style={styles.sectionLabel}>ADMIN AUDIT HISTORY</Text>
      <Text style={styles.prizeNotice}>
        Settings changes, result corrections, publication, progression, and prize credits.
      </Text>
      {isLoading ? <Text style={styles.empty}>Loading audit history…</Text> : null}
      {isError ? <Text accessibilityRole="alert" style={styles.error}>Could not load audit history.</Text> : null}
      {!isLoading && !isError && entries.length === 0 ? (
        <Text style={styles.empty}>No admin actions have been recorded yet.</Text>
      ) : null}
      {entries.slice(0, 20).map((entry) => (
        <View key={entry.id} style={styles.auditRow}>
          <View style={styles.auditHeader}>
            <Text style={styles.auditAction}>{entry.action.replaceAll("_", " ").toUpperCase()}</Text>
            <Text style={styles.auditTime}>{formatAuditTime(entry.createdAt)}</Text>
          </View>
          <Text style={styles.auditMeta}>
            {entry.adminName}
            {entry.round ? ` · ${entry.round.replaceAll("_", " ").toUpperCase()}` : ""}
            {entry.teamNumber ? ` · Team ${String(entry.teamNumber).padStart(2, "0")}` : ""}
          </Text>
          {entry.reason ? <Text style={styles.auditReason}>{entry.reason}</Text> : null}
          {auditDetail(entry) ? <Text style={styles.auditDiff}>{auditDetail(entry)}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function formatAuditTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return `${new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date)} IST`;
}

function auditDetail(entry: Daily007KnockoutAuditEntry): string | null {
  const before = entry.beforeState ?? {};
  const after = entry.afterState ?? {};
  const value = (state: Record<string, unknown>, key: string) =>
    typeof state[key] === "number" || typeof state[key] === "string" ? state[key] : "—";
  if (entry.action === "result_corrected") {
    return `Before: #${value(before, "placement")}, ${value(before, "squadKills")} kills → After: #${value(after, "placement")}, ${value(after, "squadKills")} kills`;
  }
  if (entry.action === "result_saved" || entry.action === "result_published") {
    return `Placement #${value(after, "placement")} · ${value(after, "squadKills")} kills · ${value(after, "roundPoints")} points`;
  }
  if (entry.action === "settings_created") {
    return `${value(after, "title")} · ${value(after, "squadCount")} squads · ${value(after, "prizePool")} coin pool`;
  }
  if (entry.action === "settings_updated") {
    return `Settings: ${value(before, "title")} / ${value(before, "prizePool")} pool → ${value(after, "title")} / ${value(after, "prizePool")} pool`;
  }
  if (entry.action === "stage_confirmed") {
    const rankings = Array.isArray(after.rankings) ? after.rankings.length : 0;
    return `${value(after, "status")} · ${rankings} squad results locked`;
  }
  if (entry.action === "prize_credited") {
    return `${value(after, "totalCoins")} coins · ${value(after, "awardCount")} player credits`;
  }
  return null;
}

const styles = StyleSheet.create({
  panel: { padding: 13, backgroundColor: A.card, borderColor: A.border, borderWidth: 1, borderRadius: 16, gap: 11 },
  heading: { color: A.gold, fontSize: 12, fontWeight: "900", letterSpacing: 0.8 },
  hint: { color: A.sub, fontSize: 10, lineHeight: 15 },
  chips: { gap: 7, paddingVertical: 2 },
  chip: { maxWidth: 210, paddingHorizontal: 11, minHeight: 36, borderRadius: 10, justifyContent: "center", backgroundColor: A.bg, borderWidth: 1, borderColor: A.border },
  chipActive: { borderColor: A.gold + "88", backgroundColor: A.gold + "14" },
  chipText: { color: A.sub, fontSize: 9, fontWeight: "900" },
  chipTextActive: { color: A.gold },
  rounds: { flexDirection: "row", gap: 7 },
  roundChip: { flex: 1, minHeight: 38, justifyContent: "center", alignItems: "center", borderRadius: 9, backgroundColor: A.bg, borderWidth: 1, borderColor: A.border },
  roundChipActive: { backgroundColor: A.gold + "14", borderColor: A.gold + "88" },
  roundText: { color: A.sub, fontSize: 9, fontWeight: "900" },
  roundTextActive: { color: A.gold },
  sectionLabel: { color: A.cyan, fontSize: 9, fontWeight: "900", letterSpacing: 0.6 },
  stageSummary: { padding: 9, borderRadius: 10, backgroundColor: A.cyan + "10", borderWidth: 1, borderColor: A.cyan + "38", gap: 4 },
  stageSummaryText: { color: A.text, fontSize: 10, fontWeight: "900" },
  stageSummaryMeta: { color: A.sub, fontSize: 8, fontWeight: "800" },
  previewList: { gap: 6, padding: 9, borderRadius: 10, backgroundColor: A.bg, borderWidth: 1, borderColor: A.border },
  previewRow: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: A.border },
  previewTeam: { color: A.text, fontSize: 9, fontWeight: "900" },
  previewMeta: { color: A.sub, fontSize: 8, fontWeight: "700", marginTop: 2 },
  previewStatus: { fontSize: 7, fontWeight: "900", textAlign: "right" },
  prizePanel: { padding: 10, borderRadius: 11, backgroundColor: A.bg, borderWidth: 1, borderColor: A.gold + "55", gap: 8 },
  prizeNotice: { color: A.sub, fontSize: 8, lineHeight: 13 },
  prizeTiers: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  prizeTier: { flexGrow: 1, flexBasis: "30%", minWidth: 95, padding: 8, borderRadius: 9, backgroundColor: A.gold + "10", borderWidth: 1, borderColor: A.gold + "40", gap: 3 },
  prizeRank: { color: A.gold, fontSize: 8, fontWeight: "900" },
  prizeAmount: { color: A.text, fontSize: 9, fontWeight: "900" },
  prizeMember: { color: A.sub, fontSize: 8, fontWeight: "800" },
  payoutStatus: { color: A.orange, fontSize: 9, fontWeight: "900" },
  awardRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, backgroundColor: A.card, borderWidth: 1, borderColor: A.border },
  awardPlayer: { color: A.text, fontSize: 8, fontWeight: "900" },
  awardRecipient: { color: A.sub, fontSize: 8, marginTop: 2 },
  awardAmountBlock: { alignItems: "flex-end", gap: 2 },
  awardAmount: { color: A.gold, fontSize: 9, fontWeight: "900" },
  awardStatus: { fontSize: 7, fontWeight: "900" },
  auditPanel: { padding: 10, borderRadius: 11, backgroundColor: A.bg, borderWidth: 1, borderColor: A.border, gap: 7 },
  auditRow: { padding: 8, borderRadius: 8, backgroundColor: A.card, borderWidth: 1, borderColor: A.border, gap: 3 },
  auditHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 6 },
  auditAction: { flex: 1, color: A.gold, fontSize: 8, fontWeight: "900" },
  auditTime: { color: A.sub, fontSize: 7, fontWeight: "700", textAlign: "right" },
  auditMeta: { color: A.cyan, fontSize: 8, fontWeight: "800" },
  auditReason: { color: A.text, fontSize: 8, lineHeight: 12 },
  auditDiff: { color: A.sub, fontSize: 8, lineHeight: 12 },
  correctionBlock: { gap: 6 },
  teamList: { gap: 7 },
  teamCard: { padding: 10, borderRadius: 11, backgroundColor: A.bg, borderWidth: 1, borderColor: A.border, gap: 6 },
  teamCardActive: { borderColor: A.gold + "88" },
  teamCardIncomplete: { opacity: 0.82 },
  teamTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, borderBottomWidth: 1, borderBottomColor: A.border, paddingBottom: 6 },
  teamName: { color: A.gold, fontSize: 11, fontWeight: "900" },
  teamBadge: { fontSize: 8, fontWeight: "900" },
  captainName: { color: A.cyan, fontSize: 8, fontWeight: "800" },
  playerRow: { minHeight: 22, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  playerName: { color: A.text, flex: 1, fontSize: 9, fontWeight: "800" },
  paymentInfo: { flexDirection: "row", alignItems: "center", gap: 5 },
  payment: { fontSize: 8, fontWeight: "900" },
  paid: { color: A.green },
  pending: { color: A.orange },
  captainPaid: { color: A.cyan, fontSize: 7, fontWeight: "900" },
  form: { paddingTop: 10, borderTopWidth: 1, borderTopColor: A.border, gap: 9 },
  inputs: { flexDirection: "row", gap: 8 },
  inputBlock: { flex: 1, minWidth: 0, gap: 5 },
  fieldLabel: { color: A.sub, fontSize: 8, fontWeight: "900", letterSpacing: 0.55 },
  input: { minHeight: 43, borderRadius: 9, paddingHorizontal: 10, backgroundColor: A.bg, borderColor: A.border, borderWidth: 1, color: A.text, fontSize: 13, fontWeight: "800" },
  preview: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, backgroundColor: A.gold + "10", borderWidth: 1, borderColor: A.gold + "45", flexWrap: "wrap" },
  previewLabel: { color: A.sub, fontSize: 8, fontWeight: "900", flexGrow: 1 },
  previewValue: { color: A.gold, fontSize: 17, fontWeight: "900" },
  previewFormula: { width: "100%", color: A.sub, fontSize: 8, fontWeight: "700" },
  status: { fontSize: 9, fontWeight: "900" },
  actions: { flexDirection: "row", gap: 8 },
  button: { flex: 1, minHeight: 43, borderRadius: 10, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  saveButton: { backgroundColor: A.gold },
  publishButton: { backgroundColor: A.green + "20", borderWidth: 1, borderColor: A.green + "66" },
  saveText: { color: A.bg, fontSize: 8, fontWeight: "900" },
  publishText: { color: A.text, fontSize: 8, fontWeight: "900" },
  disabled: { opacity: 0.48 },
  savedList: { gap: 7, borderTopWidth: 1, borderTopColor: A.border, paddingTop: 10 },
  savedRow: { paddingVertical: 8, paddingHorizontal: 9, borderRadius: 9, backgroundColor: A.bg, borderWidth: 1, borderColor: A.border, flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 5 },
  savedName: { color: A.text, fontSize: 9, fontWeight: "900" },
  savedMeta: { color: A.sub, fontSize: 8, fontWeight: "700" },
  tiePanel: { padding: 10, borderRadius: 11, backgroundColor: A.orange + "12", borderWidth: 1, borderColor: A.orange + "66", gap: 7 },
  tieTitle: { color: A.orange, fontSize: 9, fontWeight: "900" },
  tieHint: { color: A.sub, fontSize: 9, lineHeight: 14 },
  tieRow: { minHeight: 38, paddingHorizontal: 9, borderRadius: 8, backgroundColor: A.bg, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tieTeam: { color: A.text, fontSize: 10, fontWeight: "900" },
  tieArrows: { flexDirection: "row", gap: 4 },
  tieArrow: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: A.card, borderWidth: 1, borderColor: A.border },
  tieReason: { minHeight: 62, paddingTop: 10, textAlignVertical: "top" },
  confirmButton: { minHeight: 45, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 7, backgroundColor: A.gold },
  confirmText: { color: A.bg, fontSize: 9, fontWeight: "900", textAlign: "center", flexShrink: 1 },
  lockedNotice: { color: A.green, backgroundColor: A.green + "12", borderWidth: 1, borderColor: A.green + "55", borderRadius: 9, padding: 10, fontSize: 9, fontWeight: "900", textAlign: "center" },
  empty: { color: A.sub, fontSize: 10, textAlign: "center", paddingVertical: 8 },
  error: { color: "#FFB4B4", backgroundColor: A.redSoft, borderRadius: 9, borderWidth: 1, borderColor: A.red + "77", padding: 9, fontSize: 10, fontWeight: "800" },
  success: { color: A.green, backgroundColor: A.green + "12", borderRadius: 9, borderWidth: 1, borderColor: A.green + "66", padding: 9, fontSize: 9, fontWeight: "800" },
});
