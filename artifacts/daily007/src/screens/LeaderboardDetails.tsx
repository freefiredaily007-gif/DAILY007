import React from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  getDaily007ListLeaderboardsQueryKey,
  useDaily007ListLeaderboards,
} from "@workspace/api-client-react";
import { useFocusEffect } from "@react-navigation/native";
import { ReadableText as Text } from "../components/typography";
import { C, Loading } from "../components/ui";
import { apiError } from "../lib/api";
import {
  LEADERBOARD_REFRESH_POLICY,
  getLeaderboardTopThreeUpdateAnnouncement,
  refetchLeaderboardOnFocus,
  selectLeaderboardTopThreeSnapshot,
  type LeaderboardTopThreeSnapshot,
} from "../lib/leaderboardRefreshPolicy";
import {
  leaderboardPlayerAccessibilityLabel,
  leaderboardPodiumAccessibilityLabel,
  selectLeaderboardPodiumRanks,
  selectLeaderboardExpandedRows,
  selectLeaderboardTopTwenty,
} from "../lib/leaderboardStandings";
import {
  getLeaderboardCycleFromRouteParam,
  handleLeaderboardCycleArrowKey,
  type LeaderboardCycle,
} from "../lib/leaderboardCycleNavigation";

type CycleType = LeaderboardCycle;
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
type WebKeyDownEvent = {
  nativeEvent: { key: string };
  preventDefault: () => void;
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
  largeText,
}: {
  rank: 1 | 2 | 3;
  standing?: Standing;
  largeText: boolean;
}) {
  const { width: screenWidth, fontScale } = useWindowDimensions();
  const podiumName = standing?.name || "Awaiting player";
  const textScale = Math.max(1, fontScale);
  const nameWidth = Math.max(80, screenWidth - 144);
  const charactersPerLine = Math.max(8, Math.floor(nameWidth / (13.64 * textScale * 0.52)));
  const estimatedNameLines = Math.max(
    1,
    Math.ceil(podiumName.length / charactersPerLine)
      + (podiumName.length > charactersPerLine && /\s/.test(podiumName) ? 1 : 0),
  );
  // Reserve room for the wrapped name plus its rank, score, and card padding.
  const largeTextMinHeight = Math.ceil(
    (12.4 + estimatedNameLines * 13.64 + 16.12) * textScale * 1.2
      + 8
      + (rank === 1 ? 24 : 20),
  );
  const color = rank === 1 ? C.gold : rank === 2 ? C.sub : C.orange;

  return (
    <View
      testID={`leaderboard-podium-${rank}`}
      accessible
      accessibilityRole="text"
      accessibilityLabel={leaderboardPodiumAccessibilityLabel(rank, standing)}
      style={[
        styles.podiumEntry,
        rank === 1 && styles.podiumWinner,
        largeText && styles.podiumEntryLarge,
        largeText && rank === 1 && styles.podiumWinnerLarge,
        largeText && { minHeight: largeTextMinHeight },
      ]}
    >
      <View
        style={[
          styles.podiumAvatar,
          rank === 1 && styles.podiumAvatarWinner,
          largeText && styles.podiumAvatarLarge,
          largeText && rank === 1 && styles.podiumAvatarWinnerLarge,
          { backgroundColor: standing ? avatarColor(standing.userId) : C.card },
        ]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text
          accessible={false}
          style={[
            styles.podiumInitial,
            rank === 1 && styles.podiumInitialWinner,
            largeText && styles.podiumInitialLarge,
            largeText && rank === 1 && styles.podiumInitialWinnerLarge,
          ]}
        >
          {standing ? initials(standing.name) : "—"}
        </Text>
      </View>
      {largeText ? (
        <View style={styles.podiumDetailsLarge}>
          <Text style={[styles.podiumRank, styles.podiumRankLarge, { color }]}>#{rank}</Text>
          <Text style={[styles.podiumName, styles.podiumNameLarge]}>
            {standing?.name || "Awaiting player"}
          </Text>
          <View style={[styles.podiumCoins, styles.podiumCoinsLarge]}>
            <Text accessible={false} style={styles.coinEmoji}>🪙</Text>
            <Text style={styles.podiumCoinsText}>
              {standing ? standing.points.toLocaleString("en-IN") : "—"}
            </Text>
          </View>
        </View>
      ) : (
        <>
          <Text style={[styles.podiumRank, { color }]}>#{rank}</Text>
          <Text style={styles.podiumName}>
            {standing?.name || "Awaiting player"}
          </Text>
          <View style={styles.podiumCoins}>
            <Text accessible={false} style={styles.coinEmoji}>🪙</Text>
            <Text style={styles.podiumCoinsText}>
              {standing ? standing.points.toLocaleString("en-IN") : "—"}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

function PlayerRow({
  standing,
  cycle,
  largeText,
  fontScale,
}: {
  standing: Standing;
  cycle: CycleType;
  largeText: boolean;
  fontScale: number;
}) {
  const color = cycle === "weekly" ? C.blue : C.purple;

  return (
    <View
      style={[styles.playerRow, largeText && styles.playerRowLarge]}
      testID={`leaderboard-player-${standing.rank}`}
      accessible
      accessibilityRole="text"
      accessibilityLabel={leaderboardPlayerAccessibilityLabel(standing)}
    >
      {largeText ? (
        <>
          <View style={styles.playerMainLarge}>
            <Text style={[styles.playerRank, styles.playerRankLarge, { color }]}>#{standing.rank}</Text>
            <View
              style={[styles.playerAvatar, styles.playerAvatarLarge, { backgroundColor: avatarColor(standing.userId) }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text style={[styles.playerInitial, styles.playerInitialLarge]}>{initials(standing.name)}</Text>
            </View>
            <Text style={[styles.playerName, styles.playerNameLarge]}>{standing.name}</Text>
          </View>
          <View style={styles.playerCoinsLarge}>
            <Text accessible={false} style={styles.coinEmoji}>🪙</Text>
            <Text style={styles.playerCoinsText}>
              {standing.points.toLocaleString("en-IN")} Coins
            </Text>
          </View>
        </>
      ) : (
        <>
          <Text style={[styles.playerRank, { color }]}>#{standing.rank}</Text>
          <View
            style={[styles.playerAvatar, { backgroundColor: avatarColor(standing.userId) }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={styles.playerInitial}>{initials(standing.name)}</Text>
          </View>
          <Text numberOfLines={fontScale <= 1 ? 1 : undefined} style={styles.playerName}>
            {standing.name}
          </Text>
          <View style={styles.playerCoins}>
            <Text accessible={false} style={styles.coinEmoji}>🪙</Text>
            <Text style={styles.playerCoinsText}>{standing.points.toLocaleString("en-IN")}</Text>
          </View>
        </>
      )}
    </View>
  );
}

export default function LeaderboardDetails(props: any) {
  const nativeTestFixture = __DEV__
    ? props.route?.params?.__nativeLeaderboardTestFixture
    : undefined;
  if (nativeTestFixture) {
    return (
      <LeaderboardDetailsContent
        {...props}
        query={{
          data: nativeTestFixture,
          error: null,
          isLoading: false,
          isRefetchError: false,
          refetch: async () => ({ data: nativeTestFixture }),
        }}
      />
    );
  }
  return <LiveLeaderboardDetails {...props} />;
}

function LiveLeaderboardDetails({ navigation, route }: any) {
  const query = useDaily007ListLeaderboards({
    query: {
      queryKey: getDaily007ListLeaderboardsQueryKey(),
      ...LEADERBOARD_REFRESH_POLICY,
    },
  });
  useFocusEffect(
    React.useCallback(() => {
      refetchLeaderboardOnFocus(query.refetch);
    }, [query.refetch]),
  );
  return <LeaderboardDetailsContent navigation={navigation} route={route} query={query} />;
}

function LeaderboardDetailsContent({ navigation, route, query }: any) {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.5;
  const [showTop20, setShowTop20] = React.useState(false);
  const [topThreeAnnouncement, setTopThreeAnnouncement] = React.useState("");
  const topThreeSnapshots = React.useRef<Partial<Record<CycleType, LeaderboardTopThreeSnapshot>>>({});
  const weeklyTabRef = React.useRef<React.ComponentRef<typeof Pressable> | null>(null);
  const monthlyTabRef = React.useRef<React.ComponentRef<typeof Pressable> | null>(null);
  const selectCycle = (nextCycle: CycleType) => {
    setShowTop20(false);
    navigation.setParams({ cycleType: nextCycle });
  };
  const cycle: CycleType = getLeaderboardCycleFromRouteParam(route?.params?.cycleType);
  const tablistKeyboardProps: {
    onKeyDown?: (event: WebKeyDownEvent) => void;
  } = Platform.OS === "web" ? {
    onKeyDown: (event) => {
      handleLeaderboardCycleArrowKey(cycle, event.nativeEvent.key, {
        preventDefault: () => event.preventDefault(),
        focusTab: (nextCycle) => {
          const nextTabRef = nextCycle === "weekly" ? weeklyTabRef : monthlyTabRef;
          nextTabRef.current?.focus();
        },
        selectCycle,
      });
    },
  } : {};
  const data = query.data as unknown as {
    weekly?: Period;
    monthly?: Period;
  } | undefined;
  const period = data?.[cycle];
  React.useEffect(() => {
    if (!period?.standings) return;

    const nextSnapshot = selectLeaderboardTopThreeSnapshot(period.standings);
    const previousSnapshot = topThreeSnapshots.current[cycle];
    topThreeSnapshots.current[cycle] = nextSnapshot;
    if (!previousSnapshot) return;

    const announcement = getLeaderboardTopThreeUpdateAnnouncement(previousSnapshot, nextSnapshot);
    if (!announcement) return;

    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibilityWithOptions(announcement, {
        queue: true,
        priority: "low",
      });
    } else {
      setTopThreeAnnouncement(announcement);
    }
  }, [cycle, period?.standings]);
  const standings = selectLeaderboardTopTwenty(period?.standings);
  const podium = selectLeaderboardPodiumRanks(largeText).map((rank) => ({
    rank,
    standing: standings.find((standing) => standing.rank === rank),
  }));
  const remainingPlayers = selectLeaderboardExpandedRows(standings);
  const accent = cycle === "weekly" ? C.blue : C.purple;

  return (
    <View style={styles.screen}>
      {topThreeAnnouncement ? (
        <Text
          accessible={false}
          accessibilityLiveRegion="polite"
          testID="leaderboard-top-three-update"
          style={styles.screenReaderAnnouncement}
        >
          {topThreeAnnouncement}
        </Text>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        testID="leaderboard-details-scroll"
      >
        <View
          {...tablistKeyboardProps}
          style={styles.tabs}
          accessibilityRole="tablist"
        >
          {(["weekly", "monthly"] as const).map((key) => {
            const selected = cycle === key;
            const tabColor = key === "weekly" ? C.blue : C.purple;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={key === "weekly" ? "Weekly leaderboard" : "Monthly leaderboard"}
                testID={`leaderboard-details-tab-${key}`}
                ref={key === "weekly" ? weeklyTabRef : monthlyTabRef}
                tabIndex={Platform.OS === "web" ? (selected ? 0 : -1) : undefined}
                onPress={() => selectCycle(key)}
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

        {query.isRefetchError && period ? (
          <Text
            accessible
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            testID="leaderboard-stale-data-warning"
            style={styles.staleDataWarning}
          >
            Couldn't refresh the leaderboard. Showing saved results, which may be out of date.
          </Text>
        ) : null}

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
          <Loading accessibilityLabel="Loading leaderboard" />
        ) : query.error && !period ? (
          <View style={styles.message}>
            <Feather accessible={false} name="alert-circle" size={28} color={C.red} />
            <Text
              accessible
              accessibilityRole="text"
              testID="leaderboard-error-guidance"
              style={styles.messageText}
            >
              {`Leaderboard is unavailable: ${apiError(query.error)}`}
            </Text>
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Retry leaderboard load"
              testID="leaderboard-retry-button"
              onPress={() => void query.refetch()}
              style={styles.retryButton}
            >
              <Text style={styles.retryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : !period ? (
          <View style={styles.message}>
            <Feather accessible={false} name="award" size={30} color={accent} />
            <Text
              accessible
              accessibilityRole="text"
              testID="leaderboard-unavailable-guidance"
              style={styles.messageText}
            >
              Leaderboard data is not available yet.
            </Text>
          </View>
        ) : standings.length === 0 ? (
          <View style={styles.message}>
            <Feather accessible={false} name="award" size={30} color={accent} />
            <Text
              accessible
              accessibilityRole="text"
              testID="leaderboard-no-awards-guidance"
              style={styles.messageText}
            >
              No match awards yet this cycle. Rankings update when tournament results are published.
            </Text>
            <Text
              accessible
              accessibilityRole="text"
              testID="leaderboard-empty-date-range"
              style={styles.range}
            >
              {dateRange(period)}
            </Text>
          </View>
        ) : (
          <>
            <Text
              accessible
              accessibilityRole="text"
              testID="leaderboard-populated-date-range"
              style={styles.range}
            >
              {dateRange(period)}
            </Text>
            <View style={styles.podiumPanel} testID="leaderboard-top-three">
              <View style={[styles.podium, largeText && styles.podiumLarge]}>
                {podium.map(({ rank, standing }) => (
                  <PodiumEntry key={rank} rank={rank} standing={standing} largeText={largeText} />
                ))}
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Top 20 players"
              accessibilityState={{ expanded: showTop20 }}
              testID="leaderboard-top20-toggle"
              onPress={() => setShowTop20((expanded) => !expanded)}
              style={({ pressed }) => [
                styles.top20Toggle,
                { borderColor: accent, opacity: pressed ? 0.82 : 1 },
              ]}
            >
              <Text style={[styles.top20ToggleText, { color: accent }]}>
                {showTop20 ? "HIDE TOP 20 PLAYERS" : "VIEW TOP 20 PLAYERS"}
              </Text>
              <Feather
                name={showTop20 ? "chevron-up" : "chevron-down"}
                size={16}
                color={accent}
              />
            </Pressable>

            {showTop20 ? (
              <>
                {!largeText ? (
                  <View style={styles.columnHeader}>
                    <Text style={styles.rankColumn}>RANK</Text>
                    <Text style={styles.playerColumn}>PLAYER</Text>
                    <Text style={styles.coinsColumn}>COINS</Text>
                  </View>
                ) : null}

                {remainingPlayers.length > 0 ? (
                  <View style={styles.playerRows}>
                    {remainingPlayers.map((standing) => (
                      <PlayerRow
                        key={standing.userId}
                        standing={standing}
                        cycle={cycle}
                        largeText={largeText}
                        fontScale={fontScale}
                      />
                    ))}
                  </View>
                ) : (
                  <Text style={styles.noMorePlayers}>No additional ranked players yet.</Text>
                )}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  screenReaderAnnouncement: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  },
  content: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 28 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 12 },
  staleDataWarning: {
    color: C.text,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.orange,
    backgroundColor: C.card2,
  },
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
  top20Toggle: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: C.card,
  },
  top20ToggleText: { fontSize: 12, fontWeight: "900", letterSpacing: 0.6 },
  podiumPanel: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card2,
    marginBottom: 14,
  },
  podium: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  podiumLarge: { flexDirection: "column", alignItems: "stretch", gap: 8 },
  podiumEntry: {
    flex: 1,
    minWidth: 0,
    minHeight: 174,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 3,
    paddingBottom: 5,
  },
  podiumEntryLarge: {
    width: "100%",
    minHeight: 84,
    flex: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  podiumWinner: {
    minHeight: 192,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.gold + "55",
    paddingBottom: 8,
  },
  podiumWinnerLarge: { minHeight: 96, paddingVertical: 12 },
  podiumAvatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 7,
  },
  podiumAvatarWinner: { width: 78, height: 78, borderRadius: 39, marginBottom: 8 },
  podiumAvatarLarge: { width: 48, height: 48, borderRadius: 24, marginBottom: 0 },
  podiumAvatarWinnerLarge: { width: 58, height: 58, borderRadius: 29 },
  podiumInitial: { color: C.text, fontSize: 24, fontWeight: "700" },
  podiumInitialWinner: { fontSize: 32 },
  podiumInitialLarge: { fontSize: 16 },
  podiumInitialWinnerLarge: { fontSize: 19 },
  podiumRank: { fontSize: 10, fontWeight: "900", marginBottom: 7 },
  podiumRankLarge: { marginBottom: 0 },
  podiumName: { color: C.text, fontSize: 11, fontWeight: "800", maxWidth: "100%", textAlign: "center" },
  podiumNameLarge: { flex: 1, minWidth: 0, textAlign: "left" },
  podiumDetailsLarge: { flex: 1, minWidth: 0, gap: 4 },
  podiumCoins: {
    maxWidth: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 6,
  },
  podiumCoinsLarge: { maxWidth: "100%", flexWrap: "wrap", justifyContent: "flex-start", marginTop: 0 },
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
  playerRowLarge: {
    width: "100%",
    minWidth: 0,
    flexDirection: "column",
    alignItems: "stretch",
    gap: 10,
    paddingVertical: 12,
  },
  playerMainLarge: { width: "100%", minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  playerRank: { width: 42, fontSize: 13, fontWeight: "900" },
  playerRankLarge: { width: 66, flexShrink: 0 },
  playerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  playerAvatarLarge: { width: 38, height: 38, borderRadius: 19, flexShrink: 0 },
  playerInitial: { color: C.text, fontSize: 15, fontWeight: "800" },
  playerInitialLarge: { fontSize: 12 },
  playerName: { flex: 1, minWidth: 0, color: C.text, fontSize: 13, fontWeight: "800" },
  playerNameLarge: { width: 0, flexGrow: 1, flexShrink: 1 },
  playerCoins: { width: 88, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  playerCoinsLarge: {
    width: "100%",
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 5,
  },
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
  retryButton: {
    minHeight: 44,
    minWidth: 112,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.blue,
    backgroundColor: C.card,
  },
  retryButtonText: { color: C.blue, fontSize: 14, fontWeight: "800" },
});