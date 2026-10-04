import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  getDaily007ListLeaderboardsQueryKey,
  useDaily007ListLeaderboards,
} from "@workspace/api-client-react";
import { useFocusEffect } from "@react-navigation/native";
import { ReadableText as Text } from "../components/typography";
import { C, Loading } from "../components/ui";
import { apiError } from "../lib/api";

type CycleType = "weekly" | "monthly";
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
type RewardPayout = {
  rank: number;
  coins: number;
};
type Period = {
  cycleType: CycleType;
  status: "active" | "pending_approval" | "pending_activation" | "finalized";
  startsAt: string;
  endsAt: string;
  standings: Standing[];
  rewards: RewardPayout[];
};

const AVATAR_COLORS = [C.blue, C.purple, C.neon, C.green, C.orange];

function avatarColor(userId: string): string {
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(date));
}

function dateRange(period: Period): string {
  const lastDay = new Date(Date.parse(period.endsAt) - 1);
  return `${formatDate(period.startsAt)} – ${formatDate(lastDay.toISOString())} IST`;
}

function PodiumEntry({
  rank,
  standing,
}: {
  rank: 1 | 2 | 3;
  standing?: Standing;
}) {
  const color = rank === 1 ? C.gold : rank === 2 ? C.sub : C.orange;

  return (
    <View style={[styles.podiumEntry, rank === 1 && styles.podiumWinner]}>
      <View
        style={[
          styles.podiumAvatar,
          rank === 1 && styles.podiumAvatarWinner,
          { backgroundColor: standing ? avatarColor(standing.userId) : C.card },
        ]}
      >
        <Text style={[styles.podiumInitial, rank === 1 && styles.podiumInitialWinner]}>
          {standing ? initials(standing.name) : "—"}
        </Text>
      </View>
      <Text style={[styles.podiumRank, { color }]}>#{rank}</Text>
      <Text numberOfLines={1} style={styles.podiumName}>
        {standing?.name || "Awaiting player"}
      </Text>
      <View style={styles.podiumCoins}>
        <Text style={styles.coinEmoji}>🪙</Text>
        <Text style={styles.podiumCoinsText}>
          {standing ? standing.points.toLocaleString("en-IN") : "—"}
        </Text>
      </View>
    </View>
  );
}

function PlayerRow({
  standing,
  cycle,
}: {
  standing: Standing;
  cycle: CycleType;
}) {
  const color = cycle === "weekly" ? C.blue : C.purple;

  return (
    <View style={styles.playerRow} testID={`leaderboard-player-${standing.rank}`}>
      <Text style={[styles.playerRank, { color }]}>#{standing.rank}</Text>
      <View style={[styles.playerAvatar, { backgroundColor: avatarColor(standing.userId) }]}>
        <Text style={styles.playerInitial}>{initials(standing.name)}</Text>
      </View>
      <Text numberOfLines={1} style={styles.playerName}>{standing.name}</Text>
      <View style={styles.playerCoins}>
        <Text style={styles.coinEmoji}>🪙</Text>
        <Text style={styles.playerCoinsText}>{standing.points.toLocaleString("en-IN")}</Text>
      </View>
    </View>
  );
}

export default function LeaderboardDetails({ navigation, route }: any) {
  const query = useDaily007ListLeaderboards({
    query: {
      queryKey: getDaily007ListLeaderboardsQueryKey(),
      refetchInterval: 30_000,
      refetchOnMount: "always",
    },
  });
  useFocusEffect(
    React.useCallback(() => {
      void query.refetch();
    }, [query.refetch]),
  );
  const cycle: CycleType = route?.params?.cycleType === "monthly" ? "monthly" : "weekly";
  const data = query.data as unknown as {
    weekly?: Period;
    monthly?: Period;
  } | undefined;
  const period = data?.[cycle];
  const standings = period?.standings.slice(0, 20) ?? [];
  const podium = [
    { rank: 2 as const, standing: standings.find((standing) => standing.rank === 2) },
    { rank: 1 as const, standing: standings.find((standing) => standing.rank === 1) },
    { rank: 3 as const, standing: standings.find((standing) => standing.rank === 3) },
  ];
  const remainingPlayers = standings.filter((standing) => standing.rank > 3).slice(0, 17);
  const accent = cycle === "weekly" ? C.blue : C.purple;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        testID="leaderboard-details-scroll"
      >
        <View style={styles.tabs} accessibilityRole="tablist">
          {(["weekly", "monthly"] as const).map((key) => {
            const selected = cycle === key;
            const tabColor = key === "weekly" ? C.blue : C.purple;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${key} top 20 players`}
                testID={`leaderboard-details-tab-${key}`}
                onPress={() => navigation.setParams({ cycleType: key })}
                style={[
                  styles.tab,
                  selected && {
                    borderColor: tabColor,
                    backgroundColor: tabColor + "1b",
                  },
                ]}
              >
                <Text style={[styles.tabText, selected && { color: tabColor }]}>
                  {key === "weekly" ? "WEEKLY" : "MONTHLY"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {period?.rewards ? (
          <View
            style={styles.rewardsPanel}
            testID={`leaderboard-rewards-${cycle}`}
            accessibilityLabel={`${cycle} leaderboard rank rewards`}
          >
            <Text style={[styles.rewardsTitle, { color: accent }]}>
              {cycle === "weekly" ? "WEEKLY PRIZES" : "MONTHLY PRIZES"}
            </Text>
            {[1, 2, 3].map((rank) => {
              const coins = period.rewards.find((reward) => reward.rank === rank)?.coins ?? 0;
              const rankColor = rank === 1 ? C.gold : rank === 2 ? C.sub : C.orange;
              return (
                <View
                  key={rank}
                  style={styles.rewardRow}
                  testID={`leaderboard-reward-rank-${rank}`}
                >
                  <Text style={[styles.rewardRank, { color: rankColor }]}>Rank #{rank}</Text>
                  <Text style={styles.rewardAmount}>{coins.toLocaleString("en-IN")} Coins</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {query.isLoading ? (
          <Loading />
        ) : query.error && !period ? (
          <View style={styles.message}>
            <Feather name="alert-circle" size={28} color={C.red} />
            <Text style={styles.messageText}>{`Leaderboard is unavailable: ${apiError(query.error)}`}</Text>
          </View>
        ) : !period ? (
          <View style={styles.message}>
            <Feather name="award" size={30} color={accent} />
            <Text style={styles.messageText}>Leaderboard data is not available yet.</Text>
          </View>
        ) : standings.length === 0 ? (
          <View style={styles.message}>
            <Feather name="award" size={30} color={accent} />
            <Text style={styles.messageText}>
              No match awards yet this cycle. Rankings update when tournament results are published.
            </Text>
            <Text style={styles.range}>{dateRange(period)}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.range}>{dateRange(period)}</Text>
            <View style={styles.podiumPanel} testID="leaderboard-top-three">
              <View style={styles.podium}>
                {podium.map(({ rank, standing }) => (
                  <PodiumEntry key={rank} rank={rank} standing={standing} />
                ))}
              </View>
            </View>

            <View style={styles.columnHeader}>
              <Text style={styles.rankColumn}>RANK</Text>
              <Text style={styles.playerColumn}>PLAYER</Text>
              <Text style={styles.coinsColumn}>COINS</Text>
            </View>

            {remainingPlayers.length > 0 ? (
              <View style={styles.playerRows}>
                {remainingPlayers.map((standing) => (
                  <PlayerRow key={standing.userId} standing={standing} cycle={cycle} />
                ))}
              </View>
            ) : (
              <Text style={styles.noMorePlayers}>No additional ranked players yet.</Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 28 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 12 },
  rewardsPanel: {
    gap: 8,
    marginBottom: 14,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card2,
  },
  rewardsTitle: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  rewardRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  rewardRank: { fontSize: 12, fontWeight: "900" },
  rewardAmount: { color: C.text, fontSize: 12, fontWeight: "800" },
  tab: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card2,
    alignItems: "center",
    justifyContent: "center",
  },
  tabText: { color: C.sub, fontSize: 12, fontWeight: "900", letterSpacing: 0.8 },
  range: { color: C.text, fontSize: 14, fontWeight: "800", marginBottom: 10 },
  podiumPanel: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card2,
    marginBottom: 14,
  },
  podium: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  podiumEntry: {
    flex: 1,
    minWidth: 0,
    height: 174,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 3,
    paddingBottom: 5,
  },
  podiumWinner: {
    height: 192,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.gold + "55",
    paddingBottom: 8,
  },
  podiumAvatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 7,
  },
  podiumAvatarWinner: { width: 78, height: 78, borderRadius: 39, marginBottom: 8 },
  podiumInitial: { color: C.text, fontSize: 24, fontWeight: "700" },
  podiumInitialWinner: { fontSize: 32 },
  podiumRank: { fontSize: 10, fontWeight: "900", marginBottom: 7 },
  podiumName: { color: C.text, fontSize: 11, fontWeight: "800", maxWidth: "100%" },
  podiumCoins: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  coinEmoji: { fontSize: 13 },
  podiumCoinsText: { color: C.text, fontSize: 13, fontWeight: "900" },
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  rankColumn: { width: 42, color: C.sub, fontSize: 12, fontWeight: "900" },
  playerColumn: { flex: 1, color: C.sub, fontSize: 12, fontWeight: "900" },
  coinsColumn: { width: 88, color: C.sub, fontSize: 12, fontWeight: "900", textAlign: "right" },
  playerRows: { gap: 8 },
  playerRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  playerRank: { width: 42, fontSize: 13, fontWeight: "900" },
  playerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  playerInitial: { color: C.text, fontSize: 15, fontWeight: "800" },
  playerName: { flex: 1, minWidth: 0, color: C.text, fontSize: 13, fontWeight: "800" },
  playerCoins: { width: 88, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  playerCoinsText: { color: C.text, fontSize: 13, fontWeight: "900" },
  noMorePlayers: {
    paddingHorizontal: 10,
    paddingVertical: 18,
    borderRadius: 12,
    backgroundColor: C.card,
    color: C.sub,
    textAlign: "center",
    fontSize: 12,
  },
  message: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  messageText: { color: C.sub, fontSize: 13, lineHeight: 19, textAlign: "center" },
});