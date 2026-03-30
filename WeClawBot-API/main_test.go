package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMessagesHandlerUsesExplicitTargetAndContext(t *testing.T) {
	cfg = AppConfig{
		Bots: map[string]*UserConfig{
			"bot-1": {
				BotID:        "bot-1",
				APIToken:     "bot-token",
				IlinkUserID:  "fallback-user",
				ContextToken: "fallback-context",
			},
		},
	}

	var gotTo string
	var gotText string
	var gotContext string
	previous := sendMessageFn
	sendMessageFn = func(user *UserConfig, to string, text string, contextToken string) error {
		gotTo = to
		gotText = text
		gotContext = contextToken
		return nil
	}
	defer func() {
		sendMessageFn = previous
	}()

	handler := buildBotAPIHandler()
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
	cfg = AppConfig{
		Bots: map[string]*UserConfig{
			"bot-1": {
				BotID:    "bot-1",
				APIToken: "bot-token",
			},
		},
	}
	internalAPIToken = "cluster-token"

	previous := sendMessageFn
	sendMessageFn = func(user *UserConfig, to string, text string, contextToken string) error {
		return nil
	}
	defer func() {
		sendMessageFn = previous
		internalAPIToken = ""
	}()

	handler := buildBotAPIHandler()
	req := httptest.NewRequest(http.MethodPost, "/bots/bot-1/messages", strings.NewReader(`{"text":"hello","toUserId":"wx-user-9","contextToken":"ctx-9"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer cluster-token")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}
}
