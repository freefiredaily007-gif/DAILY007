export const MIN_SIGNUP_PASSWORD_LENGTH = 8;
export const MAX_SIGNUP_PASSWORD_LENGTH = 200;
export const SIGNUP_PASSWORD_LENGTH_ERROR = "Password must contain 8–200 characters.";

export function signupPasswordError(password: string): string | null {
  return password.length < MIN_SIGNUP_PASSWORD_LENGTH ||
      password.length > MAX_SIGNUP_PASSWORD_LENGTH
    ? SIGNUP_PASSWORD_LENGTH_ERROR
    : null;
}