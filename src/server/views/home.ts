import type { LaunchEventFeedItem } from "../../db/repositories/launch-events";

function renderEventList(events: LaunchEventFeedItem[]) {
  if (events.length === 0) {
    return "<p>暂无事件</p>";
  }

  return `<ul>${events
    .map(
      (event) =>
        `<li><strong>${event.title}</strong><div>来源: ${event.source}</div><div>地址: ${event.token_address}</div><div>时间: ${event.event_time}</div></li>`,
    )
    .join("")}</ul>`;
}

export function renderHomePage(events: LaunchEventFeedItem[]) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>公开首页</title></head><body><main><h1>最新发射事件</h1>${renderEventList(events)}</main></body></html>`;
}
