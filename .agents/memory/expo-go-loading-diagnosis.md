---
name: Expo Go loading diagnosis
description: Distinguishing a generic Expo Go load failure from a Google authentication exception.
---

Do not treat Expo Go's blue “Something went wrong” page as evidence that Google authentication or its callback is broken. It is a generic failure screen; the actual device error is under “View error log.”

**Why:** Repeated screenshots of the outer failure screen gave no exception details and led to speculative callback changes. A valid callback route alone does not establish that the project loaded correctly on the phone.

**How to apply:** Check Expo dependency alignment and Expo Doctor, then verify the Android manifest and launch bundle through the preview host. A successful bundle and web preview establish server/build health, not successful phone execution or native OAuth. Keep that distinction explicit and request the detailed device log if the phone still fails.