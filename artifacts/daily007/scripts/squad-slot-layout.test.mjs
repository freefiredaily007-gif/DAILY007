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
  const compactRowStyle = screenSource.match(/squadSlotsRowCompact:\s*\{([^}]+)\}/)?.[1] ?? "";
  const compactSlotStyle = screenSource.match(/squadSlotCompact:\s*\{([^}]+)\}/)?.[1] ?? "";
  const compactActionAreaStyle = screenSource.match(/squadSlotActionAreaCompact:\s*\{([^}]+)\}/)?.[1] ?? "";
  const compactJoinStyle = screenSource.match(/squadSlotJoinButtonCompact:\s*\{([^}]+)\}/)?.[1] ?? "";

  assert.match(gridStyle, /flexDirection:\s*'row'/);
  assert.match(gridStyle, /gap:\s*10/);
  assert.match(columnStyle, /flex:\s*1/);
  assert.match(columnStyle, /flexBasis:\s*0/);
  assert.match(columnStyle, /minWidth:\s*0/);
  assert.match(slotStyle, /height:\s*76/);
  assert.match(slotStyle, /width:\s*'100%'/);
  assert.match(screenSource, /const \{ width \} = useWindowDimensions\(\)/);
  assert.match(screenSource, /PixelRatio\.getFontScale\(\) >= 1\.5/);
  assert.match(screenSource, /width <= 400 && PixelRatio\.getFontScale\(\) >= 1\.5/);
  assert.match(compactRowStyle, /gap:\s*6/);
  assert.match(compactSlotStyle, /height:\s*92/);
  assert.match(compactActionAreaStyle, /height:\s*68/);
  assert.match(compactJoinStyle, /minHeight:\s*62/);
});

test("slot captions use the full Captain label and open slots show OPEN · SELECT", () => {
  assert.match(screenSource, /const isCaptainSlot = slot\.slotNumber === 1/);
  assert.match(screenSource, /const slotTitle = isCaptainSlot \? 'Captain' : String\(slot\.slotNumber\)/);
  assert.match(screenSource, /'OPEN · SELECT'/);
  assert.match(screenSource, /squadSlotCrown/);
  assert.match(screenSource, /maxFontSizeMultiplier=\{compactLargeText \? 1\.5 : undefined\}/);
  assert.ok(screenSource.includes('JOIN{"\\n"}TEAM{"\\n"}{teamNumber}'));
  assert.ok(screenSource.includes('JOIN{"\\n"}TEAM {teamNumber}'));
});

test("selecting an open slot shows a contextual join button and keeps the form inside that team card", () => {
  assert.match(screenSource, /squadSlotActionArea,[\s\S]*?isSelected && slot\.canJoin/);
  assert.match(screenSource, /accessibilityLabel=\{`Join Team \$\{teamNumber\}`\}/);
  assert.match(screenSource, /squad-join-select-/);
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
  assert.match(uiSource, /squadPanel:\s*'#0A1230'/);
  assert.match(uiSource, /squadAccent:\s*'#52D5FF'/);
});

test("captain removal still requires confirmation and keeps the no-refund warning", () => {
  assert.match(screenSource, /testID=\{`squad-remove-\$\{team\.teamNumber\}-\$\{slot\.slotNumber\}`\}/);
  assert.match(screenSource, /Remove this player\? Their entry fee will not be refunded\./);
  assert.match(screenSource, /testID=\{`squad-remove-confirm-\$\{team\.teamNumber\}-\$\{pendingRemoval\.slotNumber\}`\}/);
});
