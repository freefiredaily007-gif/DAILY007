import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { User } from '../lib/api';
import { Btn, Card, C, Input, Msg } from '../components/ui';

type Member = { name: string; uid: string; ign: string };

export default function JoinForm({ tournament: t, user, onCancel, onSubmit }: {
  tournament: any; user: User; onCancel: () => void; onSubmit: (payload: any) => Promise<void>;
}) {
  const squad = t.teamType === 'Squad';
  const clash = String(t.mode || '').toLowerCase().includes('clash');
  const isTeam = squad || clash;
  const teamSize = 4;
  const totalSlots = Number(t.totalSlots ?? (clash ? 2 : squad ? 12 : 48));
  const filledSlots = Number(t.filledSlots ?? t.filled ?? 0);
  const remainingSlots = Math.max(0, Number(t.availableSlots ?? totalSlots - filledSlots));
  const status = String(t.status || '').toLowerCase();
  const closed = t.enabled === false || ['completed', 'live', 'closed'].includes(status);
  const full = remainingSlots <= 0 || filledSlots >= totalSlots || status === 'full';
  const unavailable = full || closed;
  const [teamName, setTeamName] = useState('');
  const [members, setMembers] = useState<Member[]>(
    isTeam
      ? [{ name: user.name, uid: user.gameUid || '', ign: '' }, { name: '', uid: '', ign: '' }, { name: '', uid: '', ign: '' }, { name: '', uid: '', ign: '' }]
      : [{ name: user.name, uid: user.gameUid || '', ign: '' }]
  );
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const setMember = (i: number, field: keyof Member, v: string) => {
    setMembers((m) => m.map((x, j) => (j === i ? { ...x, [field]: v } : x)));
  };

  const submit = async () => {
    setErr('');
    if (closed) return setErr('This tournament is no longer open for registration.');
    if (full) return setErr('This tournament is full. Please choose another match.');
    if (members.some((member) => !member.name.trim())) return setErr(isTeam ? 'Enter all four player names.' : 'Player game name is required.');
    for (const member of members) {
      if (!member.uid.trim()) return setErr(`Free Fire UID missing for ${member.name || 'a player'}`);
      if (!member.ign.trim()) return setErr(`In-game name missing for ${member.name}`);
    }
    if (isTeam && !teamName.trim()) return setErr('Team/Squad name is required by the current registration service.');
    setBusy(true);
    try {
      const players = members.map((member) => ({
        name: member.name.trim(),
        uid: member.uid.trim(),
        ign: member.ign.trim(),
      }));
      await onSubmit({
        teamName: isTeam ? teamName.trim() : '',
        teamMembers: JSON.stringify(players),
        playerName: players[0].name,
        gameUid: players[0].uid,
      });
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Registration could not be confirmed. Please try again.');
    } finally { setBusy(false); }
  };

  const title = clash ? 'CLASH SQUAD REGISTRATION' : squad ? 'SQUAD REGISTRATION' : 'SOLO REGISTRATION';
  const capacity = isTeam
    ? `${filledSlots}/${totalSlots} teams · ${filledSlots * teamSize}/${totalSlots * teamSize} players`
    : `${filledSlots}/${totalSlots} players`;
  const remaining = isTeam
    ? `${remainingSlots} ${remainingSlots === 1 ? 'team' : 'teams'} · ${remainingSlots * teamSize} player places remaining`
    : `${remainingSlots} player places remaining`;
  const action = clash ? 'BOOK SLOT' : isTeam ? 'REGISTER TEAM' : 'JOIN';

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Text onPress={onCancel} style={st.back}>← BACK</Text>
      <Text style={st.h}>{title}</Text>
      <Text style={st.sub}>{t.name} · Entry: {t.entryCoins ?? 0} coins {isTeam ? '(captain pays for the team)' : ''}</Text>
      <Card style={{ marginTop: 12 }}>
        <Text style={st.capacityLabel}>CAPACITY</Text>
        <Text style={st.capacity}>{capacity}</Text>
        <Text style={[st.sub, unavailable && { color: C.red }]}>
          {closed ? 'REGISTRATION CLOSED' : full ? 'FULL — registration is closed' : remaining}
        </Text>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={st.legacyNote}>
          The currently connected registration service requires a UID and IGN for every player{isTeam ? ', plus a team name' : ''}.
        </Text>
        {isTeam && (
          <>
            <Text style={st.pLabel}>TEAM DETAILS</Text>
            <Input placeholder="Team / Squad name (required by current service)" value={teamName} onChangeText={setTeamName} autoCapitalize="words" />
          </>
        )}
        {members.map((member, i) => (
          <View key={i} style={{ marginBottom: 4 }}>
            <Text style={st.pLabel}>{i === 0 ? (isTeam ? 'TEAM CAPTAIN' : 'PLAYER') : `PLAYER ${i + 1}`}</Text>
            <Input
              placeholder={i === 0 ? (isTeam ? 'Captain game name' : 'Player game name') : `Player ${i + 1} name`}
              value={member.name}
              onChangeText={(v) => setMember(i, 'name', v)}
              autoCapitalize="words"
            />
            <Input
              placeholder={`${i === 0 ? 'Captain' : `Player ${i + 1}`} Free Fire UID`}
              value={member.uid}
              onChangeText={(v) => setMember(i, 'uid', v)}
              keyboardType="number-pad"
            />
            <Input
              placeholder={`${i === 0 ? 'Captain' : `Player ${i + 1}`} in-game name (IGN)`}
              value={member.ign}
              onChangeText={(v) => setMember(i, 'ign', v)}
              autoCapitalize="words"
            />
          </View>
        ))}
      </Card>

      <Msg kind="err" text={err} />
      <View style={{ marginTop: 12, marginBottom: 32 }}>
        <Btn
          title={`PAY ${t.entryCoins ?? 0} COINS & ${action}`}
          onPress={submit}
          loading={busy}
          disabled={unavailable}
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