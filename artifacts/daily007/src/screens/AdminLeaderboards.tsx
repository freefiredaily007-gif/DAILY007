import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
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
  const { mutateAsync: saveRewards, isPending: isSaving } =
    useDaily007AdminUpdateLeaderboardRewards();
  const toast = useToast();
  const [drafts, setDrafts] = useState<Drafts>(() => toDraft());
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const data = rewardsQuery.data as unknown as RewardsResponse | undefined;

  useEffect(() => {
    refetchRef.current = rewardsQuery.refetch;
  }, [rewardsQuery.refetch]);

  useEffect(() => {
    const timer = setInterval(() => void refetchRef.current(), 60_000);
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

  return (
    <ScreenWrap onRefresh={() => rewardsQuery.refetch()}>
      <SectionTitle
        title="Leaderboard rewards"
        sub="Full Admin only · set automatic weekly and monthly prizes"
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
                Configure rewards before this cycle ends. Changes apply to its open period and carry forward to future {cycleType} periods. Winners are credited automatically at cycle end.
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
  periodHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  periodTitleGroup: { flexDirection: "row", alignItems: "center", gap: 9, flex: 1 },
  iconBox: { width: 36, height: 36, borderRadius: 11, borderWidth: 1, borderColor: A.gold + "55", backgroundColor: A.gold + "12", alignItems: "center", justifyContent: "center" },
  cycleName: { color: A.text, fontSize: 14, fontWeight: "900", letterSpacing: 0.7 },
  periodDates: { color: A.sub, fontSize: 10, marginTop: 3 },
  activeTag: { borderRadius: 8, borderWidth: 1, borderColor: A.green + "66", backgroundColor: A.green + "12", paddingHorizontal: 8, paddingVertical: 5 },
  activeTagText: { color: A.green, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  explanation: { color: A.sub, fontSize: 11, lineHeight: 16 },
  rewardFields: { gap: 10 },
  rewardField: { gap: 5 },
  inputLabel: { color: A.sub, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  payoutHint: { color: A.sub, fontSize: 10, lineHeight: 14 },
  saveButton: { marginTop: 2, marginBottom: 18 },
  errorCard: { marginBottom: 12, borderColor: A.red + "55" },
  errorText: { color: A.red, fontSize: 12, lineHeight: 17 },
});