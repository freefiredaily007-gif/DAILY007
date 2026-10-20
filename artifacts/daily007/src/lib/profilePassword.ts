export const PROFILE_PASSWORD_MIN_LENGTH = 8;
export const PROFILE_PASSWORD_MAX_LENGTH = 200;
export const PROFILE_PASSWORD_CHANGE_UNCERTAIN_MESSAGE =
  "Connection lost before Daily007 confirmed the change. Your password may already be updated. Keep this form open and press UPDATE PASSWORD again to safely confirm it.";

export function isProfilePasswordChangeOutcomeUncertain(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
    response?: unknown;
  };
  if (candidate.response != null) return false;
  if (candidate.name === "AbortError") return true;
  if (
    typeof candidate.code === "string"
    && /ERR_NETWORK|ECONN|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|UND_ERR_SOCKET/i.test(candidate.code)
  ) {
    return true;
  }
  return typeof candidate.message === "string"
    && /network|fetch|connection|socket|timeout|timed out|offline|load failed|request aborted/i.test(candidate.message);
}

type PasswordChangeRequest = {
  data: {
    currentPassword: string;
    newPassword: string;
  };
};

type ProfilePasswordChangeOptions = {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
  changePassword: (request: PasswordChangeRequest) => Promise<unknown>;
};

export async function submitProfilePasswordChange({
  currentPassword,
  newPassword,
  confirmNewPassword,
  changePassword,
}: ProfilePasswordChangeOptions): Promise<string | null> {
  if (!currentPassword || currentPassword.length > PROFILE_PASSWORD_MAX_LENGTH) {
    return 'Enter your current Daily007 password.';
  }
  if (
    newPassword.length < PROFILE_PASSWORD_MIN_LENGTH ||
    newPassword.length > PROFILE_PASSWORD_MAX_LENGTH
  ) {
    return 'Your new password must be 8–200 characters.';
  }
  if (newPassword !== confirmNewPassword) {
    return 'The new passwords do not match.';
  }

  await changePassword({ data: { currentPassword, newPassword } });
  return null;
}
