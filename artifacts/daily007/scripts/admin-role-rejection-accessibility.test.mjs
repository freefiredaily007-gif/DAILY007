import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
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

function loadRenderedAdminTabs(role) {
  const sourceFile = ts.createSourceFile(
    'AdminApp.tsx',
    adminAppSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const sourceWithoutImports = sourceFile.statements
    .filter((statement) => !ts.isImportDeclaration(statement))
    .map((statement) => statement.getFullText(sourceFile))
    .join('\n')
    .replace('export default function AdminApp(', 'function AdminApp(');
  const compiled = ts.transpileModule(sourceWithoutImports, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const createComponent = () => function Component() {};
  const hostElement = () => {};
  const React = {
    createElement(type, props, ...children) {
      return {
        type,
        props: {
          ...(props ?? {}),
          ...(children.length
            ? { children: children.length === 1 ? children[0] : children }
            : {}),
        },
      };
    },
  };
  const scope = {
    React,
    useEffect() {},
    useRef: (current) => ({ current }),
    useState: (initial) => [initial, () => {}],
    View: hostElement,
    StyleSheet: { create: (styles) => styles },
    Pressable: hostElement,
    ScrollView: hostElement,
    Image: hostElement,
    Text: hostElement,
    Feather: { glyphMap: {}, },
    useApp: () => ({
      user: { role, id: 'test-admin', name: 'Test Admin', email: 'admin@example.test' },
      refresh() {},
      logout() {},
    }),
    A: new Proxy({}, { get: (_target, property) => String(property) }),
    AdminToastHost: createComponent(),
    AdminUiProvider: createComponent(),
    AdminDashboard: createComponent(),
    AdminTournaments: createComponent(),
    AdminRegs: createComponent(),
    AdminPayments: createComponent(),
    AdminWallet: createComponent(),
    AdminUsers: createComponent(),
    AdminNotifications: createComponent(),
    AdminSettings: createComponent(),
    AdminEarnTasks: createComponent(),
    AdminVideos: createComponent(),
    AdminLeaderboards: createComponent(),
    logoImg: {},
    adminNavigationForRole,
    canNavigateAdminScreen: () => true,
  };
  const AdminApp = new Function(
    ...Object.keys(scope),
    `${compiled}\nreturn AdminApp;`,
  )(...Object.values(scope));
  const tree = AdminApp({});
  const elements = [];
  function visit(node) {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === 'object' && 'type' in node) {
      elements.push(node);
      visit(node.props?.children);
    }
  }
  visit(tree);
  const renderedText = (node) => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(renderedText).join('');
    if (node && typeof node === 'object' && 'type' in node) {
      return renderedText(node.props?.children);
    }
    return '';
  };
  return elements.filter((element) =>
    typeof element.props?.testID === 'string' &&
    element.props.testID.startsWith('admin-tab-'))
    .map((element) => ({ ...element, visibleLabel: renderedText(element.props.children) }));
}

test('Admin tabs expose readable names and announce the selected section', () => {
  assert.match(adminAppSource, /accessibilityRole="tab"/);
  assert.match(adminAppSource, /accessibilityLabel=\{n\.accessibilityLabel \?\? n\.label\}/);
  assert.match(adminAppSource, /accessibilityState=\{\{ selected: active \}\}/);
  assert.match(adminAppSource, /const active = activeScreen === n\.key/);
  assert.match(adminAppSource, /const activeScreen = navigation\.activeScreen/);
  assert.match(adminAppSource, /adminNavigationForRole\(user\.role, screen, NAV\)/);

  for (const [key, label, accessibleLabel] of [
    ['leaderboards', 'Leaderboards', 'Leaderboard rewards'],
    ['registrations', 'Registrations', 'Registrations'],
    ['earnTasks', 'Earn tasks', 'Earn tasks'],
    ['notifications', 'Notifications', 'Notifications'],
  ]) {
    assert.match(
      adminAppSource,
      new RegExp(`key: '${key}', label: '${label}'`),
    );
    if (accessibleLabel !== label) {
      assert.match(adminAppSource, new RegExp(`key: '${key}', label: '${label}', accessibilityLabel: '${accessibleLabel}'`));
    }
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

test('rendered Admin tabs expose the right names, roles, selection, and role restrictions', () => {
  const roleCases = [
    {
      role: 'admin',
      expectedTabs: [
        ['dashboard', 'Dashboard', 'Dashboard'],
        ['leaderboards', 'Leaderboard rewards', 'Leaderboards'],
        ['tournaments', 'Tournaments', 'Tournaments'],
        ['registrations', 'Registrations', 'Registrations'],
        ['payments', 'Payments', 'Payments'],
        ['wallet', 'Wallet', 'Wallet'],
        ['earnTasks', 'Earn tasks', 'Earn tasks'],
        ['videos', 'Videos', 'Videos'],
        ['users', 'Users', 'Users'],
        ['notifications', 'Notifications', 'Notifications'],
        ['settings', 'Settings', 'Settings'],
      ],
      selectedTab: 'dashboard',
    },
    {
      role: 'tournament_admin',
      expectedTabs: [
        ['tournaments', 'Tournaments', 'Tournaments'],
        ['registrations', 'Registrations', 'Registrations'],
      ],
      selectedTab: 'tournaments',
    },
  ];

  for (const { role, expectedTabs, selectedTab } of roleCases) {
    const tabs = loadRenderedAdminTabs(role);
    assert.deepEqual(
      tabs.map(({ props, visibleLabel }) => [
        props.testID.replace('admin-tab-', ''),
        props.accessibilityLabel,
        visibleLabel,
      ]),
      expectedTabs,
      `${role} should render only its allowed tabs with their accessible names.`,
    );
    for (const { props } of tabs) {
      assert.equal(
        props.accessibilityRole,
        'tab',
        `${props.testID} should have the tab accessibility role.`,
      );
      assert.equal(typeof props.onPress, 'function', `${props.testID} should be tappable.`);
      assert.equal(typeof props.onLayout, 'function', `${props.testID} should report its scroll position.`);
      assert.equal(
        props.accessibilityState?.selected,
        props.testID === `admin-tab-${selectedTab}`,
        `${props.testID} should report whether it is the current section.`,
      );
    }
    assert.deepEqual(
      tabs.filter(({ props }) => props.accessibilityState?.selected)
        .map(({ props }) => props.testID),
      [`admin-tab-${selectedTab}`],
      `${role} should have exactly one selected section.`,
    );
  }
});

test('Admin tabs stay readable and the selected section scrolls into view at enlarged text sizes', () => {
  assert.match(adminAppSource, /testID="admin-section-tabs"/);
  assert.match(adminAppSource, /accessibilityLabel="Admin sections"/);
  assert.match(adminAppSource, /<ScrollView[\s\S]*?horizontal[\s\S]*?contentContainerStyle=\{st\.nav\}/);
  assert.match(adminAppSource, /<Text allowFontScaling style=\{\[st\.navLabel, active && st\.navLabelActive\]\}>\{n\.label\}<\/Text>/);
  assert.match(
    adminAppSource,
    /navItem: \{[^}]*flexShrink: 0[^}]*minHeight: 56/,
    'Tabs should grow with their scaled labels rather than shrink or clip.',
  );
  assert.match(
    adminAppSource,
    /navLabel: \{[^}]*fontSize: 11[^}]*textAlign: 'center'/,
    'Section names should remain legible and centered at enlarged Android text sizes.',
  );
  assert.match(adminAppSource, /navItemOffsets\.current\[n\.key\] = event\.nativeEvent\.layout\.x/);
  assert.match(adminAppSource, /navScrollRef\.current\?\.scrollTo\(\{ x: Math\.max\(0, targetX - 8\), animated: true \}\)/);
});

test('admin error toasts expose the exact message as an assertive TalkBack alert', () => {
  assert.match(toastSource, /accessibilityLabel=\{toast\.msg\}/);
  assert.match(
    toastSource,
    /accessibilityRole=\{Platform\.OS !== 'ios' && toast\.kind === 'err' \? 'alert' : undefined\}/,
  );
  assert.match(
    toastSource,
    /accessibilityLiveRegion=\{Platform\.OS === 'ios'\s*\?\s*undefined\s*:\s*toast\.kind === 'err' \? 'assertive' : 'polite'\}/,
  );
  assert.match(typographySource, /<NativeText\s+\{\.\.\.props\}/);
});

test('successful toasts announce politely without including the decorative checkmark', () => {
  assert.match(toastSource, /testID="admin-toast"/);
  assert.match(toastSource, /accessibilityLabel=\{toast\.msg\}/);
  assert.match(
    toastSource,
    /accessibilityLiveRegion=\{Platform\.OS === 'ios'\s*\?\s*undefined\s*:\s*toast\.kind === 'err' \? 'assertive' : 'polite'\}/,
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
  assert.match(
    refreshFailureBranch,
    /pendingFullAdminRecovery\.current = \{\s*userId: String\(u\.\$id\),\s*userName: String\(u\.name \|\| 'this user'\),\s*\}/,
    'A failed follow-up refresh must retain which Full Admin needs confirmation after recovery.',
  );
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
  assert.match(loadBranch, /const loadedUsers(?:: any\[\])? = u \?\? \[\];\s*setUsers\(loadedUsers\);/);
  assert.match(
    usersSource,
    /const roleLabel = u\.role === 'admin'[\s\S]*?<Text accessible=\{false\} style=\{st\.role\}>\{roleLabel\.toUpperCase\(\)\}<\/Text>/,
    'A later successful refresh must render the server role without optimistic demotion.',
  );
  assert.match(usersSource, /const filtered = \(users \?\? \[\]\)\.filter/);
  assert.match(usersSource, /filtered\.map\(\(u\) => \{/);
  assert.match(usersSource, /<Card key=\{u\.\$id\}>/);
});

test('a later successful refresh politely confirms the unchanged Full Admin role', () => {
  const loadBranch = usersSource.match(
    /const load = async \(\) => \{([\s\S]*?)\n\s*\};/,
  )?.[1] ?? '';
  assert.match(
    loadBranch,
    /const pendingRecovery = pendingFullAdminRecovery\.current;\s*if \(pendingRecovery\) \{/,
    'The recovery announcement should run only when a failed safeguard refresh left pending context.',
  );
  assert.match(
    loadBranch,
    /const refreshedUser = loadedUsers\.find\(\s*\(user\) => String\(user\.\$id\) === pendingRecovery\.userId,/,
    'The refreshed list must identify the affected account using the returned server data.',
  );
  assert.match(loadBranch, /pendingFullAdminRecovery\.current = null;/);
  assert.match(
    loadBranch,
    /refreshedUser\?\.role === 'admin'[\s\S]*?User list is current\. \$\{refreshedUser\.name \|\| pendingRecovery\.userName\} remains Full Admin\./,
    'Only a server-confirmed Full Admin row may be described as remaining Full Admin.',
  );
  assert.match(
    loadBranch,
    /: 'User list is current\.';/,
    'A refreshed non-admin role must use the generic current-list status.',
  );
  assert.match(loadBranch, /toast\(status, 'success'\)/);
  assert.match(
    toastSource,
    /accessibilityLabel=\{toast\.msg\}[\s\S]*?accessibilityLiveRegion=\{Platform\.OS === 'ios'\s*\?\s*undefined\s*:\s*toast\.kind === 'err' \? 'assertive' : 'polite'\}/,
    'The current-list status must use the existing polite toast live region.',
  );
  assert.match(
    usersSource,
    /const roleLabel = u\.role === 'admin'\s*\? 'Full Admin'[\s\S]*?<Text accessible=\{false\} style=\{st\.role\}>\{roleLabel\.toUpperCase\(\)\}<\/Text>/,
    'The visible role label must be derived from the refreshed server role.',
  );
});

test('recovery with an externally changed role announces only that the list is current', () => {
  const loadBranch = usersSource.match(
    /const load = async \(\) => \{([\s\S]*?)\n\s*\};/,
  )?.[1] ?? '';
  assert.match(
    loadBranch,
    /const refreshedUser = loadedUsers\.find\([\s\S]*?refreshedUser\?\.role === 'admin'[\s\S]*?: 'User list is current\.'/,
    'Only an admin role in the successful server response may produce the Full Admin recovery claim.',
  );
  assert.doesNotMatch(
    loadBranch.match(/const status = ([\s\S]*?);\s*toast\(status/)?.[1] ?? '',
    /Full Admin.*\|\|/,
    'The generic recovery status must not retain a Full Admin name or role claim.',
  );
  assert.match(
    usersSource,
    /accessibilityLabel=\{`\$\{u\.name\}, \$\{roleLabel\}`\}/,
    'The refreshed row’s accessible name must include the server-confirmed role.',
  );
  assert.match(
    usersSource,
    /<Text accessible=\{false\} style=\{st\.role\}>\{roleLabel\.toUpperCase\(\)\}<\/Text>/,
    'The visible row must render its role label from the refreshed server role.',
  );
});