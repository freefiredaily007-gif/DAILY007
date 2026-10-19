import type { SessionVerificationNetworkState } from "../../../../daily007/src/lib/session-verification";

const offlineStorageKey = "daily007-test-network-offline";

const initialState: SessionVerificationNetworkState =
  typeof window !== "undefined" &&
  window.localStorage.getItem(offlineStorageKey) === "1"
    ? { isConnected: false, isInternetReachable: false }
    : { isConnected: true, isInternetReachable: true };

let networkState = initialState;
const listeners = new Set<(state: SessionVerificationNetworkState) => void>();

export async function getNetworkStateAsync(): Promise<SessionVerificationNetworkState> {
  return { ...networkState };
}

export function addNetworkStateListener(
  listener: (state: SessionVerificationNetworkState) => void,
) {
  listeners.add(listener);
  return { remove: () => listeners.delete(listener) };
}

export function setMockNetworkState(state: SessionVerificationNetworkState) {
  networkState = { ...state };
  if (typeof window !== "undefined") {
    if (state.isConnected === false) {
      window.localStorage.setItem(offlineStorageKey, "1");
    } else {
      window.localStorage.removeItem(offlineStorageKey);
    }
  }
  listeners.forEach((listener) => listener({ ...networkState }));
}
