import { describe, expect, test } from "bun:test";
import { runWorkerLoop } from "../../src/workers/run";

describe("worker run loop", () => {
  test("logs boot once and continues after iteration errors", async () => {
    const logs: string[] = [];
    let attempts = 0;

    await runWorkerLoop({
      delayMs: 50,
      logger: {
        info(message) {
          logs.push(`info:${message}`);
        },
        error(message, error) {
          logs.push(`error:${message}:${error instanceof Error ? error.message : String(error)}`);
        },
      },
      runOnce: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("push failed");
        }
      },
      shouldContinue: () => attempts < 2,
      sleep: async (delayMs) => {
        logs.push(`sleep:${delayMs}`);
      },
    });

    expect(logs).toEqual([
      "info:worker boot",
      "error:worker iteration failed:push failed",
      "sleep:50",
      "info:worker cycle complete",
    ]);
  });
});
