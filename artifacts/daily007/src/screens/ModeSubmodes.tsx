import React from 'react';
import { View, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { ReadableText as Text, swapThemeColor } from '../components/typography';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { C, GCard, SectionTitle } from '../components/ui';
import { submodeRouteParams } from '../lib/tournamentFilters';
import { getTournamentFormatCapacity } from '../lib/tournamentFormatCapacity';

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

export default function ModeSubmodes() {
  const navigation: any = useNavigation();
  const route: any = useRoute();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.5;
  const gameMode = String(route.params?.gameMode || '') as ModeKey;
  const mode = MODES[gameMode];

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
      <View style={styles.formats}>
        {FORMATS.map((format) => {
          const capacity = getTournamentFormatCapacity(gameMode, format.type, format.size);
          const displayAccent = swapThemeColor(format.accent);
          return (
            <GCard
              key={format.type}
              testID={`format-${gameMode}-${format.type}`}
              accessibilityGroup
              accessibilityLabel={`${mode.title}, ${format.title}, ${capacity.playersPerTeam} ${capacity.playersPerTeam === 1 ? 'player' : 'players'} per team, ${capacity.label}`}
              accessibilityHint="Opens available tournaments for this format"
              onPress={() => navigation.navigate(
                'Tournaments',
                submodeRouteParams(gameMode, format.type, mode.title),
              )}
              glowColor={displayAccent}
              style={[styles.formatCard, largeText && styles.formatCardLarge]}
            >
              <View style={[styles.formatContent, largeText && styles.formatContentLarge]}>
                <View style={[styles.formatTopRow, largeText && styles.formatTopRowLarge]}>
                  <View style={[styles.sizeBadge, { borderColor: `${displayAccent}88`, backgroundColor: `${displayAccent}16` }]}>
                    <Text style={[styles.sizeText, { color: format.accent }]}>{capacity.playersPerTeam}P</Text>
                  </View>
                  {largeText && <Ionicons name="chevron-forward" size={20} color={C.sub} />}
                </View>
                <View style={[styles.formatInfo, largeText && styles.formatInfoLarge]}>
                  <Text style={styles.formatName}>{format.title}</Text>
                   <Text style={styles.formatPlayers}>{capacity.playersPerTeam} {capacity.playersPerTeam === 1 ? 'player' : 'players'} per team</Text>
                  <Text style={styles.capacity}>{capacity.label}</Text>
                </View>
                {!largeText && <Ionicons name="chevron-forward" size={20} color={C.sub} />}
              </View>
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
  formatCard: { padding: 14, marginBottom: 0 },
  formatCardLarge: { padding: 16 },
  formatContent: { flexDirection: 'row', alignItems: 'center', gap: 13, minWidth: 0 },
  formatContentLarge: { flexDirection: 'column', alignItems: 'stretch', gap: 12 },
  formatTopRow: { flexDirection: 'row', alignItems: 'center' },
  formatTopRowLarge: { width: '100%', justifyContent: 'space-between' },
  sizeBadge: { width: 46, height: 46, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sizeText: { fontSize: 12, fontWeight: '900' },
  formatInfo: { flex: 1, minWidth: 0 },
  formatInfoLarge: { flex: 0, width: '100%' },
  formatName: { color: C.text, fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
  formatPlayers: { color: C.sub, fontSize: 12, marginTop: 3 },
  capacity: { color: C.neon, fontSize: 11, fontWeight: '800', marginTop: 5 },
  note: { color: C.dim, fontSize: 11, lineHeight: 16, marginTop: 16 },
  errorTitle: { color: C.red, fontSize: 17, fontWeight: '900', margin: 20 },
  errorBody: { color: C.sub, fontSize: 13, lineHeight: 20, marginHorizontal: 20 },
});