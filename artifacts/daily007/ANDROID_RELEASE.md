# Daily007 Android release checklist

The Android package is `com.daily007.app`. Confirm this identifier before publishing: a Google Play listing cannot switch to a different package identifier later. Increment `expo.android.versionCode` for every new Play release.

This repository currently runs through Expo Go on Android. A successful JavaScript export or Expo Go preview is **not** a signed, installable Android App Bundle (AAB), and Replit does not directly publish Android apps to Google Play. A separate Android production build and signing process will be needed when it is time to submit to Play. Keep the signing key private and backed up; never commit it to this repository.

Before making a release build:

1. Configure the production API domain and production Clerk credentials through the build environment. Do not embed the development Replit domain or development Clerk keys in a release. Verify production Google SSO is enabled and its authorized redirect settings match the actual build.
2. Install a native Android build on a physical phone and test the `daily007://sso-callback` Google return flow, first-time zero-coin account, repeat login to the same account, password-account linking, logout, and blocked-account denial. Expo Go has a different redirect URI and does not replace this native test.
3. Test purchase requests (no coins before admin approval), duplicate UTR rejection, wallet history, withdrawal reservation/refund, manual payout, and "mark paid" using test accounts. Do not treat a UTR or screenshot as proof of payment.
4. Configure persistent private object storage and signed upload/preview URLs before publishing. Test optional JPEG/PNG/WebP payment screenshots (maximum 5 MB), verify they appear only in admin payment review, and confirm all financial flows and the production database schema.
5. Prepare Play Console requirements: store listing, privacy policy, data-safety disclosures, account-deletion instructions, content rating, testing track, Android target API compliance, and signing. Review rights to the current "Free Fire" name and artwork before submitting a listing.

## Verified Android Google SSO flow (2026-10-05)

- The user reported that a fresh Google signup on a standalone Android Play build returned to Daily007; Wallet showed 10 coins and exactly one "Welcome Signup Bonus" row.
- The user reported that connecting Google to an existing password account kept the same Daily007 account, wallet balance, and session.
- The app's expected Android return URI is `daily007://sso-callback`, matching the `daily007` scheme in `app.json` and the callback path in `GoogleSSOButton.tsx`. Successful phone testing confirms the return flow worked for the tested build. No provider credentials are recorded.
- The installed build's version was not identified. The repository configuration at the time of this note is app version `1.0.1`, Android `versionCode` `2`; this does not establish that the tested build used that exact version.