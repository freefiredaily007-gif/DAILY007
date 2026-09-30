# Daily007

A React Native app. This folder is a complete project: native Android and iOS projects, the JavaScript/TypeScript source under `src/`, and pinned dependencies.

## Requirements

- Node.js 20 or newer
- JDK 17
- Android Studio with the Android SDK (API 34) and an emulator or a connected phone with USB debugging
- macOS with Xcode 15 and CocoaPods for the iOS app (the `ios/` folder is generated and has not been built here)

## Run on Android

```bash
npm install
npx react-native run-android
```

The first build downloads Gradle and the Android dependencies (several minutes). Metro (the JS bundler) starts automatically; keep that terminal open.

## Run on iOS

```bash
npm install
cd ios && pod install && cd ..
npx react-native run-ios
```

## Build a release APK

1. Create a signing key once: `keytool -genkeypair -v -keystore android/app/release.keystore -alias app -keyalg RSA -keysize 2048 -validity 10000`
2. Fill in `signingConfigs.release` in `android/app/build.gradle` (there is a commented block to uncomment) and point the `release` build type at it.
3. `cd android && ./gradlew assembleRelease` → `android/app/build/outputs/apk/release/app-release.apk`

Until you do this, release builds are signed with the debug key, which installs fine but cannot be published to a store.

## Identity

- Display name: Daily007 (`android/app/src/main/res/values/strings.xml`, `app.json`)
- Package id: `com.daily007.app` (`android/app/build.gradle`)
- Launcher icons: `android/app/src/main/res/mipmap-*/`

## Configuration

`src/config/api.ts` holds the base URL of the app's hosted API (already filled in). Change these if you host those services yourself. Secrets for your own services go in `.env` (see `.env.example` if present); never commit a `.env`.

## Project layout

- `src/App.tsx` — entry component (registered from `index.js`)
- `src/screens`, `src/lib`, `src/components` — the app's code
- `src/vendor` — small helper modules the app depends on
- `android/`, `ios/` — native projects; edit only for native changes

## Included native modules

Navigation, safe-area, gestures, screens, async storage, SVG, video, text-to-speech, voice, keychain, share, document and image pickers, slider, biometrics, geolocation, and the Expo modules for files, sharing, location, printing, notifications, local authentication and speech are pre-installed and linked. Add others with `npm install <package>` followed by a rebuild.

## Notes from the export

- lib/data/remote.ts: 1 platform comment(s) removed
