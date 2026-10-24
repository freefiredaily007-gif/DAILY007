import React, { useEffect, useState } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import type { User } from '../lib/api';
import { Btn, Card, C, Input, Msg } from '../components/ui';
import { showLocalizedAlert } from '../i18n/alerts';
import { translateExactText } from '../i18n';
import { KeyboardAwareScrollViewCompat } from '../../components/KeyboardAwareScrollViewCompat';
import { canEditRegistrationTeam, getTeamEditCutoff } from '../lib/teamEditWindow';
import { buildIndividualPlayerJoinPayload, buildJoinFormPayload } from '../lib/joinFormPayload';
import {
  getJoinFormSubmissionErrorMessage,
  getRegistrationServerFieldErrors,
  validateJoinForm,
  type JoinFormField,
} from '../lib/joinFormValidation';
import { isFullMatchRejection } from '../lib/tournamentJoinRecovery';
import { requestTeamEditCancel } from '../lib/teamEditCancel';
import { getTournamentSeatLayout } from '../lib/tournamentSeatLayout';
import { isTournamentCapacityFull } from '../lib/tournamentCapacity';

type Member = { name: string; uid: string };
type TeamEditSnapshot = {
  captainGameName: string;
  captainGameUid: string;
  teamName: string;
  teammates: Member[];
};

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

function initialTeamSnapshot(registration: any, teamSize: number): TeamEditSnapshot {
  const roster = initialMembers(registration, teamSize);
  return {
    captainGameName: roster[0]?.name ?? '',
    captainGameUid: roster[0]?.uid ?? '',
    teamName: String(registration?.teamName ?? ''),
    teammates: roster.slice(1),
  };
}

function isTeamEditSnapshot(value: unknown): value is TeamEditSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.captainGameName === 'string' &&
    typeof snapshot.captainGameUid === 'string' &&
    typeof snapshot.teamName === 'string' &&
    Array.isArray(snapshot.teammates) &&
    snapshot.teammates.every((member) =>
      member !== null && typeof member === 'object' && !Array.isArray(member) &&
      typeof (member as Record<string, unknown>).name === 'string' &&
      typeof (member as Record<string, unknown>).uid === 'string');
}

export default function JoinForm({ tournament: t, user, registration, seatGroupNumber, seatSlotNumber, onCancel, onSubmit }: {
  tournament: any; user: User; registration?: any; seatGroupNumber?: number; seatSlotNumber?: number;
  onCancel: () => void; onSubmit: (payload: any) => Promise<void>;
}) {
  const editing = !!registration?.id;
  const teamType = String(t.teamType || 'Solo');
  const gameMode = String(t.mode || 'Battle Royale');
  const teamSize = Number(t.teamSize) || (
    teamType.toLowerCase() === 'squad' ? 4
      : teamType.toLowerCase() === 'trio' ? 3
        : teamType.toLowerCase() === 'duo' ? 2 : 1
  );
  const isTeam = teamSize > 1;
  const seatLayout = getTournamentSeatLayout(t);
  const slotUnit = seatLayout?.groupKind === 'player'
    ? 'player'
    : String(t.slotUnit || (gameMode.toLowerCase() === 'battle royale' && teamSize === 1 ? 'player' : 'team'));
  const totalSlots = Number(t.totalSlots ?? (slotUnit === 'player' ? 48 : gameMode.toLowerCase() === 'battle royale' ? (teamType.toLowerCase() === 'duo' ? 24 : 12) : 2));
  const filledSlots = Number(t.filledSlots ?? t.filled ?? 0);
  const remainingSlots = Math.max(0, Number(t.availableSlots ?? totalSlots - filledSlots));
  const filledPlayers = Number(t.filledPlayerSlots ?? filledSlots * teamSize);
  const totalPlayers = Number(t.totalPlayerSlots ?? totalSlots * teamSize);
  const status = String(t.status || '').toLowerCase();
  const closed = t.enabled === false || ['completed', 'cancelled', 'live', 'ongoing', 'closed'].includes(status);
  const full = isTournamentCapacityFull({
    filledPlayers,
    totalPlayers,
    filledSlots,
    totalSlots,
    status,
  });
  const unavailable = full || closed;
  const captainProfileName = String(registration?.playerName ?? user.name).trim();
  const initialRoster = initialMembers(registration, teamSize);
  const [captainGameName, setCaptainGameName] = useState(initialRoster[0]?.name ?? '');
  const [captainGameUid, setCaptainGameUid] = useState(initialRoster[0]?.uid || user.gameUid || '');
  const [teamName, setTeamName] = useState(String(registration?.teamName ?? ''));
  const [members, setMembers] = useState<Member[]>(initialRoster.slice(1));
  const [err, setErr] = useState('');
  const [errorAnnouncementId, setErrorAnnouncementId] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<JoinFormField, string>>>({});
  const [fullCapacityFailure, setFullCapacityFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expectedTeam, setExpectedTeam] = useState<TeamEditSnapshot>(() =>
    initialTeamSnapshot(registration, teamSize));
  const [staleTeam, setStaleTeam] = useState<TeamEditSnapshot | null>(null);
  const originalTeam = initialTeamSnapshot(registration, teamSize);
  const hasUnsavedTeamChanges = editing && JSON.stringify({
    captainGameName,
    captainGameUid,
    teamName,
    teammates: members,
  }) !== JSON.stringify(originalTeam);
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
    setExpectedTeam(initialTeamSnapshot(registration, teamSize));
    setStaleTeam(null);
    setErr('');
    setFieldErrors({});
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

  const cancel = () => requestTeamEditCancel(
    hasUnsavedTeamChanges,
    onCancel,
    ({ keepEditing, discard }) => {
      if (Platform.OS === 'web') {
        if (globalThis.confirm(translateExactText('Discard team changes? Your unsaved edits will be lost.'))) discard();
        else keepEditing();
        return;
      }
      showLocalizedAlert(
        'Discard team changes?',
        'Your unsaved edits will be lost.',
        [
          { text: 'Keep editing', style: 'cancel', onPress: keepEditing },
          { text: 'Discard', style: 'destructive', onPress: discard },
        ],
      );
    },
  );

  const clearFieldValidation = (field: JoinFormField) => {
    if (!fieldErrors[field]) return;
    setErr('');
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      if (field === 'captainGameUid' || field.startsWith('memberUid:')) {
        for (const [key, message] of Object.entries(next)) {
          if (
            (key === 'captainGameUid' || key.startsWith('memberUid:')) &&
            message?.includes('is also entered')
          ) {
            delete next[key as JoinFormField];
          }
        }
      }
      return next;
    });
    setFullCapacityFailure(false);
  };

  const announceError = (message: string) => {
    setErrorAnnouncementId((id) => id + 1);
    setErr(message);
  };

  const submit = async () => {
    setErr('');
    setFieldErrors({});
    setFullCapacityFailure(false);
    if (editing && !canEditRegistrationTeam(t, registration?.status, Date.now())) {
      setClockNow(Date.now());
      return announceError('Team editing is locked 30 minutes before the tournament starts.');
    }
    if (!editing && closed) return announceError('This tournament is no longer open for registration.');
    if (!editing && full) return announceError('This tournament is full. Please choose another match.');
    if (!editing && isTeam && (!seatGroupNumber || !seatSlotNumber)) {
      return announceError('Choose your individual open player slot from the tournament page first.');
    }
    if (!editing) {
      const individualErrors: Partial<Record<JoinFormField, string>> = {};
      if (!captainGameName.trim()) individualErrors.captainGameName = 'Your Free Fire in-game name is required.';
      if (!captainGameUid.trim()) individualErrors.captainGameUid = 'Your Free Fire UID is required.';
      if (!captainProfileName) {
        announceError('Add a Daily007 profile name in Profile before joining.');
      } else if (Object.keys(individualErrors).length > 0) {
        setFieldErrors(individualErrors);
        announceError('Enter your Free Fire in-game name and UID to continue.');
      }
      if (!captainProfileName || Object.keys(individualErrors).length > 0) return;
    }
    const validation = editing ? validateJoinForm({
      captainProfileName,
      captainGameName,
      captainGameUid,
      teamName,
      members,
      isTeam,
    }) : null;
    if (validation) {
      setFieldErrors(validation.fieldErrors);
      return announceError(validation.message);
    }
    setBusy(true);
    try {
      const payload = editing
        ? buildJoinFormPayload({
            captainProfileName,
            captainGameName: captainGameName.trim(),
            captainGameUid: captainGameUid.trim(),
            teamName,
            members,
          })
        : buildIndividualPlayerJoinPayload({
            captainProfileName,
            captainGameName,
            captainGameUid,
          });
      await onSubmit(editing
        ? { ...payload, expectedTeam }
        : {
            ...payload,
            ...(seatGroupNumber ? { seatGroupNumber } : {}),
            ...(seatSlotNumber ? { seatSlotNumber } : {}),
          });
    } catch (e: any) {
      const responseData = e?.response?.data;
      const serverFieldErrors = getRegistrationServerFieldErrors(responseData, {
        isTeam,
        teammateCount: members.length,
      });
      if (Object.keys(serverFieldErrors).length > 0) setFieldErrors(serverFieldErrors);
      const message = responseData?.error || responseData?.message || e?.message || 'Registration could not be confirmed. Please try again.';
      if (
        editing &&
        e?.response?.status === 409 &&
        responseData?.code === 'STALE_TEAM_EDIT' &&
        isTeamEditSnapshot(responseData?.latestTeam)
      ) {
        setStaleTeam(responseData.latestTeam);
        announceError('This team was updated elsewhere. Review the latest saved team below. Your form values are still here.');
      } else {
        announceError(getJoinFormSubmissionErrorMessage(message, {
          editing,
          outcomeUnknown: e?.isAxiosError === true && !e?.response,
        }));
      }
      setFullCapacityFailure(isFullMatchRejection(e));
    } finally { setBusy(false); }
  };

  const title = `${gameMode.toUpperCase()} · ${teamType.toUpperCase()} REGISTRATION`;
  const capacity = slotUnit === 'team'
    ? `${filledSlots}/${totalSlots} teams · ${filledPlayers}/${totalPlayers} players`
    : `${filledSlots}/${totalSlots} players`;
  const capacityAnnouncement = fullCapacityFailure
    ? `${err} Updated capacity: ${capacity}. Registration is closed.`
    : undefined;
  const remaining = slotUnit === 'team'
    ? `${remainingSlots} ${remainingSlots === 1 ? 'team' : 'teams'} · ${Math.max(0, totalPlayers - filledPlayers)} player places remaining`
    : `${remainingSlots} player places remaining`;
  const action = isTeam ? 'JOIN PLAYER SLOT' : 'JOIN SOLO';
  const selectedPlayerLabel = isTeam
    ? seatSlotNumber === 1 ? 'CAPTAIN' : seatSlotNumber ? `PLAYER ${seatSlotNumber}` : 'PLAYER'
    : seatGroupNumber ? `PLAYER ${seatGroupNumber}` : 'PLAYER';
  const disabledMessage = editing
    ? editLocked
      ? 'Team editing is locked 30 minutes before the tournament starts.'
      : editUnavailable
        ? 'Team changes are unavailable for this tournament.'
        : ''
    : '';

  const fieldErrorText = (field: JoinFormField, testID: string) => {
    const message = fieldErrors[field];
    return message ? (
      <Text accessible={false} style={st.fieldError} testID={testID}>
        {message}
      </Text>
    ) : null;
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={st.wrap}
      keyboardShouldPersistTaps="handled"
      bottomOffset={72}
    >
      <Text onPress={cancel} style={st.back}>← BACK</Text>
      <Text style={st.h}>{editing ? `EDIT TEAM · ${teamType.toUpperCase()}` : title}</Text>
      <Text style={st.sub}>
        {editing
          ? `${t.name} · No additional coins will be charged.`
          : `${t.name} · Entry: ${t.entryCoins ?? 0} coins ${isTeam ? '(each player joins individually)' : ''}`}
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
      {!editing && seatGroupNumber ? (
        <Card style={{ marginTop: 12 }} testID="join-form-selected-seat">
          <Text style={st.capacityLabel}>
            {seatLayout?.groupKind === 'team' ? 'SELECTED TEAM · YOUR PLAYER SLOT' : 'SELECTED PLAYER SLOT'}
          </Text>
          <Text style={st.capacity}>
            {seatLayout?.groupKind === 'team'
              ? `TEAM ${String(seatGroupNumber).padStart(2, '0')} · ${selectedPlayerLabel}`
              : `PLAYER ${seatLayout?.directDuel ? seatGroupNumber : String(seatGroupNumber).padStart(2, '0')}`}
          </Text>
          <Text style={st.sub}>Only your player slot is registered after the server confirms your entry.</Text>
        </Card>
      ) : null}

      <Card style={{ marginTop: 12 }}>
        <Text style={st.legacyNote}>{editing
          ? 'Update the Free Fire names, UIDs, and team details for this registration. Your application profile name and original entry payment will not change.'
          : 'Register only your own Free Fire in-game name and UID. Each player joins and pays for their own slot.'}
        </Text>
        {editing ? (
          <>
            <Text style={st.pLabel}>CAPTAIN DETAILS</Text>
            <Text style={st.pLabel}>CAPTAIN APPLICATION PROFILE NAME</Text>
            <Input
              accessibilityLabel="Captain Daily007 profile name, read-only"
              accessibilityHint={fieldErrors.captainProfileName}
              placeholder="Set your name in Profile before joining"
              value={captainProfileName}
              editable={false}
              selectTextOnFocus={false}
            />
            {fieldErrorText('captainProfileName', 'join-form-error-captain-profile-name')}
            <Input
              placeholder="Captain Free Fire in-game name"
              accessibilityLabel="Captain Free Fire in-game name"
              accessibilityHint={fieldErrors.captainGameName}
              testID="join-form-captain-game-name"
              value={captainGameName}
              onChangeText={(value) => {
                setCaptainGameName(value);
                clearFieldValidation('captainGameName');
              }}
              autoCapitalize="words"
              maxLength={100}
            />
            {fieldErrorText('captainGameName', 'join-form-error-captain-game-name')}
            <Input
              placeholder="Captain Free Fire UID"
              accessibilityLabel="Captain Free Fire UID"
              accessibilityHint={fieldErrors.captainGameUid}
              testID="join-form-captain-game-uid"
              value={captainGameUid}
              onChangeText={(value) => {
                setCaptainGameUid(value);
                clearFieldValidation('captainGameUid');
              }}
              keyboardType="number-pad"
              maxLength={128}
            />
            {fieldErrorText('captainGameUid', 'join-form-error-captain-game-uid')}
            {isTeam && (
              <>
                <Text style={st.pLabel}>TEAM NAME</Text>
                <Input
                  accessibilityLabel="Team name"
                  accessibilityHint={fieldErrors.teamName}
                  testID="join-form-team-name"
                  placeholder="Team name"
                  value={teamName}
                  onChangeText={(value) => {
                    setTeamName(value);
                    clearFieldValidation('teamName');
                  }}
                  autoCapitalize="words"
                  maxLength={100}
                />
                {fieldErrorText('teamName', 'join-form-error-team-name')}
              </>
            )}
            {members.map((member, i) => (
              <View key={i} style={{ marginBottom: 4 }}>
                <Text style={st.pLabel}>TEAMMATE {i + 1}</Text>
                <Input
                  accessibilityLabel={`Teammate ${i + 1} Free Fire in-game name`}
                  accessibilityHint={fieldErrors[`memberName:${i}`]}
                  testID={`join-form-teammate-name-${i + 1}`}
                  placeholder={`Teammate ${i + 1} Free Fire in-game name`}
                  value={member.name}
                  onChangeText={(v) => {
                    setMember(i, 'name', v);
                    clearFieldValidation(`memberName:${i}`);
                  }}
                  autoCapitalize="words"
                  maxLength={100}
                />
                {fieldErrorText(`memberName:${i}`, `join-form-error-teammate-name-${i + 1}`)}
                <Input
                  accessibilityLabel={`Teammate ${i + 1} Free Fire UID, optional`}
                  accessibilityHint={fieldErrors[`memberUid:${i}`]}
                  testID={`join-form-teammate-uid-${i + 1}`}
                  placeholder={`Teammate ${i + 1} Free Fire UID (optional)`}
                  value={member.uid}
                  onChangeText={(v) => {
                    setMember(i, 'uid', v);
                    clearFieldValidation(`memberUid:${i}`);
                  }}
                  keyboardType="number-pad"
                  maxLength={128}
                />
                {fieldErrorText(`memberUid:${i}`, `join-form-error-teammate-uid-${i + 1}`)}
              </View>
            ))}
          </>
        ) : (
          <>
            <Text style={st.pLabel}>{selectedPlayerLabel} DETAILS</Text>
            <Input
              accessibilityLabel={`${selectedPlayerLabel} Free Fire in-game name`}
              accessibilityHint={fieldErrors.captainGameName}
              testID="join-form-player-game-name"
              placeholder={`${selectedPlayerLabel} Free Fire in-game name`}
              value={captainGameName}
              onChangeText={(value) => {
                setCaptainGameName(value);
                clearFieldValidation('captainGameName');
              }}
              autoCapitalize="words"
              maxLength={100}
            />
            {fieldErrorText('captainGameName', 'join-form-error-player-game-name')}
            <Input
              accessibilityLabel={`${selectedPlayerLabel} Free Fire UID`}
              accessibilityHint={fieldErrors.captainGameUid}
              testID="join-form-player-game-uid"
              placeholder={`${selectedPlayerLabel} Free Fire UID`}
              value={captainGameUid}
              onChangeText={(value) => {
                setCaptainGameUid(value);
                clearFieldValidation('captainGameUid');
              }}
              keyboardType="number-pad"
              maxLength={128}
            />
            {fieldErrorText('captainGameUid', 'join-form-error-player-game-uid')}
          </>
        )}
      </Card>

      {editing && staleTeam && (
        <Card style={{ marginTop: 12 }} testID="join-form-stale-team">
          <Text style={st.capacityLabel}>LATEST SAVED TEAM</Text>
          <Text style={st.staleTeamDetail}>Captain: {staleTeam.captainGameName} · UID {staleTeam.captainGameUid}</Text>
          {staleTeam.teamName ? (
            <Text style={st.staleTeamDetail}>Team: {staleTeam.teamName}</Text>
          ) : null}
          {staleTeam.teammates.map((member, index) => (
            <Text key={index} style={st.staleTeamDetail}>
              Teammate {index + 1}: {member.name}{member.uid ? ` · UID ${member.uid}` : ''}
            </Text>
          ))}
          <Text style={st.sub}>Your current form values have not changed. Review these saved details before continuing.</Text>
          <Btn
            title="KEEP MY EDITS AND CONTINUE"
            kind="ghost"
            onPress={() => {
              setExpectedTeam(staleTeam);
              setStaleTeam(null);
              announceError('Your form values are unchanged. Save again to replace the latest saved team.');
            }}
            testID="join-form-keep-edits"
            style={{ marginTop: 10 }}
          />
        </Card>
      )}

      <Msg
        key={errorAnnouncementId}
        kind="err"
        text={err || disabledMessage}
        testID="join-form-error"
        accessibilityLabel={capacityAnnouncement}
        accessibilityLiveRegion={err ? 'polite' : undefined}
      />
      <View style={{ marginTop: 12, marginBottom: 32 }}>
        <Btn
          title={editing ? 'SAVE TEAM CHANGES' : `PAY ${t.entryCoins ?? 0} COINS & ${action}`}
          onPress={submit}
          loading={busy}
          disabled={isUnavailable}
          testID={editing ? 'join-form-save-team' : 'join-form-submit'}
        />
        <Btn
          title="CANCEL"
          kind="ghost"
          onPress={cancel}
          style={{ marginTop: 9 }}
          testID="join-form-cancel"
        />
      </View>
    </KeyboardAwareScrollViewCompat>
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
  fieldError: { color: C.red, fontSize: 12, lineHeight: 17, marginTop: -2, marginBottom: 8 },
  staleTeamDetail: { color: C.text, fontSize: 12, lineHeight: 18, marginTop: 5 },
});
