import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Orbitron_700Bold } from '@expo-google-fonts/orbitron';
import {
  Rajdhani_400Regular,
  Rajdhani_500Medium,
  Rajdhani_600SemiBold,
  Rajdhani_700Bold,
} from '@expo-google-fonts/rajdhani';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import { ClerkLoaded, ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { getSession } from '../src/lib/api';
import colors from '../constants/colors';

const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);
setAuthTokenGetter(async () => (await getSession())?.token ?? null);
const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;
const androidJoinRecoverySmokeTest =
  process.env.EXPO_PUBLIC_ANDROID_JOIN_RECOVERY_TEST === '1';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function setupWebPwa() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;

  const head = document.head;
  if (!head.querySelector('link[rel="manifest"]')) {
    const manifestLink = document.createElement('link');
    manifestLink.rel = 'manifest';
    manifestLink.href = '/manifest.json';
    head.appendChild(manifestLink);
  }
  if (!head.querySelector('meta[name="theme-color"]')) {
    const themeColor = document.createElement('meta');
    themeColor.name = 'theme-color';
    themeColor.content = colors.light.background;
    head.appendChild(themeColor);
  }
  if (!head.querySelector('link[rel="apple-touch-icon"]')) {
    const touchIcon = document.createElement('link');
    touchIcon.rel = 'apple-touch-icon';
    touchIcon.href = '/icons/icon-192.png';
    head.appendChild(touchIcon);
  }
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((error) => {
        console.error('Daily007 service worker registration failed', error);
      });
  }
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="join-recovery-test" />
      <Stack.Screen name="session-verification-test" />
      <Stack.Screen name="join-form-accessibility-test" />
      <Stack.Screen name="video-unavailable-test" />
      <Stack.Screen name="video-link-recovery-test" />
      <Stack.Screen name="google-recovery-accessibility-test" />
      <Stack.Screen name="google-link-native-test" />
      <Stack.Screen name="signup-session-retry-accessibility-test" />
      <Stack.Screen name="password-signup-restart-test" />
      <Stack.Screen name="withdrawal-upi-copy-test" />
      <Stack.Screen name="wallet-cancellation-refund-voiceover-test" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Orbitron_700Bold,
    Rajdhani_400Regular,
    Rajdhani_500Medium,
    Rajdhani_600SemiBold,
    Rajdhani_700Bold,
  });

  useEffect(() => {
    setupWebPwa();
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError || androidJoinRecoverySmokeTest) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError && !androidJoinRecoverySmokeTest) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              {clerkPublishableKey ? (
                <ClerkProvider
                  publishableKey={clerkPublishableKey}
                  tokenCache={tokenCache}
                  proxyUrl={clerkProxyUrl}
                >
                  <ClerkLoaded>
                    <RootLayoutNav />
                  </ClerkLoaded>
                </ClerkProvider>
              ) : (
                <RootLayoutNav />
              )}
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
