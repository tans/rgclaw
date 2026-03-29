import { describe, expect, test } from "bun:test";
import { runPollingLoop } from "../../src/shared/polling-loop";

describe("runPollingLoop", () => {
  test("repeats iterations until stopped and sleeps between runs", async () => {
    const events: string[] = [];
    let iterations = 0;

    await runPollingLoop({
      delayMs: 250,
      logger: {
        info(message) {
          events.push(`info:${message}`);
        },
        error() {
          throw new Error("did not expect loop error");
        },
      },
      runOnce: async () => {
        iterations += 1;
        events.push(`run:${iterations}`);
      },
      shouldContinue: () => iterations < 3,
      sleep: async (delayMs) => {
        events.push(`sleep:${delayMs}`);
      },
      startMessage: "worker boot",
    });

    expect(iterations).toBe(3);
    expect(events).toEqual([
      "info:worker boot",
      "run:1",
      "sleep:250",
      "run:2",
      "sleep:250",
      "run:3",
    ]);
  });

  test("logs iteration errors and continues after sleeping", async () => {
    const errors: string[] = [];
    const sleeps: number[] = [];
    let attempts = 0;

    await runPollingLoop({
      delayMs: 500,
      logger: {
        info() {},
        error(message, error) {
          errors.push(`${message}:${error instanceof Error ? error.message : String(error)}`);
        },
      },
      runOnce: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("boom");
        }
      },
      shouldContinue: () => attempts < 2,
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
      },
      startMessage: "collector boot",
    });

    expect(attempts).toBe(2);
    expect(errors).toEqual(["polling iteration failed:boom"]);
    expect(sleeps).toEqual([500]);
  });
});
