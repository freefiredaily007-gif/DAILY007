import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { ReadableText as Text } from './typography';
import { C } from './ui';
import { copyUidToClipboard } from '../lib/copyUidToClipboard';

type CopyStatus = 'idle' | 'copying' | 'copied' | 'failed';

export function CopyUidButton({
  uid,
  testID,
  onCopied,
  onCopyFailed,
}: {
  uid?: string | null;
  testID: string;
  onCopied?: (uid: string) => void;
  onCopyFailed?: (uid: string) => void;
}) {
  const value = String(uid ?? '').trim();
  const [status, setStatus] = useState<CopyStatus>('idle');

  useEffect(() => setStatus('idle'), [value]);

  if (!value) return null;

  const copy = async () => {
    setStatus('copying');
    const copied = await copyUidToClipboard(value, Clipboard.setStringAsync);
    setStatus(copied ? 'copied' : 'failed');
    if (copied) onCopied?.(value);
    else onCopyFailed?.(value);
  };

  const color = status === 'copied' ? C.green : status === 'failed' ? C.red : C.blue;
  const label = status === 'copied'
    ? `Free Fire UID ${value} copied to clipboard`
    : status === 'failed'
      ? `Could not copy Free Fire UID ${value}. Try again.`
      : `Copy Free Fire UID ${value}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Copies this player's Free Fire UID to the clipboard"
      accessibilityState={{ disabled: status === 'copying' }}
      disabled={status === 'copying'}
      onPress={copy}
      testID={testID}
      style={styles.button}
    >
      <Feather
        name={status === 'copied' ? 'check' : status === 'failed' ? 'refresh-cw' : 'copy'}
        size={14}
        color={color}
      />
      <Text style={[styles.text, { color }]}>
        {status === 'copying' ? 'COPYING' : status === 'copied' ? 'COPIED' : status === 'failed' ? 'RETRY' : 'COPY'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 64,
    minHeight: 40,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  text: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
});