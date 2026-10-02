// Premium social brand icons — pure RN Views (no SVG dependency)
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ReadableText as Text } from './typography';

// WhatsApp: green rounded square + white phone glyph
export function WhatsAppIcon({ size = 30 }: { size?: number }) {
  return (
    <View style={[ic.wrap, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: '#25D366' }]}>
      <Text style={{ fontSize: size * 0.55, color: '#fff', fontWeight: '900', marginTop: -size * 0.04 }}>✆</Text>
      <View style={[ic.waTail, { bottom: -size * 0.06, left: size * 0.12, borderTopWidth: size * 0.16, borderRightWidth: size * 0.16, borderTopColor: '#25D366', borderRightColor: '#25D366' }]} />
    </View>
  );
}

// Instagram: gradient rounded square + camera outline (lens + dot)
export function InstagramIcon({ size = 30 }: { size?: number }) {
  return (
    <View style={[ic.wrap, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: '#833AB4' }]}>
      <View style={[ic.igGrad, { borderRadius: size * 0.3 }]} />
      <View style={[ic.igLens, { width: size * 0.5, height: size * 0.5, borderRadius: size * 0.25, borderWidth: Math.max(2, size * 0.09) }]} />
      <View style={[ic.igDot, { width: size * 0.12, height: size * 0.12, borderRadius: size * 0.06, top: size * 0.16, right: size * 0.16 }]} />
    </View>
  );
}

// YouTube: red rounded rect + white play triangle
export function YouTubeIcon({ size = 30 }: { size?: number }) {
  return (
    <View style={[ic.wrap, { width: size * 1.25, height: size * 0.9, borderRadius: size * 0.24, backgroundColor: '#FF0000' }]}>
      <View style={[ic.ytTri, { borderLeftWidth: size * 0.34, borderTopWidth: size * 0.2, borderBottomWidth: size * 0.2, marginLeft: size * 0.08 }]} />
    </View>
  );
}

const ic = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  waTail: { position: 'absolute', width: 0, height: 0, transform: [{ rotate: '180deg' }] },
  igGrad: { position: 'absolute', top: 0, right: 0, width: '100%', height: '100%', backgroundColor: 'transparent' },
  igLens: { borderColor: '#fff', backgroundColor: 'transparent' },
  igDot: { position: 'absolute', backgroundColor: '#fff' },
  ytTri: { width: 0, height: 0, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: '#fff' },
});