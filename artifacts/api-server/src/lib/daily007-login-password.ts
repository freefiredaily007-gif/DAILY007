import { timingSafeEqual } from "node:crypto";

export const DAILY007_LOGIN_FAILURE_MESSAGE = "Email or password is incorrect.";

// Unknown emails still run scrypt; the derived hash is discarded.
const UNKNOWN_EMAIL_SALT = Buffer.alloc(16);

export type LoginPasswordCredentials = {
  password_salt: string;
  password_hash: string;
};

type PasswordHasher = (
  password: string,
  salt?: Buffer,
) => Promise<{ salt: string; hash: string }>;

export async function verifyDaily007LoginPassword(
  password: string,
  credentials: LoginPasswordCredentials | null,
  hashPassword: PasswordHasher,
): Promise<boolean> {
  const salt = credentials
    ? Buffer.from(credentials.password_salt, "hex")
    : Buffer.from(UNKNOWN_EMAIL_SALT);
  const candidate = await hashPassword(password, salt);

  if (!credentials) return false;

  const expected = Buffer.from(credentials.password_hash, "hex");
  const actual = Buffer.from(candidate.hash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
