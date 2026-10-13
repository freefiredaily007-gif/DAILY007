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

export const referralBrowserOpenFallbackMessage =
  'Could not open the invite link. Copy or share it and open it in a browser.';

export async function openReferralInBrowserWithFallback(
  referralLink: string,
  openBrowser: OpenReferralBrowser,
  showFallback: (message: string) => void,
): Promise<void> {
  try {
    await openReferralInBrowser(referralLink, openBrowser);
  } catch {
    showFallback(referralBrowserOpenFallbackMessage);
  }
}

export type ReferralShareContent = {
  message: string;
  url: string;
};

export type ShareReferralInvite = (content: ReferralShareContent) => Promise<unknown>;

export async function copyReferralLinkToClipboard(
  referralLink: string,
  setClipboardString: (text: string) => Promise<unknown>,
): Promise<void> {
  const copied = await setClipboardString(referralLink);
  if (copied === false) {
    throw new Error('Clipboard did not confirm the copy.');
  }
}

export const referralInviteCopyFallbackMessage =
  'Could not copy the invite link. Try the share button instead.';

export async function copyReferralLinkToClipboardWithFallback(
  referralLink: string,
  setClipboardString: (text: string) => Promise<unknown>,
  showFallback: (message: string) => void,
): Promise<boolean> {
  try {
    await copyReferralLinkToClipboard(referralLink, setClipboardString);
    return true;
  } catch {
    showFallback(referralInviteCopyFallbackMessage);
    return false;
  }
}

export async function shareReferralInvite(
  code: string,
  referralLink: string,
  share: ShareReferralInvite,
): Promise<void> {
  await share({
    message: `Join FreeFire Daily007 with my referral code ${code} and get 10 bonus coins. I get 5 coins after your first approved recharge of at least 50 coins.\n\nOpen Daily007: ${referralLink}`,
    url: referralLink,
  });
}

export const referralShareFallbackMessage =
  'Could not open the share sheet. You can copy the code instead.';

export async function shareReferralInviteWithFallback(
  code: string,
  referralLink: string,
  share: ShareReferralInvite,
  showFallback: (message: string) => void,
): Promise<boolean> {
  try {
    await shareReferralInvite(code, referralLink, share);
    return true;
  } catch {
    showFallback(referralShareFallbackMessage);
    return false;
  }
}
