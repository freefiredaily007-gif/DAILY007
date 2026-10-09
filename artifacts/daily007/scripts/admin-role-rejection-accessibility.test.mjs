import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { adminNavigationForRole } from '../src/lib/roleNavigation.ts';

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
const adminAppSource = await readFile(
  new URL('../src/screens/AdminApp.tsx', import.meta.url),
  'utf8',
);
const ADMIN_NAV_KEYS = [
  'dashboard',
  'leaderboards',
  'tournaments',
  'registrations',
  'payments',
  'wallet',
  'earnTasks',
  'videos',
  'users',
  'notifications',
  'settings',
];
const ADMIN_NAV_ITEMS = ADMIN_NAV_KEYS.map((key) => ({ key }));
const roleChangeHandler = usersSource.match(
  /const confirmTournamentAdminChange = async \(\) => \{([\s\S]*?)\n  \};/,
)?.[1] ?? '';
const roleChangeFocusEffect = usersSource.match(
  /useEffect\(\(\) => \{([\s\S]*?)\n\s*\}, \[users\]\);/,
)?.[1] ?? '';

test('Admin tabs expose readable names and announce the selected section', () => {
  assert.match(adminAppSource, /accessibilityRole="tab"/);
  assert.match(adminAppSource, /accessibilityLabel=\{n\.accessibilityLabel \?\? n\.label\}/);
  assert.match(adminAppSource, /accessibilityState=\{\{ selected: active \}\}/);
  assert.match(adminAppSource, /const active = activeScreen === n\.key/);
  assert.match(adminAppSource, /const activeScreen = navigation\.activeScreen/);
  assert.match(adminAppSource, /adminNavigationForRole\(user\.role, screen, NAV\)/);

  for (const [key, label] of [
    ['leaderboards', 'Leaderboard rewards'],
    ['registrations', 'Registrations'],
    ['earnTasks', 'Earn tasks'],
    ['notifications', 'Notifications'],
  ]) {
    assert.match(
      adminAppSource,
      new RegExp(`key: '${key}', label: '[^']+', accessibilityLabel: '${label}'`),
    );
  }
});

test('Full Admin and Tournament Admin expose the correct selected section', () => {
  const roleCases = [
    { role: 'admin', screen: 'payments', expectedActiveScreen: 'payments' },
    { role: 'tournament_admin', screen: 'wallet', expectedActiveScreen: 'tournaments' },
  ];

  for (const { role, screen, expectedActiveScreen } of roleCases) {
    const navigation = adminNavigationForRole(role, screen, ADMIN_NAV_ITEMS);
    const selectedTabs = navigation.visibleNavKeys.filter(
      (key) => key === navigation.activeScreen,
    );

    assert.equal(navigation.activeScreen, expectedActiveScreen);
    assert.deepEqual(selectedTabs, [expectedActiveScreen]);
  }
});

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

test('successful role changes return TalkBack focus to the refreshed user role', () => {
  assert.match(usersSource, /const roleRowRefs = useRef\(new Map<string, View>\(\)\)/);
  assert.match(usersSource, /const focusRoleAfterRefresh = useRef<string \| null>\(null\)/);
  assert.match(roleChangeHandler, /focusRoleAfterRefresh\.current = u\.\$id;\s*toast\(`Role updated for \$\{u\.name\}`/);
  assert.match(roleChangeFocusEffect, /Platform\.OS !== 'android'/);
  assert.match(roleChangeFocusEffect, /setTimeout\([\s\S]*?, 350\)/);
  assert.match(roleChangeFocusEffect, /roleRowRefs\.current\.get\(userId\)/);
  assert.match(roleChangeFocusEffect, /findNodeHandle\(row\)/);
  assert.match(roleChangeFocusEffect, /AccessibilityInfo\.setAccessibilityFocus\(nativeTag\)/);
  assert.match(
    usersSource,
    /accessible\s+accessibilityRole="text"\s+accessibilityLabel=\{`\$\{u\.name\}, \$\{roleLabel\}`\}/,
    'The focus target should announce the affected user and their refreshed role as one accessible element.',
  );
  assert.match(usersSource, /<Text accessible=\{false\} style=\{st\.role\}>\{roleLabel\.toUpperCase\(\)\}<\/Text>/);
  assert.match(
    usersSource,
    /const roleLabel = u\.role === 'admin'\s*\? 'Full Admin'\s*:\s*u\.role === 'tournament_admin' \? 'Tournament Admin' : 'Player'/,
    'The focused role label must reflect the refreshed server role.',
  );
});

test('successful role changes announce success once without repeating the resulting role', () => {
  const successToasts = roleChangeHandler.match(/toast\([^;]*'success'\);/g) ?? [];
  assert.deepEqual(successToasts, ['toast(`Role updated for ${u.name}`, \'success\');']);
  assert.doesNotMatch(successToasts[0], /is now a Tournament Admin|is now a player/);
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
    '`Could not restrict Full Admin access for ${u.name}. At least one Full Admin must remain, so no change was made. `',
  );
  assert.ok(refreshIndex >= 0, 'The user list must refresh after the rejected role change.');
  assert.ok(toastIndex > refreshIndex, 'The rejection announcement follows the user-list refresh.');
  assert.match(
    rejectedRoleBranch,
    /The user row remains available\. Refresh failed: \$\{errMessage\(refreshError\)\}\./,
  );
  assert.match(
    rejectedRoleBranch,
    /Could not restrict Full Admin access for \$\{u\.name\}\. At least one Full Admin must remain, so no change was made\./,
  );
  assert.match(loadBranch, /setUsers\(u \?\? \[\]\)/);
  assert.match(
    usersSource,
    /const roleLabel = u\.role === 'admin'[\s\S]*?<Text accessible=\{false\} style=\{st\.role\}>\{roleLabel\.toUpperCase\(\)\}<\/Text>/,
    'A later successful refresh must render the server role without optimistic demotion.',
  );
  assert.match(usersSource, /const filtered = \(users \?\? \[\]\)\.filter/);
  assert.match(usersSource, /filtered\.map\(\(u\) => \{/);
  assert.match(usersSource, /<Card key=\{u\.\$id\}>/);
});