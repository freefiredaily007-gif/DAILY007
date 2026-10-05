export type GoogleClerkSession = {
  id: string;
  getToken: () => Promise<string | null | undefined>;
};

export type GoogleSSOStartResult = {
  createdSessionId?: string | null;
  authSessionResult?: { type?: string } | null;
  signUp?: { status?: string | null; missingFields?: string[] | null };
  setActive?: (options: { session: string }) => Promise<void>;
};

export type GoogleSSOFlowResult<T> =
  | { status: 'success'; value: T }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

type GoogleSSOFlowOptions<T> = {
  getActiveSession: () => GoogleClerkSession | null | undefined;
  startSSOFlow: () => Promise<GoogleSSOStartResult>;
  exchangeToken: (verifiedClerkToken: string) => Promise<T>;
};

const INACTIVE_SESSION_MESSAGE =
  'Google sign-in finished, but Clerk did not activate the expected session. Please try again.';

export async function runGoogleSSOFlow<T>({
  getActiveSession,
  startSSOFlow,
  exchangeToken,
}: GoogleSSOFlowOptions<T>): Promise<GoogleSSOFlowResult<T>> {
  const existingSession = getActiveSession();
  let expectedSessionId = existingSession?.id;

  if (!existingSession) {
    const sso = await startSSOFlow();
    expectedSessionId = sso.createdSessionId ?? undefined;

    if (!expectedSessionId) {
      const resultType = sso.authSessionResult?.type;
      if (resultType === 'cancel' || resultType === 'dismiss') {
        return { status: 'cancelled' };
      }

      if (sso.signUp?.status === 'missing_requirements') {
        const fields = sso.signUp.missingFields?.join(', ');
        return {
          status: 'error',
          message: fields
            ? `Google sign-up needs more information: ${fields}. Please complete those account details and try again.`
            : 'Google sign-up needs additional account details. Please complete them and try again.',
        };
      }

      return { status: 'error', message: 'Google sign-in did not complete. Please try again.' };
    }

    if (!sso.setActive) {
      return {
        status: 'error',
        message: 'Google sign-in completed, but the session could not be activated. Please try again.',
      };
    }

    await sso.setActive({ session: expectedSessionId });
  }

  const activeSession = getActiveSession();
  if (!expectedSessionId || !activeSession || activeSession.id !== expectedSessionId) {
    return { status: 'error', message: INACTIVE_SESSION_MESSAGE };
  }

  const verifiedClerkToken = await activeSession.getToken();
  if (!verifiedClerkToken) {
    return {
      status: 'error',
      message: 'Google sign-in completed, but a verified Clerk session token was not available. Please try again.',
    };
  }

  return {
    status: 'success',
    value: await exchangeToken(verifiedClerkToken),
  };
}

export function getSSOCallbackMessage(platform: string, resultType?: string): string {
  if (platform === 'web') {
    return resultType === 'success'
      ? 'Google sign-in is complete. Return to Daily007 to continue.'
      : 'Google sign-in returned to Daily007. If you are not signed in, close this page and try again.';
  }

  return 'Google sign-in returned to Daily007. Return to the app to finish signing in. If it did not finish, try again.';
}
