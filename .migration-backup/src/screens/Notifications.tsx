// Notifications — list of user's notifications
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Api } from '../lib/api';
import { C, Card, Empty } from '../components/ui';

export default function Notifications() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Api.notifications()
      .then((r: any) => setItems(Array.isArray(r) ? r : r?.documents ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <View style={s.wrap}><ActivityIndicator color={C.neon} style={{ marginTop: 60 }} /></View>;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 14, gap: 10 }}>
      {items.length === 0 && <Empty icon="🔔" text="No notifications yet" />}
      {items.map((n) => (
        <Card key={n.$id ?? n.id}>
          <Text style={s.title}>{n.title ?? 'Notice'}</Text>
          <Text style={s.body}>{n.body ?? n.message ?? ''}</Text>
          <Text style={s.time}>{String(n.$createdAt ?? n.createdAt ?? '').slice(0, 16).replace('T', ' ')}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  title: { color: C.text, fontWeight: '800', fontSize: 15 },
  body: { color: C.sub, fontSize: 13, marginTop: 4, lineHeight: 19 },
  time: { color: C.sub, fontSize: 11, marginTop: 8, opacity: 0.7 },
});
