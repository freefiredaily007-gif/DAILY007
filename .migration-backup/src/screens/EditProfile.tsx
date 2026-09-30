// EditProfile — update name, phone, game UID
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Api } from '../lib/api';
import { useApp } from '../App';
import { C, Card, Btn } from '../components/ui';

export default function EditProfile() {
  const { user, refresh } = useApp();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [gameUid, setGameUid] = useState(user?.gameUid ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) { Alert.alert('Missing', 'Name is required'); return; }
    setSaving(true);
    try {
      await Api.updateProfile({ name: name.trim(), phone: phone.trim(), gameUid: gameUid.trim() });
      await refresh();
      Alert.alert('Saved', 'Profile updated');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error ?? e.message);
    } finally { setSaving(false); }
  };

  return (
    <View style={s.wrap}>
      <Card style={{ gap: 12 }}>
        <Text style={s.label}>NAME</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={C.sub} />
        <Text style={s.label}>PHONE</Text>
        <TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Phone number" placeholderTextColor={C.sub} />
        <Text style={s.label}>FREE FIRE UID</Text>
        <TextInput style={s.input} value={gameUid} onChangeText={setGameUid} placeholder="In-game UID" placeholderTextColor={C.sub} />
        {saving
          ? <ActivityIndicator color={C.neon} style={{ marginTop: 8 }} />
          : <Btn title="SAVE CHANGES" onPress={save} />}
      </Card>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, padding: 14 },
  label: { color: C.sub, fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  input: { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 10, color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
});
