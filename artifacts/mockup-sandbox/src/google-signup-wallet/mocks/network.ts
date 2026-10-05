export async function getNetworkStateAsync() {
  return { isConnected: true, isInternetReachable: true };
}

export function addNetworkStateListener() {
  return { remove: () => undefined };
}
