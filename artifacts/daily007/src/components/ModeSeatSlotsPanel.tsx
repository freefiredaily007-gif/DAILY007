import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions, PixelRatio } from 'react-native';
import { ReadableText as Text } from './typography';
import { Btn, C, Card } from './ui';
import type { TournamentSeatLayout } from '../lib/tournamentSeatLayout';

type SeatParticipant = {
  groupNumber: number | null;
  teamName: string | null;
  players: string[];
  status: 'approved' | 'pending';
};

export function ModeSeatSlotsPanel({
  layout,
  participants,
  loading,
  unavailable,
  canSelect,
  tournamentId,
  onRetry,
  onJoinGroup,
}: {
  layout: TournamentSeatLayout;
  participants: SeatParticipant[];
  loading: boolean;
  unavailable: boolean;
  canSelect: boolean;
  tournamentId: string;
  onRetry: () => void;
  onJoinGroup: (groupNumber: number) => void;
}) {
  const [selectedGroupNumber, setSelectedGroupNumber] = useState<number | null>(null);
  const [hoveredSeat, setHoveredSeat] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const compactLargeText = width <= 400 && PixelRatio.getFontScale() >= 1.5;
  const participantsByGroup = useMemo(
    () => new Map(participants
      .filter((participant) => participant.groupNumber !== null)
      .map((participant) => [participant.groupNumber as number, participant])),
    [participants],
  );
  const occupiedGroupCount = participantsByGroup.size;
  const totalPlayers = layout.groupCount * layout.slotsPerGroup;
  const joinedPlayers = participants.reduce(
    (total, participant) => total + (participant.groupNumber === null ? 0 : layout.slotsPerGroup),
    0,
  );

  const renderSeat = (
    groupNumber: number,
    slotIndex: number,
    participant: SeatParticipant | undefined,
    individual: boolean,
  ) => {
    const occupied = Boolean(participant);
    const seatKey = `${groupNumber}-${slotIndex + 1}`;
    const selected = !occupied && canSelect && selectedGroupNumber === groupNumber;
    const hovered = !occupied && canSelect && hoveredSeat === seatKey;
    const label = individual
      ? `PLAYER ${layout.directDuel ? groupNumber : String(groupNumber).padStart(2, '0')}`
      : slotIndex === 0
        ? 'CAPTAIN'
        : `PLAYER ${String(slotIndex + 1).padStart(2, '0')}`;
    const playerName = participant?.players?.[slotIndex]?.trim();
    const statusText = occupied ? playerName || 'TEAM BOOKED' : 'OPEN • SELECT';
    return (
      <Pressable
        key={seatKey}
        accessibilityRole="button"
        accessibilityLabel={`${individual ? label : `Team ${String(groupNumber).padStart(2, '0')}, ${label}`}, ${occupied ? playerName || 'joined' : 'open'}${canSelect && !occupied ? ', select this seat' : ''}`}
        accessibilityState={{
          disabled: occupied || !canSelect,
          selected,
        }}
        disabled={occupied || !canSelect}
        testID={`mode-seat-${tournamentId}-${groupNumber}-${slotIndex + 1}`}
        onHoverIn={() => {
          if (!occupied && canSelect) setHoveredSeat(seatKey);
        }}
        onHoverOut={() => setHoveredSeat((current) => current === seatKey ? null : current)}
        onPress={() => {
          if (!occupied && canSelect) setSelectedGroupNumber(groupNumber);
        }}
        style={[
          styles.slot,
          individual && !layout.directDuel && styles.individualGridSlot,
          occupied ? styles.occupied : styles.open,
          selected && styles.selected,
          hovered && styles.hovered,
          compactLargeText && styles.slotCompact,
          Platform.OS === 'web'
            ? { cursor: !occupied && canSelect ? 'pointer' : 'not-allowed' } as never
            : undefined,
        ]}
      >
        <Text
          numberOfLines={2}
          style={[styles.slotLabel, occupied ? styles.occupiedText : styles.openText]}
          maxFontSizeMultiplier={compactLargeText ? 1.5 : undefined}
        >
          {label}
        </Text>
        <Text
          numberOfLines={2}
          style={[
            styles.slotStatus,
            occupied ? styles.occupiedText : styles.openText,
          ]}
          maxFontSizeMultiplier={compactLargeText ? 1.5 : undefined}
        >
          {statusText}
        </Text>
      </Pressable>
    );
  };

  if (unavailable) {
    return (
      <Card>
        <Text style={styles.info}>Seat availability couldn’t be loaded. Refresh the participant list before choosing a seat.</Text>
        <Btn
          title="RETRY SEAT AVAILABILITY"
          kind="ghost"
          onPress={onRetry}
          loading={loading}
          style={{ marginTop: 10, minHeight: 44 }}
          testID="mode-seat-retry"
        />
      </Card>
    );
  }

  if (loading && participants.length === 0) {
    return (
      <Card>
        <Text style={styles.info}>Loading seat availability…</Text>
      </Card>
    );
  }

  const summary = layout.groupKind === 'team'
    ? `${occupiedGroupCount}/${layout.groupCount} TEAMS · ${joinedPlayers}/${totalPlayers} PLAYERS`
    : `${occupiedGroupCount}/${layout.groupCount} PLAYERS`;

  if (layout.groupKind === 'player') {
    const slots = Array.from({ length: layout.groupCount }, (_, index) => {
      const groupNumber = index + 1;
      return renderSeat(groupNumber, 0, participantsByGroup.get(groupNumber), true);
    });
    const selectedGroup = selectedGroupNumber === null
      ? null
      : participantsByGroup.has(selectedGroupNumber) ? null : selectedGroupNumber;
    return (
      <View>
        <Card style={styles.summaryCard}>
          <Text style={styles.capacity}>{summary}</Text>
          {layout.directDuel ? (
            <Text style={styles.info}>Player 1 and Player 2 are individual seats. No team registration is used.</Text>
          ) : null}
        </Card>
        {layout.directDuel ? (
          <View style={styles.duelRow} testID="mode-seat-duel-row">
            {slots[0]}
            <Text style={styles.versus}>VS</Text>
            {slots[1]}
          </View>
        ) : (
          <View style={styles.individualGrid} testID="mode-seat-player-grid">
            {slots}
          </View>
        )}
        {selectedGroup !== null && canSelect ? (
          <Btn
            title={`JOIN PLAYER ${String(selectedGroup).padStart(2, '0')}`}
            onPress={() => onJoinGroup(selectedGroup)}
            style={styles.joinButton}
            testID={`mode-seat-join-${selectedGroup}`}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View>
      <Card style={styles.summaryCard}>
        <Text style={styles.capacity}>{summary}</Text>
        <Text style={styles.info}>
          Select an open team. The existing team registration fills all {layout.slotsPerGroup} player slots in that team.
        </Text>
      </Card>
      {Array.from({ length: layout.groupCount }, (_, index) => {
        const groupNumber = index + 1;
        const participant = participantsByGroup.get(groupNumber);
        const occupied = Boolean(participant);
        const isSelected = selectedGroupNumber === groupNumber && !occupied && canSelect;
        return (
          <Card key={groupNumber} style={styles.teamCard} testID={`mode-seat-team-${groupNumber}`}>
            <View style={styles.teamHeader}>
              <View style={styles.teamTitleRow}>
                <Text style={styles.teamHeading}>TEAM</Text>
                <Text style={styles.teamNumber}>{String(groupNumber).padStart(2, '0')}</Text>
              </View>
              <View style={styles.joinedBadge}>
                <Text style={styles.joinedText}>
                  {occupied ? `${layout.slotsPerGroup}/${layout.slotsPerGroup}` : `0/${layout.slotsPerGroup}`} JOINED
                </Text>
              </View>
            </View>
            <View style={styles.teamSlots} testID={`mode-seat-team-row-${groupNumber}`}>
              {Array.from({ length: layout.slotsPerGroup }, (_, slotIndex) =>
                renderSeat(groupNumber, slotIndex, participant, false),
              )}
            </View>
            {isSelected ? (
              <Btn
                title={`JOIN TEAM ${String(groupNumber).padStart(2, '0')}`}
                onPress={() => onJoinGroup(groupNumber)}
                style={styles.joinButton}
                testID={`mode-seat-join-${groupNumber}`}
              />
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  summaryCard: { marginBottom: 10, padding: 12 },
  capacity: { color: C.squadAccent, fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  info: { color: C.sub, fontSize: 11, fontWeight: '600', lineHeight: 16, marginTop: 5 },
  teamCard: {
    marginBottom: 10, padding: 12, backgroundColor: C.squadPanel,
    borderColor: C.squadBorder, borderWidth: 1, borderRadius: 16,
  },
  teamHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10, minHeight: 22,
  },
  teamTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, flexShrink: 1 },
  teamHeading: { color: C.sub, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  teamNumber: { color: C.squadAccent, fontSize: 15, fontWeight: '900', letterSpacing: 0.4 },
  joinedBadge: {
    backgroundColor: C.bg2, borderColor: C.squadBorder, borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 6,
  },
  joinedText: { color: C.sub, fontSize: 8, fontWeight: '900', letterSpacing: 0.3 },
  teamSlots: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  slot: {
    flex: 1, minWidth: 0, height: 76, borderWidth: 1, borderColor: C.squadBorder,
    borderRadius: 12, backgroundColor: C.squadTile, paddingHorizontal: 3, paddingVertical: 7,
    alignItems: 'center', justifyContent: 'space-between',
  },
  individualGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' },
  individualGridSlot: { flex: 0, flexBasis: '23%', maxWidth: '24%', minWidth: 0 },
  duelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  versus: { color: C.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  open: { borderColor: '#2ecc71', backgroundColor: 'rgba(46, 204, 113, 0.12)' },
  occupied: { borderColor: '#e74c3c', backgroundColor: 'rgba(231, 76, 60, 0.14)' },
  selected: { borderWidth: 2, backgroundColor: 'rgba(46, 204, 113, 0.24)' },
  hovered: { borderColor: '#58e68b', backgroundColor: 'rgba(46, 204, 113, 0.24)' },
  slotCompact: { height: 90 },
  slotLabel: { fontSize: 9, fontWeight: '900', textAlign: 'center' },
  slotStatus: { fontSize: 8, fontWeight: '900', marginTop: 2, textAlign: 'center', lineHeight: 10, width: '100%' },
  openText: { color: '#2ecc71' },
  occupiedText: { color: '#e74c3c' },
  joinButton: { minHeight: 44, marginTop: 10 },
});
