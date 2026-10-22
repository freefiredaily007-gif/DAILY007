import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { AdminRegistration, Api, apiError, Tournament } from '../lib/api';
import { Btn, Card, C, Empty, Loading, Msg } from '../components/ui';
import { CopyUidButton } from '../components/CopyUidButton';
import { useToast } from '../components/adminKit';
import {
  buildAdminRegistrationTournamentCards,
  formatAdminRegistrationTime,
} from '../lib/adminApprovedRegistrationMatches';
import { getTournamentLifecycleState } from '../lib/tournamentLifecycle';

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

  const registrationSlotLabel = (registration: AdminRegistration): string => {
    if (registration.teamNumber != null && registration.slotNumber != null) {
      return `Team ${String(registration.teamNumber).padStart(2, '0')} · Slot ${registration.slotNumber}${registration.isSquadCaptain ? ' · Captain' : ''}`;
    }
    if (registration.assignedGroupNumber != null) {
      return `Player Slot ${registration.assignedGroupNumber}`;
    }
    if (registration.slotNumber != null) return `Slot ${registration.slotNumber}`;
    return 'Slot: Not assigned';
  };

  const renderRegistrationCard = (registration: AdminRegistration) => {
    const playerName = registration.playerName || registration.userName || 'Player';
    const inGameName = registration.captainGameName?.trim() || '—';
    const uid = String(registration.gameUid || registration.captainGameUid || '').trim();
    return (
      <Card key={registration.id} style={st.playerCard} testID={`admin-approved-player-${registration.id}`}>
        <Text style={st.pName}>{playerName}{registration.teamName ? ` · ${registration.teamName}` : ''}</Text>
        <Text style={st.sub}>In-Game Name: {inGameName}</Text>
        <View style={st.uidRow}>
          <Text style={[st.sub, st.uidText]} numberOfLines={2}>UID: {uid || '—'}</Text>
          {uid ? (
            <CopyUidButton
              uid={uid}
              testID={`admin-registration-copy-uid-${registration.id}`}
              onCopied={() => toast('UID Copied!', 'success')}
              onCopyFailed={() => toast('Could not copy UID. Please try again.', 'error')}
            />
          ) : null}
        </View>
        <Text style={st.sub}>{registrationSlotLabel(registration)}</Text>
        <Text style={st.sub}>Registration Time: {formatAdminRegistrationTime(registration.createdAt)}</Text>
        {registration.teamMembers && registration.teamMembers !== '[]' ? (
          <Text style={st.sub}>ROSTER{'\n'}{rosterText(registration.teamMembers)}</Text>
        ) : null}
        <View style={st.deleteAction}>
          <Btn
            title="DELETE"
            small
            kind="danger"
            loading={busyId === registration.id}
            disabled={busyId !== null}
            accessibilityLabel={`Delete registration for ${playerName}`}
            accessibilityHint="Removes this registration from the approved player list."
            testID={`admin-approved-player-delete-${registration.id}`}
            onPress={() => del(registration.id, playerName)}
          />
        </View>
      </Card>
    );
  };

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
            {selectedPlayers.length === 0
              ? <Empty text="No approved players for this tournament." />
              : selectedPlayers.map(renderRegistrationCard)}
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
  playerCard: { marginBottom: 10, padding: 14 },
  pName: { color: C.text, fontWeight: '900', fontSize: 14 },
  sub: { color: C.sub, fontSize: 11, lineHeight: 16, marginTop: 4 },
  uidRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  uidText: { flex: 1, flexShrink: 1, marginTop: 0 },
  deleteAction: { marginTop: 10, alignItems: 'stretch' },
});
