import { describe, expect, test } from "bun:test";
import { collectFlapLaunchEvents, normalizeFlapEvent } from "../../src/collectors/flap";
import { collectFourLaunchEvents, normalizeFourEvent } from "../../src/collectors/four";

describe("event normalization", () => {
  test("four 事件转换为统一结构", () => {
    const event = normalizeFourEvent({
      transactionHash: "0xtx",
      logIndex: 1,
      args: {
        memeToken: "0xabc",
        symbol: "RG",
      },
    });

    expect(event.source).toBe("four");
    expect(event.sourceEventId).toBe("0xtx:1");
    expect(event.tokenAddress).toBe("0xabc");
    expect(event.symbol).toBe("RG");
    expect(event.title).toBe("RG 发射");
    expect(event.chain).toBe("bsc");
    expect(event.dedupeKey).toBe("four:0xtx:1");
  });

  test("flap 事件转换为统一结构", () => {
    const event = normalizeFlapEvent({
      transactionHash: "0xtx2",
      logIndex: 0,
      args: {
        token: "0xdef",
        symbol: "DOG",
      },
    });

    expect(event.source).toBe("flap");
    expect(event.sourceEventId).toBe("0xtx2:0");
    expect(event.tokenAddress).toBe("0xdef");
    expect(event.symbol).toBe("DOG");
    expect(event.title).toBe("DOG 发射");
    expect(event.chain).toBe("bsc");
    expect(event.dedupeKey).toBe("flap:0xtx2:0");
  });

  test("four collector 从 RPC logs 拉取并转换事件", async () => {
    const client = {
      async getLogs() {
        return [
          {
            transactionHash: "0xfourtx",
            logIndex: 2,
            blockNumber: 123n,
            args: {
              memeToken: "0x111",
            },
          },
        ];
      },
      async getBlock() {
        return {
          timestamp: 1_743_206_400n,
        };
      },
      async readContract() {
        return "FOUR";
      },
    };

    const events = await collectFourLaunchEvents(client, 100n, 123n);

    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe("four");
    expect(events[0]?.tokenAddress).toBe("0x111");
    expect(events[0]?.symbol).toBe("FOUR");
    expect(events[0]?.title).toBe("FOUR 发射");
    expect(events[0]?.eventTime).toBe("2025-03-29T00:00:00.000Z");
  });

  test("flap collector 从 RPC logs 拉取并转换事件", async () => {
    const client = {
      async getLogs() {
        return [
          {
            transactionHash: "0xflaptx",
            logIndex: 0,
            blockNumber: 456n,
            args: {
              token: "0x222",
            },
          },
        ];
      },
      async getBlock() {
        return {
          timestamp: 1_743_292_800n,
        };
      },
      async readContract() {
        return "DOG";
      },
    };

    const events = await collectFlapLaunchEvents(client, 400n, 456n, 100n);

    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe("flap");
    expect(events[0]?.tokenAddress).toBe("0x222");
    expect(events[0]?.symbol).toBe("DOG");
    expect(events[0]?.title).toBe("DOG 发射");
    expect(events[0]?.eventTime).toBe("2025-03-30T00:00:00.000Z");
  });
});
