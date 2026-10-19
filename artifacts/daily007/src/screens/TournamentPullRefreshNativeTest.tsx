import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { NavigationContainer, NavigationIndependentTree } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ReadableText as Text } from '../components/typography';
import { Api } from '../lib/api';
import { TOURNAMENT_LIST_REFRESH_INTERVAL_MS } from '../lib/tournamentLifecycle';
import Tournaments from './Tournaments';

type FixtureTournament = {
  id: string;
  name: string;
  title: string;
  mode: string;
  gameMode: string;
  teamType: string;
  date: string;
  time: string;
  startsAt: string;
  entryCoins: number;
  prizePool: number;
  totalSlots: number;
  filledSlots: number;
  filledPlayerSlots: number;
  totalPlayerSlots: number;
  status: string;
  enabled: boolean;
  rules: string;
  prizeDist: string;
};

type ResolveTournamentResponse = (items: FixtureTournament[]) => void;

const Stack = createNativeStackNavigator();
const tournamentStartMs = Date.now() + 60 * 60 * 1000;

function fixtureTournament(id: string, name: string, offset: number): FixtureTournament {
  const startsAt = new Date(tournamentStartMs + offset * 60 * 60 * 1000).toISOString();
  return {
    id,
    name,
    title: name,
    mode: 'Battle Royale',
    gameMode: 'battle_royale',
    teamType: 'Solo',
    date: startsAt.slice(0, 10),
    time: '9:00 PM',
    startsAt,
    entryCoins: 0,
    prizePool: 120,
    totalSlots: 48,
    filledSlots: 0,
    filledPlayerSlots: 0,
    totalPlayerSlots: 48,
    status: 'upcoming',
    enabled: true,
    rules: 'Local tournament refresh test fixture.',
    prizeDist: '1st: 120 coins',
  };
}

const initialTournaments = Array.from({ length: 6 }, (_, index) =>
  fixtureTournament(`pull-refresh-initial-${index + 1}`, `Initial tournament ${index + 1}`, index),
);
const newestTournament = fixtureTournament(
  'pull-refresh-newest',
  'Newest pull result',
  0,
);
const staleTournament = fixtureTournament(
  'pull-refresh-stale',
  'Stale poll result',
  0,
);

function TestButton({
  testID,
  disabled,
  onPress,
  children,
}: {
  testID: string;
  disabled: boolean;
  onPress: () => void;
  children: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.buttonText}>{children}</Text>
    </Pressable>
  );
}

export default function TournamentPullRefreshNativeTest() {
  const [pollPending, setPollPending] = useState(false);
  const [pollReleased, setPollReleased] = useState(false);
  const [manualPending, setManualPending] = useState(false);
  const [manualReleased, setManualReleased] = useState(false);
  const phase = useRef<'initial' | 'poll' | 'manual' | 'finished'>('initial');
  const firstRequestAt = useRef<number | null>(null);
  const pollResponse = useRef<ResolveTournamentResponse | null>(null);
  const manualResponse = useRef<ResolveTournamentResponse | null>(null);
  const originalApi = useMemo(() => ({
    tournaments: Api.tournaments,
    myRegistrations: Api.myRegistrations,
  }), []);

  const getTournaments = useCallback((): Promise<FixtureTournament[]> => {
    if (phase.current === 'initial') {
      if (firstRequestAt.current === null) {
        firstRequestAt.current = Date.now();
        return Promise.resolve(initialTournaments);
      }

      // Ignore any immediate focus/recovery reload; only the real scheduled
      // refresh should hold its response pending for the pull gesture.
      if (Date.now() - firstRequestAt.current < TOURNAMENT_LIST_REFRESH_INTERVAL_MS * 0.75) {
        return Promise.resolve(initialTournaments);
      }

      phase.current = 'poll';
      setPollPending(true);
      return new Promise((resolve) => {
        pollResponse.current = resolve;
      });
    }

    if (phase.current === 'poll') {
      phase.current = 'manual';
      setManualPending(true);
      return new Promise((resolve) => {
        manualResponse.current = resolve;
      });
    }

    return Promise.resolve(initialTournaments);
  }, []);

  // Install the controlled API responses before the real screen mounts.
  (Api as any).tournaments = getTournaments;
  (Api as any).myRegistrations = async () => [];

  useEffect(() => () => {
    Api.tournaments = originalApi.tournaments;
    Api.myRegistrations = originalApi.myRegistrations;
  }, [originalApi]);

  const releaseManualResponse = () => {
    const resolve = manualResponse.current;
    if (!resolve) return;
    manualResponse.current = null;
    phase.current = 'finished';
    setManualReleased(true);
    resolve([newestTournament]);
  };

  const releasePollResponse = () => {
    const resolve = pollResponse.current;
    if (!resolve) return;
    pollResponse.current = null;
    setPollReleased(true);
    resolve([staleTournament]);
  };

  return (
    <View style={styles.screen} testID="tournament-pull-refresh-fixture">
      <View style={styles.panel}>
        <Text style={styles.title}>Tournament pull-to-refresh test</Text>
        <Text style={styles.instructions}>
          Wait for the scheduled poll, then pull down on the tournament list before resolving either response.
        </Text>
        <Text testID="tournament-pull-refresh-poll-state" style={styles.status}>
          {pollPending
            ? pollReleased ? 'Scheduled poll response released' : 'Scheduled poll response pending'
            : 'Waiting for scheduled poll'}
        </Text>
        <Text testID="tournament-pull-refresh-manual-state" style={styles.status}>
          {manualPending
            ? manualReleased ? 'Manual response released' : 'Manual response pending'
            : 'Pull to start a newer request'}
        </Text>
        <View style={styles.actions}>
          <TestButton
            testID="tournament-pull-refresh-resolve-manual"
            disabled={!manualPending || manualReleased}
            onPress={releaseManualResponse}
          >
            Resolve newer response
          </TestButton>
          <TestButton
            testID="tournament-pull-refresh-resolve-poll"
            disabled={!pollPending || pollReleased}
            onPress={releasePollResponse}
          >
            Resolve older poll
          </TestButton>
        </View>
      </View>
      <View style={styles.list}>
        <NavigationIndependentTree>
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Tournaments" component={Tournaments} />
            </Stack.Navigator>
          </NavigationContainer>
        </NavigationIndependentTree>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090A0F' },
  panel: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: '#131722',
    borderBottomWidth: 1,
    borderBottomColor: '#354056',
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '800' },
  instructions: { color: '#d4d9e5', fontSize: 12, marginTop: 3 },
  status: { color: '#ffbd55', fontSize: 12, fontWeight: '700', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  button: {
    flex: 1,
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ff6b36',
    backgroundColor: '#33201e',
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: '#fff', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  list: { flex: 1 },
});
