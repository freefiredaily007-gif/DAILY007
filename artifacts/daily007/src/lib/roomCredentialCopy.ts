export type RoomCredentialCopyFeedback = {
  kind: 'success' | 'failure';
  message: string;
};

export function createRoomCredentialCopyRequestGuard() {
  let currentRequestId = 0;
  return {
    beginRequest() {
      currentRequestId += 1;
      return currentRequestId;
    },
    invalidateRequests() {
      currentRequestId += 1;
    },
    isCurrentRequest(requestId: number) {
      return requestId === currentRequestId;
    },
  };
}

export async function copyRoomCredentialToClipboard(
  label: string,
  value: string,
  writeClipboard: (value: string) => Promise<boolean>,
): Promise<RoomCredentialCopyFeedback> {
  let copied = false;
  try {
    copied = await writeClipboard(value);
  } catch {
    copied = false;
  }

  return copied
    ? { kind: 'success', message: `${label} copied to clipboard.` }
    : { kind: 'failure', message: `Could not copy ${label}. Please try again.` };
}
