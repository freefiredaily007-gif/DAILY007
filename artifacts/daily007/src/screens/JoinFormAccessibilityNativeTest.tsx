import React, { useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import type { User } from '../lib/api';
import { Btn, C, Card } from '../components/ui';
import { ReadableText as Text } from '../components/typography';
import JoinForm from './JoinForm';

type TeamType = 'Solo' | 'Duo' | 'Trio' | 'Squad';

const TEAM_TYPES: TeamType[] = ['Solo', 'Duo', 'Trio', 'Squad'];
const FIXTURE_USER: User = {
  id: 'native-join-label-fixture-user',
  name: 'Native Label Player',
  email: 'native-join-label@daily007.test',
};

function fixtureTournament(teamType: TeamType) {
  const teamSize = teamType === 'Squad' ? 4 : teamType === 'Trio' ? 3 : teamType === 'Duo' ? 2 : 1;
  const isBattleRoyale = teamType !== 'Trio';
  return {
    id: `native-join-label-${teamType.toLowerCase()}`,
    name: `${teamType} registration label fixture`,
    mode: isBattleRoyale ? 'Battle Royale' : 'Clash Squad',
    gameMode: isBattleRoyale ? 'battle_royale' : 'clash_squad',
    teamType,
    teamSize,
    slotUnit: 'team',
    totalSlots: isBattleRoyale ? (teamSize === 1 ? 48 : teamSize === 2 ? 24 : 12) : 2,
    totalPlayerSlots: isBattleRoyale ? 48 : 2 * teamSize,
    filledSlots: 0,
    filledPlayerSlots: 0,
    availableSlots: 12,
    entryCoins: 0,
    prizePool: 0,
    startsAt: '2099-01-01T12:00:00.000Z',
    enabled: true,
    status: 'open',
  };
}

export default function JoinFormAccessibilityNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;

  return <JoinFormAccessibilityFixture />;
}

function JoinFormAccessibilityFixture() {
  const [teamType, setTeamType] = useState<TeamType>('Solo');

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Card style={{ margin: 12, marginBottom: 0 }}>
        <Text
          testID="join-form-accessibility-fixture"
          accessibilityRole="text"
          style={{ color: C.gold, fontWeight: '900' }}
        >
          DEVELOPMENT FIXTURE · LOCAL DATA ONLY
        </Text>
        <Text style={{ color: C.sub, marginTop: 6 }}>
          Native accessibility labels for Solo, Duo, Trio, and Squad registration forms.
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          {TEAM_TYPES.map((type) => (
            <Btn
              key={type}
              title={type.toUpperCase()}
              small
              testID={`join-form-accessibility-select-${type.toLowerCase()}`}
              accessibilityState={{ selected: teamType === type }}
              onPress={() => setTeamType(type)}
              style={{ flex: 1 }}
            />
          ))}
        </View>
        <Text
          testID="join-form-accessibility-current-format"
          accessibilityRole="text"
          style={{ color: C.sub, marginTop: 8 }}
        >
          Current format: {teamType}
        </Text>
      </Card>
      <JoinForm
        key={teamType}
        tournament={fixtureTournament(teamType)}
        user={FIXTURE_USER}
        seatGroupNumber={1}
        seatSlotNumber={teamType === 'Solo' ? undefined : 2}
        onCancel={() => {}}
        onSubmit={async () => {}}
      />
    </View>
  );
}
