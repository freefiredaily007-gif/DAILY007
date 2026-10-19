import React from 'react';
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import modeSoloLogo from '../assets/mode-solo-logo.jpg';
import modeSquadLogo from '../assets/mode-squad-logo.jpg';
import modeClashLogo from '../assets/mode-clash-logo.jpg';
import { ReadableText as Text } from '../components/typography';
import { C, GCard, glow } from '../components/ui';
import { HOME_GAME_MODE_CARDS, homeModeRouteParams } from '../lib/tournamentFilters';

export default function HomeGameModeCards({
  onOpenMode,
  onChooseFormat,
}: {
  onOpenMode: (params: ReturnType<typeof homeModeRouteParams>) => void;
  onChooseFormat: (params: ReturnType<typeof homeModeRouteParams>) => void;
}) {
  const { fontScale } = useWindowDimensions();
  const largeModeCard = fontScale >= 1.5;
  const modes = [
    { ...HOME_GAME_MODE_CARDS[0], img: modeSquadLogo, category: 'CLASSIC SURVIVAL', title: 'BATTLE ROYALE', capacity: 'SOLO · DUO · SQUAD', accent: C.gold },
    { ...HOME_GAME_MODE_CARDS[1], img: modeClashLogo, category: 'TEAM BATTLE', title: 'CLASH SQUAD', capacity: 'SOLO · DUO · SQUAD', accent: C.neon },
    { ...HOME_GAME_MODE_CARDS[2], img: modeSoloLogo, category: '1V1 DUELS', title: 'LONE WOLF', capacity: 'SOLO · DUO · SQUAD', accent: C.purple },
  ];

  return (
    <>
      {modes.map((mode) => {
        const spokenCapacity = mode.capacity
          .split('·')
          .map((size) => size.trim().toLowerCase())
          .filter(Boolean)
          .join(', ');
        const routeParams = homeModeRouteParams(mode);
        return (
          <View key={mode.gameMode}>
            <GCard
              onPress={() => onOpenMode(routeParams)}
              accessibilityLabel={`Open ${mode.mode} tournaments. Available team sizes: ${spokenCapacity}.`}
              accessibilityHint="Shows upcoming, ongoing, and completed tournaments for this game mode"
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
                <Text style={[s.modeKicker, { color: mode.accent }]}>{mode.category}</Text>
                <Text style={s.modeTitle}>{mode.title}</Text>
                <View style={[
                  s.modeCapacityBadge,
                  largeModeCard && s.modeCapacityBadgeLarge,
                  { borderColor: mode.accent + '66', backgroundColor: mode.accent + '14' },
                ]}>
                  <Text style={[
                    s.modeCapacity,
                    largeModeCard && s.modeCapacityLarge,
                    { color: mode.accent },
                  ]}>{mode.capacity}</Text>
                </View>
                <View style={[
                  s.modeBtn,
                  largeModeCard && s.modeBtnLarge,
                  { backgroundColor: mode.accent },
                  glow(mode.accent, 8),
                ]}>
                  <Text style={[s.modeBtnT, largeModeCard && s.modeBtnTLarge]}>BROWSE TOURNAMENTS</Text>
                  <Text style={s.modeBtnArrow} accessibilityElementsHidden>›</Text>
                </View>
              </View>
            </GCard>
            <Pressable
              style={s.formatLink}
              onPress={() => onChooseFormat(routeParams)}
              accessibilityRole="button"
              accessibilityLabel={`Choose Solo, Duo, or Squad ${mode.mode} tournaments`}
              accessibilityHint="Opens the tournament format choices"
              testID={`home-format-${mode.gameMode}`}
            >
              <Text style={s.formatLinkText}>CHOOSE FORMAT · SOLO / DUO / SQUAD</Text>
              <Text style={s.formatLinkArrow} accessibilityElementsHidden>›</Text>
            </Pressable>
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
  formatLink: {
    minHeight: 34, marginHorizontal: 16, marginTop: -6, marginBottom: 12,
    paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: C.blue + '55',
    backgroundColor: C.bg2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  formatLinkText: { color: C.blue, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  formatLinkArrow: { color: C.blue, fontSize: 17, fontWeight: '900', lineHeight: 17 },
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
  modeKicker: { fontWeight: '900', fontSize: 9, letterSpacing: 1.4, lineHeight: 12 },
  modeTitle: { color: C.text, fontWeight: '900', fontSize: 17, letterSpacing: 0.45, lineHeight: 20, marginTop: 4 },
  modeCapacityBadge: {
    alignSelf: 'flex-start', borderWidth: 1, borderRadius: 7,
    paddingHorizontal: 8, paddingVertical: 5, marginTop: 7, maxWidth: '100%',
  },
  modeCapacityBadgeLarge: { alignSelf: 'stretch', alignItems: 'center' },
  modeCapacity: { fontSize: 8.5, fontWeight: '900', letterSpacing: 0.7 },
  modeCapacityLarge: { textAlign: 'center' },
  modeBtn: {
    marginTop: 9, minHeight: 36, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 9,
    alignItems: 'center', justifyContent: 'space-between', flexDirection: 'row',
  },
  modeBtnLarge: { marginTop: 12, minHeight: 52, paddingVertical: 12, paddingHorizontal: 12 },
  modeBtnT: { flex: 1, minWidth: 0, flexShrink: 1, textAlign: 'center', color: '#090b12', fontWeight: '900', letterSpacing: 0.65, fontSize: 9.5 },
  modeBtnTLarge: { fontSize: 12, letterSpacing: 0.4 },
  modeBtnArrow: { color: '#090b12', fontSize: 17, fontWeight: '900', lineHeight: 17 },
});
