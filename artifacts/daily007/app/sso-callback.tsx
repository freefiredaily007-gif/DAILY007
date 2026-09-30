import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

// This route is the web popup return target. Call synchronously at module load
// so the popup can notify and close its opener before the screen renders.
const authCompletion = Platform.OS === 'web'
  ? WebBrowser.maybeCompleteAuthSession()
  : null;

export default function SSOCallback() {
  const message = Platform.OS === 'web'
    ? authCompletion?.type === 'success'
      ? 'Google sign-in is complete. Return to Daily007 to continue.'
      : 'Google sign-in returned to Daily007. You can close this page and try again if sign-in did not finish.'
    : 'Google sign-in returned to Daily007. Return to the app to continue.';

  return (
    <View style={s.container}>
      <Text style={s.title}>DAILY007</Text>
      <Text style={s.message}>{message}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070a12', alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { color: '#ff3d3d', fontSize: 24, fontWeight: '900', letterSpacing: 2 },
  message: { color: '#eef1f8', fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 14 },
});