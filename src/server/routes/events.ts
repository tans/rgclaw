import { Hono } from "hono";
import { listLatestLaunchEvents } from "../../db/repositories/launch-events";
import type { AppEnv } from "../middleware/session";

export function eventsRoutes() {
  const app = new Hono<AppEnv>();

  // GET /api/events/latest - 获取最近的发射事件（公开接口）
  app.get("/api/events/latest", async (c) => {
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50;
    
    const events = listLatestLaunchEvents(limit);
    
    return c.json({
      success: true,
      data: events.map(event => ({
        id: event.id,
        source: event.source,
        token_address: event.token_address,
        symbol: event.symbol,
        title: event.title,
        event_time: event.event_time,
      })),
      count: events.length,
    });
  });

  // GET /api/events/latest/:source - 获取指定来源的最近事件
  app.get("/api/events/latest/:source", async (c) => {
    const source = c.req.param("source");
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50;
    
    const allEvents = listLatestLaunchEvents(limit * 2); // 获取更多以便过滤
    const filteredEvents = allEvents
      .filter(e => e.source === source)
      .slice(0, limit);
    
    return c.json({
      success: true,
      data: filteredEvents.map(event => ({
        id: event.id,
        source: event.source,
        token_address: event.token_address,
        symbol: event.symbol,
        title: event.title,
        event_time: event.event_time,
      })),
      count: filteredEvents.length,
    });
  });

  return app;
}
