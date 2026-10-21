import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const screenSource = await readFile(
  new URL('../src/screens/AdminRegs.tsx', import.meta.url),
  'utf8',
);

test('Admin Registrations no longer contains player-list CSV export UI or handlers', () => {
  assert.doesNotMatch(screenSource, /PLAYER LIST EXPORT|DOWNLOAD CSV|DOWNLOAD PLAYER LIST/);
  assert.doesNotMatch(screenSource, /exportCsv|expo-file-system|expo-sharing/);
});
