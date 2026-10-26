import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Redirect } from 'expo-router';
import { NavigationContext } from '@react-navigation/native';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { RoomCredentialsPanel } from '../components/RoomCredentialsPanel';
import { TournamentModeFilters } from '../components/TournamentModeFilters';
import { ReadableText as Text } from '../components/typography';
import { C, MatchCard } from '../components/ui';
import { GAME_MODE_FILTERS, type TournamentModeFilterKey } from '../lib/tournamentModeFilterOptions';
import { i18n, type AppLanguage } from '../i18n';
import {
  mergeNativeTextScaleLayout,
  nativeTextScaleLayoutsFit,
  type NativeTextScaleLayout,
} from '../lib/nativeTextScaleLayout';

const UPCOMING_START = '2027-10-28T12:30:00.000Z';
const ROOM_START = new Date(Date.now() - 15 * 60_000).toISOString();
const LANGUAGES: readonly { value: AppLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'gu', label: 'ગુજરાતી' },
];

const LOCALIZED_TITLES: Record<AppLanguage, readonly string[]> = {
  en: [
    'International Kill & Earn Championship With Extended Finals Schedule',
    'International Battle Royale Classic Championship Across Multiple Regions',
    'International Clash Squad Championship With A Four-Round Final',
    'International Lone Wolf Championship With Extended Qualifiers',
  ],
  hi: [
    'अंतरराष्ट्रीय बैटल रॉयल किल एंड अर्न चैंपियनशिप लंबे फाइनल मुकाबलों के साथ',
    'कई क्षेत्रों में अंतरराष्ट्रीय बैटल रॉयल क्लासिक चैंपियनशिप का आयोजन',
    'चार दौर के फाइनल के साथ अंतरराष्ट्रीय क्लैश स्क्वाड चैंपियनशिप',
    'विस्तारित क्वालीफायर के साथ अंतरराष्ट्रीय लोन वुल्फ चैंपियनशिप',
  ],
  gu: [
    'આંતરરાષ્ટ્રીય બેટલ રોયલ કિલ અને અર્ન ચેમ્પિયનશિપ લાંબી ફાઇનલ સાથે',
    'ઘણા પ્રદેશોમાં આંતરરાષ્ટ્રીય બેટલ રોયલ ક્લાસિક ચેમ્પિયનશિપ',
    'ચાર રાઉન્ડની ફાઇનલ સાથે આંતરરાષ્ટ્રીય ક્લેશ સ્ક્વોડ ચેમ્પિયનશિપ',
    'વિસ્તૃત ક્વોલિફાયર સાથે આંતરરાષ્ટ્રીય લોન વુલ્ફ ચેમ્પિયનશિપ',
  ],
};
const LOCALIZED_ROOM_TITLES: Record<AppLanguage, string> = {
  en: 'Approved Entry With Released Room Details',
  hi: 'रूम विवरण जारी होने के साथ स्वीकृत प्रवेश',
  gu: 'રૂમની વિગતો જાહેર થયેલી મંજૂર એન્ટ્રી',
};

const TOURNAMENTS: Array<{ id: string; gameMode: string; mode: string }> = [
  {
    id: 'text-scale-kill-earn',
    gameMode: 'battle_royale_kill_earn',
    mode: 'BATTLE ROYALE',
  },
  {
    id: 'text-scale-br-classic',
    gameMode: 'battle_royale',
    mode: 'BATTLE ROYALE',
  },
  {
    id: 'text-scale-clash-squad',
    gameMode: 'clash_squad',
    mode: 'CLASH SQUAD',
  },
  {
    id: 'text-scale-lone-wolf',
    gameMode: 'lone_wolf',
    mode: 'LONE WOLF',
  },
].map((tournament, index) => ({
  ...tournament,
  status: 'upcoming',
  enabled: true,
  registrationOpen: true,
  startsAt: UPCOMING_START,
  teamType: index === 2 ? 'duo' : 'solo',
  teamSize: index === 2 ? 2 : 1,
  filledSlots: 16,
  totalSlots: 48,
  filledPlayerSlots: 16,
  totalPlayerSlots: 48,
  entryCoins: 35,
  prizePool: 1400,
  perKillCoins: 100,
  joined: false,
}));

const ROOM_TOURNAMENT = {
  id: 'text-scale-room-details',
  gameMode: 'battle_royale',
  mode: 'BATTLE ROYALE',
  status: 'ongoing',
  enabled: true,
  startsAt: ROOM_START,
  teamType: 'solo',
  teamSize: 1,
  filledSlots: 24,
  totalSlots: 48,
  filledPlayerSlots: 24,
  totalPlayerSlots: 48,
  entryCoins: 35,
  prizePool: 1400,
  perKillCoins: 100,
  joined: true,
  myRegistration: {
    tournamentId: 'text-scale-room-details',
    status: 'approved',
    roomPublished: true,
    roomId: 'ROOM-DETAILS-TEST-ID-0123456789',
    roomPassword: 'TEST-PASSWORD-0123456789',
  },
};

const CARD_LAYOUT_SECTIONS = [
  'status',
  'mode',
  'name',
  'date',
  'metric-prize-pool-label',
  'metric-per-kill-label',
  'metric-entry-label',
  'progress-count',
  'progress-spots',
  'join',
] as const;
const FIXTURE_NAVIGATION = {
  isFocused: () => true,
  addListener: () => () => {},
};

export default function TournamentNativeTextScaleTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <NativeFixture />;
}

function NativeFixture() {
  const { fontScale } = useWindowDimensions();
  const originalLanguage = useRef(i18n.language);
  const [fixtureLanguage, setFixtureLanguage] = useState<AppLanguage>('en');
  const [selectedMode, setSelectedMode] = useState<TournamentModeFilterKey>('all');
  const [openedTournament, setOpenedTournament] = useState('');
  const [filterContainerWidth, setFilterContainerWidth] = useState(0);
  const [textLayouts, setTextLayouts] = useState<Record<string, NativeTextScaleLayout>>({});
  const [filterBounds, setFilterBounds] = useState<
    Partial<Record<TournamentModeFilterKey, { x: number; width: number }>>
  >({});
  const largeText = fontScale >= 1.5;

  useEffect(() => {
    void i18n.changeLanguage('en');
    return () => {
      void i18n.changeLanguage(originalLanguage.current);
    };
  }, []);

  const fixtureTournaments = useMemo<any[]>(() => {
    const localized = TOURNAMENTS.map((tournament, index) => ({
      ...tournament,
      name: LOCALIZED_TITLES[fixtureLanguage][index],
      title: LOCALIZED_TITLES[fixtureLanguage][index],
    }));
    const roomTournament = {
      ...ROOM_TOURNAMENT,
      name: LOCALIZED_ROOM_TITLES[fixtureLanguage],
      title: LOCALIZED_ROOM_TITLES[fixtureLanguage],
    };
    return [...localized, roomTournament];
  }, [fixtureLanguage]);

  const visibleTournaments = useMemo(() => {
    if (selectedMode === 'all') return fixtureTournaments;
    const selectedFilter = GAME_MODE_FILTERS.find((filter) => filter.key === selectedMode);
    return fixtureTournaments.filter((tournament) =>
      tournament.gameMode === selectedFilter?.gameMode,
    );
  }, [fixtureTournaments, selectedMode]);

  const filterCounts = useMemo(() => Object.fromEntries(
    GAME_MODE_FILTERS.map((filter) => [
      filter.key,
      filter.key === 'all'
        ? fixtureTournaments.length
        : fixtureTournaments.filter((tournament) => tournament.gameMode === filter.gameMode).length,
    ]),
  ) as Partial<Record<TournamentModeFilterKey, number>>, [fixtureTournaments]);

  const requiredLayoutKeys = useMemo(() => [
    ...GAME_MODE_FILTERS.map((filter) => `tournament-filter:${filter.key}`),
    ...fixtureTournaments.flatMap((tournament) =>
      CARD_LAYOUT_SECTIONS.map((section) => `tournament-card-${tournament.id}:${section}`),
    ),
  ], [fixtureTournaments]);

  const allFiltersFit = filterContainerWidth > 0 && GAME_MODE_FILTERS.every((filter) => {
    const bounds = filterBounds[filter.key];
    return bounds
      && bounds.x >= 0
      && bounds.width > 0
      && bounds.x + bounds.width <= filterContainerWidth + 1;
  });
  const cardAndFilterTextFits = nativeTextScaleLayoutsFit(textLayouts, requiredLayoutKeys);
  const allTextFits = largeText && allFiltersFit && cardAndFilterTextFits;

  const selectFixtureLanguage = (language: AppLanguage) => {
    setFixtureLanguage(language);
    void i18n.changeLanguage(language);
    setSelectedMode('all');
    setOpenedTournament('');
    setFilterBounds({});
    setTextLayouts({});
  };

  return (
    <ScrollView
      testID="tournament-text-scale-scroll"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <Text testID="tournament-text-scale-banner" style={styles.banner}>
        Tournament card fixture | font scale {fontScale.toFixed(2)} | {largeText ? 'large' : 'compact'}
      </Text>
      <View style={styles.languageRow}>
        {LANGUAGES.map(({ value, label }) => (
          <Pressable
            key={value}
            testID={`tournament-language-${value}`}
            accessibilityRole="button"
            accessibilityState={{ selected: fixtureLanguage === value }}
            onPress={() => selectFixtureLanguage(value)}
            style={[
              styles.languageButton,
              fixtureLanguage === value && styles.languageButtonSelected,
            ]}
          >
            <Text style={styles.languageButtonText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text testID={`tournament-language-state-${fixtureLanguage}`} style={styles.languageState}>
        Fixture language: {LANGUAGES.find((language) => language.value === fixtureLanguage)?.label}
      </Text>
      {largeText ? (
        <Text
          testID={allTextFits ? 'tournament-text-scale-layout-pass' : 'tournament-text-scale-layout-pending'}
          style={styles.layoutCheck}
        >
          {allTextFits
            ? `Tournament filters and card text fit at ${fontScale.toFixed(2)}x`
            : `Checking filters and card text at ${fontScale.toFixed(2)}x`}
        </Text>
      ) : null}
      <TournamentModeFilters
        filters={GAME_MODE_FILTERS}
        counts={filterCounts}
        selectedMode={selectedMode}
        largeText={largeText}
        onSelect={setSelectedMode}
        onTextScaleLayout={(key, update) => {
          setTextLayouts((current) => mergeNativeTextScaleLayout(current, key, update));
        }}
        onContainerLayout={(event) => setFilterContainerWidth(event.nativeEvent.layout.width)}
        onFilterLayout={(key, x, width) => setFilterBounds((current) => {
          const previous = current[key];
          if (previous?.x === x && previous.width === width) return current;
          return { ...current, [key]: { x, width } };
        })}
      />
      <Text testID="tournament-native-selected-mode" style={styles.selection}>
        Selected tournament mode: {selectedMode}
      </Text>
      {openedTournament ? (
        <Text testID="tournament-native-opened-card" style={styles.actionResult}>
          Opened tournament card: {openedTournament}
        </Text>
      ) : null}
      {visibleTournaments.map((tournament) => (
        <MatchCard
          key={tournament.id}
          t={tournament}
          largeText={largeText}
          variant="browse"
          testID={`tournament-card-${tournament.id}`}
          onTextScaleLayout={(key, update) => {
            setTextLayouts((current) => mergeNativeTextScaleLayout(current, key, update));
          }}
          onPress={() => setOpenedTournament(tournament.id)}
          roomDetails={
            <NavigationContext.Provider value={FIXTURE_NAVIGATION as any}>
              <RoomCredentialsPanel
                startsAt={tournament.startsAt}
                now={Date.now()}
                configured={tournament.myRegistration?.roomPublished === true}
                roomId={tournament.myRegistration?.roomId}
                roomPassword={tournament.myRegistration?.roomPassword}
                accessStatus={tournament.myRegistration?.status === 'approved' ? 'approved' : 'unregistered'}
              />
            </NavigationContext.Provider>
          }
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 14, paddingBottom: 30 },
  banner: { color: C.sub, fontSize: 11, marginBottom: 6 },
  languageRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  languageButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  languageButtonSelected: { borderColor: C.gold, backgroundColor: `${C.gold}18` },
  languageButtonText: { color: C.text, fontSize: 12, textAlign: 'center', flexShrink: 1 },
  languageState: { color: C.sub, fontSize: 10, marginBottom: 5 },
  layoutCheck: { color: C.green, fontSize: 11, fontWeight: '800', width: '100%', marginBottom: 6 },
  selection: { color: C.text, fontSize: 14, fontWeight: '800', marginBottom: 8 },
  actionResult: { color: C.green, fontSize: 12, fontWeight: '700', marginBottom: 8 },
});
