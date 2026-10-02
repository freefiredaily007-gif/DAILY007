// Profile — avatar, stats, edit profile, notifications, leaderboard, logout
import React from 'react';
import { View, Text, ScrollView, StyleSheet, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../App';
import { Api, apiError } from '../lib/api';
import { C, Card, Btn, Input, SectionTitle, KV } from '../components/ui';
import GoogleSSOButton from '../components/GoogleSSOButton';
import {
  useDaily007GetTournamentAdminAccessRequest,
  useDaily007RequestTournamentAdminAccess,
} from '@workspace/api-client-react';

export default function Profile() {
  const { user, logout, refresh } = useApp();
  const nav = useNavigation<any>();
  const [bootstrapAvailable, setBootstrapAvailable] = React.useState(false);
  const [bootstrapStatusError, setBootstrapStatusError] = React.useState('');
  const [setupVisible, setSetupVisible] = React.useState(false);
  const [bootstrapCode, setBootstrapCode] = React.useState('');
  const [bootstrapError, setBootstrapError] = React.useState('');
  const [setupError, setSetupError] = React.useState('');
  const [bootstrapBusy, setBootstrapBusy] = React.useState(false);
  const [googleConnectError, setGoogleConnectError] = React.useState('');
  const [googleConnected, setGoogleConnected] = React.useState(false);
  const accessRequestQuery = useDaily007GetTournamentAdminAccessRequest();
  const requestAccessMutation = useDaily007RequestTournamentAdminAccess();

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

  React.useEffect(() => {
    if (user?.matches === undefined && !user?.statsError) void refresh();
  }, [user?.matches, user?.statsError, refresh]);
  const statsUnavailable = !!user?.statsError || user?.matches === undefined;

  const submitTournamentAdminRequest = async () => {
    try {
      await requestAccessMutation.mutateAsync();
      await accessRequestQuery.refetch();
    } catch {
      // The mutation error is displayed in the request card.
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

  return (
    <>
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <Card style={s.head}>
        <View style={s.avatar}><Text style={s.avatarTxt}>{(user?.name ?? 'P').charAt(0).toUpperCase()}</Text></View>
        <Text style={s.name}>{user?.name ?? 'Player'}</Text>
        <Text style={s.email}>{user?.email ?? ''}</Text>
        {user?.gameUid ? <Text style={s.uid}>FF UID: {user.gameUid}</Text> : null}
      </Card>

      <View style={s.stats}>
        <View style={s.stat}><Text style={s.statV}>{statsUnavailable ? '—' : user?.matches ?? 0}</Text><Text style={s.statL}>MATCHES</Text></View>
        <View style={s.stat}><Text style={s.statV}>{statsUnavailable ? '—' : user?.wins ?? 0}</Text><Text style={s.statL}>WINS</Text></View>
        <View style={s.stat}><Text style={s.statV}>{statsUnavailable ? '—' : user?.kills ?? 0}</Text><Text style={s.statL}>KILLS</Text></View>
        <View style={s.stat}><Text style={s.statV}>🪙{statsUnavailable ? '—' : user?.prizeCoins ?? 0}</Text><Text style={s.statL}>PRIZES</Text></View>
      </View>
      {user?.statsError
        ? <Text style={s.statsError}>Profile statistics unavailable: {user.statsError}</Text>
        : statsUnavailable ? <Text style={s.statsError}>Profile statistics are loading.</Text> : null}

      <SectionTitle accent={C.blue}>ACCOUNT</SectionTitle>
      <Card>
        <KV k="Phone" v={user?.phone ?? '—'} />
        <KV k="Balance" v={'🪙 ' + (user?.coins ?? 0)} color={C.gold} />
        <KV k="Member since" v={String(user?.$createdAt ?? user?.createdAt ?? '—').slice(0, 10)} />
      </Card>

      {user.role === 'user' && (
        <>
          <SectionTitle accent={C.blue}>TOURNAMENT ADMIN ACCESS</SectionTitle>
          <Card>
            <Text style={s.connectDescription}>
              Request permission to manage tournaments, registrations, rooms, results, and winner payouts. A Full Admin must approve the request.
            </Text>
            {accessRequestQuery.isPending && !accessRequestQuery.data ? (
              <Text style={s.accessStatus}>Checking request status…</Text>
            ) : accessRequestQuery.error ? (
              <>
                <Text style={s.statsError}>Request status unavailable: {apiError(accessRequestQuery.error)}</Text>
                <Btn title="RETRY STATUS CHECK" kind="ghost" onPress={() => { void accessRequestQuery.refetch(); }} />
              </>
            ) : accessRequestQuery.data?.request?.status === 'pending' ? (
              <Text style={s.accessStatus}>Your request is waiting for Full Admin review.</Text>
            ) : accessRequestQuery.data?.request?.status === 'approved' ? (
              <Text style={s.accessStatus}>Approved. Sign out and sign back in to refresh your access.</Text>
            ) : accessRequestQuery.data?.request?.status === 'rejected' ? (
              <>
                <Text style={s.accessStatus}>Your previous request was declined. You can submit a new request.</Text>
                <Btn
                  title="REQUEST AGAIN"
                  kind="gold"
                  loading={requestAccessMutation.isPending}
                  onPress={submitTournamentAdminRequest}
                />
              </>
            ) : (
              <Btn
                title="REQUEST TOURNAMENT ADMIN ACCESS"
                kind="gold"
                loading={requestAccessMutation.isPending}
                onPress={submitTournamentAdminRequest}
              />
            )}
            {!!requestAccessMutation.error && (
              <Text style={s.statsError}>Could not submit request: {apiError(requestAccessMutation.error)}</Text>
            )}
          </Card>
        </>
      )}

      <Card>
        <Text style={s.connectTitle}>CONNECT GOOGLE</Text>
        <Text style={s.connectDescription}>Link Google to this password account for quicker sign-in. Your Daily007 account and token stay the same.</Text>
        <GoogleSSOButton
          label="Connect Google"
          dailyToken={user.token}
          onError={setGoogleConnectError}
          onSuccess={async () => {
            setGoogleConnectError('');
            setGoogleConnected(true);
            await refresh();
          }}
        />
        {!!googleConnectError && <Text style={s.statsError}>{googleConnectError}</Text>}
        {googleConnected && <Text style={s.connected}>Google connection confirmed.</Text>}
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
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { alignItems: 'center', paddingVertical: 22 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.neon, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#fff', fontSize: 32, fontWeight: '900' },
  name: { color: C.text, fontSize: 20, fontWeight: '900', marginTop: 10 },
  email: { color: C.sub, fontSize: 13, marginTop: 2 },
  uid: { color: C.gold, fontSize: 12, marginTop: 6, fontWeight: '700' },
  connectTitle: { color: C.text, fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  connectDescription: { color: C.sub, fontSize: 12, lineHeight: 17, marginTop: 5 },
  connected: { color: C.green, fontSize: 12, fontWeight: '700', marginTop: 8 },
  accessStatus: { color: C.text, fontSize: 12, lineHeight: 18, marginTop: 10 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, alignItems: 'center' },
  statV: { color: C.text, fontWeight: '900', fontSize: 16 },
  statL: { color: C.sub, fontSize: 9, letterSpacing: 1, marginTop: 3 },
  statsError: { color: C.red, fontSize: 11, lineHeight: 16 },
  modalOverlay: { flex: 1, backgroundColor: '#000000bb', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.gold + '88', padding: 18, gap: 12 },
  modalTitle: { color: C.gold, fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  modalDescription: { color: C.sub, fontSize: 12, lineHeight: 18 },
  modalError: { color: C.red, fontSize: 12, lineHeight: 17 },
});
