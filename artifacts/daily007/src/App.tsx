import React, { useEffect, useState, useCallback, useRef } from 'react';
import { AppState, View, ActivityIndicator, StyleSheet, Alert, Pressable, useWindowDimensions } from 'react-native';
import * as Network from 'expo-network';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setBaseUrl } from '@workspace/api-client-react';
import { ReadableText as Text } from './components/typography';
import { NavigationContainer, DarkTheme, useNavigation, useRoute } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Api, currentUser, getSession, setSession, setSessionExpiredHandler, User } from './lib/api';
import Auth from './screens/Auth';
import Home from './screens/Home';
import ModeSubmodes from './screens/ModeSubmodes';
import Video from './screens/Video';
import Earn from './screens/Earn';
import Tournaments from './screens/Tournaments';
import TDetail from './screens/TDetail';
import JoinForm from './screens/JoinForm';
import MyMatches from './screens/MyMatches';
import Wallet from './screens/Wallet';
import Profile from './screens/Profile';
import Leaderboard from './screens/Leaderboard';
import LeaderboardDetails from './screens/LeaderboardDetails';
import Notifications from './screens/Notifications';
import EditProfile from './screens/EditProfile';
import AdminApp from './screens/AdminApp';
import { joinWithCapacityRefresh } from './lib/tournamentJoinRecovery';
import { WalletIconActive, WalletIconInactive } from './components/WalletIcon';
import { VideoIconActive, VideoIconInactive } from './components/VideoIcon';
import { ProfileIconActive, ProfileIconInactive } from './components/ProfileIcon';
import { HomeIconActive, HomeIconInactive } from './components/HomeEarnIcons';
import { EarnIconActive, EarnIconInactive } from './components/HomeEarnIcons';
import { getPlayerTabBarHeight } from './lib/playerTabBarSizing';
import { logoutDaily007 } from './lib/logout';
import { restoreDaily007Session } from './lib/session-verification';
import { useClerk } from '@clerk/expo';

export type Ctx = { user: User; refresh: () => Promise<User | null>; logout: () => void };
const Ctx = React.createContext<Ctx>(null as any);
export const useApp = () => React.useContext(Ctx);

setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 20_000 } },
});

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function Tabs() {
  const { width, fontScale } = useWindowDimensions();
  return (
    <Tab.Navigator screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: '#0d1220ee', borderTopColor: '#2a3558', height: getPlayerTabBarHeight(fontScale, width), paddingBottom: 8.5, paddingTop: 6.5,
        shadowColor: '#ff3d3d', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 12,
      },
      tabBarActiveTintColor: '#FFD54D', tabBarInactiveTintColor: '#F5F7FF',
      tabBarLabelStyle: {
        width: '100%', maxWidth: '100%', flexShrink: 1, textAlign: 'center',
        fontSize: 11.8, fontWeight: '900', letterSpacing: 0.5, fontFamily: 'Inter_700Bold',
      },
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
      const result = await joinWithCapacityRefresh(
        () => Api.join(tournament.id, payload),
        tournament.id,
        Api.tournament,
        setTournament,
      );
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
  ...DarkTheme, colors: { ...DarkTheme.colors, background: '#070a12', card: '#10162b', border: '#1e2745', primary: '#ff3d3d', text: '#70B8FF' },
};

function DailyApp({ signOutClerk }: { signOutClerk?: () => Promise<void> }) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [authNotice, setAuthNotice] = useState('');
  const [verificationSession, setVerificationSession] = useState<User | null>(null);
  const [retryingVerification, setRetryingVerification] = useState(false);
  const refreshRequest = useRef<Promise<User | null> | null>(null);
  const accessRefreshRequest = useRef<Promise<User | null> | null>(null);
  const verificationRequest = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const handleExpiredSession = () => {
      setSession(null);
      setUser(null);
      queryClient.clear();
      setAuthNotice('This account signed in elsewhere. Sign in again to continue.');
    };
    setSessionExpiredHandler(handleExpiredSession);
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const result = await restoreDaily007Session(getSession, Api.me, setSession);
        if (!mounted) return;
        if (result.status === 'verified') setUser(result.session);
        else if (result.status === 'retry') setVerificationSession(result.session);
      } catch {
        // A local storage read failure is not proof that the saved API session expired.
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const retrySessionVerification = useCallback((): Promise<void> => {
    if (verificationRequest.current) return verificationRequest.current;
    const savedSession = verificationSession;
    if (!savedSession) return Promise.resolve();

    setRetryingVerification(true);
    const request = (async () => {
      try {
        const result = await restoreDaily007Session(
          async () => savedSession,
          Api.me,
          setSession,
        );
        if (result.status === 'verified') {
          setVerificationSession(null);
          setUser(result.session);
        } else if (result.status === 'rejected' || result.status === 'empty') {
          setVerificationSession(null);
          setUser(null);
        } else {
          setVerificationSession(result.session);
        }
      } catch {
        setVerificationSession(savedSession);
      } finally {
        setRetryingVerification(false);
      }
    })();
    verificationRequest.current = request;
    void request.finally(() => {
      if (verificationRequest.current === request) verificationRequest.current = null;
    });
    return request;
  }, [verificationSession]);

  useEffect(() => {
    if (!verificationSession) return;

    let active = true;
    const retryIfOnline = (networkState: Network.NetworkState) => {
      if (
        active &&
        networkState.isConnected === true &&
        networkState.isInternetReachable !== false
      ) {
        void retrySessionVerification();
      }
    };
    const networkSubscription = Network.addNetworkStateListener(retryIfOnline);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void Network.getNetworkStateAsync().then(retryIfOnline).catch(() => {});
    });

    // Check the current state as well, in case connectivity returned before the listener was attached.
    void Network.getNetworkStateAsync().then(retryIfOnline).catch(() => {});

    return () => {
      active = false;
      networkSubscription.remove();
      appStateSubscription.remove();
    };
  }, [verificationSession, retrySessionVerification]);

  const refresh = useCallback((): Promise<User | null> => {
    if (refreshRequest.current) return refreshRequest.current;
    const request = (async () => {
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
    })();
    refreshRequest.current = request;
    void request.finally(() => {
      if (refreshRequest.current === request) refreshRequest.current = null;
    });
    return request;
  }, []);

  const refreshAccess = useCallback((): Promise<User | null> => {
    if (accessRefreshRequest.current) return accessRefreshRequest.current;
    const request = (async () => {
      const previous = currentUser();
      if (!previous) return null;
      try {
        const account = await Api.meAccount();
        const updated = { ...previous, ...account, token: previous.token };
        setSession(updated);
        setUser(updated);
        return updated;
      } catch (e: any) {
        if (e?.response?.status === 401 || e?.response?.status === 403) {
          setSession(null);
          setUser(null);
        }
        return null;
      }
    })();
    accessRefreshRequest.current = request;
    void request.finally(() => {
      if (accessRefreshRequest.current === request) accessRefreshRequest.current = null;
    });
    return request;
  }, []);

  useEffect(() => {
    if (!user) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshAccess();
    });
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void refreshAccess();
    }, 30_000);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [user?.id, refreshAccess]);

  const logout = useCallback(async () => {
    try {
      const clerkSignOutFailed = await logoutDaily007(signOutClerk, () => setSession(null));
      if (clerkSignOutFailed) {
        Alert.alert('Sign-out issue', 'Daily007 signed out, but Clerk sign-out could not be confirmed. Please reopen the app and try again.');
      }
    } finally {
      setUser(null);
      setAuthNotice('');
    }
  }, [signOutClerk]);

  if (booting) return (
    <View style={s.boot}>
      <Text style={s.logo}>FF DAILY007</Text>
      <ActivityIndicator color="#ff4655" size="large" style={{ marginTop: 20 }} />
    </View>
  );

  if (!user && verificationSession) return (
    <View style={s.boot}>
      <Text style={s.verificationTitle}>SESSION VERIFICATION PAUSED</Text>
      <Text style={s.verificationMessage}>
        Daily007 could not verify your saved sign-in right now. Your session is still saved. Check your connection and try again.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry session verification"
        accessibilityState={{ disabled: retryingVerification }}
        disabled={retryingVerification}
        onPress={() => { void retrySessionVerification(); }}
        style={[s.retryButton, retryingVerification && s.retryButtonDisabled]}
        testID="session-verification-retry"
      >
        {retryingVerification
          ? <ActivityIndicator color="#070a12" />
          : <Text style={s.retryButtonText}>RETRY VERIFICATION</Text>}
      </Pressable>
    </View>
  );

  if (!user) return <Auth
    notice={authNotice}
    onDone={(u) => { setAuthNotice(''); setSession(u); setUser(u); }}
  />;

  return (
    <Ctx.Provider value={{ user, refresh, logout }}>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer theme={navTheme}>
          <Stack.Navigator screenOptions={{
            headerStyle: { backgroundColor: '#0d1220' },
            headerTintColor: '#70B8FF',
            headerTitleStyle: { color: '#FFD54D', fontSize: 18, fontWeight: '700', fontFamily: 'Inter_700Bold' },
            contentStyle: { backgroundColor: '#070a12' },
          }}>
            {user.role === 'admin' || user.role === 'tournament_admin' ? (
              <Stack.Screen name="Admin" component={AdminApp} options={{ headerShown: false }} />
            ) : (
              <>
                <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
                <Stack.Screen name="ModeSubmodes" component={ModeSubmodes} options={{ title: 'SELECT FORMAT' }} />
                <Stack.Screen name="Tournaments" component={Tournaments} options={{ title: 'MATCHES' }} />
                <Stack.Screen name="MyMatches" component={MyMatches} options={{ title: 'MY MATCHES' }} />
                <Stack.Screen name="TDetail" component={TDetail} options={{ title: 'TOURNAMENT' }} />
                <Stack.Screen name="JoinForm" component={JoinFormRoute} options={{ title: 'REGISTER', presentation: 'modal' }} />
                <Stack.Screen name="LeaderboardDetails" component={LeaderboardDetails} options={{ title: 'Leaderboard' }} />
                <Stack.Screen name="Leaderboard" component={Leaderboard} options={{ title: 'LEADERBOARD' }} />
                <Stack.Screen name="Notifications" component={Notifications} options={{ title: 'NOTIFICATIONS' }} />
                <Stack.Screen name="EditProfile" component={EditProfile} options={{ title: 'EDIT PROFILE' }} />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>
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
  verificationTitle: { color: '#FFD54D', fontSize: 20, fontWeight: '900', textAlign: 'center', letterSpacing: 0.6 },
  verificationMessage: { color: '#F5F7FF', fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 330, marginTop: 14, paddingHorizontal: 18 },
  retryButton: { backgroundColor: '#ff3d3d', borderRadius: 12, minWidth: 210, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 20, marginTop: 24 },
  retryButtonDisabled: { opacity: 0.72 },
  retryButtonText: { color: '#070a12', fontWeight: '900', letterSpacing: 0.5 },
});
