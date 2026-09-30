# Running Daily007 on Replit

This is the imported React Native CLI project (React Native 0.76 / Expo SDK 52), not a Replit mobile artifact. Keep the existing `android/`, `ios/`, and `src/` structure.

## Start the development server

1. Run `npm ci` if dependencies are not installed.
2. Press **Run**, or start the **Start mobile bundler** workflow. It runs:
   `EXPO_PACKAGER_PROXY_URL=https://$REPLIT_DEV_DOMAIN npx expo start --lan --port 8080`
3. Metro listens on port 8080, which `.replit` exposes through the Replit development domain. `/status` should return `packager-status:running`. The workflow console displays an Expo QR code.

The Replit browser Preview shows the Metro/Expo server, **not** the native app screen. This imported CLI project does not automatically attach to Replit's built-in mobile simulator. To try it on a phone, scan the QR code with Expo Go; if the HTTPS proxy prevents the `exp://` link from opening, enter `exps://<your Replit development domain>` in Expo Go instead. Expo Go may not include every native module used by this project, so a custom native development build may be necessary. A native device run has not been verified here.

For a native build using the existing projects, follow `README.md`: Android needs JDK 17, Android Studio/SDK and a device or emulator; iOS needs macOS, Xcode and CocoaPods. Those toolchains are not provided by this Replit workflow.

The API URL is already set in `src/config/api.ts`; the Metro workflow does not need additional secrets. The imported lockfile was reconciled for `npm ci`, with patched transitive dependencies to meet Replit's package security policy.