import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const screenSource = await readFile(
  new URL("../src/screens/TDetail.tsx", import.meta.url),
  "utf8",
);
const uiSource = await readFile(
  new URL("../src/components/ui.tsx", import.meta.url),
  "utf8",
);
const squadApiSource = await readFile(
  new URL("../../api-server/src/routes/daily007-v2.ts", import.meta.url),
  "utf8",
);

test("squad team cards render each team with four equal, responsive slot columns", () => {
  assert.match(squadApiSource, /FROM generate_series\(1, 12\) AS numbers\(team_number\)/);
  assert.match(squadApiSource, /Array\.from\(\{ length: 12 \}/);
  assert.match(squadApiSource, /slots: Array\.from\(\{ length: 4 \}/);
  assert.match(screenSource, /slots\.teams\.map\(\(team\) => \{/);
  assert.match(screenSource, /team\.slots\.map\(\(slot\) => \{/);
  assert.match(screenSource, /joinedCount = team\.slots\.filter\(\(slot\) => slot\.occupied\)\.length/);
  assert.match(screenSource, /\{joinedCount\}\/4 JOINED/);

  const gridStyle = screenSource.match(/squadSlotsRow:\s*\{([^}]+)\}/)?.[1] ?? "";
  const columnStyle = screenSource.match(/squadSlotColumn:\s*\{([^}]+)\}/)?.[1] ?? "";
  const slotStyle = screenSource.match(/squadSlot:\s*\{([\s\S]*?)\n\s*\},/)?.[1] ?? "";

  assert.match(gridStyle, /flexDirection:\s*'row'/);
  assert.match(gridStyle, /gap:\s*10/);
  assert.match(columnStyle, /flex:\s*1/);
  assert.match(columnStyle, /minWidth:\s*0/);
  assert.match(slotStyle, /height:\s*76/);
  assert.match(slotStyle, /width:\s*'100%'/);
});

test("slot captions use the full Captain label and open slots show OPEN · SELECT", () => {
  assert.match(screenSource, /const isCaptainSlot = slot\.slotNumber === 1/);
  assert.match(screenSource, /const slotTitle = isCaptainSlot \? 'Captain' : String\(slot\.slotNumber\)/);
  assert.match(screenSource, /'OPEN · SELECT'/);
  assert.match(screenSource, /squadSlotCrown/);
});

test("selecting an open slot shows a contextual join button and keeps the form inside that team card", () => {
  const actionArea = screenSource.match(
    /<View style=\{s\.squadSlotActionArea\}>[\s\S]*?<\/View>\s*<\/View>/,
  )?.[0] ?? "";
  assert.match(actionArea, /isSelected && slot\.canJoin/);
  assert.match(actionArea, /accessibilityLabel=\{`Join Team \$\{teamNumber\}`\}/);
  assert.match(actionArea, /squad-join-select-/);
  assert.match(screenSource, /selectedForTeam && selectedSlot\?\.canJoin && joinDetailsOpen/);
  assert.match(screenSource, /testID="squad-game-name"/);
  assert.match(screenSource, /testID="squad-game-uid"/);
  assert.doesNotMatch(screenSource, /\{selected && selectedSlot\?\.canJoin \?\s*\(\s*<Card style=\{\{ marginTop: 4 \}\}/);
});

test("the selected slot uses the requested cyan glow and the squad palette", () => {
  const selectedStyle = screenSource.match(
    /squadSlotSelected:\s*\{([\s\S]*?)\n\s*\},/,
  )?.[1] ?? "";
  assert.match(selectedStyle, /borderColor:\s*C\.squadAccent/);
  assert.match(selectedStyle, /borderWidth:\s*2/);
  assert.match(selectedStyle, /boxShadow:\s*'0px 0px 12px rgba\(0, 240, 255, 0\.4\)'/);
  assert.match(selectedStyle, /shadowOpacity:\s*0\.4/);
  assert.match(uiSource, /squadPanel:\s*'#0b1120'/);
  assert.match(uiSource, /squadAccent:\s*'#00f0ff'/);
});

test("captain removal still requires confirmation and keeps the no-refund warning", () => {
  assert.match(screenSource, /testID=\{`squad-remove-\$\{team\.teamNumber\}-\$\{slot\.slotNumber\}`\}/);
  assert.match(screenSource, /Remove this player\? Their entry fee will not be refunded\./);
  assert.match(screenSource, /testID=\{`squad-remove-confirm-\$\{team\.teamNumber\}-\$\{pendingRemoval\.slotNumber\}`\}/);
});
