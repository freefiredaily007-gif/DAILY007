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
const roleChangeSuccessToast = usersSource.match(
  /toast\(granting \? ([\s\S]*?), 'success'\);/,
)?.[1] ?? '';

test('admin error toasts expose the exact message as an assertive TalkBack alert', () => {
  assert.match(toastSource, /accessibilityLabel=\{toast\.msg\}/);
  assert.match(
    toastSource,
    /accessibilityRole=\{toast\.kind === 'err' \? 'alert' : undefined\}/,
  );
  assert.match(
    toastSource,
    /accessibilityLiveRegion=\{toast\.kind === 'err' \? 'assertive' : 'polite'\}/,
  );
  assert.match(typographySource, /<NativeText\s+\{\.\.\.props\}/);
});

test('successful toasts announce politely without including the decorative checkmark', () => {
  assert.match(toastSource, /accessibilityLabel=\{toast\.msg\}/);
  assert.match(
    toastSource,
    /accessibilityLiveRegion=\{toast\.kind === 'err' \? 'assertive' : 'polite'\}/,
  );
  assert.match(toastSource, /\{toast\.kind === 'err' \? '✕ ' : '✓ '\}\{toast\.msg\}/);
});

test('successful role grants name the affected user and resulting role', () => {
  assert.match(roleChangeSuccessToast, /`\$\{u\.name\} is now a Tournament Admin`/);
});

test('successful role removals name the affected user and resulting player role', () => {
  assert.match(roleChangeSuccessToast, /`\$\{u\.name\} is now a player`/);
});

test('a failed refresh after last Full Admin rejection keeps the role unchanged', () => {
  const rejectedRoleBranch = usersSource.match(
    /if \(message === 'At least one full administrator must remain\.'\) \{([\s\S]*?)\n\s*\} else \{/,
  )?.[1];
  const refreshFailureBranch = rejectedRoleBranch?.match(
    /\} catch \(refreshError\) \{([\s\S]*?)\n\s*return;/,
  )?.[1] ?? '';
  const loadBranch = usersSource.match(
    /const load = async \(\) => \{([\s\S]*?)\n\s*\};/,
  )?.[1] ?? '';

  assert.ok(rejectedRoleBranch, 'The final Full Admin safeguard branch must remain present.');
  assert.match(
    rejectedRoleBranch,
    /try \{\s*setUsers\(\(await Api\.adminUsers\(\)\) \?\? \[\]\);\s*\} catch \(refreshError\)/,
    'The row should update only after a successful follow-up user-list request.',
  );
  assert.ok(refreshFailureBranch, 'The follow-up refresh failure must be handled explicitly.');
  assert.doesNotMatch(
    refreshFailureBranch,
    /setUsers\(/,
    'A failed refresh must leave the last loaded role row unchanged.',
  );
  assert.doesNotMatch(
    refreshFailureBranch,
    /'success'/,
    'A failed refresh must not announce a successful role change.',
  );
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
  assert.match(loadBranch, /setUsers\(u \?\? \[\]\)/);
  assert.match(
    usersSource,
    /u\.role === 'admin' \? 'FULL ADMIN' : u\.role === 'tournament_admin' \? 'TOURNAMENT ADMIN' : 'PLAYER'/,
    'A later successful refresh must render the server role without optimistic demotion.',
  );
  assert.match(usersSource, /const filtered = \(users \?\? \[\]\)\.filter/);
  assert.match(usersSource, /filtered\.map\(\(u\) => \{/);
  assert.match(usersSource, /<Card key=\{u\.\$id\}>/);
});