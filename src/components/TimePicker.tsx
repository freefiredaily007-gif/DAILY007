import { Text, View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useState } from 'react';

const HOURS = ['1','2','3','4','5','6','7','8','9','10','11','12'];
const MINUTES = ['00','05','10','15','20','25','30','35','40','45','50','55'];

export default function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // value is stored/displayed as "8:30 PM"
  const [h, m, ap] = (value || '8:30 PM').split(/[: ]/);
  const [hour, setHour] = useState(h || '8');
  const [min, setMin] = useState(m || '30');
  const [ampm, setAmpm] = useState(ap || 'PM');

  const commit = (H = hour, M = min, A = ampm) => onChange(`${H}:${M} ${A}`);

  return (
    <View style={s.wrap}>
      <Text style={s.label}>Time (12-hour)</Text>
      <View style={s.row}>
        <ScrollView style={s.col} showsVerticalScrollIndicator={false}>
          {HOURS.map((x) => (
            <Pressable key={x} onPress={() => { setHour(x); commit(x, min, ampm); }} style={[s.cell, hour === x && s.cellOn]}>
              <Text style={[s.cellT, hour === x && s.cellTOn]}>{x}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView style={s.col} showsVerticalScrollIndicator={false}>
          {MINUTES.map((x) => (
            <Pressable key={x} onPress={() => { setMin(x); commit(hour, x, ampm); }} style={[s.cell, min === x && s.cellOn]}>
              <Text style={[s.cellT, min === x && s.cellTOn]}>{x}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={s.col}>
          {['AM', 'PM'].map((x) => (
            <Pressable key={x} onPress={() => { setAmpm(x); commit(hour, min, x); }} style={[s.cell, s.apCell, ampm === x && s.cellOn]}>
              <Text style={[s.cellT, ampm === x && s.cellTOn]}>{x}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Text style={s.preview}>Selected: {hour}:{min} {ampm}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: '#11172b', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#232a45' },
  label: { color: '#9aa3b2', fontSize: 12, marginBottom: 8 },
  row: { flexDirection: 'row', height: 130 },
  col: { flex: 1, marginHorizontal: 3 },
  cell: { paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  apCell: { marginBottom: 8 },
  cellOn: { backgroundColor: '#7aa2f7' },
  cellT: { color: '#e6e9ef', fontSize: 14 },
  cellTOn: { color: '#0b1020', fontWeight: '700' },
  preview: { color: '#7aa2f7', marginTop: 8, fontWeight: '700' },
});
