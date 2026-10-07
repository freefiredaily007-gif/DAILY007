// Wallet — balance, add coins (manual input + UPI payment), withdraw coins (min 100), transaction history
import React, { useCallback, useState } from 'react';
import { View, Image, FlatList, StyleSheet, RefreshControl, Modal, Pressable, useWindowDimensions } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Api, apiError } from '../lib/api';
import { uploadWalletImage } from '../lib/walletImages';
import {
  walletTransactionAmount,
  walletTransactionDescription,
} from '../lib/wallet-transaction-display';
import { WalletRejectedDepositRow } from '../components/WalletRejectedDepositRow';
import { WalletCancellationRefundRow } from '../components/WalletCancellationRefundRow';
import { useApp } from '../App';
import { C, Card, Btn, Empty, Loading, Msg, Input, SectionTitle, GCard, glow } from '../components/ui';
import { depositAmountInr, inr } from '../lib/coins';
import { KeyboardAwareScrollViewCompat } from '../../components/KeyboardAwareScrollViewCompat';

const DEFAULT_MIN_WITHDRAW = 100;
const DEFAULT_MAX_WITHDRAW = 5000;

function formatWalletCoins(value: unknown, allowBreaks: boolean) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return String(value ?? 0);
  const formatted = new Intl.NumberFormat('en-IN').format(amount);
  return allowBreaks ? formatted.replace(/,/g, ',\u200B') : formatted;
}

export default function Wallet() {
  const { width, fontScale } = useWindowDimensions();
  const narrowLargeText = fontScale >= 1.5 && width <= 340;
  const { user, refresh } = useApp();
  const [txns, setTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
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

  const load = useCallback(async () => {
    try {
      setError('');
      setLoading(true);
      const [, data, pays, wds, settings] = await Promise.all([
        refresh(),
        Api.transactions(),
        Api.myPayments(),
        Api.myWithdrawals(),
        Api.settings(),
      ]);
      if (!Array.isArray(data) || !Array.isArray(pays) || !Array.isArray(wds)) {
        throw new Error('The wallet server returned an invalid response.');
      }
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
      setHasPending(pays.some((p: any) => p.status === 'pending'));
      setHasPendingWithdraw(wds.some((w: any) => w.status === 'pending'));
      setPendingDepositCoins(pays
        .filter((p: any) => p.status === 'pending')
        .reduce((sum: number, p: any) => sum + Number(p.coins ?? 0), 0));
      setTotalDeposited(pays
        .filter((p: any) => p.status === 'approved')
        .reduce((sum: number, p: any) => sum + Number(p.coins ?? 0), 0));
      setTotalWithdrawn(wds
        .filter((w: any) => w.status === 'approved' && w.payoutStatus === 'paid')
        .reduce((sum: number, w: any) => sum + Number(w.coins ?? 0), 0));
      const pendingPays = pays
        .filter((p: any) => p.status !== 'deleted')
        .map((p: any) => ({
          id: 'pay-' + p.id, description: 'Coin recharge request', reference: p.txnId,
          coins: Number(p.coins || p.amount || 0), amount: Number(p.amount || 0),
          createdAt: p.createdAt, status: p.status, reviewReason: p.reviewReason,
          isRequest: true, requestType: 'payment',
        }));
      const pendingWds = wds
        .filter((w: any) => w.status !== 'deleted')
        .map((w: any) => ({
          id: 'wd-' + w.id, description: 'Withdrawal request', coins: Number(w.coins || 0),
          amount: -Number(w.coins || 0), createdAt: w.createdAt, status: w.status,
          reviewReason: w.reviewReason, payoutStatus: w.payoutStatus,
          isRequest: true, requestType: 'withdrawal',
        }));
      const merged = [...pendingPays, ...pendingWds, ...data];
      setTxns(merged);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openSheet = (t: 'add' | 'withdraw') => {
    if (t === 'add' && (!rechargeEnabled || !paymentUpi || !paymentQr)) {
      setError('Coin recharge is unavailable until an administrator enables it and configures the UPI ID and QR.');
      return;
    }
    if (t === 'withdraw' && !withdrawalEnabled) {
      setError('Withdrawals are currently disabled by the administrator.');
      return;
    }
    setOk(''); setError(''); setAmount(''); setPayerUpiId(''); setTxnId(''); setAccount(''); setProof(null);
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
    } catch (e) { setError(apiError(e)); } finally { setSubmitting(false); }
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
        data={txns}
        keyExtractor={(t, i) => String(t.id ?? i)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.neon} />}
        contentContainerStyle={{ padding: 14, gap: 12 }}
        ListHeaderComponent={
          <>
            <GCard glowColor={C.gold} style={s.balCard}>
              <Text style={s.balLabel}>AVAILABLE COINS</Text>
              <Text
                accessibilityLabel={`Available coins: ${formatWalletCoins(user?.coins, false)}`}
                style={[s.bal, fontScale >= 1.5 && s.balLarge, glow(C.gold, 12)]}
              >
                🪙 {formatWalletCoins(user?.coins, fontScale >= 1.5)}
              </Text>
              <Text style={s.rateNote}>1 coin = {inr(1, coinToMoneyRate)}</Text>
              <View style={[s.row, fontScale >= 1.5 && s.rowLarge]}>
                <View style={[s.stat, fontScale >= 1.5 && s.statLarge]}><Text style={s.statV}>{formatWalletCoins(pendingDepositCoins, fontScale >= 1.5)}</Text><Text style={s.statL}>PENDING DEPOSITS</Text></View>
                <View style={[s.stat, fontScale >= 1.5 && s.statLarge]}><Text style={s.statV}>{formatWalletCoins(totalDeposited, fontScale >= 1.5)}</Text><Text style={s.statL}>TOTAL DEPOSITED</Text></View>
                <View style={[s.stat, fontScale >= 1.5 && s.statLarge]}><Text style={s.statV}>{formatWalletCoins(totalWithdrawn, fontScale >= 1.5)}</Text><Text style={s.statL}>TOTAL WITHDRAWN</Text></View>
              </View>
              <View style={[s.btnRow, narrowLargeText && s.btnRowLarge]}>
                <View style={narrowLargeText ? s.btnWrapLarge : s.btnWrap}><Btn title="+ ADD COINS" testID="wallet-open-recharge" onPress={() => openSheet('add')} disabled={!rechargeEnabled || !paymentUpi || !paymentQr} /></View>
                <View style={narrowLargeText ? s.btnWrapLarge : s.btnWrap}><Btn title="↩ WITHDRAW" testID="wallet-open-withdraw" kind="gold" onPress={() => openSheet('withdraw')} disabled={!withdrawalEnabled} /></View>
              </View>
              {!rechargeEnabled || !paymentUpi || !paymentQr
                ? <Text style={s.minWarn}>Coin recharge is unavailable until an administrator enables it and configures a UPI ID and QR.</Text>
                : null}
              {!withdrawalEnabled && <Text style={s.minWarn}>Withdrawals are currently disabled by the administrator.</Text>}
            </GCard>
            <Msg kind="ok" text={ok} />
            <Msg kind="err" text={error} />
            <SectionTitle>TRANSACTIONS</SectionTitle>
          </>
        }
        ListEmptyComponent={loading ? <Loading /> : <Empty icon="🧾" text="No transactions yet. Add coins or join a tournament!" />}
        renderItem={({ item }) => {
          const pos = item.amount > 0;
          const isCancellationRefund = item.reason === 'tournament_cancel_refund';
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
                    <Input testID="wallet-transaction-id" placeholder="Transaction ID / reference" value={txnId} onChangeText={setTxnId} />
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