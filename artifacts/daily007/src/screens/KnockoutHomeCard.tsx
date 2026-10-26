import React from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ReadableText as Text } from "../components/typography";
import { C } from "../components/ui";
import { i18n, translateExactText } from "../i18n";
import { inr } from "../lib/coins";
import type {
  Daily007KnockoutDefaultSettings,
  Daily007KnockoutEvent,
} from "@workspace/api-client-react";

type Props = {
  event: Daily007KnockoutEvent | null;
  defaults: Daily007KnockoutDefaultSettings;
  loading?: boolean;
  error?: boolean;
  onJoin: (matchId: string) => void;
  onOpen: (matchId: string | null, section: "leaderboard" | "rules") => void;
};

function formatStart(value?: string): string {
  if (!value) return translateExactText("DATE AND TIME TO BE ANNOUNCED");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return translateExactText("DATE AND TIME TO BE ANNOUNCED");
  const locale = i18n.language === "hi" ? "hi-IN" : i18n.language === "gu" ? "gu-IN" : "en-IN";
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date) + " IST";
}

function statusText(event: Daily007KnockoutEvent | null, loading: boolean): string {
  if (loading && !event) return translateExactText("LOADING");
  if (!event) return translateExactText("NOT SCHEDULED");
  return translateExactText(String(event.status ?? "upcoming").toUpperCase());
}

export default function KnockoutHomeCard({
  event,
  defaults,
  loading = false,
  error = false,
  onJoin,
  onOpen,
}: Props) {
  const { width, fontScale } = useWindowDimensions();
  const narrow = width <= 370 || fontScale >= 1.5;
  const squadCount = event?.squadCount ?? defaults.squadCount;
  const playersPerSquad = event?.playersPerSquad ?? defaults.playersPerSquad;
  const entryCoins = event?.entryCoins ?? defaults.entryCoins;
  const prizePool = event?.prizePool ?? defaults.prizePool;
  const pointsPerKill = event?.pointsPerKill ?? defaults.pointsPerKill;
  const stages = event?.stages ?? defaults.stages;
  const registeredSquads = event?.registeredSquads ?? 0;
  const incompleteSquads = event?.incompleteSquads ?? 0;
  const registeredPlayers = event?.registeredPlayers ?? 0;
  const matchId = event?.matchId ?? null;
  const canJoin = Boolean(event?.registrationOpen && matchId);

  return (
    <View style={styles.outer} testID="home-knockout-card">
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.icon}>
            <Feather name="award" size={23} color={C.gold} />
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{translateExactText("KNOCKOUT SQUAD TOURNAMENT")}</Text>
            <Text style={styles.subtitle}>
              {translateExactText("SURVIVE EVERY ROUND. WIN THE CHAMPIONSHIP.")}
            </Text>
          </View>
          <View style={styles.status}>
            <Text style={styles.statusText}>{error && !event ? translateExactText("UNAVAILABLE") : statusText(event, loading)}</Text>
          </View>
        </View>

        <Text style={styles.schedule}>
          {formatStart(event?.startsAt)}
        </Text>
        {error && !event ? (
          <Text style={styles.errorText}>{translateExactText("Knockout schedule could not be loaded. Please try again.")}</Text>
        ) : null}

        <View style={[styles.metrics, narrow && styles.metricsNarrow]}>
          <Metric label="PRIZE POOL" value={`${inr(prizePool)} · ${prizePool} ${translateExactText("COINS")}`} primary />
          <Metric label="ENTRY FEE" value={`${entryCoins} ${translateExactText("COINS")} / ${translateExactText("PLAYER")}`} />
          <Metric label="SQUAD ENTRY" value={`${entryCoins * playersPerSquad} ${translateExactText("COINS")}`} />
          <Metric label="CONFIRMED SQUADS" value={`${registeredSquads}/${squadCount}`} />
          <Metric label="INCOMPLETE SQUADS" value={`${incompleteSquads}`} />
          <Metric label="TOTAL PLAYERS" value={`${registeredPlayers}/${squadCount * playersPerSquad}`} />
          <Metric label="POINTS PER KILL" value={`${pointsPerKill}`} />
        </View>

        <View style={styles.stageHeader}>
          <Feather name="flag" size={15} color={C.gold} />
          <Text style={styles.stageHeading}>{translateExactText("3 TOURNAMENT STAGES")}</Text>
        </View>
        <View style={styles.stages}>
          {stages.map((stage, index) => (
            <View key={`${stage.name}-${index}`} style={styles.stage} testID={`home-knockout-stage-${index + 1}`}>
              <Text style={styles.stageName}>{translateExactText(stage.name.toUpperCase())}</Text>
              <Text style={styles.stageCount}>
                {stage.squads} {translateExactText("SQUADS")}
              </Text>
              {stage.name !== "Final" && (
                <Text style={styles.stageAdvance}>
                  {i18n.t("{{eliminated}} ELIMINATED · {{advance}} ADVANCE", {
                    eliminated: stage.eliminated,
                    advance: stage.advance,
                  })}
                </Text>
              )}
              {stage.name === "Final" && (
                <Text style={styles.stageAdvance}>{translateExactText("FINAL RANKINGS")}</Text>
              )}
            </View>
          ))}
        </View>

        <View style={[styles.actions, narrow && styles.actionsNarrow]}>
          <ActionButton
            title="JOIN TOURNAMENT"
            icon="log-in"
            primary
            disabled={!canJoin}
            onPress={() => matchId && onJoin(matchId)}
            testID="home-knockout-join"
          />
          <ActionButton
            title="LEADERBOARD"
            icon="bar-chart-2"
            onPress={() => onOpen(matchId, "leaderboard")}
            testID="home-knockout-leaderboard"
          />
          <ActionButton
            title="RULES"
            icon="book-open"
            onPress={() => onOpen(matchId, "rules")}
            testID="home-knockout-rules"
          />
        </View>
      </View>
    </View>
  );
}

function Metric({ label, value, primary = false }: { label: string; value: string; primary?: boolean }) {
  return (
    <View style={[styles.metric, primary && styles.metricPrimary]}>
      <Text style={styles.metricLabel}>{translateExactText(label)}</Text>
      <Text style={[styles.metricValue, primary && styles.metricValuePrimary]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function ActionButton({
  title,
  icon,
  primary = false,
  disabled = false,
  onPress,
  testID,
}: {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={translateExactText(title)}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary && styles.primaryAction,
        disabled && styles.disabledAction,
        pressed && !disabled && styles.actionPressed,
      ]}
    >
      <Feather name={icon} size={14} color={primary ? C.bg : C.gold} />
      <Text style={[styles.actionText, primary && styles.primaryActionText, disabled && styles.disabledActionText]}>
        {translateExactText(title)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: { marginHorizontal: 16, marginTop: 16, marginBottom: 4 },
  card: {
    backgroundColor: C.card,
    borderColor: C.gold + "75",
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    shadowColor: C.gold,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: {
    width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.gold + "65", backgroundColor: C.gold + "13",
  },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { color: C.gold, fontSize: 15, fontWeight: "900", letterSpacing: 0.8 },
  subtitle: { color: C.sub, fontSize: 10, fontWeight: "700", marginTop: 3, letterSpacing: 0.3 },
  status: {
    borderRadius: 12, borderWidth: 1, borderColor: C.green + "88",
    backgroundColor: C.green + "14", paddingHorizontal: 9, paddingVertical: 6, maxWidth: 112,
  },
  statusText: { color: C.green, fontSize: 9, fontWeight: "900", letterSpacing: 0.5, textAlign: "center" },
  schedule: { color: C.text, fontSize: 12, fontWeight: "800", marginTop: 12, marginBottom: 10 },
  errorText: { color: C.red, fontSize: 10, fontWeight: "700", marginTop: -5, marginBottom: 8 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  metricsNarrow: { gap: 6 },
  metric: {
    flexGrow: 1, flexBasis: "30%", minWidth: 96, padding: 9, borderRadius: 11,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.bg2,
  },
  metricPrimary: { borderColor: C.gold + "70" },
  metricLabel: { color: C.dim, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  metricValue: { color: C.text, fontSize: 12, fontWeight: "900", marginTop: 4 },
  metricValuePrimary: { color: C.gold },
  stageHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 13, marginBottom: 7 },
  stageHeading: { color: C.gold, fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  stages: { flexDirection: "row", gap: 6 },
  stage: {
    flex: 1, minWidth: 0, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 6,
    backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border,
  },
  stageName: { color: C.text, fontSize: 9, fontWeight: "900", textAlign: "center" },
  stageCount: { color: C.blue, fontSize: 9, fontWeight: "800", textAlign: "center", marginTop: 4 },
  stageAdvance: { color: C.sub, fontSize: 7.5, fontWeight: "700", textAlign: "center", marginTop: 3 },
  actions: { flexDirection: "row", gap: 7, marginTop: 13 },
  actionsNarrow: { flexWrap: "wrap" },
  action: {
    flex: 1, minWidth: 90, minHeight: 43, paddingHorizontal: 8, paddingVertical: 8,
    flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center",
    borderRadius: 11, borderWidth: 1, borderColor: C.gold + "70", backgroundColor: C.gold + "0D",
  },
  primaryAction: { borderColor: C.gold, backgroundColor: C.gold },
  disabledAction: { borderColor: C.border, backgroundColor: C.card2, opacity: 0.68 },
  actionPressed: { opacity: 0.82 },
  actionText: { color: C.gold, fontSize: 9, fontWeight: "900", letterSpacing: 0.45, textAlign: "center" },
  primaryActionText: { color: C.bg },
  disabledActionText: { color: C.dim },
});
