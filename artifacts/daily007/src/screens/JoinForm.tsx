import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { User } from '../lib/api';
import { Btn, Card, C, Input, Msg } from '../components/ui';

type Member = { name: string; uid: string };

export default function JoinForm({ tournament: t, user, onCancel, onSubmit }: {
  tournament: any; user: User; onCancel: () => void; onSubmit: (payload: any) => Promise<void>;
}) {
  const squad = String(t.teamType || '').toLowerCase() === 'squad';
  const clash = String(t.mode || '').toLowerCase().includes('clash');
  const isTeam = squad || clash;
  const teamSize = 4;
  const totalSlots = Number(t.totalSlots ?? (clash ? 2 : squad ? 12 : 48));
  const filledSlots = Number(t.filledSlots ?? t.filled ?? 0);
  const remainingSlots = Math.max(0, Number(t.availableSlots ?? totalSlots - filledSlots));
  const status = String(t.status || '').toLowerCase();
  const closed = t.enabled === false || ['completed', 'cancelled', 'live', 'closed'].includes(status);
  const full = remainingSlots <= 0 || filledSlots >= totalSlots || status === 'full';
  const unavailable = full || closed;
  const [captainRealName, setCaptainRealName] = useState(user.name);
  const [captainGameName, setCaptainGameName] = useState('');
  const [captainGameUid, setCaptainGameUid] = useState(user.gameUid || '');
  const [members, setMembers] = useState<Member[]>(
    isTeam ? [{ name: '', uid: '' }, { name: '', uid: '' }, { name: '', uid: '' }] : []
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
    if (!captainRealName.trim()) return setErr('Captain real name is required.');
    if (!captainGameName.trim()) return setErr('Captain Free Fire in-game name is required.');
    if (!captainGameUid.trim()) return setErr('Captain Free Fire UID is required.');
    if (members.some((member) => !member.name.trim())) return setErr('Enter all three teammate in-game names.');
    setBusy(true);
    try {
      const players = [
        { name: captainGameName.trim(), uid: captainGameUid.trim() },
        ...members.map((member) => ({ name: member.name.trim(), uid: member.uid.trim() })),
      ];
      await onSubmit({
        teamMembers: JSON.stringify(players),
        playerName: captainRealName.trim(),
        captainGameName: captainGameName.trim(),
        gameUid: captainGameUid.trim(),
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
          Captain real name, Free Fire in-game name, and UID are required.
          {isTeam ? ' Enter all three teammate in-game names; teammate UIDs are optional.' : ''}
        </Text>
        <Text style={st.pLabel}>CAPTAIN DETAILS</Text>
        <Input
          placeholder="Captain real name"
          value={captainRealName}
          onChangeText={setCaptainRealName}
          autoCapitalize="words"
        />
        <Input
          placeholder="Captain Free Fire in-game name"
          value={captainGameName}
          onChangeText={setCaptainGameName}
          autoCapitalize="words"
        />
        <Input
          placeholder="Captain Free Fire UID"
          value={captainGameUid}
          onChangeText={setCaptainGameUid}
          keyboardType="number-pad"
        />
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