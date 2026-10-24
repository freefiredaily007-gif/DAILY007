import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getTournamentFormatPresentation } from '../src/lib/tournamentFormatPresentation.ts';

const uiPath = new URL('../src/components/ui.tsx', import.meta.url);
const tournamentsPath = new URL('../src/screens/Tournaments.tsx', import.meta.url);
const uiSource = await readFile(uiPath, 'utf8');
const tournamentsSource = await readFile(tournamentsPath, 'utf8');
const matchCardSource = uiSource.slice(
  uiSource.indexOf('export function MatchCard('),
  uiSource.indexOf('const mc = StyleSheet.create'),
);

const tournamentFormatArt = {
  solo: 'tournament-solo-showdown.jpg',
  duo: 'tournament-duo-showdown.jpg',
  squad: 'tournament-squad-showdown.jpg',
};
const battleRoyalePosterArt = {
  solo: 'battle-royale-solo-poster-landscape.jpg',
  duo: 'battle-royale-duo-poster-landscape.jpg',
  squad: 'battle-royale-squad-poster-landscape.jpg',
};

test('Battle Royale Solo, Duo, and Squad select their matching landscape posters', () => {
  for (const format of ['solo', 'duo', 'squad']) {
    const presentation = getTournamentFormatPresentation(
      { gameMode: 'battle_royale', teamType: format },
      { tournamentFormatArt, battleRoyalePosterArt },
    );

    assert.equal(presentation.image, battleRoyalePosterArt[format]);
    assert.equal(presentation.format, format);
    assert.equal(presentation.showBattleRoyalePoster, true);
    assert.equal(presentation.showFormatBanner, false);
  }

  for (const [format, filename] of Object.entries(battleRoyalePosterArt)) {
    assert.ok(uiSource.includes(`${format}: require('../assets/${filename}')`));
  }
  assert.match(
    uiSource,
    /export function getTournamentFormatPresentation\(t: any\) \{\s*return selectTournamentFormatPresentation\(t,\s*\{\s*tournamentFormatArt,\s*battleRoyalePosterArt,\s*\}\);\s*\}/,
  );
});

test('non-Battle-Royale tournaments keep their format art and banner behavior', () => {
  for (const format of ['solo', 'duo', 'squad']) {
    const presentation = getTournamentFormatPresentation(
      { gameMode: 'clash_squad', teamType: format },
      { tournamentFormatArt, battleRoyalePosterArt },
    );

    assert.equal(presentation.image, tournamentFormatArt[format]);
    assert.equal(presentation.showBattleRoyalePoster, false);
    assert.equal(presentation.showFormatBanner, true);
  }

  const loneWolf = getTournamentFormatPresentation(
    { mode: 'Lone Wolf', teamType: 'Solo' },
    { tournamentFormatArt, battleRoyalePosterArt },
  );
  assert.equal(loneWolf.image, tournamentFormatArt.solo);
  assert.equal(loneWolf.showFormatBanner, true);

  for (const gameMode of ['clash_squad', 'lone_wolf']) {
    const trio = getTournamentFormatPresentation(
      { gameMode, teamType: 'trio' },
      { tournamentFormatArt, battleRoyalePosterArt },
    );
    assert.equal(trio.image, tournamentFormatArt.duo);
    assert.equal(trio.format, 'trio');
    assert.equal(trio.matchup, '3 VS 3');
    assert.equal(trio.showBattleRoyalePoster, false);
    assert.equal(trio.showFormatBanner, true);
  }
});

test('the tournament card retains its title, status, values, slot counts, and Join navigation', () => {
  assert.match(matchCardSource, /t\?\.name \|\| t\?\.title \|\| 'Tournament'/);
  assert.match(matchCardSource, /<Badge text=\{s\.label\} color=\{s\.color\} \/>/);
  assert.match(matchCardSource, /ENTRY[\s\S]*t\?\.entryCoins \?\? 0/);
  assert.match(matchCardSource, /PRIZE POOL[\s\S]*t\?\.prizePool \?\? 0/);
  assert.match(matchCardSource, /\{displayedFilled\}\/\{displayedTotal\} \{slotUnit\}/);
  assert.match(matchCardSource, /'JOIN NOW →'/);
  assert.match(
    tournamentsSource,
    /<MatchCard[\s\S]*?onPress=\{\(\) => nav\.push\('TDetail', \{ id: item\.id \}\)\}/,
  );
});

test('large-text tournament cards stack titles, metadata, and stats without removing list navigation', () => {
  assert.match(matchCardSource, /largeText = false/);
  assert.match(tournamentsSource, /<MatchCard[\s\S]*?largeText=\{largeText\}/);
  assert.match(uiSource, /artworkLarge:\s*\{[^}]*justifyContent: 'flex-start'[^}]*rowGap:/);
  assert.match(uiSource, /artTopLarge:\s*\{[^}]*flexDirection: 'column'/);
  assert.match(uiSource, /topRowLarge:\s*\{[^}]*flexDirection: 'column'/);
  assert.match(uiSource, /metaRowLarge:\s*\{[^}]*flexDirection: 'column'/);
  assert.match(uiSource, /statRowLarge:\s*\{[^}]*flexDirection: 'column'/);
  assert.match(uiSource, /statLarge:\s*\{[^}]*flex: 0[^}]*width: '100%'[^}]*borderBottomWidth: 1/);
  assert.match(
    tournamentsSource,
    /data=\{orderedVisible\}[\s\S]*?<MatchCard[\s\S]*?onPress=\{\(\) => nav\.push\('TDetail', \{ id: item\.id \}\)\}/,
    'the lifecycle-filtered FlatList remains the scroll owner and cards remain tappable',
  );
});
