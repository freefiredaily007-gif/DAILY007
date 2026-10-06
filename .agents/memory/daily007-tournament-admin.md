---
name: Daily007 Tournament Admin scope
description: User-defined permission boundary between full Admin and tournament-only Admin accounts.
---

A Tournament Admin can manage tournaments, registrations, rooms, results, and tournament winner payouts. They cannot manage general wallet credits, payment or recharge approvals, withdrawals, or earn-task reward approvals. Only a Full Admin assigns or removes Tournament Admin access directly in User Management; players do not self-request.

**Why:** The user chose all tournament operations, including registrations and room management, while explicitly excluding non-tournament coin approvals and withdrawals. They clarified that the main Full Admin must assign the role directly, not process player requests.

**How to apply:** Keep the boundary in both server authorization and Admin navigation. Treat User Management as the sole route for assigning the role. Do not expand tournament permissions to unrelated wallet or reward workflows.

**Tournament lifecycle and finish:** A match becomes Ongoing at its scheduled start and stays Ongoing until an admin publishes the rank-1 winner. Publishing other placements does not finish it. The winner's prize award and match completion commit together; players see standings in MY MATCHES → COMPLETED.

**Why:** The user wants scheduled start time to control the Ongoing transition and an explicit admin winner publication to control completion.

**How to apply:** Derive lifecycle status from database time and the rank-1 award, without adding persisted status values. Reject results before start; complete only when the rank-1 award and disabling the match commit together.

**Schedule timezone:** Tournament date and time entries use India Standard Time, for both existing and new schedules.

**Why:** The user confirmed “As per Indian time” after the existing UTC interpretation delayed an 8:00 PM tournament until 1:30 AM IST. Parsing the date-only IST calendar value as device-local time can also display the previous day in western timezones.

**How to apply:** Preserve the entered IST wall-clock time for display, render date-only IST calendar values from their year/month/day parts rather than device-local parsing, convert starts to the matching real instant for comparisons, and keep the server clock authoritative.

**Prize source:** During result publication, derive the non-editable award from the tournament's saved prize distribution for the entered rank; if no first-place distribution is specified, use the saved prize pool. The API is the source of truth.

**Why:** The user asked for the creation-time winning prize to populate result publication without allowing admins to edit it there.

**How to apply:** Keep the displayed rank-based value and server-computed award aligned; never accept a client-provided prize amount as authoritative.

**Safe deletion:** Permanently delete only tournaments without registration, wallet, or result history. If history exists, close the tournament and preserve its records.

**Why:** Removing a tournament with participant or coin history could erase records players rely on.

**How to apply:** Check all related history before deleting; do not cascade-delete registrations, awards, or wallet entries.

**Tournament operations navigation:** Room setup/sharing and result entry belong directly inside the Tournament lifecycle tabs, not on separate management pages.

**Why:** The user wants all room and result work managed within the Tournament section and questioned why Room Management still opened separately.

**How to apply:** Use expandable tournament-card panels for room and result actions; keep completed logs in the Completed tab and do not route to standalone Rooms or Results pages.