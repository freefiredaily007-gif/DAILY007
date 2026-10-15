import { createInterface } from "node:readline";
import { pool } from "@workspace/db";
import { runDaily007AutoCancellationSweep } from "../../src/lib/daily007-tournament-auto-cancel";

const pauseBeforeCursorId = process.env.DAILY007_PAUSE_BEFORE_CURSOR_ID;
const queryPool = pool as unknown as {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
};
const originalQuery = queryPool.query.bind(pool);
let paused = false;

function report(event: Record<string, unknown>): void {
  process.stdout.write(`WORKER_EVENT:${JSON.stringify(event)}\n`);
}

queryPool.query = async (text, values) => {
  if (text.includes('SELECT m.id, m.starts_at AS "startsAt"')) {
    const result = await originalQuery(text, values);
    report({ type: "batch-selected", count: result.rows.length });
    return result;
  }

  if (text.includes("INSERT INTO daily007_v2_settings (id, settings)")) {
    const cursor = JSON.parse(String(values?.[0])) as { id?: unknown } | null;
    if (!paused && pauseBeforeCursorId && cursor?.id === pauseBeforeCursorId) {
      paused = true;
      report({ type: "cursor-paused", id: cursor.id });
      const input = createInterface({ input: process.stdin });
      await new Promise<void>((resolve) => input.once("line", () => resolve()));
      input.close();
    }
    return originalQuery(text, values);
  }

  return originalQuery(text, values);
};

async function main(): Promise<void> {
  try {
    await runDaily007AutoCancellationSweep();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
