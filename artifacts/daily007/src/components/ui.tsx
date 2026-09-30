// Shared UI kit — PREMIUM ESPORTS gaming theme (FREE FIRE DAILY007)
import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, Animated, Easing } from 'react-native';
export { default as TimePicker } from './TimePicker';

export const C = {
  bg: '#070a12', bg2: '#0b1020', card: '#10162b', card2: '#141b33', border: '#1e2745',
  neon: '#ff3d3d', orange: '#ff7a1a', gold: '#ffb020', green: '#2ecc71', blue: '#4da3ff',
  purple: '#a05cff', red: '#ff5c5c', text: '#eef1f8', sub: '#9aa3b8', dim: '#5b6478', line: '#1e2745',
};

// ---------- glow helpers ----------
export const glow = (color: string, strength = 6) => ({
  shadowColor: color, shadowOpacity: 0.55, shadowRadius: strength, shadowOffset: { width: 0, height: 0 },
  elevation: strength,
});

// ---------- animated neon pulse wrapper ----------
export function Pulse({ children, color = C.neon, speed = 1600, style }: {
  children: React.ReactNode; color?: string; speed?: number; style?: any;
}) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: speed, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(a, { toValue: 0, duration: speed, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]));
    loop.start(); return () => loop.stop();
  }, [a, speed]);
  const opacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] });
  return (
    <View style={[{ position: 'relative' }, style]}>
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', inset: -2, borderRadius: 18, borderWidth: 2, borderColor: color, opacity }}
      />
      {children}
    </View>
  );
}

// ---------- shimmer loading bar ----------
export function Shimmer({ height = 90, style }: { height?: number; style?: any }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(a, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }));
    loop.start(); return () => loop.stop();
  }, [a]);
  const tx = a.interpolate({ inputRange: [0, 1], outputRange: [-250, 250] });
  return (
    <View style={[{ height, borderRadius: 14, backgroundColor: C.card, overflow: 'hidden', marginBottom: 10 }, style]}>
      <Animated.View
        style={{ position: 'absolute', top: 0, bottom: 0, width: 180, transform: [{ translateX: tx }] }}
      >
        <View style={{ flex: 1, backgroundColor: '#ffffff10' }} />
      </Animated.View>
    </View>
  );
}

// ---------- buttons ----------
export function Btn({ title, onPress, disabled, kind = 'primary', small, loading, style }: {
  title: string; onPress?: () => void; disabled?: boolean;
  kind?: 'primary' | 'ghost' | 'danger' | 'purple' | 'gold'; small?: boolean; loading?: boolean; style?: any;
}) {
  const map: Record<string, { bg: string; fg: string; border?: string; glowColor?: string }> = {
    primary: { bg: C.neon, fg: '#fff', glowColor: C.neon },
    danger: { bg: '#5a1622', fg: '#ff9aa5', border: '#ff5c5c55' },
    purple: { bg: '#3a1f66', fg: '#d9b8ff', border: C.purple + '66', glowColor: C.purple },
    gold: { bg: '#4a3208', fg: C.gold, border: C.gold + '77', glowColor: C.gold },
    ghost: { bg: 'transparent', fg: C.sub, border: C.border },
  };
  const k = map[kind] || map.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        st.btn,
        { backgroundColor: k.bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        k.border && { borderWidth: 1, borderColor: k.border },
        k.glowColor && !disabled && glow(k.glowColor, 8),
        small && { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color="#fff" size="small" />
        : <Text style={[st.btnText, { color: k.fg }]}>{title}</Text>}
    </Pressable>
  );
}

// ---------- glass card ----------
export function Card({ children, style, glowColor }: { children: React.ReactNode; style?: any; glowColor?: string }) {
  return (
    <View style={[st.card, glowColor ? [glow(glowColor, 10), { borderColor: glowColor + '55' }] : null, style]}>
      {children}
    </View>
  );
}

// ---------- pressable gaming card (scale press animation) ----------
export function GCard({ children, onPress, style, glowColor }: {
  children: React.ReactNode; onPress?: () => void; style?: any; glowColor?: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const press = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  const release = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 8 }).start();
  const Body = (
    <Animated.View style={[st.card, glowColor ? [glow(glowColor, 10), { borderColor: glowColor + '55' }] : null, style, { transform: [{ scale }] }]}>
      {children}
    </Animated.View>
  );
  if (!onPress) return Body;
  return <Pressable onPressIn={press} onPressOut={release} onPress={onPress}>{Body}</Pressable>;
}

export function Input(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      {...props}
      style={[st.input, props.style]}
      placeholderTextColor={props.placeholderTextColor || C.dim}
    />
  );
}

export function Msg({ kind, text }: { kind: 'ok' | 'err'; text: string }) {
  if (!text) return null;
  const ok = kind === 'ok';
  return (
    <View style={[st.msg, { borderColor: ok ? C.green + '66' : C.red + '66', backgroundColor: (ok ? C.green : C.red) + '14' }]}>
      <Text style={{ color: ok ? C.green : C.red, fontSize: 13, fontWeight: '600' }}>
        {ok ? '✓ ' : '⚠ '}{text}
      </Text>
    </View>
  );
}

// ---------- premium gaming empty state ----------
export function Empty({ icon, text, actionLabel, onAction }: {
  icon?: string; text: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <View style={st.empty}>
      <View style={[st.emptyIconWrap, glow(C.purple, 14)]}>
        <Text style={{ fontSize: 40 }}>{icon || '🎮'}</Text>
      </View>
      <Text style={st.emptyTitle}>NO MATCHES LIVE</Text>
      <Text style={st.emptyText}>{text}</Text>
      {!!actionLabel && <Btn title={actionLabel} kind="purple" onPress={onAction} style={{ marginTop: 16, alignSelf: 'center', paddingHorizontal: 24 }} />}
    </View>
  );
}

export function Loading() {
  return <ActivityIndicator color={C.neon} style={{ marginTop: 40 }} size="large" />;
}

export function SectionTitle({ children, accent = C.neon }: { children: React.ReactNode; accent?: string }) {
  return (
    <View style={st.secRow}>
      <View style={[st.secBar, { backgroundColor: accent }, glow(accent, 6)]} />
      <Text style={st.secText}>{children}</Text>
    </View>
  );
}

export function Chip({ label, color = C.gold, onPress }: { label: string; color?: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[st.chip, { borderColor: color }]}>
      <Text style={[st.chipText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ text, color = C.gold }: { text: string; color?: string }) {
  return (
    <View style={[st.chip, { borderColor: color, alignSelf: 'auto', backgroundColor: color + '18' }, glow(color, 4)]}>
      <Text style={[st.chipText, { color }]}>{text}</Text>
    </View>
  );
}

export function KV({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <View style={st.kvRow}>
      <Text style={st.kvK}>{k}</Text>
      <Text style={[st.kvV, { color: color || C.text }]}>{v}</Text>
    </View>
  );
}

export function Coin({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ fontSize: size }}>🪙</Text>
      <Text style={{ fontSize: size, color: C.gold, fontWeight: '800', marginLeft: 3 }}>{value}</Text>
    </View>
  );
}

// ---------- esports match card ----------
export function fmtTime12(t?: string) {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  let h = parseInt(m[1], 10); const min = m[2];
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ap}`;
}

export function fmtDate(d?: string) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return `${String(dt.getDate()).padStart(2, '0')} ${dt.toLocaleString('en', { month: 'short' }).toUpperCase()}`;
}

export function statusOf(t: any): { key: string; label: string; color: string } {
  const st = (t?.status || 'upcoming').toLowerCase();
  if (st === 'live') return { key: 'live', label: '🔴 LIVE', color: C.neon };
  if (st === 'completed') return { key: 'completed', label: 'COMPLETED', color: C.dim };
  const filled = (t?.filledSlots ?? 0) >= (t?.totalSlots ?? 0);
  if (filled) return { key: 'full', label: 'FULL', color: C.orange };
  return { key: 'upcoming', label: 'UPCOMING', color: C.green };
}

export function MatchCard({ t, onPress }: { t: any; onPress?: () => void }) {
  const s = statusOf(t);
  const filled = t?.filledSlots ?? 0;
  const total = t?.totalSlots ?? 0;
  return (
    <GCard onPress={onPress} glowColor={s.key === 'live' ? C.neon : undefined} style={{ marginBottom: 12 }}>
      <View style={mc.topRow}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={mc.mode}>{(t?.mode || 'BATTLE ROYALE').toUpperCase()}</Text>
          <Text style={mc.name} numberOfLines={1}>{t?.name || t?.title || 'Tournament'}</Text>
        </View>
        <Badge text={s.label} color={s.color} />
      </View>
      <View style={mc.sep} />
      <View style={mc.metaRow}>
        <Text style={mc.meta}>📅 {fmtDate(t?.date)}{t?.time ? ` • ${fmtTime12(t.time)}` : ''}</Text>
        <Text style={mc.meta}>👥 {filled}/{total}</Text>
      </View>
      <View style={mc.statRow}>
        <View style={mc.stat}>
          <Text style={mc.statK}>ENTRY</Text>
          <Text style={[mc.statV, { color: C.gold }]}>🪙 {t?.entryCoins ?? 0}</Text>
        </View>
        <View style={[mc.stat, { borderLeftWidth: 1, borderLeftColor: C.border, borderRightWidth: 1, borderRightColor: C.border }]}>
          <Text style={mc.statK}>PRIZE POOL</Text>
          <Text style={[mc.statV, { color: C.green }]}>🪙 {t?.prizePool ?? 0}</Text>
        </View>
        <View style={mc.stat}>
          <Text style={mc.statK}>SLOTS</Text>
          <Text style={[mc.statV, { color: C.blue }]}>{filled}/{total}</Text>
        </View>
      </View>
      <View style={[mc.joinBtn, { backgroundColor: s.key === 'full' || s.key === 'completed' ? C.card2 : C.neon + '22', borderColor: s.key === 'full' || s.key === 'completed' ? C.border : C.neon + '77' }]}>
        <Text style={[mc.joinText, { color: s.key === 'full' || s.key === 'completed' ? C.dim : C.neon }]}>
          {s.key === 'live' ? '▶ ENTER MATCH' : s.key === 'full' ? 'MATCH FULL' : s.key === 'completed' ? 'ENDED' : 'JOIN NOW →'}
        </Text>
      </View>
    </GCard>
  );
}

const mc = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'flex-start' },
  mode: { color: C.orange, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  name: { color: C.text, fontSize: 16, fontWeight: '900', marginTop: 2 },
  sep: { height: 1, backgroundColor: C.border, marginVertical: 10 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  meta: { color: C.sub, fontSize: 12, fontWeight: '600' },
  statRow: { flexDirection: 'row', borderRadius: 10, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  statK: { color: C.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  statV: { fontSize: 14, fontWeight: '900', marginTop: 2 },
  joinBtn: { marginTop: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center', paddingVertical: 10 },
  joinText: { fontWeight: '900', fontSize: 12, letterSpacing: 1.5 },
});

// ---------- glowing coin capsule (header) ----------
export function CoinCapsule({ value, onPress }: { value: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.capsule, glow(C.gold, 10), pressed && { opacity: 0.85 }]}>
      <Text style={{ fontSize: 15 }}>🪙</Text>
      <Text style={st.capsuleText}>{value}</Text>
      <Text style={st.capsuleUnit}>COINS</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  btn: { paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  btnText: { fontWeight: '900', letterSpacing: 1.2, fontSize: 14 },
  card: {
    backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border,
    // subtle top-edge metallic highlight
    borderTopColor: '#2a3558',
  },
  input: {
    backgroundColor: C.card2, color: C.text, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 11, borderWidth: 1, borderColor: C.border, marginBottom: 10, fontSize: 14,
  },
  msg: { borderRadius: 10, borderWidth: 1, padding: 12, marginTop: 10 },
  empty: { alignItems: 'center', padding: 34 },
  emptyIconWrap: {
    width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.card2, borderWidth: 2, borderColor: C.purple + '66', marginBottom: 14,
  },
  emptyTitle: { color: C.text, fontWeight: '900', fontSize: 17, letterSpacing: 2 },
  emptyText: { color: C.dim, marginTop: 8, textAlign: 'center', fontSize: 13 },
  secRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 12 },
  secBar: { width: 4, height: 18, borderRadius: 2, marginRight: 8 },
  secText: { color: C.text, fontSize: 16, fontWeight: '900', letterSpacing: 1.5 },
  chip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  chipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.border + '66' },
  kvK: { color: C.sub, fontSize: 13 },
  kvV: { fontWeight: '800', fontSize: 13 },
  capsule: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1408',
    borderWidth: 1.5, borderColor: C.gold, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 7,
  },
  capsuleText: { color: C.gold, fontWeight: '900', fontSize: 15, marginLeft: 5 },
  capsuleUnit: { color: C.gold + '99', fontWeight: '800', fontSize: 9, letterSpacing: 1, marginLeft: 4 },
});
