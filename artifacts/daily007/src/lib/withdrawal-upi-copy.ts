export interface ClipboardWriter {
  setStringAsync(value: string): Promise<boolean>;
}

export function getWithdrawalUpiCopyLabel(
  requestId: string,
  copiedRequestId: string | null,
) {
  return copiedRequestId === requestId ? 'COPIED' : 'COPY UPI';
}

export async function copyWithdrawalUpi(
  requestId: string,
  upiId: string,
  clipboard: ClipboardWriter,
  setCopiedUpiId: (id: string | null) => void,
  setErr: (message: string) => void,
) {
  if (!upiId.trim()) return;

  setCopiedUpiId(null);
  setErr('');
  try {
    if (!await clipboard.setStringAsync(upiId)) {
      throw new Error('Clipboard did not confirm the copy.');
    }
    setCopiedUpiId(requestId);
  } catch {
    setErr('Could not copy this UPI ID.');
  }
}