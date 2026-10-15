// Profile — avatar, stats, edit profile, notifications, leaderboard, logout
import React from 'react';
import { View, ScrollView, StyleSheet, Modal, Platform, useWindowDimensions } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { ReadableText as Text } from '../components/typography';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useApp } from '../App';
import { Api, apiError } from '../lib/api';
import { C, Card, Btn, Input, SectionTitle, KV } from '../components/ui';
import GoogleSSOButton from '../components/GoogleSSOButton';
import { useDaily007ChangePassword } from '@workspace/api-client-react';
import { PROFILE_PASSWORD_MAX_LENGTH, submitProfilePasswordChange } from '../lib/profilePassword';

export default function Profile() {
  const { width, fontScale } = useWindowDimensions();
  const narrowLargeText = fontScale >= 1.5 && width <= 340;
  const appVersion = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '—';
  const configuredBuild = Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.buildNumber
    : Constants.expoConfig?.android?.versionCode;
  const appBuild = Application.nativeBuildVersion
    ?? (configuredBuild == null ? '—' : String(configuredBuild));
  const buildLabel = Platform.OS === 'ios' ? 'iOS build' : 'Android build';
  const { user, logout, refresh, googleLinkError, setGoogleLinkError } = useApp();
  const profileEmail = String(user?.email ?? '');
  const displayProfileEmail = fontScale >= 1.5
    ? profileEmail.replace(/([@._+-])/g, '$1\u200B')
    : profileEmail;
  const profileGameUid = String(user?.gameUid ?? '');
  const displayProfileGameUid = narrowLargeText
    ? profileGameUid.replace(/(.{4})/g, '$1\u200B')
    : profileGameUid;
  const nav = useNavigation<any>();
  const { mutateAsync: changePassword, isPending: passwordBusy } = useDaily007ChangePassword();
  const [bootstrapAvailable, setBootstrapAvailable] = React.useState(false);
  const [bootstrapStatusError, setBootstrapStatusError] = React.useState('');
  const [setupVisible, setSetupVisible] = React.useState(false);
  const [bootstrapCode, setBootstrapCode] = React.useState('');
  const [bootstrapError, setBootstrapError] = React.useState('');
  const [setupError, setSetupError] = React.useState('');
  const [bootstrapBusy, setBootstrapBusy] = React.useState(false);
  const [statsRetrying, setStatsRetrying] = React.useState(false);
  const statsRetryInFlight = React.useRef(false);
  const [passwordModalVisible, setPasswordModalVisible] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmNewPassword, setConfirmNewPassword] = React.useState('');
  const [passwordError, setPasswordError] = React.useState('');
  const [passwordMessage, setPasswordMessage] = React.useState('');

  React.useEffect(() => {
    let active = true;
    if (user.role !== 'admin') {
      Api.adminBootstrapStatus()
        .then((response: any) => {
          if (active) setBootstrapAvailable(response?.available === true);
        })
        .catch((e) => {
          if (active) setBootstrapStatusError(apiError(e));
        });
    }
    return () => { active = false; };
  }, [user.role]);

  useFocusEffect(React.useCallback(() => {
    void refresh();
  }, [refresh]));
  const statsUnavailable = !!user?.statsError || user?.matches === undefined;
  const profileStats = [
    {
      id: 'matches',
      value: statsUnavailable ? '—' : user?.matches ?? 0,
      label: 'MATCHES',
      accessibilityLabel: statsUnavailable ? 'Matches unavailable' : `${user?.matches ?? 0} matches`,
    },
    {
      id: 'wins',
      value: statsUnavailable ? '—' : user?.wins ?? 0,
      label: 'WINS',
      accessibilityLabel: statsUnavailable ? 'Wins unavailable' : `${user?.wins ?? 0} wins`,
    },
    {
      id: 'kills',
      value: statsUnavailable ? '—' : user?.kills ?? 0,
      label: 'KILLS',
      accessibilityLabel: statsUnavailable ? 'Kills unavailable' : `${user?.kills ?? 0} kills`,
    },
    {
      id: 'prizes',
      value: `🪙${statsUnavailable ? '—' : user?.prizeCoins ?? 0}`,
      label: 'PRIZES',
      accessibilityLabel: statsUnavailable ? 'Prize coins unavailable' : `${user?.prizeCoins ?? 0} prize coins`,
    },
  ];
  const retryProfileStats = async () => {
    if (statsRetryInFlight.current) return;
    statsRetryInFlight.current = true;
    setStatsRetrying(true);
    try {
      await refresh();
    } finally {
      statsRetryInFlight.current = false;
      setStatsRetrying(false);
    }
  };

  const closeSetup = () => {
    setSetupVisible(false);
    setBootstrapCode('');
    setBootstrapError('');
  };

  const submitBootstrap = async () => {
    const code = bootstrapCode.trim();
    if (!code) {
      setBootstrapError('Enter the one-time bootstrap code.');
      return;
    }
    setBootstrapBusy(true);
    setBootstrapError('');
    setSetupError('');
    try {
      await Api.adminBootstrap(code);
      setBootstrapAvailable(false);
      closeSetup();
      const refreshedUser = await refresh();
      if (refreshedUser?.role !== 'admin') {
        setSetupError('Setup was accepted, but the admin role could not be refreshed. Please sign in again or contact support.');
      }
    } catch (e) {
      setBootstrapError(apiError(e));
    } finally {
      setBootstrapBusy(false);
    }
  };

  const openPasswordModal = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordError('');
    setPasswordMessage('');
    setPasswordModalVisible(true);
  };

  const closePasswordModal = () => {
    if (passwordBusy) return;
    setPasswordModalVisible(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordError('');
  };

  const submitPasswordChange = async () => {
    setPasswordError('');

    try {
      const validationError = await submitProfilePasswordChange({
        currentPassword,
        newPassword,
        confirmNewPassword,
        changePassword,
      });
      if (validationError) {
        setPasswordError(validationError);
        return;
      }
      setPasswordMessage('Password changed. Other sessions stay active until the next sign-in.');
      setPasswordModalVisible(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (e) {
      setPasswordError(apiError(e));
    }
  };

  return (
    <>
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <Card style={s.head}>
        <View style={s.avatar}><Text style={s.avatarTxt}>{(user?.name ?? 'P').charAt(0).toUpperCase()}</Text></View>
        <Text style={s.name}>{user?.name ?? 'Player'}</Text>
        <Text style={s.email} accessibilityLabel={profileEmail}>{displayProfileEmail}</Text>
        {user?.gameUid ? (
          <Text
            style={[s.uid, narrowLargeText && s.uidLarge]}
            accessibilityLabel={`FF UID: ${profileGameUid}`}
          >
            FF UID: {displayProfileGameUid}
          </Text>
        ) : null}
      </Card>

      <View style={[s.stats, fontScale >= 1.5 && s.statsLarge]}>
        {profileStats.map((stat) => (
          <View
            key={stat.id}
            testID="profile-stat-card"
            style={[s.stat, fontScale >= 1.5 && s.statLarge]}
            accessible
            accessibilityRole="text"
            accessibilityLabel={stat.accessibilityLabel}
            importantForAccessibility="yes"
          >
            <Text
              style={s.statV}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {stat.value}
            </Text>
            <Text
              style={s.statL}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {stat.label}
            </Text>
          </View>
        ))}
      </View>
      {user?.statsError
        ? <>
            <Text style={s.statsError} accessibilityLiveRegion="polite">
              Profile statistics unavailable: {user.statsError}
            </Text>
            <Btn
              testID="profile-stats-retry"
              title={statsRetrying ? 'REFRESHING STATISTICS…' : 'RETRY STATISTICS'}
              kind="ghost"
              onPress={retryProfileStats}
              disabled={statsRetrying}
              loading={statsRetrying}
              accessibilityLabel={statsRetrying ? 'Refreshing profile statistics' : 'Retry profile statistics'}
              accessibilityHint="Refreshes your account and profile statistics."
              accessibilityState={{ disabled: statsRetrying, busy: statsRetrying }}
            />
          </>
        : statsUnavailable ? <Text style={s.statsError}>Profile statistics are loading.</Text> : null}

      <SectionTitle accent={C.blue}>ACCOUNT</SectionTitle>
      <Card>
        <KV k="Phone" v={user?.phone ?? '—'} />
        <KV k="Balance" v={'🪙 ' + (user?.coins ?? 0)} color={C.gold} />
        <KV k="Member since" v={String(user?.$createdAt ?? user?.createdAt ?? '—').slice(0, 10)} />
      </Card>

      <Card>
        <Text style={s.connectTitle}>
          {user.googleLinked === true
            ? 'GOOGLE CONNECTED'
            : user.googleLinked === false
              ? 'CONNECT GOOGLE'
              : 'GOOGLE CONNECTION'}
        </Text>
        <Text style={s.connectDescription}>
          {user.googleLinked === true
            ? 'Google sign-in is linked to this Daily007 account.'
            : user.googleLinked === false
              ? 'Link Google to this password account for quicker sign-in. Your Daily007 account and token stay the same.'
              : 'Checking whether Google is already linked to this Daily007 account.'}
        </Text>
        {user.googleLinked === true ? (
          <Text testID="profile-google-connected" style={s.connected}>Google connection confirmed.</Text>
        ) : user.googleLinked === false ? (
          <>
            <GoogleSSOButton
              label="Connect Google"
              dailyToken={user.token}
              onError={setGoogleLinkError}
              onSuccess={async () => {
                setGoogleLinkError('');
                await refresh();
              }}
            />
          </>
        ) : (
          <Text testID="profile-google-status-loading" style={s.connected}>Checking Google connection…</Text>
        )}
        {!!googleLinkError && <Text style={s.statsError}>{googleLinkError}</Text>}
      </Card>

      <SectionTitle accent={C.gold}>SECURITY</SectionTitle>
      <Card>
        <Text style={s.connectTitle}>DAILY007 PASSWORD</Text>
        <Text style={s.connectDescription}>Change your Daily007 password. This does not change your Google password.</Text>
        <Btn testID="profile-change-password" title="CHANGE PASSWORD" kind="ghost" onPress={openPasswordModal} />
        {!!passwordMessage && <Text style={s.connected} accessibilityLiveRegion="polite">{passwordMessage}</Text>}
      </Card>

      <Btn title="🎮 MY MATCHES" kind="ghost" onPress={() => nav.navigate('MyMatches')} />
      <Btn title="✏️ EDIT PROFILE" kind="ghost" onPress={() => nav.navigate('EditProfile')} />
      <Btn title="🔔 NOTIFICATIONS" kind="ghost" onPress={() => nav.navigate('Notifications')} />
      <Btn title="🏆 LEADERBOARD" kind="ghost" onPress={() => nav.navigate('Leaderboard')} />
      {user.role !== 'admin' && bootstrapAvailable && (
        <Btn title="🔐 SET UP ADMIN" kind="gold" onPress={() => { setBootstrapCode(''); setBootstrapError(''); setSetupVisible(true); }} />
      )}
      {!!bootstrapStatusError && user.role !== 'admin' && (
        <Text style={s.statsError}>Admin setup availability could not be checked: {bootstrapStatusError}</Text>
      )}
      {!!setupError && <Text style={s.statsError}>{setupError}</Text>}
      <SectionTitle accent={C.blue}>APP INFO</SectionTitle>
      <Card testID="profile-app-metadata">
        <KV k="App version" v={appVersion} />
        <KV k={buildLabel} v={appBuild} />
      </Card>
      <Btn title="LOGOUT" kind="danger" onPress={logout} />
    </ScrollView>
    <Modal
      visible={setupVisible}
      transparent
      animationType="fade"
      onRequestClose={closeSetup}
    >
      <View style={s.modalOverlay}>
        <View style={s.modalCard}>
          <Text style={s.modalTitle}>SET UP ADMIN</Text>
          <Text style={s.modalDescription}>Enter the one-time bootstrap code provided to the owner. This code is sent securely and is not saved.</Text>
          <Input
            value={bootstrapCode}
            onChangeText={(value) => { setBootstrapCode(value); setBootstrapError(''); }}
            placeholder="One-time bootstrap code"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!bootstrapBusy}
            accessibilityLabel="One-time admin bootstrap code"
            returnKeyType="done"
            onSubmitEditing={submitBootstrap}
          />
          {!!bootstrapError && <Text style={s.modalError}>{bootstrapError}</Text>}
          <Btn title="COMPLETE ADMIN SETUP" kind="gold" loading={bootstrapBusy} onPress={submitBootstrap} />
          <Btn title="CANCEL" kind="ghost" disabled={bootstrapBusy} onPress={closeSetup} />
        </View>
      </View>
    </Modal>
    <Modal
      visible={passwordModalVisible}
      transparent
      animationType="fade"
      onRequestClose={closePasswordModal}
    >
      <ScrollView
        style={s.passwordModalScroll}
        contentContainerStyle={s.passwordModalContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.modalCard}>
          <Text style={s.modalTitle}>CHANGE PASSWORD</Text>
          <Text style={s.modalDescription}>
            Enter your current Daily007 password. This does not change Google sign-in. A new sign-in on another browser or device will end this session.
          </Text>
          <Input
            value={currentPassword}
            onChangeText={(value) => { setCurrentPassword(value); setPasswordError(''); }}
            placeholder="Current password"
            accessibilityLabel="Current Daily007 password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={PROFILE_PASSWORD_MAX_LENGTH}
            editable={!passwordBusy}
            returnKeyType="next"
          />
          <Input
            value={newPassword}
            onChangeText={(value) => { setNewPassword(value); setPasswordError(''); }}
            placeholder="New password (8–200 characters)"
            accessibilityLabel="New Daily007 password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={PROFILE_PASSWORD_MAX_LENGTH}
            editable={!passwordBusy}
            returnKeyType="next"
          />
          <Input
            value={confirmNewPassword}
            onChangeText={(value) => { setConfirmNewPassword(value); setPasswordError(''); }}
            placeholder="Confirm new password"
            accessibilityLabel="Confirm new Daily007 password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={PROFILE_PASSWORD_MAX_LENGTH}
            editable={!passwordBusy}
            returnKeyType="done"
            onSubmitEditing={submitPasswordChange}
          />
          {!!passwordError && <Text style={s.modalError} accessibilityLiveRegion="polite">{passwordError}</Text>}
          <Btn testID="profile-password-submit" title="UPDATE PASSWORD" kind="gold" loading={passwordBusy} onPress={submitPasswordChange} />
          <Btn title="CANCEL" kind="ghost" disabled={passwordBusy} onPress={closePasswordModal} />
        </View>
      </ScrollView>
    </Modal>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { alignItems: 'center', paddingVertical: 22 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.neon, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#fff', fontSize: 32, fontWeight: '900' },
  name: { color: C.text, fontSize: 20, fontWeight: '900', marginTop: 10 },
  email: { width: '100%', maxWidth: '100%', flexShrink: 1, textAlign: 'center', color: C.sub, fontSize: 13, marginTop: 2 },
  uid: { color: C.gold, fontSize: 12, marginTop: 6, fontWeight: '700' },
  uidLarge: { width: '100%', maxWidth: '100%', flexShrink: 1, textAlign: 'center' },
  connectTitle: { color: C.text, fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  connectDescription: { color: C.sub, fontSize: 12, lineHeight: 17, marginTop: 5 },
  connected: { color: C.green, fontSize: 12, fontWeight: '700', marginTop: 8 },
  stats: { flexDirection: 'row', gap: 8 },
  statsLarge: { flexWrap: 'wrap' },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, alignItems: 'center' },
  statLarge: { flexBasis: '45%', minWidth: 0 },
  statV: { color: C.text, fontWeight: '900', fontSize: 16, width: '100%', maxWidth: '100%', flexShrink: 1, textAlign: 'center' },
  statL: { color: C.sub, fontSize: 9, letterSpacing: 1, marginTop: 3, width: '100%', maxWidth: '100%', flexShrink: 1, textAlign: 'center' },
  statsError: { color: C.red, fontSize: 11, lineHeight: 16 },
  modalOverlay: { flex: 1, backgroundColor: '#000000bb', justifyContent: 'center', padding: 20 },
  passwordModalScroll: { flex: 1, backgroundColor: '#000000bb' },
  passwordModalContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.gold + '88', padding: 18, gap: 12 },
  modalTitle: { color: C.gold, fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  modalDescription: { color: C.sub, fontSize: 12, lineHeight: 18 },
  modalError: { color: C.red, fontSize: 12, lineHeight: 17 },
});
