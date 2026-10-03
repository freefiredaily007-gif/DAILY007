import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useDaily007ListLeaderboards } from "@workspace/api-client-react";
import { ReadableText as Text } from "../components/typography";
import { C, Card, Empty, Loading } from "../components/ui";
import { apiError } from "../lib/api";

type CycleType = "weekly" | "monthly";

const TROPHY_RANKS = [
  { id: "gold", label: "🥇 RANK #1  |  🏆 GOLD TROPHY", color: C.gold },
  { id: "silver", label: "🥈 RANK #2  |  🥈 SILVER TROPHY", color: C.sub },
  { id: "bronze", label: "🥉 RANK #3  |  🥉 BRONZE TROPHY", color: C.orange },
] as const;

export default function HomeLeaderboards({
  refreshKey,
  onOpen,
}: {
  refreshKey: number;
  onOpen: (cycle: CycleType) => void;
}) {
  const query = useDaily007ListLeaderboards();
  const [cycle, setCycle] = useState<CycleType>("weekly");
  const lastRefreshKey = useRef(refreshKey);
  const refetchRef = useRef(query.refetch);
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

  return (
    <View style={styles.section}>
      <Card style={styles.card}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${cycle} leaderboard rewards`}
            testID="open-leaderboard-rewards"
            onPress={() => onOpen(cycle)}
            style={{ flex: 1 }}
          >
            <Text style={styles.title}>⚡ LEADERBOARD REWARDS</Text>
            <Text style={styles.subtitle}>
              Climb the Ranks &amp; Claim Big Coin Prizes Every Week &amp; Month!
            </Text>
          </Pressable>
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
            <Pressable
              key={rank.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${cycle} leaderboard rankings`}
              testID={`open-leaderboard-${rank.id}`}
              onPress={() => onOpen(cycle)}
              style={({ pressed }) => [styles.trophyRow, pressed && { opacity: 0.8 }]}
            >
              <Text numberOfLines={1} style={[styles.trophyRowText, { color: rank.color }]}>
                {rank.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View top 20 players"
          testID="open-top-20-leaderboard"
          onPress={() => onOpen(cycle)}
          style={({ pressed }) => [
            styles.expandButton,
            { borderColor: color + "66", opacity: pressed ? 0.78 : 1 },
          ]}
        >
          <Text style={[styles.expandText, { color }]}>VIEW TOP 20 PLAYERS</Text>
          <Feather name="chevron-down" size={16} color={color} />
        </Pressable>
      </Card>
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
});