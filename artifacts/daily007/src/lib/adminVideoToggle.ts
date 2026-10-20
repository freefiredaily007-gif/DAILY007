export type PendingVideoToggleRef = { current: string | null };

export function startVideoToggleRequest(
  videoId: string,
  pendingRef: PendingVideoToggleRef,
  setPendingVideoId: (id: string | null) => void,
  action: () => Promise<void>,
): Promise<void> | null {
  if (pendingRef.current !== null) return null;

  pendingRef.current = videoId;
  setPendingVideoId(videoId);

  return Promise.resolve()
    .then(action)
    .finally(() => {
      pendingRef.current = null;
      setPendingVideoId(null);
    });
}
