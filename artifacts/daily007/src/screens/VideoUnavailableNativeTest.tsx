import React, { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import {
  VideoCatalogBackButton,
  VideoUnavailableErrorAnnouncement,
} from '../components/VideoAccessibilityControls';
import { C } from '../components/ui';
import { shouldRefreshVideoCatalogOnFocus } from '../lib/videoCatalogRefresh';

const UNAVAILABLE_MESSAGE = 'This video is unavailable.';

export default function VideoUnavailableNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <VideoUnavailableFixture />;
}

function VideoUnavailableFixture() {
  const [showPlayer, setShowPlayer] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [catalogRefreshCount, setCatalogRefreshCount] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setErrorMessage(UNAVAILABLE_MESSAGE), 350);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!shouldRefreshVideoCatalogOnFocus({
      isFocused: true,
      isAppActive: true,
      isPlayerOpen: showPlayer,
    })) return;
    setCatalogRefreshCount((count) => count + 1);
  }, [showPlayer]);

  if (!showPlayer) {
    return (
      <View style={styles.screen}>
        <Text testID="video-catalog" style={styles.text}>Video catalog</Text>
        <Text testID="video-catalog-refresh-state" style={styles.text}>
          Video catalog refreshed after returning.
        </Text>
        <Text testID="video-catalog-refresh-count" style={styles.text}>
          Refresh count: {catalogRefreshCount}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text testID="video-unavailable-fixture-banner" style={styles.text}>
        Unavailable video accessibility fixture
      </Text>
      <VideoCatalogBackButton
        onPress={() => setShowPlayer(false)}
        buttonStyle={styles.backButton}
        textStyle={styles.backText}
        primaryColor={C.blue}
      />
      <View style={styles.progress}>
        <Text testID="video-progress-value" style={styles.text}>0%</Text>
        <View
          accessibilityLabel="0% estimated watched, 75% reward marker"
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: 0 }}
          testID="video-progress-track"
          style={styles.progressTrack}
        />
      </View>
      {errorMessage ? (
        <VideoUnavailableErrorAnnouncement
          message={errorMessage}
          announce
          containerStyle={styles.errorCard}
          textStyle={styles.text}
          iconColor={C.red}
        />
      ) : (
        <Text testID="video-unavailable-fixture-pending" style={styles.text}>
          Starting video…
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 16,
    gap: 16,
    backgroundColor: C.bg,
  },
  text: { color: C.text },
  backButton: {
    minHeight: 48,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backText: { color: C.blue, fontWeight: '700' },
  progress: { gap: 8 },
  progressTrack: {
    height: 12,
    borderRadius: 6,
    backgroundColor: C.border,
  },
  errorCard: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
});
