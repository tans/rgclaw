import type { SubscriptionRecord } from "../../db/repositories/subscriptions";

type RenderUserCenterInput = {
  email: string;
  walletAddress: string;
  subscriptions: SubscriptionRecord[];
  entitlementText: string;
  bindingStatusText: string;
  bindInstruction: string;
};

export function renderUserCenter(input: RenderUserCenterInput) {
  const subscriptionItems = input.subscriptions
    .map((subscription) => `<li>${subscription.source}: ${subscription.enabled ? "开启" : "关闭"}</li>`)
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>用户中心</title></head><body><main><h1>用户中心</h1><div>邮箱: ${input.email}</div><div>钱包地址: ${input.walletAddress || "未填写"}</div><div>微信绑定: ${input.bindingStatusText}</div><div>绑定码: ${input.bindInstruction}</div><div>有效期: ${input.entitlementText}</div><ul>${subscriptionItems}</ul></main></body></html>`;
}
