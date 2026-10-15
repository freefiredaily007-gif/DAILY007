import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Redirect } from 'expo-router';
import { C } from '../components/ui';
import { ReadableText as Text } from '../components/typography';
import { homeModeRouteParams } from '../lib/tournamentFilters';
import HomeGameModeCards from './HomeGameModeCards';

type ModeRouteParams = ReturnType<typeof homeModeRouteParams>;

export default function HomeGameModeNativeTextScaleTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <NativeFixture />;
}

function NativeFixture() {
  const { fontScale } = useWindowDimensions();
  const [selectedMode, setSelectedMode] = useState<ModeRouteParams | null>(null);

  if (selectedMode) {
    return (
      <View style={styles.destination}>
        <Text testID="home-mode-destination-title" style={styles.destinationTitle}>
          Filtered tournaments: {selectedMode.gameModeLabel}
        </Text>
        <Text testID="home-mode-destination-filter" style={styles.destinationFilter}>
          Game mode filter: {selectedMode.gameMode}
        </Text>
        <Pressable
          accessibilityRole="button"
          testID="home-mode-destination-back"
          onPress={() => setSelectedMode(null)}
          style={styles.backButton}
        >
          <Text style={styles.backText}>Back to game modes</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      testID="home-mode-text-scale-scroll"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <Text testID="home-mode-text-scale-banner" style={styles.banner}>
        Home game-mode fixture | font scale {fontScale.toFixed(2)}
      </Text>
      <Text style={styles.heading}>GAME MODES</Text>
      <HomeGameModeCards
        onOpenMode={setSelectedMode}
        onChooseFormat={() => {}}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 32 },
  banner: { color: C.sub, fontSize: 11, marginBottom: 8 },
  heading: { color: C.gold, fontSize: 22, fontWeight: '900', marginBottom: 10 },
  destination: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
    padding: 24,
    backgroundColor: C.bg,
  },
  destinationTitle: { color: C.text, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  destinationFilter: { color: C.neon, fontSize: 16, fontWeight: '800' },
  backButton: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 18, backgroundColor: C.card, borderRadius: 12 },
  backText: { color: C.text, fontSize: 14, fontWeight: '800' },
});
