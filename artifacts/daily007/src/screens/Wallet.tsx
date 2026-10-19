// Wallet — balance, add coins (manual input + UPI payment), withdraw coins (min 100), transaction history
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  View,
  Image,
  FlatList,
  StyleSheet,
  RefreshControl,
  Modal,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Api, apiError } from '../lib/api';
import { uploadWalletImage } from '../lib/walletImages';
import {
  walletTransactionAccessibilityLabel,
  walletTransactionAmount,
  walletTransactionDescription,
  walletTransactionIsLeaderboardReward,
  walletTransactionMatchesFilter,
  walletRejectedDepositReasonText,
  type WalletTransactionFilter,
} from '../lib/wallet-transaction-display';
import { WalletRejectedDepositRow } from '../components/WalletRejectedDepositRow';
import { WalletCancellationRefundRow } from '../components/WalletCancellationRefundRow';
import { useApp } from '../App';
import { C, Card, Btn, Empty, Loading, Msg, Input, SectionTitle, GCard, glow } from '../components/ui';
import { depositAmountInr, inr } from '../lib/coins';
import {
  nativeTextScaleTextProps,
  type NativeTextScaleLayoutObserver,
} from '../lib/nativeTextScaleLayout';
import {
  emptyWalletHistoryState,
  walletHistoryForUser,
} from '../lib/wallet-history-state';
import { KeyboardAwareScrollViewCompat } from '../../components/KeyboardAwareScrollViewCompat';

const DEFAULT_MIN_WITHDRAW = 100;
const DEFAULT_MAX_WITHDRAW = 5000;
const DUPLICATE_PAYMENT_REFERENCE_ERROR = 'This payment reference has already been submitted.';
const PAYER_UPI_ID_PATTERN = /^[a-zA-Z0-9._-]{2,100}@[a-zA-Z0-9.-]{2,100}$/;
const INVALID_PAYER_UPI_ID_MESSAGE =
  'Use 2–100 letters, numbers, dots, underscores, or hyphens before @ and 2–100 letters, numbers, dots, or hyphens after it (for example, name@upi).';
const WALLET_HISTORY_FILTERS: { value: WalletTransactionFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'deposits', label: 'Deposits' },
  { value: 'withdrawals', label: 'Withdrawals' },
  { value: 'refunds', label: 'Refunds' },
];

export type WalletHistoryTestObserver = (
  items: readonly any[],
  cursors: { transactionCursor: string | null; paymentCursor: string | null },
) => void;

function normalizeWalletPaymentReference(reference: unknown): string {
  return typeof reference === 'string'
    ? reference.normalize('NFKC').trim().toLocaleUpperCase('en-US')
    : '';
}

function isDuplicatePaymentReferenceError(error: unknown): boolean {
  const response = (error as {
    response?: { status?: unknown; data?: { error?: unknown } };
  } | null)?.response;
  return response?.status === 409 &&
    response.data?.error === DUPLICATE_PAYMENT_REFERENCE_ERROR;
}

async function findExistingPaymentByReference(reference: string) {
  const normalizedReference = normalizeWalletPaymentReference(reference);
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  while (true) {
    const page = await Api.myPaymentsPage(cursor);
    if (!Array.isArray(page?.items)) {
      throw new Error('The wallet server returned an invalid payment-history page.');
    }
    const existing = page.items.find((payment: any) =>
      normalizeWalletPaymentReference(payment.txnId) === normalizedReference);
    if (existing) return existing;

    const nextCursor = typeof page.nextCursor === 'string' ? page.nextCursor : '';
    if (!nextCursor) return null;
    if (seenCursors.has(nextCursor)) {
      throw new Error('The wallet server repeated a payment-history cursor.');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

function walletPaymentStatusLabel(status: unknown): string {
  if (status === 'pending') return 'Pending Admin approval';
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  return typeof status === 'string' && status ? status : 'Unavailable';
}

function formatWalletCoins(value: unknown, allowBreaks: boolean) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return String(value ?? 0);
  const formatted = new Intl.NumberFormat('en-IN').format(amount);
  return allowBreaks ? formatted.replace(/,/g, ',\u200B') : formatted;
}

export default function Wallet({
  onHistoryChange,
  onTextScaleLayout,
}: {
  onHistoryChange?: WalletHistoryTestObserver;
  onTextScaleLayout?: NativeTextScaleLayoutObserver;
} = {}) {
  const { width, fontScale } = useWindowDimensions();
  const narrowLargeText = fontScale >= 1.5 && width <= 340;
  const { user, refresh } = useApp();
  const walletUserId = user?.id ?? user?.$id ?? null;
  const activeWalletUserId = useRef<string | null>(walletUserId);
  activeWalletUserId.current = walletUserId;
  const [history, setHistory] = useState(() => emptyWalletHistoryState<any>(walletUserId));
  const currentUserHistory = walletHistoryForUser(history, walletUserId);
  const txns = currentUserHistory.items;
  const [historyFilter, setHistoryFilter] = useState<WalletTransactionFilter>('all');
  const visibleTxns = txns.filter((item) => walletTransactionMatchesFilter(item, historyFilter));
  const selectedHistoryFilterLabel = WALLET_HISTORY_FILTERS
    .find((filter) => filter.value === historyFilter)?.label ?? 'All';
  const [loading, setLoading] = useState(true);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const transactionHistoryCursor = currentUserHistory.transactionCursor;
  const paymentHistoryCursor = currentUserHistory.paymentCursor;
  const [historyLoadError, setHistoryLoadError] = useState('');
  const [balanceLoadError, setBalanceLoadError] = useState('');
  const [historyRetryStatus, setHistoryRetryStatus] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [rechargeNotice, setRechargeNotice] = useState('');
  const [showSheet, setShowSheet] = useState(false);
  const [tab, setTab] = useState<'add' | 'withdraw'>('add');
  const [amount, setAmount] = useState('');
  const [payerUpiId, setPayerUpiId] = useState('');
  const [txnId, setTxnId] = useState('');
  const [account, setAccount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [hasPendingWithdraw, setHasPendingWithdraw] = useState(false);
  const [pendingDepositCoins, setPendingDepositCoins] = useState(0);
  const [totalDeposited, setTotalDeposited] = useState(0);
  const [totalWithdrawn, setTotalWithdrawn] = useState(0);
  const [paymentUpi, setPaymentUpi] = useState('');
  const [paymentQr, setPaymentQr] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [rechargeEnabled, setRechargeEnabled] = useState(false);
  const [withdrawalEnabled, setWithdrawalEnabled] = useState(false);
  const [minPurchase, setMinPurchase] = useState(1);
  const [maxPurchase, setMaxPurchase] = useState(5000);
  const [coinPackages, setCoinPackages] = useState<number[]>([]);
  const [minWithdraw, setMinWithdraw] = useState(DEFAULT_MIN_WITHDRAW);
  const [maxWithdraw, setMaxWithdraw] = useState(DEFAULT_MAX_WITHDRAW);
  const [coinToMoneyRate, setCoinToMoneyRate] = useState(1);
  const [proof, setProof] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const historyLoadVersion = useRef(0);

  useEffect(() => {
    if (__DEV__ && onHistoryChange) {
      onHistoryChange(currentUserHistory.items, {
        transactionCursor: currentUserHistory.transactionCursor,
        paymentCursor: currentUserHistory.paymentCursor,
      });
    }
  }, [currentUserHistory, onHistoryChange]);

  useEffect(() => {
    historyLoadVersion.current += 1;
    setHistory(emptyWalletHistoryState(walletUserId));
    setHistoryFilter('all');
    setLoading(Boolean(walletUserId));
    setLoadingMoreHistory(false);
    setHistoryLoadError('');
    setBalanceLoadError('');
    setHistoryRetryStatus('');
    setError('');
  }, [walletUserId]);

  const load = useCallback(async () => {
    const requestedUserId = walletUserId;
    const loadVersion = ++historyLoadVersion.current;
    setLoadingMoreHistory(false);
    if (!requestedUserId) {
      setHistory(emptyWalletHistoryState(null));
      setHistoryLoadError('');
      setBalanceLoadError('');
      setLoading(false);
      return null;
    }
    const requestIsCurrent = () =>
      loadVersion === historyLoadVersion.current &&
      activeWalletUserId.current === requestedUserId;
    try {
      setError('');
      setLoading(true);
      const [
        balanceResult,
        transactionResult,
        paymentResult,
        withdrawalResult,
        settingsResult,
      ] = await Promise.allSettled([
        Promise.resolve().then(refresh),
        Promise.resolve().then(() => Api.transactionsPage()),
        Promise.resolve().then(() => Api.myPaymentsPage()),
        Promise.resolve().then(() => Api.myWithdrawals()),
        Promise.resolve().then(() => Api.settings()),
      ]);
      if (!requestIsCurrent()) return null;
      const transactionPage = transactionResult.status === 'fulfilled' ? transactionResult.value : null;
      const paymentPage = paymentResult.status === 'fulfilled' ? paymentResult.value : null;
      const wds = withdrawalResult.status === 'fulfilled' ? withdrawalResult.value : null;
      const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null;
      const data = transactionPage?.items;
      const pays = paymentPage?.items;
      const hasTransactions = transactionResult.status === 'fulfilled' && Array.isArray(data);
      const hasPayments = paymentResult.status === 'fulfilled' && Array.isArray(pays);
      const hasWithdrawals = withdrawalResult.status === 'fulfilled' && Array.isArray(wds);
      const hasSettings = settingsResult.status === 'fulfilled';

      if (balanceResult.status === 'fulfilled') {
        setBalanceLoadError('');
      } else {
        setBalanceLoadError(
          `Could not refresh your available coin balance. Showing the last known balance. ${apiError(balanceResult.reason)}`,
        );
      }
      if (hasTransactions) {
        setHistoryLoadError('');
      } else {
        const reason = transactionResult.status === 'rejected'
          ? apiError(transactionResult.reason)
          : 'The wallet server returned an invalid transaction-history response.';
        setHistoryLoadError(
          `Could not refresh transaction history. Previously loaded transactions are still shown. ${reason}`,
        );
      }

      const auxiliaryFailures: string[] = [];
      if (!hasPayments) auxiliaryFailures.push('recharge requests');
      if (!hasWithdrawals) auxiliaryFailures.push('withdrawal requests');
      if (!hasSettings) auxiliaryFailures.push('wallet settings');
      setError(auxiliaryFailures.length
        ? `Could not refresh ${auxiliaryFailures.join(', ')}. Some wallet details may be outdated. Pull to refresh to retry.`
        : '');

      if (hasSettings) {
        const config = settings?.settings ?? settings ?? {};
        setPaymentUpi(String(config?.upiId ?? config?.upi_id ?? '').trim());
        setPaymentQr(String(config?.upiQrUrl ?? '').trim());
        setPaymentNote(String(config?.paymentNote ?? '').trim());
        setRechargeEnabled(config?.rechargeEnabled === true || config?.rechargeEnabled === 'true');
        setWithdrawalEnabled(config?.withdrawalEnabled === true || config?.withdrawalEnabled === 'true');
        setMinPurchase(Math.max(1, Number(config?.minPurchase) || 1));
        setMaxPurchase(Math.max(1, Number(config?.maxPurchase) || 5000));
        setCoinToMoneyRate(Number(config?.coinToMoneyRate) > 0 ? Number(config.coinToMoneyRate) : 1);
        const configuredPackages = String(config?.coinPackages ?? '').split(',')
          .map((value: string) => Number(value.trim()))
          .filter((value: number) => Number.isSafeInteger(value) && value > 0);
        setCoinPackages([...new Set(configuredPackages)]);
        const configuredMinWithdraw = Math.max(DEFAULT_MIN_WITHDRAW, Number(config?.minWithdrawal) || DEFAULT_MIN_WITHDRAW);
        setMinWithdraw(configuredMinWithdraw);
        setMaxWithdraw(Math.max(configuredMinWithdraw, Number(config?.maxWithdrawal) || DEFAULT_MAX_WITHDRAW));
      }

      if (hasPayments) {
        setHasPending(pays.some((p: any) => p.status === 'pending'));
        setPendingDepositCoins(pays
          .filter((p: any) => p.status === 'pending')
          .reduce((sum: number, p: any) => sum + Number(p.coins ?? 0), 0));
        setTotalDeposited(pays
          .filter((p: any) => p.status === 'approved')
          .reduce((sum: number, p: any) => sum + Number(p.coins ?? 0), 0));
      }
      if (hasWithdrawals) {
        setHasPendingWithdraw(wds.some((w: any) => w.status === 'pending'));
        setTotalWithdrawn(wds
          .filter((w: any) => w.status === 'approved' && w.payoutStatus === 'paid')
          .reduce((sum: number, w: any) => sum + Number(w.coins ?? 0), 0));
      }

      const pendingPays = hasPayments
        ? pays
          .filter((p: any) => p.status !== 'deleted')
          .map((p: any) => ({
            id: 'pay-' + p.id, description: 'Coin recharge request', reference: p.txnId,
            coins: Number(p.coins || p.amount || 0), amount: Number(p.amount || 0),
            createdAt: p.createdAt, status: p.status, reviewReason: p.reviewReason,
            isRequest: true, requestType: 'payment',
          }))
        : null;
      const pendingWds = hasWithdrawals
        ? wds
          .filter((w: any) => w.status !== 'deleted')
          .map((w: any) => ({
            id: 'wd-' + w.id, description: 'Withdrawal request', coins: Number(w.coins || 0),
            amount: -Number(w.coins || 0), createdAt: w.createdAt, status: w.status,
            reviewReason: w.reviewReason, payoutStatus: w.payoutStatus,
            isRequest: true, requestType: 'withdrawal',
          }))
        : null;
      const nextTransactionCursor = hasTransactions && typeof transactionPage.nextCursor === 'string'
        ? transactionPage.nextCursor
        : null;
      const nextPaymentCursor = hasPayments && typeof paymentPage.nextCursor === 'string'
        ? paymentPage.nextCursor
        : null;
      setHistory((previous) => {
        const ownedHistory = walletHistoryForUser(previous, requestedUserId);
        const previousPayments = ownedHistory.items.filter((item: any) =>
          item.isRequest && item.requestType === 'payment');
        const previousWithdrawals = ownedHistory.items.filter((item: any) =>
          item.isRequest && item.requestType === 'withdrawal');
        const previousTransactions = ownedHistory.items.filter((item: any) => !item.isRequest);
        const merged = [
          ...(pendingPays ?? previousPayments),
          ...(pendingWds ?? previousWithdrawals),
          ...(hasTransactions ? data : previousTransactions),
        ].sort((left, right) =>
          Date.parse(String(right.createdAt ?? '')) - Date.parse(String(left.createdAt ?? '')));
        return {
          userId: requestedUserId,
          items: merged,
          transactionCursor: hasTransactions ? nextTransactionCursor : ownedHistory.transactionCursor,
          paymentCursor: hasPayments ? nextPaymentCursor : ownedHistory.paymentCursor,
        };
      });
      return hasTransactions;
    } catch (e) {
      if (requestIsCurrent()) {
        setHistoryLoadError(apiError(e));
        return false;
      }
      return null;
    } finally {
      if (requestIsCurrent()) setLoading(false);
    }
  }, [refresh, walletUserId]);

  const refreshHistory = useCallback(() => {
    setHistoryRetryStatus('');
    load();
  }, [load]);

  useFocusEffect(useCallback(() => { refreshHistory(); }, [refreshHistory]));

  const announceHistoryRetryStatus = useCallback((message: string) => {
    setHistoryRetryStatus(message);
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibilityWithOptions(message, {
        queue: true,
        priority: 'low',
      });
    }
  }, []);

  const retryHistory = useCallback(async () => {
    const requestedUserId = walletUserId;
    announceHistoryRetryStatus('Retrying transaction history.');
    const result = await load();
    if (activeWalletUserId.current !== requestedUserId || result === null) return;
    if (result) {
      announceHistoryRetryStatus('Transaction history updated.');
    } else {
      announceHistoryRetryStatus('Transaction history could not be loaded. Use Retry transaction history to try again.');
    }
  }, [announceHistoryRetryStatus, load, walletUserId]);

  const loadMoreHistory = useCallback(async () => {
    const transactionCursor = transactionHistoryCursor;
    const paymentCursor = paymentHistoryCursor;
    const requestedUserId = walletUserId;
    if (!requestedUserId || (!transactionCursor && !paymentCursor) || loadingMoreHistory) return;
    const loadVersion = historyLoadVersion.current;
    const requestIsCurrent = () =>
      loadVersion === historyLoadVersion.current &&
      activeWalletUserId.current === requestedUserId;
    setLoadingMoreHistory(true);
    setError('');
    try {
      const [transactionPage, paymentPage] = await Promise.all([
        transactionCursor ? Api.transactionsPage(transactionCursor) : Promise.resolve(null),
        paymentCursor ? Api.myPaymentsPage(paymentCursor) : Promise.resolve(null),
      ]);
      if (!requestIsCurrent()) return;
      if (transactionPage && !Array.isArray(transactionPage.items)) {
        throw new Error('The wallet server returned an invalid transaction-history page.');
      }
      if (paymentPage && !Array.isArray(paymentPage.items)) {
        throw new Error('The wallet server returned an invalid payment-history page.');
      }
      const nextTransactionCursor = typeof transactionPage?.nextCursor === 'string' ? transactionPage.nextCursor : null;
      const nextPaymentCursor = typeof paymentPage?.nextCursor === 'string' ? paymentPage.nextCursor : null;
      if ((transactionCursor && nextTransactionCursor === transactionCursor) ||
          (paymentCursor && nextPaymentCursor === paymentCursor)) {
        throw new Error('The wallet server repeated a history cursor.');
      }
      const olderTransactions = transactionPage?.items ?? [];
      const olderRequests = (paymentPage?.items ?? [])
        .filter((payment: any) => payment.status !== 'deleted')
        .map((payment: any) => ({
          id: 'pay-' + payment.id,
          description: 'Coin recharge request',
          reference: payment.txnId,
          coins: Number(payment.coins || payment.amount || 0),
          amount: Number(payment.amount || 0),
          createdAt: payment.createdAt,
          status: payment.status,
          reviewReason: payment.reviewReason,
          isRequest: true,
          requestType: 'payment',
        }));
      setHistory((previous) => {
        const ownedHistory = walletHistoryForUser(previous, requestedUserId);
        const mergedItems = [...ownedHistory.items, ...olderTransactions, ...olderRequests];
        const uniqueItems = mergedItems.filter((item, index) =>
          mergedItems.findIndex((candidate) => candidate.id === item.id) === index);
        return {
          userId: requestedUserId,
          items: uniqueItems
            .sort((left, right) => Date.parse(String(right.createdAt ?? '')) - Date.parse(String(left.createdAt ?? ''))),
          transactionCursor: nextTransactionCursor,
          paymentCursor: nextPaymentCursor,
        };
      });
    } catch (e) {
      if (requestIsCurrent()) setError(apiError(e));
    } finally {
      if (requestIsCurrent()) setLoadingMoreHistory(false);
    }
  }, [loadingMoreHistory, paymentHistoryCursor, transactionHistoryCursor, walletUserId]);

  const openSheet = (t: 'add' | 'withdraw') => {
    if (t === 'add' && (!rechargeEnabled || !paymentUpi || !paymentQr)) {
      setError('Coin recharge is unavailable until an administrator enables it and configures the UPI ID and QR.');
      return;
    }
    if (t === 'withdraw' && !withdrawalEnabled) {
      setError('Withdrawals are currently disabled by the administrator.');
      return;
    }
    setOk(''); setError(''); setRechargeNotice(''); setAmount(''); setPayerUpiId(''); setTxnId(''); setAccount(''); setProof(null);
    setTab(t); setShowSheet(true);
  };

  const closeSheet = () => {
    setShowSheet(false);
    setError('');
  };

  const coins = Math.floor(Number(amount) || 0);

  const pickProof = async () => {
    setError('');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) setProof(result.assets[0]);
  };

  const submitAdd = async () => {
    if (!rechargeEnabled || !paymentUpi || !paymentQr) { setError('Coin recharge is unavailable until an administrator configures it.'); return; }
    if (!coins || coins < minPurchase || coins > maxPurchase) { setError(`Enter an amount between ${minPurchase} and ${maxPurchase} coins.`); return; }
    if (!payerUpiId.trim()) { setError('Please enter the UPI ID you used to make the payment.'); return; }
    if (!PAYER_UPI_ID_PATTERN.test(payerUpiId.trim())) { setError(INVALID_PAYER_UPI_ID_MESSAGE); return; }
    if (!txnId.trim()) { setError('Please enter the transaction ID of your payment.'); return; }
    setSubmitting(true); setError('');
    try {
      const proofObjectPath = proof ? await uploadWalletImage(proof, 'payment-proof') : undefined;
      await Api.createPayment({
        coins, payerUpiId: payerUpiId.trim(), txnId: txnId.trim(), reference: txnId.trim(),
        ...(proofObjectPath ? { proofObjectPath } : {}),
      });
      setOk('Your recharge request is waiting for Admin verification. Coins will be credited only after approval.');
      setShowSheet(false); setAmount(''); setPayerUpiId(''); setTxnId(''); setProof(null);
      load();
    } catch (e) {
      if (!isDuplicatePaymentReferenceError(e)) {
        setError(apiError(e));
        return;
      }
      try {
        const existingPayment = await findExistingPaymentByReference(txnId);
        await load();
        if (!existingPayment) {
          setRechargeNotice(
            'This transaction ID is already in use, but no matching request was found in your Wallet. No new request was created. Check the reference and contact support before trying again.',
          );
          return;
        }

        const statusLabel = walletPaymentStatusLabel(existingPayment.status);
        if (existingPayment.status === 'rejected') {
          const rejectionReason = walletRejectedDepositReasonText(existingPayment.reviewReason);
          setRechargeNotice(
            `Your recharge request was already saved. Current status: ${statusLabel}. Admin's reason: ${rejectionReason} If you make a new payment, use a different valid transaction reference.`,
          );
          return;
        }
        setOk(`Your recharge request was already saved. Current status: ${statusLabel}. Check Wallet history for the request.`);
        setShowSheet(false);
        setAmount('');
        setPayerUpiId('');
        setTxnId('');
        setProof(null);
      } catch {
        setRechargeNotice(
          'This transaction ID was already submitted, but its request status could not be checked. Refresh Wallet history before trying again. No new payment was created.',
        );
      }
    } finally { setSubmitting(false); }
  };

  const balance = Number(user?.coins ?? 0);
  const belowMinBalance = balance < minWithdraw;

  const submitWithdraw = async () => {
    if (!withdrawalEnabled) { setError('Withdrawals are currently disabled by the administrator.'); return; }
    if (belowMinBalance) { setError(`Minimum balance required to withdraw is ${minWithdraw} coins.`); return; }
    if (!coins || coins <= 0) { setError('Enter the number of coins you want to withdraw.'); return; }
    if (coins < minWithdraw) { setError(`Minimum withdrawal amount is ${minWithdraw} coins.`); return; }
    if (coins > maxWithdraw) { setError(`Maximum withdrawal amount is ${maxWithdraw} coins.`); return; }
    if (coins > balance) { setError('You cannot withdraw more than your available balance.'); return; }
    if (!account.trim()) { setError('Enter your UPI ID / account details for the payout.'); return; }
    setSubmitting(true); setError('');
    try {
      await Api.withdrawCoins({ coins, method: 'upi', account: account.trim() });
      setOk('Withdrawal request submitted for manual admin review. Payout is not automatic.');
      setShowSheet(false); setAmount(''); setAccount('');
      load(); refresh();
    } catch (e) { setError(apiError(e)); } finally { setSubmitting(false); }
  };

  return (
    <View style={s.wrap}>
      <FlatList
        data={visibleTxns}
        keyExtractor={(t, i) => String(t.id ?? i)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshHistory} tintColor={C.neon} />}
        contentContainerStyle={{ padding: 14, gap: 12 }}
        ListHeaderComponent={
          <>
            <GCard glowColor={C.gold} style={s.balCard}>
              <Text
                {...nativeTextScaleTextProps('wallet:balance-label', onTextScaleLayout)}
                style={s.balLabel}
              >
                AVAILABLE COINS
              </Text>
              <Text
                testID="wallet-text-scale-balance"
                accessibilityLabel={`Available coins: ${formatWalletCoins(user?.coins, false)}`}
                {...nativeTextScaleTextProps('wallet:balance', onTextScaleLayout)}
                style={[s.bal, fontScale >= 1.5 && s.balLarge, glow(C.gold, 12)]}
              >
                🪙 {formatWalletCoins(user?.coins, fontScale >= 1.5)}
              </Text>
              {!!balanceLoadError && (
                <View style={s.historyRetry}>
                  <Msg
                    kind="err"
                    text={balanceLoadError}
                    testID="wallet-balance-error"
                    accessibilityLabel={balanceLoadError}
                    accessibilityLiveRegion={Platform.OS === 'ios' ? undefined : 'assertive'}
                  />
                  <Btn
                    title={loading ? 'REFRESHING BALANCE…' : 'RETRY BALANCE'}
                    testID="wallet-balance-retry"
                    accessibilityLabel={loading ? 'Refreshing wallet balance' : 'Retry wallet balance refresh'}
                    accessibilityHint="Refreshes your wallet balance and transaction history."
                    onPress={refreshHistory}
                    loading={loading}
                    disabled={loading}
                  />
                </View>
              )}
              <Text style={s.rateNote}>1 coin = {inr(1, coinToMoneyRate)}</Text>
              <View style={[s.row, fontScale >= 1.5 && s.rowLarge]}>
                <View style={[s.stat, fontScale >= 1.5 && s.statLarge]}><Text style={s.statV}>{formatWalletCoins(pendingDepositCoins, fontScale >= 1.5)}</Text><Text style={s.statL}>PENDING DEPOSITS</Text></View>
                <View style={[s.stat, fontScale >= 1.5 && s.statLarge]}><Text style={s.statV}>{formatWalletCoins(totalDeposited, fontScale >= 1.5)}</Text><Text style={s.statL}>TOTAL DEPOSITED</Text></View>
                <View style={[s.stat, fontScale >= 1.5 && s.statLarge]}><Text style={s.statV}>{formatWalletCoins(totalWithdrawn, fontScale >= 1.5)}</Text><Text style={s.statL}>TOTAL WITHDRAWN</Text></View>
              </View>
              <View style={[s.btnRow, narrowLargeText && s.btnRowLarge]}>
                <View style={narrowLargeText ? s.btnWrapLarge : s.btnWrap}><Btn title="+ ADD COINS" testID="wallet-open-recharge" onTextScaleLayout={onTextScaleLayout} textScaleLayoutKey="wallet:action:add" onPress={() => openSheet('add')} disabled={!rechargeEnabled || !paymentUpi || !paymentQr} /></View>
                <View style={narrowLargeText ? s.btnWrapLarge : s.btnWrap}><Btn title="↩ WITHDRAW" testID="wallet-open-withdraw" onTextScaleLayout={onTextScaleLayout} textScaleLayoutKey="wallet:action:withdraw" kind="gold" onPress={() => openSheet('withdraw')} disabled={!withdrawalEnabled} /></View>
              </View>
              {!rechargeEnabled || !paymentUpi || !paymentQr
                ? <Text style={s.minWarn}>Coin recharge is unavailable until an administrator enables it and configures a UPI ID and QR.</Text>
                : null}
              {!withdrawalEnabled && <Text style={s.minWarn}>Withdrawals are currently disabled by the administrator.</Text>}
            </GCard>
            <Msg kind="ok" text={ok} />
            <Msg kind="err" text={error} />
            <SectionTitle>TRANSACTIONS</SectionTitle>
            <Text style={s.filterLabel}>FILTER BY TYPE</Text>
            <View style={s.historyFilters}>
              {WALLET_HISTORY_FILTERS.map((filter) => (
                <PressableHistoryFilter
                  key={filter.value}
                  filter={filter}
                  active={historyFilter === filter.value}
                  onPress={() => setHistoryFilter(filter.value)}
                  onTextScaleLayout={onTextScaleLayout}
                />
              ))}
            </View>
            {!!historyLoadError && (
              <View style={s.historyRetry}>
                <Msg
                  kind="err"
                  text={historyLoadError}
                  testID="wallet-history-error"
                  accessibilityLabel={historyLoadError}
                  accessibilityLiveRegion={
                    Platform.OS === 'ios' || historyRetryStatus
                      ? undefined
                      : 'assertive'
                  }
                />
                <Btn
                  title={loading ? 'RETRYING HISTORY…' : 'RETRY TRANSACTION HISTORY'}
                  testID="wallet-history-retry"
                  accessibilityLabel={loading ? 'Retrying transaction history' : 'Retry transaction history'}
                  accessibilityHint="Loads your latest wallet transaction history."
                  onPress={retryHistory}
                  loading={loading}
                  disabled={loading}
                />
              </View>
            )}
            {!!historyRetryStatus && (
              <Text
                accessibilityLiveRegion={Platform.OS === 'ios' ? undefined : 'polite'}
                testID="wallet-history-retry-status"
                style={s.historyRetryStatus}
              >
                {historyRetryStatus}
              </Text>
            )}
          </>
        }
        ListEmptyComponent={
          loading
            ? <Loading accessibilityLabel="Loading transaction history" />
            : historyLoadError
              ? null
              : historyFilter === 'all'
                ? <Empty icon="🧾" text="No transactions yet. Add coins or join a tournament!" />
                : (
                  <View testID="wallet-history-empty-state">
                    <Empty
                      icon="🧾"
                      title="NO MATCHING TRANSACTIONS"
                      text={transactionHistoryCursor || paymentHistoryCursor
                        ? `No ${selectedHistoryFilterLabel.toLowerCase()} in the transactions loaded so far. Load older transactions to keep searching.`
                        : `No ${selectedHistoryFilterLabel.toLowerCase()} found.`}
                      accessibilityLabel={transactionHistoryCursor || paymentHistoryCursor
                        ? `No ${selectedHistoryFilterLabel.toLowerCase()} in the transactions loaded so far. Load older transactions to keep searching.`
                        : `No ${selectedHistoryFilterLabel.toLowerCase()} found.`}
                      accessibilityLiveRegion="polite"
                    />
                  </View>
                )
        }
        ListFooterComponent={transactionHistoryCursor || paymentHistoryCursor ? (
          <View style={{ paddingTop: 8 }}>
            <Btn
              title="LOAD OLDER TRANSACTIONS"
              testID="wallet-load-older-transactions"
              kind="ghost"
              onPress={loadMoreHistory}
              loading={loadingMoreHistory}
              disabled={loadingMoreHistory || loading}
            />
          </View>
        ) : null}
        renderItem={({ item, index }) => {
          const pos = item.amount > 0;
          const isCancellationRefund = item.reason === 'tournament_cancel_refund';
          const isMatchPrize = item.reason === 'match_prize';
          const isLeaderboardReward = walletTransactionIsLeaderboardReward(item);
          const isRejectedDeposit = item.isRequest &&
            item.requestType === 'payment' &&
            item.status === 'rejected';
          const description = walletTransactionDescription(item);
          const amountLabel = walletTransactionAmount(item);
          const depositAmountLabel = item.isRequest && item.requestType === 'payment'
            ? depositAmountInr(item.coins, item.amount, coinToMoneyRate)
            : undefined;
          if (isRejectedDeposit) {
            return (
              <WalletRejectedDepositRow
                item={item}
                depositAmountLabel={depositAmountLabel ?? ''}
              />
            );
          }
          if (isCancellationRefund) {
            return <WalletCancellationRefundRow item={item} />;
          }
          const statusLabel = item.status === 'pending' ? 'PENDING ADMIN APPROVAL' : String(item.status ?? '').toUpperCase();
          return (
            <Card
              {...(isMatchPrize || isLeaderboardReward ? {
                accessible: true,
                accessibilityRole: 'text' as const,
                accessibilityLabel: walletTransactionAccessibilityLabel(item),
              } : {})}
              testID={`wallet-transaction-${String(item.id ?? index)}`}
              style={[
                { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
              ]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={[s.txHeader, fontScale >= 1.5 && s.txHeaderLarge]}>
                  <Text style={[s.txTitle, fontScale >= 1.5 && s.txTitleLarge]}>{description}</Text>
                  {item.isRequest && (
                    <View style={[
                      s.pendingTag,
                      fontScale >= 1.5 && s.pendingTagLarge,
                      item.status === 'approved' && s.approvedTag,
                      item.status === 'rejected' && s.rejectedTag,
                    ]}>
                      <Text style={[
                        s.pendingTagText,
                        item.status === 'approved' && { color: C.green },
                        item.status === 'rejected' && { color: C.red },
                      ]}>{statusLabel}</Text>
                    </View>
                  )}
                </View>
                <Text style={s.txDate}>{String(item.createdAt ?? '').slice(0, 16).replace('T', ' ')}</Text>
                {item.isRequest && item.requestType === 'payment' &&
                  <Text style={s.txDate}>{item.coins} coins</Text>}
                {!item.isRequest && item.balanceAfter !== undefined &&
                  <Text style={s.txDate}>Balance after: {item.balanceAfter} coins</Text>}
                {!item.isRequest && item.details?.referredUserName && (
                  <Text style={s.txDate}>
                    Referred player: {item.details.referredUserName} · ID {item.details.referredUserId}
                  </Text>
                )}
                {!item.isRequest && item.details?.qualifyingPaymentId && (
                  <Text selectable style={s.txDate}>Qualifying recharge ID: {item.details.qualifyingPaymentId}</Text>
                )}
                {item.isRequest && item.reference && <Text style={s.txDate}>UTR: {item.reference}</Text>}
                {item.isRequest && item.requestType === 'withdrawal' && item.payoutStatus === 'paid' &&
                  <Text style={s.reviewText}>Manual payout recorded</Text>}
                {item.isRequest && item.reviewReason && (
                  <Text style={s.reviewText}>
                    Reason: {item.reviewReason}
                  </Text>
                )}
              </View>
              <Text style={[
                s.txAmount,
                { color: pos ? C.green : C.red },
              ]}>
                {item.isRequest
                  ? item.requestType === 'payment'
                    ? depositAmountLabel
                    : `${item.coins} 🪙`
                  : isLeaderboardReward
                    ? `${amountLabel} coins`
                    : amountLabel}
              </Text>
            </Card>
          );
        }}
      />

      <Modal
        visible={showSheet}
        animationType="slide"
        transparent
        onRequestClose={closeSheet}
      >
        <View style={[s.modalBg, fontScale >= 1.5 && s.modalBgLarge]}>
          <KeyboardAwareScrollViewCompat
            testID="wallet-form-scroll"
            style={s.modal}
            contentContainerStyle={{ padding: 18 }}
            bottomOffset={64}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.tabs}>
              <PressableTab testID="wallet-tab-add" label="ADD COINS" active={tab === 'add'} onPress={() => { setTab('add'); setError(''); }} />
              <PressableTab testID="wallet-tab-withdraw" label="WITHDRAW" active={tab === 'withdraw'} onPress={() => { setTab('withdraw'); setError(''); }} />
            </View>

            {tab === 'add' ? (
              <>
                {!rechargeEnabled || !paymentUpi || !paymentQr ? (
                  <Text style={s.minWarn}>Coin recharge is unavailable because the administrator has not enabled and configured manual UPI payments.</Text>
                ) : (
                  <>
                <Text style={s.mSub}>Copy the UPI ID or scan the QR code and make the payment using your preferred UPI application. After completing the payment, return to this app and enter your UPI ID, Transaction ID, and Coin Amount. Coins will be added only after Admin manually verifies and approves your payment.</Text>
                {!!paymentNote && <Text style={s.mSub}>{paymentNote}</Text>}
                    <Image source={{ uri: paymentQr }} resizeMode="contain" style={s.qr} accessibilityLabel="Administrator UPI payment QR code" />
                    <View style={s.upiRow}>
                      <Text style={[s.mUpi, { flex: 1 }]}>UPI ID: <Text style={s.mUpiV}>{paymentUpi}</Text></Text>
                      <Btn title="COPY" small kind="ghost" onPress={() => {
                        Clipboard.setStringAsync(paymentUpi).then(() => setOk('UPI ID Copied')).catch(() => setError('Could not copy the UPI ID.'));
                      }} />
                    </View>
                    {coinPackages.length > 0 && (
                      <View style={s.packageRow}>
                        {coinPackages.map((value) => (
                          <Pressable
                            key={value}
                            accessibilityRole="button"
                                accessibilityLabel={`Choose ${value} coins for ${inr(value, coinToMoneyRate)}`}
                            onPress={() => setAmount(String(value))}
                            style={[s.packageOption, coins === value && s.packageOptionActive]}
                          >
                            <Text style={[s.packageText, coins === value && s.packageTextActive]}>
                              {value} coins · {inr(value, coinToMoneyRate)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    <Input testID="wallet-amount" placeholder={`Enter coins (${minPurchase}–${maxPurchase})`} value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" />
                    {coins > 0 && <Text style={s.amountHint}>You pay {inr(coins, coinToMoneyRate)} for {coins} coins</Text>}
                    <Input
                      accessibilityLabel="UPI ID used to make payment"
                      testID="payer-upi-id"
                      placeholder="Enter your UPI ID"
                      value={payerUpiId}
                      onChangeText={setPayerUpiId}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      maxLength={200}
                    />
                    <Input
                      testID="wallet-transaction-id"
                      placeholder="Transaction ID / reference"
                      value={txnId}
                      onChangeText={(value) => {
                        setTxnId(value);
                        setRechargeNotice('');
                      }}
                    />
                    <Btn title={proof ? 'CHANGE PAYMENT SCREENSHOT' : 'ATTACH PAYMENT SCREENSHOT (OPTIONAL)'} kind="ghost" onPress={pickProof} />
                    {proof && (
                      <View style={s.proofPreview}>
                        <Image source={{ uri: proof.uri }} resizeMode="cover" style={s.proofImage} />
                        <Text style={s.proofName}>{proof.fileName || 'Payment screenshot attached'}</Text>
                      </View>
                    )}
                  </>
                )}
                <Btn
                  title={hasPending ? 'PENDING' : `ADD COINS${coins > 0 ? ` (${inr(coins)})` : ''}`}
                  testID="wallet-recharge-submit"
                  onPress={submitAdd}
                  loading={submitting}
                  disabled={hasPending || !rechargeEnabled || !paymentUpi || !paymentQr || submitting}
                />
                {!!rechargeNotice && (
                  <Text
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    testID="wallet-recharge-reconciliation"
                    style={s.pendingNote}
                  >
                    {rechargeNotice}
                  </Text>
                )}
                {hasPending && <Text style={s.pendingNote}>A previous request is under verification. Coins will be credited once approved by the admin.</Text>}
              </>
            ) : (
              <>
                <Text style={s.mSub}>Withdraw between {minWithdraw} and {maxWithdraw} coins. Enter the UPI ID where you want to receive the payout. Requests are manually reviewed; the administrator sends payments separately.</Text>
                <Input testID="wallet-amount" placeholder={`Enter coins (${minWithdraw}–${maxWithdraw})`} value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" />
                {belowMinBalance && <Text style={s.minWarn}>Minimum balance required to withdraw is {minWithdraw} coins.</Text>}
                {coins > 0 && coins < minWithdraw && <Text style={s.minWarn}>Minimum withdrawal amount is {minWithdraw} coins.</Text>}
                {coins > maxWithdraw && <Text style={s.minWarn}>Maximum withdrawal amount is {maxWithdraw} coins.</Text>}
                {coins > balance && <Text style={s.minWarn}>You cannot withdraw more than your available balance.</Text>}
                {coins >= minWithdraw && coins <= maxWithdraw && coins <= balance && <Text style={s.amountHint}>You receive {inr(coins, coinToMoneyRate)}</Text>}
                <Input testID="wallet-withdraw-account" placeholder="UPI ID" value={account} onChangeText={setAccount} />
                <Btn
                  title={hasPendingWithdraw ? 'PENDING' : `WITHDRAW${coins >= minWithdraw && coins <= balance ? ` (${coins} 🪙)` : ''}`}
                  testID="wallet-withdraw-submit"
                  kind="gold"
                  onPress={submitWithdraw}
                  loading={submitting}
                  disabled={hasPendingWithdraw || belowMinBalance || !withdrawalEnabled || submitting || coins > maxWithdraw}
                />
                {hasPendingWithdraw && <Text style={s.pendingNote}>Your withdrawal request is pending manual review. Approval does not mean an automatic payout.</Text>}
              </>
            )}
            <View style={{ height: 8 }} />
            <Btn testID="wallet-close-form" title="CLOSE" kind="ghost" onPress={closeSheet} />
          </KeyboardAwareScrollViewCompat>
        </View>
      </Modal>
    </View>
  );
}

function PressableHistoryFilter({
  filter,
  active,
  onPress,
  onTextScaleLayout,
}: {
  filter: { value: WalletTransactionFilter; label: string };
  active: boolean;
  onPress: () => void;
  onTextScaleLayout?: NativeTextScaleLayoutObserver;
}) {
  return (
    <Pressable
      testID={`wallet-history-filter-${filter.value}`}
      accessibilityRole="button"
      accessibilityLabel={`${filter.label} transactions`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[s.historyFilter, active && s.historyFilterActive]}
    >
      <Text
        {...nativeTextScaleTextProps(`wallet:filter:${filter.value}`, onTextScaleLayout)}
        style={[s.historyFilterText, active && s.historyFilterTextActive]}
      >
        {filter.label}
      </Text>
    </Pressable>
  );
}

function PressableTab({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[s.tab, active && s.tabActive]}>
      <Text style={[s.tabText, active && s.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  balCard: { alignItems: 'center', borderWidth: 1, borderColor: C.gold + '44' },
  balLabel: { color: C.sub, fontSize: 11, letterSpacing: 2, fontWeight: '800' },
  bal: { color: C.gold, fontSize: 40, fontWeight: '900', marginVertical: 8 },
  balLarge: { width: '100%', maxWidth: '100%', flexShrink: 1, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 12, alignSelf: 'stretch', marginBottom: 14 },
  rowLarge: { flexWrap: 'wrap' },
  stat: { flex: 1, backgroundColor: C.bg2, borderRadius: 10, padding: 10, alignItems: 'center' },
  statLarge: { flexBasis: '48%', minWidth: 0 },
  statV: { color: C.text, fontWeight: '900', fontSize: 16 },
  statL: { width: '100%', maxWidth: '100%', flexShrink: 1, textAlign: 'center', color: C.sub, fontSize: 10, letterSpacing: 1, marginTop: 2 },
  btnRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  btnRowLarge: { flexDirection: 'column', width: '100%' },
  btnWrap: { flex: 1 },
  btnWrapLarge: { width: '100%' },
  txTitle: { color: C.text, fontWeight: '700', fontSize: 14 },
  txHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  txHeaderLarge: { flexDirection: 'column', alignItems: 'flex-start', width: '100%' },
  txTitleLarge: { width: '100%', maxWidth: '100%', flexShrink: 1 },
  txDate: { color: C.dim, fontSize: 11, marginTop: 3 },
  txAmount: { fontWeight: '900', fontSize: 16 },
  filterLabel: { color: C.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: -4 },
  historyFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 2 },
  historyFilter: {
    flexGrow: 1, flexBasis: '20%', minWidth: 72, alignItems: 'center',
    borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: C.bg2,
    paddingHorizontal: 8, paddingVertical: 9,
  },
  historyFilterActive: { borderColor: C.gold, backgroundColor: C.gold + '22' },
  historyFilterText: { color: C.sub, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  historyFilterTextActive: { color: C.gold },
  historyRetry: { gap: 8 },
  historyRetryStatus: { color: C.sub, fontSize: 12, lineHeight: 18 },
  modalBg: { flex: 1, backgroundColor: '#000a', justifyContent: 'flex-end' },
  modalBgLarge: { paddingBottom: 12 },
  modal: { backgroundColor: C.bg2, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '85%' },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: 'center', backgroundColor: C.bg },
  tabActive: { borderColor: C.gold, backgroundColor: C.gold + '22' },
  tabText: { color: C.sub, fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },
  tabTextActive: { color: C.gold },
  mSub: { color: C.sub, fontSize: 13, marginBottom: 10, lineHeight: 19 },
  mUpi: { color: C.text, fontWeight: '800', marginBottom: 12 },
  mUpiV: { color: C.gold },
  packageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  packageOption: { borderColor: C.line, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: C.bg },
  packageOptionActive: { borderColor: C.gold, backgroundColor: C.gold + '22' },
  packageText: { color: C.sub, fontSize: 11, fontWeight: '800' },
  packageTextActive: { color: C.gold },
  amountHint: { color: C.green, fontSize: 12, fontWeight: '700', marginTop: -6, marginBottom: 8 },
  minWarn: { color: C.red, fontSize: 12, fontWeight: '700', marginTop: -6, marginBottom: 8 },
  rateNote: { color: C.sub, fontSize: 11, marginBottom: 10, letterSpacing: 0.5 },
  pendingTag: { backgroundColor: C.gold + '22', borderColor: C.gold, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  pendingTagLarge: { maxWidth: '100%', flexWrap: 'wrap' },
  pendingTagText: { maxWidth: '100%', flexShrink: 1, color: C.gold, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  approvedTag: { backgroundColor: C.green + '22', borderColor: C.green },
  rejectedTag: { backgroundColor: C.red + '22', borderColor: C.red },
  reviewText: { color: C.red, fontSize: 11, marginTop: 3, lineHeight: 15 },
  pendingNote: { color: C.gold, fontSize: 11, marginTop: 8, lineHeight: 15, textAlign: 'center' },
  qr: { width: 190, height: 190, alignSelf: 'center', backgroundColor: '#70B8FF', borderRadius: 10, marginBottom: 10 },
  upiRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  proofPreview: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: 8, marginTop: 8, backgroundColor: C.bg, borderRadius: 10 },
  proofImage: { width: 58, height: 58, borderRadius: 7 },
  proofName: { color: C.sub, flex: 1, minWidth: 0, fontSize: 11 },
});