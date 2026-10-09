---
name: Task concurrency
description: User's instruction for sequencing project work.
---

Do not start several project tasks at once; work on one assigned task at a time.

**Why:** the user asked not to start three or four tasks at once.

**How to apply:** finish the currently assigned task before picking up other queued tasks.

**Workflow state:** If a task has already entered merge or reports no active task, leave its changes in place and let the merge state resolve; do not retry completion against stale task context.

**Why:** Task state can advance asynchronously while work is in progress, and the completion action may no longer belong to an active task.

**How to apply:** Check the latest task state before the final transition. When a merge is underway, report that state instead of starting another queued task.