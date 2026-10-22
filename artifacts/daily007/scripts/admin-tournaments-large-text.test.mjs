import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { shouldStackAdminTournamentCards } from '../src/lib/adminTournamentLayout.ts';

const screenSource = await readFile(
  new URL('../src/screens/AdminTournaments.tsx', import.meta.url),
  'utf8',
);

test('Admin tournament cards stack names, status, and management actions at 1.5x text', () => {
  assert.equal(shouldStackAdminTournamentCards(1), false);
  assert.equal(shouldStackAdminTournamentCards(1.49), false);
  assert.equal(shouldStackAdminTournamentCards(1.5), true);
  assert.equal(shouldStackAdminTournamentCards(2), true);

  assert.match(screenSource, /const \{ fontScale \} = useWindowDimensions\(\)/);
  assert.match(screenSource, /shouldStackAdminTournamentCards\(fontScale\)/);
  assert.match(
    screenSource,
    /st\.tournamentHeader,\s*stackLargeTournamentCards && st\.tournamentHeaderLarge/,
  );
  assert.match(screenSource, /tournamentHeaderLarge: \{ flexDirection: 'column', alignItems: 'stretch' \}/);
  assert.match(screenSource, /tNameLarge: \{ width: '100%', flex: 0 \}/);
  assert.match(
    screenSource,
    /st\.tournamentActionRow,\s*stackLargeTournamentCards && st\.tournamentActionColumn/,
  );
  assert.match(
    screenSource,
    /st\.tournamentActionRow,\s*\{ marginTop: cancellable \? 8 : 10 \},\s*stackLargeTournamentCards && st\.tournamentActionColumn/,
  );
  assert.match(
    screenSource,
    /tournamentActionSlotFull: \{ flex: 0, width: '100%' \}/,
  );
});

test('large-text layout keeps management actions and scrolling available', () => {
  assert.match(screenSource, /testID=\{`edit-tournament-\$\{t\.id\}`\}/);
  assert.match(screenSource, /testID=\{`delete-tournament-\$\{t\.id\}`\}/);
  assert.match(screenSource, /testID=\{`manage-room-\$\{t\.id\}`\}/);
  assert.match(screenSource, /testID=\{`finish-tournament-\$\{t\.id\}`\}/);
  assert.match(screenSource, /<KeyboardAwareScrollViewCompat[\s\S]*?visibleTournaments\.map/);
});

test('active tournaments show separate refund and no-refund deletion actions with explicit confirmation', () => {
  const cancelAction = screenSource.indexOf('title="CANCEL & REFUND"');
  const deleteNoRefundAction = screenSource.indexOf('title="DELETE (NO REFUND)"', cancelAction);
  const manageRoomAction = screenSource.indexOf('testID={`manage-room-${t.id}`}', cancelAction);
  assert.ok(
    cancelAction >= 0 && deleteNoRefundAction > cancelAction && manageRoomAction > deleteNoRefundAction,
    'The lifecycle actions must appear together before Room Setup.',
  );
  const lifecycleActions = screenSource.slice(cancelAction, manageRoomAction);

  assert.match(lifecycleActions, /title="CANCEL & REFUND"/);
  assert.match(lifecycleActions, /title="DELETE \(NO REFUND\)"/);
  assert.match(lifecycleActions, /testID=\{`delete-no-refund-tournament-\$\{t\.id\}`\}/);
  assert.match(lifecycleActions, /onPress=\{\(\) => cancel\(t\)\}/);
  assert.match(lifecycleActions, /onPress=\{\(\) => deleteWithoutRefund\(t\)\}/);
  assert.match(
    screenSource,
    /This permanently deletes the tournament and its registrations, teams, and results\. Players will not receive refunds\./,
  );
  assert.match(screenSource, /transaction records will not be changed/);
  assert.match(screenSource, /deleteNoRefundMutation\.mutateAsync\(\{ id: t\.id \}\)/);
});

test('Upcoming Admin tournaments exposes a visible Add New Tournament action for the existing form', () => {
  assert.match(
    screenSource,
    /tab === 'upcoming' && \(\s*<Btn\s+title=\{showForm \? 'CLOSE CREATE FORM' : 'ADD NEW TOURNAMENT'\}[\s\S]*?accessibilityLabel=\{showForm \? 'Close tournament creation form' : 'Add a new tournament'\}[\s\S]*?testID="admin-tournament-create-toggle"[\s\S]*?alignSelf: 'stretch'/,
  );
  assert.match(screenSource, /setShowForm\(!showForm\)/);
  assert.match(screenSource, /testID="admin-tournament-create-form"/);
  assert.match(screenSource, /else \{ await Api\.createTournament\(payload\); setOkMsg\('Tournament created successfully'\); \}/);
});
