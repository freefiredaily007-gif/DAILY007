import React from 'react';
import { View, StyleSheet } from 'react-native';
import colors from '../../constants/colors';

const GOLD = colors.light.accent;
const MUTED = colors.light.mutedForeground;

// Premium user-account avatar badge icon, 24x24, pure RN views (no SVG dep).
// Active: glowing gold filled avatar inside a circular badge frame.
// Inactive: clean line-art stroke version in muted slate.

export function ProfileIconActive() {
  return (
    <View style={st.wrap}>
      <View style={[st.frame, { borderColor: GOLD, backgroundColor: `${GOLD}22` }]}>
        <View style={[st.head, { backgroundColor: GOLD }]} />
        <View style={[st.shoulders, { backgroundColor: GOLD }]} />
      </View>
      <View style={st.glow} />
    </View>
  );
}

export function ProfileIconInactive() {
  return (
    <View style={st.wrap}>
      <View style={[st.frame, { borderColor: MUTED, backgroundColor: 'transparent' }]}>
        <View style={[st.head, { backgroundColor: MUTED }]} />
        <View style={[st.shoulders, { backgroundColor: MUTED }]} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  head: { width: 7, height: 7, borderRadius: 4, marginTop: 3 },
  shoulders: { width: 12, height: 6, borderTopLeftRadius: 6, borderTopRightRadius: 6, marginTop: 1 },
  glow: {
    position: 'absolute', width: 30, height: 30, borderRadius: 15,
    backgroundColor: `${GOLD}33`, zIndex: -1,
  },
});