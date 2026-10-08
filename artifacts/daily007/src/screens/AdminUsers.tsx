import { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, ActivityIndicator, useWindowDimensions } from 'react-native';
import { ReadableText as Text, ReadableTextInput as TextInput } from '../components/typography';
import { Api, errMessage } from '../lib/api';
import { AdminSearchAnnouncement, Card, Btn, ScreenWrap, useToast, SectionTitle, ConfirmDialog, PromptDialog } from '../components/adminKit';
import { useDaily007AdminDeleteUser } from '@workspace/api-client-react';

export default function AdminUsers({ currentUserId }: { currentUserId?: string }) {
  const toast = useToast();
  const deleteUserMutation = useDaily007AdminDeleteUser();
  const { fontScale } = useWindowDimensions();
  const stackUserBalance = fontScale >= 1.5;
  const [users, setUsers] = useState<any[] | null>(null);
  const [regs, setRegs] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [roleChangeTarget, setRoleChangeTarget] = useState<any | null>(null);
  const [deleteWarningTarget, setDeleteWarningTarget] = useState<any | null>(null);
  const [deleteEmailTarget, setDeleteEmailTarget] = useState<any | null>(null);

  const load = async () => {
    try {
      const [u, r] = await Promise.all([Api.adminUsers(), Api.adminRegistrations()]);
      setUsers(u ?? []);
      setRegs(r ?? []);
    } catch (e) { toast(errMessage(e), 'error'); setUsers([]); setRegs([]); }
  };
  useEffect(() => { load(); }, []);

  const toggleBlock = (u: any) => {
    const block = u.status !== 'blocked';
    Alert.alert(block ? 'Block user?' : 'Unblock user?', u.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: block ? 'Block' : 'Unblock', style: 'destructive', onPress: async () => {
        setBusy(u.$id);
        try { await Api.adminSetUser(u.$id, { status: block ? 'blocked' : 'active' }); toast(`${u.name} ${block ? 'blocked' : 'unblocked'}`, 'success'); load(); }
        catch (e) { toast(errMessage(e), 'error'); }
        setBusy(null);
      } },
    ]);
  };

  const adjust = (u: any, sign: 1 | -1) => {
    Alert.prompt(sign > 0 ? 'Add coins' : 'Deduct coins', `Enter amount for ${u.name}`, async (v: string) => {
      const n = parseInt(v || '0', 10);
      if (!n || n <= 0) return;
      setBusy(u.$id);
      try { await Api.adminAdjustCoins(u.$id, sign * n, sign > 0 ? 'Admin added coins' : 'Admin deducted coins'); toast('Coins updated', 'success'); load(); }
      catch (e) { toast(errMessage(e), 'error'); }
      setBusy(null);
    });
  };

  const setTournamentAdmin = (u: any) => {
    setRoleChangeTarget(u);
  };

  const confirmTournamentAdminChange = async () => {
    const u = roleChangeTarget;
    if (!u || busy === u.$id) return;
    const role = u.role === 'tournament_admin' ? 'user' : 'tournament_admin';
    const granting = role === 'tournament_admin';
    setRoleChangeTarget(null);
    setBusy(u.$id);
    try {
      await Api.adminSetUserRole(u.$id, role);
      toast(granting ? `${u.name} is now a Tournament Admin` : `${u.name} is now a player`, 'success');
      await load();
    } catch (e) {
      const message = errMessage(e);
      if (message === 'At least one full administrator must remain.') {
        try {
          setUsers((await Api.adminUsers()) ?? []);
        } catch (refreshError) {
          toast(
            `At least one Full Admin must remain. This account was not changed. User list refresh failed: ${errMessage(refreshError)}`,
            'error',
          );
          return;
        }
        toast('At least one Full Admin must remain. This account was not changed.', 'error');
      } else {
        toast(message, 'error');
      }
    } finally {
      setBusy(null);
    }
  };

  const confirmDeleteUser = async (email: string): Promise<boolean> => {
    const user = deleteEmailTarget;
    if (!user || busy === user.$id) return false;
    if (email.trim().toLowerCase() !== String(user.email).trim().toLowerCase()) {
      toast('The email does not match this account. No data was removed.', 'error');
      return false;
    }
    setBusy(user.$id);
    try {
      const result = await deleteUserMutation.mutateAsync({
        id: user.$id,
        data: { confirmationEmail: email.trim() },
      });
      setDeleteEmailTarget(null);
      toast(
        `Permanently removed ${user.name}, including any linked Google sign-in from Daily007. ${result.removed.registrations} registrations and ${result.removed.resultAwards} result awards were deleted.`,
        'success',
      );
      await load();
      return true;
    } catch (e) {
      toast(errMessage(e), 'error');
      await load();
      return false;
    } finally {
      setBusy(null);
    }
  };

  const filtered = (users ?? []).filter((u) => (u.name || '').toLowerCase().includes(q.toLowerCase()) || (u.email || '').toLowerCase().includes(q.toLowerCase()));
  const deleteBusy = Boolean(deleteEmailTarget && busy === deleteEmailTarget.$id);
  const deleteWarningMessage = deleteWarningTarget
    ? `${deleteWarningTarget.name} (${deleteWarningTarget.email}) and all of their Daily007 account data will be permanently removed, including wallet and payment history, withdrawals, tournament registrations, results, referrals, notifications, video claims, leaderboard entries, and uploaded payment proofs. Their teammates will remain Daily007 users but will be removed from these tournament rosters. Any linked Google sign-in to Daily007 will be removed, but their Google account itself will remain. This cannot be undone.`
    : '';

  return (
    <ScreenWrap onRefresh={load}>
      <SectionTitle title="USER MANAGEMENT" sub={`${filtered.length} users`} />
      <Card>
        <Text style={st.accessNote}>Full Admins assign Tournament Admin access directly here. Players cannot submit access requests.</Text>
        <TextInput
          testID="admin-users-search"
          placeholder="Search name or email…"
          placeholderTextColor="#5b6478"
          value={q}
          onChangeText={setQ}
          style={st.search}
        />
      </Card>
      <AdminSearchAnnouncement
        query={q}
        count={filtered.length}
        resultIds={filtered.map((u) => String(u.$id)).sort().join('|')}
        ready={users !== null}
      />
      {users === null ? (
        <ActivityIndicator color="#ff3d3d" style={{ marginTop: 30 }} />
      ) : filtered.map((u) => {
        const mine = (regs ?? []).filter((g) => g.userId === u.$id);
        const approved = mine.filter((g) => g.status === 'approved').length;
        const blocked = u.status === 'blocked';
        return (
          <Card key={u.$id}>
            <View style={{
              flexDirection: stackUserBalance ? 'column' : 'row',
              alignItems: stackUserBalance ? 'stretch' : 'center',
              gap: stackUserBalance ? 4 : 0,
            }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.name}>{u.name} {blocked && <Text style={{ color: '#ff3d3d', fontSize: 10 }}>· BLOCKED</Text>}</Text>
                <Text style={st.sub}>{u.email}</Text>
                <Text style={st.role}>{u.role === 'admin' ? 'FULL ADMIN' : u.role === 'tournament_admin' ? 'TOURNAMENT ADMIN' : 'PLAYER'}</Text>
                <Text style={st.sub}>Joined {String(u.createdAt || '').slice(0, 10)}</Text>
              </View>
              <Text style={[st.coins, stackUserBalance && { alignSelf: 'flex-start' }]}>{u.coins ?? 0} COINS</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 14, marginTop: 8 }}>
              <Text style={st.stat}>{mine.length} joined</Text>
              <Text style={st.stat}>✓ {approved} approved</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <View style={{ flex: 1 }}><Btn title="+ COINS" onPress={() => adjust(u, 1)} loading={busy === u.$id} /></View>
              <View style={{ flex: 1 }}><Btn title="− COINS" kind="ghost" onPress={() => adjust(u, -1)} loading={busy === u.$id} /></View>
              <View style={{ flex: 1 }}><Btn title={blocked ? 'UNBLOCK' : 'BLOCK'} kind="danger" onPress={() => toggleBlock(u)} loading={busy === u.$id} /></View>
            </View>
            {u.$id !== currentUserId && (
              <View style={{ marginTop: 8 }}>
                <Btn
                  title={u.role === 'tournament_admin' ? 'REMOVE TOURNAMENT ADMIN' : u.role === 'admin' ? 'RESTRICT TOURNAMENT ACCESS' : 'MAKE TOURNAMENT ADMIN'}
                  small
                  kind={u.role === 'tournament_admin' ? 'danger' : 'ghost'}
                  onPress={() => setTournamentAdmin(u)}
                  loading={busy === u.$id}
                  testID={`change-user-role-${u.$id}`}
                />
              </View>
            )}
            {!!currentUserId && u.$id !== currentUserId && u.role === 'user' && (
              <View style={{ marginTop: 8 }}>
                <Btn
                  title="PERMANENTLY DELETE ACCOUNT"
                  kind="danger"
                  small
                  onPress={() => setDeleteWarningTarget(u)}
                  loading={busy === u.$id}
                  accessibilityLabel={`Permanently delete account for ${u.name}, ${u.email}`}
                  accessibilityHint="Opens a permanent-loss warning and requires entering this account's email."
                  testID={`delete-user-${u.$id}`}
                />
              </View>
            )}
          </Card>
        );
      })}
      <ConfirmDialog
        visible={roleChangeTarget !== null}
        title={roleChangeTarget?.role === 'tournament_admin'
          ? 'Remove tournament admin access?'
          : roleChangeTarget?.role === 'admin' ? 'Restrict this Full Admin?' : 'Make this user a Tournament Admin?'}
        message={roleChangeTarget?.role === 'tournament_admin'
          ? `${roleChangeTarget.name} will return to regular player access.`
          : roleChangeTarget?.role === 'admin'
            ? `${roleChangeTarget.name} will lose Full Admin access. At least one Full Admin must remain, or the change will be rejected.`
            : `${roleChangeTarget?.name} can manage tournaments, registrations, rooms, results, and winner rewards only.`}
        confirmTitle={roleChangeTarget?.role === 'tournament_admin' ? 'REMOVE ACCESS' : roleChangeTarget?.role === 'admin' ? 'RESTRICT ACCESS' : 'GRANT ACCESS'}
        danger={roleChangeTarget?.role === 'tournament_admin'}
        onCancel={() => setRoleChangeTarget(null)}
        onConfirm={() => { void confirmTournamentAdminChange(); }}
        cancelTestID="cancel-tournament-admin-change"
        confirmTestID="confirm-tournament-admin-change"
      />
      <ConfirmDialog
        visible={deleteWarningTarget !== null}
        title="Permanently delete this player?"
        message={deleteWarningMessage}
        announcementLabel={deleteWarningTarget
          ? `Permanent deletion warning. ${deleteWarningMessage}`
          : undefined}
        announcementLiveRegion="polite"
        confirmTitle="CONTINUE"
        cancelAccessibilityLabel={deleteWarningTarget
          ? `Cancel permanent deletion of ${deleteWarningTarget.name}`
          : undefined}
        confirmAccessibilityLabel={deleteWarningTarget
          ? `Continue to email confirmation for ${deleteWarningTarget.name}`
          : undefined}
        confirmAccessibilityHint="The account is not removed until its email is entered."
        danger
        onCancel={() => setDeleteWarningTarget(null)}
        onConfirm={() => {
          const target = deleteWarningTarget;
          setDeleteWarningTarget(null);
          if (target) setDeleteEmailTarget(target);
        }}
        cancelTestID="cancel-user-delete-warning"
        confirmTestID="continue-user-delete"
      />
      <PromptDialog
        visible={deleteEmailTarget !== null}
        title="Confirm permanent deletion"
        message={deleteEmailTarget
          ? `Type ${deleteEmailTarget.email} exactly as shown. This removes ${deleteEmailTarget.name}'s Daily007 data and linked Daily007 sign-in, but does not delete their Google account.`
          : ''}
        confirmTitle="DELETE PERMANENTLY"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={deleteEmailTarget
          ? `Type the exact email ${deleteEmailTarget.email} to confirm permanent deletion of ${deleteEmailTarget.name}'s Daily007 account`
          : "Type the player's email to confirm permanent deletion"}
        accessibilityHint="Enter the account email shown above. A mismatch will leave the account unchanged."
        placeholder={deleteEmailTarget?.email ?? ''}
        inputTestID="user-delete-confirmation-email"
        cancelTestID="cancel-user-delete-email"
        confirmTestID="confirm-user-delete"
        cancelAccessibilityLabel={deleteEmailTarget
          ? `Cancel permanent deletion of ${deleteEmailTarget.name}`
          : undefined}
        confirmAccessibilityLabel={deleteEmailTarget
          ? `Delete ${deleteEmailTarget.name}'s Daily007 account permanently`
          : undefined}
        confirmAccessibilityHint="Submits the email and begins permanent removal."
        submitting={deleteBusy}
        submittingLabel="DELETING"
        submittingAccessibilityLabel={deleteEmailTarget
          ? `Deleting ${deleteEmailTarget.name}'s account`
          : 'Deleting account'}
        submittingMessage={deleteEmailTarget
          ? `Deleting ${deleteEmailTarget.name}'s account permanently. Please wait.`
          : undefined}
        onCancel={() => setDeleteEmailTarget(null)}
        onSubmit={confirmDeleteUser}
      />
    </ScreenWrap>
  );
}

const st = StyleSheet.create({
  search: { backgroundColor: '#0d1326', borderRadius: 10, color: '#e6e9ef', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#232c47' },
  accessNote: { color: '#9aa3b2', fontSize: 11, lineHeight: 16, marginBottom: 8 },
  name: { color: '#e6e9ef', fontWeight: '900', fontSize: 14 },
  role: { color: '#FFC107', fontSize: 9, fontWeight: '900', letterSpacing: 0.8, marginTop: 4 },
  sub: { color: '#5b6478', fontSize: 11, marginTop: 2 },
  coins: { color: '#FFC107', fontWeight: '900', fontSize: 15 },
  stat: { color: '#9aa3b2', fontSize: 11, fontWeight: '700' },
});