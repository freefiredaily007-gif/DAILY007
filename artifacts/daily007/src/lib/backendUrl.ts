// Expo's runtime metadata is available in Expo Go and web manifests. Prefer the
// workflow-injected Replit domain, and use the Expo host only as a runtime
// fallback; never embed a machine-local or fixed development hostname.
import Constants from 'expo-constants';
import { API_BASE_URL as configuredBase } from '../config/api';

const runtimeHost = Constants.expoConfig?.hostUri?.split(':')[0];
const configuredDomain = process.env.EXPO_PUBLIC_DOMAIN;
const runtimeBase = runtimeHost ? `https://${runtimeHost}/api` : '';

export const API_BASE_URL = configuredDomain ? configuredBase : runtimeBase;
