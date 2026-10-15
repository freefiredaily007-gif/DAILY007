export type PreviewNetworkState = {
  isConnected: boolean;
  isInternetReachable: boolean;
  type: "WIFI" | "NONE";
};

let networkState: PreviewNetworkState = {
  isConnected: true,
  isInternetReachable: true,
  type: "WIFI",
};
const listeners = new Set<(state: PreviewNetworkState) => void>();

export function addNetworkStateListener(
  listener: (state: PreviewNetworkState) => void,
) {
  listeners.add(listener);
  return { remove: () => listeners.delete(listener) };
}

export async function getNetworkStateAsync() {
  return { ...networkState };
}

export function configurePreviewNetwork(isConnected: boolean) {
  networkState = {
    isConnected,
    isInternetReachable: isConnected,
    type: isConnected ? "WIFI" : "NONE",
  };
  const preview = globalThis as typeof globalThis & {
    __setPreviewNetworkState?: (nextState: PreviewNetworkState) => void;
  };
  preview.__setPreviewNetworkState = (nextState) => {
    networkState = { ...nextState };
    for (const listener of listeners) listener({ ...networkState });
  };
}

export default {
  addNetworkStateListener,
  getNetworkStateAsync,
};
