import React, { useMemo, useState } from 'react';
import { Redirect } from 'expo-router';
import { NavigationContext } from '@react-navigation/native';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { RoomCredentialsPanel } from '../components/RoomCredentialsPanel';
import { TournamentModeFilters } from '../components/TournamentModeFilters';
import { ReadableText as Text } from '../components/typography';
import { C, MatchCard } from '../components/ui';
import { GAME_MODE_FILTERS, type TournamentModeFilterKey } from '../lib/tournamentModeFilterOptions';

const UPCOMING_START = '2027-10-28T12:30:00.000Z';
const ROOM_START = new Date(Date.now() - 15 * 60_000).toISOString();

const TOURNAMENTS = [
  {
    id: 'text-scale-kill-earn',
    gameMode: 'battle_royale_kill_earn',
    mode: 'BATTLE ROYALE',
    name: 'International Kill & Earn Championship With Extended Finals Schedule',
  },
  {
    id: 'text-scale-br-classic',
    gameMode: 'battle_royale',
    mode: 'BATTLE ROYALE',
    name: 'International Battle Royale Classic Championship Across Multiple Regions',
  },
  {
    id: 'text-scale-clash-squad',
    gameMode: 'clash_squad',
    mode: 'CLASH SQUAD',
    name: 'International Clash Squad Championship With A Four-Round Final',
  },
  {
    id: 'text-scale-lone-wolf',
    gameMode: 'lone_wolf',
    mode: 'LONE WOLF',
    name: 'International Lone Wolf Championship With Extended Qualifiers',
  },
].map((tournament, index) => ({
  ...tournament,
  title: tournament.name,
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
  name: 'Approved Entry With Released Room Details',
  title: 'Approved Entry With Released Room Details',
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

const FIXTURE_TOURNAMENTS: any[] = [...TOURNAMENTS, ROOM_TOURNAMENT];
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
  const [selectedMode, setSelectedMode] = useState<TournamentModeFilterKey>('all');
  const [openedTournament, setOpenedTournament] = useState('');
  const [filterContainerWidth, setFilterContainerWidth] = useState(0);
  const [filterBounds, setFilterBounds] = useState<
    Partial<Record<TournamentModeFilterKey, { x: number; width: number }>>
  >({});
  const largeText = fontScale >= 1.5;

  const visibleTournaments = useMemo(() => {
    if (selectedMode === 'all') return FIXTURE_TOURNAMENTS;
    const selectedFilter = GAME_MODE_FILTERS.find((filter) => filter.key === selectedMode);
    return FIXTURE_TOURNAMENTS.filter((tournament) =>
      tournament.gameMode === selectedFilter?.gameMode,
    );
  }, [selectedMode]);

  const filterCounts = useMemo(() => Object.fromEntries(
    GAME_MODE_FILTERS.map((filter) => [
      filter.key,
      filter.key === 'all'
        ? FIXTURE_TOURNAMENTS.length
        : FIXTURE_TOURNAMENTS.filter((tournament) => tournament.gameMode === filter.gameMode).length,
    ]),
  ) as Partial<Record<TournamentModeFilterKey, number>>, []);

  const allFiltersFit = filterContainerWidth > 0 && GAME_MODE_FILTERS.every((filter) => {
    const bounds = filterBounds[filter.key];
    return bounds
      && bounds.x >= 0
      && bounds.width > 0
      && bounds.x + bounds.width <= filterContainerWidth + 1;
  });

  return (
    <ScrollView
      testID="tournament-text-scale-scroll"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <Text testID="tournament-text-scale-banner" style={styles.banner}>
        Tournament card fixture | font scale {fontScale.toFixed(2)} | {largeText ? 'large' : 'compact'}
      </Text>
      {largeText ? (
        <Text testID="tournament-mode-filter-layout-check" style={styles.layoutCheck}>
          {allFiltersFit
            ? `Tournament filters fit screen width at ${fontScale.toFixed(2)}x`
            : 'Checking tournament filter widths'}
        </Text>
      ) : null}
      <TournamentModeFilters
        filters={GAME_MODE_FILTERS}
        counts={filterCounts}
        selectedMode={selectedMode}
        largeText={largeText}
        onSelect={setSelectedMode}
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
  layoutCheck: { color: C.green, fontSize: 12, fontWeight: '800', marginBottom: 6 },
  selection: { color: C.text, fontSize: 14, fontWeight: '800', marginBottom: 8 },
  actionResult: { color: C.green, fontSize: 12, fontWeight: '700', marginBottom: 8 },
});
