import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import type { User } from '../lib/api';
import { Btn, Card, C, Input, Msg } from '../components/ui';
import { canEditRegistrationTeam, getTeamEditCutoff } from '../lib/teamEditWindow';
import { buildJoinFormPayload } from '../lib/joinFormPayload';
import { isFullMatchRejection } from '../lib/tournamentJoinRecovery';

type Member = { name: string; uid: string };

function initialMembers(registration: any, teamSize: number): Member[] {
  let roster: any[] = [];
  try {
    const parsed = typeof registration?.teamMembers === 'string'
      ? JSON.parse(registration.teamMembers)
      : registration?.teamMembers;
    if (Array.isArray(parsed)) roster = parsed;
  } catch {}
  return Array.from({ length: teamSize }, (_, index) => {
    const member = roster[index] ?? {};
    return {
      name: String(member.name ?? (index === 0 ? registration?.captainGameName : '') ?? ''),
      uid: String(member.uid ?? (index === 0 ? registration?.gameUid : '') ?? ''),
    };
  });
}

export default function JoinForm({ tournament: t, user, registration, onCancel, onSubmit }: {
  tournament: any; user: User; registration?: any; onCancel: () => void; onSubmit: (payload: any) => Promise<void>;
}) {
  const editing = !!registration?.id;
  const teamType = String(t.teamType || 'Solo');
  const gameMode = String(t.mode || 'Battle Royale');
  const teamSize = Number(t.teamSize) || (teamType.toLowerCase() === 'squad' ? 4 : teamType.toLowerCase() === 'duo' ? 2 : 1);
  const isTeam = teamSize > 1;
  const slotUnit = String(t.slotUnit || (gameMode.toLowerCase() === 'battle royale' && teamSize === 1 ? 'player' : 'team'));
  const totalSlots = Number(t.totalSlots ?? (slotUnit === 'player' ? 48 : gameMode.toLowerCase() === 'battle royale' ? (teamType.toLowerCase() === 'duo' ? 24 : 12) : 2));
  const filledSlots = Number(t.filledSlots ?? t.filled ?? 0);
  const remainingSlots = Math.max(0, Number(t.availableSlots ?? totalSlots - filledSlots));
  const status = String(t.status || '').toLowerCase();
  const closed = t.enabled === false || ['completed', 'cancelled', 'live', 'ongoing', 'closed'].includes(status);
  const full = remainingSlots <= 0 || filledSlots >= totalSlots || ['full', 'setup_needed'].includes(status);
  const unavailable = full || closed;
  const captainProfileName = String(registration?.playerName ?? user.name).trim();
  const initialRoster = initialMembers(registration, teamSize);
  const [captainGameName, setCaptainGameName] = useState(initialRoster[0]?.name ?? '');
  const [captainGameUid, setCaptainGameUid] = useState(initialRoster[0]?.uid || user.gameUid || '');
  const [teamName, setTeamName] = useState(String(registration?.teamName ?? ''));
  const [members, setMembers] = useState<Member[]>(initialRoster.slice(1));
  const [err, setErr] = useState('');
  const [fullCapacityFailure, setFullCapacityFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const editCutoff = getTeamEditCutoff(t.startsAt);
  const editLocked = editing && (editCutoff === null || clockNow >= editCutoff);
  const editAllowed = editing && canEditRegistrationTeam(t, registration?.status, clockNow);
  const editUnavailable = editing && !editAllowed;
  const isUnavailable = editing ? editUnavailable : unavailable;

  useEffect(() => {
    const roster = initialMembers(registration, teamSize);
    setCaptainGameName(roster[0]?.name ?? '');
    setCaptainGameUid(roster[0]?.uid || user.gameUid || '');
    setMembers(roster.slice(1));
    setTeamName(String(registration?.teamName ?? ''));
    setErr('');
    setFullCapacityFailure(false);
  }, [registration?.id, t.id, teamSize, user.gameUid]);

  useEffect(() => {
    if (!editing || editCutoff === null || editCutoff <= clockNow) return;
    const timer = setTimeout(() => setClockNow(Date.now()), editCutoff - clockNow);
    return () => clearTimeout(timer);
  }, [editing, editCutoff, clockNow]);

  const setMember = (i: number, field: keyof Member, v: string) => {
    setMembers((m) => m.map((x, j) => (j === i ? { ...x, [field]: v } : x)));
  };

  const submit = async () => {
    setErr('');
    setFullCapacityFailure(false);
    if (editing && !canEditRegistrationTeam(t, registration?.status, Date.now())) {
      setClockNow(Date.now());
      return setErr('Team editing is locked 30 minutes before the tournament starts.');
    }
    if (!editing && closed) return setErr('This tournament is no longer open for registration.');
    if (!editing && full) return setErr('This tournament is full. Please choose another match.');
    if (!captainProfileName) return setErr('Add an application profile name before registering.');
    if (!captainGameName.trim()) return setErr('Captain Free Fire in-game name is required.');
    if (!captainGameUid.trim()) return setErr('Captain Free Fire UID is required.');
    if (isTeam && !teamName.trim()) return setErr('Team name is required.');
    if (members.some((member) => !member.name.trim())) return setErr(`Enter all ${teamSize - 1} teammate in-game name${teamSize === 2 ? '' : 's'}.`);
    const submittedUids = [captainGameUid, ...members.map((member) => member.uid).filter(Boolean)]
      .map((uid) => uid.trim().toLowerCase());
    if (new Set(submittedUids).size !== submittedUids.length) return setErr('Each player must have a different game UID.');
    setBusy(true);
    try {
      await onSubmit(buildJoinFormPayload({
        captainProfileName,
        captainGameName: captainGameName.trim(),
        captainGameUid: captainGameUid.trim(),
        teamName,
        members,
      }));
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Registration could not be confirmed. Please try again.');
      setFullCapacityFailure(isFullMatchRejection(e));
    } finally { setBusy(false); }
  };

  const title = `${gameMode.toUpperCase()} · ${teamType.toUpperCase()} REGISTRATION`;
  const filledPlayers = Number(t.filledPlayerSlots ?? filledSlots * teamSize);
  const totalPlayers = Number(t.totalPlayerSlots ?? totalSlots * teamSize);
  const capacity = slotUnit === 'team'
    ? `${filledSlots}/${totalSlots} teams · ${filledPlayers}/${totalPlayers} players`
    : `${filledSlots}/${totalSlots} players`;
  const capacityAnnouncement = fullCapacityFailure
    ? `${err} Updated capacity: ${capacity}. Registration is closed.`
    : undefined;
  const remaining = slotUnit === 'team'
    ? `${remainingSlots} ${remainingSlots === 1 ? 'team' : 'teams'} · ${remainingSlots * teamSize} player places remaining`
    : `${remainingSlots} player places remaining`;
  const action = isTeam ? 'REGISTER TEAM' : slotUnit === 'team' ? 'JOIN SLOT' : 'JOIN SOLO';
  const disabledMessage = editing
    ? editLocked
      ? 'Team editing is locked 30 minutes before the tournament starts.'
      : editUnavailable
        ? 'Team changes are unavailable for this tournament.'
        : ''
    : '';

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Text onPress={onCancel} style={st.back}>← BACK</Text>
      <Text style={st.h}>{editing ? `EDIT TEAM · ${teamType.toUpperCase()}` : title}</Text>
      <Text style={st.sub}>
        {editing
          ? `${t.name} · No additional coins will be charged.`
          : `${t.name} · Entry: ${t.entryCoins ?? 0} coins ${isTeam ? '(captain pays once for the team)' : ''}`}
      </Text>
      {editing ? (
        <Card style={{ marginTop: 12 }}>
          <Text style={st.capacityLabel}>TEAM EDIT WINDOW</Text>
          <Text style={[st.sub, editUnavailable && { color: C.red }]}>
            {disabledMessage || 'You can update your team until 30 minutes before the tournament starts.'}
          </Text>
        </Card>
      ) : (
        <Card style={{ marginTop: 12 }}>
          <Text style={st.capacityLabel}>CAPACITY</Text>
          <Text style={st.capacity}>{capacity}</Text>
          <Text style={[st.sub, unavailable && { color: C.red }]}>
            {closed ? 'REGISTRATION CLOSED' : full ? 'FULL — registration is closed' : remaining}
          </Text>
        </Card>
      )}

      <Card style={{ marginTop: 12 }}>
        <Text style={st.legacyNote}>{editing
          ? 'Update the Free Fire names, UIDs, and team details for this registration. Your application profile name and original entry payment will not change.'
          : `New registrations are confirmed immediately. Entry coins are deducted from your wallet when you join. Your application profile name is used for the captain registration. Free Fire in-game name and UID are required.${isTeam ? ` Enter all ${teamSize - 1} teammate in-game names; teammate UIDs are optional.` : ''}`}
        </Text>
        <Text style={st.pLabel}>CAPTAIN DETAILS</Text>
        <Text style={st.pLabel}>CAPTAIN APPLICATION PROFILE NAME</Text>
        <Input
          accessibilityLabel="Captain application profile name"
          placeholder="Set your name in Profile before joining"
          value={captainProfileName}
          editable={false}
          selectTextOnFocus={false}
        />
        <Input
          placeholder="Captain Free Fire in-game name"
          accessibilityLabel="Captain Free Fire in-game name"
          testID="join-form-captain-game-name"
          value={captainGameName}
          onChangeText={setCaptainGameName}
          autoCapitalize="words"
        />
        <Input
          placeholder="Captain Free Fire UID"
          accessibilityLabel="Captain Free Fire UID"
          testID="join-form-captain-game-uid"
          value={captainGameUid}
          onChangeText={setCaptainGameUid}
          keyboardType="number-pad"
        />
        {isTeam && (
          <>
            <Text style={st.pLabel}>TEAM NAME</Text>
            <Input
              placeholder="Team name"
              value={teamName}
              onChangeText={setTeamName}
              autoCapitalize="words"
              maxLength={100}
            />
          </>
        )}
        {members.map((member, i) => (
          <View key={i} style={{ marginBottom: 4 }}>
            <Text style={st.pLabel}>TEAMMATE {i + 1}</Text>
            <Input
              placeholder={`Teammate ${i + 1} Free Fire in-game name`}
              value={member.name}
              onChangeText={(v) => setMember(i, 'name', v)}
              autoCapitalize="words"
            />
            <Input
              placeholder={`Teammate ${i + 1} Free Fire UID (optional)`}
              value={member.uid}
              onChangeText={(v) => setMember(i, 'uid', v)}
              keyboardType="number-pad"
            />
          </View>
        ))}
      </Card>

      <Msg
        kind="err"
        text={err || disabledMessage}
        testID="join-form-error"
        accessibilityLabel={capacityAnnouncement}
        accessibilityLiveRegion={fullCapacityFailure ? 'polite' : undefined}
      />
      <View style={{ marginTop: 12, marginBottom: 32 }}>
        <Btn
          title={editing ? 'SAVE TEAM CHANGES' : `PAY ${t.entryCoins ?? 0} COINS & ${action}`}
          onPress={submit}
          loading={busy}
          disabled={isUnavailable}
          testID={editing ? 'join-form-save-team' : 'join-form-submit'}
        />
        <Btn title="CANCEL" kind="ghost" onPress={onCancel} style={{ marginTop: 9 }} />
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 30 },
  back: { color: C.sub, fontWeight: '800', fontSize: 13, marginBottom: 10 },
  h: { color: C.text, fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  sub: { color: C.sub, fontSize: 12, marginTop: 4 },
  capacityLabel: { color: C.dim, fontSize: 10, letterSpacing: 1.5, fontWeight: '800' },
  capacity: { color: C.text, fontSize: 16, fontWeight: '900', marginTop: 4 },
  legacyNote: { color: C.dim, fontSize: 11, lineHeight: 16, marginBottom: 6 },
  pLabel: { color: C.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 6, marginTop: 8 },
});