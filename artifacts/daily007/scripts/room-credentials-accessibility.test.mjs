import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { copyRoomCredentialToClipboard } from "../src/lib/roomCredentialCopy.ts";

const panelSource = await readFile(
  new URL("../src/components/RoomCredentialsPanel.tsx", import.meta.url),
  "utf8",
);
const rowStart = panelSource.indexOf("function CredentialRow(");
const rowEnd = panelSource.indexOf("\nconst styles", rowStart);
assert.ok(rowStart >= 0 && rowEnd > rowStart, "The credential row component must remain present.");
const rowSource = panelSource.slice(rowStart, rowEnd);

test("Room ID and password values are separate labeled text stops", () => {
  assert.match(panelSource, /<CredentialRow label="Room ID" value=\{id\}/);
  assert.match(panelSource, /<CredentialRow label="Password" value=\{password\}/);
  assert.match(rowSource, /<View\s+accessible\s+accessibilityRole="text"/);
  assert.match(rowSource, /accessibilityLabel=\{`\$\{label\}: \$\{value\}`\}/);
  assert.match(rowSource, /<Text accessible=\{false\} style=\{styles\.label\}>/);
  assert.match(rowSource, /<Text accessible=\{false\} style=\{styles\.value\} selectable>/);
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
    /<CredentialRow label="Room ID" value=\{id\} onCopy=\{\(\) => copy\('Room ID', id\)\} \/>/,
  );
  assert.match(
    panelSource,
    /<CredentialRow label="Password" value=\{password\} onCopy=\{\(\) => copy\('Password', password\)\} \/>/,
  );
  assert.match(
    panelSource,
    /\{__DEV__ \? \(\s*<Pressable[\s\S]*?testID="room-credential-simulate-clipboard-failure"/,
  );
});
