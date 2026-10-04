// Home — premium esports landing: header, hero, live matches, game modes, quick actions, social
import React, { useCallback, useState, useRef } from 'react';
import { View, ScrollView, Pressable, StyleSheet, RefreshControl, Linking, Image, Animated, Easing, useWindowDimensions } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import bannerSquad from '../assets/banner-squad.jpg';
import bannerClash from '../assets/banner-clash.jpg';
import modeSoloLogo from '../assets/mode-solo-logo.jpg';
import modeSquadLogo from '../assets/mode-squad-logo.jpg';
import modeClashLogo from '../assets/mode-clash-logo.jpg';
import { useNavigation } from '@react-navigation/native';
import { api, Api } from '../lib/api';
import { useApp } from '../App';
import { C, Card, SectionTitle, Loading, Empty, GCard, Badge, CoinCapsule, glow, Pulse, fmtTime12, getTournamentFormatPresentation } from '../components/ui';
import { inr } from '../lib/coins';
import { getTournamentLifecycleState, MAX_TIMEOUT_MS } from '../lib/tournamentLifecycle';
import { HOME_GAME_MODE_CARDS, homeModeRouteParams } from '../lib/tournamentFilters';
import { WhatsAppIcon, InstagramIcon, YouTubeIcon } from '../components/SocialIcons';
import logoImg from '../assets/logo.jpg';
import HomeLeaderboards from './HomeLeaderboards';

function fmtDate(d?: string) {
  if (!d) return '';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  if (isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
}
function statusOf(t: any, now: number) {
  const filled = Number(t.filledSlots ?? t.filled ?? 0);
  const total = Number(t.totalSlots ?? (String(t.mode || '').toLowerCase().includes('clash') ? 2 : String(t.teamType || '').toLowerCase() === 'squad' ? 12 : 48));
  const status = String(t.status ?? '').toLowerCase();
  const lifecycle = getTournamentLifecycleState(t, now);
  if (lifecycle === 'ongoing') return { key: 'ONGOING', color: C.red };
  if (lifecycle === 'completed' || lifecycle === 'closed') return { key: 'COMPLETED', color: C.dim };
  if (status === 'full' || status === 'setup_needed' || (total > 0 && filled >= total)) return { key: 'FULL', color: C.orange };
  return { key: 'UPCOMING', color: C.green };
}
function tournamentModeFallback(t: any): number {
  if (String(t?.mode || '').toLowerCase().includes('clash')) return 2;
  if (String(t?.teamType || '').toLowerCase() === 'squad') return 12;
  return 48;
}
export default function Home() {
  const { fontScale } = useWindowDimensions();
  const { user } = useApp();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [links, setLinks] = useState<any>({});
  const [page, setPage] = useState(0);
  const carouselRef = useRef<ScrollView>(null);
  const pageRef = useRef(0);
  const nav: any = useNavigation();
  const goTab = (k: string) => nav.navigate(k === 'wallet' ? 'Wallet' : k === 'profile' ? 'Profile' : k === 'mymatches' ? 'MyMatches' : k === 'tournaments' ? 'Tournaments' : 'Home');
  const goStack = (k: string) => {
    if (k.startsWith('tdetail:')) nav.navigate('TDetail', { id: k.slice(8) });
  };
  const load = useCallback(async () => {
    try {
      const [r, registrations] = await Promise.all([
        api.tournaments('?enabled=true'),
        api.myRegistrations(),
      ]);
      const list = Array.isArray(r) ? r : r?.tournaments || [];
      const joinedIds = new Set(
        (Array.isArray(registrations) ? registrations : [])
          .filter((registration: any) => ['approved', 'pending'].includes(String(registration.status ?? '').toLowerCase()))
          .map((registration: any) => String(registration.tournamentId)),
      );
      setItems((Array.isArray(list) ? list : []).map((tournament: any) => ({
        ...tournament,
        joined: joinedIds.has(String(tournament.id)),
      })));
      setClockNow(Date.now());
      setLoadError('');
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load tournaments.');
    }
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); Api.settings().then((st: any) => setLinks(st?.settings ?? st ?? {})).catch(() => {}); }, [load]);
  React.useEffect(() => {
    const now = Date.now();
    const nextStart = items
      .filter((tournament) => getTournamentLifecycleState(tournament, clockNow) === 'upcoming')
      .map((tournament) => Date.parse(String(tournament.startsAt ?? '')))
      .filter((start) => Number.isFinite(start) && start > now)
      .sort((a, b) => a - b)[0];
    if (nextStart === undefined) return;
    const timer = setTimeout(() => setClockNow(Date.now()), Math.min(MAX_TIMEOUT_MS, Math.max(0, nextStart - now + 20)));
    return () => clearTimeout(timer);
  }, [items, clockNow]);

  const upcomingItems = items.filter(
    (tournament) => getTournamentLifecycleState(tournament, clockNow) === 'upcoming',
  );

  const onCarouselScroll = (e: any) => {
    const x = e?.nativeEvent?.contentOffset?.x ?? 0;
    const w = e?.nativeEvent?.layoutMeasurement?.width || 1;
    const p = Math.round(x / w);
    if (p !== pageRef.current) { pageRef.current = p; setPage(p); }
  };
  // auto-scroll every 3.5s when more than one match
  React.useEffect(() => {
    if (upcomingItems.length <= 1) return;
    const iv = setInterval(() => {
      const next = (pageRef.current + 1) % Math.min(upcomingItems.length, 8);
      try { carouselRef.current?.scrollTo({ x: next * 390, animated: true }); } catch {}
    }, 3500);
    return () => clearInterval(iv);
  }, [upcomingItems.length]);
  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const social = (url?: string) => { if (url) Linking.openURL(url).catch(() => {}); };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 30 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.neon} />}>
      {/* grid pattern backdrop */}
      <View style={s.gridBg} pointerEvents="none" />

      {/* ===== TOP HEADER ===== */}
      <View style={[s.head, fontScale >= 1.5 && s.headLarge]}>
        <View style={s.headGlow} pointerEvents="none" />
        <View style={[s.logoWrap, fontScale >= 1.5 && s.logoWrapLarge]}>
          <View style={[s.logoBadge, glow(C.neon, 14)]}>
            <Image source={logoImg} style={s.logoImg} resizeMode="cover" />
          </View>
          <View style={[s.logoText, fontScale >= 1.5 && s.logoTextLarge]}>
            <Text style={s.logo}>FREE FIRE</Text>
            <Text style={s.logoSub}>DAILY007 TOURNAMENTS</Text>
          </View>
        </View>
        <View style={[s.headerActions, fontScale >= 1.5 && s.headerActionsLarge]}>
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

      {/* ===== UPCOMING MATCHES — auto carousel ===== */}
      <Pressable
        style={({ pressed }) => [s.myMatchesButton, pressed && { opacity: 0.8 }]}
        onPress={() => goTab('mymatches')}
        accessibilityRole="button"
        accessibilityLabel="Open My Matches for your room details and results"
      >
        <Text style={s.myMatchesButtonText}>🎮 MY MATCHES</Text>
        <Text style={s.myMatchesButtonHint}>ROOM DETAILS & RESULTS →</Text>
      </Pressable>
      <View style={[s.secRow, fontScale >= 1.5 && s.secRowLarge]}>
        <Text style={s.secTitle}>🔥 UPCOMING MATCHES</Text>
        <Pressable onPress={() => goTab('tournaments')} hitSlop={8} style={fontScale >= 1.5 && s.viewAllPressableLarge}>
          <Text style={s.viewAll}>VIEW ALL →</Text>
        </Pressable>
      </View>
      {loading ? <Loading /> : upcomingItems.length === 0 ? (
        <Empty icon="🎮" text={loadError ? `Tournament data is unavailable: ${loadError}` : 'No upcoming tournaments are available right now.'} actionLabel="CHECK MATCHES" onAction={() => goTab('tournaments')} />
      ) : (
        <>
          <ScrollView
            ref={carouselRef}
            testID="home-upcoming-carousel"
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            onScroll={onCarouselScroll} scrollEventThrottle={16}
            style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16 }}
            decelerationRate="fast">
            {upcomingItems.slice(0, 8).map((t) => {
              const filled = t.filledSlots ?? t.filled ?? 0;
              const total = t.totalSlots ?? tournamentModeFallback(t);
              const stt = statusOf(t, clockNow);
              const ongoing = stt.key === 'ONGOING';
              const formatPresentation = getTournamentFormatPresentation(t);
              const showFormatArt = formatPresentation.showFormatBanner;
              const showBattleRoyalePoster = formatPresentation.showBattleRoyalePoster;
              const br = showBattleRoyalePoster;
              const matchMetaDate = showBattleRoyalePoster
                ? fmtDate(t.date)
                : `${t.teamType ?? ''} • ${fmtDate(t.date)}`;
              const tournamentModeLabel = String(t.mode || t.gameMode || 'CLASH SQUAD')
                .replace(/[_-]+/g, ' ')
                .toUpperCase();
              const capacityFull = stt.key === 'FULL' ||
                ['full', 'setup_needed'].includes(String(t.status ?? '').toLowerCase()) ||
                (Number(total) > 0 && Number(filled) >= Number(total));
              const joined = t.joined === true;
              const ctaLabel = joined
                ? capacityFull ? 'JOINED · SLOTS FULL' : 'JOINED'
                : ongoing ? 'VIEW MATCH' : capacityFull ? 'SLOTS FULL' : 'JOIN NOW ›';
        return (
          <GCard
            key={t.id}
            testID={`home-upcoming-card-${t.id}`}
            onPress={() => goStack('tdetail:' + t.id)}
            glowColor={ongoing ? C.red : br ? C.orange : C.purple}
            style={s.matchCard}
          >
            <View
              style={[
                showBattleRoyalePoster ? s.mPosterBanner : showFormatArt ? s.mFormatBanner : s.mBanner,
                showFormatArt
                  ? { height: Math.max(194, 160 * fontScale) }
                  : !showBattleRoyalePoster
                    ? { height: Math.max(110, 120 * fontScale) }
                    : null,
              ]}
            >
              <Image
                source={showBattleRoyalePoster ? formatPresentation.image : showFormatArt ? formatPresentation.image : br ? bannerSquad : bannerClash}
                style={showBattleRoyalePoster ? s.mPosterBannerImg : s.mBannerImg}
                resizeMode={showBattleRoyalePoster || showFormatArt ? 'contain' : 'cover'}
              />
              {!showBattleRoyalePoster && (
                <>
                  <View style={[s.mBannerShade, { height: Math.max(60, 80 * fontScale) }]} />
                  <View style={s.mBadgeRow}>
                    {ongoing ? <Pulse><Badge text="● ONGOING" color={C.red} /></Pulse> : <Badge text={stt.key} color={stt.color} />}
                    <View style={[s.modeBadge, { borderColor: br ? C.orange : C.purple }]}>
                      <Text style={[s.modeBadgeT, { color: br ? C.orange : C.purple }]}>
                        {br ? 'BATTLE ROYALE' : showFormatArt ? tournamentModeLabel : 'CLASH SQUAD'}
                      </Text>
                    </View>
                  </View>
                  {showFormatArt ? (
                    <View style={s.mFormatBottomRow}>
                      <Text style={s.mFormatTitle}>{t.name ?? 'Match'}</Text>
                      <View style={s.mFormatBadge}>
                        <Text style={s.mFormatBadgeT}>{formatPresentation.label} · {formatPresentation.matchup}</Text>
                      </View>
                    </View>
                  ) : (
                    <Text style={s.mTitleOnImg}>{t.name ?? 'Match'}</Text>
                  )}
                </>
              )}
            </View>
            <View style={{ padding: 12 }}>
              {showBattleRoyalePoster && (
                <View style={s.mPosterHeader}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={s.mMode}>BATTLE ROYALE • {String(t.teamType ?? 'SOLO').toUpperCase()}</Text>
                    <Text style={s.mTitle}>{t.name ?? 'Match'}</Text>
                  </View>
                  {ongoing ? <Pulse><Badge text="● ONGOING" color={C.red} /></Pulse> : <Badge text={stt.key} color={stt.color} />}
                </View>
              )}
              <Text style={s.mSub}>{matchMetaDate} • <Text style={s.mTime}>{fmtTime12(t.time)} IST</Text></Text>
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
              <Pressable
                disabled={!joined && capacityFull && !ongoing}
                style={({ pressed }) => [
                  s.joinBtn,
                  joined && { backgroundColor: C.green + '22', borderColor: C.green + '77' },
                  !joined && capacityFull && !ongoing && { backgroundColor: C.card2, borderColor: C.border },
                  pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
                ]}
                onPress={() => goStack('tdetail:' + t.id)}>
                <Text style={[s.joinBtnT, joined && { color: C.green }, !joined && capacityFull && !ongoing && { color: C.dim }]}>{ctaLabel}</Text>
              </Pressable>
            </View>
          </GCard>
            ); })}
          </ScrollView>
          {upcomingItems.length > 1 && (
            <View testID="home-upcoming-page-indicators" style={s.dots}>
              {upcomingItems.slice(0, 8).map((_, i) => (
                <View key={i} testID={`home-upcoming-page-dot-${i}`} style={[s.dot, i === page && { backgroundColor: C.neon, width: 16 }]} />
              ))}
            </View>
          )}
        </>
      )}

      {/* ===== GAME MODES ===== */}
      <SectionTitle accent={C.orange}>GAME MODES</SectionTitle>
      {[
        { ...HOME_GAME_MODE_CARDS[0], img: modeSquadLogo, category: 'CLASSIC SURVIVAL', title: 'BATTLE ROYALE', capacity: 'SOLO · DUO · SQUAD', accent: C.gold },
        { ...HOME_GAME_MODE_CARDS[1], img: modeClashLogo, category: 'TEAM BATTLE', title: 'CLASH SQUAD', capacity: 'SOLO · DUO · SQUAD', accent: C.neon },
        { ...HOME_GAME_MODE_CARDS[2], img: modeSoloLogo, category: '1V1 DUELS', title: 'LONE WOLF', capacity: 'SOLO · DUO · SQUAD', accent: C.purple },
      ].map((m) => {
        const spokenCapacity = m.capacity
          .split('·')
          .map((size) => size.trim().toLowerCase())
          .filter(Boolean)
          .join(', ');
        return (
          <View key={m.gameMode}>
            <GCard
              onPress={() => nav.navigate('Tournaments', homeModeRouteParams(m))}
              accessibilityLabel={`Open ${m.mode} tournaments. Available team sizes: ${spokenCapacity}.`}
              accessibilityHint="Shows upcoming, ongoing, and completed tournaments for this game mode"
              testID={`home-mode-${m.mode.toLowerCase().replace(/[^a-z]+/g, '-')}`}
              glowColor={m.accent}
              style={[s.modeCard, { borderLeftColor: m.accent }]}
            >
              <View style={s.modeArtWrap}>
                <Image source={m.img} style={s.modeBanner} resizeMode="contain" />
              </View>
              <View style={s.modeBody}>
                <Text style={[s.modeKicker, { color: m.accent }]}>{m.category}</Text>
                <Text style={s.modeTitle}>{m.title}</Text>
                <View style={[s.modeCapacityBadge, { borderColor: m.accent + '66', backgroundColor: m.accent + '14' }]}>
                  <Text style={[s.modeCapacity, { color: m.accent }]}>{m.capacity}</Text>
                </View>
                <View style={[s.modeBtn, { backgroundColor: m.accent }, glow(m.accent, 8)]}>
                  <Text style={s.modeBtnT}>BROWSE TOURNAMENTS</Text>
                  <Text style={s.modeBtnArrow} accessibilityElementsHidden>›</Text>
                </View>
              </View>
            </GCard>
            <Pressable
              style={s.formatLink}
              onPress={() => nav.navigate('ModeSubmodes', homeModeRouteParams(m))}
              accessibilityRole="button"
              accessibilityLabel={`Choose Solo, Duo, or Squad ${m.mode} tournaments`}
              accessibilityHint="Opens the tournament format choices"
              testID={`home-format-${m.gameMode}`}
            >
              <Text style={s.formatLinkText}>CHOOSE FORMAT · SOLO / DUO / SQUAD</Text>
              <Text style={s.formatLinkArrow} accessibilityElementsHidden>›</Text>
            </Pressable>
          </View>
        );
      })}

      <HomeLeaderboards onOpen={() => nav.navigate('LeaderboardDetails', { cycleType: 'weekly' })} />

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
    borderTopWidth: 1, borderTopColor: '#70b8ff06',
  },
  head: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12, paddingBottom: 12,
    backgroundColor: '#0d1226', borderBottomWidth: 0, overflow: 'hidden',
  },
  headLarge: { flexWrap: 'wrap', alignItems: 'flex-start' },
  headGlow: { position: 'absolute', top: -60, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: C.neon + '14' },
  headLine: { height: 2, backgroundColor: C.neon + '55', shadowColor: C.neon, shadowOpacity: 0.8, shadowRadius: 8 },
  logoWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  logoWrapLarge: { flexBasis: '100%', width: '100%' },
  logoText: { flex: 1, minWidth: 0 },
  logoTextLarge: { minWidth: 0 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  headerActionsLarge: { width: '100%', flexWrap: 'wrap', justifyContent: 'flex-start', marginTop: 10 },
  logoBadge: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#1a0d10', borderWidth: 1.5,
    borderColor: C.neon, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  logoImg: { width: 40, height: 40 },
  logo: { color: C.text, fontWeight: '900', fontSize: 16, letterSpacing: 1.5, textShadowColor: C.neon + '88', textShadowRadius: 10 },
  logoSub: { color: C.gold, fontWeight: '900', fontSize: 8, letterSpacing: 1, marginTop: 1 },
  bellBtn: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: '#70b8ff0a', borderWidth: 1,
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
  heroBtnText: { color: C.bg, fontWeight: '900', letterSpacing: 1.5, fontSize: 13 },
  matchCard: { width: 340, marginRight: 12, padding: 0, overflow: 'hidden' },
  secRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 14, marginBottom: 8 },
  secRowLarge: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  viewAllPressableLarge: { alignSelf: 'flex-end' },
  secTitle: { color: C.text, fontWeight: '900', fontSize: 14, letterSpacing: 1.5 },
  viewAll: { color: C.neon, fontWeight: '900', fontSize: 11, letterSpacing: 1 },
  mBanner: { height: 110, backgroundColor: '#0a0e1e' },
  mFormatBanner: { width: '100%', aspectRatio: 16 / 9, backgroundColor: C.bg2, overflow: 'hidden' },
  mPosterBanner: { width: '100%', aspectRatio: 16 / 9, backgroundColor: C.bg2, overflow: 'hidden' },
  mBannerImg: { width: '100%', height: '100%' },
  mPosterBannerImg: { width: '100%', height: '100%' },
  mBannerShade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, backgroundColor: '#00000088' },
  mBadgeRow: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modeBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#000000aa' },
  modeBadgeT: { fontSize: 8.5, fontWeight: '900', letterSpacing: 1 },
  mTitleOnImg: { position: 'absolute', bottom: 8, left: 10, right: 10, color: '#fff', fontWeight: '900', fontSize: 15, textShadowColor: '#000', textShadowRadius: 6 },
  mFormatBottomRow: { position: 'absolute', bottom: 8, left: 10, right: 10, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 },
  mFormatTitle: { flex: 1, minWidth: 0, color: '#fff', fontWeight: '900', fontSize: 15, textShadowColor: '#000', textShadowRadius: 6 },
  mFormatBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4, backgroundColor: C.gold },
  mFormatBadgeT: { color: C.bg, fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  joinBtn: { marginTop: 10, backgroundColor: C.neon, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  joinBtnT: { color: C.bg, fontWeight: '900', letterSpacing: 1.5, fontSize: 12.5 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 14, marginTop: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#2a3350' },
  mTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  mMode: { color: C.orange, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  mTitle: { color: C.text, fontWeight: '900', fontSize: 15, marginTop: 2 },
  mPosterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  mSub: { color: C.sub, fontSize: 11, marginTop: 3 },
  mTime: { color: C.gold, fontSize: 15, fontWeight: '900' },
  mDivider: { height: 1, backgroundColor: C.border, marginVertical: 10 },
  mStats: { flexDirection: 'row' },
  mStat: { flex: 1, alignItems: 'center' },
  mStatL: { color: C.dim, fontSize: 9, letterSpacing: 1.5, fontWeight: '800' },
  mStatV: { color: C.text, fontWeight: '900', fontSize: 14, marginTop: 3 },
  slotBar: { height: 4, backgroundColor: '#1a2136', borderRadius: 2, marginTop: 10, overflow: 'hidden' },
  slotFill: { height: 4, backgroundColor: C.neon, borderRadius: 2 },
  modeCard: {
    marginHorizontal: 16, marginBottom: 12, padding: 10, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'stretch', minHeight: 146,
    backgroundColor: '#11182a', borderRadius: 16, borderWidth: 1,
    borderColor: '#28314b', borderLeftWidth: 4,
  },
  formatLink: {
    minHeight: 34, marginHorizontal: 16, marginTop: -6, marginBottom: 12,
    paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: C.blue + '55',
    backgroundColor: C.bg2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  formatLinkText: { color: C.blue, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  formatLinkArrow: { color: C.blue, fontSize: 17, fontWeight: '900', lineHeight: 17 },
  modeArtWrap: {
    width: 104, height: 124, borderRadius: 12, overflow: 'hidden',
    backgroundColor: '#090d18', borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  modeBanner: { width: '100%', height: '100%', minHeight: 124 },
  modeBody: { flex: 1, minWidth: 0, justifyContent: 'center', paddingLeft: 12, paddingRight: 2, paddingVertical: 3 },
  modeKicker: { fontWeight: '900', fontSize: 9, letterSpacing: 1.4, lineHeight: 12 },
  modeTitle: { color: C.text, fontWeight: '900', fontSize: 17, letterSpacing: 0.45, lineHeight: 20, marginTop: 4 },
  modeCapacityBadge: {
    alignSelf: 'flex-start', borderWidth: 1, borderRadius: 7,
    paddingHorizontal: 8, paddingVertical: 5, marginTop: 7, maxWidth: '100%',
  },
  modeCapacity: { fontSize: 8.5, fontWeight: '900', letterSpacing: 0.7 },
  modeChip: { borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#70b8ff08' },
  modeChipT: { color: C.sub, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  modeBtn: {
    marginTop: 9, minHeight: 36, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 9,
    alignItems: 'center', justifyContent: 'space-between', flexDirection: 'row',
  },
  modeBtnT: { flex: 1, minWidth: 0, flexShrink: 1, textAlign: 'center', color: '#090b12', fontWeight: '900', letterSpacing: 0.65, fontSize: 9.5 },
  modeBtnArrow: { color: '#090b12', fontSize: 17, fontWeight: '900', lineHeight: 17 },
  socialBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 12,
    borderRadius: 16, borderWidth: 1.2, paddingVertical: 12, paddingHorizontal: 14,
  },
  socialIconWrap: {
    width: 46, height: 46, borderRadius: 14, borderWidth: 1.2, backgroundColor: '#70b8ff0a',
    alignItems: 'center', justifyContent: 'center',
  },
  socialLabel: { fontWeight: '900', fontSize: 13, letterSpacing: 1.5 },
  socialAction: { color: C.sub, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginTop: 1 },
  socialChev: { fontSize: 22, fontWeight: '900' },
});
