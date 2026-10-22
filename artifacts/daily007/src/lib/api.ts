// API client + typed wrappers for the deployed backend
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthExpiredHandler as setGeneratedAuthExpiredHandler } from '@workspace/api-client-react';
import { API_BASE_URL } from './backendUrl';
import { isBlockedAccountError, type SessionExpiredReason } from './session-verification';
import { isAppLanguage } from '../i18n/languagePreference';
import type { AppLanguage } from '../i18n/languagePreference';

export type Daily007Role = 'user' | 'tournament_admin' | 'admin';

export type User = {
  id?: string; $id?: string; name: string; email: string; phone?: string;
  gameUid?: string; coins?: number; role?: Daily007Role; status?: string;
  createdAt?: string; $createdAt?: string; googleLinked?: boolean;
  matches?: number; wins?: number; kills?: number; prizeCoins?: number; token?: string;
  statsError?: string;
};

export type WithdrawalPayoutStatus = 'not_paid' | 'manual_payout_required' | 'paid';

export type AdminWithdrawal = {
  id: string;
  userId: string;
  userName: string;
  coins: number;
  method: string;
  account: string;
  status: 'pending' | 'approved' | 'rejected';
  payoutStatus: WithdrawalPayoutStatus;
  reviewReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type AdminWithdrawalPayoutResult = {
  id: string;
  payoutStatus: 'paid';
  alreadyRecorded?: boolean;
};

export type Tournament = {
  id: string; name: string; mode: string; teamType: string; date: string; time: string;
  startsAt?: string;
  gameMode?: string; teamSize?: number; slotUnit?: 'player' | 'team';
  entryCoins: number; prizePool: number; totalSlots: number; rules?: string;
  banner?: string; imageUrl?: string | null; prizeDist?: string; enabled?: boolean; status?: string;
  filledSlots?: number; filledPlayerSlots?: number; totalPlayerSlots?: number; capacityLabel?: string;
  availableSlots?: number; roomId?: string; roomPassword?: string; roomTime?: string; roomPublished?: boolean;
};

export type AdminRegistration = {
  id: string; tournamentId: string; status: string;
  playerName: string; tournamentName?: string; userName?: string;
  captainGameName?: string; captainGameUid?: string; teamName?: string;
  teamMembers?: unknown; gameUid?: string; mode?: string;
  gameMode?: string; teamType?: string; createdAt?: string;
  entryCoins?: number;
  teamNumber?: number | null; slotNumber?: number | null; isSquadCaptain?: boolean;
  assignedGroupNumber?: number | null;
  startsAt?: string | null; totalPlayerSlots?: number;
};

export type AccountRecoveryRequest = {
  id: string;
  userId: string;
  googleEmail: string;
  createdAt: string;
  accountName: string;
  accountEmail: string;
  phone: string | null;
  gameUid: string | null;
  accountRole: Daily007Role;
};

export const http = axios.create({ baseURL: API_BASE_URL, headers: { 'Content-Type': 'application/json' } });
const LIVE_DATA_HEADERS = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' };

export function newAdminAdjustmentRequestId(): string {
  const timestamp = Date.now().toString(16).padStart(12, '0').slice(-12);
  const randomHex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  const randomPart = `${randomHex()}${randomHex()}${randomHex()}${randomHex()}${randomHex()}`;
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16);
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-4${randomPart.slice(0, 3)}-${variant}${randomPart.slice(3, 6)}-${randomPart.slice(6, 18)}`;
}

// Deliberately distinct from the legacy hosted app's AsyncStorage keys.
const KEY = 'daily007_v2_session';
const SIGNED_OUT_SESSION_RECORD = JSON.stringify({ __daily007SignedOut: true });
let current: User | null = null;
let sessionExpiredHandler: ((reason?: SessionExpiredReason) => void) | null = null;
let sessionRevision = 0;
let sessionPersistenceQueue: Promise<void> = Promise.resolve();
let devSessionPersistenceFailuresRemainingForTest = 0;

export type SessionIdentity = {
  revision: number;
  accountId: string | undefined;
  token: string;
};

export class SessionPersistenceError extends Error {
  constructor() {
    super('Daily007 could not save your session on this device. Check available storage and try again.');
    this.name = 'SessionPersistenceError';
  }
}

export function setDevSessionPersistenceFailuresForTest(count: number): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  devSessionPersistenceFailuresRemainingForTest = Number.isFinite(count)
    ? Math.max(0, Math.floor(count))
    : 0;
}

export class LoginRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'LoginRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function activateSession(u: User | null): void {
  current = u;
  if (u?.token) http.defaults.headers.common['Authorization'] = 'Bearer ' + u.token;
  else delete http.defaults.headers.common['Authorization'];
}

function accountIdOf(user: User | null): string | undefined {
  return user?.id ?? user?.$id;
}

export function captureSessionIdentity(): SessionIdentity | null {
  if (!current?.token) return null;
  return {
    revision: sessionRevision,
    accountId: accountIdOf(current),
    token: current.token,
  };
}

export function captureSessionRevision(): number {
  return sessionRevision;
}

export function isSessionIdentityCurrent(identity: SessionIdentity): boolean {
  return Boolean(current?.token) &&
    sessionRevision === identity.revision &&
    current?.token === identity.token &&
    accountIdOf(current) === identity.accountId;
}

function persistSessionMutation(user: User | null, revision: number): Promise<boolean> {
  const operation = sessionPersistenceQueue.catch(() => {}).then(async () => {
    if (revision !== sessionRevision) return false;
    if (user?.token && devSessionPersistenceFailuresRemainingForTest > 0) {
      devSessionPersistenceFailuresRemainingForTest -= 1;
      throw new Error('Injected dev-only session persistence failure.');
    }
    if (user?.token) await AsyncStorage.setItem(KEY, JSON.stringify(user));
    else await AsyncStorage.removeItem(KEY);
    if (revision !== sessionRevision) return false;
    activateSession(user?.token ? user : null);
    return true;
  });
  sessionPersistenceQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

const AUTH_ENTRY_PATHS = [
  '/auth/login',
  '/auth/register',
  '/daily007/v2/auth/login',
  '/daily007/v2/auth/register',
  '/auth/google',
  '/auth/google/recovery-request',
  '/auth/google/recovery-owner',
];

export function setSessionExpiredHandler(
  handler: ((reason?: SessionExpiredReason) => void) | null,
): void {
  sessionExpiredHandler = handler;
  setGeneratedAuthExpiredHandler(handler);
}

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = String(error?.config?.url ?? '').split('?')[0];
    const isAuthEntry = AUTH_ENTRY_PATHS.some((path) => url === path || url.endsWith(path));
    const responseMessage = error?.response?.data?.error;
    const googleLinkRejectedOldSession = url.endsWith('/auth/google') &&
      typeof responseMessage === 'string' &&
      responseMessage.includes('Daily007 session was replaced');
    const requestHeaders = error?.config?.headers;
    const requestAuthorization = typeof requestHeaders?.get === 'function'
      ? requestHeaders.get('Authorization')
      : requestHeaders?.Authorization ?? requestHeaders?.authorization;
    const requestToken = typeof requestAuthorization === 'string' &&
      requestAuthorization.startsWith('Bearer ')
      ? requestAuthorization.slice('Bearer '.length)
      : null;
    const rejectedByBlock = isBlockedAccountError(error);
    const shouldExpireSession = error?.response?.status === 401
      ? (!isAuthEntry || googleLinkRejectedOldSession)
      : rejectedByBlock;
    if (shouldExpireSession && current?.token &&
        (!requestToken || requestToken === current.token)) {
      if (sessionExpiredHandler) {
        sessionExpiredHandler(rejectedByBlock ? 'blocked' : undefined);
      }
      else setSession(null);
    }
    return Promise.reject(error);
  },
);

export function setSession(u: User | null): void | Promise<void> {
  const revision = ++sessionRevision;
  if (!u?.token) {
    activateSession(null);
    return persistSessionMutation(null, revision).then(() => undefined).catch(() => {});
  }

  return persistSessionMutation(u, revision)
    .then(() => undefined)
    .catch(() => {
      throw new SessionPersistenceError();
    });
}

export function clearSessionForLogout(): Promise<void> {
  ++sessionRevision;
  activateSession(null);

  const operation = sessionPersistenceQueue.catch(() => {}).then(async () => {
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      // Keep a durable signed-out value so a failed removal cannot restore the
      // previous account when the app starts again.
      await AsyncStorage.setItem(KEY, SIGNED_OUT_SESSION_RECORD);
    }
  });
  sessionPersistenceQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function setSessionForAuthAttempt(
  user: User,
  expectedRevision: number,
): Promise<boolean> {
  if (!user.token || sessionRevision !== expectedRevision) return false;

  const revision = ++sessionRevision;
  try {
    const persisted = await persistSessionMutation(user, revision);
    return persisted &&
      revision === sessionRevision &&
      current?.token === user.token &&
      accountIdOf(current) === accountIdOf(user);
  } catch {
    throw new SessionPersistenceError();
  }
}

export async function setSessionForIdentity(
  user: User,
  identity: SessionIdentity,
): Promise<boolean> {
  if (!user.token || !isSessionIdentityCurrent(identity)) return false;
  const revision = ++sessionRevision;
  try {
    const persisted = await persistSessionMutation(user, revision);
    return persisted &&
      revision === sessionRevision &&
      current?.token === user.token &&
      accountIdOf(current) === accountIdOf(user);
  } catch {
    throw new SessionPersistenceError();
  }
}

export async function getSession(): Promise<User | null> {
  if (current) return current;
  const readRevision = sessionRevision;
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(KEY);
  } catch (error) {
    if (readRevision !== sessionRevision) return current;
    throw error;
  }
  if (readRevision !== sessionRevision) return current;

  let savedSession: User | null = null;
  let hasInvalidSavedSession = false;
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof (parsed as User).token !== 'string' ||
        !(parsed as User).token
      ) {
        hasInvalidSavedSession = true;
      } else {
        savedSession = parsed as User;
      }
    } catch {
      hasInvalidSavedSession = true;
    }
  }

  if (hasInvalidSavedSession) {
    try {
      await persistSessionMutation(null, readRevision);
    } catch (error) {
      if (readRevision !== sessionRevision) return current;
      throw error;
    }
    return readRevision === sessionRevision ? null : current;
  }

  if (savedSession) {
    if (readRevision !== sessionRevision) return current;
    sessionRevision += 1;
    activateSession(savedSession);
    return savedSession;
  }

  return readRevision === sessionRevision ? null : current;
}

export function currentUser(): User | null {
  return current;
}

export function errMessage(e: any): string {
  const d = e?.response?.data ?? e?.data;
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
  try {
    const result = await unwrap(http.post(path, body));
    const token = result?.token ?? result?.accessToken;
    if (typeof token !== 'string' || !token) throw new Error('The server did not return an authentication token.');
    return { user: normalizeUser(result, token), token };
  } catch (error: any) {
    const headers = error?.response?.headers;
    const retryAfterHeader = typeof headers?.get === 'function'
      ? headers.get('retry-after') ?? headers.get('Retry-After')
      : headers?.['retry-after'] ?? headers?.['Retry-After'];
    const retryAfterSeconds = Number(retryAfterHeader);
    if (
      path.endsWith('/auth/login') &&
      error?.response?.status === 429 &&
      Number.isFinite(retryAfterSeconds) &&
      retryAfterSeconds > 0
    ) {
      throw new LoginRateLimitError(
        errMessage(error),
        Math.ceil(retryAfterSeconds),
      );
    }
    throw error;
  }
}

async function currentAccount(options: { revalidate?: boolean } = {}): Promise<User> {
  const savedSession = current ?? await getSession();
  const response = await unwrap(http.get('/auth/me', options.revalidate
    ? { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } }
    : undefined));
  return normalizeUser(response, savedSession?.token);
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
  requestGoogleRecovery: async (clerkJwt: string) => {
    if (!clerkJwt) throw new Error('A verified Google session is required.');
    return unwrap(http.post('/auth/google/recovery-request', {}, {
      headers: { Authorization: `Bearer ${clerkJwt}` },
    }));
  },
  requestGoogleOwnerRecovery: async (clerkJwt: string, ownerRecoveryCode: string) => {
    if (!clerkJwt) throw new Error('A verified Google session is required.');
    return unwrap(http.post('/auth/google/recovery-owner', { ownerRecoveryCode }, {
      headers: { Authorization: `Bearer ${clerkJwt}` },
    }));
  },
  adminAccountRecoveryRequests: async (): Promise<AccountRecoveryRequest[]> =>
    unwrap(http.get('/admin/account-recovery-requests')),
  reviewAdminAccountRecoveryRequest: async (
    id: string,
    action: 'approve' | 'reject',
    reviewNote: string,
  ) => unwrap(http.post(
    `/admin/account-recovery-requests/${encodeURIComponent(id)}/${action}`,
    { reviewNote },
  )),
  meAccount: currentAccount,
  languagePreference: async (): Promise<AppLanguage | null> => {
    const response = await unwrap(http.get('/daily007/v2/preferences/language'));
    const language = response?.language;
    if (language === null) return null;
    if (!isAppLanguage(language)) throw new Error('The server returned an unsupported language preference.');
    return language;
  },
  saveLanguagePreference: async (
    language: AppLanguage,
    expectedLanguage: AppLanguage | null,
  ): Promise<{ language: AppLanguage | null; accepted: boolean }> => {
    const response = await unwrap(http.put('/daily007/v2/preferences/language', {
      language,
      expectedLanguage,
    }));
    if (
      (response?.language !== null && !isAppLanguage(response?.language))
      || typeof response?.accepted !== 'boolean'
      || (response.accepted && response.language !== language)
    ) {
      throw new Error('The server could not confirm the saved language preference.');
    }
    return { language: response.language, accepted: response.accepted };
  },
  googleLinkStatus: async (): Promise<boolean> => {
    const user = await currentAccount({ revalidate: true });
    if (typeof user.googleLinked !== 'boolean') {
      throw new Error('The server could not confirm your Google connection status.');
    }
    return user.googleLinked;
  },
  me: async () => {
    const user = await currentAccount();
    try {
      const response = await unwrap(http.get('/me/stats'));
      const stats = response?.stats ?? response;
      const toCounter = (value: unknown): number => {
        if (typeof value === 'number') return value;
        if (typeof value !== 'string' || value.trim() === '') return Number.NaN;
        return Number(value);
      };
      const counters = {
        matches: toCounter(stats?.matches),
        wins: toCounter(stats?.wins),
        kills: toCounter(stats?.kills),
        prizeCoins: toCounter(stats?.prizeCoins ?? stats?.prize_coins),
      };
      if (Object.values(counters).some(
        (value) => !Number.isSafeInteger(value) || value < 0,
      )) {
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
  myRegistrations: async (): Promise<unknown> => {
    const registrations: unknown = await unwrap(http.get('/my/registrations', {
      headers: LIVE_DATA_HEADERS,
    }));
    if (!Array.isArray(registrations)) throw new Error('Invalid registrations response.');
    return registrations;
  },
  join: (id: string, b: object) => {
    const payload = b as {
      playerName?: string; captainGameName?: string; gameUid?: string; teamName?: string;
      teamMembers?: string; seatGroupNumber?: number;
    };
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
      ...(payload.teamName !== undefined ? { teamName: String(payload.teamName).trim() } : {}),
      ...(Number.isSafeInteger(payload.seatGroupNumber) && Number(payload.seatGroupNumber) > 0
        ? { seatGroupNumber: Number(payload.seatGroupNumber) }
        : {}),
      ...(isTeam ? {
        teammates: members.slice(1).map((member) => ({
          name: String(member.name ?? '').trim(),
          ...(String(member.uid ?? '').trim() ? { uid: String(member.uid).trim() } : {}),
        })),
      } : {}),
    }));
  },
  joinPlayerSlot: (id: string, b: {
    teamNumber: number;
    slotNumber: number;
    gameName: string;
    gameUid: string;
  }) => unwrap(http.post(`/daily007/v2/matches/${encodeURIComponent(id)}/squad-join`, b)),
  updateRegistrationTeam: (registrationId: string, b: object) => {
    const payload = b as {
      captainGameName?: string;
      gameUid?: string;
      teamName?: string;
      teamMembers?: string;
      expectedTeam?: {
        captainGameName: string;
        captainGameUid: string;
        teamName: string;
        teammates: { name: string; uid: string }[];
      };
    };
    let members: { name?: string; uid?: string }[] = [];
    try {
      members = payload.teamMembers ? JSON.parse(payload.teamMembers) : [];
    } catch {
      throw new Error('The team edit form data could not be read. Please try again.');
    }
    const captain = members[0];
    if (!captain) throw new Error('Captain game details are required.');
    return unwrap(http.patch(`/my/registrations/${encodeURIComponent(registrationId)}/team`, {
      captainGameName: String(payload.captainGameName ?? captain.name ?? '').trim(),
      captainGameUid: String(payload.gameUid ?? captain.uid ?? '').trim(),
      teamName: String(payload.teamName ?? '').trim(),
      teammates: members.slice(1).map((member) => ({
        name: String(member.name ?? '').trim(),
        ...(String(member.uid ?? '').trim() ? { uid: String(member.uid).trim() } : {}),
      })),
      expectedTeam: payload.expectedTeam,
    }));
  },
  // wallet
  transactions: () => unwrap(http.get('/wallet/transactions')),
  transactionsPage: (cursor?: string) => unwrap(http.get('/wallet/transactions', {
    params: { paginated: 'true', ...(cursor ? { cursor } : {}) },
  })),
  // payments
  createPayment: (b: {
    coins: number;
    payerUpiId: string;
    txnId: string;
    reference: string;
    proofObjectPath?: string;
  }) => unwrap(http.post('/payments', b)),
  myPayments: () => unwrap(http.get('/my/payments')),
  myPaymentsPage: (cursor?: string) => unwrap(http.get('/my/payments', {
    params: { paginated: 'true', ...(cursor ? { cursor } : {}) },
  })),
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
  adminRegistrations: (): Promise<AdminRegistration[]> => unwrap(http.get('/admin/registrations', {
    headers: LIVE_DATA_HEADERS,
  })),
  adminRegAction: (id: string, action: 'approve' | 'reject') => unwrap(http.post('/admin/registrations/' + id + '/' + action, {})),
  createTournament: (b: object) => unwrap(http.post('/tournaments', b)),
  updateTournament: (id: string, b: object) => unwrap(http.patch('/tournaments/' + id, b)),
  deleteTournament: (id: string) => unwrap(http.delete('/tournaments/' + id)),
  adminRoom: (id: string) => unwrap(http.get('/admin/tournaments/' + id + '/room')),
  adminSaveRoom: (id: string, b: object) => unwrap(http.put('/admin/tournaments/' + id + '/room', b)),
  adminClearRoom: (id: string) => unwrap(http.delete('/admin/tournaments/' + id + '/room')),
  adminPublishRoom: (id: string) => unwrap(http.post('/admin/tournaments/' + id + '/publish-room', {})),
  adminPayments: () => unwrap(http.get('/admin/payments')),
  adminPaymentProofUrl: (id: string) => unwrap(http.get('/admin/payments/' + encodeURIComponent(id) + '/proof-url')),
  adminWithdrawals: (): Promise<AdminWithdrawal[]> => unwrap(http.get('/admin/withdrawals')),
  adminMarkWithdrawalPaid: (id: string): Promise<AdminWithdrawalPayoutResult> =>
    unwrap(http.post('/admin/withdrawals/' + encodeURIComponent(id) + '/payout', {})),
  adminWithdrawalAction: (id: string, action: 'approve' | 'reject', reason?: string) =>
    unwrap(http.post('/admin/withdrawals/' + encodeURIComponent(id) + '/' + action, { reason })),
  adminPaymentAction: (id: string, action: 'approve' | 'reject', reason?: string) =>
    unwrap(http.post('/admin/payments/' + encodeURIComponent(id) + '/' + action, { reason })),
  adminApprovedRegs: async (tid: string): Promise<AdminRegistration[]> => {
    const registrations: unknown = await unwrap(http.get('/admin/registrations'));
    if (!Array.isArray(registrations)) throw new Error('Invalid registrations response.');
    return registrations.filter((r): r is AdminRegistration =>
      r != null && r.tournamentId === tid && r.status === 'approved' &&
      !(r.gameMode === 'battle_royale' && r.teamType === 'Squad' && r.isSquadCaptain !== true));
  },
  adminPublishResult: (b: object) => unwrap(http.post('/admin/results', b)),
  adminAdjustCoins: (id: string, coinsDelta: number, note: string, requestId: string) =>
    unwrap(http.patch('/admin/users/' + id, { coinsDelta, note, requestId })),
  adminSetUser: (id: string, b: object) => unwrap(http.patch('/admin/users/' + id, b)),
  adminSetUserRole: (id: string, role: 'user' | 'tournament_admin') =>
    unwrap(http.patch('/admin/users/' + id + '/role', { role })),
  adminUsers: () => unwrap(http.get('/admin/users')),
  adminSettings: () => unwrap(http.get('/admin/settings')),
  adminSaveSettings: (b: object) => unwrap(http.put('/admin/settings', b)),
  adminTransactions: () => unwrap(http.get('/admin/transactions')),
  adminSendNotification: (b: object) => unwrap(http.post('/admin/notifications', b)),
};

export const api = Api;
export const apiError = errMessage;
