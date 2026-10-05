export const PROFILE_PASSWORD_MIN_LENGTH = 8;
export const PROFILE_PASSWORD_MAX_LENGTH = 200;

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
