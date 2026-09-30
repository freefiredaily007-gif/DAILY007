// My Matches — upcoming / live / completed tabs with room details
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Api, apiError } from '../lib/api';
import { C, Card, Empty, Loading, GCard, Badge, SectionTitle, fmtDate, fmtTime12 } from '../components/ui';

export default function MyMatches() {
  const [regs, setRegs] = useState<any[]>([]);
  const [tab, setTab] = useState<'upcoming' | 'live' | 'completed'>('upcoming');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await Api.myRegistrations();
      setRegs(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = regs.filter((r) => {
    const st = r.tournament?.status ?? 'upcoming';
    if (tab === 'upcoming') return st === 'upcoming' || st === 'open' || st === 'full';
    if (tab === 'live') return st === 'live';
    return st === 'completed' || st === 'cancelled';
  });

  return (
    <View style={s.wrap}>
      <SectionTitle accent={C.purple}>MY MATCHES</SectionTitle>
      <View style={s.tabs}>
        {(['upcoming', 'live', 'completed'] as const).map((t) => (
          <Text key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabOn]}>{t.toUpperCase()}</Text>
        ))}
      </View>
      {loading ? <Loading /> : error ? (
        <Text style={s.err}>{error}</Text>
      ) : filtered.length === 0 ? (
        <Empty icon="📋" text={'No ' + tab + ' matches yet. Join a tournament to get started!'} actionLabel="CHECK MATCHES" onAction={() => {}} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r, i) => String(r.id ?? i)}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.neon} />}
          contentContainerStyle={{ padding: 14, gap: 12 }}
          renderItem={({ item }) => {
            const t = item.tournament ?? {};
            const roomReady = item.status === 'approved' && t.roomPublished;
            return (
              <GCard glowColor={roomReady ? C.green : undefined}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={s.mode}>{String(t.mode ?? '').toUpperCase()} • {String(t.teamType ?? '').toUpperCase()}</Text>
                    <Text style={s.tName}>{t.name ?? 'Tournament'}</Text>
                  </View>
                  <Badge text={String(item.status ?? '').toUpperCase()} color={item.status === 'approved' ? C.green : item.status === 'rejected' ? C.red : C.gold} />
                </View>
                <Text style={s.meta}>📅 {fmtDate(t.date)} • {fmtTime12(t.time)}</Text>
                {item.teamName ? <Text style={s.meta}>Team: {item.teamName}</Text> : null}
                <View style={s.room}>
                  {roomReady ? (
                    <>
                      <Text style={s.roomLine}>ROOM ID: <Text style={s.roomVal}>{t.roomId}</Text></Text>
                      <Text style={s.roomLine}>PASSWORD: <Text style={s.roomVal}>{t.roomPassword}</Text></Text>
                    </>
                  ) : (
                    <Text style={s.roomLocked}>
                      {item.status === 'approved'
                        ? '🔒 Room details will be available after the admin publishes the room.'
                        : '⏳ Waiting for admin approval.'}
                    </Text>
                  )}
                </View>
                {item.result ? <Text style={s.result}>🏆 {item.result}</Text> : null}
              </GCard>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  h1: { color: C.text, fontSize: 22, fontWeight: '900', letterSpacing: 1, padding: 14, paddingBottom: 4 },
  tabs: { flexDirection: 'row', paddingHorizontal: 14, gap: 8, marginBottom: 6 },
  tab: { color: C.sub, fontWeight: '800', fontSize: 11, letterSpacing: 1, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, overflow: 'hidden', backgroundColor: '#151a29' },
  tabOn: { color: '#fff', backgroundColor: C.neon },
  err: { color: '#ef4444', textAlign: 'center', marginTop: 40, paddingHorizontal: 20 },
  mode: { color: C.orange, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  tName: { color: C.text, fontWeight: '900', fontSize: 16, marginTop: 2 },
  meta: { color: C.sub, fontSize: 12, marginTop: 4 },
  room: { backgroundColor: '#0d1120', borderRadius: 10, padding: 10, marginTop: 10, borderWidth: 1, borderColor: C.border },
  roomLine: { color: C.sub, fontSize: 12, fontWeight: '700', marginTop: 2 },
  roomVal: { color: '#22c55e', fontWeight: '900' },
  roomLocked: { color: '#f59e0b', fontSize: 12, fontWeight: '600' },
  result: { color: '#fbbf24', fontWeight: '800', marginTop: 8, fontSize: 13 },
});
