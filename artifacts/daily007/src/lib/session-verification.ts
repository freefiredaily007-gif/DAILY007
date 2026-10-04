export type SessionRestoreResult<T> =
  | { status: 'empty' }
  | { status: 'verified'; session: T }
  | { status: 'rejected' }
  | { status: 'retry'; session: T };

function isAuthenticationRejection(error: unknown): boolean {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return status === 401 || status === 403;
}

export async function restoreDaily007Session<T extends { token?: string }>(
  readStoredSession: () => Promise<T | null>,
  verifyWithApi: () => Promise<T>,
  updateStoredSession: (session: T | null) => void,
): Promise<SessionRestoreResult<T>> {
  const savedSession = await readStoredSession();
  if (!savedSession) return { status: 'empty' };

  try {
    const verified = await verifyWithApi();
    const session = { ...verified, token: savedSession.token };
    updateStoredSession(session);
    return { status: 'verified', session };
  } catch (error) {
    if (isAuthenticationRejection(error)) {
      updateStoredSession(null);
      return { status: 'rejected' };
    }
    return { status: 'retry', session: savedSession };
  }
}