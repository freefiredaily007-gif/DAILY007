import React, { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  useDaily007AdminApproveLeaderboardPeriod,
  useDaily007AdminListLeaderboardPeriods,
} from "@workspace/api-client-react";
import { ReadableText as Text } from "../components/typography";
import {
  A,
  Btn,
  Card,
  Empty,
  Loading,
  ScreenWrap,
  SectionTitle,
  useToast,
} from "../components/adminKit";
import { Input } from "../components/ui";
import { apiError } from "../lib/api";

type Standing = {
  rank: number;
  userId: string;
  name: string;
  points: number;
  earnings: number;
  wins: number;
  kills: number;
  matches: number;
};
type Period = {
  id: string;
  cycleType: "weekly" | "monthly";
  status: "pending_approval";
  startsAt: string;
  endsAt: string;
  standings: Standing[];
};
type PayoutDraft = { rank: string; coins: string };

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(date));
}

function periodRange(period: Period): string {
  const lastDay = new Date(Date.parse(period.endsAt) - 1);
  return `${formatDate(period.startsAt)} – ${formatDate(lastDay.toISOString())} IST`;
}

export default function AdminLeaderboards() {
  const periodsQuery = useDaily007AdminListLeaderboardPeriods();
  const refetchRef = useRef(periodsQuery.refetch);
  const { mutateAsync: approvePeriod, isPending: isApproving } =
    useDaily007AdminApproveLeaderboardPeriod();
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, PayoutDraft[]>>({});
  const [busyPeriodId, setBusyPeriodId] = useState("");
  const [error, setError] = useState("");
  const periods = (periodsQuery.data?.periods ?? []) as Period[];

  useEffect(() => {
    refetchRef.current = periodsQuery.refetch;
  }, [periodsQuery.refetch]);

  useEffect(() => {
    const timer = setInterval(() => void refetchRef.current(), 60_000);
    return () => clearInterval(timer);
  }, []);

  const payoutDraftsFor = (period: Period): PayoutDraft[] =>
    drafts[period.id] ?? (period.standings.length > 0 ? [{ rank: "1", coins: "" }] : []);

  const updateDraft = (period: Period, index: number, key: keyof PayoutDraft, value: string) => {
    const current = payoutDraftsFor(period);
    const next = current.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [key]: value.replace(/[^0-9]/g, "") } : entry,
    );
    setDrafts((previous) => ({ ...previous, [period.id]: next }));
  };

  const addPayout = (period: Period) => {
    setDrafts((previous) => ({
      ...previous,
      [period.id]: [...payoutDraftsFor(period), { rank: "", coins: "" }],
    }));
  };

  const removePayout = (period: Period, index: number) => {
    setDrafts((previous) => ({
      ...previous,
      [period.id]: payoutDraftsFor(period).filter((_, entryIndex) => entryIndex !== index),
    }));
  };

  const approve = (period: Period) => {
    const entries = payoutDraftsFor(period);
    const payouts: { rank: number; coins: number }[] = [];
    const usedRanks = new Set<number>();

    for (const entry of entries) {
      const rank = Number(entry.rank);
      const coins = Number(entry.coins);
      if (!Number.isSafeInteger(rank) || rank < 1 || rank > period.standings.length) {
        setError("Choose a leaderboard rank that appears in the standings.");
        return;
      }
      if (!Number.isSafeInteger(coins) || coins < 1 || coins > 2_147_483_647) {
        setError("Each payout must be a positive whole number of coins.");
        return;
      }
      if (usedRanks.has(rank)) {
        setError("Each leaderboard rank can receive only one payout.");
        return;
      }
      usedRanks.add(rank);
      payouts.push({ rank, coins });
    }

    if (period.standings.length > 0 && payouts.length === 0) {
      setError("Add at least one coin payout before approving these standings.");
      return;
    }

    setError("");
    const payoutSummary = payouts.length
      ? payouts.map((payout) => `#${payout.rank}: ${payout.coins.toLocaleString("en-IN")} coins`).join("\n")
      : "No players earned a leaderboard score, so no coins will be paid.";
    Alert.alert(
      "Finalize this leaderboard cycle?",
      `${period.cycleType.toUpperCase()} · ${periodRange(period)}\n\n${payoutSummary}\n\nThis locks the standings and activates the next cycle when available.`,
      [
        { text: "Review", style: "cancel" },
        {
          text: payouts.length ? "Approve & pay" : "Finalize cycle",
          onPress: () => { void submitApproval(period, payouts); },
        },
      ],
    );
  };

  const submitApproval = async (
    period: Period,
    payouts: { rank: number; coins: number }[],
  ) => {
    setBusyPeriodId(period.id);
    setError("");
    try {
      const result = await approvePeriod({ id: period.id, data: { payouts } });
      const paidCount = result.payouts?.length ?? 0;
      toast(
        paidCount
          ? `Cycle finalized; ${paidCount} wallet payout${paidCount === 1 ? "" : "s"} issued.`
          : "Cycle finalized and the next period is ready.",
        "success",
      );
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[period.id];
        return next;
      });
      await periodsQuery.refetch();
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      setBusyPeriodId("");
    }
  };

  return (
    <ScreenWrap onRefresh={() => periodsQuery.refetch()}>
      <SectionTitle
        title="Leaderboard approvals"
        sub="Full Admin only · finalize standings and choose extra coin prizes"
        icon="award"
      />

      {error ? (
        <Card style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </Card>
      ) : null}

      {periodsQuery.isLoading ? (
        <Loading />
      ) : periodsQuery.error && periods.length === 0 ? (
        <Empty text={`Could not load leaderboard approvals: ${apiError(periodsQuery.error)}`} />
      ) : periods.length === 0 ? (
        <Empty text="No ended leaderboard cycles are waiting for approval." />
      ) : (
        periods.map((period) => {
          const draftsForPeriod = payoutDraftsFor(period);
          const isBusy = isApproving && busyPeriodId === period.id;
          return (
            <Card key={period.id} style={styles.periodCard}>
              <View style={styles.periodHeader}>
                <View style={styles.periodTitleGroup}>
                  <View style={styles.iconBox}>
                    <Feather name="award" size={17} color={A.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cycleName}>{period.cycleType.toUpperCase()} CYCLE</Text>
                    <Text style={styles.periodDates}>{periodRange(period)}</Text>
                  </View>
                </View>
                <View style={styles.pendingTag}>
                  <Text style={styles.pendingTagText}>REVIEW</Text>
                </View>
              </View>

              <Text style={styles.explanation}>
                Scores follow match start dates in this cycle. Wait until all its tournament results are published, then set extra rewards by rank and approve to lock standings and move the cycle forward.
              </Text>

              {period.standings.length === 0 ? (
                <Empty text="No match awards were recorded during this period. You can finalize it without payouts." />
              ) : (
                <View style={styles.standings}>
                  <Text style={styles.listHeading}>FINAL PRIZE-COIN STANDINGS</Text>
                  {period.standings.map((standing) => (
                    <View key={standing.userId} style={styles.standingRow}>
                      <Text style={styles.rank}>#{standing.rank}</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={styles.playerName}>{standing.name}</Text>
                        <Text style={styles.playerStats}>{standing.wins} wins · {standing.matches} matches · {standing.kills} kills</Text>
                      </View>
                      <Text style={styles.score}>{standing.points.toLocaleString("en-IN")} coins</Text>
                    </View>
                  ))}
                </View>
              )}

              {period.standings.length > 0 && (
                <View style={styles.payoutPanel}>
                  <Text style={styles.listHeading}>EXTRA COIN PAYOUTS</Text>
                  <Text style={styles.payoutHint}>Set a unique rank and a whole-number coin amount for each prize.</Text>
                  {draftsForPeriod.map((entry, index) => (
                    <View key={`${period.id}-${index}`} style={styles.payoutRow}>
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>RANK</Text>
                        <Input
                          value={entry.rank}
                          onChangeText={(value) => updateDraft(period, index, "rank", value)}
                          placeholder="1"
                          keyboardType="number-pad"
                          style={styles.rankInput}
                        />
                      </View>
                      <View style={[styles.inputGroup, { flex: 1 }]}>
                        <Text style={styles.inputLabel}>COINS</Text>
                        <Input
                          value={entry.coins}
                          onChangeText={(value) => updateDraft(period, index, "coins", value)}
                          placeholder="Enter amount"
                          keyboardType="number-pad"
                          style={styles.coinsInput}
                        />
                      </View>
                      {draftsForPeriod.length > 1 && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove payout for row ${index + 1}`}
                          onPress={() => removePayout(period, index)}
                          style={styles.removeButton}
                        >
                          <Feather name="x" size={16} color={A.red} />
                        </Pressable>
                      )}
                    </View>
                  ))}
                  {draftsForPeriod.length < 10 && (
                    <Pressable onPress={() => addPayout(period)} style={styles.addButton}>
                      <Feather name="plus" size={14} color={A.gold} />
                      <Text style={styles.addButtonText}>ADD PRIZE PLACE</Text>
                    </Pressable>
                  )}
                </View>
              )}

              <View style={styles.approveButton}>
                <Btn
                  title={period.standings.length > 0 ? "APPROVE & PAY SELECTED PLACES" : "FINALIZE EMPTY CYCLE"}
                  onPress={() => approve(period)}
                  disabled={isApproving}
                  loading={isBusy}
                  kind="gold"
                />
              </View>
            </Card>
          );
        })
      )}
    </ScreenWrap>
  );
}

const styles = StyleSheet.create({
  periodCard: { marginBottom: 14, gap: 10 },
  periodHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  periodTitleGroup: { flexDirection: "row", alignItems: "center", gap: 9, flex: 1 },
  iconBox: { width: 36, height: 36, borderRadius: 11, borderWidth: 1, borderColor: A.gold + "55", backgroundColor: A.gold + "12", alignItems: "center", justifyContent: "center" },
  cycleName: { color: A.text, fontSize: 14, fontWeight: "900", letterSpacing: 0.7 },
  periodDates: { color: A.sub, fontSize: 10, marginTop: 3 },
  pendingTag: { borderRadius: 8, borderWidth: 1, borderColor: A.orange + "66", backgroundColor: A.orange + "12", paddingHorizontal: 8, paddingVertical: 5 },
  pendingTagText: { color: A.orange, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  explanation: { color: A.sub, fontSize: 11, lineHeight: 16 },
  standings: { marginTop: 3, gap: 6 },
  listHeading: { color: A.gold, fontSize: 9, fontWeight: "900", letterSpacing: 0.9, marginBottom: 2 },
  standingRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: A.border, backgroundColor: "#0c111a" },
  rank: { color: A.gold, width: 31, fontSize: 12, fontWeight: "900" },
  playerName: { color: A.text, fontSize: 11, fontWeight: "800" },
  playerStats: { color: A.sub, fontSize: 9, marginTop: 3 },
  score: { color: A.green, fontSize: 10, fontWeight: "900" },
  payoutPanel: { marginTop: 2, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: A.border, backgroundColor: "#0d1118" },
  payoutHint: { color: A.sub, fontSize: 10, lineHeight: 14, marginBottom: 8 },
  payoutRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 8 },
  inputGroup: { width: 74 },
  inputLabel: { color: A.sub, fontSize: 8, fontWeight: "800", letterSpacing: 0.8, marginBottom: 4 },
  rankInput: { minHeight: 40, textAlign: "center" },
  coinsInput: { minHeight: 40 },
  removeButton: { width: 34, height: 40, borderRadius: 9, borderWidth: 1, borderColor: A.red + "55", alignItems: "center", justifyContent: "center" },
  addButton: { alignSelf: "flex-start", minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1, borderColor: A.gold + "55" },
  addButtonText: { color: A.gold, fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  approveButton: { marginTop: 2 },
  errorCard: { marginBottom: 12, borderColor: A.red + "55" },
  errorText: { color: A.red, fontSize: 12, lineHeight: 17 },
});