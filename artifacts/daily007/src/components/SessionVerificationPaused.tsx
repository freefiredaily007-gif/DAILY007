import React, { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { ReadableText as Text } from './typography';
import colors from '../../constants/colors';

const UI = colors.light;

export function SessionVerificationPaused({
  onRetry,
  retrying,
  message = 'Daily007 could not verify your saved sign-in right now. Your session is still saved. Check your connection and try again.',
  children,
}: {
  onRetry: () => void;
  retrying: boolean;
  message?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.screen}>
      <Text testID="session-verification-paused-title" style={styles.title}>
        SESSION VERIFICATION PAUSED
      </Text>
      <Text style={styles.message}>
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry session verification"
        accessibilityState={{ disabled: retrying }}
        disabled={retrying}
        onPress={onRetry}
        style={[styles.retryButton, retrying && styles.retryButtonDisabled]}
        testID="session-verification-retry"
      >
        {retrying
          ? <ActivityIndicator color={UI.primaryForeground} />
          : <Text style={styles.retryButtonText}>RETRY VERIFICATION</Text>}
      </Pressable>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: UI.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  title: {
    color: UI.accent,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.6,
  },
  message: {
    color: '#F5F7FF',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 330,
    marginTop: 14,
    paddingHorizontal: 18,
  },
  retryButton: {
    backgroundColor: UI.primary,
    borderRadius: 12,
    minWidth: 210,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 24,
  },
  retryButtonDisabled: { opacity: 0.72 },
  retryButtonText: { color: UI.primaryForeground, fontFamily: 'Rajdhani_700Bold', fontWeight: '900', letterSpacing: 0.5 },
});
