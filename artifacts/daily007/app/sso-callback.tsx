import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { ReadableText as Text } from '../src/components/typography';
import colors from '../constants/colors';
import * as WebBrowser from 'expo-web-browser';
import { getSSOCallbackMessage } from '../src/lib/google-sso-flow';

// This route is the web popup return target. Call synchronously at module load
// so the popup can notify and close its opener before the screen renders.
const authCompletion = Platform.OS === 'web'
  ? WebBrowser.maybeCompleteAuthSession()
  : null;
const UI = colors.light;

export default function SSOCallback() {
  const message = getSSOCallbackMessage(Platform.OS, authCompletion?.type);

  return (
    <View style={s.container}>
      <Text style={s.title}>DAILY007</Text>
      <Text style={s.message}>{message}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: UI.background, alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { color: UI.primary, fontFamily: 'Orbitron_700Bold', fontSize: 22, fontWeight: '900', letterSpacing: 1.4 },
  message: { color: UI.foreground, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 14 },
});