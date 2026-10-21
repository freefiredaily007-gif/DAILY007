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
const modeSeatPanelSource = await readFile(
  new URL("../src/components/ModeSeatSlotsPanel.tsx", import.meta.url),
  "utf8",
);
const squadApiSource = await readFile(
  new URL("../../api-server/src/routes/daily007-v2.ts", import.meta.url),
  "utf8",
);

test("squad team cards render each team with four equal, responsive slot columns", () => {
  assert.match(squadApiSource, /FROM generate_series\(1, \$2::integer\) AS numbers\(team_number\)/);
  assert.match(squadApiSource, /const teams = Array\.from\(\{ length: capacity \}/);
  assert.match(squadApiSource, /slots: Array\.from\(\{ length: teamSize \}/);
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

test("slot captions use the full Captain label and open slots show OPEN • SELECT", () => {
  assert.match(screenSource, /const isCaptainSlot = slot\.slotNumber === 1/);
  assert.match(screenSource, /const slotTitle = isCaptainSlot \? 'Captain' : String\(slot\.slotNumber\)/);
  assert.match(screenSource, /'OPEN • SELECT'/);
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

test("open and occupied slots use live green and red availability styles", () => {
  const availableStyle = screenSource.match(
    /squadSlotAvailable:\s*\{([\s\S]*?)\n\s*\},/,
  )?.[1] ?? "";
  const occupiedStyle = screenSource.match(
    /squadSlotOccupied:\s*\{([\s\S]*?)\n\s*\},/,
  )?.[1] ?? "";

  assert.match(screenSource, /const slotIsOccupied = Boolean\(slot\.occupied\)/);
  assert.match(screenSource, /const canSelectSlot = !slotIsOccupied && slot\.canJoin/);
  assert.match(screenSource, /slotIsOccupied \? s\.squadSlotOccupied : s\.squadSlotAvailable/);
  assert.match(
    screenSource,
    /const slotStatus = slotIsOccupied\s*\?\s*slot\.gameName \|\| 'Registered player'\s*:\s*'OPEN • SELECT'/,
  );
  assert.match(screenSource, /style=\{slotIsOccupied \? s\.squadSlotName : s\.squadSlotOpen\}/);
  assert.match(screenSource, /disabled={!canSelectSlot \|\| Boolean\(busyKey\)}/);
  assert.match(screenSource, /cursor: canSelectSlot && !busyKey \? 'pointer' : 'not-allowed'/);
  assert.match(screenSource, /onHoverIn=\{\(\) => \{\s*if \(canSelectSlot\) setHoveredSlotKey\(slotKey\);/);
  assert.match(screenSource, /isHovered && s\.squadSlotHovered/);
  assert.match(availableStyle, /borderColor:\s*'#2ecc71'/);
  assert.match(availableStyle, /backgroundColor:\s*'rgba\(46, 204, 113, 0\.12\)'/);
  assert.match(occupiedStyle, /borderColor:\s*'#e74c3c'/);
  assert.match(occupiedStyle, /backgroundColor:\s*'rgba\(231, 76, 60, 0\.14\)'/);

  const openTextStyle = screenSource.match(/squadSlotOpen:\s*\{([\s\S]*?)\n\s*\},/)?.[1] ?? "";
  const joinedTextStyle = screenSource.match(/squadSlotName:\s*\{([\s\S]*?)\n\s*\},/)?.[1] ?? "";
  assert.match(openTextStyle, /color:\s*'#2ecc71'/);
  assert.match(joinedTextStyle, /color:\s*'#e74c3c'/);
});

test("selected open slots keep the green glow while the surrounding Squad palette remains intact", () => {
  const selectedStyle = screenSource.match(
    /squadSlotSelected:\s*\{([\s\S]*?)\n\s*\},/,
  )?.[1] ?? "";
  assert.match(selectedStyle, /borderColor:\s*'#2ecc71'/);
  assert.match(selectedStyle, /borderWidth:\s*2/);
  assert.match(selectedStyle, /boxShadow:\s*'0px 0px 12px rgba\(46, 204, 113, 0\.42\)'/);
  assert.match(selectedStyle, /shadowOpacity:\s*0\.4/);
  assert.match(uiSource, /squadPanel:\s*'#0A1230'/);
  assert.match(uiSource, /squadAccent:\s*'#52D5FF'/);
});

test("BR Solo uses a readable responsive seat grid without changing seat selection behavior", () => {
  assert.match(modeSeatPanelSource, /const individualGridBasis = width >= 800 \? '23%' : width >= 520 \? '31%' : '48%'/);
  assert.match(modeSeatPanelSource, /individual && \(layout\.directDuel \? styles\.duelSeatCard : individualGridSeatStyle\)/);
  assert.match(modeSeatPanelSource, /individualGridSlot:\s*\{[\s\S]*?height:\s*84,[\s\S]*?minHeight:\s*84/);
  assert.match(modeSeatPanelSource, /individualGridLabel:\s*\{[^}]*fontSize:\s*12/);
  assert.match(modeSeatPanelSource, /individualGridStatus:\s*\{[^}]*fontSize:\s*10/);
  assert.match(modeSeatPanelSource, /onPress=\{\(\) => \{\s*if \(!occupied && canSelect\) setSelectedSeat\(\{ groupNumber, slotIndex \}\);/);
  assert.match(modeSeatPanelSource, /selected \? \([\s\S]*?onPress=\{\(\) => onJoinSlot\(groupNumber, slotIndex \+ 1\)\}/);
  assert.match(modeSeatPanelSource, /occupied \? styles\.occupied : styles\.open/);
});

test("captain removal still requires confirmation and keeps the no-refund warning", () => {
  assert.match(screenSource, /testID=\{`squad-remove-\$\{team\.teamNumber\}-\$\{slot\.slotNumber\}`\}/);
  assert.match(screenSource, /Remove this player\? Their entry fee will not be refunded\./);
  assert.match(screenSource, /testID=\{`squad-remove-confirm-\$\{team\.teamNumber\}-\$\{pendingRemoval\.slotNumber\}`\}/);
});
