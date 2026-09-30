import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Api, apiError } from '../lib/api';
import { Btn, Card, C, Chip, Empty, Loading, Msg } from '../components/ui';

const TABS = ['pending', 'approved', 'rejected'] as const;

export default function AdminRegs() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [all, setAll] = useState<any[] | null>(null);
  const [exportTournamentId, setExportTournamentId] = useState('');
  const [exportBusy, setExportBusy] = useState(false);

  const load = useCallback(async () => {
    setAll(await Api.adminRegistrations());
  }, []);
  useEffect(() => {
    setAll(null);
    load().catch((e) => { setErr(apiError(e)); setAll([]); });
  }, [load]);

  const list = (all ?? []).filter((x) => x.status === tab);
  const paidRoster = (all ?? []).filter((x) => x.status === 'pending' || x.status === 'approved');
  const tournaments = Array.from(new Map(paidRoster.map((r) => [
    String(r.tournamentId || ''),
    { id: String(r.tournamentId || ''), name: String(r.tournamentName || r.tournamentId || 'Tournament') },
  ])).values()).filter((t) => t.id);
  const selectedTournament = tournaments.find((t) => t.id === exportTournamentId) || tournaments[0];

  const exportCsv = async () => {
    if (!selectedTournament) return;
    setErr(''); setOkMsg(''); setExportBusy(true);
    try {
      const rows: string[][] = [['Player Name', 'Game UID', 'Team Name', 'Registration Status']];
      paidRoster.filter((r) => String(r.tournamentId) === selectedTournament.id).forEach((r) => {
        let members: any[] = [];
        try {
          const source = r.teamMembers ?? r.teammates;
          const parsed = typeof source === 'string' ? JSON.parse(source) : source;
          if (Array.isArray(parsed)) members = parsed;
        } catch {}
        if (r.teammates && !members.length) {
          try {
            const parsed = typeof r.teammates === 'string' ? JSON.parse(r.teammates) : r.teammates;
            if (Array.isArray(parsed)) members = parsed;
          } catch {}
        }
        if (members.length) {
          const captainName = r.captainName || r.playerName;
          if (captainName && !members.some((m) => m?.name === captainName)) {
            rows.push([String(captainName), String(r.captainGameUid || r.gameUid || ''), String(r.teamName || ''), String(r.status || '')]);
          }
          members.forEach((member) => rows.push([
            String(member?.name || ''),
            String(member?.uid || member?.gameUid || member?.captainGameUid || ''),
            String(r.teamName || ''),
            String(r.status || ''),
          ]));
        } else {
          rows.push([String(r.playerName || r.captainName || ''), String(r.gameUid || r.captainGameUid || ''), String(r.teamName || ''), String(r.status || '')]);
        }
      });
      const quote = (value: string) => {
        const safe = /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
        return `"${safe.replace(/"/g, '""')}"`;
      };
      const csv = rows.map((row) => row.map(quote).join(',')).join('\r\n');
      if (Platform.OS === 'web') {
        const browser = globalThis as any;
        const blob = new browser.Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = browser.URL.createObjectURL(blob);
        const link = browser.document.createElement('a');
        link.href = url;
        const safeId = selectedTournament.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        link.download = `daily007-${safeId}-players.csv`;
        link.click();
        browser.URL.revokeObjectURL(url);
        setOkMsg('Player list CSV downloaded.');
      } else {
        if (!(await Sharing.isAvailableAsync())) {
          throw new Error('Native file sharing is unavailable on this device.');
        }
        const safeId = selectedTournament.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const file = new File(Paths.cache, `daily007-${safeId}-players.csv`);
        if (file.exists) file.delete();
        file.create();
        file.write(csv);
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          UTI: 'public.comma-separated-values-text',
          dialogTitle: `${selectedTournament.name} player list`,
        });
        setOkMsg('CSV file opened in the native share sheet. Choose an app or save destination.');
      }
    } catch (e: any) { setErr(e?.message || 'Could not export the player list.'); }
    finally { setExportBusy(false); }
  };

  const act = async (id: string, action: 'approve' | 'reject') => {
    if (busyId) return;
    setErr(''); setOkMsg(''); setBusyId(id);
    try {
      await Api.adminRegAction(id, action);
      setOkMsg(action === 'approve' ? 'Registration approved' : 'Registration rejected — coins refunded');
      setTimeout(() => setOkMsg(''), 2500);
      try { await load(); }
      catch (e: any) { setErr(`Could not refresh registrations: ${apiError(e)}`); }
    } catch (e: any) { setErr(apiError(e)); }
    finally { setBusyId(null); }
  };

  const del = async (id: string) => {
    if (busyId) return;
    setErr(''); setOkMsg(''); setBusyId(id);
    try {
      await Api.adminDeleteRegistration(id);
      setOkMsg('Registration deleted');
      setTimeout(() => setOkMsg(''), 2500);
      try { await load(); }
      catch (e: any) { setErr(`Could not refresh registrations: ${apiError(e)}`); }
    } catch (e: any) { setErr(apiError(e)); }
    finally { setBusyId(null); }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <Text style={st.h}>📝 REGISTRATIONS</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {TABS.map((t) => <Chip key={t} label={t.toUpperCase()} color={tab === t ? C.neon : C.sub} onPress={() => setTab(t)} />)}
      </View>
      {tournaments.length > 0 && (
        <Card style={{ marginBottom: 12 }}>
          <Text style={st.exportTitle}>PLAYER LIST EXPORT</Text>
          <Text style={st.sub}>Pending and approved paid registrations · names and game UIDs as CSV (rejected/refunded entries excluded)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 10 }}>
            {tournaments.map((t) => (
              <Chip
                key={t.id}
                label={t.name}
                color={(selectedTournament?.id === t.id) ? C.neon : C.sub}
                onPress={() => setExportTournamentId(t.id)}
              />
            ))}
          </ScrollView>
          <Btn title={Platform.OS === 'web' ? 'DOWNLOAD CSV' : 'DOWNLOAD PLAYER LIST'} small onPress={exportCsv} loading={exportBusy} />
          {Platform.OS !== 'web' && <Text style={st.sub}>Creates a CSV file in app cache, then opens the system share/save sheet.</Text>}
        </Card>
      )}
      <Msg kind="err" text={err} />
      <Msg kind="ok" text={okMsg} />
      {all === null ? <Loading /> : err && all.length === 0 ? null : list.length === 0 ? <Empty text={`No ${tab} registrations.`} /> : list.map((r) => (
        <Card key={r.id} style={{ marginBottom: 10 }}>
          <Text style={st.pName}>{r.playerName}{r.teamName ? ` — ${r.teamName}` : ''}</Text>
          <Text style={st.sub}>🎮 UID: {r.gameUid}</Text>
          <Text style={st.sub}>🎯 {r.tournamentName || r.tournamentId} • {r.mode || ''} {r.teamType || ''}</Text>
          <Text style={st.sub}>🪙 Entry: {r.entryCoins} • {new Date(r.createdAt).toLocaleString()}</Text>
          {r.teamMembers && r.teamMembers !== '[]' && (
            <Text style={st.sub}>👥 {r.teamMembers}</Text>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {tab === 'pending' && (
              <>
                <View style={{ flex: 1 }}><Btn title="✅ APPROVE" small loading={busyId === r.id} disabled={busyId !== null} onPress={() => act(r.id, 'approve')} /></View>
                <View style={{ flex: 1 }}><Btn title="❌ REJECT" small kind="danger" loading={busyId === r.id} disabled={busyId !== null} onPress={() => act(r.id, 'reject')} /></View>
              </>
            )}
            {tab !== 'pending' && (
              <View style={{ flex: 1 }}><Btn title="🗑 DELETE" small kind="danger" loading={busyId === r.id} disabled={busyId !== null} onPress={() => del(r.id)} /></View>
            )}
          </View>
        </Card>
      ))}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 30 },
  h: { color: C.text, fontSize: 20, fontWeight: '900', marginBottom: 10, letterSpacing: 1 },
  pName: { color: C.text, fontWeight: '900', fontSize: 14 },
  exportTitle: { color: C.neon, fontWeight: '900', fontSize: 13, letterSpacing: 1 },
  sub: { color: C.sub, fontSize: 11, marginTop: 3 },
});
