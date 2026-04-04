import type {
  HubApiResponse,
  HubBindConfirmResponse,
  HubBindStartResponse,
  HubBot,
  HubChannel,
  HubSendMessagePayload,
  HubSendMessageResponse,
  HubSinkConfig,
  HubAiSinkConfig,
  HubUser,
} from "./types";
import { config } from "../shared/config";

const HUB_BASE = () => config.openilinkHubUrl;
const HUB_ADMIN_BASE = () => config.openilinkAdminUrl;

function hubFetch<T>(
  path: string,
  options: RequestInit & {
    apiKey?: string;
    sessionCookie?: string;
  } = {},
): Promise<T> {
  const { apiKey, sessionCookie, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers as Record<string, string> | undefined),
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  if (sessionCookie) {
    headers["Cookie"] = `session=${sessionCookie}`;
  }

  const url = path.startsWith("http") ? path : `${HUB_BASE()}${path}`;

  return fetch(url, {
    ...fetchOptions,
    headers,
  }).then(async (res) => {
    const body = (await res.json()) as HubApiResponse<T>;

    if (!body.success) {
      throw new HubApiError(body.error?.code ?? "UNKNOWN", body.error?.message ?? "Unknown error", res.status);
    }

    return body.data as T;
  });
}

export class HubApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "HubApiError";
  }
}

// ---------------------------------------------------------------------------
// Auth (Session cookie based)
// ---------------------------------------------------------------------------

export async function hubOAuthGithub(redirectUri: string): Promise<string> {
  const url = `${HUB_BASE()}/api/auth/oauth/github?redirect=${encodeURIComponent(redirectUri)}`;
  // Redirect user to Hub OAuth page — caller should handle the redirect
  return url;
}

export async function hubOAuthCallback(code: string): Promise<{ sessionCookie: string; user: HubUser }> {
  const data = await hubFetch<{ user: HubUser }>(
    `${HUB_BASE()}/api/auth/callback/github`,
    {
      method: "POST",
      body: JSON.stringify({ code }),
    },
  );

  // Hub sets a session cookie; our fetch doesn't persist it automatically.
  // We return the cookie value for the caller to store.
  // The Hub session cookie name is "session" — we extract it from response headers.
  return {
    sessionCookie: "", // caller must read from set-cookie header
    user: data.user,
  };
}

export async function hubGetMe(sessionCookie: string): Promise<HubUser> {
  return hubFetch<HubUser>(`${HUB_BASE()}/api/auth/me`, {
    headers: { Cookie: `session=${sessionCookie}` },
  });
}

export async function hubLogout(sessionCookie: string): Promise<void> {
  await hubFetch(`${HUB_BASE()}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: `session=${sessionCookie}` },
  });
}

// ---------------------------------------------------------------------------
// Bot management (Session cookie auth)
// ---------------------------------------------------------------------------

export async function hubListBots(sessionCookie: string): Promise<HubBot[]> {
  return hubFetch<HubBot[]>(`${HUB_BASE()}/api/bots`, {
    headers: { Cookie: `session=${sessionCookie}` },
  });
}

export async function hubGetBot(sessionCookie: string, botId: string): Promise<HubBot> {
  return hubFetch<HubBot>(`${HUB_BASE()}/api/bots/${botId}`, {
    headers: { Cookie: `session=${sessionCookie}` },
  });
}

export async function hubStartBotBind(sessionCookie: string): Promise<HubBindStartResponse> {
  return hubFetch<HubBindStartResponse>(`${HUB_BASE()}/api/bots/bind/start`, {
    method: "POST",
    headers: { Cookie: `session=${sessionCookie}` },
  });
}

export async function hubConfirmBotBind(
  sessionCookie: string,
  qrCodeData: string,
  scanResult: string,
): Promise<HubBindConfirmResponse> {
  return hubFetch<HubBindConfirmResponse>(`${HUB_BASE()}/api/bots/bind/confirm`, {
    method: "POST",
    headers: { Cookie: `session=${sessionCookie}` },
    body: JSON.stringify({ qr_code_data: qrCodeData, scan_result: scanResult }),
  });
}

export async function hubGetBotStatus(sessionCookie: string, botId: string): Promise<HubBot["status"]> {
  const bot = await hubGetBot(sessionCookie, botId);
  return bot.status;
}

export async function hubReconnectBot(sessionCookie: string, botId: string): Promise<void> {
  await hubFetch(`${HUB_BASE()}/api/bots/${botId}/reconnect`, {
    method: "POST",
    headers: { Cookie: `session=${sessionCookie}` },
  });
}

// ---------------------------------------------------------------------------
// Channel management (Session cookie auth)
// ---------------------------------------------------------------------------

export async function hubCreateChannel(sessionCookie: string, botId: string): Promise<HubChannel> {
  return hubFetch<HubChannel>(`${HUB_BASE()}/api/bots/${botId}/channels`, {
    method: "POST",
    headers: { Cookie: `session=${sessionCookie}` },
    body: JSON.stringify({ name: "rgclaw" }),
  });
}

export async function hubListChannels(sessionCookie: string, botId: string): Promise<HubChannel[]> {
  return hubFetch<HubChannel[]>(`${HUB_BASE()}/api/bots/${botId}/channels`, {
    headers: { Cookie: `session=${sessionCookie}` },
  });
}

export async function hubRegenerateChannelKey(
  sessionCookie: string,
  botId: string,
  channelId: string,
): Promise<{ api_key: string }> {
  return hubFetch<{ api_key: string }>(`${HUB_BASE()}/api/bots/${botId}/channels/${channelId}/regenerate-key`, {
    method: "POST",
    headers: { Cookie: `session=${sessionCookie}` },
  });
}

// ---------------------------------------------------------------------------
// Channel operations (API Key auth)
// ---------------------------------------------------------------------------

export async function hubSendChannelMessage(
  apiKey: string,
  channelId: string,
  payload: HubSendMessagePayload,
): Promise<HubSendMessageResponse> {
  const response = await fetch(`${HUB_BASE()}/api/v1/channels/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel_id: channelId,
      to_user_id: payload.to_user_id,
      content: payload.content,
      context_token: payload.context_token,
    }),
  });

  const body = (await response.json()) as HubApiResponse<HubSendMessageResponse>;
  if (!body.success) {
    throw new HubApiError(body.error?.code ?? "UNKNOWN", body.error?.message ?? "Unknown error", response.status);
  }
  return body.data as HubSendMessageResponse;
}

export async function hubGetChannelMessages(
  apiKey: string,
  channelId: string,
  params?: { limit?: number; before?: string },
): Promise<unknown[]> {
  const url = new URL(`${HUB_BASE()}/api/v1/channels/messages`);
  url.searchParams.set("channel_id", channelId);
  if (params?.limit) url.searchParams.set("limit", String(params.limit));
  if (params?.before) url.searchParams.set("before", params.before);

  return hubFetch(url.toString(), { apiKey });
}

export async function hubTyping(apiKey: string, channelId: string, toUserId: string): Promise<void> {
  await hubFetch(`${HUB_BASE()}/api/v1/channels/typing`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ channel_id: channelId, to_user_id: toUserId }),
  });
}

// ---------------------------------------------------------------------------
// Sink configuration (Session cookie auth)
// ---------------------------------------------------------------------------

export async function hubConfigureWebhookSink(
  sessionCookie: string,
  botId: string,
  channelId: string,
  cfg: HubSinkConfig,
): Promise<void> {
  await hubFetch(`${HUB_BASE()}/api/bots/${botId}/channels/${channelId}/webhook`, {
    method: "PUT",
    headers: { Cookie: `session=${sessionCookie}` },
    body: JSON.stringify(cfg),
  });
}

export async function hubConfigureAiSink(
  sessionCookie: string,
  botId: string,
  channelId: string,
  cfg: HubAiSinkConfig,
): Promise<void> {
  await hubFetch(`${HUB_BASE()}/api/bots/${botId}/channels/${channelId}/ai`, {
    method: "PUT",
    headers: { Cookie: `session=${sessionCookie}` },
    body: JSON.stringify(cfg),
  });
}

export async function hubConfigureWsSink(
  sessionCookie: string,
  botId: string,
  channelId: string,
  enabled: boolean,
): Promise<void> {
  await hubFetch(`${HUB_BASE()}/api/bots/${botId}/channels/${channelId}/websocket`, {
    method: "PUT",
    headers: { Cookie: `session=${sessionCookie}` },
    body: JSON.stringify({ enabled }),
  });
}

// ---------------------------------------------------------------------------
// WebSocket URL builder
// ---------------------------------------------------------------------------

export function hubWebSocketUrl(apiKey: string): string {
  const wsBase = HUB_BASE().replace(/^http/, "ws");
  return `${wsBase}/api/v1/channels/connect?api_key=${encodeURIComponent(apiKey)}`;
}
