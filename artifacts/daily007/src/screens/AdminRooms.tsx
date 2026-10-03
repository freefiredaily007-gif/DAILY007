import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, View, ScrollView, StyleSheet } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { Api, apiError, Tournament } from '../lib/api';
import { Btn, Card, C, Chip, Empty, Input, Loading, Msg } from '../components/ui';
import { getTournamentLifecycleState } from '../lib/tournamentLifecycle';

export default function AdminRooms({
  initialRoomTournamentId,
  onInitialRoomHandled,
}: {
  initialRoomTournamentId?: string | null;
  onInitialRoomHandled?: () => void;
}) {
  const [list, setList] = useState<Tournament[] | null>(null);
  const [sel, setSel] = useState<Tournament | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [roomId, setRoomId] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const initialRoomHandled = useRef(false);

  const load = useCallback(async () => {
    try { setList(await Api.tournaments()); } catch (e: any) { setList([]); setErr(apiError(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = useCallback(async (t: Tournament) => {
    setSel(t); setErr(''); setOkMsg(''); setMeta(null);
    try {
      const m = await Api.adminRoom(t.id);
      setMeta(m);
      setRoomId(m.roomId || ''); setRoomPassword(m.roomPassword || '');
    } catch (e: any) { setErr(apiError(e)); }
  }, []);

  useEffect(() => {
    if (!initialRoomTournamentId || !list || initialRoomHandled.current) return;
    initialRoomHandled.current = true;
    const tournament = list.find((item) => item.id === initialRoomTournamentId);
    if (tournament) void open(tournament);
    else setErr('That tournament is no longer available.');
    onInitialRoomHandled?.();
  }, [initialRoomTournamentId, list, onInitialRoomHandled, open]);

  const save = async () => {
    if (!sel) return;
    setErr(''); setOkMsg(''); setBusy(true);
    try {
      await Api.adminSaveRoom(sel.id, { roomId, roomPassword });
      setOkMsg('Room credentials saved. They will appear to registered players five minutes before the scheduled start.');
      await load();
      const m = await Api.adminRoom(sel.id); setMeta(m);
      setTimeout(() => setOkMsg(''), 2500);
    } catch (e: any) { setErr(apiError(e)); }
    finally { setBusy(false); }
  };

  const clearRoom = async () => {
    if (!sel) return;
    setErr(''); setOkMsg(''); setBusy(true);
    try {
      await Api.adminClearRoom(sel.id);
      setRoomId(''); setRoomPassword('');
      setMeta((current: any) => ({ ...current, roomId: '', roomPassword: '', roomPublished: false }));
      setOkMsg('Room unpublished and deleted. The tournament and registrations are unchanged.');
      setTimeout(() => setOkMsg(''), 3000);
    } catch (e: any) { setErr(apiError(e)); }
    finally { setBusy(false); }
  };

  const confirmClearRoom = () => Alert.alert(
    'Delete room details?',
    'This unpublishes and removes the Room ID and Password. It does not cancel the tournament or change registrations/results.',
    [
      { text: 'Keep room', style: 'cancel' },
      { text: 'Delete room', style: 'destructive', onPress: () => { void clearRoom(); } },
    ],
  );

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <Text style={st.h}>ROOM MANAGEMENT</Text>
      <Msg kind="err" text={err} />
      <Msg kind="ok" text={okMsg} />
      {!list ? <Loading /> : !sel ? list.length === 0 ? <Empty text={err || 'No tournaments found.'} /> : list.map((t) => {
        const lifecycle = getTournamentLifecycleState(t);
        return (
        <Card key={t.id} style={{ marginBottom: 10 }}>
          <Text style={st.tName}>{t.name}</Text>
          <Text style={st.sub}>{t.mode} • {t.teamType} • {t.date} • {t.time} IST • {lifecycle.toUpperCase()}</Text>
          <View style={{ marginTop: 8 }}><Btn title="MANAGE ROOM →" small kind="ghost" onPress={() => open(t)} /></View>
        </Card>
        );
      }) : (
        <Card>
          <Text onPress={() => setSel(null)} style={{ color: C.neon, fontWeight: '900', marginBottom: 8 }}>← BACK</Text>
          <Text style={st.tName}>{sel.name}</Text>
          <Text style={st.sub}>Status: {meta?.roomPublished ? 'SAVED · AUTO-RELEASE AT 5 MINUTES BEFORE START' : 'NOT SAVED · HIDDEN'} · {getTournamentLifecycleState(sel).toUpperCase()}</Text>
          <Text style={st.sub}>Save the Room ID and Password. They are shown only to registered players, automatically from five minutes before the scheduled start.</Text>
          <Input placeholder="Room ID" value={roomId} onChangeText={setRoomId} />
          <Input placeholder="Room Password" value={roomPassword} onChangeText={setRoomPassword} />
          <View style={{ marginTop: 6 }}>
            <Btn
              title="SAVE ROOM DETAILS"
              small
              onPress={() => save()}
              loading={busy}
              disabled={busy || !roomId.trim() || !roomPassword.trim()}
            />
          </View>
          {(!!roomId || !!roomPassword || !!meta?.roomPublished) && (
            <View style={{ marginTop: 8 }}>
              <Btn
                title="CANCEL / DELETE ROOM"
                small
                kind="danger"
                testID={`clear-room-${sel.id}`}
                onPress={confirmClearRoom}
                loading={busy}
              />
            </View>
          )}
        </Card>
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 30 },
  h: { color: C.text, fontSize: 20, fontWeight: '900', marginBottom: 10, letterSpacing: 0.7, fontFamily: 'Inter_700Bold' },
  lbl: { color: C.sub, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  tName: { color: C.text, fontWeight: '900', fontSize: 14 },
  sub: { color: C.sub, fontSize: 11, marginTop: 3 },
});
