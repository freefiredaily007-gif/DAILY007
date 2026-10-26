import React from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import modeSoloLogo from '../assets/mode-solo-logo.jpg';
import modeSquadLogo from '../assets/mode-squad-logo.jpg';
import modeClashLogo from '../assets/mode-clash-logo.jpg';
import { ReadableText as Text } from '../components/typography';
import { C, GCard, glow } from '../components/ui';
import {
  nativeTextScaleTextProps,
  type NativeTextScaleLayoutObserver,
} from '../lib/nativeTextScaleLayout';
import {
  HOME_GAME_MODE_CARDS,
  homeModeRouteParams,
  type HomeOpenTournamentCounts,
} from '../lib/tournamentFilters';

export default function HomeGameModeCards({
  modeCounts,
  modeCountsReady,
  onOpenMode,
  onTextScaleLayout,
}: {
  modeCounts?: HomeOpenTournamentCounts;
  modeCountsReady?: boolean;
  onOpenMode: (params: ReturnType<typeof homeModeRouteParams>) => void;
  onTextScaleLayout?: NativeTextScaleLayoutObserver;
}) {
  const { fontScale } = useWindowDimensions();
  const largeModeCard = fontScale >= 1.5;
  const modes = [
    {
      ...HOME_GAME_MODE_CARDS[3],
      img: modeSquadLogo,
      title: 'BATTLE ROYALE KILL & EARN',
      accent: C.orange,
    },
    {
      ...HOME_GAME_MODE_CARDS[0],
      img: modeSquadLogo,
      title: 'BATTLE ROYALE',
      accent: C.gold,
    },
    {
      ...HOME_GAME_MODE_CARDS[1],
      img: modeClashLogo,
      title: 'CLASH SQUAD',
      accent: C.neon,
    },
    {
      ...HOME_GAME_MODE_CARDS[2],
      img: modeSoloLogo,
      title: 'LONE WOLF',
      accent: C.purple,
    },
  ];

  return (
    <>
      {modes.map((mode) => {
        const liveCount = modeCounts?.[mode.gameMode];
        const showLiveCount = modeCountsReady === true &&
          typeof liveCount === 'number' &&
          Number.isSafeInteger(liveCount);
        const routeParams = homeModeRouteParams(mode);
        return (
          <View key={mode.gameMode}>
            <GCard
              onPress={() => onOpenMode(routeParams)}
              accessibilityLabel={`Open ${mode.mode} tournaments.${showLiveCount ? ` ${liveCount} currently open for registration.` : ''}`}
              accessibilityHint="Opens the tournament list filtered to this game mode"
              testID={`home-mode-${mode.mode.toLowerCase().replace(/[^a-z]+/g, '-')}`}
              glowColor={mode.accent}
              style={[s.modeCard, largeModeCard && s.modeCardLarge, { borderLeftColor: mode.accent }]}
            >
              <View style={[s.modeArtWrap, largeModeCard && s.modeArtWrapLarge]}>
                <Image
                  source={mode.img}
                  style={[s.modeBanner, largeModeCard && s.modeBannerLarge]}
                  resizeMode="contain"
                />
              </View>
              <View style={[s.modeBody, largeModeCard && s.modeBodyLarge]}>
                <View style={s.modeTitleRow}>
                  <Text
                    {...nativeTextScaleTextProps(`${mode.gameMode}:title`, onTextScaleLayout)}
                    style={s.modeTitle}
                  >
                    {mode.title}
                  </Text>
                  {showLiveCount && (
                    <View
                      testID={`home-mode-live-count-${mode.gameMode}`}
                      style={s.modeLiveBadge}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      <View style={s.modeLiveDot} />
                      <Text style={s.modeLiveText}>LIVE {liveCount}</Text>
                    </View>
                  )}
                </View>
              </View>
            </GCard>
          </View>
        );
      })}
    </>
  );
}

const s = StyleSheet.create({
  modeCard: {
    marginHorizontal: 16, marginBottom: 12, padding: 10, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'stretch', minHeight: 146,
    backgroundColor: '#11182a', borderRadius: 16, borderWidth: 1,
    borderColor: '#28314b', borderLeftWidth: 4,
  },
  modeCardLarge: { flexDirection: 'column', alignItems: 'stretch', padding: 12, gap: 8 },
  modeArtWrap: {
    width: 104, height: 124, borderRadius: 12, overflow: 'hidden',
    backgroundColor: '#090d18', borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  modeArtWrapLarge: { width: '100%', height: 80 },
  modeBanner: { width: '100%', height: '100%', minHeight: 124 },
  modeBannerLarge: { minHeight: 0 },
  modeBody: { flex: 1, minWidth: 0, justifyContent: 'center', paddingLeft: 12, paddingRight: 2, paddingVertical: 3 },
  modeBodyLarge: {
    flexGrow: 0, flexShrink: 0, flexBasis: 'auto',
    paddingLeft: 0, paddingRight: 0, paddingVertical: 2,
  },
  modeTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 7, rowGap: 4, marginTop: 4 },
  modeTitle: { color: C.text, fontWeight: '900', fontSize: 17, letterSpacing: 0.45, lineHeight: 20, flexShrink: 1 },
  modeLiveBadge: {
    minHeight: 36, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1.5,
    borderColor: C.green, backgroundColor: C.green + '16',
    flexDirection: 'row', alignItems: 'center', columnGap: 4,
    ...glow(C.green, 10),
  },
  modeLiveDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: C.green },
  modeLiveText: { color: C.green, fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },
});
