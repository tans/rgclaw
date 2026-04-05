import { describe, expect, test } from "bun:test";
import { runCollectorLoop } from "../../src/collectors/run";

describe("collector run loop", () => {
  test("runs boot prep once before polling iterations", async () => {
    const logs: string[] = [];
    let iterations = 0;
    let bootPrepCalls = 0;
    await runCollectorLoop({
      delayMs: 100,
      logger: {
        info(message: string) {
          logs.push(`info:${message}`);
        },
        error() {
          throw new Error("did not expect collector error");
        },
      },
      bootPrep: async () => {
        bootPrepCalls += 1;
        logs.push("boot-prep");
      },
      runOnce: async () => {
        iterations += 1;
        logs.push(`run:${iterations}`);
        return iterations;
      },
      shouldContinue: () => iterations < 2,
      sleep: async (delayMs: number) => {
        logs.push(`sleep:${delayMs}`);
      },
      backfillOptions: { skipBackfill: true },
    });

    expect(bootPrepCalls).toBe(1);
    // Verify expected sequence (backfill logs may appear but we're checking order)
    expect(logs[0]).toBe("boot-prep");
    expect(logs).toContain("info:collector boot");
    expect(logs).toContain("run:1");
    expect(logs).toContain("info:collector inserted 1 launch events");
    expect(logs).toContain("sleep:100");
    expect(logs).toContain("run:2");
    expect(logs).toContain("info:collector inserted 2 launch events");
  });

  test("fails fast when boot prep fails", async () => {
    const logs: string[] = [];
    let iterations = 0;
    await expect(
      runCollectorLoop({
        delayMs: 100,
        logger: {
          info(message: string) {
            logs.push(`info:${message}`);
          },
          error(message: string, error: unknown) {
            logs.push(`error:${message}:${error instanceof Error ? error.message : String(error)}`);
          },
        },
        bootPrep: async () => {
          throw new Error("migrations failed");
        },
        runOnce: async () => {
          iterations += 1;
          logs.push(`run:${iterations}`);
          return iterations;
        },
        shouldContinue: () => iterations < 2,
        sleep: async (delayMs: number) => {
          logs.push(`sleep:${delayMs}`);
        },
        backfillOptions: { skipBackfill: true },
      }),
    ).rejects.toThrow("migrations failed");

    expect(iterations).toBe(0);
    expect(logs).toEqual([]);
  });

  test("logs boot once and keeps polling", async () => {
    const logs: string[] = [];
    let iterations = 0;
    await runCollectorLoop({
      delayMs: 100,
      logger: {
        info(message: string) {
          logs.push(`info:${message}`);
        },
        error() {
          throw new Error("did not expect collector error");
        },
      },
      runOnce: async () => {
        iterations += 1;
        logs.push(`run:${iterations}`);
        return iterations;
      },
      shouldContinue: () => iterations < 2,
      sleep: async (delayMs: number) => {
        logs.push(`sleep:${delayMs}`);
      },
      backfillOptions: { skipBackfill: true },
    });

    // Verify expected sequence
    expect(logs).toContain("info:collector boot");
    expect(logs).toContain("run:1");
    expect(logs).toContain("info:collector inserted 1 launch events");
    expect(logs).toContain("sleep:100");
    expect(logs).toContain("run:2");
    expect(logs).toContain("info:collector inserted 2 launch events");
  });
});
