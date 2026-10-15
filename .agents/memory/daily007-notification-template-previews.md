---
name: Daily007 notification template previews
description: Accessibility-hint verification for notification template controls in browser-based React Native previews.
---

React Native Web does not render React Native's `accessibilityHint` prop into browser accessibility attributes. Verify that the native hint is present in source, and use the isolated browser preview to check the button role/name, activation, resulting field values, focus retention, and absence of mutations.

**Why:** The preview otherwise cannot confirm that the native hint exists, while checking only the prop would miss whether template activation actually fills both fields or changes focus.

**How to apply:** For notification-template accessibility changes, pair a source assertion for the hint with isolated preview interaction checks; use a native Android TalkBack check when device verification is available.
