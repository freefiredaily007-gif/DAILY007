import React from 'react';
import { View, ScrollView, StyleSheet, Image } from 'react-native';
import { ReadableText as Text, swapThemeColor } from '../components/typography';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { C, GCard, SectionTitle } from '../components/ui';
import { submodeRouteParams } from '../lib/tournamentFilters';
import battleRoyaleSoloPoster from '../assets/battle-royale-solo-poster.jpg';
import battleRoyaleDuoPoster from '../assets/battle-royale-duo-poster.jpg';
import battleRoyaleSquadPoster from '../assets/battle-royale-squad-poster.jpg';

type ModeKey = 'battle_royale' | 'clash_squad' | 'lone_wolf';
type TeamType = 'solo' | 'duo' | 'squad';

const MODES: Record<ModeKey, { title: string; kicker: string; icon: keyof typeof Ionicons.glyphMap; accent: string }> = {
  battle_royale: { title: 'BATTLE ROYALE', kicker: 'CLASSIC SURVIVAL', icon: 'flame-outline', accent: C.gold },
  clash_squad: { title: 'CLASH SQUAD', kicker: 'TEAM BATTLE', icon: 'shield-outline', accent: C.neon },
  lone_wolf: { title: 'LONE WOLF', kicker: 'DUEL ARENA', icon: 'flash-outline', accent: C.purple },
};

const FORMATS: { type: TeamType; title: string; size: number; accent: string }[] = [
  { type: 'solo', title: 'SOLO', size: 1, accent: C.blue },
  { type: 'duo', title: 'DUO', size: 2, accent: C.orange },
  { type: 'squad', title: 'SQUAD', size: 4, accent: C.purple },
];

const BATTLE_ROYALE_POSTERS: Record<TeamType, typeof battleRoyaleSoloPoster> = {
  solo: battleRoyaleSoloPoster,
  duo: battleRoyaleDuoPoster,
  squad: battleRoyaleSquadPoster,
};

function capacityFor(gameMode: ModeKey, type: TeamType, playersPerTeam: number) {
  if (gameMode === 'battle_royale') {
    if (type === 'solo') return { slots: 48, label: '48 player slots' };
    return {
      slots: type === 'duo' ? 24 : 12,
      label: `${type === 'duo' ? 24 : 12} team slots · 48 players`,
    };
  }
  return { slots: 2, label: `2 team slots · ${playersPerTeam * 2} players` };
}

export default function ModeSubmodes() {
  const navigation: any = useNavigation();
  const route: any = useRoute();
  const gameMode = String(route.params?.gameMode || '') as ModeKey;
  const mode = MODES[gameMode];
  const isBattleRoyale = gameMode === 'battle_royale';

  if (!mode) {
    return (
      <View style={styles.root}>
        <Text style={styles.errorTitle}>GAME MODE NOT FOUND</Text>
        <Text style={styles.errorBody}>Return to Home and choose one of the available game modes.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={[styles.hero, { borderColor: `${mode.accent}66` }]}>
        <View style={[styles.iconWrap, { borderColor: `${mode.accent}66`, backgroundColor: `${mode.accent}18` }]}>
          <Ionicons name={mode.icon} size={28} color={mode.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.kicker, { color: mode.accent }]}>{mode.kicker}</Text>
          <Text style={styles.title}>{mode.title}</Text>
          <Text style={styles.subtitle}>Choose a tournament format</Text>
        </View>
      </View>

      <SectionTitle accent={mode.accent}>SELECT YOUR FORMAT</SectionTitle>
      <View style={isBattleRoyale ? styles.posterFormats : styles.formats}>
        {FORMATS.map((format) => {
          const capacity = capacityFor(gameMode, format.type, format.size);
          const displayAccent = swapThemeColor(format.accent);
          return (
            <GCard
              key={format.type}
              testID={`format-${gameMode}-${format.type}`}
              accessibilityLabel={`${mode.title} ${format.title}, ${capacity.label}`}
              accessibilityHint="Opens available tournaments for this format"
              onPress={() => navigation.navigate(
                'Tournaments',
                submodeRouteParams(gameMode, format.type, mode.title),
              )}
              glowColor={displayAccent}
              style={isBattleRoyale ? styles.posterFormatCard : styles.formatCard}
            >
              {isBattleRoyale ? (
                <Image
                  source={BATTLE_ROYALE_POSTERS[format.type]}
                  style={styles.posterFormatImage}
                  resizeMode="contain"
                />
              ) : (
                <>
                  <View style={[styles.sizeBadge, { borderColor: `${displayAccent}88`, backgroundColor: `${displayAccent}16` }]}>
                    <Text style={[styles.sizeText, { color: format.accent }]}>{format.size}P</Text>
                  </View>
                  <View style={styles.formatInfo}>
                    <Text style={styles.formatName}>{format.title}</Text>
                    <Text style={styles.formatPlayers}>{format.size} {format.size === 1 ? 'player' : 'players'} per team</Text>
                    <Text style={styles.capacity}>{capacity.label}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={C.sub} />
                </>
              )}
            </GCard>
          );
        })}
      </View>
      <Text style={styles.note}>Team registrations reserve one slot. The captain pays the entry fee once for the registration.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 34 },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginBottom: 20,
    borderWidth: 1, borderRadius: 16, backgroundColor: C.card,
  },
  iconWrap: { width: 54, height: 54, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: C.text, fontSize: 19, fontWeight: '900', marginTop: 3 },
  subtitle: { color: C.sub, fontSize: 12, marginTop: 3 },
  formats: { gap: 11 },
  posterFormats: { flexDirection: 'row', gap: 9 },
  posterFormatCard: {
    flex: 1, aspectRatio: 1, padding: 0, marginBottom: 0, overflow: 'hidden',
    borderRadius: 12, borderWidth: 1, borderColor: C.gold + '88', backgroundColor: C.card,
  },
  posterFormatImage: { width: '100%', height: '100%' },
  formatCard: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14, marginBottom: 0 },
  sizeBadge: { width: 46, height: 46, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sizeText: { fontSize: 12, fontWeight: '900' },
  formatInfo: { flex: 1 },
  formatName: { color: C.text, fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
  formatPlayers: { color: C.sub, fontSize: 12, marginTop: 3 },
  capacity: { color: C.neon, fontSize: 11, fontWeight: '800', marginTop: 5 },
  note: { color: C.dim, fontSize: 11, lineHeight: 16, marginTop: 16 },
  errorTitle: { color: C.red, fontSize: 17, fontWeight: '900', margin: 20 },
  errorBody: { color: C.sub, fontSize: 13, lineHeight: 20, marginHorizontal: 20 },
});