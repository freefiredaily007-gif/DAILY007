import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ReadableText as Text } from './typography';
import { useColors } from '@/hooks/useColors';

export type VideoLinkAction = 'browser' | 'copy' | 'youtube' | null;

type VideoLinkRecoveryProps = {
  url: string;
  action: VideoLinkAction;
  status: string;
  copyFailed: boolean;
  onRetryBrowser: () => void;
  onCopyLink: () => void;
};

export function VideoLinkRecovery({
  url,
  action,
  status,
  copyFailed,
  onRetryBrowser,
  onCopyLink,
}: VideoLinkRecoveryProps) {
  const colors = useColors();
  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderRadius: colors.radius,
      borderWidth: 1,
      gap: 12,
      padding: 14,
    },
    heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    error: { color: colors.destructive, flex: 1, fontSize: 13, lineHeight: 19 },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: 14,
      rowGap: 4,
    },
    button: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
    },
    buttonText: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
    status: { color: colors.accent, fontSize: 12, lineHeight: 18 },
    url: { color: colors.primary, fontSize: 12, lineHeight: 18, textDecorationLine: 'underline' },
  });

  return (
    <View style={styles.card} testID="video-open-link-error">
      <View style={styles.heading}>
        <Feather name="alert-circle" size={18} color={colors.destructive} />
        <Text
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          style={styles.error}
        >
          Couldn’t open this video in YouTube or your browser. Retry the browser link or copy it to open it manually.
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry opening the video in your browser"
          accessibilityHint="Opens the saved video link directly in your browser."
          accessibilityState={{ busy: action === 'browser', disabled: action !== null }}
          testID="video-retry-browser"
          disabled={action !== null}
          onPress={onRetryBrowser}
          style={styles.button}
        >
          <Feather name="refresh-cw" size={15} color={colors.primary} />
          <Text style={styles.buttonText}>
            {action === 'browser' ? 'OPENING BROWSER…' : 'RETRY IN BROWSER'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy video link"
          accessibilityHint="Copies the saved video URL so you can paste it into another app."
          accessibilityState={{ busy: action === 'copy', disabled: action !== null }}
          testID="video-copy-link"
          disabled={action !== null}
          onPress={onCopyLink}
          style={styles.button}
        >
          <Feather name="copy" size={15} color={colors.primary} />
          <Text style={styles.buttonText}>
            {action === 'copy' ? 'COPYING LINK…' : 'COPY VIDEO LINK'}
          </Text>
        </Pressable>
      </View>
      {status ? (
        <Text
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          testID="video-open-link-status"
          style={styles.status}
        >
          {status}
        </Text>
      ) : null}
      {copyFailed ? (
        <Text
          accessibilityRole="text"
          selectable
          testID="video-manual-link"
          style={styles.url}
        >
          {url}
        </Text>
      ) : null}
    </View>
  );
}
