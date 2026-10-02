# Daily007 Android APK build handoff

## What this handoff is for

The requested deliverable is a signed Android APK file that can be sent directly to friends. Replit currently supports Expo preview and iOS App Store publishing, but does not provide a direct APK download or Google Play publishing flow. This document is for an Android developer with Android Studio who can build and sign the APK outside Replit.

## App and backend details

- App name: Daily007
- Android package ID: `com.daily007.app` — keep this unchanged
- Deep-link scheme: `daily007`
- Current app version: `1.0.0`
- Production API host: `daily-007-source-1-zip.replit.app`
- API base URL: `https://daily-007-source-1-zip.replit.app/api`

Build from the complete pnpm workspace, not only `artifacts/daily007`; the app imports the shared `@workspace/api-client-react` package.

## Before building

1. Publish the latest Daily007 API and database schema from Replit. The development version has a new referral-code table; the production API must be updated before the APK uses new five-letter referral codes.
2. Use a copy of the full repository and install dependencies from the workspace root:

   ```sh
   pnpm install --frozen-lockfile
   ```

3. In the secure build environment, set these public app configuration values:

   ```sh
   export EXPO_PUBLIC_DOMAIN="daily-007-source-1-zip.replit.app"
   export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="<obtain securely from Replit Secrets>"
   ```

   Do not put `CLERK_SECRET_KEY`, session secrets, or other server credentials in the APK or source archive.

## Build and sign the APK

1. From the repository root, generate the Android native project:

   ```sh
   cd artifacts/daily007
   pnpm exec expo prebuild --platform android
   ```

2. Open `artifacts/daily007/android` in Android Studio and build a **signed APK** (not an Android App Bundle) using the release signing flow. Keep the release keystore and its passwords private and backed up. Future APK updates must use the same signing key and the same package ID.
3. Keep the public environment values above available to the native build process so the bundled app uses the production API and Clerk configuration.
4. Test the signed APK on a real Android phone before sharing. In particular, verify signup, API access, referral signup, and Google sign-in. Google sign-in has not yet been confirmed on a real phone.

Android Studio typically writes the APK under `artifacts/daily007/android/app/build/outputs/apk/`. Send the `.apk` file itself to friends. Android may ask them to allow installation from the app they used to receive the file.

## Replit reference

Replit's current mobile-app documentation: https://docs.replit.com/features/artifact-types/building-mobile-apps