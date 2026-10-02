import React, { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { ReadableText as Text } from './components/typography';
import { NavigationContainer, DarkTheme, useNavigation, useRoute } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Api, getSession, setSession, User } from './lib/api';
import Auth from './screens/Auth';
import Home from './screens/Home';
import Video from './screens/Video';
import Earn from './screens/Earn';
import Tournaments from './screens/Tournaments';
import TDetail from './screens/TDetail';
import JoinForm from './screens/JoinForm';
import MyMatches from './screens/MyMatches';
import Wallet from './screens/Wallet';
import Profile from './screens/Profile';
import Leaderboard from './screens/Leaderboard';
import Notifications from './screens/Notifications';
import EditProfile from './screens/EditProfile';
import AdminApp from './screens/AdminApp';
import { WalletIconActive, WalletIconInactive } from './components/WalletIcon';
import { VideoIconActive, VideoIconInactive } from './components/VideoIcon';
import { ProfileIconActive, ProfileIconInactive } from './components/ProfileIcon';
import { HomeIconActive, HomeIconInactive } from './components/HomeEarnIcons';
import { EarnIconActive, EarnIconInactive } from './components/HomeEarnIcons';
import { useClerk } from '@clerk/expo';

export type Ctx = { user: User; refresh: () => Promise<User | null>; logout: () => void };
const Ctx = React.createContext<Ctx>(null as any);
export const useApp = () => React.useContext(Ctx);

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function Tabs() {
  return (
    <Tab.Navigator screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: '#0d1220ee', borderTopColor: '#2a3558', height: 65, paddingBottom: 8.5, paddingTop: 6.5,
        shadowColor: '#ff3d3d', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 12,
      },
      tabBarActiveTintColor: '#FFD54D', tabBarInactiveTintColor: '#70B8FF',
      tabBarLabelStyle: { fontSize: 11.8, fontWeight: '900', letterSpacing: 0.5, fontFamily: 'Inter_700Bold' },
    }}>
      <Tab.Screen name="Home" component={Home} options={{ tabBarLabel: 'HOME', tabBarIcon: ({ focused }) => focused ? <HomeIconActive /> : <HomeIconInactive /> }} />
      <Tab.Screen name="Video" component={Video} options={{ tabBarLabel: 'VIDEO', tabBarIcon: ({ focused }) => focused ? <VideoIconActive /> : <VideoIconInactive /> }} />
      <Tab.Screen name="Earn" component={Earn} options={{ tabBarLabel: 'EARN', tabBarIcon: ({ focused }) => focused ? <EarnIconActive /> : <EarnIconInactive /> }} />
      <Tab.Screen name="Wallet" component={Wallet} options={{ tabBarLabel: 'WALLET', tabBarIcon: ({ focused }) => focused ? <WalletIconActive /> : <WalletIconInactive /> }} />
      <Tab.Screen name="Profile" component={Profile} options={{ tabBarLabel: 'PROFILE', tabBarIcon: ({ focused }) => focused ? <ProfileIconActive /> : <ProfileIconInactive /> }} />
    </Tab.Navigator>
  );
}

function JoinFormRoute() {
  const navigation: any = useNavigation();
  const route: any = useRoute();
  const { user, refresh } = useApp();
  const registration = route.params?.registration;
  const [tournament, setTournament] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    Api.tournament(route.params?.id)
      .then(setTournament)
      .catch((e) => setError(e?.message || 'Failed to load tournament'));
  }, [route.params?.id]);
  if (error) return <View style={s.boot}><Text style={{ color: '#eef1f8' }}>{error}</Text></View>;
  if (!tournament) return <View style={s.boot}><ActivityIndicator color="#ff4655" /></View>;
  return <JoinForm tournament={tournament} user={user} registration={registration} onCancel={() => navigation.goBack()}
    onSubmit={async (payload) => {
      if (registration?.id) {
        if (String(registration.tournamentId) !== String(tournament.id)) {
          throw new Error('This team registration does not match the selected tournament.');
        }
        const result = await Api.updateRegistrationTeam(registration.id, payload);
        if (result?.success === false || result?.ok === false || result?.updated !== true) {
          throw new Error(result?.error || result?.message || 'Team changes could not be saved.');
        }
        await refresh();
        Alert.alert('Team updated', 'Your team details were saved. No additional coins were charged.');
        navigation.goBack();
        return;
      }
      const result = await Api.join(tournament.id, payload);
      if (result?.success === false || result?.ok === false) {
        throw new Error(result?.error || result?.message || 'The server did not confirm this registration.');
      }
      if (result?.status !== 'approved' && result?.status !== 'pending') {
        throw new Error('The server returned an unexpected registration status. Please try again.');
      }
      await refresh();
      if (result.status === 'approved') {
        const entryCoins = Number(result.entryCoinsPaid ?? tournament.entryCoins ?? 0);
        const message = entryCoins > 0
          ? `Your slot is confirmed and ${entryCoins} coins were deducted from your wallet. Check MY MATCHES for room details.`
          : 'Your slot is confirmed. Check MY MATCHES for room details.';
        Alert.alert('Registration confirmed', message);
      } else {
        Alert.alert('Registration pending', 'This registration is still awaiting admin review. Check MY MATCHES for its status and room details.');
      }
      navigation.goBack();
    }} />;
}

const navTheme = {
  ...DarkTheme, colors: { ...DarkTheme.colors, background: '#070a12', card: '#10162b', border: '#1e2745', primary: '#ff3d3d', text: '#eef1f8' },
};

function DailyApp({ signOutClerk }: { signOutClerk?: () => Promise<void> }) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const u = await getSession();
        if (u) {
          try {
            const verified = await Api.me();
            const session = { ...verified, token: u.token };
            setSession(session);
            setUser(session);
          } catch {
            setSession(null);
          }
        }
      } catch {}
      setBooting(false);
    })();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const u = await Api.me();
      if (u) { setSession(u); setUser(u); return u; }
    } catch (e: any) {
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        setSession(null);
        setUser(null);
      }
    }
    return null;
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOutClerk?.();
    } catch {
      Alert.alert('Sign-out issue', 'Daily007 signed out, but Clerk sign-out could not be confirmed. Please reopen the app and try again.');
    } finally {
      setSession(null);
      setUser(null);
    }
  }, [signOutClerk]);

  if (booting) return (
    <View style={s.boot}>
      <Text style={s.logo}>FF DAILY007</Text>
      <ActivityIndicator color="#ff4655" size="large" style={{ marginTop: 20 }} />
    </View>
  );

  if (!user) return <Auth onDone={(u) => { setSession(u); setUser(u); }} />;

  return (
    <Ctx.Provider value={{ user, refresh, logout }}>
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator screenOptions={{
          headerStyle: { backgroundColor: '#0d1220' },
          headerTintColor: '#eef1f8',
          headerTitleStyle: { color: '#FFD54D', fontSize: 18, fontWeight: '700', fontFamily: 'Inter_700Bold' },
          contentStyle: { backgroundColor: '#070a12' },
        }}>
          {user.role === 'admin' || user.role === 'tournament_admin' ? (
            <Stack.Screen name="Admin" component={AdminApp} options={{ headerShown: false }} />
          ) : (
            <>
              <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
              <Stack.Screen name="Tournaments" component={Tournaments} options={{ title: 'MATCHES' }} />
              <Stack.Screen name="MyMatches" component={MyMatches} options={{ title: 'MY MATCHES' }} />
              <Stack.Screen name="TDetail" component={TDetail} options={{ title: 'TOURNAMENT' }} />
              <Stack.Screen name="JoinForm" component={JoinFormRoute} options={{ title: 'REGISTER', presentation: 'modal' }} />
              <Stack.Screen name="Leaderboard" component={Leaderboard} options={{ title: 'LEADERBOARD' }} />
              <Stack.Screen name="Notifications" component={Notifications} options={{ title: 'NOTIFICATIONS' }} />
              <Stack.Screen name="EditProfile" component={EditProfile} options={{ title: 'EDIT PROFILE' }} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </Ctx.Provider>
  );
}

function ClerkAwareApp() {
  const { signOut } = useClerk();
  return <DailyApp signOutClerk={signOut} />;
}

export default function App() {
  return process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
    ? <ClerkAwareApp />
    : <DailyApp />;
}

const s = StyleSheet.create({
  boot: { flex: 1, backgroundColor: '#070a12', alignItems: 'center', justifyContent: 'center' },
  logo: { color: '#ff3d3d', fontSize: 30, fontWeight: '900', letterSpacing: 3, textShadowColor: '#ff3d3d66', textShadowRadius: 20 },
});
