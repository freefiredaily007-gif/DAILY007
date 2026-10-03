import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ReadableText as Text } from "../components/typography";
import { C, Card } from "../components/ui";

const TROPHY_RANKS = [
  { id: "gold", label: "🥇 RANK #1  |  🏆 GOLD TROPHY", color: C.gold },
  { id: "silver", label: "🥈 RANK #2  |  🥈 SILVER TROPHY", color: C.sub },
  { id: "bronze", label: "🥉 RANK #3  |  🥉 BRONZE TROPHY", color: C.orange },
] as const;

export default function HomeLeaderboards({ onOpen }: { onOpen: () => void }) {
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open leaderboard rewards"
        testID="open-leaderboard-rewards"
        onPress={onOpen}
        style={({ pressed }) => pressed && { opacity: 0.92 }}
      >
        <Card style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>⚡ LEADERBOARD REWARDS</Text>
            <Text style={styles.subtitle}>
              Climb the Ranks &amp; Claim Big Coin Prizes Every Week &amp; Month!
            </Text>
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
        </Card>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 8, marginBottom: 2 },
  card: { marginHorizontal: 14, padding: 13 },
  header: { marginBottom: 12 },
  title: { color: C.gold, fontSize: 16, fontWeight: "900", letterSpacing: 0.5 },
  subtitle: { color: C.sub, fontSize: 11, lineHeight: 15, marginTop: 5 },
  trophyRows: { gap: 7, marginBottom: 11 },
  trophyRow: { minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg2 },
  trophyRowText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.25 },
});