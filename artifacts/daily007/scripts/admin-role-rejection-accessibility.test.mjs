import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const toastSource = await readFile(
  new URL('../src/components/adminKit.tsx', import.meta.url),
  'utf8',
);
const usersSource = await readFile(
  new URL('../src/screens/AdminUsers.tsx', import.meta.url),
  'utf8',
);
const typographySource = await readFile(
  new URL('../src/components/typography.tsx', import.meta.url),
  'utf8',
);

test('admin error toasts expose the exact message as an assertive TalkBack alert', () => {
  assert.match(toastSource, /accessibilityLabel=\{toast\.msg\}/);
  assert.match(
    toastSource,
    /accessibilityRole=\{toast\.kind === 'err' \? 'alert' : undefined\}/,
  );
  assert.match(
    toastSource,
    /accessibilityLiveRegion=\{toast\.kind === 'err' \? 'assertive' : undefined\}/,
  );
  assert.match(typographySource, /<NativeText\s+\{\.\.\.props\}/);
});

test('last Full Admin rejection refreshes and keeps the user row available', () => {
  const rejectedRoleBranch = usersSource.match(
    /if \(message === 'At least one full administrator must remain\.'\) \{([\s\S]*?)\n\s*\} else \{/,
  )?.[1];

  assert.ok(rejectedRoleBranch, 'The final Full Admin safeguard branch must remain present.');
  const refreshIndex = rejectedRoleBranch.indexOf('setUsers((await Api.adminUsers()) ?? []);');
  const toastIndex = rejectedRoleBranch.indexOf(
    "toast('At least one Full Admin must remain. This account was not changed.', 'error');",
  );
  assert.ok(refreshIndex >= 0, 'The user list must refresh after the rejected role change.');
  assert.ok(toastIndex > refreshIndex, 'The rejection announcement follows the user-list refresh.');
  assert.match(
    rejectedRoleBranch,
    /toast\(\s*`At least one Full Admin must remain\. This account was not changed\. User list refresh failed: \$\{errMessage\(refreshError\)\}`,\s*'error',\s*\)/,
  );
  assert.match(usersSource, /const filtered = \(users \?\? \[\]\)\.filter/);
  assert.match(usersSource, /filtered\.map\(\(u\) => \{/);
  assert.match(usersSource, /<Card key=\{u\.\$id\}>/);
  assert.match(usersSource, /{u\.role === 'admin' \? 'FULL ADMIN'/);
});