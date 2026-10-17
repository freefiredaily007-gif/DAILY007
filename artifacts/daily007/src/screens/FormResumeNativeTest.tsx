import React, { useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { Ctx } from '../App';
import type { User } from '../lib/api';
import { Btn, C } from '../components/ui';
import { ReadableText as Text } from '../components/typography';
import EditProfile from './EditProfile';
import JoinForm from './JoinForm';

const FIXTURE_USER: User = {
  id: 'native-form-resume-player',
  name: 'Resume Test Player',
  email: 'native-form-resume@daily007.test',
};

const FIXTURE_TOURNAMENT = {
  id: 'native-form-resume-tournament',
  name: 'Form Resume Test Match',
  mode: 'Battle Royale',
  teamType: 'Solo',
  teamSize: 1,
  slotUnit: 'player',
  totalSlots: 48,
  filledSlots: 0,
  availableSlots: 48,
  entryCoins: 0,
  startsAt: '2099-01-01T12:00:00.000Z',
  enabled: true,
  status: 'open',
};

type FormName = 'profile' | 'join';

export default function FormResumeNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <FormResumeNativeTestFixture />;
}

function FormResumeNativeTestFixture() {
  const [form, setForm] = useState<FormName>('profile');
  const [savedProfile, setSavedProfile] = useState('');
  const [joinedTeam, setJoinedTeam] = useState('');

  return (
    <Ctx.Provider value={{
      user: FIXTURE_USER,
      refresh: async () => FIXTURE_USER,
      logout: () => {},
      googleLinkError: '',
      setGoogleLinkError: () => {},
    }}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{ padding: 10, flexDirection: 'row', gap: 8 }}>
          <Text
            testID="form-resume-fixture-title"
            style={{ color: C.gold, fontWeight: '900', flex: 1, alignSelf: 'center' }}
          >
            DEVELOPMENT FIXTURE · LOCAL DATA ONLY
          </Text>
          <Btn
            title="PROFILE"
            small
            testID="form-resume-select-profile"
            onPress={() => setForm('profile')}
          />
          <Btn
            title="JOIN"
            small
            testID="form-resume-select-join"
            onPress={() => setForm('join')}
          />
        </View>
        {form === 'profile' ? (
          <>
            <EditProfile
              updateProfile={async (profile) => {
                setSavedProfile(`${profile.name} | ${profile.phone} | ${profile.gameUid}`);
              }}
            />
            {savedProfile ? (
              <Text testID="form-resume-profile-saved" style={{ color: C.green, padding: 8 }}>
                Saved profile: {savedProfile}
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <JoinForm
              tournament={FIXTURE_TOURNAMENT}
              user={FIXTURE_USER}
              onCancel={() => setForm('profile')}
              onSubmit={async (payload) => {
                setJoinedTeam(`${payload.captainGameName} | ${payload.captainGameUid}`);
              }}
            />
            {joinedTeam ? (
              <Text testID="form-resume-join-confirmed" style={{ color: C.green, padding: 8 }}>
                Joined with: {joinedTeam}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </Ctx.Provider>
  );
}
