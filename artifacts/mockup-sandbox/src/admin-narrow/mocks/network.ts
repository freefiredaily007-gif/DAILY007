export type PreviewNetworkState = {
  isConnected: boolean;
  isInternetReachable: boolean;
  type: "WIFI";
};

const connectedState: PreviewNetworkState = {
  isConnected: true,
  isInternetReachable: true,
  type: "WIFI",
};

export function addNetworkStateListener(
  _listener: (state: PreviewNetworkState) => void,
) {
  return { remove() {} };
}

export async function getNetworkStateAsync() {
  return { ...connectedState };
}

export default {
  addNetworkStateListener,
  getNetworkStateAsync,
};
