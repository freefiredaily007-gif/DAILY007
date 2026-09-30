import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Api, apiError } from '../lib/api';
import { Btn, Card, C, Input, Loading, Msg } from '../components/ui';

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
];

export default function AdminSettings() {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await Api.adminSettings();
      const s = response?.settings ?? response ?? {};
      const map: Record<string, string> = {};
      for (const [k] of FIELDS) map[k] = s[k] ?? '';
      setVals(map);
    } catch (e: any) { setErr(apiError(e)); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setErr(''); setOkMsg(''); setBusy(true);
    try { await Api.adminSaveSettings(vals); setOkMsg('Settings saved'); setTimeout(() => setOkMsg(''), 2000); }
    catch (e: any) { setErr(apiError(e)); }
    finally { setBusy(false); }
  };

  if (!loaded) return <Loading />;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={st.wrap}>
      <Text style={st.h}>⚙️ SETTINGS</Text>
      <Msg kind="err" text={err} />
      <Msg kind="ok" text={okMsg} />
      <Text style={st.notice}>Coin payments and withdrawal requests require manual review. Payouts are not automatic.</Text>
      <Card>
        {FIELDS.map(([k, label, ph]) => (
          <Input key={k} placeholder={`${label} — ${ph}`} value={vals[k] ?? ''} onChangeText={(v) => setVals((s) => ({ ...s, [k]: v }))} />
        ))}
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
});
