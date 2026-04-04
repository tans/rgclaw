import type { HubWsIncomingMessage, HubWsOutgoingMessage, HubChannelMessage } from "./types";
import { hubWebSocketUrl } from "./client";

export type HubWsHandlers = {
  onMessage(msg: HubChannelMessage): void | Promise<void>;
  onConnect?(): void;
  onDisconnect?(reason: string): void;
  onError?(err: Error): void;
};

function defaultReconnectDelayMs(i: number) {
  return Math.min(1000 * 2 ** i, 30_000);
}

export class HubWsClient {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private handlers: HubWsHandlers;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private subscribedChannels = new Set<string>();

  constructor(apiKey: string, handlers: HubWsHandlers) {
    this.apiKey = apiKey;
    this.handlers = handlers;
  }

  connect() {
    this.intentionalClose = false;
    this._connect();
  }

  private _connect() {
    const url = hubWebSocketUrl(this.apiKey);
    this.ws = new WebSocket(url);

    this.ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      // Re-subscribe any channels we were subscribed to
      for (const channelId of this.subscribedChannels) {
        this._sendRaw({ type: "subscribe", channel_id: channelId });
      }
      this.handlers.onConnect?.();
    });

    this.ws.addEventListener("message", async (event) => {
      let data: HubWsIncomingMessage;
      try {
        data = JSON.parse(event.data as string) as HubWsIncomingMessage;
      } catch {
        return;
      }

      if (data.message) {
        await this.handlers.onMessage(data.message);
      }
    });

    this.ws.addEventListener("close", (event) => {
      this.ws = null;
      const reason = `code=${event.code} reason=${event.reason ?? "none"}`;
      this.handlers.onDisconnect?.(reason);

      if (!this.intentionalClose) {
        this._scheduleReconnect();
      }
    });

    this.ws.addEventListener("error", (event) => {
      this.handlers.onError?.(new Error(`WebSocket error: ${JSON.stringify(event)}`));
    });
  }

  private _scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = defaultReconnectDelayMs(this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, delay);
  }

  private _sendRaw(msg: HubWsOutgoingMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  send(channelId: string, payload: { to_user_id: string; content: string; context_token?: string }) {
    this._sendRaw({
      type: "send",
      channel_id: channelId,
      payload: {
        to_user_id: payload.to_user_id,
        content: payload.content,
        context_token: payload.context_token,
      },
    });
  }

  subscribe(channelId: string) {
    this.subscribedChannels.add(channelId);
    this._sendRaw({ type: "subscribe", channel_id: channelId });
  }

  unsubscribe(channelId: string) {
    this.subscribedChannels.delete(channelId);
    this._sendRaw({ type: "unsubscribe", channel_id: channelId });
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

// ---------------------------------------------------------------------------
// Per-channel WS connection manager
// Keeps one WS connection per apiKey (channel)
// ---------------------------------------------------------------------------

type PerChannelConnection = {
  client: HubWsClient;
  refCount: number;
};

export class HubWsConnectionPool {
  private connections = new Map<string, PerChannelConnection>();

  getOrCreate(
    apiKey: string,
    handlers: HubWsHandlers,
  ): HubWsClient {
    const existing = this.connections.get(apiKey);
    if (existing) {
      existing.refCount++;
      return existing.client;
    }

    const client = new HubWsClient(apiKey, handlers);
    client.connect();
    this.connections.set(apiKey, { client, refCount: 1 });
    return client;
  }

  release(apiKey: string) {
    const entry = this.connections.get(apiKey);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) {
      entry.client.disconnect();
      this.connections.delete(apiKey);
    }
  }

  get(apiKey: string): HubWsClient | undefined {
    return this.connections.get(apiKey)?.client;
  }

  broadcastToChannel(apiKey: string, channelId: string, payload: { to_user_id: string; content: string; context_token?: string }) {
    const entry = this.connections.get(apiKey);
    if (!entry) return;
    entry.client.send(channelId, payload);
  }
}
