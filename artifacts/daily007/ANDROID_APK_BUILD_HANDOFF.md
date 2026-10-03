# Daily007 Android Play Store release handoff

## What this handoff is for

This handoff is for publishing Daily007 on Google Play. Publishing the Replit project updates its hosted API and Expo/browser assets; it does not update an already-installed standalone Android app. This app does not include `expo-updates`, so changes to its native client require a newly built Android App Bundle (AAB) uploaded to Google Play. Replit's Expo publishing flow does not submit Android releases.

## App and backend details

- App name: Daily007
- Android package ID: `com.daily007.app` — keep this unchanged
- Deep-link scheme: `daily007`
- Current app version: `1.0.1`
- Current Android version code: `2` (must be higher than the version code currently active in Google Play)
- Production API host: `daily-007-source-1-zip.replit.app`
- API base URL: `https://daily-007-source-1-zip.replit.app/api`

Build from the complete pnpm workspace, not only `artifacts/daily007`; the app imports the shared `@workspace/api-client-react` package.

## Before building

1. Publish the latest Daily007 API from Replit.
2. Remember that Replit keeps development and production databases separate. Publishing code does not copy development tournament rows into an existing production database; manage live tournament data in production or use an explicitly approved data migration.
3. Use a copy of the full repository and install dependencies from the workspace root:

   ```sh
   pnpm install --frozen-lockfile
   ```

4. In the secure build environment, set these public app configuration values:

   ```sh
   export EXPO_PUBLIC_DOMAIN="daily-007-source-1-zip.replit.app"
   export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="<obtain securely from Replit Secrets>"
   ```

   Do not put `CLERK_SECRET_KEY`, session secrets, or other server credentials in the APK or source archive.

## Build and sign the Android App Bundle

1. From the repository root, generate the Android native project:

   ```sh
   cd artifacts/daily007
   pnpm exec expo prebuild --platform android
   ```

2. Open `artifacts/daily007/android` in Android Studio and generate a **signed Android App Bundle (AAB)** for the release track. Keep the release keystore and its passwords private and backed up. Future updates must use the same signing key and package ID.
3. Keep the public environment values above available to the native build process so the bundled app uses the production API and Clerk configuration.
4. Confirm `android.versionCode` in `app.json` is greater than the version already active in Google Play. Increment it for every store release.
5. Test the release build on a real Android phone before uploading. Verify sign-in, API access, and the screens changed in the release.

Android Studio typically writes the AAB under `artifacts/daily007/android/app/build/outputs/bundle/release/`. Upload that AAB to the appropriate Google Play track and complete the Play Console rollout.

## Replit reference

Replit's current mobile-app documentation: https://docs.replit.com/features/artifact-types/building-mobile-apps