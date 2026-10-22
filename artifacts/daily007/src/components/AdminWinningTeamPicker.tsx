import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ReadableText as Text } from './typography';
import { C } from './ui';
import {
  groupApprovedRegistrationsByTeam,
  type AdminWinningTeam,
} from '../lib/adminWinningTeams';
import type { AdminRegistration } from '../lib/api';

export function AdminWinningTeamPicker({
  registrations,
  selectedTeamNumber,
  onSelect,
  testIdPrefix,
  disabledTeamNumbers = [],
}: {
  registrations: AdminRegistration[];
  selectedTeamNumber: number | null;
  onSelect: (team: AdminWinningTeam) => void;
  testIdPrefix: string;
  disabledTeamNumbers?: number[];
}) {
  const teams = groupApprovedRegistrationsByTeam(registrations);

  return (
    <View>
      <Text style={st.heading}>SELECT WINNING TEAM</Text>
      {teams.length === 0 ? (
        <Text style={st.empty}>No approved team assignments are available for this tournament.</Text>
      ) : teams.map((team) => {
        const selected = selectedTeamNumber === team.teamNumber;
        const disabled = disabledTeamNumbers.includes(team.teamNumber);
        const teamLabel = `TEAM ${String(team.teamNumber).padStart(2, '0')}`;
        const names = team.registrations.map((registration) => registration.playerName).join(', ');
        return (
          <Pressable
            key={team.teamNumber}
            accessibilityRole="radio"
            accessibilityLabel={`${selected ? 'Selected' : 'Select'} ${teamLabel} with ${team.registrations.length} approved players: ${names}${disabled ? '. A result is already published for a player on this team' : ''}`}
            accessibilityHint={disabled ? 'A player on this team already has a published result.' : 'Selects this team as the tournament winner.'}
            accessibilityState={{ checked: selected, disabled }}
            testID={`${testIdPrefix}-winning-team-${team.teamNumber}`}
            onPress={() => { if (!disabled) onSelect(team); }}
            style={({ pressed }) => [
              st.team,
              selected && st.selectedTeam,
              disabled && st.disabledTeam,
              pressed && st.pressed,
            ]}
          >
            <View style={st.teamHeader}>
              <Text style={[st.teamName, selected && st.selectedText]}>{teamLabel}</Text>
              <Text style={st.count}>
                {disabled ? 'PLACEMENT PUBLISHED' : `${team.registrations.length} APPROVED`}
              </Text>
            </View>
            {team.registrations.map((registration) => (
              <View key={registration.id} style={st.member}>
                <Text style={st.playerName}>{registration.playerName}</Text>
                <Text style={st.uid}>UID {registration.gameUid || '—'}</Text>
              </View>
            ))}
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  heading: {
    color: C.sub,
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: '900',
    marginBottom: 6,
  },
  empty: {
    color: C.sub,
    fontSize: 12,
    fontWeight: '700',
    paddingVertical: 10,
  },
  team: {
    backgroundColor: C.bg2,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
    marginBottom: 8,
  },
  selectedTeam: {
    borderColor: C.neon,
    backgroundColor: `${C.neon}14`,
  },
  pressed: {
    opacity: 0.82,
  },
  disabledTeam: {
    opacity: 0.55,
  },
  teamHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  teamName: {
    color: C.text,
    fontSize: 13,
    fontWeight: '900',
  },
  selectedText: {
    color: C.neon,
  },
  count: {
    color: C.sub,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  member: {
    borderTopColor: `${C.border}99`,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  playerName: {
    color: C.text,
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
  },
  uid: {
    color: C.sub,
    fontSize: 10,
    fontWeight: '700',
  },
});
