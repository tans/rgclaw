package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestHandler(appCfg *AppConfig, internalToken string, sendFn sendMessageFunc) http.Handler {
	if appCfg == nil {
		appCfg = &AppConfig{}
	}
	if sendFn == nil {
		sendFn = func(*UserConfig, string, string, string) error { return nil }
	}
	return newBotAPIHandler(botAPIHandlerDeps{
		cfg:           appCfg,
		sendMessage:   sendFn,
		internalToken: internalToken,
	})
}

func TestMessagesHandlerUsesExplicitTargetAndContext(t *testing.T) {
	cfg := &AppConfig{
		Bots: map[string]*UserConfig{
			"bot-1": {
				BotID:        "bot-1",
				APIToken:     "bot-token",
				IlinkUserID:  "fallback-user",
				ContextToken: "fallback-context",
			},
		},
	}

	var gotTo, gotText, gotContext string
	handler := newTestHandler(cfg, "", func(user *UserConfig, to string, text string, contextToken string) error {
		gotTo = to
		gotText = text
		gotContext = contextToken
		return nil
	})

	req := httptest.NewRequest(http.MethodPost, "/bots/bot-1/messages", strings.NewReader(`{"text":"hello","toUserId":"wx-user-9","contextToken":"ctx-9"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer bot-token")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}
	if gotTo != "wx-user-9" || gotText != "hello" || gotContext != "ctx-9" {
		t.Fatalf("unexpected send args: to=%q text=%q context=%q", gotTo, gotText, gotContext)
	}
}

func TestMessagesHandlerAcceptsInternalToken(t *testing.T) {
	cfg := &AppConfig{
		Bots: map[string]*UserConfig{
			"bot-1": {
				BotID:    "bot-1",
				APIToken: "bot-token",
			},
		},
	}

	handler := newTestHandler(cfg, "cluster-token", func(user *UserConfig, to string, text string, contextToken string) error {
		return nil
	})

	req := httptest.NewRequest(http.MethodPost, "/bots/bot-1/messages", strings.NewReader(`{"text":"hello","toUserId":"wx-user-9","contextToken":"ctx-9"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer cluster-token")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}
}

func TestForwardInboundTextCallbackPostsPayload(t *testing.T) {
	var receivedBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		receivedBody = string(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	callbackURL = srv.URL
	defer func() { callbackURL = "" }()

	payload := inboundTextCallback{
		BotID:        "bot-alpha",
		FromUserID:   "user-target",
		Text:         "hello",
		ContextToken: "ctx-123",
		MessageID: callbackMessageID(
			"bot-alpha",
			WeixinMessage{FromUserID: "user-target", ContextToken: "ctx-123"},
			"hello",
		),
		ReceivedAt: "2026-03-31T00:00:00Z",
		RawPayload: json.RawMessage(`{"from_user_id":"user-target"}`),
	}

	if err := forwardInboundTextCallback(&UserConfig{BotID: "bot-alpha"}, payload); err != nil {
		t.Fatalf("callback error: %v", err)
	}

	if !strings.Contains(receivedBody, `"botId":"bot-alpha"`) {
		t.Fatalf("payload missing botId: %s", receivedBody)
	}
	if !strings.Contains(receivedBody, `"messageId":"`+payload.MessageID+`"`) {
		t.Fatalf("payload missing messageId: %s", receivedBody)
	}
}

func TestMessagesHandlerFallsBackToStoredTargetAndContext(t *testing.T) {
	cfg := &AppConfig{
		Bots: map[string]*UserConfig{
			"bot-1": {
				BotID:            "bot-1",
				APIToken:         "bot-token",
				LastTargetUserID: "wx-user-fallback",
				LastContextToken: "ctx-fallback",
			},
		},
	}

	var gotTo, gotContext string
	handler := newTestHandler(cfg, "", func(user *UserConfig, to string, text string, contextToken string) error {
		gotTo = to
		gotContext = contextToken
		return nil
	})

	req := httptest.NewRequest(http.MethodPost, "/bots/bot-1/messages", strings.NewReader(`{"text":"fallback text"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer bot-token")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}
	if gotTo != "wx-user-fallback" || gotContext != "ctx-fallback" {
		t.Fatalf("fallback target used wrong values: to=%q context=%q", gotTo, gotContext)
	}
}

func TestMessagesHandlerRejectsUnauthorized(t *testing.T) {
	cfg := &AppConfig{
		Bots: map[string]*UserConfig{
			"bot-1": {
				BotID:    "bot-1",
				APIToken: "bot-token",
			},
		},
	}

	handler := newTestHandler(cfg, "", nil)

	req := httptest.NewRequest(http.MethodPost, "/bots/bot-1/messages", strings.NewReader(`{"text":"hello"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer wrong-token")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", res.Code)
	}
}
