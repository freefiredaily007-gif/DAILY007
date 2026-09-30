// API client + typed wrappers for the deployed backend
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from './backendUrl';

export type User = {
  id?: string; $id?: string; name: string; email: string; phone?: string;
  gameUid?: string; coins?: number; role?: string; status?: string;
  createdAt?: string; $createdAt?: string;
  matches?: number; wins?: number; kills?: number; prizeCoins?: number; token?: string;
};

export type Tournament = {
  id: string; name: string; mode: string; teamType: string; date: string; time: string;
  entryCoins: number; prizePool: number; totalSlots: number; rules?: string;
  banner?: string; prizeDist?: string; enabled?: boolean; status?: string;
  filledSlots?: number; availableSlots?: number; roomId?: string; roomPassword?: string; roomTime?: string; roomPublished?: boolean;
};

export const http = axios.create({ baseURL: API_BASE_URL, headers: { 'Content-Type': 'application/json' } });

const KEY = 'ffd007_session';
let current: User | null = null;

export function setSession(u: User | null) {
  current = u;
  if (u) AsyncStorage.setItem(KEY, JSON.stringify(u)).catch(() => {});
  else AsyncStorage.removeItem(KEY).catch(() => {});
  if (u?.token) http.defaults.headers.common['Authorization'] = 'Bearer ' + u.token;
  else delete http.defaults.headers.common['Authorization'];
}

export async function getSession(): Promise<User | null> {
  if (current) return current;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) { const u = JSON.parse(raw); setSession(u); return u; }
  } catch {}
  return null;
}

export function errMessage(e: any): string {
  const d = e?.response?.data;
  return (d && (d.error || d.message)) || e?.message || 'Network error. Please try again.';
}

// Unwrap the server envelope { success, message, data } -> data (fall back to raw payload)
const unwrap = (p: Promise<any>) =>
  p.then((r) => {
    const d = r?.data;
    if (d && typeof d === 'object' && !Array.isArray(d) && 'success' in d && 'data' in d) return d.data;
    return d;
  });

export const Api = {
  // auth
  register: (b: { name: string; email: string; phone: string; password: string; gameUid?: string; referralCode?: string }) =>
    unwrap(http.post('/auth/register', b)),
  login: (b: { email: string; password: string }) => unwrap(http.post('/auth/login', b)),
  me: () => unwrap(http.get('/auth/me')),
  updateProfile: (b: Partial<User>) => unwrap(http.patch('/auth/me', b)),
  // tournaments
  tournaments: (qs: string | boolean = '') => unwrap(http.get('/tournaments' + (qs === true ? '?enabled=true' : qs || ''))),
  tournament: (id: string) => unwrap(http.get('/tournaments/' + id)),
  // registrations / join
  myRegistrations: () => unwrap(http.get('/my/registrations')),
  join: (id: string, b: object) => unwrap(http.post('/tournaments/' + id + '/join', b)),
  // wallet
  transactions: () => unwrap(http.get('/wallet/transactions')),
  // payments
  createPayment: (b: object) => unwrap(http.post('/payments', b)),
  myPayments: () => unwrap(http.get('/my/payments')),
  withdrawCoins: (b: { coins: number; method: string; account: string }) => unwrap(http.post('/withdrawals', b)),
  myWithdrawals: () => unwrap(http.get('/my/withdrawals')),
  videoWatch: (b: { videoId: string; percentWatched: number }) => unwrap(http.post('/videos/watch', b)),
  myReferrals: () => unwrap(http.get('/referrals')),
  // notifications
  notifications: () => unwrap(http.get('/notifications')),
  markRead: (id: string) => unwrap(http.patch('/notifications/' + id + '/read', {})),
  // leaderboard / settings (public)
  leaderboard: () => unwrap(http.get('/leaderboard')),
  settings: () => unwrap(http.get('/settings')),
  // admin
  adminStats: () => unwrap(http.get('/admin/stats')),
  adminDeletePayment: (id: string) => unwrap(http.delete('/admin/payments/' + id)),
  adminDeleteWithdrawal: (id: string) => unwrap(http.delete('/admin/withdrawals/' + id)),
  adminDeleteRegistration: (id: string) => unwrap(http.delete('/admin/registrations/' + id)),
  adminRegistrations: () => unwrap(http.get('/admin/registrations')),
  adminRegAction: (id: string, action: 'approve' | 'reject') => unwrap(http.post('/admin/registrations/' + id + '/' + action, {})),
  createTournament: (b: object) => unwrap(http.post('/tournaments', b)),
  updateTournament: (id: string, b: object) => unwrap(http.patch('/tournaments/' + id, b)),
  deleteTournament: (id: string) => unwrap(http.delete('/tournaments/' + id)),
  adminRoom: (id: string) => unwrap(http.get('/admin/tournaments/' + id + '/room')),
  adminSaveRoom: (id: string, b: object) => unwrap(http.put('/admin/tournaments/' + id + '/room', b)),
  adminPublishRoom: (id: string) => unwrap(http.post('/admin/tournaments/' + id + '/publish-room', {})),
  adminPayments: () => unwrap(http.get('/admin/payments')),
  adminWithdrawals: () => unwrap(http.get('/admin/withdrawals')),
  adminWithdrawalAction: (id: string, action: 'approve' | 'reject') => unwrap(http.post('/admin/withdrawals/' + id + '/' + action, {})),
  adminPaymentAction: (id: string, action: 'approve' | 'reject') => unwrap(http.post('/admin/payments/' + id + '/' + action, {})),
  adminApprovedRegs: (tid: string) => unwrap(http.get('/admin/registrations')),
  adminPublishResult: (b: object) => unwrap(http.post('/admin/results', b)),
  adminAdjustCoins: (id: string, coinsDelta: number, note: string) => unwrap(http.patch('/admin/users/' + id, { coinsDelta, note })),
  adminSetUser: (id: string, b: object) => unwrap(http.patch('/admin/users/' + id, b)),
  adminUsers: () => unwrap(http.get('/admin/users')),
  adminSettings: () => unwrap(http.get('/settings')),
  adminSaveSettings: (b: object) => unwrap(http.put('/admin/settings', b)),
  adminTransactions: () => unwrap(http.get('/admin/transactions')),
  adminSendNotification: (b: object) => unwrap(http.post('/admin/notifications', b)),
};

export const api = Api;
export const apiError = errMessage;
