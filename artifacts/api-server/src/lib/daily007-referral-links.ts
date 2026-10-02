export function createDaily007ReferralLinks(code: string): {
  referralLink: string;
} {
  const configuredUrl = process.env.DAILY007_PUBLIC_APP_URL;
  if (!configuredUrl) {
    throw new Error("DAILY007_PUBLIC_APP_URL is not configured.");
  }

  const publicUrl = new URL(configuredUrl);
  if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password) {
    throw new Error("DAILY007_PUBLIC_APP_URL must be a public HTTPS URL.");
  }
  publicUrl.pathname = "/";
  publicUrl.search = "";
  publicUrl.hash = "";
  publicUrl.searchParams.set("ref", code);

  return {
    referralLink: publicUrl.toString(),
  };
}