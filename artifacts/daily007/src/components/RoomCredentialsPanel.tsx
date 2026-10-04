import React from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { ReadableText as Text } from './typography';
import { C, fmtTime12 } from './ui';
import { getRoomCredentialSchedule } from '../lib/roomCredentialTiming';

type Props = {
  startsAt?: Date | string | null;
  now: number;
  configured: boolean;
  roomId?: string | null;
  roomPassword?: string | null;
};

export function RoomCredentialsPanel({
  startsAt,
  now,
  configured,
  roomId,
  roomPassword,
}: Props) {
  const schedule = getRoomCredentialSchedule(startsAt);
  const id = roomId?.trim() ?? '';
  const password = roomPassword?.trim() ?? '';
  const released = configured && !!schedule && now >= schedule.releaseAtMs;
  const credentialsReady = released && !!id && !!password;
  const message = !configured
    ? 'Room details have not been shared yet. Once added, they unlock five minutes before the scheduled start.'
    : !schedule
      ? 'Tournament start time is unavailable. Room details remain hidden.'
      : now < schedule.releaseAtMs
        ? `Room ID & Password will be available at ${fmtTime12(schedule.releaseTime24)} IST.`
        : 'Room details will be available soon.';

  const copy = async (label: string, value: string) => {
    try {
      await Clipboard.setStringAsync(value);
      Alert.alert('Copied', `${label} copied to clipboard.`);
    } catch {
      Alert.alert('Copy failed', `Could not copy ${label.toLowerCase()}.`);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>ROOM DETAILS</Text>
      <View style={styles.panel}>
        {credentialsReady ? (
          <>
            <CredentialRow label="Room ID" value={id} onCopy={() => copy('Room ID', id)} />
            <CredentialRow label="Password" value={password} onCopy={() => copy('Password', password)} />
          </>
        ) : (
          <Text style={styles.notice}>{message}</Text>
        )}
      </View>
    </View>
  );
}

function CredentialRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <View style={styles.credentialRow}>
      <View style={styles.valueGroup}>
        <Text style={styles.label}>{label.toUpperCase()}</Text>
        <Text style={styles.value} selectable>{value}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copy ${label}`}
        onPress={(event) => {
          event.stopPropagation();
          onCopy();
        }}
        style={styles.copyButton}
      >
        <Feather name="copy" size={15} color={C.green} />
        <Text style={styles.copyText}>Copy {label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  title: { color: C.green, fontSize: 10, fontWeight: '900', letterSpacing: 1, marginBottom: 5 },
  panel: { backgroundColor: C.bg2, borderColor: C.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  notice: { color: C.gold, fontSize: 12, fontWeight: '700', lineHeight: 19, paddingVertical: 4 },
  credentialRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 6 },
  valueGroup: { flex: 1, minWidth: 0 },
  label: { color: C.sub, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  value: { color: C.green, fontSize: 14, fontWeight: '900', marginTop: 3 },
  copyButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: C.green, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7 },
  copyText: { color: C.green, fontSize: 11, fontWeight: '800' },
});