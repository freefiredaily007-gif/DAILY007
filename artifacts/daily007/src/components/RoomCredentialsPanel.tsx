import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { ReadableText as Text } from './typography';
import { C, fmtTime12 } from './ui';
import { copyRoomCredentialToClipboard, type RoomCredentialCopyFeedback } from '../lib/roomCredentialCopy';
import {
  getRoomCredentialSchedule,
  hasServerAuthorizedRoomCredentials,
} from '../lib/roomCredentialTiming';
import { shouldStackRoomCredentialRows } from '../lib/roomCredentialLayout';

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
  const { fontScale, width } = useWindowDimensions();
  const stackCredentialRows = shouldStackRoomCredentialRows(fontScale, width);
  const schedule = getRoomCredentialSchedule(startsAt);
  const id = roomId?.trim() ?? '';
  const password = roomPassword?.trim() ?? '';
  const [copyFeedback, setCopyFeedback] = useState<RoomCredentialCopyFeedback | null>(null);
  const [simulateClipboardFailure, setSimulateClipboardFailure] = useState(false);
  const credentialsReady = hasServerAuthorizedRoomCredentials(id, password);
  const message = !schedule
    ? 'Tournament start time is unavailable. Room details remain hidden.'
    : now < schedule.releaseAtMs
      ? `Room ID & Password will show here at ${fmtTime12(schedule.releaseTime24)} IST.`
      : !configured
        ? 'The admin has not shared room details yet.'
        : 'Room details will be available soon.';

  useEffect(() => {
    setCopyFeedback(null);
  }, [credentialsReady, id, password]);

  const copy = async (label: string, value: string) => {
    const writeClipboard = __DEV__ && simulateClipboardFailure
      ? async () => { throw new Error('Simulated clipboard failure'); }
      : (clipboardValue: string) => Clipboard.setStringAsync(clipboardValue);
    const feedback = await copyRoomCredentialToClipboard(
      label,
      value,
      writeClipboard,
    );
    setCopyFeedback(feedback);
    AccessibilityInfo.announceForAccessibility(feedback.message);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>ROOM DETAILS</Text>
      <View style={styles.panel}>
        {credentialsReady ? (
          <>
            <CredentialRow
              label="Room ID"
              value={id}
              onCopy={() => copy('Room ID', id)}
              stackRows={stackCredentialRows}
            />
            <CredentialRow
              label="Password"
              value={password}
              onCopy={() => copy('Password', password)}
              stackRows={stackCredentialRows}
            />
            {__DEV__ ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  simulateClipboardFailure
                    ? 'Stop simulating clipboard failures'
                    : 'Simulate clipboard failures'
                }
                accessibilityHint="Toggle a development-only failure for both room credential copy buttons."
                onPress={() => {
                  const nextValue = !simulateClipboardFailure;
                  setSimulateClipboardFailure(nextValue);
                  AccessibilityInfo.announceForAccessibility(
                    nextValue
                      ? 'Clipboard failure simulation on.'
                      : 'Clipboard failure simulation off.',
                  );
                }}
                testID="room-credential-simulate-clipboard-failure"
                style={styles.devTestButton}
              >
                <Text accessible={false} style={styles.devTestButtonText}>
                  {simulateClipboardFailure
                    ? 'DEV TEST: clipboard failures ON'
                    : 'DEV TEST: simulate clipboard failures'}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <Text style={styles.notice}>{message}</Text>
        )}
        {credentialsReady && copyFeedback ? (
          <Text
            accessibilityRole="text"
            testID="room-credential-copy-feedback"
            style={[
              styles.copyFeedback,
              copyFeedback.kind === 'failure' && styles.copyFeedbackFailure,
            ]}
          >
            {copyFeedback.message}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function CredentialRow({
  label,
  value,
  onCopy,
  stackRows,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  stackRows: boolean;
}) {
  return (
    <View style={[styles.credentialRow, stackRows && styles.credentialRowStacked]}>
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${label}: ${value}`}
        testID={`room-credential-value-${label.toLowerCase().replace(/\s+/g, '-')}`}
        style={styles.valueGroup}
      >
        <Text accessible={false} style={styles.label}>{label.toUpperCase()}</Text>
        <Text accessible={false} style={styles.value} selectable>{value}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copy ${label}`}
        accessibilityHint="Copies this value to your clipboard."
        onPress={(event) => {
          event.stopPropagation();
          onCopy();
        }}
        testID={`room-credential-copy-${label.toLowerCase().replace(/\s+/g, '-')}`}
        style={[styles.copyButton, stackRows && styles.copyButtonStacked]}
      >
        <Feather accessible={false} name="copy" size={15} color={C.green} />
        <Text accessible={false} style={styles.copyText}>Copy {label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  title: { color: C.green, fontSize: 10, fontWeight: '900', letterSpacing: 1, marginBottom: 5 },
  panel: { backgroundColor: C.bg2, borderColor: C.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  notice: { color: C.gold, fontSize: 12, fontWeight: '700', lineHeight: 19, paddingVertical: 4 },
  copyFeedback: { color: C.green, fontSize: 11, fontWeight: '700', lineHeight: 16, marginTop: 6 },
  copyFeedbackFailure: { color: C.red },
  devTestButton: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', borderWidth: 1, borderColor: C.gold, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7, marginTop: 6 },
  devTestButtonText: { color: C.gold, fontSize: 11, fontWeight: '800' },
  credentialRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 6 },
  credentialRowStacked: { flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', gap: 8 },
  valueGroup: { flex: 1, minWidth: 0 },
  label: { color: C.sub, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  value: { color: C.green, fontSize: 14, fontWeight: '900', marginTop: 3 },
  copyButton: { minHeight: 40, maxWidth: '100%', flexShrink: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: C.green, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7 },
  copyButtonStacked: { alignSelf: 'flex-start' },
  copyText: { flexShrink: 1, color: C.green, fontSize: 11, fontWeight: '800' },
});