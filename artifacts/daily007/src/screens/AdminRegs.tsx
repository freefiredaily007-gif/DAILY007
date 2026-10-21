import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Platform } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Api, apiError } from '../lib/api';
import { Btn, Card, C, Chip, Empty, Loading, Msg } from '../components/ui';
import { CopyUidButton } from '../components/CopyUidButton';
import { useToast } from '../components/adminKit';
import { filterAdminRegistrationRows } from '../lib/adminRegistrationFilter';

const TABS = ['pending', 'approved', 'rejected', 'removed'] as const;

export default function AdminRegs() {
  const toast = useToast();
  const [tab, setTab] = useState<(typeof TABS)[number]>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [all, setAll] = useState<any[] | null>(null);
  const [tournamentFilter, setTournamentFilter] = useState('');
  const [exportTournamentId, setExportTournamentId] = useState('');
  const [exportBusy, setExportBusy] = useState(false);

  const load = useCallback(async () => {
    setAll(await Api.adminRegistrations());
  }, []);
  useEffect(() => {
    setAll(null);
    load().catch((e) => { setErr(apiError(e)); setAll([]); });
  }, [load]);

  const list = filterAdminRegistrationRows(all ?? [], tab, tournamentFilter);
  const paidRoster = (all ?? []).filter((x) => x.status === 'pending' || x.status === 'approved');
  const tournaments = Array.from(new Map((all ?? []).map((r) => [
    String(r.tournamentId || ''),
    { id: String(r.tournamentId || ''), name: String(r.tournamentName || r.tournamentId || 'Tournament') },
  ])).values()).filter((t) => t.id);
  const exportTournaments = Array.from(new Map(paidRoster.map((r) => [
    String(r.tournamentId || ''),
    { id: String(r.tournamentId || ''), name: String(r.tournamentName || r.tournamentId || 'Tournament') },
  ])).values()).filter((t) => t.id);
  const selectedTournament = exportTournaments.find((t) => t.id === exportTournamentId) || exportTournaments[0];

  const rosterText = (raw: unknown) => {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) return parsed.map((member) => {
        const name = String(member?.name || member?.ign || 'Player');
        const uid = String(member?.uid || member?.gameUid || '').trim();
        return uid ? `${name} · UID ${uid}` : name;
      }).join('\n');
    } catch {}
    return typeof raw === 'string' ? raw : '';
  };

  const exportCsv = async () => {
    if (!selectedTournament) return;
    setErr(''); setOkMsg(''); setExportBusy(true);
    try {
      const rows: string[][] = [['Real Name', 'In-Game Name', 'Game UID', 'Team Name', 'Registration Status']];
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
        const captainName = String(r.captainName || r.playerName || '');
        const captainGameName = String(r.captainGameName || '');
        const captainUid = String(r.captainGameUid || r.gameUid || '');
        rows.push([
          captainName,
          captainGameName,
          captainUid,
          String(r.teamName || ''),
          String(r.status || ''),
        ]);
        const teammates = members.filter((member, index) => !(
          index === 0 &&
          String(member?.uid || member?.gameUid || member?.captainGameUid || '') === captainUid
        ));
        teammates.forEach((member) => rows.push([
          '',
          String(member?.name || member?.ign || ''),
          String(member?.uid || member?.gameUid || member?.captainGameUid || ''),
          String(r.teamName || ''),
          String(r.status || ''),
        ]));
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
        try {
          if (file.exists) file.delete();
          file.create();
          file.write(csv);
          await Sharing.shareAsync(file.uri, {
            mimeType: 'text/csv',
            UTI: 'public.comma-separated-values-text',
            dialogTitle: `${selectedTournament.name} player list`,
          });
        } finally {
          if (file.exists) file.delete();
        }
        setOkMsg('CSV file opened in the native share sheet. Choose an app or save destination.');
      }
    } catch (e: any) { setErr(e?.message || 'Could not export the player list.'); }
    finally { setExportBusy(false); }
  };

  const act = async (id: string, action: 'approve' | 'reject', playerName: string) => {
    if (busyId) return;
    setErr(''); setOkMsg(''); setBusyId(id);
    try {
      await Api.adminRegAction(id, action);
      setOkMsg(action === 'approve' ? 'Registration approved' : 'Registration rejected — coins refunded');
      setTimeout(() => setOkMsg(''), 2500);
      try { await load(); }
      catch (e: any) { setErr(`Could not refresh registrations: ${apiError(e)}`); }
    } catch (e: any) {
      const actionLabel = action === 'approve' ? 'APPROVE' : 'REJECT';
      setErr(
        `Could not ${action} registration for ${playerName}: ${apiError(e)}. ` +
        `The registration remains in this list. Check its current status, then activate ${actionLabel} for ${playerName} to retry.`,
      );
    }
    finally { setBusyId(null); }
  };

  const del = async (id: string, playerName: string) => {
    if (busyId) return;
    setErr(''); setOkMsg(''); setBusyId(id);
    try {
      await Api.adminDeleteRegistration(id);
      setOkMsg('Registration deleted');
      setTimeout(() => setOkMsg(''), 2500);
      try { await load(); }
      catch (e: any) { setErr(`Could not refresh registrations: ${apiError(e)}`); }
    } catch (e: any) {
      setErr(
        `Could not delete registration for ${playerName}: ${apiError(e)}. ` +
        `The registration remains in this list. Check its current status, then activate DELETE for ${playerName} to retry.`,
      );
    }
    finally { setBusyId(null); }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <Text style={st.h}>REGISTRATIONS</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {TABS.map((t) => <Chip key={t} testID={`admin-registration-filter-${t}`} label={t.toUpperCase()} color={tab === t ? C.neon : C.sub} onPress={() => setTab(t)} />)}
      </View>
      {exportTournaments.length > 0 && (
        <Card style={{ marginBottom: 12 }}>
          <Text style={st.exportTitle}>TOURNAMENT REGISTRATION LIST</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 10 }}>
            <Chip testID="admin-registration-tournament-filter-all" label="ALL TOURNAMENTS" color={!tournamentFilter ? C.neon : C.sub} onPress={() => setTournamentFilter('')} />
            {tournaments.map((t) => (
              <Chip
                key={t.id}
                testID={`admin-registration-tournament-filter-${t.id}`}
                label={t.name}
                color={tournamentFilter === t.id ? C.neon : C.sub}
                onPress={() => setTournamentFilter(t.id)}
              />
            ))}
          </ScrollView>
        </Card>
      )}
      {tournaments.length > 0 && (
        <Card style={{ marginBottom: 12 }}>
          <Text style={st.exportTitle}>PLAYER LIST EXPORT</Text>
          <Text style={st.sub}>Pending and approved paid registrations · names and game UIDs as CSV (rejected/refunded entries excluded)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 10 }}>
            {exportTournaments.map((t) => (
              <Chip
                key={t.id}
                testID={`admin-registration-export-tournament-${t.id}`}
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
      <Msg kind="err" text={err} accessibilityLabel={err || undefined} accessibilityLiveRegion="assertive" />
      <Msg kind="ok" text={okMsg} />
      {all === null ? <Loading /> : err && all.length === 0 ? null : list.length === 0 ? <Empty text={`No ${tab} registrations.`} /> : list.map((r) => {
        const uid = String(r.gameUid || r.captainGameUid || '').trim();
        return (
          <Card key={r.id} style={{ marginBottom: 10 }}>
            <Text style={st.pName}>{r.playerName}{r.teamName ? ` — ${r.teamName}` : ''}</Text>
            <View style={st.uidRow}>
              <Text style={[st.sub, st.uidText]} numberOfLines={2}>
                In-game name: {r.captainGameName || '—'} · UID: {uid || '—'}
              </Text>
              {uid ? (
                <CopyUidButton
                  uid={uid}
                  testID={`admin-registration-copy-uid-${r.id}`}
                  onCopied={() => toast('UID Copied!', 'success')}
                  onCopyFailed={() => toast('Could not copy UID. Please try again.', 'error')}
                />
              ) : null}
            </View>
            <Text style={st.sub}>{r.tournamentName || r.tournamentId} • {r.mode || ''} {r.teamType || ''}</Text>
            {r.teamNumber && r.slotNumber ? (
              <Text style={st.sub}>
                Team {String(r.teamNumber).padStart(2, '0')} · Slot {r.slotNumber}{r.isSquadCaptain ? ' · Captain' : ''}
              </Text>
            ) : null}
            <Text style={st.sub}>Entry: {r.entryCoins} • {new Date(r.createdAt).toLocaleString()}</Text>
            {tab === 'removed' ? (
              <Text style={st.sub}>Removed by the captain; the entry fee was not refunded.</Text>
            ) : null}
            {r.teamMembers && r.teamMembers !== '[]' && (
              <Text style={st.sub}>ROSTER{'\n'}{rosterText(r.teamMembers)}</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              {tab === 'pending' && (
                <>
                  <View style={{ flex: 1 }}><Btn title="APPROVE" small loading={busyId === r.id} disabled={busyId !== null} accessibilityLabel={`Approve registration for ${r.playerName}`} accessibilityHint="If an error is announced, check this registration's status before trying again." onPress={() => act(r.id, 'approve', r.playerName)} /></View>
                  <View style={{ flex: 1 }}><Btn title="REJECT" small kind="danger" loading={busyId === r.id} disabled={busyId !== null} accessibilityLabel={`Reject registration for ${r.playerName}`} accessibilityHint="If an error is announced, check this registration's status before trying again." onPress={() => act(r.id, 'reject', r.playerName)} /></View>
                </>
              )}
              {tab !== 'pending' && tab !== 'removed' && (
                <View style={{ flex: 1 }}><Btn title="DELETE" small kind="danger" loading={busyId === r.id} disabled={busyId !== null} accessibilityLabel={`Delete registration for ${r.playerName}`} accessibilityHint="If an error is announced, check this registration's status before trying again." onPress={() => del(r.id, r.playerName)} /></View>
              )}
            </View>
          </Card>
        );
      })}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 30 },
  h: { color: C.text, fontSize: 20, fontWeight: '900', marginBottom: 10, letterSpacing: 0.7, fontFamily: 'Inter_700Bold' },
  pName: { color: C.text, fontWeight: '900', fontSize: 14 },
  exportTitle: { color: C.neon, fontWeight: '900', fontSize: 13, letterSpacing: 1 },
  sub: { color: C.sub, fontSize: 11, marginTop: 3 },
  uidRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  uidText: { flex: 1, flexShrink: 1, marginTop: 0 },
});
