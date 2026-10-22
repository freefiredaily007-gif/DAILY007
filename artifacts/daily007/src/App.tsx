import React, { useEffect, useState, useCallback, useRef } from 'react';
import { AppState, View, ActivityIndicator, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import * as Network from 'expo-network';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setBaseUrl } from '@workspace/api-client-react';
import { ReadableText as Text } from './components/typography';
import colors from '../constants/colors';
import { NavigationContainer, DarkTheme, useNavigation, useRoute } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  Api,
  captureSessionIdentity,
  clearSessionForLogout,
  currentUser,
  getSession,
  isSessionIdentityCurrent,
  setSession,
  setSessionExpiredHandler,
  setSessionForIdentity,
  User,
} from './lib/api';
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
import { clearPendingVideoRewardRetry } from './lib/video-reward-retry';
import {
  BLOCKED_ACCOUNT_SESSION_NOTICE,
  isBlockedAccountError,
  restoreDaily007Session,
  runSingleFlight,
  subscribeToSessionVerificationRecovery,
} from './lib/session-verification';
import { SessionVerificationPaused } from './components/SessionVerificationPaused';
import {
  refreshAccessAfterPending,
  refreshAccessIfActive,
  subscribeToAccountAccessReconnect,
  refreshUserAccountAccessSafely,
  rootNavigationForRole,
} from './lib/roleNavigation';
import { useClerk } from '@clerk/expo';
import type { GoogleSSONativeTestHarness } from './components/GoogleSSOButton';
import { useTranslation } from 'react-i18next';
import { Daily007LanguageProvider, useDaily007Language } from './i18n/LanguageProvider';
import { showLocalizedAlert } from './i18n/alerts';
import { translateExactText } from './i18n';

export type Ctx = {
  user: User;
  refresh: () => Promise<User | null>;
  logout: () => void;
  googleLinkError: string;
  setGoogleLinkError: (message: string) => void;
  pendingGoogleLinkSession?: User | null;
  setPendingGoogleLinkSession?: (session: User | null) => void;
  googleSSONativeTestHarness?: GoogleSSONativeTestHarness;
};
export const Ctx = React.createContext<Ctx>(null as any);
export const useApp = () => React.useContext(Ctx);

export type LogoutNativeTestControls = {
  signOutCalls: number;
  onResolveClerkSignOut: () => void;
  onRejectClerkSignOut: () => void;
};

const logoutNativeTestUser: User = {
  id: 'native-clerk-logout-player',
  name: 'Native Logout Test Player',
  email: 'native-clerk-logout@daily007.test',
  role: 'admin',
  token: 'native-clerk-logout-token',
};

const googleLinkNativeTestUser: User = {
  id: 'native-google-link-player',
  name: 'Native Google Link Player',
  email: 'native-google-link@daily007.test',
  role: 'user',
  coins: 42,
  token: 'native-google-link-password-token',
};

export function DailyAppGoogleLinkNativeTest({
  harness,
}: {
  harness: GoogleSSONativeTestHarness;
}) {
  if (!__DEV__) return null;
  return (
    <DailyApp
      testInitialUser={googleLinkNativeTestUser}
      googleSSONativeTestHarness={harness}
    />
  );
}

export function DailyAppLogoutNativeTest({
  signOutClerk,
  controls,
}: {
  signOutClerk: () => Promise<void>;
  controls: LogoutNativeTestControls;
}) {
  if (!__DEV__) return null;
  return (
    <DailyApp
      signOutClerk={signOutClerk}
      testInitialUser={logoutNativeTestUser}
      logoutNativeTestControls={controls}
    />
  );
}

setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 20_000 } },
});

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const UI = colors.light;

function Tabs() {
  const { width, fontScale } = useWindowDimensions();
  const { t, i18n } = useTranslation();
  return (
    <Tab.Navigator screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: `${UI.muted}EE`, borderTopColor: UI.border, height: getPlayerTabBarHeight(fontScale, width), paddingBottom: 8.5, paddingTop: 6.5,
        shadowColor: UI.primary, shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: -4 }, elevation: 12,
      },
      tabBarActiveTintColor: UI.accent, tabBarInactiveTintColor: UI.mutedForeground,
      tabBarLabelStyle: {
        width: '100%', maxWidth: '100%', flexShrink: 1, textAlign: 'center',
        fontSize: 12, fontWeight: '900', letterSpacing: 0.55,
        fontFamily: i18n.language === 'en' ? 'Rajdhani_700Bold' : undefined,
      },
    }}>
      <Tab.Screen name="Home" component={Home} options={{ tabBarLabel: t('HOME'), tabBarIcon: ({ focused }) => focused ? <HomeIconActive /> : <HomeIconInactive /> }} />
      <Tab.Screen name="Video" component={Video} options={{ tabBarLabel: t('VIDEO'), tabBarIcon: ({ focused }) => focused ? <VideoIconActive /> : <VideoIconInactive /> }} />
      <Tab.Screen name="Earn" component={Earn} options={{ tabBarLabel: t('EARN'), tabBarIcon: ({ focused }) => focused ? <EarnIconActive /> : <EarnIconInactive /> }} />
      <Tab.Screen name="Wallet" component={Wallet} options={{ tabBarLabel: t('WALLET'), tabBarIcon: ({ focused }) => focused ? <WalletIconActive /> : <WalletIconInactive /> }} />
      <Tab.Screen name="Profile" component={Profile} options={{ tabBarLabel: t('PROFILE'), tabBarIcon: ({ focused }) => focused ? <ProfileIconActive /> : <ProfileIconInactive /> }} />
    </Tab.Navigator>
  );
}

function JoinFormRoute() {
  const navigation: any = useNavigation();
  const route: any = useRoute();
  const { user, refresh } = useApp();
  const registration = route.params?.registration;
  const requestedSeatGroupNumber = Number(route.params?.seatGroupNumber);
  const seatGroupNumber = Number.isSafeInteger(requestedSeatGroupNumber) && requestedSeatGroupNumber > 0
    ? requestedSeatGroupNumber
    : undefined;
  const requestedSeatSlotNumber = Number(route.params?.seatSlotNumber);
  const seatSlotNumber = Number.isSafeInteger(requestedSeatSlotNumber) && requestedSeatSlotNumber > 0
    ? requestedSeatSlotNumber
    : undefined;
  const [tournament, setTournament] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    Api.tournament(route.params?.id)
      .then(setTournament)
      .catch((e) => setError(e?.message || 'Failed to load tournament'));
  }, [route.params?.id]);
  if (error) return <View style={s.boot}><Text style={{ color: UI.foreground }}>{error}</Text></View>;
  if (!tournament) return <View style={s.boot}><ActivityIndicator color={UI.tint} /></View>;
  return <JoinForm tournament={tournament} user={user} registration={registration} seatGroupNumber={seatGroupNumber} seatSlotNumber={seatSlotNumber} onCancel={() => navigation.goBack()}
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
        showLocalizedAlert('Team updated', 'Your team details were saved. No additional coins were charged.');
        navigation.goBack();
        return;
      }
      if (seatGroupNumber && seatSlotNumber && Number(tournament.teamSize) > 1) {
        const result = await Api.joinPlayerSlot(tournament.id, {
          teamNumber: seatGroupNumber,
          slotNumber: seatSlotNumber,
          gameName: String(payload.captainGameName ?? ''),
          gameUid: String(payload.gameUid ?? ''),
        });
        if (result?.success === false || result?.ok === false) {
          throw new Error(result?.error || result?.message || 'The server did not confirm your player slot.');
        }
        await refresh();
        const entryCoins = Number(result.entryCoinsPaid ?? tournament.entryCoins ?? 0);
        showLocalizedAlert(
          'Registration confirmed',
          entryCoins > 0
            ? `Your player slot is confirmed and ${entryCoins} coins were deducted from your wallet. Check MY MATCHES for room details.`
            : 'Your player slot is confirmed. Check MY MATCHES for room details.',
        );
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
        showLocalizedAlert('Registration confirmed', message);
      } else {
        showLocalizedAlert('Registration pending', 'This registration is still awaiting admin review. Check MY MATCHES for its status and room details.');
      }
      navigation.goBack();
    }} />;
}

const navTheme = {
  ...DarkTheme, colors: {
    ...DarkTheme.colors,
    background: UI.background,
    card: UI.card,
    border: UI.border,
    primary: UI.primary,
    text: UI.foreground,
  },
};

function DailyAppContent({
  signOutClerk,
  testInitialUser,
  logoutNativeTestControls,
  googleSSONativeTestHarness,
}: {
  signOutClerk?: () => Promise<void>;
  testInitialUser?: User;
  logoutNativeTestControls?: LogoutNativeTestControls;
  googleSSONativeTestHarness?: GoogleSSONativeTestHarness;
}) {
  const [booting, setBooting] = useState(!testInitialUser);
  const [user, setUser] = useState<User | null>(testInitialUser ?? null);
  const { setAccountId } = useDaily007Language();
  const { t, i18n } = useTranslation();
  const [logoutPending, setLogoutPending] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const [googleLinkError, setGoogleLinkError] = useState('');
  const [pendingGoogleLinkSession, setPendingGoogleLinkSession] = useState<User | null>(null);
  const [verificationSession, setVerificationSession] = useState<User | null>(null);
  const [sessionReadFailed, setSessionReadFailed] = useState(false);
  const [retryingVerification, setRetryingVerification] = useState(false);
  const refreshRequest = useRef<Promise<User | null> | null>(null);
  const accessRefreshRequest = useRef<Promise<User | null> | null>(null);
  const resumeAccessRefreshRequest = useRef<Promise<User | null> | null>(null);
  const verificationRequest = useRef<Promise<void> | null>(null);
  const logoutInFlight = useRef(false);

  useEffect(() => {
    const accountId = user?.id ?? user?.$id ?? null;
    void setAccountId(accountId);
  }, [user?.id, user?.$id, setAccountId]);

  useEffect(() => {
    const handleExpiredSession = (reason?: 'blocked') => {
      setAuthNotice(reason === 'blocked'
        ? BLOCKED_ACCOUNT_SESSION_NOTICE
        : 'Your Daily007 session is no longer valid. Sign in again to continue.');
      setGoogleLinkError('');
      setPendingGoogleLinkSession(null);
      setSession(null);
      setUser(null);
      queryClient.clear();
    };
    setSessionExpiredHandler(handleExpiredSession);
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    if (testInitialUser) return;
    let mounted = true;
    void (async () => {
      try {
        const result = await restoreDaily007Session(getSession, Api.me, setSession);
        if (!mounted) return;
        if (result.status === 'verified') setUser(result.session);
        else if (result.status === 'retry') setVerificationSession(result.session);
        else if (result.status === 'rejected' && result.reason === 'blocked') {
          setAuthNotice(BLOCKED_ACCOUNT_SESSION_NOTICE);
        }
      } catch {
        if (mounted) setSessionReadFailed(true);
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const retrySessionVerification = useCallback((): Promise<void> => {
    if (!verificationSession) return Promise.resolve();
    return runSingleFlight(verificationRequest, async () => {
      const savedSession = verificationSession;
      setRetryingVerification(true);
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
          if (result.status === 'rejected' && result.reason === 'blocked') {
            setAuthNotice(BLOCKED_ACCOUNT_SESSION_NOTICE);
          }
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
    });
  }, [verificationSession]);

  const retrySessionRead = useCallback((): Promise<void> => {
    if (!sessionReadFailed) return Promise.resolve();
    return runSingleFlight(verificationRequest, async () => {
      setRetryingVerification(true);
      try {
        const result = await restoreDaily007Session(getSession, Api.me, setSession);
        setSessionReadFailed(false);
        if (result.status === 'verified') setUser(result.session);
        else if (result.status === 'retry') setVerificationSession(result.session);
        else if (result.status === 'rejected' && result.reason === 'blocked') {
          setAuthNotice(BLOCKED_ACCOUNT_SESSION_NOTICE);
        }
      } catch {
        // Keep the recovery screen visible; a failed read is not a missing session.
        setSessionReadFailed(true);
      } finally {
        setRetryingVerification(false);
      }
    });
  }, [sessionReadFailed]);

  useEffect(() => {
    return subscribeToSessionVerificationRecovery(
      !!verificationSession || sessionReadFailed,
      () => {
        if (verificationSession) void retrySessionVerification();
        else void retrySessionRead();
      },
      Network,
      AppState,
    );
  }, [verificationSession, sessionReadFailed, retrySessionRead, retrySessionVerification]);

  const refresh = useCallback((): Promise<User | null> => {
    if (refreshRequest.current) return refreshRequest.current;
    const request = (async () => {
      const identity = captureSessionIdentity();
      if (!identity) return null;
      try {
        const u = await Api.me();
        if (u) {
          const saved = await setSessionForIdentity(u, identity);
          if (!saved) return null;
          setUser(u);
          return u;
        }
      } catch (e: any) {
        if (
          (e?.response?.status === 401 || e?.response?.status === 403) &&
          isSessionIdentityCurrent(identity)
        ) {
          if (isBlockedAccountError(e)) setAuthNotice(BLOCKED_ACCOUNT_SESSION_NOTICE);
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
      const identity = captureSessionIdentity();
      if (!previous || !identity) return null;
      return refreshUserAccountAccessSafely(
        previous,
        () => Api.meAccount(),
        async (refreshedUser) => {
          const saved = await setSessionForIdentity(refreshedUser, identity);
          if (!saved) return false;
          setUser(refreshedUser);
          return true;
        },
        (error) => {
          setAuthNotice(isBlockedAccountError(error)
            ? BLOCKED_ACCOUNT_SESSION_NOTICE
            : 'Your Daily007 session is no longer valid. Sign in again to continue.');
          setSession(null);
          setUser(null);
        },
        () => isSessionIdentityCurrent(identity),
      );
    })();
    accessRefreshRequest.current = request;
    void request.finally(() => {
      if (accessRefreshRequest.current === request) accessRefreshRequest.current = null;
    });
    return request;
  }, []);

  const refreshAccessOnResume = useCallback(
    () => refreshAccessAfterPending(
      accessRefreshRequest.current,
      resumeAccessRefreshRequest,
      refreshAccess,
    ),
    [refreshAccess],
  );

  useEffect(() => {
    if (!user) return;
    const subscription = AppState.addEventListener('change', (state) => {
      refreshAccessIfActive(state, refreshAccessOnResume);
    });
    const unsubscribeNetwork = subscribeToAccountAccessReconnect(
      () => AppState.currentState === 'active',
      () => { void refreshAccessOnResume(); },
      Network,
    );
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void refreshAccess();
    }, 30_000);
    return () => {
      subscription.remove();
      unsubscribeNetwork();
      clearInterval(interval);
    };
  }, [user?.id, refreshAccess, refreshAccessOnResume]);

  const logout = useCallback(async () => {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    setLogoutPending(true);
    setUser(null);
    setVerificationSession(null);
    setAuthNotice('');
    setGoogleLinkError('');
    setPendingGoogleLinkSession(null);
    try {
      let retryClearFailed = false;
      let sessionClearFailed = false;
      const accountId = user?.id ?? user?.$id;
      const clerkSignOutFailed = await logoutDaily007(signOutClerk, async () => {
        try {
          if (accountId) await clearPendingVideoRewardRetry(accountId);
        } catch {
          retryClearFailed = true;
        }
        try {
          await clearSessionForLogout();
        } catch {
          sessionClearFailed = true;
        }
      });
      if (clerkSignOutFailed) {
        showLocalizedAlert('Sign-out issue', 'Daily007 signed out, but Clerk sign-out could not be confirmed. Please reopen the app and try again.');
      }
      if (retryClearFailed) {
        showLocalizedAlert('Sign-out issue', 'Daily007 signed out, but the saved video coin retry could not be cleared from this device.');
      }
      if (sessionClearFailed) {
        showLocalizedAlert(
          'Sign-out issue',
          'Daily007 signed out, but device storage could not save the sign-out. Free some storage and sign out again before reopening the app.',
        );
      }
    } finally {
      setUser(null);
      setAuthNotice('');
      setLogoutPending(false);
      logoutInFlight.current = false;
    }
  }, [signOutClerk, user?.id, user?.$id]);

  if (booting) return (
    <View style={s.boot}>
      <Text style={s.logo}>FF DAILY007</Text>
      <ActivityIndicator color={UI.tint} size="large" style={{ marginTop: 20 }} />
    </View>
  );

  if (logoutPending) return (
    <View style={s.boot} testID="logout-pending">
      <Text style={s.logo}>FF DAILY007</Text>
      <ActivityIndicator color={UI.tint} size="large" style={{ marginTop: 20 }} />
      <Text
        accessibilityRole="text"
        accessibilityLabel="Signing out of Daily007. Please wait."
        accessibilityLiveRegion="polite"
        style={s.logoutPendingText}
      >
        Signing out…
      </Text>
      {logoutNativeTestControls ? (
        <View style={s.logoutNativeTestControls}>
          <Text testID="logout-test-signout-call-count" style={s.logoutPendingText}>
            Clerk sign-out calls: {logoutNativeTestControls.signOutCalls}
          </Text>
          <Pressable
            testID="logout-test-repeat"
            accessibilityRole="button"
            accessibilityLabel="Try another logout while sign-out is pending"
            onPress={() => { void logout(); }}
            style={s.logoutNativeTestButton}
          >
            <Text style={s.logoutPendingText}>Try another logout</Text>
          </Pressable>
          <Pressable
            testID="logout-test-resolve"
            accessibilityRole="button"
            accessibilityLabel="Complete Clerk sign-out successfully"
            onPress={logoutNativeTestControls.onResolveClerkSignOut}
            style={s.logoutNativeTestButton}
          >
            <Text style={s.logoutPendingText}>Complete Clerk sign-out</Text>
          </Pressable>
          <Pressable
            testID="logout-test-reject"
            accessibilityRole="button"
            accessibilityLabel="Fail Clerk sign-out"
            onPress={logoutNativeTestControls.onRejectClerkSignOut}
            style={s.logoutNativeTestButton}
          >
            <Text style={s.logoutPendingText}>Fail Clerk sign-out</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  if (!user && verificationSession) return (
    <SessionVerificationPaused
      onRetry={() => { void retrySessionVerification(); }}
      retrying={retryingVerification}
    />
  );

  if (!user && sessionReadFailed) return (
    <SessionVerificationPaused
      onRetry={() => { void retrySessionRead(); }}
      retrying={retryingVerification}
      message="Daily007 could not read your saved sign-in from this device. It has not been cleared. Check device storage and retry."
    />
  );

  if (!user) return <Auth
    notice={authNotice}
    onDone={(u) => {
      if (logoutInFlight.current) return;
      setAuthNotice('');
      setGoogleLinkError('');
      setPendingGoogleLinkSession(null);
      setUser(u);
    }}
  />;

  const rootNavigation = rootNavigationForRole(user.role);

  return (
    <Ctx.Provider value={{
      user,
      refresh,
      logout,
      googleLinkError,
      setGoogleLinkError,
      pendingGoogleLinkSession,
      setPendingGoogleLinkSession,
      ...(googleSSONativeTestHarness ? { googleSSONativeTestHarness } : {}),
    }}>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer theme={navTheme}>
          <Stack.Navigator screenOptions={{
            headerStyle: { backgroundColor: UI.muted },
            headerTintColor: UI.tint,
            headerTitleStyle: {
              color: UI.accent,
              fontSize: 18,
              fontWeight: '700',
              fontFamily: i18n.language === 'en' ? 'Rajdhani_700Bold' : undefined,
            },
            contentStyle: { backgroundColor: UI.background },
          }}>
            {rootNavigation === 'Admin' ? (
              <Stack.Screen name="Admin" component={AdminApp} options={{ headerShown: false }} />
            ) : (
              <>
                <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
                <Stack.Screen name="ModeSubmodes" component={ModeSubmodes} options={{ title: t('SELECT FORMAT') }} />
                <Stack.Screen name="Tournaments" component={Tournaments} options={{ title: t('MATCHES') }} />
                <Stack.Screen name="MyMatches" component={MyMatches} options={{ title: t('MY MATCHES') }} />
                <Stack.Screen name="TDetail" component={TDetail} options={{ title: t('TOURNAMENT') }} />
                <Stack.Screen name="JoinForm" component={JoinFormRoute} options={{ title: t('REGISTER'), presentation: 'modal' }} />
                <Stack.Screen name="LeaderboardDetails" component={LeaderboardDetails} options={{ title: t('Leaderboard') }} />
                <Stack.Screen name="Leaderboard" component={Leaderboard} options={{ title: t('LEADERBOARD') }} />
                <Stack.Screen name="Notifications" component={Notifications} options={{ title: t('NOTIFICATIONS') }} />
                <Stack.Screen name="EditProfile" component={EditProfile} options={{ title: t('EDIT PROFILE') }} />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>
    </Ctx.Provider>
  );
}

function DailyApp(props: {
  signOutClerk?: () => Promise<void>;
  testInitialUser?: User;
  logoutNativeTestControls?: LogoutNativeTestControls;
  googleSSONativeTestHarness?: GoogleSSONativeTestHarness;
}) {
  return (
    <Daily007LanguageProvider>
      <DailyAppContent {...props} />
    </Daily007LanguageProvider>
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
  boot: { flex: 1, backgroundColor: UI.background, alignItems: 'center', justifyContent: 'center' },
  logo: { color: UI.primary, fontSize: 30, fontWeight: '900', letterSpacing: 3, textShadowColor: `${UI.primary}66`, textShadowRadius: 20 },
  logoutPendingText: { color: '#F5F7FF', fontSize: 15, fontWeight: '600', marginTop: 16 },
  logoutNativeTestControls: { alignItems: 'center', marginTop: 12 },
  logoutNativeTestButton: { borderWidth: 1, borderColor: UI.tint, borderRadius: 10, marginTop: 8, padding: 10 },
});
