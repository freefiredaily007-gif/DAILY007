import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { copyRoomCredentialToClipboard } from "../src/lib/roomCredentialCopy.ts";
import { shouldStackRoomCredentialRows } from "../src/lib/roomCredentialLayout.ts";

const panelSource = await readFile(
  new URL("../src/components/RoomCredentialsPanel.tsx", import.meta.url),
  "utf8",
);
const rowStart = panelSource.indexOf("function CredentialRow(");
const rowEnd = panelSource.indexOf("\nconst styles", rowStart);
assert.ok(rowStart >= 0 && rowEnd > rowStart, "The credential row component must remain present.");
const rowSource = panelSource.slice(rowStart, rowEnd);

test("Room ID and password values are separate labeled text stops", () => {
  assert.match(panelSource, /<CredentialRow\s+label="Room ID"\s+value=\{id\}/);
  assert.match(panelSource, /<CredentialRow\s+label="Password"\s+value=\{password\}/);
  assert.match(rowSource, /<View\s+accessible\s+accessibilityRole="text"/);
  assert.match(rowSource, /accessibilityLabel=\{`\$\{label\}: \$\{value\}`\}/);
  assert.match(rowSource, /<Text accessible=\{false\} style=\{styles\.label\}>/);
  assert.match(rowSource, /<Text accessible=\{false\} style=\{styles\.value\} selectable>/);
});

test("large text on a narrow phone stacks each full-width value above its copy button", () => {
  assert.equal(shouldStackRoomCredentialRows(1, 320), false);
  assert.equal(shouldStackRoomCredentialRows(1.49, 320), false);
  assert.equal(shouldStackRoomCredentialRows(1.5, 320), true);
  assert.equal(shouldStackRoomCredentialRows(1.8, 380), true);
  assert.equal(shouldStackRoomCredentialRows(1.5, 381), false);

  assert.match(panelSource, /useWindowDimensions/);
  assert.match(
    panelSource,
    /shouldStackRoomCredentialRows\(fontScale, width\)/,
  );
  assert.match(
    panelSource,
    /<CredentialRow[\s\S]*?label="Room ID"[\s\S]*?stackRows=\{stackCredentialRows\}/,
  );
  assert.match(
    panelSource,
    /<CredentialRow[\s\S]*?label="Password"[\s\S]*?stackRows=\{stackCredentialRows\}/,
  );
  assert.match(
    rowSource,
    /style=\{\[styles\.credentialRow, stackRows && styles\.credentialRowStacked\]\}/,
  );
  assert.match(
    rowSource,
    /style=\{\[styles\.copyButton, stackRows && styles\.copyButtonStacked\]\}/,
  );
  assert.match(panelSource, /credentialRowStacked: \{ flexDirection: 'column', alignItems: 'stretch'/);
  assert.match(panelSource, /copyButtonStacked: \{ alignSelf: 'flex-start' \}/);
  assert.match(panelSource, /copyButton: \{ minHeight: 40, maxWidth: '100%'/);
  assert.match(panelSource, /copyText: \{ flexShrink: 1/);
  assert.doesNotMatch(rowSource, /numberOfLines=/);
});

test("copy controls have distinct labels and hide their decorative child stops", () => {
  const pressableStart = rowSource.indexOf("<Pressable");
  const pressableEnd = rowSource.indexOf("</Pressable>", pressableStart);
  assert.ok(pressableStart >= 0 && pressableEnd > pressableStart);
  const buttonSource = rowSource.slice(pressableStart, pressableEnd + "</Pressable>".length);
  assert.match(buttonSource, /accessibilityRole="button"/);
  assert.match(buttonSource, /accessibilityLabel=\{`Copy \$\{label\}`\}/);
  assert.match(buttonSource, /accessibilityHint="Copies this value to your clipboard\."/);
  assert.match(buttonSource, /<Feather accessible=\{false\}/);
  assert.match(buttonSource, /<Text accessible=\{false\} style=\{styles\.copyText\}>Copy \{label\}<\/Text>/);
});

test("clipboard success and failure return clear feedback for TalkBack announcements", async () => {
  const success = await copyRoomCredentialToClipboard(
    "Room ID",
    "FAKE-ROOM-123",
    async (value) => value === "FAKE-ROOM-123",
  );
  assert.deepEqual(success, {
    kind: "success",
    message: "Room ID copied to clipboard.",
  });

  const declined = await copyRoomCredentialToClipboard("Password", "FAKE-PASS", async () => false);
  assert.deepEqual(declined, {
    kind: "failure",
    message: "Could not copy Password. Please try again.",
  });

  const rejected = await copyRoomCredentialToClipboard("Room ID", "FAKE-ROOM-123", async () => {
    throw new Error("clipboard unavailable");
  });
  assert.deepEqual(rejected, {
    kind: "failure",
    message: "Could not copy Room ID. Please try again.",
  });

  assert.match(panelSource, /AccessibilityInfo\.announceForAccessibility\(feedback\.message\)/);
  assert.match(panelSource, /testID="room-credential-copy-feedback"/);
});

test("clipboard failure simulation is development-only and covers both credentials", () => {
  assert.match(
    panelSource,
    /const \[simulateClipboardFailure, setSimulateClipboardFailure\] = useState\(false\)/,
  );
  assert.match(
    panelSource,
    /const writeClipboard = __DEV__ && simulateClipboardFailure\s*\?\s*async \(\) => \{ throw new Error\('Simulated clipboard failure'\); \}/,
  );
  assert.match(
    panelSource,
    /<CredentialRow\s+label="Room ID"\s+value=\{id\}\s+onCopy=\{\(\) => copy\('Room ID', id\)\}\s+stackRows=\{stackCredentialRows\}\s+\/>/,
  );
  assert.match(
    panelSource,
    /<CredentialRow\s+label="Password"\s+value=\{password\}\s+onCopy=\{\(\) => copy\('Password', password\)\}\s+stackRows=\{stackCredentialRows\}\s+\/>/,
  );
  assert.match(
    panelSource,
    /\{__DEV__ \? \(\s*<Pressable[\s\S]*?testID="room-credential-simulate-clipboard-failure"/,
  );
});
