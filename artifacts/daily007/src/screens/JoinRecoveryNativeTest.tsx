import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import type { User } from '../lib/api';
import { joinWithCapacityRefresh } from '../lib/tournamentJoinRecovery';
import { Btn, C, Card } from '../components/ui';
import { ReadableText as Text } from '../components/typography';
import JoinForm from './JoinForm';

type Scenario = 'insufficient-balance' | 'last-slot';
type FixtureJoinResponse = { success: boolean; status?: string };

const FIXTURE_USER: User = {
  id: 'native-join-fixture-user',
  name: 'Native Test Player',
  email: 'native-join-fixture@daily007.test',
};

function fixtureTournament(scenario: Scenario) {
  const lastSlot = scenario === 'last-slot';
  const teamSize = lastSlot ? 1 : 2;
  const totalSlots = lastSlot ? 48 : 12;
  const filledSlots = lastSlot ? totalSlots - 1 : 4;
  return {
    id: `native-join-fixture-${scenario}`,
    name: 'Native join recovery fixture',
    mode: 'Battle Royale',
    gameMode: 'Battle Royale',
    teamType: lastSlot ? 'Solo' : 'Duo',
    teamSize,
    slotUnit: lastSlot ? 'player' as const : 'team' as const,
    totalSlots,
    totalPlayerSlots: totalSlots * teamSize,
    filledSlots,
    filledPlayerSlots: filledSlots * teamSize,
    availableSlots: totalSlots - filledSlots,
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
  const [walletToppedUp, setWalletToppedUp] = useState(false);
  const [awaitingJoinResponse, setAwaitingJoinResponse] = useState(false);
  const pendingJoinResponse = useRef<((result: FixtureJoinResponse) => void) | null>(null);
  const otherPlayerFilledLastSlot = useRef(false);

  const selectScenario = (nextScenario: Scenario) => {
    setScenario(nextScenario);
    setTournament(fixtureTournament(nextScenario));
    setAttempts(0);
    setConfirmation('');
    setWalletToppedUp(false);
    setAwaitingJoinResponse(false);
    pendingJoinResponse.current = null;
    otherPlayerFilledLastSlot.current = false;
    setRunKey((current) => current + 1);
  };

  const submitFixtureJoin = async () => {
    setAttempts((current) => current + 1);
    setConfirmation('');

    const result = await joinWithCapacityRefresh(
      async () => {
        if (scenario === 'insufficient-balance') {
          if (!walletToppedUp) {
            throw rejection(
              409,
              'INSUFFICIENT_WALLET_BALANCE',
              'Insufficient wallet balance: this entry costs 75 coins.',
            );
          }

          setAwaitingJoinResponse(true);
          return await new Promise<FixtureJoinResponse>((resolve) => {
            pendingJoinResponse.current = resolve;
          });
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
    setConfirmation('Registration confirmed after simulated wallet top-up.');
  };

  const completeSuccessfulJoin = () => {
    const resolve = pendingJoinResponse.current;
    if (!resolve) return;
    pendingJoinResponse.current = null;
    setAwaitingJoinResponse(false);
    resolve({ success: true, status: 'approved' });
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
            disabled={awaitingJoinResponse}
            onPress={() => selectScenario('insufficient-balance')}
            style={{ flex: 1 }}
          />
          <Btn
            title="LAST SLOT TAKEN"
            small
            testID="join-recovery-scenario-last-slot"
            accessibilityState={{ selected: scenario === 'last-slot' }}
            disabled={awaitingJoinResponse}
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
        {scenario === 'insufficient-balance' && attempts > 0 && !walletToppedUp ? (
          <Btn
            title="SIMULATE WALLET TOP-UP"
            small
            testID="join-recovery-wallet-top-up"
            onPress={() => setWalletToppedUp(true)}
            style={{ marginTop: 10 }}
          />
        ) : null}
        {scenario === 'insufficient-balance' && walletToppedUp ? (
          <Text
            testID="join-recovery-wallet-status"
            accessibilityRole="text"
            style={{ color: C.green, marginTop: 8 }}
          >
            Wallet top-up simulated. 100 coins available; retry your registration.
          </Text>
        ) : null}
        {awaitingJoinResponse ? (
          <>
            <Text
              testID="join-recovery-pending-response"
              accessibilityRole="text"
              style={{ color: C.sub, marginTop: 8 }}
            >
              Waiting for the successful join response. No confirmation yet.
            </Text>
            <Btn
              title="COMPLETE SUCCESSFUL RESPONSE"
              small
              testID="join-recovery-complete-success"
              onPress={completeSuccessfulJoin}
              style={{ marginTop: 8 }}
            />
          </>
        ) : null}
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
        seatGroupNumber={tournament.filledSlots + 1}
        seatSlotNumber={scenario === 'last-slot' ? 1 : 2}
        onCancel={() => {}}
        onSubmit={submitFixtureJoin}
      />
    </View>
  );
}
