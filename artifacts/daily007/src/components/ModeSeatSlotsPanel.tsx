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
  onJoinSlot,
}: {
  layout: TournamentSeatLayout;
  participants: SeatParticipant[];
  loading: boolean;
  unavailable: boolean;
  canSelect: boolean;
  tournamentId: string;
  onRetry: () => void;
  onJoinSlot: (groupNumber: number, slotNumber: number) => void;
}) {
  const [selectedSeat, setSelectedSeat] = useState<{ groupNumber: number; slotIndex: number } | null>(null);
  const [hoveredSeat, setHoveredSeat] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const compactLargeText = width <= 400 && PixelRatio.getFontScale() >= 1.5;
  const individualGridBasis = '23%';
  const individualGridSeatStyle = {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: individualGridBasis,
    width: individualGridBasis,
    maxWidth: individualGridBasis,
  } as const;
  const participantsByGroup = useMemo(
    () => new Map(participants
      .filter((participant) => participant.groupNumber !== null)
      .map((participant) => [participant.groupNumber as number, participant])),
    [participants],
  );
  const occupiedGroupCount = participantsByGroup.size;
  const totalPlayers = layout.groupCount * layout.slotsPerGroup;
  const joinedPlayers = participants.reduce(
    (total, participant) => total + (participant.groupNumber === null
      ? participant.players.length
      : participant.players.filter((name) => Boolean(name?.trim())).length),
    0,
  );

  const renderSeat = (
    groupNumber: number,
    slotIndex: number,
    participant: SeatParticipant | undefined,
    individual: boolean,
  ) => {
    const playerName = participant?.players?.[slotIndex]?.trim();
    const occupied = Boolean(playerName);
    const seatKey = `${groupNumber}-${slotIndex + 1}`;
    const selected = !occupied &&
      canSelect &&
      selectedSeat?.groupNumber === groupNumber &&
      selectedSeat.slotIndex === slotIndex;
    const hovered = !occupied && canSelect && hoveredSeat === seatKey;
    const label = individual
      ? `PLAYER ${layout.directDuel ? groupNumber : String(groupNumber).padStart(2, '0')}`
      : slotIndex === 0
        ? 'CAPTAIN'
        : `PLAYER ${String(slotIndex + 1).padStart(2, '0')}`;
    const statusText = occupied ? playerName : 'OPEN • SELECT';
    return (
      <View
        key={seatKey}
        style={[
          styles.seatCard,
            individual && (layout.directDuel ? styles.duelSeatCard : individualGridSeatStyle),
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${individual ? label : `Team ${String(groupNumber).padStart(2, '0')}, ${label}`}, ${occupied ? playerName || 'joined' : 'open'}${canSelect && !occupied ? ', select this seat' : ''}`}
          accessibilityHint={!occupied && canSelect ? 'Selects this seat and shows its Join button below.' : undefined}
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
            if (!occupied && canSelect) setSelectedSeat({ groupNumber, slotIndex });
          }}
          style={[
            styles.slot,
            individual && styles.individualSlot,
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
            style={[
              styles.slotLabel,
              individual && !layout.directDuel && styles.individualGridLabel,
              occupied ? styles.occupiedText : styles.openText,
            ]}
            maxFontSizeMultiplier={compactLargeText ? 1.5 : undefined}
          >
            {label}
          </Text>
          <Text
            numberOfLines={2}
            style={[
              styles.slotStatus,
              individual && !layout.directDuel && styles.individualGridStatus,
              occupied ? styles.occupiedText : styles.openText,
            ]}
            maxFontSizeMultiplier={compactLargeText ? 1.5 : undefined}
          >
            {statusText}
          </Text>
        </Pressable>
        <View style={[styles.slotActionArea, compactLargeText && styles.slotActionAreaCompact]}>
          {selected ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={individual
                ? `Join player slot ${groupNumber}`
                : `Join player ${slotIndex + 1} in Team ${String(groupNumber).padStart(2, '0')}`}
              accessibilityHint={individual
                ? 'Opens the player details and entry-fee form for this player slot.'
                : 'Opens the player details and entry-fee form for your selected player slot.'}
              onPress={() => onJoinSlot(groupNumber, slotIndex + 1)}
              testID={`mode-seat-join-${groupNumber}-${slotIndex + 1}`}
              style={[
                styles.inlineJoinButton,
                individual && !layout.directDuel && styles.inlineJoinButtonGrid,
                compactLargeText && styles.inlineJoinButtonCompact,
              ]}
            >
              <Text
                style={[
                  styles.inlineJoinButtonText,
                  individual && !layout.directDuel && styles.inlineJoinButtonTextGrid,
                ]}
                maxFontSizeMultiplier={compactLargeText ? 1.5 : undefined}
              >
                {individual
                  ? <>JOIN PLAYER {String(groupNumber).padStart(2, '0')}</>
                  : layout.slotsPerGroup >= 4
                    ? <>JOIN{"\n"}PLAYER{"\n"}{String(slotIndex + 1).padStart(2, '0')}</>
                    : <>JOIN{"\n"}PLAYER {slotIndex + 1}</>}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.slotActionSpacer} />
          )}
        </View>
      </View>
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
      </View>
    );
  }

  return (
    <View>
      <Card style={styles.summaryCard}>
        <Text style={styles.capacity}>{summary}</Text>
        <Text style={styles.info}>
          Select your own open player slot. Each player registers and pays their entry fee individually.
        </Text>
      </Card>
      {Array.from({ length: layout.groupCount }, (_, index) => {
        const groupNumber = index + 1;
        const participant = participantsByGroup.get(groupNumber);
        const joinedCount = participant?.players?.filter((name) => Boolean(name?.trim())).length ?? 0;
        return (
          <Card key={groupNumber} style={styles.teamCard} testID={`mode-seat-team-${groupNumber}`}>
            <View style={styles.teamHeader}>
              <View style={styles.teamTitleRow}>
                <Text style={styles.teamHeading}>TEAM</Text>
                <Text style={styles.teamNumber}>{String(groupNumber).padStart(2, '0')}</Text>
              </View>
              <View style={styles.joinedBadge}>
                <Text style={styles.joinedText}>
                  {joinedCount}/${layout.slotsPerGroup} JOINED
                </Text>
              </View>
            </View>
            <View style={styles.teamSlots} testID={`mode-seat-team-row-${groupNumber}`}>
              {Array.from({ length: layout.slotsPerGroup }, (_, slotIndex) =>
                renderSeat(groupNumber, slotIndex, participant, false),
              )}
            </View>
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
  seatCard: { flex: 1, minWidth: 0 },
  duelSeatCard: { flex: 1, minWidth: 0 },
  individualSlot: { flexGrow: 0, flexShrink: 0, width: '100%', height: 84, minHeight: 84 },
  individualGridSlot: {
    height: 84, minHeight: 84, paddingHorizontal: 3, paddingVertical: 8,
    justifyContent: 'center', gap: 5,
  },
  individualGridLabel: { fontSize: 10, letterSpacing: 0.1 },
  individualGridStatus: { fontSize: 8, lineHeight: 10, marginTop: 0 },
  inlineJoinButtonGrid: { minHeight: 36, paddingVertical: 4 },
  inlineJoinButtonTextGrid: { fontSize: 8, lineHeight: 10 },
  slotActionArea: { height: 38, width: '100%', marginTop: 4 },
  slotActionAreaCompact: { height: 68 },
  slotActionSpacer: { flex: 1 },
  inlineJoinButton: {
    minHeight: 34, width: '100%', alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.squadAccent, borderRadius: 8, paddingHorizontal: 1, paddingVertical: 3,
  },
  inlineJoinButtonCompact: { minHeight: 62, paddingVertical: 4 },
  inlineJoinButtonText: {
    color: C.squadPanel, fontSize: 8, fontWeight: '900', textAlign: 'center', lineHeight: 9,
  },
  slot: {
    flex: 1, minWidth: 0, height: 76, borderWidth: 1, borderColor: C.squadBorder,
    borderRadius: 12, backgroundColor: C.squadTile, paddingHorizontal: 3, paddingVertical: 7,
    alignItems: 'center', justifyContent: 'space-between',
  },
  individualGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-start' },
  duelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  versus: { alignSelf: 'center', color: C.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  open: { borderColor: '#2ecc71', backgroundColor: 'rgba(46, 204, 113, 0.12)' },
  occupied: { borderColor: '#e74c3c', backgroundColor: 'rgba(231, 76, 60, 0.14)' },
  selected: { borderWidth: 2, backgroundColor: 'rgba(46, 204, 113, 0.24)' },
  hovered: { borderColor: '#58e68b', backgroundColor: 'rgba(46, 204, 113, 0.24)' },
  slotCompact: { height: 90 },
  slotLabel: { fontSize: 9, fontWeight: '900', textAlign: 'center' },
  slotStatus: { fontSize: 8, fontWeight: '900', marginTop: 2, textAlign: 'center', lineHeight: 10, width: '100%' },
  openText: { color: '#2ecc71' },
  occupiedText: { color: '#e74c3c' },
});
