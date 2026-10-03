import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useDaily007ListLeaderboards } from "@workspace/api-client-react";
import { ReadableText as Text } from "../components/typography";
import { C, Card, Empty, Loading } from "../components/ui";
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
type Period = {
  id: string;
  cycleType: CycleType;
  status: "active" | "pending_approval" | "pending_activation" | "finalized";
  startsAt: string;
  endsAt: string;
  standings: Standing[];
  rewards?: { rank: number; coins: number }[];
};

const TROPHY_RANKS = [
  { id: "gold", label: "🥇 RANK #1  |  🏆 GOLD TROPHY", color: C.gold },
  { id: "silver", label: "🥈 RANK #2  |  🥈 SILVER TROPHY", color: C.sub },
  { id: "bronze", label: "🥉 RANK #3  |  🥉 BRONZE TROPHY", color: C.orange },
] as const;

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

function statusLabel(status: Period["status"]): string {
  return status === "finalized" ? "FINISHED" : "LIVE";
}

export default function HomeLeaderboards({
  refreshKey,
}: {
  refreshKey: number;
}) {
  const query = useDaily007ListLeaderboards();
  const [cycle, setCycle] = useState<CycleType>("weekly");
  const [showTop20, setShowTop20] = useState(false);
  const lastRefreshKey = useRef(refreshKey);
  const refetchRef = useRef(query.refetch);
  const data = query.data as unknown as {
    weekly?: Period;
    monthly?: Period;
  } | undefined;
  const period = data?.[cycle];
  const color = cycle === "weekly" ? C.blue : C.purple;

  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return;
    lastRefreshKey.current = refreshKey;
    void query.refetch();
  }, [query.refetch, refreshKey]);

  useEffect(() => {
    refetchRef.current = query.refetch;
  }, [query.refetch]);

  useEffect(() => {
    const timer = setInterval(() => void refetchRef.current(), 60_000);
    return () => clearInterval(timer);
  }, []);

  const topStandings = period?.standings.slice(0, 20) ?? [];

  return (
    <View style={styles.section}>
      <Card style={styles.card}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>⚡ LEADERBOARD REWARDS</Text>
            <Text style={styles.subtitle}>
              Climb the Ranks &amp; Claim Big Coin Prizes Every Week &amp; Month!
            </Text>
          </View>
          <Pressable
            onPress={() => void query.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Refresh leaderboards"
            testID="refresh-leaderboards"
            hitSlop={10}
            style={styles.refresh}
          >
            <Feather name="refresh-cw" size={16} color={C.gold} />
          </Pressable>
        </View>

        <View style={styles.tabs}>
          {(["weekly", "monthly"] as const).map((key) => {
            const selected = cycle === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${key} leaderboard`}
                testID={`leaderboard-tab-${key}`}
                onPress={() => setCycle(key)}
                style={[
                  styles.tab,
                  selected && {
                    borderColor: key === "weekly" ? C.blue : C.purple,
                    backgroundColor: key === "weekly" ? C.blue + "1b" : C.purple + "1b",
                  },
                ]}
              >
                <Text style={[styles.tabText, selected && { color: key === "weekly" ? C.blue : C.purple }]}>
                  {key === "weekly" ? "WEEKLY" : "MONTHLY"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.trophyRows}>
          {TROPHY_RANKS.map((rank) => (
            <View key={rank.id} style={styles.trophyRow}>
              <Text numberOfLines={1} style={[styles.trophyRowText, { color: rank.color }]}>
                {rank.label}
              </Text>
            </View>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showTop20 }}
          accessibilityLabel={showTop20 ? "Hide top 20 players" : "View top 20 players"}
          testID="toggle-top-20-leaderboard"
          onPress={() => setShowTop20((visible) => !visible)}
          style={({ pressed }) => [
            styles.expandButton,
            { borderColor: color + "66", opacity: pressed ? 0.78 : 1 },
          ]}
        >
          <Text style={[styles.expandText, { color }]}>
            {showTop20 ? "HIDE TOP 20 PLAYERS" : "VIEW TOP 20 PLAYERS"}
          </Text>
          <Feather name={showTop20 ? "chevron-up" : "chevron-down"} size={16} color={color} />
        </Pressable>

        {showTop20 && (
          <View style={styles.expandedLeaderboard}>
            <Text style={styles.listTitle}>{cycle.toUpperCase()} TOP 20 PLAYERS</Text>
            {query.isLoading ? (
              <Loading />
            ) : query.error && !period ? (
              <Empty text={`Leaderboard is unavailable: ${apiError(query.error)}`} />
            ) : !period ? (
              <Empty text="Leaderboard data is not available yet." />
            ) : (
              <>
                <View style={styles.periodMeta}>
                  <View style={[styles.statusDot, { backgroundColor: period.status === "active" ? C.green : C.gold }]} />
                  <Text style={[styles.status, { color: period.status === "active" ? C.green : C.gold }]}>
                    {statusLabel(period.status)}
                  </Text>
                </View>
                <Text style={styles.range}>{dateRange(period)}</Text>
                {period.status === "finalized" && (
                  <Text style={styles.pendingHint}>
                    This cycle is complete. Its configured rewards were credited automatically.
                  </Text>
                )}

                {topStandings.length === 0 ? (
                  <Empty text="No match awards yet this cycle. Scores update when tournament results are published." />
                ) : (
                  <View style={styles.rows}>
                    {topStandings.map((standing) => (
                      <StandingRow
                        key={standing.userId}
                        standing={standing}
                        color={color}
                        rewardCoins={period.rewards?.find((reward) => reward.rank === standing.rank)?.coins ?? 0}
                      />
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        )}
      </Card>
    </View>
  );
}

function StandingRow({
  standing,
  color,
  rewardCoins,
}: {
  standing: Standing;
  color: string;
  rewardCoins: number;
}) {
  return (
    <View style={styles.row}>
      <View style={[styles.rank, { borderColor: color + "66" }]}>
        <Text style={[styles.rankText, { color }]}>#{standing.rank}</Text>
      </View>
      <View style={styles.player}>
        <Text numberOfLines={1} style={styles.playerName}>{standing.name}</Text>
        <Text style={styles.playerStats}>{standing.wins} wins · {standing.matches} matches · {standing.kills} kills</Text>
      </View>
      <View style={styles.score}>
        <Text style={[styles.points, { color }]}>{standing.points.toLocaleString("en-IN")}</Text>
        <Text style={styles.scoreLabel}>COINS</Text>
        <Text style={styles.prize}>
          {rewardCoins > 0 ? `${rewardCoins.toLocaleString("en-IN")} PRIZE` : "NO PRIZE"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 8, marginBottom: 2 },
  card: { marginHorizontal: 14, padding: 13 },
  header: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  title: { color: C.gold, fontSize: 16, fontWeight: "900", letterSpacing: 0.5 },
  subtitle: { color: C.sub, fontSize: 11, lineHeight: 15, marginTop: 5 },
  refresh: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 12 },
  tab: { flex: 1, minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card2, alignItems: "center", justifyContent: "center" },
  tabText: { color: C.sub, fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
  trophyRows: { gap: 7, marginBottom: 11 },
  trophyRow: { minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg2 },
  trophyRowText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.25 },
  expandButton: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10, borderWidth: 1, backgroundColor: C.card2 },
  expandText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.7 },
  expandedLeaderboard: { marginTop: 12 },
  listTitle: { color: C.text, fontSize: 12, fontWeight: "900", letterSpacing: 0.9, marginBottom: 9 },
  periodMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  status: { fontSize: 9, fontWeight: "900", letterSpacing: 0.75 },
  range: { color: C.sub, fontSize: 11, marginTop: 4, marginBottom: 8 },
  pendingHint: { color: C.gold, fontSize: 10, lineHeight: 15, marginBottom: 8 },
  rows: { gap: 7, marginTop: 4 },
  row: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 9, padding: 9, borderRadius: 11, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg2 },
  rank: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rankText: { fontSize: 11, fontWeight: "900" },
  player: { flex: 1, minWidth: 0 },
  playerName: { color: C.text, fontSize: 12, fontWeight: "800" },
  playerStats: { color: C.sub, fontSize: 9, marginTop: 3 },
  score: { minWidth: 60, alignItems: "flex-end" },
  points: { fontSize: 15, fontWeight: "900" },
  scoreLabel: { color: C.dim, fontSize: 8, fontWeight: "800", letterSpacing: 0.7, marginTop: 2 },
  prize: { color: C.gold, fontSize: 8, fontWeight: "900", letterSpacing: 0.5, marginTop: 4 },
});