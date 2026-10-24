import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  NavigationContainer,
  NavigationIndependentTree,
  useNavigation,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Redirect } from 'expo-router';
import { ReadableText as Text } from '../components/typography';
import { C } from '../components/ui';
import { Api, type Tournament } from '../lib/api';
import {
  countOpenHomeTournamentsByFormat,
  countOpenHomeTournamentsByMode,
} from '../lib/tournamentFilters';
import AdminTournaments from './AdminTournaments';
import HomeGameModeCards from './HomeGameModeCards';
import ModeSubmodes from './ModeSubmodes';
import Tournaments from './Tournaments';

type FixtureTournament = Tournament & {
  title: string;
  teamSize: number;
  slotUnit: 'player' | 'team';
  totalPlayerSlots: number;
  filledPlayerSlots: number;
  filledSlots: number;
  startsAt: string;
  registrationOpen: true;
  completedAt: null;
};

type FixturePayload = Record<string, unknown>;
type FixtureFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const Stack = createNativeStackNavigator();
const TEST_ID_PREFIX = 'kill-earn-admin-flow';
const FORMAT_SIZE: Record<string, number> = { Solo: 1, Duo: 2, Squad: 4 };

function fixtureTournament(id: string, payload: FixturePayload): FixtureTournament {
  const teamType = String(payload.teamType ?? 'Solo');
  const title = String(payload.name ?? `Battle Royale Kill & Earn ${teamType}`);
  const teamSize = FORMAT_SIZE[teamType] ?? 1;
  const now = Date.now();
  const startsAt = new Date(now + 48 * 60 * 60 * 1000).toISOString();
  return {
    id,
    title,
    name: title,
    mode: 'Battle Royale Kill & Earn',
    gameMode: 'battle_royale_kill_earn',
    teamType,
    teamSize,
    slotUnit: teamSize === 1 ? 'player' : 'team',
    date: String(payload.date ?? startsAt.slice(0, 10)),
    time: String(payload.time ?? '08:00 PM'),
    startsAt,
    entryCoins: Number(payload.entryCoins ?? 0),
    prizePool: Number(payload.prizePool ?? 0),
    killRewardCoins: Number(payload.killRewardCoins ?? 0),
    totalSlots: Number(payload.totalSlots ?? (teamSize === 1 ? 48 : teamSize === 2 ? 24 : 12)),
    totalPlayerSlots: 48,
    filledSlots: 0,
    filledPlayerSlots: 0,
    status: 'upcoming',
    enabled: true,
    registrationOpen: true,
    rules: String(payload.rules ?? 'Local Kill & Earn admin-flow test fixture.'),
    banner: String(payload.banner ?? 'br'),
    imageUrl: null,
    prizeDist: String(payload.prizeDist ?? ''),
    completedAt: null,
  };
}

function responseFor(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function FixtureHeader({
  navigation,
  tournaments,
  lastSave,
  blockedRequestCount,
}: {
  navigation: any;
  tournaments: FixtureTournament[];
  lastSave: string;
  blockedRequestCount: number;
}) {
  const counts = countOpenHomeTournamentsByFormat(
    tournaments,
    'battle_royale_kill_earn',
  );
  return (
    <View style={styles.header}>
      <Text testID={`${TEST_ID_PREFIX}-banner`} style={styles.banner}>
        DEVELOPMENT FIXTURE · LOCAL DATA ONLY · NO SERVER OR WALLET WRITES
      </Text>
      <View style={styles.navigation}>
        <Pressable
          accessibilityRole="button"
          testID={`${TEST_ID_PREFIX}-admin`}
          onPress={() => navigation.navigate('Admin')}
          style={styles.navButton}
        >
          <Text style={styles.navText}>ADMIN</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          testID={`${TEST_ID_PREFIX}-player`}
          onPress={() => navigation.navigate('Home')}
          style={styles.navButton}
        >
          <Text style={styles.navText}>PLAYER VIEW</Text>
        </Pressable>
      </View>
      <Text testID={`${TEST_ID_PREFIX}-state`} style={styles.state}>
        Fixture state: Solo {counts.solo} · Duo {counts.duo} · Squad {counts.squad}
      </Text>
      {!!lastSave && (
        <Text testID={`${TEST_ID_PREFIX}-last-save`} style={styles.state}>
          {lastSave}
        </Text>
      )}
      <Text
        testID={`${TEST_ID_PREFIX}-blocked-requests`}
        style={[styles.state, blockedRequestCount > 0 && styles.failure]}
      >
        Unrecognized API requests blocked: {blockedRequestCount}
      </Text>
    </View>
  );
}

function FixtureHome({
  tournaments,
}: {
  tournaments: FixtureTournament[];
}) {
  const navigation = useNavigation<any>();
  const modeCounts = countOpenHomeTournamentsByMode(tournaments);
  return (
    <ScrollView
      testID={`${TEST_ID_PREFIX}-home`}
      style={styles.home}
      contentContainerStyle={styles.homeContent}
    >
      <Text style={styles.homeTitle}>KILL & EARN PLAYER BROWSER</Text>
      <HomeGameModeCards
        modeCounts={modeCounts}
        modeCountsReady
        onOpenMode={(params) => navigation.navigate('Tournaments', params)}
        onChooseFormat={(params) => navigation.navigate('ModeSubmodes', params)}
      />
    </ScrollView>
  );
}

export default function KillEarnAdminFlowNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <KillEarnAdminFlowFixture />;
}

function KillEarnAdminFlowFixture() {
  const [tournaments, setTournaments] = useState<FixtureTournament[]>([]);
  const [lastSave, setLastSave] = useState('');
  const [blockedRequestCount, setBlockedRequestCount] = useState(0);
  const tournamentsRef = useRef(tournaments);
  tournamentsRef.current = tournaments;

  const originalApi = useMemo(() => ({
    tournaments: Api.tournaments,
    myRegistrations: Api.myRegistrations,
    createTournament: Api.createTournament,
    updateTournament: Api.updateTournament,
  }), []);
  const originalFetch = useRef<FixtureFetch | null>(null);

  if (!originalFetch.current) {
    originalFetch.current = globalThis.fetch.bind(globalThis);
  }

  const makeFixture = (id: string, payload: FixturePayload) =>
    fixtureTournament(id, payload);

  Api.tournaments = async () => tournamentsRef.current;
  Api.myRegistrations = async () => [];
  Api.createTournament = async (payload: object) => {
    const values = payload as FixturePayload;
    if (values.mode !== 'Battle Royale Kill & Earn') {
      throw new Error('The local fixture only accepts Kill & Earn tournaments.');
    }
    const teamType = String(values.teamType ?? 'Solo').toLowerCase();
    if (!['solo', 'duo', 'squad'].includes(teamType)) {
      throw new Error('The local fixture only accepts Solo, Duo, or Squad.');
    }
    const id = `kill-earn-${teamType}`;
    const created = makeFixture(id, payload as FixturePayload);
    const next = [...tournamentsRef.current, created];
    tournamentsRef.current = next;
    setTournaments(next);
    setLastSave(`Created ${created.teamType} · ${created.killRewardCoins} coins per kill`);
    return created;
  };
  Api.updateTournament = async (id: string, payload: object) => {
    const current = tournamentsRef.current.find((item) => item.id === id);
    if (!current) throw new Error('The local tournament fixture was not found.');
    const values = payload as FixturePayload;
    if (values.mode !== 'Battle Royale Kill & Earn' ||
        !['Solo', 'Duo', 'Squad'].includes(String(values.teamType))) {
      throw new Error('The local fixture only accepts Kill & Earn Solo, Duo, or Squad edits.');
    }
    const updated = makeFixture(id, { ...current, ...values });
    const next = tournamentsRef.current.map((item) => item.id === id ? updated : item);
    tournamentsRef.current = next;
    setTournaments(next);
    setLastSave(`Updated ${updated.teamType} · ${updated.killRewardCoins} coins per kill`);
    return updated;
  };

  (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const pathname = new URL(requestUrl, 'http://daily007-fixture.invalid').pathname;
    if (pathname.endsWith('/api/admin/tournaments')) {
      return responseFor(tournamentsRef.current);
    }
    if (pathname.endsWith('/api/tournaments/live-counts')) {
      const formats = countOpenHomeTournamentsByFormat(
        tournamentsRef.current,
        'battle_royale_kill_earn',
      );
      return responseFor({
        battle_royale: { solo: 0, duo: 0, trio: 0, squad: 0 },
        battle_royale_kill_earn: formats,
        clash_squad: { solo: 0, duo: 0, trio: 0, squad: 0 },
        lone_wolf: { solo: 0, duo: 0, trio: 0, squad: 0 },
      });
    }

    if (pathname.startsWith('/api/')) {
      setBlockedRequestCount((count) => count + 1);
      return responseFor({
        error: `Blocked fixture request: ${init?.method ?? 'GET'} ${pathname}`,
      }, 403);
    }
    if (originalFetch.current) return originalFetch.current(input, init);
    return responseFor({ error: 'The fixture network guard is not initialized.' }, 500);
  };

  useEffect(() => () => {
    Api.tournaments = originalApi.tournaments;
    Api.myRegistrations = originalApi.myRegistrations;
    Api.createTournament = originalApi.createTournament;
    Api.updateTournament = originalApi.updateTournament;
    if (originalFetch.current) {
      (globalThis as any).fetch = originalFetch.current;
    }
  }, [originalApi]);

  return (
    <View style={styles.root}>
      <NavigationIndependentTree>
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Admin"
            screenOptions={({ navigation }) => ({
              header: () => (
                <FixtureHeader
                  navigation={navigation}
                  tournaments={tournaments}
                  lastSave={lastSave}
                  blockedRequestCount={blockedRequestCount}
                />
              ),
            })}
          >
            <Stack.Screen name="Admin" component={AdminTournaments} />
            <Stack.Screen name="Home">
              {(props) => <FixtureHome {...props} tournaments={tournaments} />}
            </Stack.Screen>
            <Stack.Screen name="ModeSubmodes" component={ModeSubmodes} />
            <Stack.Screen name="Tournaments" component={Tournaments} />
          </Stack.Navigator>
        </NavigationContainer>
      </NavigationIndependentTree>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: C.bg2,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  banner: { color: C.orange, fontSize: 9, fontWeight: '900', textAlign: 'center' },
  navigation: { flexDirection: 'row', gap: 8, marginTop: 6 },
  navButton: {
    flex: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: C.card,
  },
  navText: { color: C.text, fontSize: 11, fontWeight: '900' },
  state: { color: C.sub, fontSize: 10, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  failure: { color: C.red },
  home: { flex: 1, backgroundColor: C.bg },
  homeContent: { paddingTop: 12, paddingBottom: 24 },
  homeTitle: { color: C.gold, fontSize: 18, fontWeight: '900', marginHorizontal: 16, marginBottom: 10 },
});
