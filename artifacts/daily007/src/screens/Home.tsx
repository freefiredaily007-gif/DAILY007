// Home — premium esports landing: header, hero, live matches, game modes, quick actions, social
import React, { useCallback, useState, useRef } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl, Linking, Image, Animated, Easing } from 'react-native';
import bannerSquad from '../assets/banner-squad.jpg';
import bannerClash from '../assets/banner-clash.jpg';
import modeSoloLogo from '../assets/mode-solo-logo.jpg';
import modeSquadLogo from '../assets/mode-squad-logo.jpg';
import modeClashLogo from '../assets/mode-clash-logo.jpg';
import { useNavigation } from '@react-navigation/native';
import { api, Api } from '../lib/api';
import { useApp } from '../App';
import { C, Card, SectionTitle, Loading, Empty, GCard, Badge, CoinCapsule, glow, Pulse } from '../components/ui';
import { inr } from '../lib/coins';
import { WhatsAppIcon, InstagramIcon, YouTubeIcon } from '../components/SocialIcons';
import logoImg from '../assets/logo.jpg';

// 12-hour time helper
export function fmtTime(t?: string) {
  if (!t) return '';
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(t);
  let h = parseInt(m[1], 10);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}
function fmtDate(d?: string) {
  if (!d) return '';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  if (isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
}
function statusOf(t: any) {
  const filled = Number(t.filledSlots ?? t.filled ?? 0);
  const total = Number(t.totalSlots ?? (String(t.mode || '').toLowerCase().includes('clash') ? 2 : String(t.teamType || '').toLowerCase() === 'squad' ? 12 : 48));
  const status = String(t.status ?? '').toLowerCase();
  if (status === 'live') return { key: 'LIVE', color: C.red };
  if (status === 'completed' || status === 'cancelled') return { key: 'COMPLETED', color: C.dim };
  if (status === 'full' || (total > 0 && filled >= total)) return { key: 'FULL', color: C.orange };
  return { key: 'UPCOMING', color: C.green };
}
function tournamentModeFallback(t: any): number {
  if (String(t?.mode || '').toLowerCase().includes('clash')) return 2;
  if (String(t?.teamType || '').toLowerCase() === 'squad') return 12;
  return 48;
}
export default function Home() {
  const { user } = useApp();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [links, setLinks] = useState<any>({});
  const [page, setPage] = useState(0);
  const carouselRef = useRef<ScrollView>(null);
  const pageRef = useRef(0);
  const nav: any = useNavigation();
  const goTab = (k: string) => nav.navigate(k === 'wallet' ? 'Wallet' : k === 'profile' ? 'Profile' : k === 'mymatches' ? 'MyMatches' : k === 'tournaments' ? 'Tournaments' : 'Home');
  const goStack = (k: string) => {
    if (k.startsWith('tdetail:')) nav.navigate('TDetail', { id: k.slice(8) });
    else if (k.startsWith('mode:')) nav.navigate('Tournaments', { mode: k.slice(5) });
  };
  const load = useCallback(async () => {
    try {
      const r = await api.tournaments('?enabled=true');
      const list = Array.isArray(r) ? r : r?.tournaments || [];
      setItems(Array.isArray(list) ? list : []);
      setLoadError('');
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load tournaments.');
    }
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); Api.settings().then((st: any) => setLinks(st?.settings ?? st ?? {})).catch(() => {}); }, [load]);

  const onCarouselScroll = (e: any) => {
    const x = e?.nativeEvent?.contentOffset?.x ?? 0;
    const w = e?.nativeEvent?.layoutMeasurement?.width || 1;
    const p = Math.round(x / w);
    if (p !== pageRef.current) { pageRef.current = p; setPage(p); }
  };
  // auto-scroll every 3.5s when more than one match
  React.useEffect(() => {
    if (items.length <= 1) return;
    const iv = setInterval(() => {
      const next = (pageRef.current + 1) % Math.min(items.length, 8);
      try { carouselRef.current?.scrollTo({ x: next * 390, animated: true }); } catch {}
    }, 3500);
    return () => clearInterval(iv);
  }, [items.length]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const social = (url?: string) => { if (url) Linking.openURL(url).catch(() => {}); };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 30 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.neon} />}>
      {/* grid pattern backdrop */}
      <View style={s.gridBg} pointerEvents="none" />

      {/* ===== TOP HEADER ===== */}
      <View style={s.head}>
        <View style={s.headGlow} pointerEvents="none" />
        <View style={s.logoWrap}>
          <View style={[s.logoBadge, glow(C.neon, 14)]}>
            <Image source={logoImg} style={s.logoImg} resizeMode="cover" />
          </View>
          <View>
            <Text style={s.logo}>FREE FIRE</Text>
            <Text style={s.logoSub}>DAILY007 TOURNAMENTS</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            style={[s.bellBtn, glow(C.neon, 8)]}
            onPress={() => nav.navigate('Notifications')}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Text style={{ fontSize: 16 }}>🔔</Text>
            <View style={s.bellDot} />
          </Pressable>
          <CoinCapsule value={user?.coins ?? 0} onPress={() => goTab('wallet')} />
          <Pressable style={[s.avatarBtn, glow(C.purple, 8)]} onPress={() => goTab('profile')}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>{(user?.name ?? 'P').charAt(0).toUpperCase()}</Text>
          </Pressable>
        </View>
      </View>
      <View style={s.headLine} pointerEvents="none" />

      {/* ===== LIVE / UPCOMING MATCHES — auto carousel ===== */}
      <Pressable
        style={({ pressed }) => [s.myMatchesButton, pressed && { opacity: 0.8 }]}
        onPress={() => goTab('mymatches')}
        accessibilityRole="button"
        accessibilityLabel="Open My Matches for your room details and results"
      >
        <Text style={s.myMatchesButtonText}>🎮 MY MATCHES</Text>
        <Text style={s.myMatchesButtonHint}>ROOM DETAILS & RESULTS →</Text>
      </Pressable>
      <View style={s.secRow}>
        <Text style={s.secTitle}>🔥 LIVE & UPCOMING MATCHES</Text>
        <Pressable onPress={() => goTab('tournaments')} hitSlop={8}>
          <Text style={s.viewAll}>VIEW ALL →</Text>
        </Pressable>
      </View>
      {loading ? <Loading /> : items.length === 0 ? (
        <Empty icon="🎮" text={loadError ? `Tournament data is unavailable: ${loadError}` : 'No tournaments are available right now.'} actionLabel="CHECK MATCHES" onAction={() => goTab('tournaments')} />
      ) : (
        <>
          <ScrollView
            ref={carouselRef}
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            onScroll={onCarouselScroll} scrollEventThrottle={16}
            style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16 }}
            decelerationRate="fast">
            {items.slice(0, 8).map((t) => {
        const filled = t.filledSlots ?? t.filled ?? 0;
        const total = t.totalSlots ?? tournamentModeFallback(t);
        const stt = statusOf(t);
        const br = t.mode === 'Battle Royale';
        const live = stt.key === 'LIVE';
        return (
          <GCard key={t.id} onPress={() => goStack('tdetail:' + t.id)} glowColor={live ? C.red : br ? C.orange : C.purple} style={s.matchCard}>
            <View style={s.mBanner}>
              <Image source={br ? bannerSquad : bannerClash} style={s.mBannerImg} resizeMode="cover" />
              <View style={s.mBannerShade} />
              <View style={s.mBadgeRow}>
                {live ? <Pulse><Badge text="● LIVE NOW" color={C.red} /></Pulse> : <Badge text={stt.key} color={stt.color} />}
                <View style={[s.modeBadge, { borderColor: br ? C.orange : C.purple }]}>
                  <Text style={[s.modeBadgeT, { color: br ? C.orange : C.purple }]}>{br ? 'BATTLE ROYALE' : 'CLASH SQUAD'}</Text>
                </View>
              </View>
              <Text style={s.mTitleOnImg} numberOfLines={1}>{t.name ?? 'Match'}</Text>
            </View>
            <View style={{ padding: 12 }}>
              <Text style={s.mSub}>{t.teamType ?? ''} • {fmtDate(t.date)} • {fmtTime(t.time)}</Text>
              <View style={s.mStats}>
                <View style={s.mStat}>
                  <Text style={s.mStatL}>ENTRY</Text>
                  <Text style={[s.mStatV, { color: C.orange }]}>🪙 {t.entryCoins ?? 0}</Text>
                </View>
                <View style={s.mStat}>
                  <Text style={s.mStatL}>PRIZE POOL</Text>
                  <Text style={[s.mStatV, { color: C.green }]}>🪙 {t.prizePool ?? 0}</Text>
                </View>
                <View style={s.mStat}>
                  <Text style={s.mStatL}>SLOTS</Text>
                  <Text style={s.mStatV}>{filled}/{total}</Text>
                </View>
              </View>
              <View style={s.slotBar}>
                <View style={[s.slotFill, { width: `${Math.min(100, (filled / Math.max(1, total)) * 100)}%` }]} />
              </View>
              <Pressable style={({ pressed }) => [s.joinBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
                onPress={() => goStack('tdetail:' + t.id)}>
                <Text style={s.joinBtnT}>JOIN NOW ›</Text>
              </Pressable>
            </View>
          </GCard>
            ); })}
          </ScrollView>
          {items.length > 1 && (
            <View style={s.dots}>
              {items.slice(0, 8).map((_, i) => (
                <View key={i} style={[s.dot, i === page && { backgroundColor: C.neon, width: 16 }]} />
              ))}
            </View>
          )}
        </>
      )}

      {/* ===== GAME MODES ===== */}
      <SectionTitle accent={C.orange}>GAME MODES</SectionTitle>
      {[
        { img: modeSoloLogo, title: '🔥 BATTLE ROYALE SOLO', capacity: '48 PLAYER SLOTS', mode: 'Battle Royale Solo', accent: C.gold },
        { img: modeSquadLogo, title: '⚔️ BATTLE ROYALE SQUAD', capacity: '12 TEAMS × 4 PLAYERS', mode: 'Battle Royale Squad', accent: C.neon },
        { img: modeClashLogo, title: '💥 CLASH SQUAD', capacity: '4V4', mode: 'Clash Squad', accent: C.purple },
      ].map((m) => (
        <GCard
          key={m.mode}
          onPress={() => nav.navigate('Tournaments', { mode: m.mode })}
          accessibilityLabel={`View ${m.mode} tournaments`}
          accessibilityHint="Opens the tournament list for this game mode"
          testID={`home-mode-${m.mode.toLowerCase().replace(/[^a-z]+/g, '-')}`}
          glowColor={m.accent}
          style={s.modeCard}
        >
          <View style={s.modeArtWrap}>
            <Image source={m.img} style={s.modeBanner} resizeMode="contain" />
          </View>
          <View style={s.modeBody}>
            <Text style={[s.modeTitle, { color: m.accent }]}>{m.title}</Text>
            <Text style={[s.modeCapacity, { color: m.accent }]}>{m.capacity}</Text>
            <View style={[s.modeBtn, { backgroundColor: m.accent }, glow(m.accent, 8)]}>
              <Text style={s.modeBtnT}>VIEW TOURNAMENTS</Text>
              <Text style={s.modeBtnArrow} accessibilityElementsHidden>›</Text>
            </View>
          </View>
        </GCard>
      ))}

      {/* ===== SOCIAL ===== */}
      <SectionTitle accent={C.blue}>JOIN THE COMMUNITY</SectionTitle>
      {[
        { Icon: WhatsAppIcon, label: 'WHATSAPP', action: 'JOIN', color: '#25D366', bg: '#0b2e1a', key: 'whatsapp', settingKey: 'whatsappLink' },
        { Icon: InstagramIcon, label: 'INSTAGRAM', action: 'FOLLOW', color: '#ff4d8d', bg: '#2a0f1e', key: 'instagram', settingKey: 'instagramLink' },
        { Icon: YouTubeIcon, label: 'YOUTUBE', action: 'SUBSCRIBE', color: C.red, bg: '#2a0d0d', key: 'youtube', settingKey: 'youtubeLink' },
      ].map((sc) => (
        <Pressable key={sc.key} style={({ pressed }) => [s.socialBtn, { backgroundColor: sc.bg, borderColor: sc.color + '66' }, glow(sc.color, 10), pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 }]}
          onPress={() => social(links?.[sc.settingKey] || links?.[sc.key] || links?.social?.[sc.key])}>
          <View style={[s.socialIconWrap, { borderColor: sc.color + '55' }, glow(sc.color, 8)]}>
            <sc.Icon size={26} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.socialLabel, { color: sc.color }]}>{sc.label}</Text>
            <Text style={s.socialAction}>{sc.action}</Text>
          </View>
          <Text style={[s.socialChev, { color: sc.color }]}>›</Text>
        </Pressable>
      ))}
      <View style={{ height: 10 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  gridBg: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 420, opacity: 0.35,
    borderTopWidth: 1, borderTopColor: '#ffffff06',
  },
  head: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 12,
    backgroundColor: '#0d1226', borderBottomWidth: 0, overflow: 'hidden',
  },
  headGlow: { position: 'absolute', top: -60, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: C.neon + '14' },
  headLine: { height: 2, backgroundColor: C.neon + '55', shadowColor: C.neon, shadowOpacity: 0.8, shadowRadius: 8 },
  logoWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoBadge: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: '#1a0d10', borderWidth: 1.5,
    borderColor: C.neon, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  logoImg: { width: 48, height: 48 },
  logo: { color: C.text, fontWeight: '900', fontSize: 18, letterSpacing: 2, textShadowColor: C.neon + '88', textShadowRadius: 10 },
  logoSub: { color: C.gold, fontWeight: '900', fontSize: 9, letterSpacing: 3, marginTop: 1 },
  bellBtn: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: '#ffffff0a', borderWidth: 1,
    borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  myMatchesButton: {
    marginHorizontal: 16, marginTop: 12, marginBottom: 2, minHeight: 48, borderRadius: 12,
    paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#10162b', borderWidth: 1, borderColor: C.neon + '66',
  },
  myMatchesButtonText: { color: C.text, fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  myMatchesButtonHint: { color: C.neon, fontWeight: '800', fontSize: 9, letterSpacing: 0.7 },
  bellDot: { position: 'absolute', top: 7, right: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: C.red, shadowColor: C.red, shadowOpacity: 1, shadowRadius: 4 },
  avatarBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#241533', borderWidth: 1.5,
    borderColor: C.purple, alignItems: 'center', justifyContent: 'center',
  },
  hero: {
    marginHorizontal: 16, borderRadius: 20, borderWidth: 1.5, borderColor: C.neon + '88',
    backgroundColor: '#160a12', overflow: 'hidden', flexDirection: 'row', minHeight: 168,
  },
  heroGlow: { position: 'absolute', top: -40, right: -30, width: 160, height: 160, borderRadius: 80, backgroundColor: C.neon + '22' },
  heroArt: { width: 110, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000033' },
  heroBody: { flex: 1, padding: 16, justifyContent: 'center' },
  heroTitle: { color: '#fff', fontWeight: '900', fontSize: 19, letterSpacing: 1, textShadowColor: C.neon, textShadowRadius: 12 },
  heroSub: { color: C.gold, fontWeight: '900', fontSize: 11, letterSpacing: 3, marginTop: 4 },
  heroDesc: { color: C.sub, fontSize: 11, marginTop: 6, lineHeight: 16 },
  heroBtn: {
    marginTop: 12, alignSelf: 'flex-start', backgroundColor: C.neon, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 20,
  },
  heroBtnText: { color: '#fff', fontWeight: '900', letterSpacing: 1.5, fontSize: 13 },
  matchCard: { width: 340, marginRight: 12, padding: 0, overflow: 'hidden' },
  secRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 14, marginBottom: 8 },
  secTitle: { color: C.text, fontWeight: '900', fontSize: 14, letterSpacing: 1.5 },
  viewAll: { color: C.neon, fontWeight: '900', fontSize: 11, letterSpacing: 1 },
  mBanner: { height: 110, backgroundColor: '#0a0e1e' },
  mBannerImg: { width: '100%', height: '100%' },
  mBannerShade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, backgroundColor: '#00000088' },
  mBadgeRow: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modeBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#000000aa' },
  modeBadgeT: { fontSize: 8.5, fontWeight: '900', letterSpacing: 1 },
  mTitleOnImg: { position: 'absolute', bottom: 8, left: 10, right: 10, color: '#fff', fontWeight: '900', fontSize: 15, textShadowColor: '#000', textShadowRadius: 6 },
  joinBtn: { marginTop: 10, backgroundColor: C.neon, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  joinBtnT: { color: '#fff', fontWeight: '900', letterSpacing: 1.5, fontSize: 12.5 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 14, marginTop: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#2a3350' },
  mTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  mMode: { color: C.orange, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  mTitle: { color: C.text, fontWeight: '900', fontSize: 15, marginTop: 2 },
  mSub: { color: C.sub, fontSize: 11, marginTop: 3 },
  mDivider: { height: 1, backgroundColor: C.border, marginVertical: 10 },
  mStats: { flexDirection: 'row' },
  mStat: { flex: 1, alignItems: 'center' },
  mStatL: { color: C.dim, fontSize: 9, letterSpacing: 1.5, fontWeight: '800' },
  mStatV: { color: C.text, fontWeight: '900', fontSize: 14, marginTop: 3 },
  slotBar: { height: 4, backgroundColor: '#1a2136', borderRadius: 2, marginTop: 10, overflow: 'hidden' },
  slotFill: { height: 4, backgroundColor: C.neon, borderRadius: 2 },
  modeCard: {
    marginHorizontal: 16, marginBottom: 12, padding: 9, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'stretch', minHeight: 124,
    backgroundColor: '#10162b',
  },
  modeArtWrap: {
    width: 98, height: 106, borderRadius: 11, overflow: 'hidden',
    backgroundColor: '#090d18', borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  modeBanner: { width: '100%', height: '100%', minHeight: 106 },
  modeBody: { flex: 1, minWidth: 0, justifyContent: 'center', paddingLeft: 12, paddingRight: 3, paddingVertical: 3 },
  modeTitle: { fontWeight: '900', fontSize: 13, letterSpacing: 0.35, lineHeight: 17 },
  modeCapacity: { fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginTop: 5 },
  modeChip: { borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#ffffff08' },
  modeChipT: { color: C.sub, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  modeBtn: {
    marginTop: 10, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 10,
    alignItems: 'center', justifyContent: 'space-between', flexDirection: 'row',
  },
  modeBtnT: { color: '#090b12', fontWeight: '900', letterSpacing: 0.9, fontSize: 9.5 },
  modeBtnArrow: { color: '#090b12', fontSize: 17, fontWeight: '900', lineHeight: 17 },
  socialBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 12,
    borderRadius: 16, borderWidth: 1.2, paddingVertical: 12, paddingHorizontal: 14,
  },
  socialIconWrap: {
    width: 46, height: 46, borderRadius: 14, borderWidth: 1.2, backgroundColor: '#ffffff0a',
    alignItems: 'center', justifyContent: 'center',
  },
  socialLabel: { fontWeight: '900', fontSize: 13, letterSpacing: 1.5 },
  socialAction: { color: C.sub, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginTop: 1 },
  socialChev: { fontSize: 22, fontWeight: '900' },
});
