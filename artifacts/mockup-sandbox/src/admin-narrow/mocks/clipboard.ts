type PreviewClipboardState = typeof globalThis & {
  __daily007ClipboardWrites?: string[];
};

export async function setStringAsync(value: string): Promise<boolean> {
  const previewGlobal = globalThis as PreviewClipboardState;
  previewGlobal.__daily007ClipboardWrites ??= [];
  previewGlobal.__daily007ClipboardWrites.push(value);
  return true;
}