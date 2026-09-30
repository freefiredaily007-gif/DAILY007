import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Pure-RN tab icons — 24x24, matching Wallet/Video/Profile icons.

/* ---------------- HOME: house badge ---------------- */

export function HomeIconActive() {
  return <HomeIcon color="#FFC107" glow />;
}

export function HomeIconInactive() {
  return <HomeIcon color="#888888" />;
}

function HomeIcon({ color, glow }: { color: string; glow?: boolean }) {
  return (
    <View style={h.wrap}>
      {glow && <View style={[h.glow, { backgroundColor: '#FFC10733' }]} />}
      {/* roof: filled triangle */}
      <View style={[h.roof, {
        borderLeftColor: 'transparent', borderRightColor: 'transparent',
        borderBottomColor: color,
      }]} />
      {/* body */}
      <View style={[h.body, { borderColor: color, backgroundColor: glow ? '#FFC10722' : 'transparent' }]}>
        <View style={[h.door, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

const h = StyleSheet.create({
  wrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'flex-end' },
  glow: { position: 'absolute', width: 24, height: 24, borderRadius: 12 },
  roof: {
    width: 20, height: 10,
    borderLeftWidth: 10, borderRightWidth: 10, borderBottomWidth: 10,
  },
  body: {
    width: 14, height: 9, borderWidth: 2, borderTopWidth: 0,
    borderBottomLeftRadius: 3, borderBottomRightRadius: 3,
    alignItems: 'center', justifyContent: 'flex-end',
  },
  door: { width: 4, height: 5, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
});

/* ---------------- EARN: shield with ₹ + growth arrow ---------------- */

export function EarnIconActive() {
  return <EarnIcon color="#FFC107" glow />;
}

export function EarnIconInactive() {
  return <EarnIcon color="#888888" />;
}

function EarnIcon({ color, glow }: { color: string; glow?: boolean }) {
  return (
    <View style={e.wrap}>
      {glow && <View style={[e.glow, { backgroundColor: '#FFC10733' }]} />}
      <View style={[e.shield, { borderColor: color, backgroundColor: glow ? '#FFC10722' : 'transparent' }]}>
        <Text style={[e.rupee, { color }]}>{'₹'}</Text>
        <View style={[e.arrow, { borderLeftColor: 'transparent', borderBottomColor: color }]} />
      </View>
    </View>
  );
}

const e = StyleSheet.create({
  wrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 24, height: 24, borderRadius: 12 },
  shield: {
    width: 17, height: 19, borderWidth: 2, borderRadius: 3,
    borderBottomLeftRadius: 9, borderBottomRightRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  rupee: { fontSize: 9, fontWeight: '900', lineHeight: 11, marginTop: -3 },
  arrow: {
    position: 'absolute', bottom: 2, right: 2, width: 6, height: 6,
    borderLeftWidth: 1.5, borderBottomWidth: 1.5,
    transform: [{ rotate: '-45deg' }],
  },
});