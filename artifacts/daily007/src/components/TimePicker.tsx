import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { ReadableText as Text } from './typography';
import { useState } from 'react';
import colors from '../../constants/colors';

const theme = colors.light;

const HOURS = ['1','2','3','4','5','6','7','8','9','10','11','12'];
const MINUTES = ['00','05','10','15','20','25','30','35','40','45','50','55'];

export default function TimePicker({ value, onChange, variant = 'default' }: { value: string; onChange: (v: string) => void; variant?: 'default' | 'admin' }) {
  const admin = variant === 'admin';
  // value is stored/displayed as "8:30 PM"
  const [h, m, ap] = (value || '8:30 PM').split(/[: ]/);
  const [hour, setHour] = useState(h || '8');
  const [min, setMin] = useState(m || '30');
  const [ampm, setAmpm] = useState(ap || 'PM');

  const commit = (H = hour, M = min, A = ampm) => onChange(`${H}:${M} ${A}`);

  return (
    <View style={[s.wrap, admin && s.adminWrap]}>
      <Text style={[s.label, admin && s.adminLabel]}>Time (12-hour)</Text>
      <View style={s.row}>
        <ScrollView style={s.col} showsVerticalScrollIndicator={false}>
          {HOURS.map((x) => (
            <Pressable key={x} onPress={() => { setHour(x); commit(x, min, ampm); }} style={[s.cell, admin && s.adminCell, hour === x && s.cellOn, admin && hour === x && s.adminCellOn]}>
              <Text style={[s.cellT, admin && s.adminCellT, hour === x && s.cellTOn, admin && hour === x && s.adminCellTOn]}>{x}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView style={s.col} showsVerticalScrollIndicator={false}>
          {MINUTES.map((x) => (
            <Pressable key={x} onPress={() => { setMin(x); commit(hour, x, ampm); }} style={[s.cell, admin && s.adminCell, min === x && s.cellOn, admin && min === x && s.adminCellOn]}>
              <Text style={[s.cellT, admin && s.adminCellT, min === x && s.cellTOn, admin && min === x && s.adminCellTOn]}>{x}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={s.col}>
          {['AM', 'PM'].map((x) => (
            <Pressable key={x} onPress={() => { setAmpm(x); commit(hour, min, x); }} style={[s.cell, s.apCell, admin && s.adminCell, ampm === x && s.cellOn, admin && ampm === x && s.adminCellOn]}>
              <Text style={[s.cellT, admin && s.adminCellT, ampm === x && s.cellTOn, admin && ampm === x && s.adminCellTOn]}>{x}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Text style={[s.preview, admin && s.adminPreview]}>Selected: {hour}:{min} {ampm}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: theme.card, borderRadius: 14, padding: 10, borderWidth: 1, borderColor: theme.border },
  label: { color: theme.mutedForeground, fontSize: 12, marginBottom: 8 },
  row: { flexDirection: 'row', height: 130 },
  col: { flex: 1, marginHorizontal: 3 },
  cell: { paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  apCell: { marginBottom: 8 },
  cellOn: { backgroundColor: theme.primary },
  cellT: { color: '#E4EAFF', fontSize: 14 },
  cellTOn: { color: theme.primaryForeground, fontWeight: '700' },
  preview: { color: theme.accent, marginTop: 8, fontWeight: '700' },
  adminWrap: { backgroundColor: theme.card, borderColor: theme.border, borderRadius: 14 },
  adminLabel: { color: theme.mutedForeground, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.3 },
  adminCell: { borderRadius: 8 },
  adminCellOn: { backgroundColor: theme.primary },
  adminCellT: { fontFamily: 'Inter_500Medium' },
  adminCellTOn: { color: theme.primaryForeground, fontFamily: 'Inter_700Bold' },
  adminPreview: { color: theme.accent, fontFamily: 'Inter_700Bold' },
});
