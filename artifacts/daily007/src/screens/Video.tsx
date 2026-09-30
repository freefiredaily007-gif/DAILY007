import React, { useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, Linking, Dimensions, Alert } from 'react-native';
import { useApp } from '../App';
import { Api } from '../lib/api';

const W = Dimensions.get('window').width;

type Vid = { id: string; title: string; tag: string; emoji: string; url: string; tint: string; seconds: number };

const VIDEOS: Vid[] = [
  { id: 'v1', title: 'Free Fire Best Highlights 2025', tag: 'GAMEPLAY', emoji: '🔥', url: 'https://www.youtube.com/results?search_query=free+fire+highlights', tint: '#ff4655', seconds: 300 },
  { id: 'v2', title: 'Pro Solo Rush Tips & Tricks', tag: 'TIPS', emoji: '🎯', url: 'https://www.youtube.com/results?search_query=free+fire+solo+tips', tint: '#ffd166', seconds: 240 },
  { id: 'v3', title: 'Clash Squad Ranked Strategy', tag: 'STRATEGY', emoji: '💥', url: 'https://www.youtube.com/results?search_query=free+fire+clash+squad+strategy', tint: '#4dd8ff', seconds: 360 },
  { id: 'v4', title: 'Top 10 Headshot Tricks', tag: 'TUTORIAL', emoji: '🔫', url: 'https://www.youtube.com/results?search_query=free+fire+headshot+tricks', tint: '#b18cff', seconds: 300 },
  { id: 'v5', title: 'Live Tournament Streams', tag: 'LIVE', emoji: '🔴', url: 'https://www.youtube.com/results?search_query=free+fire+tournament+live', tint: '#ff4655', seconds: 600 },
  { id: 'v6', title: 'Best Character Combos', tag: 'GUIDE', emoji: '⚡', url: 'https://www.youtube.com/results?search_query=free+fire+best+character+combo', tint: '#3ddc97', seconds: 240 },
];

// Watch threshold: 65% of duration (within the required 60–70% band)
const THRESHOLD = 0.65;

export default function Video() {
  const { user, refresh } = useApp();
  const [tag, setTag] = useState('ALL');
  const [watching, setWatching] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [rewarded, setRewarded] = useState<Record<string, boolean>>({});
  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tags = ['ALL', 'GAMEPLAY', 'TIPS', 'STRATEGY', 'LIVE'];
  const list = VIDEOS.filter((v) => tag === 'ALL' || v.tag === tag);

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const startWatch = (v: Vid) => {
    stopTimer();
    setWatching(v.id);
    setProgress(0);
    startRef.current = Date.now();
    // Simulated playback progress (1s tick = 1s of watch time). On the APK this is
    // driven by the real player's onProgress callback instead.
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startRef.current) / 1000;
      const pct = Math.min(100, Math.round((elapsed / v.seconds) * 100));
      setProgress(pct);
      if (pct >= Math.round(THRESHOLD * 100)) {
        stopTimer();
        claim(v, pct);
      }
    }, 1000);
  };

  const claim = async (v: Vid, pct: number) => {
    try {
      const r: any = await Api.videoWatch({ videoId: v.id, percentWatched: pct });
      if (r?.rewarded) {
        setRewarded((p) => ({ ...p, [v.id]: true }));
        Alert.alert('🪙 +1 Coin', 'You watched ' + pct + '% — 1 coin credited to your wallet!');
        refresh();
      } else {
        Alert.alert('Keep Watching', r?.reason || 'Watch at least 60% of the video to earn 1 coin.');
      }
    } catch (e: any) {
      Alert.alert('Error', (e.response && e.response.data && e.response.data.error) || e.message);
    }
    setWatching(null);
    setProgress(0);
  };

  const exitWatch = (v: Vid) => {
    stopTimer();
    const elapsed = (Date.now() - startRef.current) / 1000;
    const pct = Math.min(100, Math.round((elapsed / v.seconds) * 100));
    setWatching(null);
    setProgress(0);
    if (pct >= 60) claim(v, pct);
    else Alert.alert('Not enough watch time', 'You watched only ' + pct + '%. Watch at least 60% to earn the coin.');
  };

  React.useEffect(() => stopTimer, []);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.hTitle}>▶ WATCH A VIDEO AND EARN</Text>
        <Text style={s.hSub}>Watch 60%+ of any video · earn 1 coin</Text>
      </View>
      <View style={s.chips}>
        {tags.map((t) => (
          <Pressable key={t} onPress={() => setTag(t)} style={[s.chip, tag === t && s.chipOn]}>
            <Text style={[s.chipTxt, tag === t && s.chipTxtOn]}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={list}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 14, paddingBottom: 90 }}
        renderItem={({ item }) => {
          const isWatching = watching === item.id;
          const done = rewarded[item.id];
          return (
            <View style={s.card}>
              <Pressable style={[s.thumb, { backgroundColor: item.tint + '22', borderColor: item.tint + '55' }]} onPress={() => (isWatching ? exitWatch(item) : startWatch(item))}>
                <Text style={{ fontSize: 34 }}>{item.emoji}</Text>
                <View style={s.play}><Text style={s.playTxt}>{isWatching ? '⏸' : '▶'}</Text></View>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={s.title} numberOfLines={2}>{item.title}</Text>
                <Text style={[s.tag, { color: item.tint }]}>{item.tag} · {Math.round(item.seconds / 60)} min</Text>
                {done && <Text style={s.doneTxt}>✓ +1 coin earned</Text>}
                {isWatching && (
                  <View style={s.progWrap}>
                    <View style={[s.progBar, { width: Math.max(8, (progress / 100) * (W - 160)) }]} />
                    <Text style={s.progTxt}>{progress}% {progress >= 60 ? '· reward unlocked ✓' : '· 60% needed'}</Text>
                  </View>
                )}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={s.empty}>No videos in this category yet.</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#070a12' },
  header: { padding: 16, paddingBottom: 8 },
  hTitle: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  hSub: { color: '#8a93a8', fontSize: 12, marginTop: 2 },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 10, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#141b30', borderWidth: 1, borderColor: '#232c4a' },
  chipOn: { backgroundColor: '#ff465522', borderColor: '#ff4655' },
  chipTxt: { color: '#8a93a8', fontSize: 11, fontWeight: '800' },
  chipTxtOn: { color: '#ff6b78' },
  card: { flexDirection: 'row', gap: 12, backgroundColor: '#10162b', borderRadius: 14, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#1c2440', alignItems: 'center' },
  thumb: { width: 96, height: 64, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  play: { position: 'absolute', width: 26, height: 26, borderRadius: 13, backgroundColor: '#ff4655', alignItems: 'center', justifyContent: 'center' },
  playTxt: { color: '#fff', fontSize: 12, marginLeft: 2 },
  title: { color: '#eef1f8', fontWeight: '800', fontSize: 13.5 },
  tag: { fontSize: 10, fontWeight: '900', letterSpacing: 1, marginTop: 4 },
  doneTxt: { color: '#3ddc97', fontSize: 10.5, fontWeight: '900', marginTop: 4 },
  progWrap: { marginTop: 6 },
  progBar: { height: 5, borderRadius: 3, backgroundColor: '#3ddc97' },
  progTxt: { color: '#8a93a8', fontSize: 10, marginTop: 3 },
  empty: { color: '#8a93a8', textAlign: 'center', marginTop: 40 },
});