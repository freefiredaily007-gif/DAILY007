import React from 'react';
import { View, StyleSheet } from 'react-native';
import colors from '../../constants/colors';

const GOLD = colors.light.accent;
const BLUE = colors.light.primary;
const MUTED = colors.light.mutedForeground;

// Golden wallet with rupee coin — active (gold gradient body + glowing coin)
export function WalletIconActive({ size = 26 }: { size?: number }) {
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {/* wallet body */}
      <View style={[styles.body, { width: size, height: size * 0.68, borderRadius: size * 0.16, top: size * 0.16 }]}>
        <View style={styles.slot} />
        <View style={styles.dotRow}>
          <View style={[styles.dot, { width: 3, height: 3 }]} />
          <View style={[styles.dot, { width: 2, height: 2, opacity: 0.6 }]} />
        </View>
      </View>
      {/* coin */}
      <View style={[styles.coin, { width: size * 0.42, height: size * 0.42, right: size * 0.06, top: size * 0.3 }]}>
        <View style={styles.rupee}>
          <View style={styles.rTop} />
          <View style={styles.rMid} />
          <View style={styles.rLeg} />
        </View>
      </View>
    </View>
  );
}

// Inactive — sleek grey line-art wallet
export function WalletIconInactive({ size = 26 }: { size?: number }) {
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <View style={[styles.bodyLine, { width: size - 2, height: (size - 2) * 0.66, borderRadius: size * 0.15, top: size * 0.17 }]} />
      <View style={[styles.slotLine, { width: size - 2, top: size * 0.17 + (size - 2) * 0.22 }]} />
      <View style={[styles.coinLine, { width: size * 0.4, height: size * 0.4, right: size * 0.07, top: size * 0.31 }]}>
        <View style={styles.rupeeGrey}>
          <View style={styles.rTopG} />
          <View style={styles.rMidG} />
          <View style={styles.rLegG} />
        </View>
      </View>
    </View>
  );
}

const GOLD2 = BLUE;
const GREY = MUTED;

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  body: {
    position: 'absolute', left: 1,
    backgroundColor: GOLD,
    borderWidth: 1, borderColor: GOLD2,
    shadowColor: GOLD, shadowOpacity: 0.55, shadowRadius: 6, shadowOffset: { width: 0, height: 0 }, elevation: 4,
  },
  slot: { position: 'absolute', top: '30%', left: 0, right: 0, height: 1, backgroundColor: '#8a5a00', opacity: 0.4 },
  dotRow: { position: 'absolute', top: 3, left: 4, flexDirection: 'row', gap: 2 },
  dot: { borderRadius: 2, backgroundColor: '#fff8e1' },
  coin: {
    position: 'absolute', borderRadius: 99, backgroundColor: '#FFF3C4',
    borderWidth: 1.2, borderColor: '#B8860B',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#FFF3C4', shadowOpacity: 0.8, shadowRadius: 5, shadowOffset: { width: 0, height: 0 }, elevation: 3,
  },
  rupee: { alignItems: 'center' },
  rTop: { width: 7, height: 1.2, backgroundColor: '#8a5a00', borderRadius: 1 },
  rMid: { width: 7, height: 1.2, backgroundColor: '#8a5a00', borderRadius: 1, marginTop: 1.5 },
  rLeg: { width: 5, height: 4, borderLeftWidth: 1.2, borderBottomWidth: 1.2, borderColor: '#8a5a00', borderBottomLeftRadius: 3, marginTop: 0.5, marginLeft: 1 },
  bodyLine: { position: 'absolute', left: 2, borderWidth: 1.6, borderColor: GREY, backgroundColor: 'transparent' },
  slotLine: { position: 'absolute', left: 2, height: 1.6, backgroundColor: GREY, opacity: 0.8 },
  coinLine: { position: 'absolute', borderRadius: 99, borderWidth: 1.6, borderColor: GREY, alignItems: 'center', justifyContent: 'center' },
  rupeeGrey: { alignItems: 'center' },
  rTopG: { width: 6, height: 1.2, backgroundColor: GREY, borderRadius: 1 },
  rMidG: { width: 6, height: 1.2, backgroundColor: GREY, borderRadius: 1, marginTop: 1.5 },
  rLegG: { width: 4, height: 3.5, borderLeftWidth: 1.2, borderBottomWidth: 1.2, borderColor: GREY, borderBottomLeftRadius: 3, marginTop: 0.5, marginLeft: 1 },
});