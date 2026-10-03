export type RecoveryAccount = {
  id: string;
  email: string;
  status: string;
  clerkUserId: string | null;
};

export type RecoveryGoogleIdentity = {
  clerkUserId: string;
  email: string;
};

const normalizedEmail = (value: string) => value.trim().toLowerCase();

export function isEligibleForGoogleRecoveryRequest(
  account: RecoveryAccount | null,
  identity: RecoveryGoogleIdentity,
): account is RecoveryAccount {
  return Boolean(
    account &&
    account.status === "active" &&
    !account.clerkUserId &&
    normalizedEmail(account.email) === normalizedEmail(identity.email),
  );
}

export function isEligibleForGoogleRecoveryApproval(input: {
  requestStatus: string;
  account: RecoveryAccount;
  requestUserId: string;
  reviewerUserId: string;
  requestedClerkUserId: string;
  requestedEmail: string;
  currentIdentity: RecoveryGoogleIdentity | null;
}): boolean {
  const identity = input.currentIdentity;
  return Boolean(
    input.requestStatus === "pending" &&
    input.requestUserId !== input.reviewerUserId &&
    input.account.status === "active" &&
    (!input.account.clerkUserId || input.account.clerkUserId === input.requestedClerkUserId) &&
    identity &&
    identity.clerkUserId === input.requestedClerkUserId &&
    normalizedEmail(identity.email) === normalizedEmail(input.requestedEmail) &&
    normalizedEmail(input.account.email) === normalizedEmail(input.requestedEmail),
  );
}

export function cleanRecoveryReviewNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const note = value.trim();
  return note.length >= 10 && note.length <= 500 ? note : null;
}