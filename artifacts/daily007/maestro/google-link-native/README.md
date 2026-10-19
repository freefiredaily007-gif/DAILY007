# Native Google-link retry check

This release-emulator suite starts from the real Profile and Wallet screens in a development-only fixture. It opens an Android Custom Tab through `WebBrowser.openAuthSessionAsync`, then returns to the app through the same `sso-callback` deep-link path used by Google SSO.

The OAuth page and identity are local test fixtures; they never contact Google or Clerk and do not use a real account. Once the browser is open, the runner disables Android networking before returning to Daily007. The API adapter checks the emulator's actual connectivity state, makes the first `/auth/google` exchange fail as a transport error, and allows the retry after connectivity is restored.

The flows assert that the first failure leaves the account ID, 42-coin wallet, and stored password bearer unchanged; Profile remains unlinked and retryable. The successful second exchange must use the same Daily007 token and is the first point where Profile reports Google connected. The runner restores the saved app session and the emulator's original airplane-mode and Wi-Fi settings.

The Android release verification workflow runs this flow on its API 35 emulator. It verifies the native browser handoff and callback mechanics, not the production Google provider configuration; the separate physical standalone-build check in `ANDROID_RELEASE.md` remains necessary for a release.
