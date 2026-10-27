import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  NavigationContainer,
  NavigationIndependentTree,
  useNavigation,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ctx, type Ctx as AppContext } from '../App';
import { ReadableText as Text } from '../components/typography';
import { C } from '../components/ui';
import { i18n, type AppLanguage } from '../i18n';
import { Api } from '../lib/api';
import TDetail from './TDetail';

const Stack = createNativeStackNavigator();
let activeFixtureLanguage: AppLanguage = 'en';
const soloStart = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
const teamStart = new Date(Date.now() - 15 * 60_000).toISOString();
const teamJoinStart = new Date(Date.now() + 24 * 60 * 60_000).toISOString();

const soloTournament = {
  id: 'large-text-solo-detail',
  name: 'Solo Tournament Detail Large Text Check',
  title: 'Solo Tournament Detail Large Text Check',
  mode: 'Battle Royale',
  gameMode: 'battle_royale',
  teamType: 'solo',
  teamSize: 1,
  date: soloStart.slice(0, 10),
  time: '9:00 PM',
  startsAt: soloStart,
  entryCoins: 35,
  prizePool: 1400,
  totalSlots: 48,
  filledSlots: 16,
  filledPlayerSlots: 16,
  totalPlayerSlots: 48,
  status: 'upcoming',
  enabled: true,
  rules: 'Native tournament detail large-text fixture.',
  prizeDist: '1st: 1400 coins',
};

const teamTournament = {
  id: 'large-text-team-detail',
  name: 'Team Tournament Detail Large Text Check',
  title: 'Team Tournament Detail Large Text Check',
  mode: 'Battle Royale',
  gameMode: 'battle_royale',
  teamType: 'squad',
  teamSize: 4,
  date: teamStart.slice(0, 10),
  time: '9:00 PM',
  startsAt: teamStart,
  entryCoins: 35,
  prizePool: 1400,
  totalSlots: 12,
  filledSlots: 1,
  filledPlayerSlots: 2,
  totalPlayerSlots: 48,
  status: 'ongoing',
  enabled: true,
  rules: 'Native tournament detail large-text fixture.',
  prizeDist: '1st: 1400 coins',
};

const teamJoinTournament = {
  ...teamTournament,
  id: 'large-text-joinable-team-detail',
  name: 'Joinable Squad Team Detail Large Text Check',
  title: 'Joinable Squad Team Detail Large Text Check',
  date: teamJoinStart.slice(0, 10),
  startsAt: teamJoinStart,
  status: 'upcoming',
};

const teamRegistration = {
  tournamentId: teamTournament.id,
  status: 'approved',
  teamName: 'Large Text Test Team',
  teamNumber: 1,
  slotNumber: 1,
  roomPublished: true,
  roomId: 'DETAIL-ROOM-0123456789',
  roomPassword: 'DETAIL-PASSWORD-0123456789',
};

const tournamentFixtures = new Map<string, typeof soloTournament | typeof teamTournament>([
  [soloTournament.id, soloTournament],
  [teamTournament.id, teamTournament],
  [teamJoinTournament.id, teamJoinTournament],
]);

const fixturePlayerNames: Record<AppLanguage, { captain: string; teammate: string }> = {
  en: {
    captain: 'Captain Player with a long tournament display name',
    teammate: 'Second Team Player with a long tournament display name',
  },
  hi: {
    captain: 'कप्तान अमन कुमार का बहुत लंबा Free Fire खिलाड़ी नाम',
    teammate: 'दूसरे खिलाड़ी रोहित कुमार का बहुत लंबा Free Fire नाम',
  },
  gu: {
    captain: 'કેપ્ટન રાજવીર પટેલનું ખૂબ લાંબું Free Fire નામ',
    teammate: 'બીજા ખેલાડી ધ્રુવ પટેલનું ખૂબ લાંબું Free Fire નામ',
  },
};

function fixtureTeam(teamNumber: number, allowJoining = false, language = activeFixtureLanguage) {
  const names = fixturePlayerNames[language];
  return {
    teamNumber,
    legacy: false,
    captainGameName: teamNumber === 1 ? names.captain : null,
    slots: Array.from({ length: 4 }, (_, index) => {
      const slotNumber = index + 1;
      const occupied = teamNumber === 1 && slotNumber <= 2;
      const gameName = slotNumber === 1
        ? names.captain
        : slotNumber === 2
          ? names.teammate
          : null;
      return {
        slotNumber,
        occupied,
        gameName: occupied ? gameName : null,
        isCaptain: teamNumber === 1 && slotNumber === 1,
        canJoin: allowJoining && !occupied,
        canAddTeammate: false,
        canRemove: false,
        registrationId: occupied ? `fixture-registration-${teamNumber}-${slotNumber}` : null,
      };
    }),
  };
}

function fixtureSlotsFor(language: AppLanguage, joinable = false) {
  return {
    tournamentId: joinable ? teamJoinTournament.id : teamTournament.id,
    teamSize: 4,
    capacity: 12,
    filledTeams: 1,
    filledPlayers: 2,
    registrationClosed: !joinable,
    alreadyRegistered: !joinable,
    myTeamNumber: joinable ? null : 1,
    mySlotNumber: joinable ? null : 1,
    teams: Array.from({ length: 12 }, (_, index) =>
      fixtureTeam(index + 1, joinable, language),
    ),
  };
}

const fixtureUser = {
  id: 'native-tournament-detail-text-player',
  name: 'Tournament Detail Test Player',
  email: 'native-tournament-detail-text@example.invalid',
  role: 'user' as const,
  coins: 500,
  status: 'active',
};

function FixtureHome({
  language,
  onLanguageChange,
}: {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
}) {
  const navigation = useNavigation<any>();
  return (
    <View style={styles.home} testID="tournament-detail-text-fixture">
      <Text style={styles.title}>Tournament detail large-text test</Text>
      <View style={styles.languageRow}>
        {([
          ['hi', 'हिन्दी'],
          ['gu', 'ગુજરાતી'],
        ] as const).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: language === value }}
            testID={`tournament-detail-language-${value}`}
            onPress={() => onLanguageChange(value)}
            style={[
              styles.button,
              styles.languageButton,
              language === value && styles.languageButtonSelected,
            ]}
          >
            <Text style={styles.buttonText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text testID={`tournament-detail-language-state-${language}`} style={styles.instructions}>
        Fixture language: {language}
      </Text>
      <Text style={styles.instructions}>
        Open a solo match to check joining, then open a team match to check registration, slots, and room credentials.
      </Text>
      <Pressable
        accessibilityRole="button"
        testID="tournament-detail-open-solo"
        onPress={() => navigation.navigate('TDetail', { id: soloTournament.id })}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Open solo tournament</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        testID="tournament-detail-open-team-join"
        onPress={() => navigation.navigate('TDetail', { id: teamJoinTournament.id })}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Open team slots to join</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        testID="tournament-detail-open-team"
        onPress={() => navigation.navigate('TDetail', { id: teamTournament.id })}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Open team tournament</Text>
      </Pressable>
    </View>
  );
}

function JoinFormFixture() {
  return (
    <View style={styles.home} testID="tournament-detail-join-form-fixture">
      <Text style={styles.title}>Join action opened</Text>
      <Text style={styles.instructions}>The solo tournament join action opened its next step.</Text>
    </View>
  );
}

function fixtureFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  let body: unknown;
  if (url.includes('/squad-slots')) {
    body = fixtureSlotsFor(
      activeFixtureLanguage,
      url.includes(teamJoinTournament.id),
    );
  } else if (url.endsWith('/participants')) {
    body = { participants: [] };
  } else if (url.endsWith('/results')) {
    body = { status: 'not_finalized', entries: [] };
  } else {
    return Promise.reject(new Error(`Unexpected request in tournament detail fixture: ${init?.method ?? 'GET'} ${url}`));
  }
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

export default function TournamentDetailNativeTextScaleTest() {
  if (!__DEV__) return null;
  const context = useMemo<AppContext>(() => ({
    user: fixtureUser,
    refresh: async () => fixtureUser,
    logout: () => {},
    googleLinkError: '',
    setGoogleLinkError: () => {},
  }), []);
  const originalApi = useMemo(() => ({
    tournament: Api.tournament,
    myRegistrations: Api.myRegistrations,
  }), []);
  const originalFetch = useMemo(() => globalThis.fetch, []);
  const originalLanguage = useRef(i18n.language);
  const [fixtureLanguage, setFixtureLanguage] = useState<AppLanguage>('en');

  const changeFixtureLanguage = (language: AppLanguage) => {
    activeFixtureLanguage = language;
    setFixtureLanguage(language);
    void i18n.changeLanguage(language);
  };

  useEffect(() => {
    activeFixtureLanguage = 'en';
    void i18n.changeLanguage('en');
    return () => {
      activeFixtureLanguage = 'en';
      void i18n.changeLanguage(originalLanguage.current);
    };
  }, []);

  // Install local-only responses before the real TDetail screen mounts.
  (Api as any).tournament = async (id: string) => {
    const fixture = tournamentFixtures.get(String(id));
    if (!fixture) throw new Error(`Missing tournament detail fixture: ${id}`);
    return { ...fixture, registrationOpen: id === soloTournament.id || id === teamJoinTournament.id };
  };
  (Api as any).myRegistrations = async () =>
    [teamRegistration].filter((registration) => registration.tournamentId === teamTournament.id);
  globalThis.fetch = fixtureFetch as typeof globalThis.fetch;

  useEffect(() => () => {
    Api.tournament = originalApi.tournament;
    Api.myRegistrations = originalApi.myRegistrations;
    globalThis.fetch = originalFetch;
  }, [originalApi, originalFetch]);

  return (
    <Ctx.Provider value={context}>
      <NavigationIndependentTree>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="FixtureHome">
              {() => (
                <FixtureHome
                  language={fixtureLanguage}
                  onLanguageChange={changeFixtureLanguage}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="TDetail" component={TDetail} />
            <Stack.Screen name="JoinForm" component={JoinFormFixture} />
          </Stack.Navigator>
        </NavigationContainer>
      </NavigationIndependentTree>
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  home: { flex: 1, justifyContent: 'center', gap: 14, padding: 20, backgroundColor: C.bg },
  title: { color: C.text, fontSize: 19, fontWeight: '900' },
  instructions: { color: C.sub, fontSize: 14, lineHeight: 21 },
  button: {
    minHeight: 52, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1, borderColor: C.green, backgroundColor: C.card,
  },
  languageRow: { flexDirection: 'row', gap: 10 },
  languageButton: { flex: 1, minWidth: 0 },
  languageButtonSelected: { borderColor: C.gold, backgroundColor: `${C.gold}18` },
  buttonText: { color: C.green, fontSize: 15, fontWeight: '800' },
});
