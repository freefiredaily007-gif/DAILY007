import test from "node:test";
import assert from "node:assert/strict";
import { parseOptionalHttpsImageUrl } from "../src/lib/tournament-image-url";

test("an omitted or blank custom image URL clears to the bundled-art fallback", () => {
  assert.deepEqual(parseOptionalHttpsImageUrl(undefined), { ok: true, value: null });
  assert.deepEqual(parseOptionalHttpsImageUrl(null), { ok: true, value: null });
  assert.deepEqual(parseOptionalHttpsImageUrl("  "), { ok: true, value: null });
});

test("a valid HTTPS image URL is normalized and accepted", () => {
  assert.deepEqual(
    parseOptionalHttpsImageUrl("https://cdn.example.com/tournaments/duo.webp"),
    { ok: true, value: "https://cdn.example.com/tournaments/duo.webp" },
  );
});

test("non-HTTPS, malformed, credentialed, non-string, and oversized values are rejected", () => {
  assert.deepEqual(parseOptionalHttpsImageUrl("http://cdn.example.com/duo.jpg"), { ok: false });
  assert.deepEqual(parseOptionalHttpsImageUrl("javascript:alert(1)"), { ok: false });
  assert.deepEqual(parseOptionalHttpsImageUrl("https://user:password@cdn.example.com/duo.jpg"), { ok: false });
  assert.deepEqual(parseOptionalHttpsImageUrl(42), { ok: false });
  assert.deepEqual(parseOptionalHttpsImageUrl(`https://cdn.example.com/${"x".repeat(2048)}`), { ok: false });
});