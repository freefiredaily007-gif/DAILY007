import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  useDaily007AdminCreateKnockoutEvent,
  useDaily007AdminListKnockoutEvents,
  useDaily007AdminUpdateKnockoutEvent,
  type Daily007KnockoutEvent,
  type Daily007KnockoutSettingsBody,
} from "@workspace/api-client-react";
import { ReadableText as Text, ReadableTextInput as TextInput } from "../components/typography";
import { A } from "../components/adminKit";
import { inr } from "../lib/coins";
import AdminKnockoutResults from "./AdminKnockoutResults";

type Form = {
  title: string;
  date: string;
  time: string;
  squadCount: string;
  entryCoins: string;
  prizePool: string;
  pointsPerKill: string;
  round1Eliminated: string;
  round2Eliminated: string;
  published: boolean;
};

function istDateTime(instant?: string): { date: string; time: string } {
  const date = instant ? new Date(instant) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
  return { date: dateParts, time };
}

function createForm(event?: Daily007KnockoutEvent): Form {
  const schedule = istDateTime(event?.startsAt);
  return {
    title: event?.title ?? "Knockout Squad Tournament",
    date: schedule.date,
    time: schedule.time,
    squadCount: String(event?.squadCount ?? 12),
    entryCoins: String(event?.entryCoins ?? 10),
    prizePool: String(event?.prizePool ?? 1000),
    pointsPerKill: String(event?.pointsPerKill ?? 1),
    round1Eliminated: String(event?.round1Eliminated ?? 2),
    round2Eliminated: String(event?.round2Eliminated ?? 2),
    published: event?.published ?? false,
  };
}

function errorMessage(error: unknown): string {
  const value = error as {
    response?: { data?: { error?: string } };
    message?: string;
  };
  return value?.response?.data?.error || value?.message || "The request failed. Please try again.";
}

export default function AdminKnockout() {
  const query = useDaily007AdminListKnockoutEvents({
    query: { queryKey: ["daily007", "knockout", "admin"], staleTime: 0, refetchOnMount: "always" },
  });
  const createMutation = useDaily007AdminCreateKnockoutEvent();
  const updateMutation = useDaily007AdminUpdateKnockoutEvent();
  const events = query.data?.events ?? [];
  const [form, setForm] = useState<Form>(() => createForm());
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saving = createMutation.isPending || updateMutation.isPending;

  const parsedSquads = Math.min(12, Math.max(4, Number(form.squadCount) || 4));
  const round1Max = Math.max(1, parsedSquads - 3);
  const round1Eliminated = Math.min(round1Max, Math.max(1, Number(form.round1Eliminated) || 1));
  const round2Max = Math.max(1, parsedSquads - round1Eliminated - 2);
  const finalSquads = parsedSquads - round1Eliminated - Math.min(round2Max, Math.max(1, Number(form.round2Eliminated) || 1));
  const squadEntryCoins = (Number(form.entryCoins) || 0) * 4;

  const sortedEvents = useMemo(() => [...events].sort((a, b) => (
    new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  )), [events]);

  const patchForm = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
    setNotice("");
  };

  const payload = (): Daily007KnockoutSettingsBody => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) throw new Error("Use the date format YYYY-MM-DD.");
    if (!/^\d{2}:\d{2}$/.test(form.time)) throw new Error("Use the 24-hour time format HH:MM.");
    const startsAt = new Date(`${form.date}T${form.time}:00+05:30`);
    if (!Number.isFinite(startsAt.getTime())) throw new Error("Enter a valid India Standard Time start date and time.");
    return {
      title: form.title.trim(),
      startsAt: startsAt.toISOString(),
      squadCount: parsedSquads,
      playersPerSquad: 4,
      stageCount: 3,
      entryCoins: Number(form.entryCoins),
      prizePool: Number(form.prizePool),
      pointsPerKill: Number(form.pointsPerKill),
      round1Eliminated: Number(form.round1Eliminated),
      round2Eliminated: Number(form.round2Eliminated),
      published: form.published,
    };
  };

  const save = async () => {
    setError("");
    setNotice("");
    let data: Daily007KnockoutSettingsBody;
    try {
      data = payload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the tournament settings.");
      return;
    }
    try {
      if (editingMatchId) {
        await updateMutation.mutateAsync({ id: editingMatchId, data });
        setNotice("Knockout tournament updated.");
      } else {
        await createMutation.mutateAsync({ data });
        setNotice(data.published ? "Knockout tournament created and published." : "Knockout tournament saved as a draft.");
        setForm(createForm());
      }
      setEditingMatchId(null);
      await query.refetch();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const editEvent = (event: Daily007KnockoutEvent) => {
    setForm(createForm(event));
    setEditingMatchId(event.matchId);
    setError("");
    setNotice("");
  };

  const resetForm = () => {
    setForm(createForm());
    setEditingMatchId(null);
    setError("");
    setNotice("");
  };

  return (
    <ScrollView
      testID="admin-knockout-screen"
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headingRow}>
        <View style={styles.headingIcon}><Feather name="flag" size={20} color={A.gold} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>KNOCKOUT SQUAD TOURNAMENT</Text>
          <Text style={styles.subheading}>Configure squads, schedule, entry, prize, and stage rules.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh Knockout tournaments"
          onPress={() => void query.refetch()}
          style={styles.iconButton}
        >
          <Feather name="refresh-cw" size={16} color={A.gold} />
        </Pressable>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>{editingMatchId ? "EDIT KNOCKOUT EVENT" : "CREATE KNOCKOUT EVENT"}</Text>
        <Field label="TOURNAMENT NAME">
          <TextInput
            testID="admin-knockout-title"
            value={form.title}
            onChangeText={(value) => patchForm("title", value)}
            placeholder="Knockout Squad Tournament"
            placeholderTextColor={A.sub}
            maxLength={80}
            style={styles.input}
          />
        </Field>

        <View style={styles.twoColumns}>
          <Field label="START DATE (IST)">
            <TextInput
              testID="admin-knockout-date"
              value={form.date}
              onChangeText={(value) => patchForm("date", value)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={A.sub}
              keyboardType="numbers-and-punctuation"
              style={styles.input}
            />
          </Field>
          <Field label="START TIME (IST)">
            <TextInput
              testID="admin-knockout-time"
              value={form.time}
              onChangeText={(value) => patchForm("time", value)}
              placeholder="20:00"
              placeholderTextColor={A.sub}
              keyboardType="numbers-and-punctuation"
              style={styles.input}
            />
          </Field>
        </View>

        <View style={styles.twoColumns}>
          <Field label="TOTAL SQUADS (4–12)">
            <TextInput
              testID="admin-knockout-squad-count"
              value={form.squadCount}
              onChangeText={(value) => patchForm("squadCount", value.replace(/\D/g, ""))}
              keyboardType="number-pad"
              maxLength={2}
              style={styles.input}
            />
          </Field>
          <Field label="PLAYERS PER SQUAD">
            <View style={[styles.input, styles.fixedValue]}>
              <Text style={styles.fixedValueText}>4 PLAYERS</Text>
            </View>
          </Field>
        </View>

        <View style={styles.twoColumns}>
          <Field label="ENTRY COINS / PLAYER">
            <TextInput
              testID="admin-knockout-entry"
              value={form.entryCoins}
              onChangeText={(value) => patchForm("entryCoins", value.replace(/\D/g, ""))}
              keyboardType="number-pad"
              style={styles.input}
            />
          </Field>
          <Field label="SQUAD ENTRY TOTAL">
            <View style={[styles.input, styles.fixedValue]}>
              <Text style={styles.fixedValueText}>{squadEntryCoins} COINS · {inr(squadEntryCoins)}</Text>
            </View>
          </Field>
        </View>

        <View style={styles.twoColumns}>
          <Field label="PRIZE POOL (COINS)">
            <TextInput
              testID="admin-knockout-prize"
              value={form.prizePool}
              onChangeText={(value) => patchForm("prizePool", value.replace(/\D/g, ""))}
              keyboardType="number-pad"
              style={styles.input}
            />
          </Field>
          <Field label="POINTS PER VERIFIED KILL">
            <TextInput
              testID="admin-knockout-points-per-kill"
              value={form.pointsPerKill}
              onChangeText={(value) => patchForm("pointsPerKill", value.replace(/\D/g, ""))}
              keyboardType="number-pad"
              style={styles.input}
            />
          </Field>
        </View>

        <Text style={styles.stageIntro}>THREE STAGES · {parsedSquads * 4} MAX PLAYERS</Text>
        <View style={styles.stageFields}>
          <StageField
            label="ROUND 1 ELIMINATED"
            value={form.round1Eliminated}
            max={round1Max}
            testID="admin-knockout-round1-eliminated"
            onChange={(value) => {
              const nextR1 = Number(value) || 1;
              const nextR2Max = Math.max(1, parsedSquads - Math.min(round1Max, nextR1) - 2);
              setForm((current) => ({
                ...current,
                round1Eliminated: String(Math.min(round1Max, Math.max(1, nextR1))),
                round2Eliminated: String(Math.min(nextR2Max, Number(current.round2Eliminated) || 1)),
              }));
              setError("");
            }}
          />
          <StageField
            label="ROUND 2 ELIMINATED"
            value={form.round2Eliminated}
            max={round2Max}
            testID="admin-knockout-round2-eliminated"
            onChange={(value) => patchForm("round2Eliminated", value)}
          />
        </View>
        <View style={styles.stagePreview}>
          <StagePreview name="ROUND 1" squads={parsedSquads} eliminated={round1Eliminated} advance={parsedSquads - round1Eliminated} />
          <StagePreview
            name="ROUND 2"
            squads={parsedSquads - round1Eliminated}
            eliminated={Math.min(round2Max, Math.max(1, Number(form.round2Eliminated) || 1))}
            advance={finalSquads}
          />
          <StagePreview name="FINAL" squads={finalSquads} eliminated={0} advance={finalSquads} />
        </View>

        <View style={styles.publishRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.publishTitle}>PUBLISH FOR REGISTRATION</Text>
            <Text style={styles.publishHint}>{form.published ? "Visible to players; joining follows the existing wallet flow." : "Drafts stay hidden from players."}</Text>
          </View>
          <Switch
            testID="admin-knockout-published"
            value={form.published}
            onValueChange={(value) => patchForm("published", value)}
            trackColor={{ false: A.border, true: A.green + "88" }}
            thumbColor={form.published ? A.green : A.sub}
          />
        </View>

        {error ? <Text testID="admin-knockout-error" accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {notice ? <Text testID="admin-knockout-success" accessibilityLiveRegion="polite" style={styles.success}>{notice}</Text> : null}

        <View style={styles.formActions}>
          <Pressable
            testID="admin-knockout-save"
            accessibilityRole="button"
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            onPress={() => void save()}
            style={[styles.primaryButton, saving && styles.buttonDisabled]}
          >
            <Feather name={saving ? "loader" : "save"} size={16} color={A.bg} />
            <Text style={styles.primaryButtonText}>{saving ? "SAVING…" : editingMatchId ? "SAVE CHANGES" : form.published ? "CREATE & PUBLISH" : "SAVE DRAFT"}</Text>
          </Pressable>
          {editingMatchId ? (
            <Pressable testID="admin-knockout-cancel-edit" onPress={resetForm} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>CANCEL EDIT</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.listHeading}>
        <Text style={styles.panelTitle}>KNOCKOUT EVENTS</Text>
        <Text style={styles.count}>{sortedEvents.length} TOTAL</Text>
      </View>
      {query.isLoading ? <Text style={styles.listMessage}>Loading saved tournaments…</Text> : null}
      {query.isError ? (
        <Text testID="admin-knockout-list-error" accessibilityRole="alert" style={styles.error}>
          {errorMessage(query.error)}
        </Text>
      ) : null}
      {!query.isLoading && !query.isError && sortedEvents.length === 0 ? (
        <Text style={styles.listMessage}>No Knockout events created yet.</Text>
      ) : null}
      {sortedEvents.map((event) => (
        <EventCard key={event.matchId} event={event} onEdit={() => editEvent(event)} />
      ))}
      <AdminKnockoutResults events={sortedEvents} />
    </ScrollView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function StageField({
  label, value, max, onChange, testID,
}: {
  label: string; value: string; max: number; onChange: (value: string) => void; testID: string;
}) {
  return (
    <Field label={`${label} (MAX ${max})`}>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={(next) => {
          const digits = next.replace(/\D/g, "").slice(0, 2);
          const count = Number(digits) || 1;
          onChange(String(Math.min(max, Math.max(1, count))));
        }}
        keyboardType="number-pad"
        maxLength={2}
        style={styles.input}
      />
    </Field>
  );
}

function StagePreview({ name, squads, eliminated, advance }: { name: string; squads: number; eliminated: number; advance: number }) {
  return (
    <View style={styles.stagePreviewItem}>
      <Text style={styles.stageName}>{name}</Text>
      <Text style={styles.stageValue}>{squads} → {advance}</Text>
      <Text style={styles.stageHint}>{eliminated ? `${eliminated} OUT` : "FINAL RANKINGS"}</Text>
    </View>
  );
}

function EventCard({ event, onEdit }: { event: Daily007KnockoutEvent; onEdit: () => void }) {
  const date = new Date(event.startsAt);
  const schedule = Number.isFinite(date.getTime())
    ? `${new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: true,
      }).format(date)} IST`
    : "Schedule unavailable";
  return (
    <View testID={`admin-knockout-event-${event.matchId}`} style={styles.eventCard}>
      <View style={styles.eventTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eventTitle}>{event.title}</Text>
          <Text style={styles.eventSchedule}>{schedule}</Text>
        </View>
        <View style={[styles.eventStatus, event.published ? styles.publishedStatus : styles.draftStatus]}>
          <Text style={[styles.eventStatusText, event.published && { color: A.green }]}>
            {event.status.toUpperCase()}
          </Text>
        </View>
      </View>
      <Text style={styles.eventSummary}>
        {event.registeredSquads}/{event.squadCount} confirmed squads · {event.incompleteSquads} incomplete · {event.registeredPlayers}/{event.totalPlayers} players · {event.entryCoins} coins/player
      </Text>
      <Text style={styles.eventSummary}>
        Prize {event.prizePool} coins ({inr(event.prizePool)}) · {event.pointsPerKill} point(s) per kill
      </Text>
      <Pressable accessibilityRole="button" onPress={onEdit} style={styles.editButton}>
        <Feather name="edit-2" size={13} color={A.gold} />
        <Text style={styles.editButtonText}>EDIT SETTINGS</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: A.bg },
  content: { padding: 14, paddingBottom: 28, gap: 12 },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 2 },
  headingIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: A.gold + "14", borderWidth: 1, borderColor: A.gold + "55" },
  heading: { color: A.gold, fontSize: 15, fontWeight: "900", letterSpacing: 0.6 },
  subheading: { color: A.sub, fontSize: 10, marginTop: 4 },
  iconButton: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: A.card, borderWidth: 1, borderColor: A.border },
  panel: { padding: 13, backgroundColor: A.card, borderColor: A.border, borderWidth: 1, borderRadius: 16, gap: 12 },
  panelTitle: { color: A.gold, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  field: { flex: 1, minWidth: 0, gap: 5 },
  fieldLabel: { color: A.sub, fontSize: 9, fontWeight: "900", letterSpacing: 0.65 },
  input: { minHeight: 44, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: A.bg, borderColor: A.border, borderWidth: 1, color: A.text, fontSize: 13, fontWeight: "700" },
  twoColumns: { flexDirection: "row", gap: 9 },
  fixedValue: { justifyContent: "center" },
  fixedValueText: { color: A.text, fontSize: 12, fontWeight: "900" },
  stageIntro: { color: A.cyan, fontSize: 10, fontWeight: "900", letterSpacing: 0.7 },
  stageFields: { flexDirection: "row", gap: 9 },
  stagePreview: { flexDirection: "row", gap: 7 },
  stagePreviewItem: { flex: 1, minWidth: 0, backgroundColor: A.bg, borderColor: A.border, borderWidth: 1, borderRadius: 10, padding: 8, alignItems: "center" },
  stageName: { color: A.gold, fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  stageValue: { color: A.text, fontSize: 13, fontWeight: "900", marginTop: 5 },
  stageHint: { color: A.sub, fontSize: 8, fontWeight: "800", marginTop: 4, textAlign: "center" },
  publishRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: A.border, borderBottomWidth: 1, borderBottomColor: A.border },
  publishTitle: { color: A.text, fontSize: 10, fontWeight: "900" },
  publishHint: { color: A.sub, fontSize: 9, marginTop: 3 },
  error: { color: "#FFB4B4", backgroundColor: A.redSoft, borderRadius: 9, borderWidth: 1, borderColor: A.red + "77", padding: 10, fontSize: 11, fontWeight: "800" },
  success: { color: A.green, backgroundColor: A.green + "12", borderRadius: 9, borderWidth: 1, borderColor: A.green + "66", padding: 10, fontSize: 11, fontWeight: "800" },
  formActions: { gap: 8 },
  primaryButton: { minHeight: 46, borderRadius: 11, backgroundColor: A.gold, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryButtonText: { color: A.bg, fontSize: 11, fontWeight: "900", letterSpacing: 0.7 },
  buttonDisabled: { opacity: 0.65 },
  secondaryButton: { minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: A.border, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: A.sub, fontSize: 10, fontWeight: "900" },
  listHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 5 },
  count: { color: A.sub, fontSize: 9, fontWeight: "900" },
  listMessage: { color: A.sub, fontSize: 11, textAlign: "center", paddingVertical: 15 },
  eventCard: { padding: 12, borderRadius: 14, borderWidth: 1, borderColor: A.border, backgroundColor: A.card },
  eventTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  eventTitle: { color: A.text, fontSize: 13, fontWeight: "900" },
  eventSchedule: { color: A.gold, fontSize: 10, fontWeight: "800", marginTop: 4 },
  eventStatus: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, borderWidth: 1 },
  publishedStatus: { borderColor: A.green + "80", backgroundColor: A.green + "13" },
  draftStatus: { borderColor: A.orange + "80", backgroundColor: A.orange + "13" },
  eventStatusText: { color: A.orange, fontSize: 8, fontWeight: "900" },
  eventSummary: { color: A.sub, fontSize: 10, fontWeight: "700", marginTop: 9 },
  editButton: { marginTop: 10, minHeight: 40, borderRadius: 9, borderWidth: 1, borderColor: A.gold + "66", backgroundColor: A.gold + "0C", flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center" },
  editButtonText: { color: A.gold, fontSize: 9, fontWeight: "900", letterSpacing: 0.6 },
});
