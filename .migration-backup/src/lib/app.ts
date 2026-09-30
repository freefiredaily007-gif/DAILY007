// Shared helpers: settings, password locks, WhatsApp deep links.
import { Linking, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './data';

export type SettingRow = { id: string; key: string; value: string };

export async function getSetting(key: string): Promise<string> {
  const rows = (await api.list('settings')) as SettingRow[];
  const r = rows.find((x) => x.key === key);
  return r?.value ?? '';
}

export async function setSetting(key: string, value: string): Promise<void> {
  const rows = (await api.list('settings')) as SettingRow[];
  const r = rows.find((x) => x.key === key);
  if (r) await api.update('settings', r.id, { value });
  else await api.create('settings', { key, value });
}

export async function getHelpingAdmins(): Promise<string[]> {
  const [a, b, c] = await Promise.all([
    getSetting('helpingAdmin1'), getSetting('helpingAdmin2'), getSetting('helpingAdmin3'),
  ]);
  return [a, b, c].filter((x) => !!x && x.trim() !== '');
}

// ---------- WhatsApp ----------
export function normalizeNumber(raw: string): string {
  let n = (raw || '').replace(/[^0-9+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('0')) n = '880' + n.slice(1); // local 01xx… → 8801xx…
  return n;
}

export async function openWhatsApp(rawNumber: string): Promise<void> {
  const num = normalizeNumber(rawNumber);
  const url = 'https://wa.me/' + num;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('WhatsApp Required', 'WhatsApp is not installed on this device. Please install WhatsApp to continue.');
  }
}

// ---------- Password lock (5 wrong tries → 5 hours locked) ----------
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 60 * 1000;

type LockState = { attempts: number; lockUntil: number };

async function loadLock(area: 'admin' | 'players'): Promise<LockState> {
  try {
    const raw = await AsyncStorage.getItem('lock:' + area);
    if (raw) return JSON.parse(raw) as LockState;
  } catch { /* ignore */ }
  return { attempts: 0, lockUntil: 0 };
}

async function saveLock(area: 'admin' | 'players', s: LockState): Promise<void> {
  try { await AsyncStorage.setItem('lock:' + area, JSON.stringify(s)); } catch { /* ignore */ }
}

export async function getLockInfo(area: 'admin' | 'players'): Promise<{ locked: boolean; remainingMs: number; attemptsLeft: number }> {
  const s = await loadLock(area);
  const remaining = s.lockUntil - Date.now();
  if (remaining > 0) return { locked: true, remainingMs: remaining, attemptsLeft: 0 };
  return { locked: false, remainingMs: 0, attemptsLeft: MAX_ATTEMPTS - s.attempts };
}

/** Returns { ok } or { lockedForMs } when the area is locked. */
export async function checkLock(area: 'admin' | 'players'): Promise<{ ok: boolean; remainingMs: number }> {
  const info = await getLockInfo(area);
  return { ok: !info.locked, remainingMs: info.remainingMs };
}

export async function registerFailedAttempt(area: 'admin' | 'players'): Promise<{ nowLocked: boolean; remainingMs: number; attemptsLeft: number }> {
  const s = await loadLock(area);
  s.attempts += 1;
  if (s.attempts >= MAX_ATTEMPTS) {
    s.lockUntil = Date.now() + LOCK_MS;
    s.attempts = 0;
    await saveLock(area, s);
    return { nowLocked: true, remainingMs: LOCK_MS, attemptsLeft: 0 };
  }
  await saveLock(area, s);
  return { nowLocked: false, remainingMs: 0, attemptsLeft: MAX_ATTEMPTS - s.attempts };
}

export async function clearAttempts(area: 'admin' | 'players'): Promise<void> {
  await saveLock(area, { attempts: 0, lockUntil: 0 });
}

export function formatRemaining(ms: number): string {
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h} hour${h > 1 ? 's' : ''} ${m} min`;
  return `${m} minute${m > 1 ? 's' : ''}`;
}
