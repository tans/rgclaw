import { describe, expect, test, beforeEach } from "bun:test";
import { runBackfill, runBackfillOnce, shouldRunBackfill } from "../../src/collectors/backfill";
import { getBackfillProgress, isBackfillComplete, updateBackfillProgress } from "../../src/db/repositories/backfill-progress";
import { openDb } from "../../src/db/sqlite";

describe("backfill", () => {
  beforeEach(() => {
    // Clean up test database
    const db = openDb();
    try {
      db.exec("delete from backfill_progress");
      db.exec("delete from launch_events");
    } catch {
      // Tables might not exist yet
    } finally {
      db.close();
    }
  });

  test("shouldRunBackfill returns true by default", () => {
    const original = process.env.SKIP_BACKFILL;
    delete process.env.SKIP_BACKFILL;
    expect(shouldRunBackfill()).toBe(true);
    if (original) process.env.SKIP_BACKFILL = original;
  });

  test("shouldRunBackfill returns false when SKIP_BACKFILL=true", () => {
    const original = process.env.SKIP_BACKFILL;
    process.env.SKIP_BACKFILL = "true";
    expect(shouldRunBackfill()).toBe(false);
    if (original) process.env.SKIP_BACKFILL = original;
    else delete process.env.SKIP_BACKFILL;
  });

  test("runBackfillOnce skips when skipBackfill option is true", async () => {
    const logs: string[] = [];
    const result = await runBackfillOnce({
      skipBackfill: true,
      logger: {
        info(msg: string) { logs.push(msg); },
        error() {},
      },
    });
    expect(result).toBe(0);
    expect(logs.some(l => l.includes("skipping"))).toBe(true);
  });

  test("runBackfillOnce returns 0 for already completed backfill", async () => {
    // Mark both sources as complete
    updateBackfillProgress("flap", 10000, true);
    updateBackfillProgress("four", 10000, true);

    const logs: string[] = [];
    const result = await runBackfillOnce({
      skipBackfill: false,
      logger: {
        info(msg: string) { logs.push(msg); },
        error() {},
      },
    });

    // Should return 0 since backfill is already complete
    expect(result).toBe(0);
  });

  test("isBackfillComplete returns false for new source", () => {
    expect(isBackfillComplete("flap")).toBe(false);
    expect(isBackfillComplete("four")).toBe(false);
  });

  test("getBackfillProgress returns null for new source", () => {
    const progress = getBackfillProgress("flap");
    expect(progress).toBeNull();
  });

  test("updateBackfillProgress creates and updates progress", () => {
    updateBackfillProgress("flap", 5000, false);
    let progress = getBackfillProgress("flap");
    expect(progress).not.toBeNull();
    expect(progress!.lastBlock).toBe(5000);
    expect(progress!.completed).toBe(false);

    updateBackfillProgress("flap", 10000, true);
    progress = getBackfillProgress("flap");
    expect(progress!.lastBlock).toBe(10000);
    expect(progress!.completed).toBe(true);
  });
});
