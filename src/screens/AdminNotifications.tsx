import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { Api, errMessage } from '../lib/api';
import { Card, Btn, ScreenWrap, useToast, SectionTitle } from '../components/adminKit';

const TYPES = [
  { key: 'all', label: 'ALL USERS' },
  { key: 'tournament', label: 'TOURNAMENT' },
  { key: 'room', label: 'ROOM PUBLISHED' },
  { key: 'winner', label: 'WINNER' },
  { key: 'payment', label: 'PAYMENT' },
];

export default function AdminNotifications() {
  const toast = useToast();
  const [users, setUsers] = useState<any[] | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { Api.adminUsers().then((u) => setUsers(u ?? [])).catch(() => setUsers([])); }, []);

  const send = async () => {
    if (!title.trim() || !body.trim()) return toast('Title and message required', 'error');
    setBusy(true);
    try {
      await Api.adminNotify({ title: title.trim(), body: body.trim(), type, userIds: type === 'selected' ? selected : undefined });
      toast('Notification sent', 'success');
      setTitle(''); setBody(''); setSelected([]);
    } catch (e) { toast(errMessage(e), 'error'); }
    setBusy(false);
  };

  return (
    <ScreenWrap>
      <SectionTitle title="SEND NOTIFICATION" sub="broadcast or target specific users" />
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {TYPES.map((t) => (
            <Text key={t.key} onPress={() => setType(t.key)} style={[st.chip, type === t.key && st.chipOn]}>{t.label}</Text>
          ))}
        </View>
        <TextInput placeholder="Title (e.g. Tournament Announcement)" placeholderTextColor="#5b6478" value={title} onChangeText={setTitle} style={st.input} />
        <TextInput placeholder="Message…" placeholderTextColor="#5b6478" value={body} onChangeText={setBody} multiline style={[st.input, { height: 90, textAlignVertical: 'top' }]} />
        {type === 'selected' && (
          <View style={{ marginTop: 8 }}>
            {(users ?? []).map((u) => {
              const on = selected.includes(u.$id);
              return (
                <Text key={u.$id} onPress={() => setSelected(on ? selected.filter((x) => x !== u.$id) : [...selected, u.$id])} style={[st.user, on && st.userOn]}>
                  {on ? '☑' : '☐'} {u.name}
                </Text>
              );
            })}
          </View>
        )}
        <View style={{ marginTop: 12 }}>
          <Btn title="🚀 SEND NOTIFICATION" onPress={send} loading={busy} />
        </View>
      </Card>
      <SectionTitle title="TEMPLATES" sub="tap to prefill" />
      {[
        { t: 'Tournament Announcement', b: 'A new tournament is live! Register now — limited slots.' },
        { t: 'Room Published', b: 'Room ID & password are now visible in My Matches. Join on time!' },
        { t: 'Winner Announcement', b: 'Congratulations to our BOOYAH winner! Prize coins credited.' },
      ].map((tpl) => (
        <Card key={tpl.t}>
          <Text style={st.tplT} onPress={() => { setTitle(tpl.t); setBody(tpl.b); }}>{tpl.t} ›</Text>
          <Text style={st.tplB}>{tpl.b}</Text>
        </Card>
      ))}
    </ScreenWrap>
  );
}

const st = StyleSheet.create({
  chip: { color: '#9aa3b2', fontSize: 10, fontWeight: '900', letterSpacing: 0.5, backgroundColor: '#0d1326', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, overflow: 'hidden', borderWidth: 1, borderColor: '#232c47' },
  chipOn: { color: '#fff', backgroundColor: '#ff3d3d', borderColor: '#ff3d3d' },
  input: { backgroundColor: '#0d1326', borderRadius: 10, color: '#e6e9ef', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#232c47', marginBottom: 10 },
  user: { color: '#9aa3b2', fontSize: 12.5, paddingVertical: 5, fontWeight: '700' },
  userOn: { color: '#FFC107' },
  tplT: { color: '#ff6b6b', fontWeight: '900', fontSize: 13 },
  tplB: { color: '#5b6478', fontSize: 11.5, marginTop: 3 },
});