import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { User } from '../lib/api';
import { Btn, Card, C, Input, Msg } from '../components/ui';

type Member = { name: string; uid: string; ign: string };

export default function JoinForm({ tournament: t, user, onCancel, onSubmit }: {
  tournament: any; user: User; onCancel: () => void; onSubmit: (payload: any) => Promise<void>;
}) {
  const squad = t.teamType === 'Squad';
  const [teamName, setTeamName] = useState('');
  const [members, setMembers] = useState<Member[]>(
    squad
      ? [{ name: user.name, uid: user.gameUid || '', ign: user.gameUid || '' }, { name: '', uid: '', ign: '' }, { name: '', uid: '', ign: '' }, { name: '', uid: '', ign: '' }]
      : [{ name: user.name, uid: user.gameUid || '', ign: user.gameUid || '' }]
  );
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const setMember = (i: number, field: keyof Member, v: string) => {
    setMembers((m) => m.map((x, j) => (j === i ? { ...x, [field]: v } : x)));
  };

  const submit = async () => {
    setErr('');
    const filled = members.filter((m) => m.name.trim());
    if (filled.length === 0) return setErr('Player name is required');
    for (const m of filled) {
      if (!m.uid.trim()) return setErr(`Free Fire UID missing for ${m.name || 'a player'}`);
      if (!m.ign.trim()) return setErr(`In-game name missing for ${m.name}`);
    }
    if (squad) {
      if (filled.length < 4) return setErr('Squad tournaments require all 4 players');
      if (!teamName.trim()) return setErr('Team/Squad name is required');
    }
    setBusy(true);
    try {
      await onSubmit({
        teamName: squad ? teamName.trim() : '',
        teamMembers: JSON.stringify(filled),
        playerName: filled[0].name.trim(),
        gameUid: filled[0].uid.trim(),
      });
    } finally { setBusy(false); }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Text onPress={onCancel} style={st.back}>← BACK</Text>
      <Text style={st.h}>{squad ? '👥 SQUAD REGISTRATION' : '🎯 SOLO REGISTRATION'}</Text>
      <Text style={st.sub}>{t.name} • Entry: 🪙 {t.entryCoins}</Text>

      <Card style={{ marginTop: 14 }}>
        {squad && <Input placeholder="Team / Squad name" value={teamName} onChangeText={setTeamName} />}
        {members.map((m, i) => (
          <View key={i} style={{ marginBottom: 6 }}>
            <Text style={st.pLabel}>{i === 0 ? (squad ? 'CAPTAIN (You)' : 'PLAYER') : `PLAYER ${i + 1}`}</Text>
            <Input placeholder="Player name" value={m.name} onChangeText={(v) => setMember(i, 'name', v)} />
            <Input placeholder="Free Fire UID" value={m.uid} onChangeText={(v) => setMember(i, 'uid', v)} keyboardType="number-pad" />
            <Input placeholder="In-game name (IGN)" value={m.ign} onChangeText={(v) => setMember(i, 'ign', v)} />
          </View>
        ))}
      </Card>

      <Msg kind="err" text={err} />
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 40 }}>
        <View style={{ flex: 1 }}><Btn title="CANCEL" kind="ghost" onPress={onCancel} /></View>
        <View style={{ flex: 2 }}><Btn title={`PAY 🪙 ${t.entryCoins} & JOIN`} onPress={submit} loading={busy} /></View>
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 30 },
  back: { color: C.sub, fontWeight: '800', fontSize: 13, marginBottom: 10 },
  h: { color: C.text, fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  sub: { color: C.sub, fontSize: 12, marginTop: 4 },
  pLabel: { color: C.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 6, marginTop: 8 },
});
