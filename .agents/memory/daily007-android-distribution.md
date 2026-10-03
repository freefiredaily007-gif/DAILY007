---
name: Daily007 Android distribution
description: The user's requirement for sharing the Android app itself with friends.
---

The user wants the native release to target Android for Google Play; distinguish that from the earlier request for a directly transferable APK. Replit project publishing updates the hosted API/Expo manifest, not an installed native Play Store app; new UI releases need a rebuilt AAB, and each store release needs a higher Android versionCode.

**Why:** The user's later release direction is Google Play. Daily007 has no `expo-updates` native client, so a deployment alone cannot update an installed Android binary.

**How to apply:** For Play releases, build a signed AAB outside Replit's Expo publishing flow, keep the package ID/signing key stable, and increment `android.versionCode` above the active Play release. Replit publishing does not copy development database rows into an existing production database; manage live records in production or obtain explicit approval for a data migration.