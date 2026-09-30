import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function Video() {
  return (
    <View style={s.root}>
      <Text style={s.title}>VIDEO</Text>
      <View style={s.notice}>
        <Text style={s.noticeTitle}>WATCH REWARDS PAUSED</Text>
        <Text style={s.message}>
          Video coin rewards are unavailable while watch verification is paused. No playable video media is currently configured.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#070a12', padding: 16 },
  title: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 1, marginBottom: 16 },
  notice: { backgroundColor: '#10162b', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#4b3540' },
  noticeTitle: { color: '#ffd166', fontWeight: '900', fontSize: 13, letterSpacing: 1 },
  message: { color: '#aab2c5', fontSize: 13, lineHeight: 19, marginTop: 8 },
});