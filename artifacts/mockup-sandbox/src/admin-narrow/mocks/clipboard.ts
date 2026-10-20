type PreviewClipboardState = typeof globalThis & {
  __daily007ClipboardWrites?: string[];
  __daily007ClipboardFailuresRemaining?: number;
};

export async function setStringAsync(value: string): Promise<boolean> {
  const previewGlobal = globalThis as PreviewClipboardState;
  const failuresRemaining = previewGlobal.__daily007ClipboardFailuresRemaining ?? 0;
  if (failuresRemaining > 0) {
    previewGlobal.__daily007ClipboardFailuresRemaining = failuresRemaining - 1;
    throw new Error('Simulated clipboard write failure.');
  }
  previewGlobal.__daily007ClipboardWrites ??= [];
  previewGlobal.__daily007ClipboardWrites.push(value);
  return true;
}