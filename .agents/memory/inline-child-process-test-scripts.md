---
name: Inline child-process test scripts
description: Avoid quoting and interpolation bugs when tests build child-process source as a string.
---

When generating JavaScript source for a child process inside a template literal, inject dynamic literals with `JSON.stringify` and avoid nested template literals in the generated program.

**Why:** The outer template processes `${...}` and quote escapes before the child sees the source, so a child script can fail at parse time even when the parent file passes `node --check`.

**How to apply:** Build the child program with plain concatenation for dynamic strings, and use `JSON.stringify(value)` whenever a parent-scope value must become a literal in the child source. Test both the parent syntax and the child process execution.
