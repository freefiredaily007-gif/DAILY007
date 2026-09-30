import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Api, apiError, Tournament } from '../lib/api';
import { Btn, Card, C, Chip, Empty, Input, Loading, Msg, TimePicker } from '../components/ui';

export default function AdminRooms() {
  const [list, setList] = useState<Tournament[] | null>(null);
  const [sel, setSel] = useState<Tournament | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [roomId, setRoomId] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [roomTime, setRoomTime] = useState('08:00 PM');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const load = useCallback(async () => {
    try { setList(await Api.tournaments(true)); } catch { setList([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = async (t: Tournament) => {
    setSel(t); setErr(''); setOkMsg(''); setMeta(null);
    try {
      const m = await Api.adminRoom(t.id);
      setMeta(m);
      setRoomId(m.roomId || ''); setRoomPassword(m.roomPassword || ''); setRoomTime(m.roomTime || '08:00 PM');
    } catch (e: any) { setErr(apiError(e)); }
  };

  const save = async (publish: boolean) => {
    if (!sel) return;
    setErr(''); setOkMsg(''); setBusy(true);
    try {
      await Api.adminSaveRoom(sel.id, { roomId, roomPassword, roomTime, publish });
      setOkMsg(publish ? 'Room published — visible to approved players' : 'Room details saved (not published)');
      await load();
      const m = await Api.adminRoom(sel.id); setMeta(m);
      setTimeout(() => setOkMsg(''), 2500);
    } catch (e: any) { setErr(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <Text style={st.h}>🚪 ROOM MANAGEMENT</Text>
      <Msg kind="err" text={err} />
      <Msg kind="ok" text={okMsg} />
      {!list ? <Loading /> : !sel ? list.map((t) => (
        <Card key={t.id} style={{ marginBottom: 10 }}>
          <Text style={st.tName}>{t.name}</Text>
          <Text style={st.sub}>{t.date} • {t.time} • {t.teamType}</Text>
          <View style={{ marginTop: 8 }}><Btn title="MANAGE ROOM →" small kind="ghost" onPress={() => open(t)} /></View>
        </Card>
      )) : (
        <Card>
          <Text onPress={() => setSel(null)} style={{ color: C.neon, fontWeight: '900', marginBottom: 8 }}>← BACK</Text>
          <Text style={st.tName}>{sel.name}</Text>
          <Text style={st.sub}>Status: {meta?.roomPublished ? 'PUBLISHED ✅' : 'HIDDEN (not published)'}</Text>
          <Text style={st.sub}>Enter credentials and publish about 10–15 minutes before match start. Published details are visible only to registered players.</Text>
          <Input placeholder="Room ID" value={roomId} onChangeText={setRoomId} />
          <Input placeholder="Room Password" value={roomPassword} onChangeText={setRoomPassword} />
          <Text style={st.lbl}>ROOM TIME (12-HOUR)</Text>
          <TimePicker value={roomTime} onChange={setRoomTime} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            <View style={{ flex: 1 }}><Btn title="💾 SAVE" small kind="ghost" onPress={() => save(false)} loading={busy} /></View>
            <View style={{ flex: 1 }}><Btn title="📢 PUBLISH" small onPress={() => save(true)} loading={busy} /></View>
          </View>
        </Card>
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 30 },
  h: { color: C.text, fontSize: 20, fontWeight: '900', marginBottom: 10, letterSpacing: 1 },
  lbl: { color: C.sub, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  tName: { color: C.text, fontWeight: '900', fontSize: 14 },
  sub: { color: C.sub, fontSize: 11, marginTop: 3 },
});
