import React from 'react';
import { View, StyleSheet } from 'react-native';

// YouTube-style play icon built with pure RN Views (no SVG dependency).
// 24x24, aligned with the other tab icons.

export function VideoIconActive({ color = '#FF0000' }: { color?: string }) {
  return (
    <View style={[styles.frame, { borderColor: color, backgroundColor: color, shadowColor: color, shadowOpacity: 0.55, shadowRadius: 7, shadowOffset: { width: 0, height: 0 }, elevation: 4 }]}>
      <View style={[styles.triangle, { borderLeftColor: '#070A12' }]} />
    </View>
  );
}

export function VideoIconInactive() {
  return (
    <View style={[styles.frame, { borderColor: '#888888', backgroundColor: 'transparent' }]}>
      <View style={[styles.triangle, { borderLeftColor: '#888888' }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  triangle: {
    width: 0, height: 0, marginLeft: 3,
    borderTopWidth: 5, borderBottomWidth: 5, borderLeftWidth: 8,
    borderTopColor: 'transparent', borderBottomColor: 'transparent',
  },
});