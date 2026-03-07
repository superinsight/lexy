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

function repairMojibake(text: string): string {
  // Fix common UTF-8 to Latin-1 mojibake patterns
  // These occur when UTF-8 bytes are misinterpreted as Latin-1/Windows-1252
  return text
    .replace(/\u00e2\u20ac\u201d/g, "\u2014") // em dash
    .replace(/\u00e2\u20ac\u201c/g, "\u2013") // en dash
    .replace(/\u00e2\u20ac\u02dc/g, "\u2018") // left single quote
    .replace(/\u00e2\u20ac\u2122/g, "\u2019") // right single quote
    .replace(/\u00e2\u20ac\u0153/g, "\u201c") // left double quote
    .replace(/\u00e2\u20ac\u009d/g, "\u201d") // right double quote
    .replace(/\u00e2\u20ac\u00a6/g, "\u2026") // ellipsis
    .replace(/\u00c3\u00a9/g, "\u00e9") // e with acute
    .replace(/\u00c3\u00a8/g, "\u00e8") // e with grave
    .replace(/\u00c3\u00a0/g, "\u00e0") // a with grave
    .replace(/\u00c3\u00a2/g, "\u00e2") // a with circumflex
    .replace(/\u00c3\u00ae/g, "\u00ee") // i with circumflex
    .replace(/\u00c3\u00b4/g, "\u00f4") // o with circumflex
    .replace(/\u00c3\u00bb/g, "\u00fb") // u with circumflex
    .replace(/\u00c3\u00a7/g, "\u00e7") // c with cedilla
    .replace(/\u00c3\u00b1/g, "\u00f1"); // n with tilde
}

const SILENT_TOKENS = ["NO_REPLY", "HEARTBEAT_OK"];
const SILENT_PATTERNS = ["(no output)", "(no result)"];

function isSilentToken(text: string): boolean {
  const trimmed = text.trim();
  if (SILENT_TOKENS.some((token) => trimmed === token)) {
    return true;
  }
  return SILENT_PATTERNS.some((pat) => trimmed === pat);
}

function stripSilentTokens(text: string): string {
  let result = text;
  for (const token of SILENT_TOKENS) {
    result = result.replace(new RegExp(`\\b${token}\\b`, "g"), "");
  }
  return result.trim();
}

function cleanText(text: string): string {
  let cleaned = text;

  // Repair mojibake (UTF-8 bytes misread as Latin-1)
  cleaned = repairMojibake(cleaned);

  // Remove thinking tags
  cleaned = cleaned.replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, "");

  // Remove EXTERNAL_UNTRUSTED_CONTENT wrapper tags
  cleaned = cleaned.replace(/<<<EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g, "");
  cleaned = cleaned.replace(/<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g, "");
  cleaned = cleaned.replace(/Source: Web Search\s*---\s*/g, "");

  // Remove JSON blocks (multiline)
  cleaned = cleaned.replace(/\{[\s\S]*?"results"[\s\S]*?\}\s*$/g, "");
  cleaned = cleaned.replace(/^\s*\{[\s\S]*?\}\s*$/g, "");

  // Strip silent reply tokens (NO_REPLY, HEARTBEAT_OK)
  if (isSilentToken(cleaned)) {
    return "";
  }
  cleaned = stripSilentTokens(cleaned);

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
      const prevLastMessage = state.messages[state.messages.length - 1];

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

      // If we were waiting for a response and a new assistant message arrived, reset thinking state
      const newLastMessage = state.messages[state.messages.length - 1];
      if (state.runId !== null && newLastMessage?.role === "assistant") {
        const isNewMessage =
          !prevLastMessage ||
          prevLastMessage.role !== "assistant" ||
          prevLastMessage.content !== newLastMessage.content;
        if (isNewMessage) {
          state.runId = null;
          state.streaming = null;
        }
      }
    }
  } catch (err) {
    console.error("Failed to load history:", err);
  }
}

export type ChatAttachment = {
  type: string;
  mimeType: string;
  fileName: string;
  content: string;
};

export async function fileToAttachment(file: File): Promise<ChatAttachment> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return {
    type: file.type.startsWith("image/") ? "image" : "file",
    mimeType: file.type || "application/octet-stream",
    fileName: file.name,
    content: base64,
  };
}

export async function sendMessage(
  client: GatewayClient,
  state: ChatState,
  text: string,
  attachments?: ChatAttachment[],
): Promise<void> {
  const trimmed = text.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if ((!trimmed && !hasAttachments) || state.sending) {
    return;
  }

  const runId = crypto.randomUUID();

  const fileNames = hasAttachments ? attachments.map((a) => a.fileName).join(", ") : "";
  const displayContent = trimmed + (fileNames ? `\n[Attached: ${fileNames}]` : "");

  state.messages.push({
    role: "user",
    content: displayContent,
    timestamp: Date.now(),
  });

  state.sending = true;
  state.runId = runId;
  state.streaming = "";

  try {
    await client.request("chat.send", {
      sessionKey: state.sessionKey,
      message: trimmed || "(see attached files)",
      deliver: false,
      idempotencyKey: runId,
      ...(hasAttachments ? { attachments } : {}),
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
  // Handle agent events for real-time streaming
  if (evt.event === "agent") {
    const payload = evt.payload as
      | {
          runId?: string;
          sessionKey?: string;
          stream?: string;
          data?: { text?: string };
        }
      | undefined;

    // Check if this is a streaming assistant event for our session
    const isOurSession =
      payload?.sessionKey === state.sessionKey ||
      payload?.sessionKey === `agent:main:${state.sessionKey}`;

    if (payload?.stream === "assistant" && isOurSession && payload.data?.text) {
      const cleaned = cleanText(payload.data.text);
      if (!cleaned) {
        return false;
      }
      const current = state.streaming ?? "";
      if (!current || cleaned.length >= current.length) {
        state.streaming = cleaned;
      }
      return true;
    }
    return false;
  }

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

  if (!payload) {
    return false;
  }

  // Check session key match (handle both direct and prefixed formats)
  const isOurSession =
    payload.sessionKey === state.sessionKey ||
    payload.sessionKey === `agent:main:${state.sessionKey}`;

  if (!isOurSession) {
    return false;
  }

  const eventState = payload.state;

  if (eventState === "delta") {
    const text = extractText(payload.message);
    if (typeof text === "string" && !isSilentToken(text)) {
      const stripped = stripSilentTokens(text);
      const current = state.streaming ?? "";
      if (!current || stripped.length >= current.length) {
        state.streaming = stripped;
      }
    }
    return true;
  }

  if (eventState === "final") {
    const text = extractText(payload.message);
    const finalContent = text ?? state.streaming ?? "";
    if (finalContent.trim() && !isSilentToken(finalContent)) {
      state.messages.push({
        role: "assistant",
        content: stripSilentTokens(finalContent),
        timestamp: Date.now(),
      });
    }
    state.streaming = null;
    state.runId = null;
    return true;
  }

  if (eventState === "aborted") {
    if (state.streaming?.trim()) {
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
