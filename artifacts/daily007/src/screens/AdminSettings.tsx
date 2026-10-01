import React, { useCallback, useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Api, apiError } from '../lib/api';
import { Btn, Card, C, Input, Loading, Msg } from '../components/ui';
import { uploadWalletImage } from '../lib/walletImages';

const FIELDS: [string, string, string][] = [
  ['appName', 'App Name', 'Free Fire Daily007'],
  ['whatsappLink', 'WhatsApp Group URL', 'https://chat.whatsapp.com/...'],
  ['instagramLink', 'Instagram URL', 'https://instagram.com/...'],
  ['youtubeLink', 'YouTube URL', 'https://youtube.com/...'],
  ['upiId', 'Payment UPI ID', 'UPI ID for manual coin payments'],
  ['paymentNote', 'Payment Instructions', 'Manual payment verification instructions'],
  ['supportContact', 'Support Contact', 'WhatsApp: +91-...'],
  ['minPurchase', 'Min coin purchase', '100'],
  ['maxPurchase', 'Max coin purchase', '5000'],
  ['coinPackages', 'Coin packages', '100, 250, 500, 1000'],
  ['minWithdrawal', 'Minimum withdrawal coins', '100 minimum'],
  ['maxWithdrawal', 'Maximum withdrawal coins', '5000'],
  ['coinToMoneyRate', 'Rupees per coin', '1'],
];

export default function AdminSettings() {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [qrBusy, setQrBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await Api.adminSettings();
      const s = response?.settings ?? response ?? {};
      const map: Record<string, string> = {};
      for (const [k] of FIELDS) map[k] = String(s[k] ?? '');
      map.rechargeEnabled = String(s.rechargeEnabled === true || s.rechargeEnabled === 'true');
      map.withdrawalEnabled = String(s.withdrawalEnabled === true || s.withdrawalEnabled === 'true');
      map.upiQrObjectPath = String(s.upiQrObjectPath ?? '');
      setQrUrl(String(s.upiQrUrl ?? ''));
      setVals(map);
    } catch (e: any) { setErr(apiError(e)); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setErr(''); setOkMsg(''); setBusy(true);
    try {
      const saved = await Api.adminSaveSettings(vals);
      setQrUrl(String(saved?.upiQrUrl ?? qrUrl));
      setOkMsg('Settings saved');
      setTimeout(() => setOkMsg(''), 2500);
    }
    catch (e: any) { setErr(apiError(e)); }
    finally { setBusy(false); }
  };

  const chooseQr = async () => {
    setErr(''); setOkMsg('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
        allowsEditing: false,
      });
      if (result.canceled || !result.assets[0]) return;
      setQrBusy(true);
      const path = await uploadWalletImage(result.assets[0], 'wallet-qr');
      setVals((current) => ({ ...current, upiQrObjectPath: path }));
      setQrUrl(result.assets[0].uri);
      setOkMsg('QR uploaded. Save settings to publish this payment destination.');
    } catch (e: any) { setErr(apiError(e)); }
    finally { setQrBusy(false); }
  };

  if (!loaded) return <Loading />;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <Text style={st.h}>⚙️ SETTINGS</Text>
      <Msg kind="err" text={err} />
      <Msg kind="ok" text={okMsg} />
      <Text style={st.notice}>Coin payments and withdrawals require manual review. Recharge approval is the only way coins are credited; payouts are sent separately.</Text>
      <Card>
        {FIELDS.map(([k, label, ph]) => (
          <Input
            key={k}
            placeholder={`${label} — ${ph}`}
            value={vals[k] ?? ''}
            keyboardType={k === 'coinToMoneyRate' ? 'decimal-pad' : ['minPurchase', 'maxPurchase', 'minWithdrawal', 'maxWithdrawal'].includes(k) ? 'number-pad' : 'default'}
            onChangeText={(v) => setVals((s) => ({ ...s, [k]: v }))}
          />
        ))}
        <View style={st.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.switchTitle}>Allow manual UPI recharge</Text>
            <Text style={st.switchNote}>Players can submit a UTR and payment screenshot for admin review.</Text>
          </View>
          <Switch
            value={vals.rechargeEnabled === 'true'}
            onValueChange={(value) => setVals((s) => ({ ...s, rechargeEnabled: String(value) }))}
            trackColor={{ false: C.line, true: C.green + '99' }}
            thumbColor={vals.rechargeEnabled === 'true' ? C.green : C.sub}
          />
        </View>
        <View style={st.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.switchTitle}>Allow withdrawal requests</Text>
            <Text style={st.switchNote}>Approval records a manual payout; it does not send money automatically.</Text>
          </View>
          <Switch
            value={vals.withdrawalEnabled === 'true'}
            onValueChange={(value) => setVals((s) => ({ ...s, withdrawalEnabled: String(value) }))}
            trackColor={{ false: C.line, true: C.green + '99' }}
            thumbColor={vals.withdrawalEnabled === 'true' ? C.green : C.sub}
          />
        </View>
        <Text style={st.fieldTitle}>UPI payment QR</Text>
        <Text style={st.switchNote}>Upload the QR that matches the UPI ID above. Confirm the recipient details before enabling payments.</Text>
        {qrUrl ? <Image source={{ uri: qrUrl }} resizeMode="contain" style={st.qr} /> : null}
        <Btn title={qrBusy ? 'UPLOADING QR…' : qrUrl ? 'CHANGE PAYMENT QR' : 'UPLOAD PAYMENT QR'} kind="ghost" onPress={chooseQr} loading={qrBusy} />
        <Btn title="💾 SAVE SETTINGS" onPress={save} loading={busy} />
      </Card>
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 30 },
  h: { color: C.text, fontSize: 20, fontWeight: '900', marginBottom: 10, letterSpacing: 1 },
  notice: { color: C.gold, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line },
  switchTitle: { color: C.text, fontWeight: '800', fontSize: 13 },
  switchNote: { color: C.sub, fontSize: 11, lineHeight: 16, marginTop: 3, marginBottom: 8 },
  fieldTitle: { color: C.text, fontWeight: '800', fontSize: 13, marginTop: 14, marginBottom: 4 },
  qr: { width: 190, height: 190, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 10, marginVertical: 8 },
});
