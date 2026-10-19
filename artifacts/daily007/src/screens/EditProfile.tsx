// EditProfile — update name, phone, game UID
import React, { useState } from 'react';
import { StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { ReadableText as Text, ReadableTextInput as TextInput } from '../components/typography';
import { Api } from '../lib/api';
import { useApp } from '../App';
import { C, Card, Btn } from '../components/ui';
import { KeyboardAwareScrollViewCompat } from '../../components/KeyboardAwareScrollViewCompat';

type EditProfileProps = {
  updateProfile?: (profile: { name: string; phone: string; gameUid: string }) => Promise<unknown>;
};

export default function EditProfile({ updateProfile = Api.updateProfile }: EditProfileProps) {
  const { user, refresh } = useApp();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [gameUid, setGameUid] = useState(user?.gameUid ?? '');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [refreshError, setRefreshError] = useState('');

  const refreshSavedProfile = async () => {
    setRefreshError('');
    setRefreshing(true);
    try {
      const refreshedUser = await refresh();
      if (!refreshedUser) throw new Error('Profile refresh did not return a user.');
    } catch {
      setRefreshError(
        'Your profile changes were saved, but the latest profile could not be loaded. Check your connection and retry loading your profile.',
      );
    } finally {
      setRefreshing(false);
    }
  };

  const save = async () => {
    if (!name.trim()) { Alert.alert('Missing', 'Name is required'); return; }
    setSaveError('');
    setRefreshError('');
    setSaving(true);
    try {
      await updateProfile({ name: name.trim(), phone: phone.trim(), gameUid: gameUid.trim() });
    } catch (e: any) {
      setSaveError(e?.response?.data?.error ?? e?.message ?? 'Could not update profile. Please try again.');
      setSaving(false);
      return;
    }

    try {
      const refreshedUser = await refresh();
      if (!refreshedUser) throw new Error('Profile refresh did not return a user.');
      Alert.alert('Saved', 'Profile updated');
    } catch {
      setRefreshError(
        'Your profile changes were saved, but the latest profile could not be loaded. Check your connection and retry loading your profile.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      testID="edit-profile-scroll"
      style={s.wrap}
      contentContainerStyle={s.content}
      bottomOffset={64}
      keyboardShouldPersistTaps="handled"
    >
      <Card style={{ gap: 12 }}>
        <Text style={s.label}>NAME</Text>
        <TextInput testID="edit-profile-name" style={s.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={C.sub} />
        <Text style={s.label}>PHONE</Text>
        <TextInput testID="edit-profile-phone" style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Phone number" placeholderTextColor={C.sub} />
        <Text style={s.label}>FREE FIRE UID</Text>
        <TextInput testID="edit-profile-game-uid" style={s.input} value={gameUid} onChangeText={setGameUid} placeholder="In-game UID" placeholderTextColor={C.sub} />
        {saveError ? (
          <Text
            testID="edit-profile-save-error"
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            style={s.saveError}
          >
            {saveError}
          </Text>
        ) : null}
        {refreshError ? (
          <Text
            testID="edit-profile-refresh-error"
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            style={s.saveError}
          >
            {refreshError}
          </Text>
        ) : null}
        {saving || refreshing
          ? <ActivityIndicator color={C.neon} style={{ marginTop: 8 }} />
          : refreshError
            ? <Btn testID="edit-profile-refresh" title="RETRY PROFILE REFRESH" onPress={refreshSavedProfile} />
            : <Btn testID="edit-profile-save" title="SAVE CHANGES" onPress={save} />}
      </Card>
    </KeyboardAwareScrollViewCompat>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { flexGrow: 1, padding: 14, paddingBottom: 24 },
  label: { color: C.sub, fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  input: { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 10, color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  saveError: { color: C.red, fontSize: 14 },
});
