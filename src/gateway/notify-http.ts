import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveSessionAgentId } from "../agents/agent-scope.js";
import { readJsonBodyWithLimit } from "../infra/http-body.js";
import { authorizeHttpGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import { stripEnvelopeFromMessage } from "./chat-sanitize.js";
import { getBearerToken } from "./http-utils.js";
import type { GatewayBroadcastFn } from "./server-broadcast.js";
import { appendAssistantTranscriptMessage } from "./server-methods/chat.js";
import { loadSessionEntry } from "./session-utils.js";

const NOTIFY_PATH = "/api/notify";
const MAX_BODY_BYTES = 64_000;

export type NotifyRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

export function createNotifyHttpHandler(deps: {
  broadcast: GatewayBroadcastFn;
  resolvedAuth: ResolvedGatewayAuth;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
}): NotifyRequestHandler {
  return async function handleNotifyRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== NOTIFY_PATH) {
      return false;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
      return true;
    }

    // Auth check: skip if gateway has no auth configured
    if (deps.resolvedAuth.mode !== "none") {
      const bearerToken = getBearerToken(req);
      const authResult = await authorizeHttpGatewayConnect({
        auth: deps.resolvedAuth,
        connectAuth: bearerToken ? { token: bearerToken, password: bearerToken } : null,
        req,
        trustedProxies: deps.trustedProxies ?? [],
        allowRealIpFallback: deps.allowRealIpFallback ?? false,
      });
      if (!authResult.ok) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
        return true;
      }
    }

    const bodyResult = await readJsonBodyWithLimit(req, {
      maxBytes: MAX_BODY_BYTES,
      emptyObjectOnEmpty: true,
    });
    if (!bodyResult.ok) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "invalid request body" }));
      return true;
    }

    const body = bodyResult.value as Record<string, unknown>;
    const sessionKey = typeof body.sessionKey === "string" ? body.sessionKey.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "message is required" }));
      return true;
    }

    const { cfg, storePath, entry } = loadSessionEntry(sessionKey || "main");
    const sessionId = entry?.sessionId;
    if (!sessionId || !storePath) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "session not found" }));
      return true;
    }

    const resolvedSessionKey = sessionKey || cfg.session?.mainKey || "main";
    const appended = appendAssistantTranscriptMessage({
      message,
      label: typeof body.label === "string" ? body.label : undefined,
      sessionId,
      storePath,
      sessionFile: entry?.sessionFile,
      agentId: resolveSessionAgentId({ sessionKey: resolvedSessionKey, config: cfg }),
      createIfMissing: false,
    });

    if (!appended.ok || !appended.messageId || !appended.message) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ ok: false, error: appended.error ?? "failed to write to transcript" }),
      );
      return true;
    }

    const chatPayload = {
      runId: `notify-${appended.messageId}`,
      sessionKey: resolvedSessionKey,
      seq: 0,
      state: "final" as const,
      message: stripEnvelopeFromMessage(appended.message),
    };
    deps.broadcast("chat", chatPayload);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, messageId: appended.messageId }));
    return true;
  };
}
