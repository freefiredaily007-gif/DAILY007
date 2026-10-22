import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, View, ScrollView, StyleSheet, Alert, ActivityIndicator, Modal, useWindowDimensions } from 'react-native';
import { ReadableText as Text, ReadableTextInput as TextInput } from '../components/typography';
import { Api, errMessage, newAdminAdjustmentRequestId } from '../lib/api';
import { A, AdminSearchAnnouncement, Card, Btn, ScreenWrap, useToast, SectionTitle, ConfirmDialog, PromptDialog } from '../components/adminKit';
import { formatAdminDateTime } from '../lib/adminApprovedRegistrationMatches';
import {
  useDaily007AdminDeleteUser,
  useDaily007V2AdminUserWalletHistory,
  type Daily007AdminWalletHistoryEntry,
} from '@workspace/api-client-react';

type CoinAdjustment = {
  user: any;
  delta: number;
  amount: number;
  note: string;
  requestId: string;
  error?: string;
};

export default function AdminUsers({ currentUserId }: { currentUserId?: string }) {
  const toast = useToast();
  const deleteUserMutation = useDaily007AdminDeleteUser();
  const { fontScale, height } = useWindowDimensions();
  const stackUserBalance = fontScale >= 1.5;
  const [users, setUsers] = useState<any[] | null>(null);
  const [regs, setRegs] = useState<any[] | null>(null);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersLoadError, setUsersLoadError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const coinAdjustmentsInFlight = useRef(new Set<string>());
  const [roleChangeTarget, setRoleChangeTarget] = useState<any | null>(null);
  const [deleteWarningTarget, setDeleteWarningTarget] = useState<any | null>(null);
  const [deleteEmailTarget, setDeleteEmailTarget] = useState<any | null>(null);
  const [coinAdjustmentTarget, setCoinAdjustmentTarget] = useState<{ user: any; sign: 1 | -1 } | null>(null);
  const [walletHistoryUser, setWalletHistoryUser] = useState<any | null>(null);
  const [walletHistoryPageCursor, setWalletHistoryPageCursor] = useState<string | undefined>(undefined);
  const [walletHistoryNextCursor, setWalletHistoryNextCursor] = useState<string | null>(null);
  const [walletHistoryRows, setWalletHistoryRows] = useState<Daily007AdminWalletHistoryEntry[]>([]);
  const walletHistoryPages = useRef(new Map<string, {
    data: { items: Daily007AdminWalletHistoryEntry[]; nextCursor: string | null };
    items: Daily007AdminWalletHistoryEntry[];
  }>());
  const walletHistoryQuery = useDaily007V2AdminUserWalletHistory(
    walletHistoryUser?.$id ?? '',
    walletHistoryPageCursor ? { cursor: walletHistoryPageCursor } : undefined,
    {
      query: {
        queryKey: [
          '/api/daily007/v2/admin/users',
          walletHistoryUser?.$id ?? '',
          'wallet-history',
          walletHistoryPageCursor ?? null,
        ] as const,
        enabled: Boolean(walletHistoryUser),
        staleTime: 0,
        refetchOnMount: 'always',
        retry: false,
      },
    },
  );
  const [retryAdjustment, setRetryAdjustment] = useState<CoinAdjustment | null>(null);
  const roleRowRefs = useRef(new Map<string, View>());
  const focusRoleAfterRefresh = useRef<string | null>(null);
  const pendingFullAdminRecovery = useRef<{ userId: string; userName: string } | null>(null);

  useEffect(() => {
    if (!walletHistoryUser || !walletHistoryQuery.data) return;
    const pageKey = walletHistoryPageCursor ?? 'first';
    const data = walletHistoryQuery.data;
    if (walletHistoryPages.current.get(pageKey)?.data === data) return;
    walletHistoryPages.current.set(pageKey, { data, items: data.items });
    setWalletHistoryRows([...walletHistoryPages.current.values()].flatMap((page) => page.items));
    setWalletHistoryNextCursor(data.nextCursor);
  }, [walletHistoryQuery.data, walletHistoryPageCursor, walletHistoryUser?.$id]);

  const openWalletHistory = (user: any) => {
    walletHistoryPages.current.clear();
    setWalletHistoryRows([]);
    setWalletHistoryNextCursor(null);
    setWalletHistoryPageCursor(undefined);
    setWalletHistoryUser(user);
  };
  const closeWalletHistory = () => setWalletHistoryUser(null);

  const load = async () => {
    setUsersLoading(true);
    try {
      const [u, r] = await Promise.all([Api.adminUsers(), Api.adminRegistrations()]);
      const loadedUsers: any[] = u ?? [];
      setUsers(loadedUsers);
      setRegs(r ?? []);
      setUsersLoadError(null);
      const pendingRecovery = pendingFullAdminRecovery.current;
      if (pendingRecovery) {
        pendingFullAdminRecovery.current = null;
        const refreshedUser = loadedUsers.find(
          (user) => String(user.$id) === pendingRecovery.userId,
        );
        const status = refreshedUser?.role === 'admin'
          ? `User list is current. ${refreshedUser.name || pendingRecovery.userName} remains Full Admin.`
          : 'User list is current.';
        toast(status, 'success');
      }
    } catch (e) {
      const message = `Could not load users and registrations: ${errMessage(e)}.`;
      setUsersLoadError(message);
      toast(`${message} Use Retry to reload both lists.`, 'error');
    } finally {
      setUsersLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const userId = focusRoleAfterRefresh.current;
    if (!users || !userId) return;
    if (Platform.OS !== 'android') {
      focusRoleAfterRefresh.current = null;
      return;
    }

    const timeout = setTimeout(() => {
      if (focusRoleAfterRefresh.current !== userId) return;
      focusRoleAfterRefresh.current = null;
      const row = roleRowRefs.current.get(userId);
      const nativeTag = row ? findNodeHandle(row) : null;
      if (nativeTag != null) AccessibilityInfo.setAccessibilityFocus(nativeTag);
    }, 350);
    return () => clearTimeout(timeout);
  }, [users]);

  const roleChangeAccessibilityLabel = (u: any) => u.role === 'tournament_admin'
    ? `Remove Tournament Admin access from ${u.name}`
    : u.role === 'admin'
      ? `Restrict Full Admin access for ${u.name}`
      : `Make ${u.name} a Tournament Admin`;

  const submitAdjustment = async (adjustment: CoinAdjustment) => {
    const userId = String(adjustment.user.$id);
    if (coinAdjustmentsInFlight.current.has(userId) || busy === userId) return false;
    coinAdjustmentsInFlight.current.add(userId);
    setBusy(userId);
    try {
      const updatedUser = await Api.adminAdjustCoins(
        adjustment.user.$id,
        adjustment.delta,
        adjustment.note,
        adjustment.requestId,
      );
      setRetryAdjustment(null);
      if (!Number.isSafeInteger(Number(updatedUser?.coins)) || Number(updatedUser.coins) < 0) {
        await load();
      } else {
        const updatedCoins = Number(updatedUser.coins);
        setUsers((current) => current?.map((user) => (
          String(user.$id) === userId ? { ...user, coins: updatedCoins } : user
        )) ?? current);
      }
      toast('Coins updated', 'success');
      return true;
    } catch (e) {
      const action = adjustment.delta > 0 ? 'add' : 'deduct';
      const error = errMessage(e);
      setRetryAdjustment({ ...adjustment, error });
      toast(
        `Could not ${action} ${adjustment.amount} coins ${adjustment.delta > 0 ? 'to' : 'from'} ${adjustment.user.name}: ${error}. ` +
        'Use the retry prompt to safely repeat this same request.',
        'error',
      );
      return true;
    } finally {
      coinAdjustmentsInFlight.current.delete(userId);
      setBusy(null);
    }
  };

  const confirmCoinAdjustment = async (value: string) => {
    const target = coinAdjustmentTarget;
    if (!target) return false;
    const amountText = value.trim();
    if (!/^[0-9]+$/.test(amountText)) {
      toast('Enter a whole number of coins using digits only.', 'error');
      return false;
    }
    const amount = Number(amountText);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2_147_483_647) {
      toast('Enter a coin amount between 1 and 2,147,483,647.', 'error');
      return false;
    }
    const adjustment: CoinAdjustment = {
      user: target.user,
      amount,
      delta: target.sign * amount,
      note: target.sign > 0 ? 'Admin added coins' : 'Admin deducted coins',
      requestId: newAdminAdjustmentRequestId(),
    };
    const completed = await submitAdjustment(adjustment);
    if (completed) setCoinAdjustmentTarget(null);
    return completed;
  };

  const toggleBlock = (u: any) => {
    const block = u.status !== 'blocked';
    Alert.alert(block ? 'Block user?' : 'Unblock user?', u.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: block ? 'Block' : 'Unblock', style: 'destructive', onPress: async () => {
        setBusy(u.$id);
        try { await Api.adminSetUser(u.$id, { status: block ? 'blocked' : 'active' }); toast(`${u.name} ${block ? 'blocked' : 'unblocked'}`, 'success'); load(); }
        catch (e) {
          const action = block ? 'block' : 'unblock';
          const buttonLabel = block ? 'BLOCK' : 'UNBLOCK';
          toast(
            `Could not ${action} ${u.name}: ${errMessage(e)}. ` +
            `${u.name}'s row remains available. Check the displayed status, then use ${buttonLabel} for ${u.name} to retry if needed.`,
            'error',
          );
        }
        setBusy(null);
      } },
    ]);
  };

  const adjust = (u: any, sign: 1 | -1) => setCoinAdjustmentTarget({ user: u, sign });

  const setTournamentAdmin = (u: any) => {
    setRoleChangeTarget(u);
  };

  const confirmTournamentAdminChange = async () => {
    const u = roleChangeTarget;
    if (!u || busy === u.$id) return;
    const role = u.role === 'tournament_admin' ? 'user' : 'tournament_admin';
    const granting = role === 'tournament_admin';
    const roleActionLabel = roleChangeAccessibilityLabel(u);
    setRoleChangeTarget(null);
    setBusy(u.$id);
    try {
      await Api.adminSetUserRole(u.$id, role);
      focusRoleAfterRefresh.current = u.$id;
      toast(`Role updated for ${u.name}`, 'success');
      await load();
    } catch (e) {
      const message = errMessage(e);
      if (message === 'At least one full administrator must remain.') {
        try {
          setUsers((await Api.adminUsers()) ?? []);
        } catch (refreshError) {
          pendingFullAdminRecovery.current = {
            userId: String(u.$id),
            userName: String(u.name || 'this user'),
          };
          toast(
            `Could not restrict Full Admin access for ${u.name}. At least one Full Admin must remain, so no change was made. ` +
            `The user row remains available. Refresh failed: ${errMessage(refreshError)}.`,
            'error',
          );
          return;
        }
        toast(
          `Could not restrict Full Admin access for ${u.name}. At least one Full Admin must remain, so no change was made. ` +
          `Try again only after another Full Admin is in place.`,
          'error',
        );
      } else {
        toast(
          `${roleActionLabel} failed: ${message}. The user row remains available. ` +
          `Check the displayed role, then activate ${roleActionLabel} again if the change is still needed.`,
          'error',
        );
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

  const filtered = (users ?? []).filter((u) => (
    (u.name || '').toLowerCase().includes(q.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(q.toLowerCase()) ||
    String(u.phone || '').toLowerCase().includes(q.toLowerCase())
  ));
  const deleteBusy = Boolean(deleteEmailTarget && busy === deleteEmailTarget.$id);
  const usersSummary = users === null
    ? usersLoading ? 'Loading users…' : 'Users unavailable'
    : `${filtered.length} users`;
  const deleteWarningMessage = deleteWarningTarget
    ? `${deleteWarningTarget.name} (${deleteWarningTarget.email}) and all of their Daily007 account data will be permanently removed, including wallet and payment history, withdrawals, tournament registrations, results, referrals, notifications, video claims, leaderboard entries, and uploaded payment proofs. Their teammates will remain Daily007 users but will be removed from these tournament rosters. Any linked Google sign-in to Daily007 will be removed, but their Google account itself will remain. This cannot be undone.`
    : '';

  return (
    <ScreenWrap onRefresh={load} keyboardShouldPersistTaps="handled">
      <SectionTitle title="USER MANAGEMENT" sub={usersSummary} />
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
      {usersLoadError !== null && (
        <Card>
          <View testID="admin-users-load-error" accessibilityLiveRegion="polite">
            <Text style={st.loadErrorTitle}>Could not load users and registrations</Text>
            <Text style={st.loadErrorMessage}>{usersLoadError}</Text>
            <Text style={st.loadErrorHint}>Retry reloads both lists without changing account data or permissions.</Text>
          </View>
          <Btn
            title="RETRY"
            loading={usersLoading}
            accessibilityLabel="Retry loading users and registrations"
            accessibilityHint="Reloads both lists without changing account data or permissions."
            testID="admin-users-load-retry"
            onPress={() => { void load(); }}
          />
        </Card>
      )}
      {users === null ? (
        usersLoadError === null ? <ActivityIndicator color={A.cyan} style={{ marginTop: 30 }} /> : null
      ) : q.trim() && filtered.length === 0 ? (
        <Card>
          <Text style={st.noResults}>No users match this search.</Text>
          <Text style={st.noResultsHint}>Clear the search to see all users.</Text>
          <Btn
            title="CLEAR SEARCH"
            accessibilityLabel="Clear Admin Users search"
            accessibilityHint="Shows all users again without changing their account data or permissions."
            testID="admin-users-clear-search"
            onPress={() => setQ('')}
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <View testID="admin-users-empty-state">
            <Text
              testID="admin-users-empty-title"
              accessibilityRole="header"
              style={st.emptyTitle}
            >
              No user accounts yet
            </Text>
            <Text style={st.emptyMessage}>There are no accounts available to manage right now.</Text>
          </View>
        </Card>
      ) : filtered.map((u) => {
        const mine = (regs ?? []).filter((g) => g.userId === u.$id);
        const approved = mine.filter((g) => g.status === 'approved').length;
        const blocked = u.status === 'blocked';
        const roleLabel = u.role === 'admin'
          ? 'Full Admin'
          : u.role === 'tournament_admin' ? 'Tournament Admin' : 'Player';
        return (
          <Card key={u.$id}>
            <View style={{
              flexDirection: stackUserBalance ? 'column' : 'row',
              alignItems: stackUserBalance ? 'stretch' : 'center',
              gap: stackUserBalance ? 4 : 0,
            }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.name}>{u.name} {blocked && <Text style={{ color: A.red, fontSize: 10 }}>· BLOCKED</Text>}</Text>
                <Text style={st.sub}>{u.email}</Text>
                <View
                  ref={(node) => {
                    if (node) roleRowRefs.current.set(String(u.$id), node);
                    else roleRowRefs.current.delete(String(u.$id));
                  }}
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={`${u.name}, ${roleLabel}`}
                >
                  <Text accessible={false} style={st.role}>{roleLabel.toUpperCase()}</Text>
                </View>
                <Text style={st.sub}>Joined {String(u.createdAt || '').slice(0, 10)}</Text>
              </View>
              <Text style={[st.coins, stackUserBalance && { alignSelf: 'flex-start' }]}>{u.coins ?? 0} COINS</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 14, marginTop: 8 }}>
              <Text style={st.stat}>{mine.length} joined</Text>
              <Text style={st.stat}>✓ {approved} approved</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <View style={{ flex: 1 }}><Btn title="+ COINS" accessibilityLabel={`Add coins to ${u.name}`} accessibilityHint="Opens a dialog to enter a whole number of coins." onPress={() => adjust(u, 1)} loading={busy === u.$id} /></View>
              <View style={{ flex: 1 }}><Btn title="− COINS" kind="ghost" accessibilityLabel={`Deduct coins from ${u.name}`} accessibilityHint="Opens a dialog to enter a whole number of coins. The balance cannot go below zero." onPress={() => adjust(u, -1)} loading={busy === u.$id} /></View>
              <View style={{ flex: 1 }}><Btn title={blocked ? 'UNBLOCK' : 'BLOCK'} kind="danger" accessibilityLabel={`${blocked ? 'Unblock' : 'Block'} ${u.name}`} accessibilityHint="If an error is announced, check the displayed status before trying again." onPress={() => toggleBlock(u)} loading={busy === u.$id} /></View>
            </View>
            <View style={{ marginTop: 8 }}>
              <Btn
                title="VIEW WALLET HISTORY"
                kind="ghost"
                accessibilityLabel={`View wallet history for ${u.name}`}
                accessibilityHint="Opens this user's credit and debit ledger, newest transactions first."
                onPress={() => openWalletHistory(u)}
                testID={`view-wallet-history-${u.$id}`}
              />
            </View>
            {u.$id !== currentUserId && (
              <View style={{ marginTop: 8 }}>
                <Btn
                  title={u.role === 'tournament_admin' ? 'REMOVE TOURNAMENT ADMIN' : u.role === 'admin' ? 'RESTRICT TOURNAMENT ACCESS' : 'MAKE TOURNAMENT ADMIN'}
                  small
                  kind={u.role === 'tournament_admin' ? 'danger' : 'ghost'}
                  accessibilityLabel={roleChangeAccessibilityLabel(u)}
                  accessibilityHint="If an error is announced, check the displayed role before trying again."
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
      <Modal visible={walletHistoryUser !== null} transparent animationType="slide" onRequestClose={closeWalletHistory}>
        <View style={st.walletHistoryOverlay}>
          <View
            style={[st.walletHistoryModal, { maxHeight: Math.max(320, Math.min(height - 32, 780)) }]}
            accessibilityViewIsModal
            testID="user-wallet-history-modal"
          >
            <View style={st.walletHistoryHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text accessibilityRole="header" style={st.walletHistoryTitle}>WALLET HISTORY</Text>
                <Text style={st.walletHistoryUserName}>{walletHistoryUser?.name}</Text>
                <Text style={st.walletHistoryMeta}>{walletHistoryUser?.email}</Text>
                {!!walletHistoryUser?.phone && (
                  <Text style={st.walletHistoryMeta}>{walletHistoryUser.phone}</Text>
                )}
              </View>
              <View style={{ width: 82 }}>
                <Btn
                  title="CLOSE"
                  kind="ghost"
                  onPress={closeWalletHistory}
                  accessibilityLabel="Close wallet history"
                  testID="close-wallet-history"
                />
              </View>
            </View>
            <Text style={st.walletHistoryCount}>
              {walletHistoryRows.length} transaction{walletHistoryRows.length === 1 ? '' : 's'} loaded · newest first
            </Text>
            {walletHistoryQuery.isLoading && walletHistoryRows.length === 0 && (
              <View style={st.walletHistoryStatus}>
                <ActivityIndicator color={A.cyan} />
                <Text style={st.walletHistoryMeta}>Loading wallet history…</Text>
              </View>
            )}
            {walletHistoryQuery.isError && (
              <View style={st.walletHistoryError}>
                <Text style={st.walletHistoryErrorText}>
                  Could not load wallet history: {errMessage(walletHistoryQuery.error)}
                </Text>
                <Btn
                  title="RETRY"
                  kind="ghost"
                  loading={walletHistoryQuery.isFetching}
                  onPress={() => { void walletHistoryQuery.refetch(); }}
                  accessibilityLabel="Retry loading wallet history"
                  testID="retry-wallet-history"
                />
              </View>
            )}
            {!walletHistoryQuery.isLoading && !walletHistoryQuery.isError && walletHistoryRows.length === 0 && (
              <View style={st.walletHistoryEmpty}>
                <Text style={st.walletHistoryEmptyTitle}>No wallet transactions</Text>
                <Text style={st.walletHistoryMeta}>This account does not have any recorded wallet activity yet.</Text>
              </View>
            )}
            <ScrollView
              style={st.walletHistoryList}
              contentContainerStyle={st.walletHistoryListContent}
              keyboardShouldPersistTaps="handled"
            >
              {walletHistoryRows.map((item) => {
                const credit = item.transactionType === 'credit';
                return (
                  <View key={item.id} style={st.walletHistoryRow} testID={`wallet-history-row-${item.id}`}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={st.walletHistoryDescription}>{item.description}</Text>
                      <Text style={st.walletHistoryMeta}>
                        {item.transactionType.toUpperCase()} · {formatAdminDateTime(item.createdAt)}
                      </Text>
                      <Text style={st.walletHistoryMeta}>Balance after: {item.balanceAfter} coins</Text>
                    </View>
                    <Text
                      style={[
                        st.walletHistoryAmount,
                        { color: credit ? A.green : A.red },
                        stackUserBalance && { alignSelf: 'flex-start' },
                      ]}
                    >
                      {item.amount > 0 ? '+' : ''}{item.amount} COINS
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
            {walletHistoryNextCursor && (
              <Btn
                title="LOAD MORE"
                kind="ghost"
                loading={walletHistoryQuery.isFetching}
                onPress={() => setWalletHistoryPageCursor(walletHistoryNextCursor)}
                accessibilityLabel="Load more wallet history"
                testID="load-more-wallet-history"
              />
            )}
          </View>
        </View>
      </Modal>
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
        visible={coinAdjustmentTarget !== null}
        title={coinAdjustmentTarget
          ? `${coinAdjustmentTarget.sign > 0 ? 'Add coins to' : 'Deduct coins from'} ${coinAdjustmentTarget.user.name}`
          : 'Adjust coins'}
        message={coinAdjustmentTarget
          ? `Current balance: ${coinAdjustmentTarget.user.coins ?? 0} coins. Enter a positive whole-number amount.`
          : undefined}
        confirmTitle={coinAdjustmentTarget?.sign === 1 ? 'ADD COINS' : 'DEDUCT COINS'}
        keyboardType="number-pad"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Coin amount"
        accessibilityHint="Enter a positive whole number. The server will reject a deduction that would make the balance negative."
        placeholder="Enter coin amount"
        inputTestID="user-coin-adjustment-amount"
        cancelTestID="cancel-user-coin-adjustment"
        confirmTestID="confirm-user-coin-adjustment"
        confirmAccessibilityLabel={coinAdjustmentTarget
          ? `${coinAdjustmentTarget.sign > 0 ? 'Add coins to' : 'Deduct coins from'} ${coinAdjustmentTarget.user.name}`
          : undefined}
        submitting={Boolean(coinAdjustmentTarget && busy === String(coinAdjustmentTarget.user.$id))}
        submittingLabel="UPDATING"
        submittingAccessibilityLabel="Updating coin balance"
        submittingMessage={coinAdjustmentTarget
          ? `Updating ${coinAdjustmentTarget.user.name}'s coin balance. Please wait.`
          : undefined}
        onCancel={() => setCoinAdjustmentTarget(null)}
        onSubmit={confirmCoinAdjustment}
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
      <ConfirmDialog
        visible={retryAdjustment !== null}
        title="Adjustment not confirmed"
        message={retryAdjustment
          ? `The server may already have applied this adjustment. Retry the same request safely, or dismiss it before starting a separate adjustment.${retryAdjustment.error ? ` Last response: ${retryAdjustment.error}` : ''}`
          : ''}
        confirmTitle="RETRY SAME REQUEST"
        onCancel={() => setRetryAdjustment(null)}
        onConfirm={() => { if (retryAdjustment) void submitAdjustment(retryAdjustment); }}
        cancelTestID="dismiss-users-coin-adjustment-retry"
        confirmTestID="retry-users-coin-adjustment"
        confirmAccessibilityLabel={retryAdjustment
          ? `Retry the same ${retryAdjustment.amount}-coin adjustment for ${retryAdjustment.user.name}`
          : undefined}
        confirmAccessibilityHint="This uses the same request ID so the balance and transaction are not changed twice."
      />
    </ScreenWrap>
  );
}

const st = StyleSheet.create({
  search: { backgroundColor: '#0d1326', borderRadius: 10, color: '#e6e9ef', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#232c47' },
  accessNote: { color: '#9aa3b2', fontSize: 11, lineHeight: 16, marginBottom: 8 },
  loadErrorTitle: { color: A.red, fontSize: 14, lineHeight: 20, fontWeight: '900' },
  loadErrorMessage: { color: A.text, fontSize: 12, lineHeight: 18, marginTop: 4 },
  loadErrorHint: { color: A.sub, fontSize: 11, lineHeight: 16, marginTop: 6, marginBottom: 12 },
  emptyTitle: { color: A.text, fontSize: 16, lineHeight: 22, fontWeight: '900' },
  emptyMessage: { color: A.sub, fontSize: 13, lineHeight: 19, marginTop: 4 },
  noResults: { color: '#e6e9ef', fontSize: 14, lineHeight: 20, fontWeight: '800' },
  noResultsHint: { color: '#9aa3b2', fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 12 },
  name: { color: A.text, fontWeight: '900', fontSize: 14 },
  role: { color: A.gold, fontSize: 9, fontWeight: '900', letterSpacing: 0.8, marginTop: 4 },
  sub: { color: A.sub, fontSize: 11, marginTop: 2 },
  coins: { color: A.gold, fontWeight: '900', fontSize: 15 },
  stat: { color: A.sub, fontSize: 11, fontWeight: '700' },
  walletHistoryOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  walletHistoryModal: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: A.cardSolid,
    borderColor: A.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
  walletHistoryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  walletHistoryTitle: { color: A.gold, fontSize: 17, lineHeight: 22, fontWeight: '900', letterSpacing: 0.8 },
  walletHistoryUserName: { color: A.text, fontSize: 14, lineHeight: 20, fontWeight: '800', marginTop: 6 },
  walletHistoryMeta: { color: A.sub, fontSize: 11, lineHeight: 16, marginTop: 3 },
  walletHistoryCount: { color: A.cyan, fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 14, marginBottom: 8 },
  walletHistoryStatus: { minHeight: 86, alignItems: 'center', justifyContent: 'center', gap: 8 },
  walletHistoryError: { gap: 8, padding: 10, marginBottom: 8, borderRadius: 10, backgroundColor: 'rgba(255,113,135,0.10)', borderWidth: 1, borderColor: 'rgba(255,113,135,0.35)' },
  walletHistoryErrorText: { color: A.red, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  walletHistoryEmpty: { padding: 14, borderRadius: 12, backgroundColor: A.card, borderWidth: 1, borderColor: A.border },
  walletHistoryEmptyTitle: { color: A.text, fontSize: 14, lineHeight: 20, fontWeight: '900' },
  walletHistoryList: { flexShrink: 1 },
  walletHistoryListContent: { gap: 8, paddingBottom: 8 },
  walletHistoryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: A.card, borderColor: A.border, borderWidth: 1, borderRadius: 12, padding: 11 },
  walletHistoryDescription: { color: A.text, fontSize: 12, lineHeight: 18, fontWeight: '800' },
  walletHistoryAmount: { maxWidth: '42%', color: A.green, fontSize: 12, lineHeight: 18, fontWeight: '900', textAlign: 'right' },
});