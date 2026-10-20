import { redirectReferralSignupSystemPath } from '../src/lib/referral-invite';

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  return redirectReferralSignupSystemPath(path);
}
