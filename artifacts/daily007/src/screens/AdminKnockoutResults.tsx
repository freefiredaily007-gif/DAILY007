import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  useDaily007AdminGetKnockoutRoundResults,
  useDaily007AdminPublishKnockoutRoundResult,
  useDaily007AdminSaveKnockoutRoundResult,
  type Daily007KnockoutEvent,
  type Daily007KnockoutRound,
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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
  const saveMutation = useDaily007AdminSaveKnockoutRoundResult();
  const publishMutation = useDaily007AdminPublishKnockoutRoundResult();
  const squads = resultsQuery.data?.squads ?? [];
  const confirmedSquads = useMemo(() => squads.filter((squad) => squad.confirmed), [squads]);
  const selectedSquad =
    confirmedSquads.find((squad) => squad.teamNumber === selectedTeamNumber) ??
    confirmedSquads[0] ??
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
    placement <= confirmedSquads.length &&
    Number.isSafeInteger(squadKills) &&
    squadKills >= 0 &&
    squadKills <= 100_000;
  const previewPoints = validInput
    ? placementPoints(placement) * 1 + squadKills * (resultsQuery.data?.pointsPerKill ?? selectedEvent?.pointsPerKill ?? 1)
    : null;
  const saving = saveMutation.isPending || publishMutation.isPending;

  const selectEvent = (id: string) => {
    setSelectedMatchId(id);
    setSelectedTeamNumber(null);
    setEditKey("");
    setError("");
    setNotice("");
  };
  const selectRound = (value: Daily007KnockoutRound) => {
    setRound(value);
    setSelectedTeamNumber(null);
    setEditKey("");
    setError("");
    setNotice("");
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
      setError("Choose a confirmed squad and enter a valid placement and total squad kills.");
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
        },
      });
      setEditKey("");
      setNotice("Draft saved. It will not affect official rankings until published.");
      await resultsQuery.refetch();
    } catch (cause) {
      setError(requestError(cause));
    }
  };
  const publish = async () => {
    if (!selectedEvent || !savedResult || savedResult.status !== "draft") return;
    setError("");
    setNotice("");
    try {
      const result = await publishMutation.mutateAsync({
        id: selectedEvent.matchId,
        resultId: savedResult.id,
      });
      setNotice(result.alreadyPublished ? "This result is already published." : "Result published to official rankings.");
      await resultsQuery.refetch();
    } catch (cause) {
      setError(requestError(cause));
    }
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
                CONFIRMED SQUADS · {confirmedSquads.length} / {selectedEvent.squadCount}
              </Text>
              {squads.length ? (
                <View style={styles.teamList}>
                  {squads.map((squad) => {
                    const active = squad.teamNumber === selectedSquad?.teamNumber;
                    return (
                      <Pressable
                        key={squad.teamNumber}
                        accessibilityRole={squad.confirmed ? "button" : undefined}
                        accessibilityState={{ disabled: !squad.confirmed, selected: active }}
                        disabled={!squad.confirmed}
                        onPress={() => {
                          setSelectedTeamNumber(squad.teamNumber);
                          setEditKey("");
                          setError("");
                          setNotice("");
                        }}
                        style={[
                          styles.teamCard,
                          active && styles.teamCardActive,
                          !squad.confirmed && styles.teamCardIncomplete,
                        ]}
                      >
                        <View style={styles.teamTitleRow}>
                          <Text style={styles.teamName}>{squad.teamName}</Text>
                          <Text style={[styles.teamBadge, squad.confirmed ? styles.paid : styles.pending]}>
                            {squad.confirmed ? "CONFIRMED" : `INCOMPLETE · ${squad.registeredPlayers}/4`}
                          </Text>
                        </View>
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
                        placeholder={`1–${confirmedSquads.length}`}
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
                  {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
                  {notice ? <Text accessibilityLiveRegion="polite" style={styles.success}>{notice}</Text> : null}
                  <View style={styles.actions}>
                    <Pressable
                      testID="knockout-result-save-draft"
                      accessibilityRole="button"
                      accessibilityState={{ disabled: saving || !validInput }}
                      disabled={saving || !validInput}
                      onPress={() => void saveDraft()}
                      style={[styles.button, styles.saveButton, (saving || !validInput) && styles.disabled]}
                    >
                      <Feather name="save" size={14} color={A.bg} />
                      <Text style={styles.saveText}>{savedResult?.status === "published" ? "SAVE AS DRAFT" : "SAVE DRAFT"}</Text>
                    </Pressable>
                    <Pressable
                      testID="knockout-result-publish"
                      accessibilityRole="button"
                      accessibilityState={{ disabled: saving || savedResult?.status !== "draft" }}
                      disabled={saving || savedResult?.status !== "draft"}
                      onPress={() => void publish()}
                      style={[styles.button, styles.publishButton, (saving || savedResult?.status !== "draft") && styles.disabled]}
                    >
                      <Feather name="check-circle" size={14} color={A.text} />
                      <Text style={styles.publishText}>{saving ? "SAVING…" : "PUBLISH RESULT"}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <View style={styles.savedList}>
                <Text style={styles.sectionLabel}>SAVED ROUND RESULTS</Text>
                {resultsQuery.data?.results.length ? resultsQuery.data.results.map((result) => (
                  <View key={result.id} style={styles.savedRow}>
                    <Text style={styles.savedName}>Team {String(result.teamNumber).padStart(2, "0")} · #{result.placement}</Text>
                    <Text style={styles.savedMeta}>{result.squadKills} kills · {result.roundPoints} pts · {result.status.toUpperCase()}</Text>
                  </View>
                )) : <Text style={styles.empty}>No results entered for this round.</Text>}
              </View>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
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
  teamList: { gap: 7 },
  teamCard: { padding: 10, borderRadius: 11, backgroundColor: A.bg, borderWidth: 1, borderColor: A.border, gap: 6 },
  teamCardActive: { borderColor: A.gold + "88" },
  teamCardIncomplete: { opacity: 0.82 },
  teamTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, borderBottomWidth: 1, borderBottomColor: A.border, paddingBottom: 6 },
  teamName: { color: A.gold, fontSize: 11, fontWeight: "900" },
  teamBadge: { fontSize: 8, fontWeight: "900" },
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
  empty: { color: A.sub, fontSize: 10, textAlign: "center", paddingVertical: 8 },
  error: { color: "#FFB4B4", backgroundColor: A.redSoft, borderRadius: 9, borderWidth: 1, borderColor: A.red + "77", padding: 9, fontSize: 10, fontWeight: "800" },
  success: { color: A.green, backgroundColor: A.green + "12", borderRadius: 9, borderWidth: 1, borderColor: A.green + "66", padding: 9, fontSize: 9, fontWeight: "800" },
});
