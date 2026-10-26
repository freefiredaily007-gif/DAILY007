import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import {
  useDaily007GetKnockoutLeaderboard,
  useDaily007ListPublicKnockoutEvents,
  type Daily007KnockoutDefaultSettings,
  type Daily007KnockoutEvent,
  type Daily007KnockoutRound,
} from "@workspace/api-client-react";
import { ReadableText as Text } from "../components/typography";
import { Btn, C, Card, Empty, Loading, SectionTitle } from "../components/ui";
import { i18n, translateExactText } from "../i18n";
import { inr } from "../lib/coins";

type Section = "leaderboard" | "rules";

function formatStart(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const locale = i18n.language === "hi" ? "hi-IN" : i18n.language === "gu" ? "gu-IN" : "en-IN";
  return `${new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date)} IST`;
}

export default function KnockoutDetails() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const requestedMatchId = typeof route.params?.matchId === "string" ? route.params.matchId : null;
  const initialSection: Section = route.params?.section === "leaderboard" ? "leaderboard" : "rules";
  const [section, setSection] = useState<Section>(initialSection);
  const [selectedRound, setSelectedRound] = useState<Daily007KnockoutRound>("round_1");
  const eventQuery = useDaily007ListPublicKnockoutEvents({
    query: { queryKey: ["daily007", "knockout", "public"], staleTime: 0, gcTime: 0, refetchOnMount: "always" },
  });
  const events = eventQuery.data?.events ?? [];
  const defaultSettings: Daily007KnockoutDefaultSettings = eventQuery.data?.defaults ?? {
    title: "Knockout Squad Tournament",
    squadCount: 12,
    playersPerSquad: 4,
    stageCount: 3,
    entryCoins: 10,
    prizePool: 1000,
    pointsPerKill: 1,
    round1Eliminated: 2,
    round2Eliminated: 2,
    totalPlayers: 48,
    squadEntryCoins: 40,
    stages: [
      { name: "Round 1", squads: 12, eliminated: 2, advance: 10 },
      { name: "Round 2", squads: 10, eliminated: 2, advance: 8 },
      { name: "Final", squads: 8, eliminated: 0, advance: 8 },
    ],
  };
  const event = useMemo<Daily007KnockoutEvent | null>(() => (
    events.find((item) => item.matchId === requestedMatchId) ??
    events.find((item) => item.registrationOpen) ??
    events[0] ??
    null
  ), [events, requestedMatchId]);
  const leaderboardQuery = useDaily007GetKnockoutLeaderboard(
    event?.matchId ?? "",
    { round: selectedRound },
    { query: { queryKey: ["daily007", "knockout", "leaderboard", event?.matchId, selectedRound], enabled: Boolean(event?.matchId), staleTime: 0, gcTime: 0, refetchOnMount: "always" } },
  );

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={translateExactText("Back")}
        onPress={() => navigation.goBack()}
        style={styles.back}
      >
        <Feather name="arrow-left" size={18} color={C.blue} />
        <Text style={styles.backText}>{translateExactText("BACK TO HOME")}</Text>
      </Pressable>

      <View style={styles.hero}>
        <View style={styles.heroIcon}><Feather name="award" size={27} color={C.gold} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{translateExactText("KNOCKOUT TOURNAMENT")}</Text>
          <Text style={styles.title}>{translateExactText(event?.title ?? "KNOCKOUT SQUAD TOURNAMENT")}</Text>
          <Text style={styles.subtitle}>{translateExactText("SURVIVE EVERY ROUND. WIN THE CHAMPIONSHIP.")}</Text>
        </View>
      </View>

      {eventQuery.isLoading && <Loading />}
      {eventQuery.isError && (
        <Empty text={translateExactText("Could not load Knockout tournament data. Please try again.")} />
      )}
      {!eventQuery.isLoading && !event && !eventQuery.isError && (
        <Empty text={translateExactText("No Knockout tournament is scheduled yet.")} />
      )}
      {event && (
        <>
          <Card style={styles.eventCard} glowColor={C.gold}>
            <View style={styles.statusRow}>
              <Text style={styles.eventName}>{event.title}</Text>
              <View style={styles.statusPill}>
                <Text style={styles.statusText}>{translateExactText(event.status.toUpperCase())}</Text>
              </View>
            </View>
            <Text style={styles.startTime}>{formatStart(event.startsAt)}</Text>
            <View style={styles.infoGrid}>
              <Info label="PRIZE POOL" value={`${inr(event.prizePool)} · ${event.prizePool} ${translateExactText("COINS")}`} />
              <Info label="ENTRY / PLAYER" value={`${event.entryCoins} ${translateExactText("COINS")}`} />
              <Info label="SQUAD ENTRY" value={`${event.squadEntryCoins} ${translateExactText("COINS")}`} />
              <Info label="CONFIRMED SQUADS" value={`${event.registeredSquads}/${event.squadCount}`} />
              <Info label="INCOMPLETE SQUADS" value={`${event.incompleteSquads}`} />
              <Info label="PLAYERS" value={`${event.registeredPlayers}/${event.totalPlayers}`} />
              <Info label="POINTS PER KILL" value={`${event.pointsPerKill}`} />
            </View>
            <Btn
              title={translateExactText(event.registrationOpen ? "JOIN TOURNAMENT" : "REGISTRATION CLOSED")}
              onPress={() => event.registrationOpen && navigation.navigate("TDetail", { id: event.matchId })}
              disabled={!event.registrationOpen}
              kind={event.registrationOpen ? "primary" : "ghost"}
            />
          </Card>

          <View style={styles.tabs}>
            <SectionTab active={section === "rules"} title="RULES" onPress={() => setSection("rules")} />
            <SectionTab active={section === "leaderboard"} title="LEADERBOARD" onPress={() => setSection("leaderboard")} />
          </View>

          {section === "rules" ? (
            <>
              <SectionTitle accent={C.gold}>{translateExactText("TOURNAMENT RULES")}</SectionTitle>
              <Card style={styles.rulesCard}>
                <Rule icon="users" text={`${event.squadCount} ${translateExactText("SQUADS")} · ${event.playersPerSquad} ${translateExactText("PLAYERS PER SQUAD")}`} />
                <Rule icon="credit-card" text={`${event.entryCoins} ${translateExactText("COINS")} ${translateExactText("PER PLAYER")} · ${event.squadEntryCoins} ${translateExactText("COINS")} ${translateExactText("PER SQUAD")}`} />
                <Rule icon="zap" text={`${event.pointsPerKill} ${translateExactText("POINTS PER VERIFIED KILL")}`} />
                {event.stages.map((stage, index) => (
                  <View key={`${stage.name}-${index}`} style={styles.stageRule}>
                    <View style={styles.stageIndex}><Text style={styles.stageIndexText}>{String(index + 1).padStart(2, "0")}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stageName}>{translateExactText(stage.name.toUpperCase())} · {stage.squads} {translateExactText("SQUADS")}</Text>
                      <Text style={styles.stageMeta}>
                        {stage.name === "Final"
                          ? translateExactText("Final squads compete for championship rankings.")
                          : i18n.t("{{eliminated}} ELIMINATED · {{advance}} ADVANCE", {
                              eliminated: stage.eliminated,
                              advance: stage.advance,
                            })}
                      </Text>
                    </View>
                  </View>
                ))}
              </Card>
            </>
          ) : (
            <>
              <SectionTitle accent={C.gold}>{translateExactText("ROUND STANDINGS")}</SectionTitle>
              <Card style={styles.progressCard}>
                <Text style={styles.progressTitle}>
                  {translateExactText(leaderboardQuery.data?.progressionStatus ?? "PROVISIONAL RESULTS")}
                </Text>
                <Text style={styles.progressMessage}>
                  {translateExactText(leaderboardQuery.data?.message ?? "Scores remain provisional until every result is published and an admin confirms the round.")}
                </Text>
              </Card>
              <View style={styles.roundTabs}>
                {([
                  ["round_1", "ROUND 1"],
                  ["round_2", "ROUND 2"],
                  ["final", "FINAL"],
                ] as const).map(([round, label]) => (
                  <SectionTab
                    key={round}
                    active={selectedRound === round}
                    title={label}
                    onPress={() => setSelectedRound(round)}
                  />
                ))}
              </View>
              {leaderboardQuery.isLoading ? <Loading /> : null}
              {leaderboardQuery.isError ? (
                <Empty text={translateExactText("Could not load the squad list. Please try again.")} />
              ) : null}
              {!leaderboardQuery.isLoading && !leaderboardQuery.isError &&
                (leaderboardQuery.data?.standings?.length ?? 0) === 0 && (
                  <Empty text={translateExactText("No squads have registered yet.")} />
                )}
              {!leaderboardQuery.isLoading && !leaderboardQuery.isError &&
                (leaderboardQuery.data?.standings ?? []).map((squad) => (
                  <Card key={squad.teamNumber} style={styles.squadCard}>
                    <View style={styles.squadHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.squadName}>
                          {(squad.officialRank ?? squad.provisionalRank) ? `#${squad.officialRank ?? squad.provisionalRank} · ` : ""}{squad.teamName}
                        </Text>
                        <Text style={styles.squadCount}>
                          {translateExactText("CAPTAIN")}: {squad.captainName}
                        </Text>
                      </View>
                      <View style={styles.rankStack}>
                        {squad.finalRank !== null ? (
                          <Text style={styles.finalRank}>FINAL #{squad.finalRank}</Text>
                        ) : null}
                        <Text style={[
                          styles.resultBadge,
                          squad.resultStatus === "OFFICIAL" ? styles.officialBadge : styles.provisionalBadge,
                        ]}>
                          {translateExactText(squad.resultStatus)}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.rankMetaRow}>
                      <Text style={styles.roundStatus}>{translateExactText("ROUND")}: {translateExactText(squad.roundStatus)}</Text>
                      <Text style={styles.roundStatus}>{translateExactText("STATUS")}: {translateExactText(squad.qualificationStatus)}</Text>
                    </View>
                    <Text style={styles.squadCount}>
                      {squad.confirmed ? translateExactText("CONFIRMED") : translateExactText("INCOMPLETE")}
                      {" · "}{squad.registeredPlayers}/{event.playersPerSquad} {translateExactText("PLAYERS")}
                    </Text>
                    {squad.roundPoints !== null ? (
                      <View style={styles.scoreGrid}>
                        <Score label="PLACEMENT" value={String(squad.placement ?? "—")} />
                        <Score label="SQUAD KILLS" value={String(squad.squadKills ?? "—")} />
                        <Score label="PLACEMENT POINTS" value={String(squad.placementPoints ?? "—")} />
                        <Score label="TOTAL POINTS" value={String(squad.roundPoints)} />
                      </View>
                    ) : null}
                    {squad.roundPoints !== null ? (
                      <Text style={styles.scoreSummary}>
                        {squad.placementPoints} + {squad.squadKills} × {squad.pointsPerKill} = {squad.roundPoints}
                      </Text>
                    ) : null}
                    {/* Player list and payment information are retained for transparency. */}
                    {squad.players.map((player) => (
                      <View key={`${squad.teamNumber}-${player.slotNumber}`} style={styles.playerRow}>
                        <Feather name="user" size={13} color={C.blue} />
                        <Text style={styles.playerName} numberOfLines={1}>{player.playerName}</Text>
                        <Text style={[
                          styles.pendingResult,
                          player.paymentStatus === "paid" && styles.paidStatus,
                          player.paymentStatus === "unpaid" && styles.unpaidStatus,
                        ]}>
                          {translateExactText(player.paymentStatus.toUpperCase())}
                          {player.paidByCaptain ? ` · ${translateExactText("CAPTAIN PAID")}` : ""}
                        </Text>
                      </View>
                    ))}
                  </Card>
                ))}
              <Text style={styles.resultNotice}>
                {translateExactText("Draft and published scores remain provisional until an admin confirms the round.")}
              </Text>
            </>
          )}
        </>
      )}
      {!event && (
        <>
          <View style={styles.tabs}>
            <SectionTab active={section === "rules"} title="RULES" onPress={() => setSection("rules")} />
            <SectionTab active={section === "leaderboard"} title="LEADERBOARD" onPress={() => setSection("leaderboard")} />
          </View>
          {section === "rules" ? (
            <>
              <SectionTitle accent={C.gold}>{translateExactText("TOURNAMENT RULES")}</SectionTitle>
              <Card style={styles.rulesCard}>
                <Rule icon="users" text={`${defaultSettings.squadCount} ${translateExactText("SQUADS")} · ${defaultSettings.playersPerSquad} ${translateExactText("PLAYERS PER SQUAD")}`} />
                <Rule icon="credit-card" text={`${defaultSettings.entryCoins} ${translateExactText("COINS")} ${translateExactText("PER PLAYER")} · ${defaultSettings.squadEntryCoins} ${translateExactText("COINS")} ${translateExactText("PER SQUAD")}`} />
                <Rule icon="award" text={`${inr(defaultSettings.prizePool)} · ${defaultSettings.prizePool} ${translateExactText("COINS")} ${translateExactText("PRIZE POOL")}`} />
                <Rule icon="zap" text={`${defaultSettings.pointsPerKill} ${translateExactText("POINTS PER VERIFIED KILL")}`} />
                {defaultSettings.stages.map((stage, index) => (
                  <View key={`${stage.name}-${index}`} style={styles.stageRule}>
                    <View style={styles.stageIndex}><Text style={styles.stageIndexText}>{String(index + 1).padStart(2, "0")}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stageName}>{translateExactText(stage.name.toUpperCase())} · {stage.squads} {translateExactText("SQUADS")}</Text>
                      <Text style={styles.stageMeta}>
                        {stage.name === "Final"
                          ? translateExactText("Final squads compete for championship rankings.")
                          : i18n.t("{{eliminated}} ELIMINATED · {{advance}} ADVANCE", {
                              eliminated: stage.eliminated,
                              advance: stage.advance,
                            })}
                      </Text>
                    </View>
                  </View>
                ))}
              </Card>
            </>
          ) : (
            <Empty text={translateExactText("No Knockout tournament is scheduled yet.")} />
          )}
        </>
      )}
    </ScrollView>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.info}>
      <Text style={styles.infoLabel}>{translateExactText(label)}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Score({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.scoreBox}>
      <Text style={styles.scoreLabel}>{translateExactText(label)}</Text>
      <Text style={styles.scoreValue}>{value}</Text>
    </View>
  );
}

function Rule({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  return (
    <View style={styles.rule}>
      <Feather name={icon} size={15} color={C.gold} />
      <Text style={styles.ruleText}>{text}</Text>
    </View>
  );
}

function SectionTab({ active, title, onPress }: { active: boolean; title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: active }} style={[styles.tab, active && styles.activeTab]}>
      <Text style={[styles.tabText, active && styles.activeTabText]}>{translateExactText(title)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 30, gap: 12 },
  back: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8 },
  backText: { color: C.blue, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  hero: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.gold + "65", borderRadius: 16, padding: 14,
  },
  heroIcon: {
    width: 50, height: 50, borderRadius: 15, alignItems: "center", justifyContent: "center",
    backgroundColor: C.gold + "14", borderWidth: 1, borderColor: C.gold + "55",
  },
  kicker: { color: C.purple, fontSize: 9, fontWeight: "900", letterSpacing: 1.3 },
  title: { color: C.gold, fontSize: 17, fontWeight: "900", marginTop: 3 },
  subtitle: { color: C.sub, fontSize: 10, fontWeight: "700", marginTop: 4 },
  eventCard: { gap: 11 },
  statusRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  eventName: { flex: 1, color: C.text, fontSize: 16, fontWeight: "900" },
  statusPill: { borderRadius: 12, borderWidth: 1, borderColor: C.green + "70", backgroundColor: C.green + "14", paddingHorizontal: 8, paddingVertical: 5 },
  statusText: { color: C.green, fontSize: 9, fontWeight: "900" },
  startTime: { color: C.gold, fontSize: 12, fontWeight: "800" },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  info: { flexGrow: 1, flexBasis: "30%", minWidth: 100, padding: 9, borderRadius: 10, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border },
  infoLabel: { color: C.dim, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  infoValue: { color: C.text, fontSize: 11, fontWeight: "900", marginTop: 4 },
  tabs: { flexDirection: "row", padding: 4, gap: 4, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  roundTabs: { flexDirection: "row", gap: 5, padding: 4, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tab: { flex: 1, minHeight: 40, justifyContent: "center", alignItems: "center", borderRadius: 9 },
  activeTab: { backgroundColor: C.gold + "20", borderWidth: 1, borderColor: C.gold + "70" },
  tabText: { color: C.sub, fontSize: 10, fontWeight: "900", letterSpacing: 0.6 },
  activeTabText: { color: C.gold },
  rulesCard: { gap: 12 },
  progressCard: { gap: 5, borderColor: C.blue + "55", paddingVertical: 11 },
  progressTitle: { color: C.gold, fontSize: 10, fontWeight: "900", letterSpacing: 0.45 },
  progressMessage: { color: C.sub, fontSize: 9, lineHeight: 14 },
  rule: { flexDirection: "row", alignItems: "center", gap: 9 },
  ruleText: { color: C.text, flex: 1, fontSize: 12, fontWeight: "700" },
  stageRule: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  stageIndex: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: C.gold + "16", borderWidth: 1, borderColor: C.gold + "45" },
  stageIndexText: { color: C.gold, fontSize: 11, fontWeight: "900" },
  stageName: { color: C.text, fontSize: 11, fontWeight: "900" },
  stageMeta: { color: C.sub, fontSize: 10, marginTop: 3 },
  squadCard: { gap: 8 },
  squadHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 8 },
  squadName: { color: C.gold, fontSize: 14, fontWeight: "900" },
  squadCount: { color: C.sub, fontSize: 10, fontWeight: "800" },
  playerRow: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: C.border },
  playerName: { color: C.text, fontSize: 12, fontWeight: "700", flex: 1 },
  pendingResult: { color: C.dim, fontSize: 9, fontWeight: "800" },
  paidStatus: { color: C.green },
  unpaidStatus: { color: C.red },
  rankStack: { alignItems: "flex-end", gap: 4, maxWidth: "46%" },
  resultBadge: { fontSize: 7, fontWeight: "900", textAlign: "right" },
  officialBadge: { color: C.green },
  provisionalBadge: { color: C.orange },
  finalRank: { color: C.gold, fontSize: 8, fontWeight: "900" },
  rankMetaRow: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 5 },
  roundStatus: { color: C.blue, fontSize: 8, fontWeight: "800", flexShrink: 1 },
  scoreGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  scoreBox: { width: "48%", minHeight: 45, borderRadius: 9, padding: 8, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, justifyContent: "space-between" },
  scoreLabel: { color: C.sub, fontSize: 7, fontWeight: "900" },
  scoreValue: { color: C.gold, fontSize: 12, fontWeight: "900" },
  scoreSummary: { color: C.sub, fontSize: 10, fontWeight: "800" },
  resultNotice: { color: C.sub, fontSize: 11, textAlign: "center", paddingHorizontal: 10, paddingVertical: 6 },
});
