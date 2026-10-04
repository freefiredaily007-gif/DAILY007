export type ReferralSignupInvite = {
  mode: 'signup';
  referralCode: string;
};

export type ReferralInviteContext = {
  platform: 'web' | 'native';
  currentWebOrigin?: string;
  configuredDomain?: string;
};

export function referralSignupFromUrl(
  url: string | null,
  context: ReferralInviteContext,
): ReferralSignupInvite | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const isAppLink = parsed.protocol === 'daily007:';
    const isCurrentWebPage = context.platform === 'web' &&
      !!context.currentWebOrigin &&
      parsed.origin === context.currentWebOrigin;
    const isConfiguredWebInvite = parsed.protocol === 'https:' &&
      !!context.configuredDomain &&
      parsed.hostname === context.configuredDomain;

    if (!isAppLink && !isCurrentWebPage && !isConfiguredWebInvite) return null;

    const code = parsed.searchParams.get('ref') ?? parsed.searchParams.get('referralCode');
    if (!code?.trim()) return null;
    return { mode: 'signup', referralCode: code.trim().toUpperCase() };
  } catch {
    return null;
  }
}

export type OpenReferralBrowser = (url: string) => Promise<unknown>;

export async function openReferralInBrowser(
  referralLink: string,
  openBrowser: OpenReferralBrowser,
): Promise<void> {
  await openBrowser(referralLink);
}