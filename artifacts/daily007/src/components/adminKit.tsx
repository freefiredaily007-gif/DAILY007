// Premium admin theme kit — shared styles + primitives for the admin panel
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator, Modal, ScrollView, RefreshControl } from 'react-native';
import { ReadableText as Text, ReadableTextInput as TextInput, swapThemeColor } from './typography';
import { Feather } from '@expo/vector-icons';

export const A = {
  bg: '#070a12',
  card: 'rgba(17,22,32,0.96)',
  cardSolid: '#121821',
  border: 'rgba(77,163,255,0.09)',
  red: '#ff4b36',
  redSoft: 'rgba(255,75,54,0.15)',
  gold: '#ffb020',
  green: '#2ecc71',
  orange: '#ff7a1a',
  cyan: '#4da3ff',
  text: '#f4f2ef',
  sub: '#9aa3b2',
  danger: '#ff5c5c',
};

type ToastKind = 'ok' | 'err' | 'success' | 'error';
export const AdminToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});
export const useAdminToast = () => useContext(AdminToastCtx);

export function AdminToastHost({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((msg: string, kind: ToastKind = 'ok') => {
    setToast({ msg, kind: kind === 'error' ? 'err' : 'ok' });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  return (
    <AdminToastCtx.Provider value={show}>
      {children}
      {toast && (
        <View style={[s.toast, toast.kind === 'err' && { borderColor: A.danger, backgroundColor: 'rgba(60,10,10,0.95)' }]} pointerEvents="none">
            <Text
              accessibilityLabel={toast.msg}
              accessibilityRole={toast.kind === 'err' ? 'alert' : undefined}
              accessibilityLiveRegion={toast.kind === 'err' ? 'assertive' : 'polite'}
              style={{ color: toast.kind === 'err' ? '#ffb4b4' : '#c9f7d4', fontWeight: '800', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}
            >
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

export function StatCard({ icon, value, label, tint, onPress, trend }: { icon: keyof typeof Feather.glyphMap; value: string | number; label: string; tint: string; onPress?: () => void; trend?: string }) {
  const displayTint = swapThemeColor(tint);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.stat, pressed && { transform: [{ scale: 0.97 }] }]}>
      <View style={[s.statIcon, { backgroundColor: displayTint + '18', borderColor: displayTint + '55' }]}><Feather name={icon} size={15} color={displayTint} /></View>
      <Text style={s.statVal}>{value}</Text>
      <Text style={s.statLabel} numberOfLines={2}>{label}</Text>
      {!!trend && <Text style={[s.statTrend, { color: tint }]}>{trend}</Text>}
    </Pressable>
  );
}

export function ActionBtn({ title, onPress, kind = 'primary', loading, small, disabled, testID }: {
  title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'gold' | 'green'; loading?: boolean; small?: boolean; disabled?: boolean; testID?: string;
}) {
  const bg: Record<string, any> = {
    primary: { backgroundColor: A.red },
    ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: A.border },
    danger: { backgroundColor: 'rgba(239,68,68,0.16)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)' },
    gold: { backgroundColor: A.gold },
    green: { backgroundColor: 'rgba(34,197,94,0.16)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.5)' },
  };
  const fg: Record<string, string> = { primary: A.bg, ghost: A.text, danger: '#fca5a5', gold: '#1a1200', green: '#86efac' };
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled || loading} style={({ pressed }) => [s.btn, small && s.btnSmall, bg[kind], pressed && { opacity: 0.8 }, (disabled || loading) && { opacity: 0.5 }]}>
      {loading ? <ActivityIndicator size="small" color={fg[kind]} /> : <Text style={[s.btnTxt, small && { fontSize: 10.5 }, { color: fg[kind] }]}>{title}</Text>}
    </Pressable>
  );
}

export function StatusTag({ status, label = status }: { status: string; label?: string }) {
  const map: Record<string, any> = {
    pending: { c: A.gold, bg: 'rgba(255,193,7,0.14)' },
    approved: { c: A.green, bg: 'rgba(34,197,94,0.14)' },
    success: { c: A.green, bg: 'rgba(34,197,94,0.14)' },
    completed: { c: A.green, bg: 'rgba(34,197,94,0.14)' },
    rejected: { c: A.danger, bg: 'rgba(239,68,68,0.14)' },
    failed: { c: A.danger, bg: 'rgba(239,68,68,0.14)' },
    published: { c: A.cyan, bg: 'rgba(245,247,255,0.14)' },
    upcoming: { c: A.cyan, bg: 'rgba(245,247,255,0.14)' },
    live: { c: A.red, bg: A.redSoft },
  };
  const m = map[(status || '').toLowerCase()] || { c: A.sub, bg: 'rgba(77,163,255,0.06)' };
  return <View style={[s.tag, { backgroundColor: m.bg, borderColor: swapThemeColor(m.c) + '55' }]}><Text style={[s.tagTxt, { color: m.c }]}>{(label || '—').toUpperCase()}</Text></View>;
}

export function ConfirmDialog({ visible, title, message, onCancel, onConfirm, confirmTitle = 'CONFIRM', danger, cancelTestID, confirmTestID }: {
  visible: boolean; title: string; message: string; onCancel: () => void; onConfirm: () => void; confirmTitle?: string; danger?: boolean; cancelTestID?: string; confirmTestID?: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.overlay}>
        <View style={s.dialog}>
          <Text style={s.dialogTitle}>{title}</Text>
          <Text style={s.dialogMsg}>{message}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <View style={{ flex: 1 }}><ActionBtn title="CANCEL" kind="ghost" onPress={onCancel} testID={cancelTestID} /></View>
            <View style={{ flex: 1 }}><ActionBtn title={confirmTitle} kind={danger ? 'danger' : 'primary'} onPress={onConfirm} testID={confirmTestID} /></View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function PromptDialog({
  visible,
  title,
  message,
  onCancel,
  onSubmit,
  confirmTitle = 'OK',
  keyboardType,
  placeholder,
  autoCapitalize,
  autoCorrect,
  accessibilityLabel,
  inputTestID,
  cancelTestID,
  confirmTestID,
}: {
  visible: boolean;
  title: string;
  message?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
  confirmTitle?: string;
  keyboardType?: any;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  accessibilityLabel?: string;
  inputTestID?: string;
  cancelTestID?: string;
  confirmTestID?: string;
}) {
  const [val, setVal] = useState('');
  const close = () => {
    setVal('');
    onCancel();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={s.overlay}>
        <View style={s.dialog}>
          <Text style={s.dialogTitle}>{title}</Text>
          {!!message && <Text style={s.dialogMsg}>{message}</Text>}
          <TextInput
            value={val}
            onChangeText={setVal}
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            autoCorrect={autoCorrect}
            autoFocus
            accessibilityLabel={accessibilityLabel ?? title}
            testID={inputTestID}
            placeholder={placeholder}
            placeholderTextColor="#5b6478"
            style={[s.input, { marginTop: 12 }]}
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <View style={{ flex: 1 }}><ActionBtn title="CANCEL" kind="ghost" onPress={close} testID={cancelTestID} /></View>
            <View style={{ flex: 1 }}><ActionBtn title={confirmTitle} onPress={() => { onSubmit(val); setVal(''); }} testID={confirmTestID} /></View>
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

export function SectionTitle({ children, right, title, sub, icon }: { children?: React.ReactNode; right?: React.ReactNode; title?: string; sub?: string; icon?: keyof typeof Feather.glyphMap }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          {icon ? <Feather name={icon} size={14} color={A.orange} /> : null}
          <Text style={s.sectionTitle}>{title ?? children}</Text>
        </View>
        {sub ? <Text style={{ color: A.sub, fontSize: 11, fontFamily: 'Inter_400Regular' }}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}><Feather name="inbox" size={20} color={A.orange} /></View>
      <Text style={{ color: A.sub, fontSize: 12, fontFamily: 'Inter_500Medium', textAlign: 'center' }}>{text}</Text>
    </View>
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
export { Chip } from './ui';
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
  toast: { position: 'absolute', bottom: 96, left: 20, right: 20, backgroundColor: 'rgba(8,30,16,0.96)', borderColor: 'rgba(46,204,113,0.45)', borderWidth: 1, borderRadius: 12, padding: 12, zIndex: 99, elevation: 8 },
  card: { backgroundColor: A.card, borderRadius: 14, borderWidth: 1, borderColor: A.border, borderTopColor: 'rgba(255,176,32,0.24)', padding: 14, paddingVertical: 14.5, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  stat: { flexBasis: '31%', flexGrow: 1, backgroundColor: 'rgba(17,22,32,0.98)', borderRadius: 12, borderWidth: 1, borderColor: A.border, padding: 10, paddingVertical: 10.5, alignItems: 'flex-start', borderTopColor: 'rgba(255,176,32,0.22)' },
  statIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 7 },
  statVal: { color: A.text, fontSize: 19, fontWeight: '900', fontFamily: 'Inter_700Bold' },
  statLabel: { color: A.sub, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.3, marginTop: 2, fontFamily: 'Inter_500Medium' },
  statTrend: { fontSize: 9, fontWeight: '800', marginTop: 3 },
  btn: { borderRadius: 10, paddingVertical: 12.5, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', minWidth: 48, minHeight: 48 },
  btnSmall: { paddingVertical: 7.5, paddingHorizontal: 10, borderRadius: 8, minWidth: 48, minHeight: 48 },
  btnTxt: { fontWeight: '900', fontSize: 11.5, letterSpacing: 0.8, fontFamily: 'Inter_700Bold' },
  tag: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 4.5, alignSelf: 'flex-start' },
  tagTxt: { fontSize: 8.5, fontWeight: '900', letterSpacing: 0.7, fontFamily: 'Inter_700Bold' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: A.cardSolid, borderRadius: 16, borderWidth: 1, borderColor: A.border, padding: 18, width: '100%', borderTopColor: 'rgba(255,122,26,0.55)' },
  dialogTitle: { color: A.text, fontWeight: '900', fontSize: 15, marginBottom: 6, fontFamily: 'Inter_700Bold' },
  dialogMsg: { color: A.sub, fontSize: 12.5, lineHeight: 18, fontFamily: 'Inter_400Regular' },
  fieldLabel: { color: A.sub, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6, fontFamily: 'Inter_600SemiBold' },
  input: { backgroundColor: '#0e131b', borderWidth: 1, borderColor: 'rgba(77,163,255,0.11)', borderRadius: 10, color: A.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, fontFamily: 'Inter_400Regular' },
  sectionTitle: { color: A.text, fontSize: 12, fontWeight: '900', letterSpacing: 1.05, fontFamily: 'Inter_700Bold' },
  empty: { padding: 22, alignItems: 'center', borderWidth: 1, borderColor: A.border, borderRadius: 12, borderStyle: 'dashed', gap: 8 },
  emptyIcon: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,122,26,0.25)', backgroundColor: 'rgba(255,122,26,0.08)', alignItems: 'center', justifyContent: 'center' },
});