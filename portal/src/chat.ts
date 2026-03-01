import type { GatewayClient, GatewayEventFrame } from "./gateway";

export type Message = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export type ChatState = {
  messages: Message[];
  streaming: string | null;
  sending: boolean;
  runId: string | null;
  sessionKey: string;
};

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  // Check if it starts with JSON markers
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return true;
  }
  // Check if it contains typical tool result patterns
  if (
    trimmed.includes('"query":') ||
    trimmed.includes('"results":') ||
    trimmed.includes('"provider":')
  ) {
    return true;
  }
  // Check for EXTERNAL_UNTRUSTED_CONTENT markers
  if (trimmed.includes("EXTERNAL_UNTRUSTED_CONTENT")) {
    return true;
  }
  return false;
}

function cleanText(text: string): string {
  let cleaned = text;

  // Remove thinking tags
  cleaned = cleaned.replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, "");

  // Remove EXTERNAL_UNTRUSTED_CONTENT wrapper tags
  cleaned = cleaned.replace(/<<<EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g, "");
  cleaned = cleaned.replace(/<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g, "");
  cleaned = cleaned.replace(/Source: Web Search\s*---\s*/g, "");

  // Remove JSON blocks (multiline)
  cleaned = cleaned.replace(/\{[\s\S]*?"results"[\s\S]*?\}\s*$/g, "");
  cleaned = cleaned.replace(/^\s*\{[\s\S]*?\}\s*$/g, "");

  return cleaned.trim();
}

function extractText(message: unknown): string | null {
  const m = message as Record<string, unknown>;
  const content = m.content;

  if (typeof content === "string") {
    // Skip if it's entirely JSON-like
    if (looksLikeJson(content)) {
      return null;
    }
    return cleanText(content);
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        const item = p as Record<string, unknown>;
        // Only extract text blocks, skip tool_use, tool_result, etc.
        if (item.type === "text" && typeof item.text === "string") {
          // Skip JSON-like text blocks
          if (looksLikeJson(item.text)) {
            return null;
          }
          return cleanText(item.text);
        }
        return null;
      })
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  // Fallback to text field
  if (typeof m.text === "string") {
    if (looksLikeJson(m.text)) {
      return null;
    }
    return cleanText(m.text);
  }

  return null;
}

export function createChatState(sessionKey: string): ChatState {
  return {
    messages: [],
    streaming: null,
    sending: false,
    runId: null,
    sessionKey,
  };
}

export async function loadHistory(client: GatewayClient, state: ChatState): Promise<void> {
  try {
    const res = await client.request<{ messages?: unknown[] }>("chat.history", {
      sessionKey: state.sessionKey,
      limit: 200,
    });
    if (Array.isArray(res.messages)) {
      state.messages = res.messages
        .map((m) => {
          const msg = m as Record<string, unknown>;
          const text = extractText(m);
          // Skip messages with no text content (tool-only messages)
          if (!text || !text.trim()) {
            return null;
          }
          return {
            role: (msg.role as "user" | "assistant") ?? "assistant",
            content: text,
            timestamp: (msg.timestamp as number) ?? Date.now(),
          };
        })
        .filter((m): m is Message => m !== null);
    }
  } catch (err) {
    console.error("Failed to load history:", err);
  }
}

export async function sendMessage(
  client: GatewayClient,
  state: ChatState,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || state.sending) {
    return;
  }

  const runId = crypto.randomUUID();

  state.messages.push({
    role: "user",
    content: trimmed,
    timestamp: Date.now(),
  });

  state.sending = true;
  state.runId = runId;
  state.streaming = "";

  try {
    await client.request("chat.send", {
      sessionKey: state.sessionKey,
      message: trimmed,
      deliver: false,
      idempotencyKey: runId,
    });
  } catch (err) {
    state.messages.push({
      role: "assistant",
      content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: Date.now(),
    });
    state.runId = null;
    state.streaming = null;
  } finally {
    state.sending = false;
  }
}

export function handleEvent(state: ChatState, evt: GatewayEventFrame): boolean {
  if (evt.event !== "chat") {
    return false;
  }

  const payload = evt.payload as
    | {
        runId?: string;
        sessionKey?: string;
        state?: string;
        message?: unknown;
        errorMessage?: string;
      }
    | undefined;

  if (!payload || payload.sessionKey !== state.sessionKey) {
    return false;
  }

  const eventState = payload.state;

  if (eventState === "delta") {
    const text = extractText(payload.message);
    if (typeof text === "string") {
      state.streaming = text;
    }
    return true;
  }

  if (eventState === "final") {
    const text = extractText(payload.message);
    state.messages.push({
      role: "assistant",
      content: text ?? state.streaming ?? "",
      timestamp: Date.now(),
    });
    state.streaming = null;
    state.runId = null;
    return true;
  }

  if (eventState === "aborted") {
    if (state.streaming) {
      state.messages.push({
        role: "assistant",
        content: state.streaming,
        timestamp: Date.now(),
      });
    }
    state.streaming = null;
    state.runId = null;
    return true;
  }

  if (eventState === "error") {
    state.messages.push({
      role: "assistant",
      content: `Error: ${payload.errorMessage ?? "Unknown error"}`,
      timestamp: Date.now(),
    });
    state.streaming = null;
    state.runId = null;
    return true;
  }

  return false;
}
