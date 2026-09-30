// Session helpers: persist the logged-in user locally and attach the auth token.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { http, User } from './api';

const KEY = 'ffd007_user';
let current: User | null = null;

export function setSession(u: User | null) {
  current = u;
  if (u) {
    AsyncStorage.setItem(KEY, JSON.stringify(u)).catch(() => {});
    // @ts-ignore token may be absent
    if (u.token) http.defaults.headers.common['Authorization'] = 'Bearer ' + u.token;
  } else {
    AsyncStorage.removeItem(KEY).catch(() => {});
    delete http.defaults.headers.common['Authorization'];
  }
}

export async function getSession(): Promise<User | null> {
  if (current) return current;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const u = JSON.parse(raw) as User;
      setSession(u);
      return u;
    }
  } catch {}
  return null;
}

export function currentUser(): User | null {
  return current;
}
