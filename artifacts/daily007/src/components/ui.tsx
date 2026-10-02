// Shared UI kit — PREMIUM ESPORTS gaming theme (FREE FIRE DAILY007)
import React, { createContext, useContext, useEffect, useRef } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, Animated, Easing } from 'react-native';
import { Feather } from '@expo/vector-icons';
export { default as TimePicker } from './TimePicker';

export const C = {
  bg: '#070a12', bg2: '#0b1020', card: '#10162b', card2: '#141b33', border: '#1e2745',
  neon: '#ff3d3d', orange: '#ff7a1a', gold: '#ffb020', green: '#2ecc71', blue: '#4da3ff',
  purple: '#a05cff', red: '#ff5c5c', text: '#eef1f8', sub: '#9aa3b8', dim: '#5b6478', line: '#1e2745',
};

const UiSurfaceContext = createContext<'player' | 'admin'>('player');

export function AdminUiProvider({ children }: { children: React.ReactNode }) {
  return <UiSurfaceContext.Provider value="admin">{children}</UiSurfaceContext.Provider>;
}

const useAdminSurface = () => useContext(UiSurfaceContext) === 'admin';

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
export function Btn({ title, onPress, disabled, kind = 'primary', small, loading, style, accessibilityLabel, testID }: {
  title: string; onPress?: () => void; disabled?: boolean;
  kind?: 'primary' | 'ghost' | 'danger' | 'purple' | 'gold'; small?: boolean; loading?: boolean; style?: any;
  accessibilityLabel?: string; testID?: string;
}) {
  const adminSurface = useAdminSurface();
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
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      testID={testID}
      style={({ pressed }) => [
        st.btn,
        adminSurface && adminSt.btn,
        { backgroundColor: k.bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        k.border && { borderWidth: 1, borderColor: k.border },
        k.glowColor && !disabled && glow(k.glowColor, 8),
        small && { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color="#fff" size="small" />
        : <Text style={[st.btnText, adminSurface && adminSt.btnText, { color: k.fg }]}>{title}</Text>}
    </Pressable>
  );
}

// ---------- glass card ----------
export function Card({ children, style, glowColor }: { children: React.ReactNode; style?: any; glowColor?: string }) {
  const adminSurface = useAdminSurface();
  return (
    <View style={[st.card, adminSurface && adminSt.card, glowColor ? [glow(glowColor, 10), { borderColor: glowColor + '55' }] : null, style]}>
      {children}
    </View>
  );
}

// ---------- pressable gaming card (scale press animation) ----------
export function GCard({
  children,
  onPress,
  style,
  glowColor,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: {
  children: React.ReactNode; onPress?: () => void; style?: any; glowColor?: string;
  accessibilityLabel?: string; accessibilityHint?: string; testID?: string;
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      onPressIn={press}
      onPressOut={release}
      onPress={onPress}
    >
      {Body}
    </Pressable>
  );
}

export function Input(props: React.ComponentProps<typeof TextInput>) {
  const adminSurface = useAdminSurface();
  return (
    <TextInput
      {...props}
      style={[st.input, adminSurface && adminSt.input, props.style]}
      placeholderTextColor={props.placeholderTextColor || C.dim}
    />
  );
}

export function Msg({ kind, text }: { kind: 'ok' | 'err'; text: string }) {
  const adminSurface = useAdminSurface();
  if (!text) return null;
  const ok = kind === 'ok';
  return (
    <View style={[st.msg, adminSurface && adminSt.msg, { borderColor: ok ? C.green + '66' : C.red + '66', backgroundColor: (ok ? C.green : C.red) + '14' }]}>
      <Text style={[{ color: ok ? C.green : C.red, fontSize: 13, fontWeight: '600' }, adminSurface && adminSt.bodyText]}>
        {ok ? '✓ ' : '!' }{text}
      </Text>
    </View>
  );
}

// ---------- premium gaming empty state ----------
export function Empty({ icon, text, actionLabel, onAction }: {
  icon?: string; text: string; actionLabel?: string; onAction?: () => void;
}) {
  const adminSurface = useAdminSurface();
  return (
    <View style={[st.empty, adminSurface && adminSt.empty]}>
      <View style={[st.emptyIconWrap, adminSurface && adminSt.emptyIconWrap, glow(adminSurface ? C.orange : C.purple, 14)]}>
        {adminSurface ? <Feather name="target" size={28} color={C.orange} /> : <Text style={{ fontSize: 40 }}>{icon || '🎮'}</Text>}
      </View>
      <Text style={[st.emptyTitle, adminSurface && adminSt.emptyTitle]}>NO MATCHES LIVE</Text>
      <Text style={[st.emptyText, adminSurface && adminSt.bodyText]}>{text}</Text>
      {!!actionLabel && <Btn title={actionLabel} kind="purple" onPress={onAction} style={{ marginTop: 16, alignSelf: 'center', paddingHorizontal: 24 }} />}
    </View>
  );
}

export function Loading() {
  const adminSurface = useAdminSurface();
  return <ActivityIndicator color={adminSurface ? C.orange : C.neon} style={{ marginTop: 40 }} size="large" />;
}

export function SectionTitle({ children, accent, icon }: { children: React.ReactNode; accent?: string; icon?: keyof typeof Feather.glyphMap }) {
  const adminSurface = useAdminSurface();
  const markerColor = accent || (adminSurface ? C.orange : C.neon);
  return (
    <View style={[st.secRow, adminSurface && adminSt.secRow]}>
      <View style={[st.secBar, { backgroundColor: markerColor }, glow(markerColor, 6)]} />
      {icon ? <Feather name={icon} size={14} color={markerColor} /> : null}
      <Text style={[st.secText, adminSurface && adminSt.secText]}>{children}</Text>
    </View>
  );
}

export function Chip({ label, color = C.gold, onPress }: { label: string; color?: string; onPress?: () => void }) {
  const adminSurface = useAdminSurface();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[st.chip, adminSurface && adminSt.chip, { borderColor: color, backgroundColor: adminSurface ? color + '12' : 'transparent' }]}>
      <Text style={[st.chipText, adminSurface && adminSt.chipText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ text, color = C.gold }: { text: string; color?: string }) {
  const adminSurface = useAdminSurface();
  return (
    <View style={[st.chip, adminSurface && adminSt.chip, { borderColor: color, alignSelf: 'auto', backgroundColor: color + '18' }, glow(color, 4)]}>
      <Text style={[st.chipText, adminSurface && adminSt.chipText, { color }]}>{text}</Text>
    </View>
  );
}

export function KV({ k, v, color }: { k: string; v: string; color?: string }) {
  const adminSurface = useAdminSurface();
  return (
    <View style={st.kvRow}>
      <Text style={[st.kvK, adminSurface && adminSt.bodyText]}>{k}</Text>
      <Text style={[st.kvV, adminSurface && adminSt.kvV, { color: color || C.text }]}>{v}</Text>
    </View>
  );
}

export function Coin({ value, size = 14 }: { value: number; size?: number }) {
  const adminSurface = useAdminSurface();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {adminSurface ? <Feather name="circle" size={size} color={C.gold} /> : <Text style={{ fontSize: size }}>🪙</Text>}
      <Text style={{ fontSize: size, color: C.gold, fontWeight: '800', marginLeft: 3, fontFamily: adminSurface ? 'Inter_700Bold' : undefined }}>{value}</Text>
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
  const st = String(t?.status || 'upcoming').toLowerCase();
  if (st === 'live' || st === 'ongoing') return { key: 'ongoing', label: 'ONGOING', color: C.neon };
  if (st === 'completed' || st === 'cancelled') return { key: 'completed', label: st.toUpperCase(), color: C.dim };
  const filled = Number(t?.filledSlots ?? t?.filled ?? 0);
  const total = Number(t?.totalSlots ?? 0);
  if (st === 'full' || st === 'setup_needed' || (total > 0 && filled >= total)) return { key: 'full', label: 'FULL', color: C.orange };
  return { key: 'upcoming', label: 'UPCOMING', color: C.green };
}

export function MatchCard({ t, onPress }: { t: any; onPress?: () => void }) {
  const s = statusOf(t);
  const joined = t?.joined === true;
  const filled = t?.filledSlots ?? 0;
  const total = t?.totalSlots ?? 0;
  const slotUnit = t?.slotUnit === 'player' ? 'players' : 'teams';
  const filledPlayers = t?.filledPlayerSlots ?? filled * (t?.teamSize ?? 1);
  const totalPlayers = t?.totalPlayerSlots ?? total * (t?.teamSize ?? 1);
  const ctaText = joined
    ? s.key === 'full' ? 'Joined · Slots Full' : 'Joined'
    : s.key === 'ongoing' ? 'VIEW MATCH' : s.key === 'full' ? 'Slots Full' : s.key === 'completed' ? 'ENDED' : 'JOIN NOW →';
  const ctaColor = joined ? C.green : s.key === 'full' || s.key === 'completed' || s.key === 'ongoing' ? C.dim : C.neon;
  const ctaBackground = joined ? C.green + '22' : s.key === 'full' || s.key === 'completed' || s.key === 'ongoing' ? C.card2 : C.neon + '22';
  const ctaBorder = joined ? C.green + '77' : s.key === 'full' || s.key === 'completed' || s.key === 'ongoing' ? C.border : C.neon + '77';
  return (
    <GCard onPress={onPress} glowColor={s.key === 'ongoing' ? C.neon : undefined} style={{ marginBottom: 12 }}>
      <View style={mc.topRow}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={mc.mode}>{(t?.mode || 'BATTLE ROYALE').toUpperCase()} • {String(t?.teamType || 'Solo').toUpperCase()}</Text>
          <Text style={mc.name} numberOfLines={1}>{t?.name || t?.title || 'Tournament'}</Text>
        </View>
        <Badge text={s.label} color={s.color} />
      </View>
      <View style={mc.sep} />
      <View style={mc.metaRow}>
        <Text style={mc.meta}>📅 {fmtDate(t?.date)}{t?.time ? ` • ${fmtTime12(t.time)}` : ''}</Text>
        <Text style={mc.meta}>{filled}/{total} {slotUnit}</Text>
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
          <Text style={mc.statK}>{slotUnit.toUpperCase()}</Text>
          <Text style={[mc.statV, { color: C.blue }]}>{filled}/{total}</Text>
          <Text style={{ color: C.dim, fontSize: 9, marginTop: 2 }}>{filledPlayers}/{totalPlayers} players</Text>
        </View>
      </View>
      <View style={[mc.joinBtn, { backgroundColor: ctaBackground, borderColor: ctaBorder }]}>
        <Text style={[mc.joinText, { color: ctaColor }]}>{ctaText}</Text>
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
  const adminSurface = useAdminSurface();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.capsule, glow(C.gold, 10), pressed && { opacity: 0.85 }]}>
      {adminSurface ? <Feather name="circle" size={14} color={C.gold} /> : <Text style={{ fontSize: 15 }}>🪙</Text>}
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

const adminSt = StyleSheet.create({
  btn: { borderRadius: 10, paddingVertical: 12, minHeight: 42, shadowOpacity: 0.2, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  btnText: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.9 },
  card: { backgroundColor: '#11161f', borderRadius: 14, borderColor: 'rgba(255,255,255,0.09)', borderTopColor: 'rgba(255,176,32,0.24)', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  input: { backgroundColor: '#0e131b', borderColor: 'rgba(255,255,255,0.12)', borderRadius: 10, fontFamily: 'Inter_400Regular', fontSize: 13 },
  msg: { borderRadius: 10, padding: 11 },
  bodyText: { fontFamily: 'Inter_400Regular' },
  empty: { padding: 26 },
  emptyIconWrap: { borderColor: C.orange + '55', backgroundColor: '#15140f' },
  emptyTitle: { fontFamily: 'Inter_700Bold', letterSpacing: 1.5, fontSize: 14 },
  secRow: { marginVertical: 10 },
  secText: { fontFamily: 'Inter_700Bold', fontSize: 13, letterSpacing: 1.1 },
  chip: { borderRadius: 7, paddingHorizontal: 9, paddingVertical: 5 },
  chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 10.5, letterSpacing: 0.55 },
  kvV: { fontFamily: 'Inter_600SemiBold' },
});
