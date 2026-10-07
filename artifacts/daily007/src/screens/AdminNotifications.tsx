import { useState } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { ReadableText as Text, ReadableTextInput as TextInput } from '../components/typography';
import { Api, errMessage, type User } from '../lib/api';
import { A, Card, Btn, ScreenWrap, useToast, SectionTitle } from '../components/adminKit';

const TYPES = [
  { key: 'all', label: 'ALL USERS' },
  { key: 'tournament', label: 'TOURNAMENT' },
  { key: 'room', label: 'ROOM PUBLISHED' },
  { key: 'winner', label: 'WINNER' },
  { key: 'payment', label: 'PAYMENT' },
  { key: 'selected', label: 'SELECT USERS' },
];

export default function AdminNotifications() {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState('all');
  const [users, setUsers] = useState<User[] | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const loadUsers = async () => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const response: unknown = await Api.adminUsers();
      if (!Array.isArray(response)) throw new Error('Could not load users. Please try again.');
      setUsers(response);
    } catch (e) {
      setUsers(null);
      setUsersError(errMessage(e));
    } finally {
      setUsersLoading(false);
    }
  };

  const send = async () => {
    if (busy) return;
    if (!title.trim() || !body.trim()) return toast('Title and message required', 'error');
    if (type === 'selected') {
      if (usersLoading || !users || usersError) return toast('Wait for users to load before sending', 'error');
      if (!selected.length) return toast('Select at least one user', 'error');
    }
    setBusy(true);
    try {
      await Api.adminSendNotification({
        title: title.trim(), body: body.trim(), type,
        ...(type === 'selected' ? { userIds: selected } : {}),
      });
      toast('Notification sent', 'success');
      setTitle(''); setBody(''); setSelected([]);
    } catch (e) { toast(errMessage(e), 'error'); }
    finally { setBusy(false); }
  };

  const visibleUsers = (users ?? []).filter((u) =>
    `${u.name ?? ''} ${u.email ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <ScreenWrap>
      <SectionTitle title="SEND NOTIFICATION" sub="broadcast or target specific users" />
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {TYPES.map((t) => (
            <Pressable key={t.key} onPress={() => {
              setType(t.key);
              if (t.key === 'selected' && users === null && !usersLoading) void loadUsers();
            }} accessibilityRole="button" accessibilityState={{ selected: type === t.key }} testID={`notification-type-${t.key}`}>
              <Text style={[st.chip, type === t.key && st.chipOn]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput testID="admin-notification-title" placeholder="Title (e.g. Tournament Announcement)" placeholderTextColor="#5b6478" value={title} onChangeText={setTitle} style={st.input} />
        <TextInput testID="admin-notification-body" placeholder="Message…" placeholderTextColor="#5b6478" value={body} onChangeText={setBody} multiline style={[st.input, { height: 90, textAlignVertical: 'top' }]} />
        {type === 'selected' && (
          <View style={st.recipients}>
            <Text style={st.label}>RECIPIENTS · {selected.length} selected</Text>
            {usersLoading ? <ActivityIndicator color={A.red} /> : usersError ? (
              <View>
                <Text style={st.error}>{usersError}</Text>
                <Btn title="RETRY LOADING USERS" kind="ghost" onPress={() => void loadUsers()} />
              </View>
            ) : users ? (
              <>
                <TextInput testID="admin-notification-recipient-search" placeholder="Search name or email…" placeholderTextColor={A.sub} value={search} onChangeText={setSearch} style={st.input} />
                {users.length === 0 && <Text style={st.hint}>No users available.</Text>}
                {users.length > 0 && visibleUsers.length === 0 && <Text style={st.hint}>No matching users.</Text>}
                {visibleUsers.map((u) => {
                  const id = u.$id ?? u.id;
                  if (!id) return null;
                  const on = selected.includes(id);
                  return (
                    <Pressable key={id} onPress={() => setSelected((current) =>
                      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
                    )} accessibilityRole="checkbox" accessibilityState={{ checked: on }} testID={`notification-recipient-${id}`} style={[st.user, on && st.userOn]}>
                      <Text style={st.userMark}>{on ? '✓' : '○'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={st.userName}>{u.name}</Text>
                        <Text style={st.userEmail}>{u.email}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </>
            ) : null}
          </View>
        )}
        <View style={{ marginTop: 12 }}>
          <Btn testID="admin-notification-send" title="SEND NOTIFICATION" onPress={send} loading={busy} disabled={type === 'selected' && (usersLoading || !!usersError || !users)} />
        </View>
      </Card>
      <SectionTitle title="TEMPLATES" sub="tap to prefill" />
      {[
        { t: 'Tournament Announcement', b: 'A new tournament is live! Register now — limited slots.' },
        { t: 'Room Published', b: 'Room ID & password are now visible in My Matches. Join on time!' },
        { t: 'Winner Announcement', b: 'Congratulations to our BOOYAH winner! Please check the announced results and reward status.' },
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
  chip: { color: A.sub, fontSize: 10, fontWeight: '900', letterSpacing: 0.5, backgroundColor: A.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, overflow: 'hidden', borderWidth: 1, borderColor: A.border },
  chipOn: { color: A.bg, backgroundColor: A.red, borderColor: A.red },
  input: { backgroundColor: '#0d1326', borderRadius: 10, color: '#e6e9ef', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#232c47', marginBottom: 10 },
  recipients: { marginTop: 6 },
  label: { color: A.text, fontSize: 11, fontWeight: '900', marginBottom: 10 },
  hint: { color: A.sub, fontSize: 12, marginBottom: 8 },
  error: { color: A.danger, fontSize: 12, marginBottom: 10 },
  user: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: A.border, borderRadius: 8, padding: 10, marginBottom: 6 },
  userOn: { borderColor: A.red, backgroundColor: A.redSoft },
  userMark: { color: A.red, fontSize: 18, width: 22 },
  userName: { color: A.text, fontSize: 13, fontWeight: '700' },
  userEmail: { color: A.sub, fontSize: 11, marginTop: 2 },
  tplT: { color: '#ff6b6b', fontWeight: '900', fontSize: 13 },
  tplB: { color: '#5b6478', fontSize: 11.5, marginTop: 3 },
});