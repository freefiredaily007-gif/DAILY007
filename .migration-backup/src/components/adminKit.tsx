// Premium admin theme kit — shared styles + primitives for the admin panel
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Modal, ScrollView, TextInput, RefreshControl } from 'react-native';

export const A = {
  bg: '#070a14',
  card: 'rgba(20,26,44,0.72)',
  cardSolid: '#141a2c',
  border: 'rgba(255,255,255,0.08)',
  red: '#ff2d55',
  redSoft: 'rgba(255,45,85,0.14)',
  gold: '#ffc107',
  green: '#22c55e',
  orange: '#ff9f0a',
  cyan: '#22d3ee',
  text: '#eef1f8',
  sub: '#8b93a7',
  danger: '#ef4444',
};

export const AdminToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => {});
export const useAdminToast = () => useContext(AdminToastCtx);

export function AdminToastHost({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  return (
    <AdminToastCtx.Provider value={show}>
      {children}
      {toast && (
        <View style={[s.toast, toast.kind === 'err' && { borderColor: A.danger, backgroundColor: 'rgba(60,10,10,0.95)' }]} pointerEvents="none">
          <Text style={{ color: toast.kind === 'err' ? '#ffb4b4' : '#c9f7d4', fontWeight: '800', fontSize: 12 }}>
            {toast.kind === 'err' ? '✕ ' : '✓ '}{toast.msg}
          </Text>
        </View>
      )}
    </AdminToastCtx.Provider>
  );
}

export function GlassCard({ children, style, onPress }: { children: React.ReactNode; style?: any; onPress?: () => void }) {
  if (onPress) return <Pressable onPress={onPress} style={({ pressed }) => [s.card, style, pressed && { opacity: 0.85 }]}>{children}</Pressable>;
  return <View style={[s.card, style]}>{children}</View>;
}

export function StatCard({ icon, value, label, tint, onPress, trend }: { icon: string; value: string | number; label: string; tint: string; onPress?: () => void; trend?: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.stat, pressed && { transform: [{ scale: 0.97 }] }]}>
      <View style={[s.statIcon, { backgroundColor: tint + '22', borderColor: tint + '55' }]}><Text style={{ fontSize: 15 }}>{icon}</Text></View>
      <Text style={s.statVal}>{value}</Text>
      <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
      {!!trend && <Text style={[s.statTrend, { color: tint }]}>{trend}</Text>}
    </Pressable>
  );
}

export function ActionBtn({ title, onPress, kind = 'primary', loading, small, disabled }: {
  title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'gold' | 'green'; loading?: boolean; small?: boolean; disabled?: boolean;
}) {
  const bg: Record<string, any> = {
    primary: { backgroundColor: A.red },
    ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: A.border },
    danger: { backgroundColor: 'rgba(239,68,68,0.16)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)' },
    gold: { backgroundColor: A.gold },
    green: { backgroundColor: 'rgba(34,197,94,0.16)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.5)' },
  };
  const fg: Record<string, string> = { primary: '#fff', ghost: A.text, danger: '#fca5a5', gold: '#1a1200', green: '#86efac' };
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} style={({ pressed }) => [s.btn, small && s.btnSmall, bg[kind], pressed && { opacity: 0.8 }, (disabled || loading) && { opacity: 0.5 }]}>
      {loading ? <ActivityIndicator size="small" color={fg[kind]} /> : <Text style={[s.btnTxt, small && { fontSize: 10.5 }, { color: fg[kind] }]}>{title}</Text>}
    </Pressable>
  );
}

export function StatusTag({ status }: { status: string }) {
  const map: Record<string, any> = {
    pending: { c: A.gold, bg: 'rgba(255,193,7,0.14)' },
    approved: { c: A.green, bg: 'rgba(34,197,94,0.14)' },
    success: { c: A.green, bg: 'rgba(34,197,94,0.14)' },
    completed: { c: A.green, bg: 'rgba(34,197,94,0.14)' },
    rejected: { c: A.danger, bg: 'rgba(239,68,68,0.14)' },
    failed: { c: A.danger, bg: 'rgba(239,68,68,0.14)' },
    published: { c: A.cyan, bg: 'rgba(34,211,238,0.14)' },
    upcoming: { c: A.cyan, bg: 'rgba(34,211,238,0.14)' },
    live: { c: A.red, bg: A.redSoft },
  };
  const m = map[(status || '').toLowerCase()] || { c: A.sub, bg: 'rgba(255,255,255,0.06)' };
  return <View style={[s.tag, { backgroundColor: m.bg, borderColor: m.c + '55' }]}><Text style={[s.tagTxt, { color: m.c }]}>{(status || '—').toUpperCase()}</Text></View>;
}

export function ConfirmDialog({ visible, title, message, onCancel, onConfirm, confirmTitle = 'CONFIRM', danger }: {
  visible: boolean; title: string; message: string; onCancel: () => void; onConfirm: () => void; confirmTitle?: string; danger?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.overlay}>
        <View style={s.dialog}>
          <Text style={s.dialogTitle}>{title}</Text>
          <Text style={s.dialogMsg}>{message}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <View style={{ flex: 1 }}><ActionBtn title="CANCEL" kind="ghost" onPress={onCancel} /></View>
            <View style={{ flex: 1 }}><ActionBtn title={confirmTitle} kind={danger ? 'danger' : 'primary'} onPress={onConfirm} /></View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function PromptDialog({ visible, title, message, onCancel, onSubmit, confirmTitle = 'OK', keyboardType }: {
  visible: boolean; title: string; message?: string; onCancel: () => void; onSubmit: (value: string) => void; confirmTitle?: string; keyboardType?: any;
}) {
  const [val, setVal] = useState('');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.overlay}>
        <View style={s.dialog}>
          <Text style={s.dialogTitle}>{title}</Text>
          {!!message && <Text style={s.dialogMsg}>{message}</Text>}
          <TextInput value={val} onChangeText={setVal} keyboardType={keyboardType} autoFocus placeholderTextColor="#5b6478" style={[s.input, { marginTop: 12 }]} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <View style={{ flex: 1 }}><ActionBtn title="CANCEL" kind="ghost" onPress={onCancel} /></View>
            <View style={{ flex: 1 }}><ActionBtn title={confirmTitle} onPress={() => { onSubmit(val); setVal(''); }} /></View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

export function Input({ value, onChangeText, placeholder, keyboardType, multiline, autoCapitalize }: {
  value: string; onChangeText: (t: string) => void; placeholder?: string; keyboardType?: any; multiline?: boolean; autoCapitalize?: any;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#5b6478"
      keyboardType={keyboardType}
      multiline={multiline}
      autoCapitalize={autoCapitalize}
      style={[s.input, multiline && { minHeight: 70, textAlignVertical: 'top' }]}
    />
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <Text style={s.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={s.empty}><Text style={{ color: A.sub, fontSize: 12 }}>{text}</Text></View>
  );
}

export function Loading() {
  return (
    <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={A.red} size="large" /></View>
  );
}

// Aliases used by management screens
export const Card = GlassCard;
export const Btn = ActionBtn;
export const useToast = useAdminToast;
export function ScreenWrap({ children, onRefresh }: { children: React.ReactNode; onRefresh?: () => void }) {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 14, paddingBottom: 110 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await onRefresh(); setRefreshing(false); }} tintColor={A.red} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  toast: { position: 'absolute', bottom: 96, left: 20, right: 20, backgroundColor: 'rgba(8,30,16,0.95)', borderColor: 'rgba(34,197,94,0.5)', borderWidth: 1, borderRadius: 12, padding: 12, zIndex: 99 },
  card: { backgroundColor: A.card, borderRadius: 16, borderWidth: 1, borderColor: A.border, padding: 14 },
  stat: { flexBasis: '31%', flexGrow: 1, backgroundColor: A.card, borderRadius: 14, borderWidth: 1, borderColor: A.border, padding: 10, alignItems: 'flex-start' },
  statIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 6 },
  statVal: { color: A.text, fontSize: 19, fontWeight: '900' },
  statLabel: { color: A.sub, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.3, marginTop: 2 },
  statTrend: { fontSize: 9, fontWeight: '800', marginTop: 3 },
  btn: { borderRadius: 10, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8 },
  btnTxt: { fontWeight: '900', fontSize: 12, letterSpacing: 0.6 },
  tag: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3, alignSelf: 'flex-start' },
  tagTxt: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: A.cardSolid, borderRadius: 18, borderWidth: 1, borderColor: A.border, padding: 18, width: '100%' },
  dialogTitle: { color: A.text, fontWeight: '900', fontSize: 15, marginBottom: 6 },
  dialogMsg: { color: A.sub, fontSize: 12.5, lineHeight: 18 },
  fieldLabel: { color: A.sub, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6, marginBottom: 6 },
  input: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: A.border, borderRadius: 10, color: A.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  sectionTitle: { color: A.text, fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  empty: { padding: 24, alignItems: 'center', borderWidth: 1, borderColor: A.border, borderRadius: 12, borderStyle: 'dashed' },
});