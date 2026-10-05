import React, { useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { Redirect } from 'expo-router';
import type { User } from '../lib/api';
import { joinWithCapacityRefresh } from '../lib/tournamentJoinRecovery';
import { Btn, C, Card } from '../components/ui';
import { ReadableText as Text } from '../components/typography';
import JoinForm from './JoinForm';

type Scenario = 'insufficient-balance' | 'last-slot';

const FIXTURE_USER: User = {
  id: 'native-join-fixture-user',
  name: 'Native Test Player',
  email: 'native-join-fixture@daily007.test',
};

function fixtureTournament(scenario: Scenario) {
  const lastSlot = scenario === 'last-slot';
  const filledSlots = lastSlot ? 11 : 4;
  return {
    id: `native-join-fixture-${scenario}`,
    name: 'Native join recovery fixture',
    mode: 'Battle Royale',
    gameMode: 'Battle Royale',
    teamType: 'Solo',
    teamSize: 1,
    slotUnit: 'player' as const,
    totalSlots: 12,
    totalPlayerSlots: 12,
    filledSlots,
    filledPlayerSlots: filledSlots,
    availableSlots: 12 - filledSlots,
    entryCoins: 75,
    prizePool: 0,
    date: '2099-01-01',
    time: '12:00',
    startsAt: '2099-01-01T12:00:00.000Z',
    enabled: true,
    status: 'open',
  };
}

function rejection(status: number, code: string, message: string) {
  return Object.assign(new Error(message), {
    response: { status, data: { code, error: message } },
  });
}

export default function JoinRecoveryNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;

  return <NativeJoinRecoveryFixture />;
}

function NativeJoinRecoveryFixture() {
  const [scenario, setScenario] = useState<Scenario>('insufficient-balance');
  const [runKey, setRunKey] = useState(0);
  const [tournament, setTournament] = useState(() => fixtureTournament('insufficient-balance'));
  const [attempts, setAttempts] = useState(0);
  const [confirmation, setConfirmation] = useState('');
  const otherPlayerFilledLastSlot = useRef(false);

  const selectScenario = (nextScenario: Scenario) => {
    setScenario(nextScenario);
    setTournament(fixtureTournament(nextScenario));
    setAttempts(0);
    setConfirmation('');
    otherPlayerFilledLastSlot.current = false;
    setRunKey((current) => current + 1);
  };

  const submitFixtureJoin = async () => {
    setAttempts((current) => current + 1);
    setConfirmation('');

    const result = await joinWithCapacityRefresh(
      async () => {
        if (scenario === 'insufficient-balance') {
          throw rejection(
            409,
            'INSUFFICIENT_WALLET_BALANCE',
            'Insufficient wallet balance: this entry costs 75 coins.',
          );
        }

        // Simulate another test account taking the final slot just before this
        // fixture request reaches the server. Nothing is written to a database.
        otherPlayerFilledLastSlot.current = true;
        throw rejection(
          409,
          'MATCH_FULL',
          'This match is already full and is not accepting registrations.',
        );
      },
      tournament.id,
      async () => {
        if (!otherPlayerFilledLastSlot.current) {
          throw new Error('The local last-slot fixture was not claimed.');
        }
        return {
          ...tournament,
          status: 'full',
          enabled: false,
          filledSlots: tournament.totalSlots,
          filledPlayerSlots: tournament.totalPlayerSlots,
          availableSlots: 0,
        };
      },
      setTournament,
    );

    if ((result as any)?.success !== true) {
      throw new Error('The local fixture unexpectedly returned without a confirmed join.');
    }
    setConfirmation('Registration confirmed — unexpected fixture success.');
    Alert.alert('Registration confirmed', 'The rejection fixture unexpectedly succeeded.');
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Card style={{ margin: 12, marginBottom: 0 }}>
        <Text
          testID="join-recovery-fixture-banner"
          accessibilityRole="text"
          style={{ color: C.gold, fontWeight: '900' }}
        >
          DEVELOPMENT FIXTURE · LOCAL RESPONSES ONLY · NO NETWORK OR WALLET WRITES
        </Text>
        <Text style={{ color: C.sub, marginTop: 6 }}>
          The last-slot case starts with one open place; a second fixture account claims it during submission.
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Btn
            title="INSUFFICIENT BALANCE"
            small
            testID="join-recovery-scenario-insufficient-balance"
            accessibilityState={{ selected: scenario === 'insufficient-balance' }}
            onPress={() => selectScenario('insufficient-balance')}
            style={{ flex: 1 }}
          />
          <Btn
            title="LAST SLOT TAKEN"
            small
            testID="join-recovery-scenario-last-slot"
            accessibilityState={{ selected: scenario === 'last-slot' }}
            onPress={() => selectScenario('last-slot')}
            style={{ flex: 1 }}
          />
        </View>
        <Text
          testID="join-recovery-attempt-count"
          accessibilityRole="text"
          style={{ color: C.sub, marginTop: 8 }}
        >
          Submit attempts: {attempts}
        </Text>
        {!!confirmation && (
          <Text
            testID="join-recovery-confirmation"
            accessibilityRole="text"
            style={{ color: C.green, marginTop: 8 }}
          >
            {confirmation}
          </Text>
        )}
      </Card>
      <JoinForm
        key={`${scenario}-${runKey}`}
        tournament={tournament}
        user={FIXTURE_USER}
        onCancel={() => {}}
        onSubmit={submitFixtureJoin}
      />
    </View>
  );
}
