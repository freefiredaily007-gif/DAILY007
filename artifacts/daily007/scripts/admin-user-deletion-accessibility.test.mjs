import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const usersSource = await readFile(
  new URL('../src/screens/AdminUsers.tsx', import.meta.url),
  'utf8',
);
const adminKitSource = await readFile(
  new URL('../src/components/adminKit.tsx', import.meta.url),
  'utf8',
);

const deleteAction = usersSource.match(
  /<Btn\s+title="PERMANENTLY DELETE ACCOUNT"[\s\S]*?\/>/,
)?.[0] ?? '';
const warningStart = usersSource.indexOf('visible={deleteWarningTarget !== null}');
const warningEnd = usersSource.indexOf('/>', warningStart);
const warningDialog = warningStart >= 0 && warningEnd >= 0
  ? usersSource.slice(warningStart, warningEnd + 2)
  : '';
const promptStart = usersSource.indexOf('<PromptDialog');
const promptEnd = usersSource.indexOf('/>', promptStart);
const deletePrompt = promptStart >= 0 && promptEnd >= 0
  ? usersSource.slice(promptStart, promptEnd + 2)
  : '';
const deleteHandler = usersSource.match(
  /const confirmDeleteUser = async \(email: string\): Promise<boolean> => \{([\s\S]*?)\n\s*\};/,
)?.[1] ?? '';

test('the delete control identifies the selected account and is hidden for self and privileged users', () => {
  assert.ok(deleteAction, 'The permanent-delete action must remain present for eligible accounts.');
  assert.match(
    deleteAction,
    /accessibilityLabel=\{`Permanently delete account for \$\{u\.name\}, \$\{u\.email\}`\}/,
  );
  assert.match(deleteAction, /accessibilityHint="Opens a permanent-loss warning/);
  assert.match(
    usersSource,
    /\{!!currentUserId && u\.\$id !== currentUserId && u\.role === 'user' && \(/,
    'Only regular accounts other than the current administrator may expose deletion.',
  );
  assert.match(adminKitSource, /accessibilityRole="button"/);
});

test('the first dialog announces the account, permanent data loss, and teammate impact once', () => {
  assert.match(
    usersSource,
    /Their teammates will remain Daily007 users but will be removed from these tournament rosters\./,
  );
  assert.match(usersSource, /This cannot be undone\./);
  assert.match(usersSource, /their Google account itself will remain/);
  assert.match(warningDialog, /announcementLabel=\{deleteWarningTarget/);
  assert.match(warningDialog, /announcementLiveRegion="polite"/);
  assert.match(warningDialog, /confirmAccessibilityLabel=\{deleteWarningTarget/);
  assert.match(warningDialog, /confirmAccessibilityHint="The account is not removed until its email is entered\."/);
  assert.match(
    adminKitSource,
    /<View\s+accessible\s+accessibilityRole="text"\s+accessibilityLabel=\{announcementLabel\}\s+accessibilityLiveRegion=\{announcementLiveRegion\}/,
  );
  assert.match(adminKitSource, /<Text accessible=\{false\} style=\{s\.dialogTitle\}>/);
  assert.match(adminKitSource, /<Text accessible=\{false\} style=\{s\.dialogMsg\}>/);
});

test('the email field names the exact target and a mismatch stays in the prompt', () => {
  assert.match(
    deletePrompt,
    /Type \$\{deleteEmailTarget\.email\} exactly as shown/,
  );
  assert.match(
    deletePrompt,
    /accessibilityLabel=\{deleteEmailTarget[\s\S]*?Type the exact email \$\{deleteEmailTarget\.email\}[\s\S]*?\}/,
  );
  assert.match(deletePrompt, /accessibilityHint="Enter the account email shown above/);
  assert.match(deletePrompt, /submitting=\{deleteBusy\}/);
  assert.match(
    deleteHandler,
    /if \(email\.trim\(\)\.toLowerCase\(\) !== String\(user\.email\)\.trim\(\)\.toLowerCase\(\)\) \{\s*toast\('The email does not match this account\. No data was removed\.', 'error'\);\s*return false;/,
  );
  assert.match(
    adminKitSource,
    /const accepted = await onSubmit\(val\);\s*if \(accepted !== false\) setVal\(''\);/,
    'A mismatch must preserve the entered value and keep the input available.',
  );
});

test('deletion progress, success, and failure are announced without programmatic focus moves', () => {
  assert.match(
    deletePrompt,
    /submittingMessage=\{deleteEmailTarget[\s\S]*?Deleting \$\{deleteEmailTarget\.name\}'s account permanently\. Please wait\./,
  );
  assert.match(
    adminKitSource,
    /<Text accessibilityLiveRegion="polite" style=\{s\.dialogMsg\}>\s*\{submittingMessage\}\s*<\/Text>/,
  );
  assert.match(adminKitSource, /accessibilityState=\{\{ disabled: submitting, busy: submitting \}\}/);
  assert.match(adminKitSource, /if \(submitting\) return;\s*setVal\(''\);\s*onCancel\(\);/);

  assert.match(
    deleteHandler,
    /const result = await deleteUserMutation\.mutateAsync\([\s\S]*?setDeleteEmailTarget\(null\);[\s\S]*?toast\(\s*`Permanently removed \$\{user\.name\}/,
    'The prompt closes and the account-specific success message appears only after the API succeeds.',
  );
  assert.match(deleteHandler, /catch \(e\) \{\s*toast\(errMessage\(e\), 'error'\);\s*await load\(\);\s*return false;/);
  assert.doesNotMatch(deleteHandler, /AccessibilityInfo|\.focus\(/);
  assert.match(adminKitSource, /accessibilityLabel=\{toast\.msg\}/);
  assert.match(adminKitSource, /accessibilityRole=\{toast\.kind === 'err' \? 'alert' : undefined\}/);
  assert.match(adminKitSource, /accessibilityLiveRegion=\{toast\.kind === 'err' \? 'assertive' : 'polite'\}/);
});
