// Shared UI kit — PREMIUM ESPORTS gaming theme (FREE FIRE DAILY007)
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator, Animated, Easing, Image, type ViewProps } from 'react-native';
import { ReadableText as Text, ReadableTextInput as TextInput, swapThemeColor } from './typography';
import { Feather } from '@expo/vector-icons';
import { getTournamentFormatPresentation as selectTournamentFormatPresentation } from '../lib/tournamentFormatPresentation';
import {
  nativeTextScaleTextProps,
  type NativeTextScaleLayoutObserver,
} from '../lib/nativeTextScaleLayout';
export { default as TimePicker } from './TimePicker';

export const C = {
  bg: '#070a12', bg2: '#0b1020', card: '#10162b', card2: '#141b33', border: '#1e2745',
  squadPanel: '#0b1120', squadTile: '#070d19', squadBorder: '#1c2940', squadAccent: '#00f0ff',
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
        <View style={{ flex: 1, backgroundColor: '#70b8ff10' }} />
      </Animated.View>
    </View>
  );
}

// ---------- buttons ----------
export function Btn({
  title,
  onPress,
  disabled,
  kind = 'primary',
  small,
  loading,
  preserveAccessibilityFocusWhileLoading = false,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  testID,
  onTextScaleLayout,
  textScaleLayoutKey,
}: {
  title: string; onPress?: () => void; disabled?: boolean;
  kind?: 'primary' | 'ghost' | 'danger' | 'purple' | 'gold'; small?: boolean; loading?: boolean;
  preserveAccessibilityFocusWhileLoading?: boolean; style?: any;
  accessibilityLabel?: string; accessibilityHint?: string;
  accessibilityState?: React.ComponentProps<typeof Pressable>['accessibilityState'];
  testID?: string;
  onTextScaleLayout?: NativeTextScaleLayoutObserver;
  textScaleLayoutKey?: string;
}) {
  const adminSurface = useAdminSurface();
  const map: Record<string, { bg: string; fg: string; border?: string; glowColor?: string }> = {
    primary: { bg: C.neon, fg: C.bg, glowColor: C.neon },
    danger: { bg: '#5a1622', fg: '#ff9aa5', border: '#ff5c5c55' },
    purple: { bg: '#3a1f66', fg: '#d9b8ff', border: C.purple + '66', glowColor: C.purple },
    gold: { bg: '#4a3208', fg: C.gold, border: C.gold + '77', glowColor: C.gold },
    ghost: { bg: 'transparent', fg: C.sub, border: C.border },
  };
  const k = map[kind] || map.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || (loading && !preserveAccessibilityFocusWhileLoading)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
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
      {loading ? <ActivityIndicator accessible={false} color={C.bg} size="small" />
        : <Text
            {...(textScaleLayoutKey
              ? nativeTextScaleTextProps(textScaleLayoutKey, onTextScaleLayout)
              : {})}
            style={[st.btnText, adminSurface && adminSt.btnText, { color: k.fg }]}
          >
            {title}
          </Text>}
    </Pressable>
  );
}

// ---------- glass card ----------
type CardProps = {
  children: React.ReactNode;
  style?: any;
  glowColor?: string;
} & Pick<ViewProps, 'accessible' | 'accessibilityLabel' | 'accessibilityRole' | 'testID'>;

export function Card({ children, style, glowColor, ...accessibilityProps }: CardProps) {
  const adminSurface = useAdminSurface();
  return (
    <View {...accessibilityProps} style={[st.card, adminSurface && adminSt.card, glowColor ? [glow(glowColor, 10), { borderColor: glowColor + '55' }] : null, style]}>
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
  accessibilityState,
  accessibilityGroup = false,
  testID,
}: {
  children: React.ReactNode; onPress?: () => void; style?: any; glowColor?: string;
  accessibilityLabel?: string; accessibilityHint?: string; testID?: string;
  accessibilityState?: React.ComponentProps<typeof Pressable>['accessibilityState'];
  accessibilityGroup?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const press = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  const release = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 8 }).start();
  const Body = (
    <Animated.View
      accessible={accessibilityGroup ? false : undefined}
      accessibilityElementsHidden={accessibilityGroup}
      importantForAccessibility={accessibilityGroup ? 'no-hide-descendants' : undefined}
      style={[st.card, glowColor ? [glow(glowColor, 10), { borderColor: glowColor + '55' }] : null, style, { transform: [{ scale }] }]}
    >
      {children}
    </Animated.View>
  );
  if (!onPress) return Body;
  return (
    <Pressable
      accessible={accessibilityGroup ? true : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      testID={testID}
      onPressIn={press}
      onPressOut={release}
      onPress={onPress}
    >
      {Body}
    </Pressable>
  );
}

export const Input = React.forwardRef<
  React.ComponentRef<typeof TextInput>,
  React.ComponentPropsWithoutRef<typeof TextInput>
>(function Input(props, ref) {
  const adminSurface = useAdminSurface();
  return (
    <TextInput
      ref={ref}
      {...props}
      style={[st.input, adminSurface && adminSt.input, props.style]}
      placeholderTextColor={props.placeholderTextColor || C.dim}
    />
  );
});

export function Msg({
  kind,
  text,
  testID,
  accessibilityLabel,
  accessibilityLiveRegion,
}: {
  kind: 'ok' | 'err';
  text: string;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
}) {
  const adminSurface = useAdminSurface();
  if (!text) return null;
  const ok = kind === 'ok';
  return (
    <View
      testID={testID}
      style={[st.msg, adminSurface && adminSt.msg, { borderColor: ok ? C.green + '66' : C.red + '66', backgroundColor: (ok ? C.green : C.red) + '14' }]}
    >
      <Text
        accessibilityLabel={accessibilityLabel}
        accessibilityLiveRegion={accessibilityLiveRegion}
        style={[{ color: ok ? C.green : C.red, fontSize: 13, fontWeight: '600' }, adminSurface && adminSt.bodyText]}
      >
        {ok ? '✓ ' : '!' }{text}
      </Text>
    </View>
  );
}

// ---------- premium gaming empty state ----------
export function Empty({
  icon,
  title = 'NO MATCHES LIVE',
  text,
  actionLabel,
  onAction,
  accessibilityLabel,
  accessibilityLiveRegion,
}: {
  icon?: string; title?: string; text: string; actionLabel?: string; onAction?: () => void;
  accessibilityLabel?: string;
  accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
}) {
  const adminSurface = useAdminSurface();
  return (
    <View style={[st.empty, adminSurface && adminSt.empty]}>
      <View style={[st.emptyIconWrap, adminSurface && adminSt.emptyIconWrap, glow(adminSurface ? C.orange : C.purple, 14)]}>
        {adminSurface ? <Feather name="target" size={28} color={C.orange} /> : <Text style={{ fontSize: 40 }}>{icon || '🎮'}</Text>}
      </View>
      <Text style={[st.emptyTitle, adminSurface && adminSt.emptyTitle]}>{title}</Text>
      <Text
        accessible={accessibilityLabel ? true : undefined}
        accessibilityRole={accessibilityLabel ? 'text' : undefined}
        accessibilityLabel={accessibilityLabel}
        accessibilityLiveRegion={accessibilityLiveRegion}
        style={[st.emptyText, adminSurface && adminSt.bodyText]}
      >
        {text}
      </Text>
      {!!actionLabel && <Btn title={actionLabel} kind="purple" onPress={onAction} style={{ marginTop: 16, alignSelf: 'center', paddingHorizontal: 24 }} />}
    </View>
  );
}

export function Loading({ accessibilityLabel }: { accessibilityLabel?: string } = {}) {
  const adminSurface = useAdminSurface();
  return (
    <ActivityIndicator
      accessibilityRole={accessibilityLabel ? "progressbar" : undefined}
      accessibilityLabel={accessibilityLabel}
      color={adminSurface ? C.orange : C.neon}
      style={{ marginTop: 40 }}
      size="large"
    />
  );
}

export function SectionTitle({
  children,
  accent,
  icon,
  accessibilityLabel,
  testID,
}: {
  children: React.ReactNode;
  accent?: string;
  icon?: keyof typeof Feather.glyphMap;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const adminSurface = useAdminSurface();
  const markerColor = swapThemeColor(accent || (adminSurface ? C.orange : C.neon));
  return (
    <View style={[st.secRow, adminSurface && adminSt.secRow]}>
      <View style={[st.secBar, { backgroundColor: markerColor }, glow(markerColor, 6)]} />
      {icon ? <Feather name={icon} size={14} color={markerColor} /> : null}
      <Text
        testID={testID}
        accessibilityRole={accessibilityLabel ? 'header' : undefined}
        accessibilityLabel={accessibilityLabel}
        style={[st.secText, adminSurface && adminSt.secText]}
      >
        {children}
      </Text>
    </View>
  );
}

export function Chip({ label, color = C.gold, onPress, testID }: {
  label: string;
  color?: string;
  onPress?: () => void;
  testID?: string;
}) {
  const adminSurface = useAdminSurface();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      style={[
        st.chip,
        adminSurface && adminSt.chip,
        adminSurface && onPress && adminSt.chipTouchTarget,
        { borderColor: swapThemeColor(color), backgroundColor: adminSurface ? swapThemeColor(color) + '12' : 'transparent' },
      ]}
    >
      <Text style={[st.chipText, adminSurface && adminSt.chipText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ text, color = C.gold }: { text: string; color?: string }) {
  const adminSurface = useAdminSurface();
  const displayColor = swapThemeColor(color);
  return (
    <View style={[st.chip, adminSurface && adminSt.chip, { borderColor: displayColor, alignSelf: 'auto', backgroundColor: displayColor + '18' }, glow(displayColor, 4)]}>
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
const tournamentFormatArt = {
  solo: require('../assets/media/tournament-solo-showdown.jpg'),
  duo: require('../assets/media/tournament-duo-showdown.jpg'),
  squad: require('../assets/media/tournament-squad-showdown.jpg'),
};

const battleRoyalePosterArt = {
  solo: require('../assets/battle-royale-solo-poster-landscape.jpg'),
  duo: require('../assets/battle-royale-duo-poster-landscape.jpg'),
  squad: require('../assets/battle-royale-squad-poster-landscape.jpg'),
};

export function getTournamentFormatPresentation(t: any) {
  return selectTournamentFormatPresentation(t, {
    tournamentFormatArt,
    battleRoyalePosterArt,
  });
}

export function fmtTime12(t?: string) {
  if (!t) return '';
  const value = String(t).trim();
  const twelveHour = /^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i.exec(value);
  if (twelveHour) {
    const hour = Number(twelveHour[1]);
    if (hour < 1 || hour > 12) return value;
    return `${hour}:${twelveHour[2]} ${twelveHour[3].toUpperCase()}`;
  }

  const twentyFourHour = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!twentyFourHour) return value;
  let hour = Number(twentyFourHour[1]);
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${twentyFourHour[2]} ${meridiem}`;
}

export function fmtDate(d?: string) {
  if (!d) return '';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  let year: number;
  let monthLabel: string;
  let dayLabel: string;
  if (dateOnly) {
    year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return d;
    monthLabel = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][month - 1];
    dayLabel = String(day).padStart(2, '0');
  } else {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).formatToParts(dt);
    year = Number(parts.find(part => part.type === 'year')?.value);
    monthLabel = parts.find(part => part.type === 'month')?.value.toUpperCase() ?? '';
    dayLabel = parts.find(part => part.type === 'day')?.value ?? '';
  }
  const currentIstYear = Number(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
  }).format(new Date()));
  const dateLabel = `${dayLabel} ${monthLabel}`;
  return year === currentIstYear ? dateLabel : `${dateLabel} ${year}`;
}

export function statusOf(t: any): { key: string; label: string; color: string } {
  const st = String(t?.status || 'upcoming').toLowerCase();
  if (st === 'live' || st === 'ongoing') return { key: 'ongoing', label: 'ONGOING', color: C.neon };
  if (st === 'completed' || st === 'cancelled') return { key: 'completed', label: st.toUpperCase(), color: C.dim };
  const mode = String(t?.mode ?? t?.gameMode ?? '').toLowerCase();
  const isIndividualSquad = String(t?.teamType ?? '').toLowerCase() === 'squad' &&
    (mode.includes('battle royale') || mode === 'battle_royale');
  const filled = Number(isIndividualSquad
    ? t?.filledPlayerSlots ?? Number(t?.filledSlots ?? t?.filled ?? 0) * 4
    : t?.filledSlots ?? t?.filled ?? 0);
  const total = Number(isIndividualSquad
    ? t?.totalPlayerSlots ?? Number(t?.totalSlots ?? 12) * 4
    : t?.totalSlots ?? 0);
  if (st === 'setup_needed' || ((st === 'full' || total > 0) && filled >= total)) {
    return { key: 'full', label: 'FULL', color: C.orange };
  }
  return { key: 'upcoming', label: 'UPCOMING', color: C.green };
}

export function MatchCard({
  t,
  onPress,
  roomDetails,
  largeText = false,
}: {
  t: any;
  onPress?: () => void;
  roomDetails?: React.ReactNode;
  largeText?: boolean;
}) {
  const s = statusOf(t);
  const [failedImageUrl, setFailedImageUrl] = useState('');
  const joined = t?.joined === true;
  const filled = t?.filledSlots ?? 0;
  const total = t?.totalSlots ?? 0;
  const requestedImageUrl = typeof t?.imageUrl === 'string' ? t.imageUrl.trim() : '';
  const customImageUrl = /^https:\/\/\S+$/i.test(requestedImageUrl) ? requestedImageUrl : '';
  const formatPresentation = getTournamentFormatPresentation(t);
  const imageSource = customImageUrl && failedImageUrl !== customImageUrl
    ? { uri: customImageUrl }
    : formatPresentation.image;
  const filledPlayers = t?.filledPlayerSlots ?? filled * (t?.teamSize ?? 1);
  const totalPlayers = t?.totalPlayerSlots ?? total * (t?.teamSize ?? 1);
  const mode = String(t?.mode ?? t?.gameMode ?? '').toLowerCase();
  const isIndividualSquad = String(t?.teamType ?? '').toLowerCase() === 'squad' &&
    (mode.includes('battle royale') || mode === 'battle_royale');
  const slotUnit = isIndividualSquad ? 'players' : t?.slotUnit === 'player' ? 'players' : 'teams';
  const displayedFilled = isIndividualSquad ? filledPlayers : filled;
  const displayedTotal = isIndividualSquad ? totalPlayers : total;
  const { format, showFormatBanner, showBattleRoyalePoster } = formatPresentation;
  const usesArtCard = showFormatBanner || showBattleRoyalePoster;
  const statusUnknown = t?.joinedStatusUnknown === true;
  const ctaText = statusUnknown
    ? 'ENTRY STATUS UNKNOWN · TAP TO CHECK →'
    : joined
    ? s.key === 'full' ? 'Joined · Slots Full' : 'Joined'
    : s.key === 'ongoing' ? 'VIEW MATCH' : s.key === 'full' ? 'Slots Full' : s.key === 'completed' ? 'ENDED' : 'JOIN NOW →';
  const ctaColor = statusUnknown
    ? C.gold
    : joined ? C.green : s.key === 'full' || s.key === 'completed' || s.key === 'ongoing' ? C.dim : C.neon;
  const ctaBackground = statusUnknown
    ? C.gold + '22'
    : joined ? C.green + '22' : s.key === 'full' || s.key === 'completed' || s.key === 'ongoing' ? C.card2 : C.neon + '22';
  const ctaBorder = statusUnknown
    ? C.gold + '77'
    : joined ? C.green + '77' : s.key === 'full' || s.key === 'completed' || s.key === 'ongoing' ? C.border : C.neon + '77';
  return (
    <GCard
      onPress={onPress}
      glowColor={s.key === 'ongoing' ? C.neon : undefined}
      style={usesArtCard ? mc.cardWithArt : { marginBottom: 12 }}
    >
      {showBattleRoyalePoster && (
        <View style={mc.brPosterArtwork}>
          <Image
            source={imageSource}
            onError={() => {
              if (customImageUrl && failedImageUrl !== customImageUrl) setFailedImageUrl(customImageUrl);
            }}
            resizeMode="contain"
            style={mc.brPosterImage}
          />
        </View>
      )}
      {showFormatBanner ? (
        <View style={[mc.artwork, largeText && mc.artworkLarge]}>
          <Image
            source={imageSource}
            onError={() => {
              if (customImageUrl && failedImageUrl !== customImageUrl) setFailedImageUrl(customImageUrl);
            }}
            resizeMode="contain"
            style={mc.artImage}
          />
          <View pointerEvents="none" style={mc.artShade} />
          <View style={[mc.artTop, largeText && mc.artTopLarge]}>
            <View style={[mc.formatPill, largeText && mc.formatPillLarge]}>
              <Feather name="users" size={11} color={C.text} />
              <Text style={mc.formatText}>{format.toUpperCase()}</Text>
              <View style={mc.matchupBadge}>
                <Text style={mc.matchupText}>{formatPresentation.matchup}</Text>
              </View>
            </View>
            <Badge text={s.label} color={s.color} />
          </View>
          <View style={[mc.artTitle, largeText && mc.artTitleLarge]}>
            <Text style={[mc.artMode, largeText && mc.artModeLarge]}>{String(t?.mode || t?.gameMode || '').toUpperCase()}</Text>
            <Text style={mc.artName}>{t?.name || t?.title || 'Tournament'}</Text>
          </View>
        </View>
      ) : (
        <View style={[mc.topRow, showBattleRoyalePoster && mc.brPosterTopRow, largeText && mc.topRowLarge]}>
            <View style={[mc.nameWrap, largeText && mc.nameWrapLarge]}>
            <Text style={[mc.mode, largeText && mc.modeLarge]}>{(t?.mode || 'BATTLE ROYALE').toUpperCase()} • {String(t?.teamType || 'Solo').toUpperCase()}</Text>
            <Text style={[mc.name, largeText && mc.nameLarge]}>{t?.name || t?.title || 'Tournament'}</Text>
          </View>
          <Badge text={s.label} color={s.color} />
        </View>
      )}
      <View style={usesArtCard ? mc.bannerBody : undefined}>
        {!showFormatBanner && <View style={mc.sep} />}
        <View style={[mc.metaRow, largeText && mc.metaRowLarge]}>
          <Text style={[mc.meta, largeText && mc.metaLarge]}>
            📅 {fmtDate(t?.date)}{t?.time ? ' • ' : ''}
            {t?.time ? <Text style={mc.metaTime}>{fmtTime12(t.time)} IST</Text> : null}
          </Text>
          <Text style={[mc.meta, largeText && mc.metaLarge]}>{displayedFilled}/{displayedTotal} {slotUnit}</Text>
        </View>
        <View style={[mc.statRow, largeText && mc.statRowLarge]}>
          <View style={[mc.stat, largeText && mc.statLarge]}>
            <Text style={mc.statK}>ENTRY</Text>
            <Text style={[mc.statV, { color: C.gold }]}>🪙 {t?.entryCoins ?? 0}</Text>
          </View>
          <View style={[mc.stat, { borderLeftWidth: 1, borderLeftColor: C.border, borderRightWidth: 1, borderRightColor: C.border }, largeText && mc.statLarge]}>
            <Text style={mc.statK}>PRIZE POOL</Text>
            <Text style={[mc.statV, { color: C.green }]}>🪙 {t?.prizePool ?? 0}</Text>
          </View>
          <View style={[mc.stat, largeText && mc.statLarge]}>
            <Text style={mc.statK}>{slotUnit.toUpperCase()}</Text>
            <Text style={[mc.statV, { color: C.blue }]}>{displayedFilled}/{displayedTotal}</Text>
            <Text style={{ color: C.dim, fontSize: 9, marginTop: 2 }}>{filledPlayers}/{totalPlayers} players</Text>
          </View>
        </View>
        {roomDetails}
        <View style={[mc.joinBtn, largeText && mc.joinBtnLarge, { backgroundColor: ctaBackground, borderColor: ctaBorder }]}>
          <Text style={[mc.joinText, largeText && mc.joinTextLarge, { color: ctaColor }]}>{ctaText}</Text>
        </View>
      </View>
    </GCard>
  );
}

const mc = StyleSheet.create({
  cardWithArt: { padding: 0, paddingVertical: 0, overflow: 'hidden', marginBottom: 12, borderRadius: 16 },
  artwork: { width: '100%', minHeight: 180, position: 'relative', justifyContent: 'space-between', padding: 12, overflow: 'hidden', backgroundColor: C.bg2 },
  artworkLarge: { justifyContent: 'flex-start', rowGap: 14, padding: 14 },
  brPosterArtwork: { width: '100%', aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: C.bg2 },
  brPosterImage: { width: '100%', height: '100%' },
  brPosterTopRow: { paddingHorizontal: 14, paddingTop: 12 },
  artImage: { ...StyleSheet.absoluteFill, width: undefined, height: undefined, backgroundColor: C.bg2 },
  artShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(5,8,16,0.42)', borderBottomWidth: 1, borderBottomColor: '#ffffff12' },
  artTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', rowGap: 8 },
  artTopLarge: { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start' },
  formatPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(7,10,18,0.82)', borderColor: '#ffffff55', borderWidth: 1, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5 },
  formatPillLarge: { flexWrap: 'wrap', maxWidth: '100%' },
  formatText: { color: C.text, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  matchupBadge: { backgroundColor: C.gold, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  matchupText: { color: C.bg, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  artTitle: { maxWidth: '92%' },
  artTitleLarge: { width: '100%', maxWidth: '100%' },
  artMode: { color: '#ffc06b', fontSize: 9, fontWeight: '900', letterSpacing: 1.7, marginBottom: 3 },
  artModeLarge: { letterSpacing: 0.7 },
  artName: { color: C.text, fontSize: 17, fontWeight: '900', textShadowColor: '#000000aa', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  bannerBody: { padding: 14, paddingTop: 10 },
  topRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  topRowLarge: { flexDirection: 'column', alignItems: 'stretch' },
  nameWrap: { flex: 1, minWidth: 0, marginRight: 8 },
  nameWrapLarge: { width: '100%', marginRight: 0, marginBottom: 8 },
  mode: { color: C.orange, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  modeLarge: { letterSpacing: 0.5 },
  name: { color: C.text, fontSize: 16, fontWeight: '900', marginTop: 2 },
  nameLarge: { flexShrink: 1 },
  sep: { height: 1, backgroundColor: C.border, marginVertical: 10 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  metaRowLarge: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  meta: { color: C.sub, fontSize: 12, fontWeight: '600' },
  metaLarge: { width: '100%', minWidth: 0, flexShrink: 1 },
  metaTime: { color: C.gold, fontSize: 15, fontWeight: '900' },
  statRow: { flexDirection: 'row', borderRadius: 10, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  statRowLarge: { flexDirection: 'column' },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  statLarge: { flex: 0, width: '100%', minWidth: 0, borderLeftWidth: 0, borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: C.border },
  statK: { color: C.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  statV: { fontSize: 14, fontWeight: '900', marginTop: 2 },
  joinBtn: { marginTop: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center', paddingVertical: 10 },
  joinBtnLarge: { alignSelf: 'stretch', paddingHorizontal: 12 },
  joinText: { fontWeight: '900', fontSize: 12, letterSpacing: 1.5 },
  joinTextLarge: { letterSpacing: 0.5, flexShrink: 1, textAlign: 'center' },
});

// ---------- glowing coin capsule (header) ----------
export function CoinCapsule({
  value,
  onPress,
  wrapForNarrowScreen = false,
}: {
  value: number;
  onPress?: () => void;
  wrapForNarrowScreen?: boolean;
}) {
  const adminSurface = useAdminSurface();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [
      st.capsule,
      wrapForNarrowScreen && st.capsuleNarrow,
      glow(C.gold, 10),
      pressed && { opacity: 0.85 },
    ]}>
      {adminSurface ? <Feather name="circle" size={14} color={C.gold} /> : <Text style={{ fontSize: 15 }}>🪙</Text>}
      <Text style={[st.capsuleText, wrapForNarrowScreen && st.capsuleTextNarrow]}>{value}</Text>
      <Text style={[st.capsuleUnit, wrapForNarrowScreen && st.capsuleUnitNarrow]}>COINS</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  btn: { paddingVertical: 13.5, borderRadius: 12, alignItems: 'center' },
  btnText: { fontWeight: '900', letterSpacing: 1.2, fontSize: 14 },
  card: {
    backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border,
    // subtle top-edge metallic highlight
    borderTopColor: '#2a3558',
    paddingVertical: 14.5,
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
  secText: { color: C.text, fontSize: 16, fontWeight: '900', letterSpacing: 1.5, flex: 1, minWidth: 0 },
   chip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5.5, alignSelf: 'flex-start' },
  chipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.border + '66' },
  kvK: { color: C.sub, fontSize: 13 },
  kvV: { fontWeight: '800', fontSize: 13 },
  capsule: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1408',
    borderWidth: 1.5, borderColor: C.gold, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 7,
  },
  capsuleNarrow: { maxWidth: '100%', flexWrap: 'wrap' },
  capsuleText: { color: C.gold, fontWeight: '900', fontSize: 15, marginLeft: 5 },
  capsuleTextNarrow: { minWidth: 0, flexShrink: 1 },
  capsuleUnit: { color: C.gold + '99', fontWeight: '800', fontSize: 9, letterSpacing: 1, marginLeft: 4 },
  capsuleUnitNarrow: { flexShrink: 1 },
});

const adminSt = StyleSheet.create({
  btn: { borderRadius: 10, paddingVertical: 12.5, minWidth: 48, minHeight: 48, shadowOpacity: 0.2, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  btnText: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.9 },
  card: { backgroundColor: '#11161f', borderRadius: 14, borderColor: 'rgba(77,163,255,0.09)', borderTopColor: 'rgba(255,176,32,0.24)', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  input: { backgroundColor: '#0e131b', borderColor: 'rgba(77,163,255,0.12)', borderRadius: 10, fontFamily: 'Inter_400Regular', fontSize: 13 },
  msg: { borderRadius: 10, padding: 11 },
  bodyText: { fontFamily: 'Inter_400Regular' },
  empty: { padding: 26 },
  emptyIconWrap: { borderColor: C.orange + '55', backgroundColor: '#15140f' },
  emptyTitle: { fontFamily: 'Inter_700Bold', letterSpacing: 1.5, fontSize: 14 },
  secRow: { marginVertical: 10 },
  secText: { fontFamily: 'Inter_700Bold', fontSize: 13, letterSpacing: 1.1 },
  chip: { borderRadius: 7, paddingHorizontal: 9, paddingVertical: 5.5 },
  chipTouchTarget: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 10.5, letterSpacing: 0.55 },
  kvV: { fontFamily: 'Inter_600SemiBold' },
});
