import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  useDaily007AdminApproveLeaderboardPeriod,
  useDaily007AdminGetLeaderboardApprovals,
  useDaily007AdminGetLeaderboardRewards,
  useDaily007AdminUpdateLeaderboardRewards,
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

type RewardAmounts = {
  firstPlaceCoins: number;
  secondPlaceCoins: number;
  thirdPlaceCoins: number;
};
type RewardSchedule = RewardAmounts & {
  currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null;
};
type RewardsResponse = { weekly: RewardSchedule; monthly: RewardSchedule };
type LeaderboardStanding = {
  rank: number;
  userId: string;
  name: string;
  points: number;
};
type LeaderboardReward = { rank: number; coins: number };
type ApprovalPeriod = {
  id: string;
  cycleType: "weekly" | "monthly";
  status: string;
  startsAt: string;
  endsAt: string;
  standings: LeaderboardStanding[];
  rewards: LeaderboardReward[];
};
type ApprovalsResponse = { periods: ApprovalPeriod[] };
type ApprovalResult = {
  periodId: string;
  cycleType: "weekly" | "monthly";
  alreadyApproved: boolean;
  payouts: {
    rank: number;
    userId: string;
    name: string;
    coins: number;
    balanceAfter: number;
  }[];
};
type RewardDraft = Record<keyof RewardAmounts, string>;
type Drafts = { weekly: RewardDraft; monthly: RewardDraft };

const EMPTY_DRAFT: RewardDraft = {
  firstPlaceCoins: "0",
  secondPlaceCoins: "0",
  thirdPlaceCoins: "0",
};

const PLACES: { key: keyof RewardAmounts; label: string }[] = [
  { key: "firstPlaceCoins", label: "1ST PLACE" },
  { key: "secondPlaceCoins", label: "2ND PLACE" },
  { key: "thirdPlaceCoins", label: "3RD PLACE" },
];

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(date));
}

function periodRange(startsAt: string | null, endsAt: string | null): string | null {
  if (!startsAt || !endsAt) return null;
  const lastDay = new Date(Date.parse(endsAt) - 1);
  return `${formatDate(startsAt)} – ${formatDate(lastDay.toISOString())} IST`;
}

function toDraft(data?: RewardsResponse): Drafts {
  if (!data) return { weekly: { ...EMPTY_DRAFT }, monthly: { ...EMPTY_DRAFT } };
  return {
    weekly: {
      firstPlaceCoins: String(data.weekly.firstPlaceCoins),
      secondPlaceCoins: String(data.weekly.secondPlaceCoins),
      thirdPlaceCoins: String(data.weekly.thirdPlaceCoins),
    },
    monthly: {
      firstPlaceCoins: String(data.monthly.firstPlaceCoins),
      secondPlaceCoins: String(data.monthly.secondPlaceCoins),
      thirdPlaceCoins: String(data.monthly.thirdPlaceCoins),
    },
  };
}

export default function AdminLeaderboards() {
  const rewardsQuery = useDaily007AdminGetLeaderboardRewards();
  const refetchRef = useRef(rewardsQuery.refetch);
  const approvalsQuery = useDaily007AdminGetLeaderboardApprovals();
  const approvalsRef = useRef(approvalsQuery.refetch);
  const { mutateAsync: saveRewards, isPending: isSaving } =
    useDaily007AdminUpdateLeaderboardRewards();
  const { mutateAsync: approvePeriod, isPending: isApproving } =
    useDaily007AdminApproveLeaderboardPeriod();
  const toast = useToast();
  const [drafts, setDrafts] = useState<Drafts>(() => toDraft());
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [confirmingPeriodId, setConfirmingPeriodId] = useState<string | null>(null);
  const [lastApproval, setLastApproval] = useState<ApprovalResult | null>(null);
  const data = rewardsQuery.data as unknown as RewardsResponse | undefined;
  const approvals = approvalsQuery.data as unknown as ApprovalsResponse | undefined;

  useEffect(() => {
    refetchRef.current = rewardsQuery.refetch;
  }, [rewardsQuery.refetch]);

  useEffect(() => {
    approvalsRef.current = approvalsQuery.refetch;
  }, [approvalsQuery.refetch]);

  useEffect(() => {
    const timer = setInterval(() => {
      void refetchRef.current();
      void approvalsRef.current();
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!data || dirty) return;
    setDrafts(toDraft(data));
  }, [data, dirty]);

  const updateAmount = (
    cycleType: "weekly" | "monthly",
    key: keyof RewardAmounts,
    value: string,
  ) => {
    setDirty(true);
    setDrafts((previous) => ({
      ...previous,
      [cycleType]: {
        ...previous[cycleType],
        [key]: value.replace(/[^0-9]/g, ""),
      },
    }));
  };

  const save = async () => {
    const payload = {
      weekly: { firstPlaceCoins: 0, secondPlaceCoins: 0, thirdPlaceCoins: 0 },
      monthly: { firstPlaceCoins: 0, secondPlaceCoins: 0, thirdPlaceCoins: 0 },
    };

    for (const cycleType of ["weekly", "monthly"] as const) {
      for (const { key } of PLACES) {
        const raw = drafts[cycleType][key];
        const coins = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(coins) || coins > 2_147_483_647) {
          setError("Enter a whole coin amount from 0 to 2147483647 for every place.");
          return;
        }
        payload[cycleType][key] = coins;
      }
    }

    setError("");
    try {
      await saveRewards({ data: payload });
      const refreshed = await rewardsQuery.refetch();
      const refreshedData = refreshed.data as unknown as RewardsResponse | undefined;
      setDrafts(toDraft(refreshedData ?? data));
      setDirty(false);
      toast("Rewards saved for the open and future cycles.", "success");
    } catch (cause) {
      setError(apiError(cause));
    }
  };

  const approve = async (periodId: string) => {
    setError("");
    try {
      const result = await approvePeriod({ periodId });
      const approval = result as unknown as ApprovalResult;
      setLastApproval(approval);
      setConfirmingPeriodId(null);
      await approvalsQuery.refetch();
      toast(
        approval.alreadyApproved
          ? "This cycle was already approved; no additional coins were credited."
          : `${approval.cycleType} leaderboard payout approved.`,
        "success",
      );
    } catch (cause) {
      setError(apiError(cause));
    }
  };

  return (
    <ScreenWrap onRefresh={() => {
      void rewardsQuery.refetch();
      void approvalsQuery.refetch();
    }}>
      <SectionTitle
        title="Leaderboard rewards"
        sub="Full Admin only · set rewards and approve completed cycles"
        icon="award"
      />

      {error ? (
        <Card style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </Card>
      ) : null}

      {rewardsQuery.isLoading && !data ? (
        <Loading />
      ) : rewardsQuery.error && !data ? (
        <Empty text={`Could not load leaderboard rewards: ${apiError(rewardsQuery.error)}`} />
      ) : (
        <>
          <SectionTitle
            title="Pending cycle payouts"
            sub="Review the locked standings and configured rewards before approving."
            icon="check-circle"
          />
          {approvalsQuery.isLoading && !approvals ? (
            <Loading />
          ) : approvalsQuery.error && !approvals ? (
            <Card style={styles.errorCard}>
              <Text style={styles.errorText}>
                Could not load pending payouts: {apiError(approvalsQuery.error)}
              </Text>
            </Card>
          ) : approvals?.periods.length ? (
            approvals.periods.map((period) => {
              const confirming = confirmingPeriodId === period.id;
              return (
                <Card key={period.id} style={styles.approvalCard}>
                  <View style={styles.periodHeader}>
                    <View style={styles.periodTitleGroup}>
                      <View style={styles.iconBox}>
                        <Feather name="award" size={17} color={A.gold} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cycleName}>
                          {period.cycleType.toUpperCase()} PAYOUT
                        </Text>
                        <Text style={styles.periodDates}>
                          {periodRange(period.startsAt, period.endsAt)}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.pendingTag}>
                      <Text style={styles.pendingTagText}>REVIEW</Text>
                    </View>
                  </View>
                  {period.rewards.map((reward) => {
                    const standing = period.standings.find(
                      (candidate) => candidate.rank === reward.rank,
                    );
                    return (
                      <View key={reward.rank} style={styles.payoutRow}>
                        <Text style={styles.payoutRank}>#{reward.rank}</Text>
                        <Text style={styles.payoutPlayer}>
                          {standing?.name ?? "No player at this rank"}
                          {standing ? ` · ${standing.points.toLocaleString()} pts` : ""}
                        </Text>
                        <Text style={styles.payoutCoins}>
                          {reward.coins > 0 && standing
                            ? `${reward.coins.toLocaleString()} coins`
                            : "No payout"}
                        </Text>
                      </View>
                    );
                  })}
                  <Text style={styles.approvalNote}>
                    Approval locks this cycle and credits only configured ranks with a player.
                  </Text>
                  {confirming ? (
                    <>
                      <Text style={styles.confirmNote}>
                        Confirm to finalize these standings and pay the displayed rewards.
                      </Text>
                      <View style={styles.approvalActions}>
                        <View style={styles.actionButton}>
                          <Btn
                            title="CANCEL"
                            onPress={() => setConfirmingPeriodId(null)}
                            disabled={isApproving}
                          />
                        </View>
                        <View style={styles.actionButton}>
                          <Btn
                            title="CONFIRM & PAY"
                            onPress={() => void approve(period.id)}
                            disabled={isApproving}
                            loading={isApproving}
                            kind="gold"
                          />
                        </View>
                      </View>
                    </>
                  ) : (
                    <Btn
                      title="REVIEW APPROVAL"
                      onPress={() => setConfirmingPeriodId(period.id)}
                      disabled={isApproving}
                      kind="gold"
                    />
                  )}
                </Card>
              );
            })
          ) : (
            <Card style={styles.emptyApprovalCard}>
              <Text style={styles.explanation}>No weekly or monthly cycles are waiting for approval.</Text>
            </Card>
          )}

          {lastApproval ? (
            <Card style={styles.resultCard}>
              <Text style={styles.resultTitle}>
                {lastApproval.cycleType.toUpperCase()} APPROVAL RESULT
              </Text>
              {lastApproval.alreadyApproved ? (
                <Text style={styles.explanation}>
                  This cycle was already finalized. No additional coins were credited.
                </Text>
              ) : lastApproval.payouts.length ? (
                lastApproval.payouts.map((payout) => (
                  <View key={payout.rank} style={styles.payoutRow}>
                    <Text style={styles.payoutPlayer}>
                      #{payout.rank} · {payout.name}
                    </Text>
                    <Text style={styles.payoutCoins}>
                      +{payout.coins.toLocaleString()} · balance {payout.balanceAfter.toLocaleString()}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.explanation}>No configured rank rewards were paid.</Text>
              )}
            </Card>
          ) : null}

          {(["weekly", "monthly"] as const).map((cycleType) => {
            const schedule = data?.[cycleType];
            const currentRange = periodRange(
              schedule?.currentPeriodStartsAt ?? null,
              schedule?.currentPeriodEndsAt ?? null,
            );
          return (
            <Card key={cycleType} style={styles.periodCard}>
              <View style={styles.periodHeader}>
                <View style={styles.periodTitleGroup}>
                  <View style={styles.iconBox}>
                    <Feather name="award" size={17} color={A.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cycleName}>{cycleType.toUpperCase()} REWARDS</Text>
                    <Text style={styles.periodDates}>
                      {currentRange ? `Open cycle · ${currentRange}` : "Applies to the next cycle"}
                    </Text>
                  </View>
                </View>
                <View style={styles.activeTag}>
                  <Text style={styles.activeTagText}>{currentRange ? "LIVE" : "NEXT"}</Text>
                </View>
              </View>

              <Text style={styles.explanation}>
                Configure rewards before this cycle ends. Changes apply to its open period and carry forward to future {cycleType} periods. At cycle end, standings are locked and rewards wait for Full Admin approval.
              </Text>

              <View style={styles.rewardFields}>
                {PLACES.map(({ key, label }) => (
                  <View key={key} style={styles.rewardField}>
                    <Text style={styles.inputLabel}>{label} · COINS</Text>
                    <Input
                      value={drafts[cycleType][key]}
                      onChangeText={(value) => updateAmount(cycleType, key, value)}
                      placeholder="0"
                      keyboardType="number-pad"
                      maxLength={10}
                      accessibilityLabel={`${cycleType} ${label.toLowerCase()} reward coins`}
                    />
                  </View>
                ))}
              </View>
              <Text style={styles.payoutHint}>Enter 0 to disable a place reward.</Text>
            </Card>
          );
          })}
          <View style={styles.saveButton}>
            <Btn
              title="SAVE REWARD SETTINGS"
              onPress={() => void save()}
              disabled={!dirty || isSaving}
              loading={isSaving}
              kind="gold"
            />
          </View>
        </>
      )}
    </ScreenWrap>
  );
}

const styles = StyleSheet.create({
  periodCard: { marginBottom: 14, gap: 10 },
  approvalCard: { marginBottom: 14, gap: 10 },
  emptyApprovalCard: { marginBottom: 18 },
  resultCard: { marginBottom: 18, gap: 9, borderColor: A.green + "55" },
  periodHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  periodTitleGroup: { flexDirection: "row", alignItems: "center", gap: 9, flex: 1 },
  iconBox: { width: 36, height: 36, borderRadius: 11, borderWidth: 1, borderColor: A.gold + "55", backgroundColor: A.gold + "12", alignItems: "center", justifyContent: "center" },
  cycleName: { color: A.text, fontSize: 14, fontWeight: "900", letterSpacing: 0.7 },
  periodDates: { color: A.sub, fontSize: 10, marginTop: 3 },
  activeTag: { borderRadius: 8, borderWidth: 1, borderColor: A.green + "66", backgroundColor: A.green + "12", paddingHorizontal: 8, paddingVertical: 5 },
  activeTagText: { color: A.green, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  pendingTag: { borderRadius: 8, borderWidth: 1, borderColor: A.gold + "66", backgroundColor: A.gold + "12", paddingHorizontal: 8, paddingVertical: 5 },
  pendingTagText: { color: A.gold, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  explanation: { color: A.sub, fontSize: 11, lineHeight: 16 },
  approvalNote: { color: A.sub, fontSize: 10, lineHeight: 15, marginTop: 2 },
  confirmNote: { color: A.gold, fontSize: 11, lineHeight: 16 },
  payoutRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: A.border },
  payoutRank: { color: A.gold, fontSize: 11, fontWeight: "900", width: 22 },
  payoutPlayer: { color: A.text, fontSize: 11, fontWeight: "700", flex: 1 },
  payoutCoins: { color: A.green, fontSize: 10, fontWeight: "900", textAlign: "right" },
  approvalActions: { flexDirection: "row", gap: 8 },
  actionButton: { flex: 1 },
  resultTitle: { color: A.green, fontSize: 12, fontWeight: "900", letterSpacing: 0.7 },
  rewardFields: { gap: 10 },
  rewardField: { gap: 5 },
  inputLabel: { color: A.sub, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  payoutHint: { color: A.sub, fontSize: 10, lineHeight: 14 },
  saveButton: { marginTop: 2, marginBottom: 18 },
  errorCard: { marginBottom: 12, borderColor: A.red + "55" },
  errorText: { color: A.red, fontSize: 12, lineHeight: 17 },
});