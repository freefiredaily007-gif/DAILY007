import React from 'react';
import { View, StyleSheet } from 'react-native';

// Premium user-account avatar badge icon, 24x24, pure RN views (no SVG dep).
// Active: glowing gold (#FFC107) filled avatar inside a circular badge frame.
// Inactive: clean line-art stroke version in neutral gray (#888888).

export function ProfileIconActive() {
  return (
    <View style={st.wrap}>
      <View style={[st.frame, { borderColor: '#FFC107', backgroundColor: '#FFC10722' }]}>
        <View style={[st.head, { backgroundColor: '#FFC107' }]} />
        <View style={[st.shoulders, { backgroundColor: '#FFC107' }]} />
      </View>
      <View style={st.glow} />
    </View>
  );
}

export function ProfileIconInactive() {
  return (
    <View style={st.wrap}>
      <View style={[st.frame, { borderColor: '#888888', backgroundColor: 'transparent' }]}>
        <View style={[st.head, { backgroundColor: '#888888' }]} />
        <View style={[st.shoulders, { backgroundColor: '#888888' }]} />
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
    backgroundColor: '#FFC10733', zIndex: -1,
  },
});