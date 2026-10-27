import { readFileSync } from "node:fs";

const filePath = process.argv[2];
if (!filePath) {
  process.stderr.write("Usage: node maestro-screen-hierarchy-text.mjs <screen-hierarchy.json>\n");
  process.exit(2);
}

const raw = readFileSync(filePath, "utf8");
let hierarchy;
try {
  hierarchy = JSON.parse(raw);
} catch {
  process.stdout.write(raw.replace(/\s+/g, " ").slice(0, 1500));
  process.exit(0);
}

const visibleField = /text|label|hint|message|title|content.?description|accessibility|resource.?id|test.?id|identifier/i;
const values = [];
const seen = new Set();

function collect(value, key = "") {
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (visibleField.test(key) && normalized && !seen.has(`${key}:${normalized}`)) {
      seen.add(`${key}:${normalized}`);
      values.push(`${key}=${normalized.slice(0, 240)}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) collect(childValue, childKey);
  }
}

collect(hierarchy);
process.stdout.write(values.slice(0, 40).join(" | ") || "<no text/resource fields found>");
