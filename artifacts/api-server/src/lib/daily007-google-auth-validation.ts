import type { User } from "@clerk/express";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type GoogleIdentity = {
  clerkUserId: string;
  email: string;
  name: string;
};

export type GoogleAccountChoice =
  | "existing"
  | "create"
  | "link"
  | "email-conflict"
  | "linked-elsewhere"
  | "email-mismatch";

export function chooseGoogleAccountAction(input: {
  linkedUserId: string | null;
  linkedEmail: string | null;
  emailOwnerUserId: string | null;
  localTokenUserId: string | null;
  verifiedEmail: string;
}): GoogleAccountChoice {
  if (input.linkedUserId) {
    if (input.localTokenUserId && input.localTokenUserId !== input.linkedUserId) return "linked-elsewhere";
    if (input.linkedEmail?.trim().toLowerCase() !== input.verifiedEmail) return "email-mismatch";
    return "existing";
  }
  if (input.localTokenUserId) {
    if (input.emailOwnerUserId && input.emailOwnerUserId !== input.localTokenUserId) return "email-conflict";
    return "link";
  }
  return input.emailOwnerUserId ? "email-conflict" : "create";
}

export function verifiedGoogleIdentity(user: User): GoogleIdentity | null {
  const account = user.externalAccounts.find((external) =>
    (external.provider === "google" || external.provider === "oauth_google") &&
    external.verification?.status === "verified" &&
    Boolean(external.emailAddress?.trim()),
  );
  if (!account) return null;

  const email = account.emailAddress.trim().toLowerCase();
  const clerkEmail = user.emailAddresses.find((address) =>
    address.emailAddress.trim().toLowerCase() === email &&
    address.verification?.status === "verified",
  );
  if (!clerkEmail || !EMAIL_PATTERN.test(email) || email.length > 254) return null;

  const name = [user.firstName || account.firstName, user.lastName || account.lastName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim()
    .slice(0, 100) || email.split("@")[0].slice(0, 100);
  return { clerkUserId: user.id, email, name };
}