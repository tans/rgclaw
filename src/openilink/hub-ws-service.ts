/**
 * HubWSService — manages WebSocket connections to clawbot Channel relay.
 *
 * Each active Hub channel binding gets its own WS subscription. When the Hub
 * Relay broadcasts inbound WeChat messages (user texts the Bot), this service
 * receives them and enqueues a system message job for regou.app to process.
 *
 * Architecture:
 *   Go WeClawBot-API  →  Hub Relay Hub  →  HubWSService (regou.app)
 *                                            ↓
 *                                      system_message_job (type: inbound)
 */

import { HubWsConnectionPool } from "./ws-client";
import type { HubChannelMessage } from "./types";
import {
  findActiveChannelBindingByUserId,
  touchChannelBindingInbound,
} from "../db/repositories/channel-bindings";
import { createSystemMessageJob } from "../db/repositories/notification-jobs";
import { openDb } from "../db/sqlite";

const GLOBAL_POOL = new HubWsConnectionPool();

function onHubMessage(
  apiKey: string,
  channelId: string,
  botId: string,
  msg: HubChannelMessage,
) {
  // Update binding with latest inbound context (context_token, sender)
  touchChannelBindingInbound({
    hubBotId: botId,
    hubChannelId: channelId,
    botWechatUserId: msg.from_user_id,
    contextToken: msg.content, // Hub relay context is stored as content
    receivedAt: msg.timestamp,
  });

  // Enqueue inbound message as a system message job for potential auto-reply
  const db = openDb();
  try {
    const binding = db
      .query(
        `select user_id from channel_bindings
         where hub_bot_id = ? and hub_channel_id = ? and status = 'active'`,
      )
      .get(botId, channelId) as { user_id: string } | null;

    if (binding) {
      createSystemMessageJob({
        userId: binding.user_id,
        messageType: "inbound",
        payload: JSON.stringify({
          from_user_id: msg.from_user_id,
          content: msg.content,
          msg_id: msg.id,
          timestamp: msg.timestamp,
        }),
      });
    }
  } finally {
    db.close();
  }
}

function onHubConnect(apiKey: string, channelId: string) {
  console.log(`[hub-ws] connected: channel=${channelId}`);
}

function onHubDisconnect(apiKey: string, channelId: string, reason: string) {
  console.warn(`[hub-ws] disconnected: channel=${channelId} reason=${reason}`);
}

/**
 * Subscribe regou.app to a Hub channel's WebSocket relay.
 * Safe to call multiple times — HubWsConnectionPool ref-counts connections.
 */
export function hubSubscribeChannel(apiKey: string, channelId: string, botId: string) {
  GLOBAL_POOL.getOrCreate(apiKey, {
    onMessage(msg) {
      onHubMessage(apiKey, channelId, botId, msg);
    },
    onConnect() {
      onHubConnect(apiKey, channelId);
    },
    onDisconnect(reason) {
      onHubDisconnect(apiKey, channelId, reason);
    },
    onError(err) {
      console.error(`[hub-ws] error: channel=${channelId}`, err);
    },
  }).subscribe(channelId);
}

/**
 * Unsubscribe from a Hub channel's relay and clean up the connection
 * if no other subscriptions remain.
 */
export function hubUnsubscribeChannel(apiKey: string, channelId: string) {
  GLOBAL_POOL.get(apiKey)?.unsubscribe(channelId);
  GLOBAL_POOL.release(apiKey);
}

/**
 * Bootstrap WS subscriptions for all active channel bindings.
 * Call once on server startup.
 */
export async function hubBootstrapSubscriptions() {
  const db = openDb();
  try {
    const rows = db
      .query(
        `select hub_api_key, hub_channel_id, hub_bot_id
         from channel_bindings where status = 'active'`,
      )
      .all() as Array<{
      hub_api_key: string;
      hub_channel_id: string;
      hub_bot_id: string;
    }>;

    for (const row of rows) {
      hubSubscribeChannel(row.hub_api_key, row.hub_channel_id, row.hub_bot_id);
    }

    console.log(`[hub-ws] bootstrapped ${rows.length} channel subscriptions`);
  } finally {
    db.close();
  }
}
