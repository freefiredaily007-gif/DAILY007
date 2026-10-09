---
name: Daily007 query polling tests
description: How to test TanStack Query polling and remount behavior in Node.
---

For client polling tests, install minimal `window` and `document` globals before dynamically importing TanStack Query. QueryObserver detects Node server mode when `window` is absent and suppresses refetch-interval timers. In React Native Web preview mocks, keep `refetch` callback identity stable across retry-counter updates when `useFocusEffect` is implemented as `useEffect(effect, [effect])`; store retry counters in refs. Preserve the initial catalog until the intended failure point so focus refreshes do not consume the test's failure sequence.

**Why:** A plain Node query test can silently omit client polling, while unstable mocked callback identity can replay a focus effect and consume multiple retry attempts before the intended user action.

**How to apply:** Use the browser-like harness for client lifecycle tests. Keep focus-triggered mock refetches stable and arm failures at the flow's intended transition; keep API route tests isolated in their in-memory database fixture.