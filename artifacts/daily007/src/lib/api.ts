// API client + typed wrappers for the deployed backend
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from './backendUrl';

export type User = {
  id?: string; $id?: string; name: string; email: string; phone?: string;
  gameUid?: string; coins?: number; role?: string; status?: string;
  createdAt?: string; $createdAt?: string;
  matches?: number; wins?: number; kills?: number; prizeCoins?: number; token?: string;
  statsError?: string;
};

export type Tournament = {
  id: string; name: string; mode: string; teamType: string; date: string; time: string;
  gameMode?: string; teamSize?: number; slotUnit?: 'player' | 'team';
  entryCoins: number; prizePool: number; totalSlots: number; rules?: string;
  banner?: string; prizeDist?: string; enabled?: boolean; status?: string;
  filledSlots?: number; filledPlayerSlots?: number; totalPlayerSlots?: number; capacityLabel?: string;
  availableSlots?: number; roomId?: string; roomPassword?: string; roomTime?: string; roomPublished?: boolean;
};

export type AdminRegistration = {
  id: string; tournamentId: string; status: string;
  playerName: string; teamName?: string; gameUid?: string;
};

export const http = axios.create({ baseURL: API_BASE_URL, headers: { 'Content-Type': 'application/json' } });

// Deliberately distinct from the legacy hosted app's AsyncStorage keys.
const KEY = 'daily007_v2_session';
let current: User | null = null;

export function setSession(u: User | null) {
  current = u;
  if (u?.token) AsyncStorage.setItem(KEY, JSON.stringify(u)).catch(() => {});
  else AsyncStorage.removeItem(KEY).catch(() => {});
  if (u?.token) http.defaults.headers.common['Authorization'] = 'Bearer ' + u.token;
  else delete http.defaults.headers.common['Authorization'];
}

export async function getSession(): Promise<User | null> {
  if (current) return current;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const u = JSON.parse(raw) as User;
      if (typeof u?.token !== 'string' || !u.token) {
        await AsyncStorage.removeItem(KEY);
        return null;
      }
      setSession(u);
      return u;
    }
  } catch {}
  return null;
}

export function currentUser(): User | null {
  return current;
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

function normalizeUser(value: any, token?: string): User {
  const account = value?.account ?? value?.user ?? value?.player ?? value;
  if (!account || typeof account !== 'object') throw new Error('The server returned an invalid account.');
  return {
    ...account,
    id: account.id ?? account.$id,
    gameUid: account.gameUid ?? account.game_uid,
    coins: Number(account.coins ?? account.wallet_coins ?? value?.wallet_coins ?? 0),
    token: token ?? value?.token ?? account.token,
  };
}

async function authenticate(path: string, body: object): Promise<{ user: User; token: string }> {
  const result = await unwrap(http.post(path, body));
  const token = result?.token ?? result?.accessToken;
  if (typeof token !== 'string' || !token) throw new Error('The server did not return an authentication token.');
  return { user: normalizeUser(result, token), token };
}

export const Api = {
  // auth
  register: (b: { name: string; email: string; phone?: string; password: string; gameUid?: string; referralCode?: string }) =>
    authenticate('/auth/register', b),
  login: (b: { email: string; password: string }) => authenticate('/auth/login', b),
  googleAuth: async (clerkJwt: string, options: { dailyToken?: string; referralCode?: string } = {}) => {
    if (!clerkJwt) throw new Error('Google sign-in did not return a verified Clerk session.');
    const result = await unwrap(http.post('/auth/google',
      options.referralCode ? { referralCode: options.referralCode } : {},
      {
        headers: {
          Authorization: `Bearer ${clerkJwt}`,
          ...(options.dailyToken ? { 'X-Daily007-Token': options.dailyToken } : {}),
        },
      },
    ));
    const token = result?.token;
    if (typeof token !== 'string' || !token) {
      throw new Error('The server did not return a Daily007 authentication token.');
    }
    const user = normalizeUser(result, token);
    if (!user.id || !user.email) {
      throw new Error('The server returned an incomplete Daily007 account.');
    }
    return { user, token };
  },
  me: async () => {
    const savedSession = current ?? await getSession();
    const user = normalizeUser(await unwrap(http.get('/auth/me')), savedSession?.token);
    try {
      const response = await unwrap(http.get('/me/stats'));
      const stats = response?.stats ?? response;
      const counters = {
        matches: Number(stats?.matches),
        wins: Number(stats?.wins),
        kills: Number(stats?.kills),
        prizeCoins: Number(stats?.prizeCoins ?? stats?.prize_coins),
      };
      if (Object.values(counters).some((value) => !Number.isFinite(value))) {
        throw new Error('Profile statistics response is incomplete.');
      }
      return { ...user, ...counters, statsError: undefined };
    } catch (e: any) {
      if (e?.response?.status === 401 || e?.response?.status === 403) throw e;
      return {
        ...user,
        matches: undefined,
        wins: undefined,
        kills: undefined,
        prizeCoins: undefined,
        statsError: errMessage(e),
      };
    }
  },
  updateProfile: (b: Partial<User>) => unwrap(http.patch('/auth/me', b)),
  // tournaments
  tournaments: (qs: string | boolean = '') => unwrap(http.get('/tournaments' + (qs === true ? '?enabled=true' : qs || ''))),
  tournament: (id: string) => unwrap(http.get('/tournaments/' + id)),
  // registrations / join
  myRegistrations: () => unwrap(http.get('/my/registrations')),
  join: (id: string, b: object) => {
    const payload = b as { playerName?: string; captainGameName?: string; gameUid?: string; teamName?: string; teamMembers?: string };
    let members: { name?: string; uid?: string }[] = [];
    try {
      members = payload.teamMembers ? JSON.parse(payload.teamMembers) : [];
    } catch {
      throw new Error('The registration form data could not be read. Please try again.');
    }
    const captain = members[0] ?? { name: payload.playerName, uid: payload.gameUid };
    const isTeam = members.length > 1;
    return unwrap(http.post(`/daily007/v2/matches/${encodeURIComponent(id)}/register`, {
      captainName: String(payload.playerName ?? '').trim(),
      captainGameName: String(payload.captainGameName ?? '').trim(),
      captainGameUid: String(payload.gameUid ?? captain.uid ?? '').trim(),
      teamName: String(payload.teamName ?? '').trim(),
      ...(isTeam ? {
        teammates: members.slice(1).map((member) => ({
          name: String(member.name ?? '').trim(),
          ...(String(member.uid ?? '').trim() ? { uid: String(member.uid).trim() } : {}),
        })),
      } : {}),
    }));
  },
  // wallet
  transactions: () => unwrap(http.get('/wallet/transactions')),
  // payments
  createPayment: (b: object) => unwrap(http.post('/payments', b)),
  myPayments: () => unwrap(http.get('/my/payments')),
  walletUploadUrl: (b: { purpose: 'payment-proof' | 'wallet-qr'; contentType: string; size: number }) =>
    unwrap(http.post('/wallet/uploads/request-url', b)),
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
  adminBootstrapStatus: () => unwrap(http.get('/daily007/v2/admin/bootstrap-status')),
  adminBootstrap: (bootstrapToken: string) =>
    unwrap(http.post('/daily007/v2/admin/bootstrap', { bootstrapToken })),
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
  adminPaymentProofUrl: (id: string) => unwrap(http.get('/admin/payments/' + encodeURIComponent(id) + '/proof-url')),
  adminWithdrawals: () => unwrap(http.get('/admin/withdrawals')),
  adminMarkWithdrawalPaid: (id: string) => unwrap(http.post('/admin/withdrawals/' + encodeURIComponent(id) + '/payout', {})),
  adminWithdrawalAction: (id: string, action: 'approve' | 'reject', reason?: string) =>
    unwrap(http.post('/admin/withdrawals/' + encodeURIComponent(id) + '/' + action, { reason })),
  adminPaymentAction: (id: string, action: 'approve' | 'reject', reason?: string) =>
    unwrap(http.post('/admin/payments/' + encodeURIComponent(id) + '/' + action, { reason })),
  adminApprovedRegs: async (tid: string): Promise<AdminRegistration[]> => {
    const registrations: unknown = await unwrap(http.get('/admin/registrations'));
    if (!Array.isArray(registrations)) throw new Error('Invalid registrations response.');
    return registrations.filter((r): r is AdminRegistration =>
      r != null && r.tournamentId === tid && r.status === 'approved');
  },
  adminPublishResult: (b: object) => unwrap(http.post('/admin/results', b)),
  adminAdjustCoins: (id: string, coinsDelta: number, note: string) => unwrap(http.patch('/admin/users/' + id, { coinsDelta, note })),
  adminSetUser: (id: string, b: object) => unwrap(http.patch('/admin/users/' + id, b)),
  adminUsers: () => unwrap(http.get('/admin/users')),
  adminSettings: () => unwrap(http.get('/admin/settings')),
  adminSaveSettings: (b: object) => unwrap(http.put('/admin/settings', b)),
  adminTransactions: () => unwrap(http.get('/admin/transactions')),
  adminSendNotification: (b: object) => unwrap(http.post('/admin/notifications', b)),
};

export const api = Api;
export const apiError = errMessage;
