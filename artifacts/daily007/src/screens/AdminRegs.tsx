import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, View, ScrollView, StyleSheet, Pressable } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ReadableText as Text } from '../components/typography';
import { AdminRegistration, Api, apiError, Tournament } from '../lib/api';
import { Btn, Card, C, Empty, Loading, Msg } from '../components/ui';
import { CopyUidButton } from '../components/CopyUidButton';
import { useToast } from '../components/adminKit';
import { copyUidToClipboard } from '../lib/copyUidToClipboard';
import { buildAdminRegistrationTournamentCards } from '../lib/adminApprovedRegistrationMatches';
import { getTournamentLifecycleState } from '../lib/tournamentLifecycle';
import {
  collectAdminRegistrationUids,
  getAdminRegistrationPlayerName,
  getAdminRegistrationPlayerUid,
  groupAdminRegistrationsByTeam,
} from '../lib/adminRegistrationTeams';

const LIVE_REGISTRATION_REFRESH_INTERVAL_MS = 15_000;

export default function AdminRegs() {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [registrations, setRegistrations] = useState<AdminRegistration[] | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);
  const requestRevision = useRef(0);

  const load = useCallback(async () => {
    const revision = ++requestRevision.current;
    const [registrationRows, tournamentRows] = await Promise.all([
      Api.adminRegistrations(),
      Api.tournaments(true),
    ]);
    if (revision !== requestRevision.current) return;
    if (!Array.isArray(registrationRows) || !Array.isArray(tournamentRows)) {
      throw new Error('The registration or tournament list response was invalid.');
    }
    setRegistrations(registrationRows);
    setTournaments(tournamentRows);
    setInitialLoadFailed(false);
    setErr((current) => current.startsWith('Could not load approved registrations:') ||
      current.startsWith('Could not refresh registrations:')
      ? ''
      : current);
  }, []);
  useEffect(() => {
    setRegistrations(null);
    setTournaments(null);
    load().catch((e) => {
      setErr(`Could not load approved registrations: ${apiError(e)}`);
      setRegistrations([]);
      setTournaments([]);
      setInitialLoadFailed(true);
    });
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      void load().catch((e) => {
        setErr(`Could not refresh registrations: ${apiError(e)}`);
      });
    }, LIVE_REGISTRATION_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const tournamentCards = useMemo(
    () => buildAdminRegistrationTournamentCards(
      (tournaments ?? [])
        .flatMap((tournament) => {
          const lifecycle = getTournamentLifecycleState(tournament);
          return lifecycle === 'upcoming' || lifecycle === 'ongoing'
            ? [{ ...tournament, lifecycle }]
            : [];
        }),
      registrations ?? [],
    ),
    [registrations, tournaments],
  );
  const selectedTournament = tournamentCards.find((tournament) => tournament.id === selectedTournamentId) ?? null;
  const selectedPlayers = selectedTournament?.rows ?? [];
  const registrationTeams = useMemo(
    () => groupAdminRegistrationsByTeam(selectedPlayers),
    [selectedPlayers],
  );
  const allPlayerUids = useMemo(
    () => collectAdminRegistrationUids(selectedPlayers),
    [selectedPlayers],
  );

  const retryLoad = () => {
    setErr('');
    setRegistrations(null);
    setTournaments(null);
    load().catch((e) => {
      setErr(`Could not load approved registrations: ${apiError(e)}`);
      setRegistrations([]);
      setTournaments([]);
      setInitialLoadFailed(true);
    });
  };

  const copyUidList = async (rows: readonly AdminRegistration[], scope: string) => {
    const uids = collectAdminRegistrationUids(rows).join(', ');
    if (!uids) return;
    const copied = await copyUidToClipboard(uids, Clipboard.setStringAsync);
    toast(
      copied ? `${scope} UIDs Copied!` : `Could not copy ${scope.toLowerCase()} UIDs. Please try again.`,
      copied ? 'success' : 'error',
    );
  };

  const del = async (id: string, playerName: string) => {
    if (busyId) return;
    setErr(''); setOkMsg(''); setBusyId(id);
    try {
      await Api.adminDeleteRegistration(id);
      setOkMsg('Registration removed from the approved list.');
      setTimeout(() => setOkMsg(''), 2500);
      try { await load(); }
      catch (e: any) { setErr(`Could not refresh registrations: ${apiError(e)}`); }
    } catch (e: any) {
      setErr(
        `Could not remove the registration for ${playerName}: ${apiError(e)}. ` +
        `The registration remains in this list. Check its current status, then use DELETE for ${playerName} to retry.`,
      );
    }
    finally { setBusyId(null); }
  };

  const renderRegistrationPlayer = (registration: AdminRegistration) => {
    const playerName = getAdminRegistrationPlayerName(registration);
    const uid = getAdminRegistrationPlayerUid(registration);
    return (
      <View key={registration.id} style={st.playerRow} testID={`admin-approved-player-${registration.id}`}>
        <View style={st.playerInfo}>
          <Text style={st.pName} numberOfLines={2}>{playerName}</Text>
          <View style={st.uidRow}>
            <Text style={st.uidText} numberOfLines={2}>UID: {uid || '—'}</Text>
            {uid ? (
              <CopyUidButton
                uid={uid}
                testID={`admin-registration-copy-uid-${registration.id}`}
                onCopied={() => toast('UID Copied!', 'success')}
                onCopyFailed={() => toast('Could not copy UID. Please try again.', 'error')}
              />
            ) : null}
          </View>
        </View>
        <View style={st.deleteAction}>
          <Btn
            title="DELETE"
            small
            kind="danger"
            textColor={C.text}
            style={st.deleteButton}
            loading={busyId === registration.id}
            disabled={busyId !== null}
            accessibilityLabel={`Delete registration for ${playerName}`}
            accessibilityHint="Removes this registration from the approved player list."
            testID={`admin-approved-player-delete-${registration.id}`}
            onPress={() => del(registration.id, playerName)}
          />
        </View>
      </View>
    );
  };

  const renderRegistrationTeam = (team: ReturnType<typeof groupAdminRegistrationsByTeam>[number]) => (
    <Card key={team.key} style={st.teamCard} testID={`admin-approved-team-${team.key}`}>
      <View style={st.teamHeader}>
        <Text style={st.teamTitle}>{team.title}</Text>
        <Btn
          title="COPY TEAM UIDs"
          small
          kind="gold"
          textColor="#0B0F19"
          style={st.copyTeamButton}
          disabled={collectAdminRegistrationUids(team.registrations).length === 0}
          accessibilityLabel={`Copy all UIDs for ${team.title}`}
          accessibilityHint="Copies this team's approved player UIDs, separated by commas."
          testID={`admin-registration-copy-team-uids-${team.key}`}
          onPress={() => { void copyUidList(team.registrations, team.title); }}
        />
      </View>
      {team.registrations.map(renderRegistrationPlayer)}
    </Card>
  );

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <Text style={st.h}>REGISTRATIONS</Text>
      <Text style={st.pageSubtitle}>APPROVED PLAYERS · ACTIVE AND SCHEDULED TOURNAMENTS</Text>
      <Msg kind="err" text={err} accessibilityLabel={err || undefined} accessibilityLiveRegion="assertive" />
      <Msg kind="ok" text={okMsg} />
      {err && !initialLoadFailed && registrations !== null && tournaments !== null ? (
        <Btn title="RETRY REFRESH" small kind="ghost" onPress={retryLoad} accessibilityLabel="Retry refreshing registrations and tournaments" />
      ) : null}
      {registrations === null || tournaments === null ? (
        <Loading accessibilityLabel="Loading approved registrations and tournaments" />
      ) : initialLoadFailed ? (
        <Btn title="RETRY LOADING" onPress={retryLoad} accessibilityLabel="Retry loading tournaments and approved registrations" />
      ) : selectedTournamentId ? (
        selectedTournament ? (
          <View testID={`admin-approved-tournament-detail-${selectedTournament.id}`}>
            <Btn
              title="BACK TO TOURNAMENTS"
              small
              kind="ghost"
              testID="admin-approved-tournament-back"
              onPress={() => setSelectedTournamentId(null)}
            />
            <Card style={st.detailHeader}>
              <Text style={st.tournamentName}>{selectedTournament.tournamentName}</Text>
              <Text style={st.tournamentTime}>{selectedTournament.startLabel}</Text>
              <Text style={st.approvedCount}>
                {selectedTournament.totalPlayerSlots
                  ? `${selectedTournament.approvedPlayerCount}/${selectedTournament.totalPlayerSlots} APPROVED PLAYERS`
                  : `${selectedTournament.approvedPlayerCount} APPROVED PLAYERS`}
              </Text>
            </Card>
            <Btn
              title="COPY ALL UIDs"
              kind="gold"
              textColor="#0B0F19"
              style={st.copyAllButton}
              disabled={allPlayerUids.length === 0}
              accessibilityLabel={`Copy all approved player UIDs for ${selectedTournament.tournamentName}`}
              accessibilityHint="Copies this match's approved player UIDs, separated by commas."
              testID="admin-registration-copy-all-uids"
              onPress={() => { void copyUidList(selectedPlayers, 'All'); }}
            />
            {registrationTeams.length === 0
              ? <Empty text="No approved players for this tournament." />
              : registrationTeams.map(renderRegistrationTeam)}
          </View>
        ) : (
          <View>
            <Btn
              title="BACK TO TOURNAMENTS"
              small
              kind="ghost"
              testID="admin-approved-tournament-back"
              onPress={() => setSelectedTournamentId(null)}
            />
            <Empty text="This tournament is no longer active or scheduled." />
          </View>
        )
      ) : tournamentCards.length === 0 ? (
        <Empty text="No active or scheduled tournaments." />
      ) : (
        <>
          <Text style={st.sectionTitle}>ACTIVE / SCHEDULED TOURNAMENTS</Text>
          {tournamentCards.map((tournament) => (
            <Pressable
              key={tournament.id}
              accessible
              accessibilityRole="button"
              accessibilityLabel={`${tournament.tournamentName}, ${tournament.startLabel}, ${tournament.approvedPlayerCount} approved players`}
              accessibilityHint="Opens the approved player list for this tournament."
              testID={`admin-approved-tournament-${tournament.id}`}
              onPress={() => setSelectedTournamentId(tournament.id)}
              style={st.tournamentPressable}
            >
              <Card style={st.tournamentCard}>
                <View style={st.tournamentHeadingRow}>
                  <Text style={st.tournamentName}>{tournament.tournamentName}</Text>
                  <View style={[st.statusPill, tournament.lifecycle === 'ongoing' ? st.livePill : st.upcomingPill]}>
                    <Text style={[st.statusText, tournament.lifecycle === 'ongoing' ? st.liveText : st.upcomingText]}>
                      {tournament.lifecycle === 'ongoing' ? 'ONGOING' : 'UPCOMING'}
                    </Text>
                  </View>
                </View>
                <Text style={st.tournamentTime}>{tournament.startLabel}</Text>
                <Text style={st.approvedCount}>
                  {tournament.totalPlayerSlots
                    ? `${tournament.approvedPlayerCount}/${tournament.totalPlayerSlots} APPROVED PLAYERS`
                    : `${tournament.approvedPlayerCount} APPROVED PLAYERS`}
                </Text>
              </Card>
            </Pressable>
          ))}
        </>
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 30 },
  h: { color: C.text, fontSize: 20, fontWeight: '900', marginBottom: 3, letterSpacing: 0.7, fontFamily: 'Inter_700Bold' },
  pageSubtitle: { color: C.sub, fontSize: 11, fontWeight: '800', letterSpacing: 0.4, marginBottom: 14 },
  sectionTitle: { color: C.neon, fontSize: 13, fontWeight: '900', letterSpacing: 0.8, marginBottom: 10 },
  tournamentPressable: { marginBottom: 10 },
  tournamentCard: { minHeight: 100, padding: 14, borderColor: C.neon + '66' },
  tournamentHeadingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  tournamentName: { color: C.text, fontSize: 15, lineHeight: 21, fontWeight: '900', flex: 1 },
  tournamentTime: { color: C.sub, fontSize: 12, lineHeight: 17, fontWeight: '800', marginTop: 5 },
  statusPill: { minHeight: 28, borderRadius: 14, borderWidth: 1, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  upcomingPill: { borderColor: C.neon + '88', backgroundColor: C.neon + '18' },
  livePill: { borderColor: C.green + '88', backgroundColor: C.green + '18' },
  statusText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  upcomingText: { color: C.neon },
  liveText: { color: C.green },
  approvedCount: { color: C.green, fontSize: 11, fontWeight: '900', letterSpacing: 0.5, marginTop: 8 },
  detailHeader: { marginTop: 10, marginBottom: 10, padding: 14, borderColor: C.neon + '88' },
  copyAllButton: { alignSelf: 'stretch', minHeight: 46, marginBottom: 10 },
  teamCard: {
    marginBottom: 10,
    padding: 12,
    backgroundColor: '#0B0F19',
    borderColor: '#FFB80066',
  },
  teamHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  teamTitle: { color: '#FFB800', fontSize: 14, fontWeight: '900', letterSpacing: 0.8 },
  copyTeamButton: { minHeight: 44, borderColor: '#FFB800', backgroundColor: '#FFB800' },
  playerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#FFB80033',
  },
  playerInfo: { flex: 1, minWidth: 150 },
  pName: { color: C.text, fontWeight: '900', fontSize: 14 },
  uidRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 2 },
  uidText: { color: C.sub, fontSize: 11, lineHeight: 16, flex: 1, flexShrink: 1, minWidth: 120 },
  deleteAction: { alignItems: 'stretch' },
  deleteButton: { minWidth: 76, minHeight: 44, backgroundColor: '#FF3B3B', borderColor: '#FF3B3B' },
});
