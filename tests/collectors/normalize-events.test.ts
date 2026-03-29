import { describe, expect, test } from "bun:test";
import { normalizeFlapEvent } from "../../src/collectors/flap";
import { normalizeFourEvent } from "../../src/collectors/four";

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
});
