import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { NavigationContainer, NavigationIndependentTree } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ctx, type Ctx as AppContext } from '../App';
import { Api } from '../lib/api';
import Home from './Home';
import TDetail from './TDetail';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const baseStartMs = Date.now() + 60 * 60 * 1000;

const fixtures = [
  {
    id: 'home-back-match-one',
    name: 'Home Back Test Match One',
    startsAt: new Date(baseStartMs).toISOString(),
  },
  {
    id: 'home-back-match-two',
    name: 'Home Back Test Match Two',
    startsAt: new Date(baseStartMs + 60 * 60 * 1000).toISOString(),
  },
].map((fixture) => ({
  ...fixture,
  title: fixture.name,
  mode: 'Battle Royale',
  gameMode: 'battle_royale',
  teamType: 'Solo',
  date: fixture.startsAt.slice(0, 10),
  time: '9:00 PM',
  entryCoins: 0,
  prizePool: 100,
  totalSlots: 48,
  filledSlots: 0,
  filledPlayerSlots: 0,
  totalPlayerSlots: 48,
  status: 'upcoming',
  enabled: true,
  rules: 'Native navigation test fixture.',
  prizeDist: '1st: 100 coins',
}));

const testUser = {
  id: 'native-home-back-test-player',
  name: 'Native Navigation Test Player',
  email: 'native-home-back-test@example.invalid',
  role: 'user' as const,
  wallet_coins: 500,
  phone: '',
  game_uid: '',
  status: 'active',
};

function HomeTab() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home">
        {() => <Home disableAutoCarousel />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function HomeMatchBackNativeTest() {
  const context = useMemo<AppContext>(() => ({
    user: testUser,
    refresh: async () => testUser,
    logout: () => {},
    googleLinkError: '',
    setGoogleLinkError: () => {},
  }), []);
  const originalApi = useMemo(() => ({
    tournaments: Api.tournaments,
    myRegistrations: Api.myRegistrations,
    settings: Api.settings,
    tournament: Api.tournament,
  }), []);

  // Install fixture responses before mounting the real Home and TDetail screens.
  (Api as any).tournaments = async () => fixtures;
  (Api as any).myRegistrations = async () => [];
  (Api as any).settings = async () => ({ settings: {} });
  (Api as any).tournament = async (id: string) => {
    const tournament = fixtures.find((item) => item.id === String(id));
    if (!tournament) throw new Error(`Missing native navigation fixture: ${id}`);
    return { ...tournament, registrationStatusKnown: true, joined: false };
  };
  useEffect(() => () => {
    Api.tournaments = originalApi.tournaments;
    Api.myRegistrations = originalApi.myRegistrations;
    Api.settings = originalApi.settings;
    Api.tournament = originalApi.tournament;
  }, [originalApi]);

  return (
    <Ctx.Provider value={context}>
      <View style={{ flex: 1 }} testID="home-match-back-test-fixture">
        <NavigationIndependentTree>
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Tabs" component={HomeTab} />
              <Stack.Screen name="TDetail" component={TDetail} />
            </Stack.Navigator>
          </NavigationContainer>
        </NavigationIndependentTree>
      </View>
    </Ctx.Provider>
  );
}
