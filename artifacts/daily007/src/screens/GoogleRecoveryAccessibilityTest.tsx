import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ReadableText as Text } from '../components/typography';
import GoogleSSOButton, { type GoogleRecoveryTestScenario } from '../components/GoogleSSOButton';
import { C, Msg } from '../components/ui';

const scenarios: { id: GoogleRecoveryTestScenario; label: string; description: string }[] = [
  {
    id: 'missing-session',
    label: 'Missing Google session',
    description: 'Tap Request Admin Review. Then enter any dummy text, not the real owner code, and tap Verify Owner Code & Recover. Each action should announce the missing-session error once and remain available.',
  },
  {
    id: 'recovery-request-failure',
    label: 'Recovery request fails',
    description: 'Tap Request Admin Review. The local simulated failure should be announced once; tap it again to confirm the retry remains available.',
  },
  {
    id: 'owner-code-failure',
    label: 'Owner code is rejected',
    description: 'Enter any dummy text, not the real owner code, and tap Verify Owner Code & Recover. The local rejection should be announced once; the text and retry action should remain available.',
  },
];

export default function GoogleRecoveryAccessibilityTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <GoogleRecoveryAccessibilityFixture />;
}

function GoogleRecoveryAccessibilityFixture() {
  const [scenario, setScenario] = useState<GoogleRecoveryTestScenario>('missing-session');
  const [error, setError] = useState('');
  const selectedScenario = scenarios.find((item) => item.id === scenario) ?? scenarios[0];

  return (
    <SafeAreaView style={s.page}>
      <ScrollView contentContainerStyle={s.content}>
        <Text accessibilityRole="header" style={s.title}>Google recovery TalkBack test</Text>
        <Text style={s.intro}>
          Development-only simulation. Errors are generated locally; this screen does not send recovery requests or use the real owner code.
        </Text>

        <Text accessibilityRole="header" style={s.sectionTitle}>Choose an error</Text>
        <View style={s.scenarios}>
          {scenarios.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: scenario === item.id }}
              onPress={() => {
                setError('');
                setScenario(item.id);
              }}
              style={[s.scenarioButton, scenario === item.id && s.scenarioSelected]}
            >
              <Text style={[s.scenarioText, scenario === item.id && s.scenarioTextSelected]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.description}>{selectedScenario.description}</Text>

        <GoogleSSOButton
          key={scenario}
          label="Google sign-in disabled in this test"
          disabled
          allowRecoveryRequest
          devRecoveryTestScenario={scenario}
          onError={setError}
          onSuccess={() => setError('')}
        />
        {error ? (
          <Msg
            kind="err"
            text={error}
            accessibilityLabel={error}
            accessibilityLiveRegion={Platform.OS === 'web' ? 'assertive' : undefined}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { flexGrow: 1, padding: 20, paddingBottom: 36 },
  title: { color: C.text, fontSize: 22, fontWeight: '900' },
  intro: { color: C.sub, fontSize: 14, lineHeight: 21, marginTop: 10 },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: '800', marginTop: 24 },
  scenarios: { gap: 8, marginTop: 10 },
  scenarioButton: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  scenarioSelected: { borderColor: C.blue, backgroundColor: C.bg2 },
  scenarioText: { color: C.sub, fontSize: 14, fontWeight: '700' },
  scenarioTextSelected: { color: C.text },
  description: { color: C.sub, fontSize: 13, lineHeight: 20, marginTop: 16 },
});
