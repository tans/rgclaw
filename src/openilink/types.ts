// OpeniLink Hub API types

export type HubUser = {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
};

export type HubBot = {
  id: string;
  name: string;
  wx_id: string;
  status: "online" | "offline" | "connecting";
  created_at: string;
};

export type HubChannel = {
  id: string;
  bot_id: string;
  name: string;
  api_key: string;
  created_at: string;
};

export type HubBindStartResponse = {
  qr_code_url: string;
  qr_code_data: string;
};

export type HubBindConfirmResponse = {
  bot_id: string;
  channel_id: string;
  api_key: string;
  bot_name: string;
};

export type HubSendMessagePayload = {
  to_user_id: string;
  content: string;
  context_token?: string;
};

export type HubSendMessageResponse = {
  success: boolean;
  message_id?: string;
  error?: {
    code: string;
    message: string;
  };
};

export type HubChannelMessage = {
  type: "text" | "image" | "system" | "event";
  id: string;
  from_user_id: string;
  content: string;
  timestamp: string;
  seq?: number;
};

export type HubWsIncomingMessage = {
  channel_id: string;
  bot_id: string;
  message: HubChannelMessage;
};

export type HubWsOutgoingMessage =
  | {
      type: "send";
      channel_id: string;
      payload: HubSendMessagePayload;
    }
  | {
      type: "subscribe";
      channel_id: string;
    }
  | {
      type: "unsubscribe";
      channel_id: string;
    };

export type HubError = {
  code: string;
  message: string;
};

export type HubApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: HubError;
};

export type HubSinkConfig = {
  enabled: boolean;
  url?: string;
  auth_type?: "bearer" | "hmac" | "none";
  auth_value?: string;
};

export type HubAiSinkConfig = {
  enabled: boolean;
  model?: string;
  api_base?: string;
  api_key?: string;
};
