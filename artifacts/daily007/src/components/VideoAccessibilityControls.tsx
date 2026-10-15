import React from 'react';
import { Feather } from '@expo/vector-icons';
import {
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { ReadableText as Text } from './typography';
import { useColors } from '@/hooks/useColors';

type VideoCatalogBackButtonProps = {
  onPress: () => void;
  buttonStyle: PressableProps['style'];
  textStyle: StyleProp<TextStyle>;
  primaryColor: string;
};

export function VideoCatalogBackButton({
  onPress,
  buttonStyle,
  textStyle,
  primaryColor,
}: VideoCatalogBackButtonProps) {
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel="Back to videos"
      testID="video-catalog-back"
      onPress={onPress}
      style={buttonStyle}
    >
      <Feather
        name="arrow-left"
        size={17}
        color={primaryColor}
        accessible={false}
        importantForAccessibility="no"
      />
      <Text accessible={false} style={textStyle}>BACK TO VIDEOS</Text>
    </Pressable>
  );
}

type VideoUnavailableErrorAnnouncementProps = {
  message: string;
  announce: boolean;
  containerStyle: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  iconColor: string;
};

export function VideoUnavailableErrorAnnouncement({
  message,
  announce,
  containerStyle,
  textStyle,
  iconColor,
}: VideoUnavailableErrorAnnouncementProps) {
  return (
    <View
      accessible={false}
      testID="video-watch-error"
      style={containerStyle}
    >
      <Feather
        name="alert-circle"
        size={16}
        color={iconColor}
        accessible={false}
        importantForAccessibility="no"
      />
      <Text
        accessibilityRole="text"
        accessibilityLiveRegion={announce ? 'polite' : undefined}
        testID="video-watch-error-message"
        style={textStyle}
      >
        {message}
      </Text>
    </View>
  );
}

type VideoEmbedFailureRecoveryProps = {
  busy: boolean;
  onOpenYouTube: () => void;
};

export function VideoEmbedFailureRecovery({
  busy,
  onOpenYouTube,
}: VideoEmbedFailureRecoveryProps) {
  const colors = useColors();
  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderRadius: colors.radius,
      borderWidth: 1,
      gap: 10,
      marginTop: 10,
      padding: 12,
    },
    messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    message: { color: colors.mutedForeground, flex: 1, fontSize: 12, lineHeight: 18 },
    button: {
      alignSelf: 'flex-start',
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
    },
    buttonText: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  });

  return (
    <View accessible={false} style={styles.card} testID="video-embed-failure">
      <View style={styles.messageRow}>
        <Feather
          name="alert-circle"
          size={18}
          color={colors.destructive}
          accessible={false}
          importantForAccessibility="no"
        />
        <Text
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          testID="video-embed-failure-message"
          style={styles.message}
        >
          This video could not be embedded. Open it on YouTube instead.
        </Text>
      </View>
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel="Open on YouTube"
        accessibilityHint="Opens this video in YouTube."
        accessibilityState={{ busy, disabled: busy }}
        testID="video-open-youtube-recovery"
        disabled={busy}
        onPress={onOpenYouTube}
        style={styles.button}
      >
        <Feather
          name="external-link"
          size={15}
          color={colors.primary}
          accessible={false}
          importantForAccessibility="no"
        />
        <Text accessible={false} style={styles.buttonText}>
          {busy ? 'OPENING VIDEO…' : 'OPEN ON YOUTUBE'}
        </Text>
      </Pressable>
    </View>
  );
}
