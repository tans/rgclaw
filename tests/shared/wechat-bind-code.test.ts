import { describe, expect, test } from "bun:test";
import {
  buildWechatBindCode,
  parseWechatBindCode,
} from "../../src/shared/wechat-bind-code";

describe("wechat bind code", () => {
  test("build 和 parse 可往返 userId", () => {
    const code = buildWechatBindCode("user-123", "bind-secret");

    expect(code).toStartWith("uid:user-123:");
    expect(parseWechatBindCode(code, "bind-secret")).toEqual({ userId: "user-123" });
  });

  test("错误 secret 返回 null", () => {
    const code = buildWechatBindCode("user-123", "bind-secret");

    expect(parseWechatBindCode(code, "wrong-secret")).toBeNull();
  });

  test("篡改文本返回 null", () => {
    const code = buildWechatBindCode("user-123", "bind-secret");
    const tampered = code.replace("user-123", "user-456");

    expect(parseWechatBindCode(tampered, "bind-secret")).toBeNull();
  });
});
