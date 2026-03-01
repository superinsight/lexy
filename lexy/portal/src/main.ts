import { createChatState, loadHistory, sendMessage, handleEvent } from "./chat";
import { GatewayClient } from "./gateway";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const statusEl = $<HTMLDivElement>("status");
const messagesEl = $<HTMLDivElement>("messages");
const inputEl = $<HTMLTextAreaElement>("input");
const sendBtn = $<HTMLButtonElement>("send");

const gatewayUrl =
  new URL(window.location.href).searchParams.get("gateway") ??
  `ws://${window.location.hostname}:18789`;
const sessionKey = new URL(window.location.href).searchParams.get("session") ?? "portal-admin";
const token = new URL(window.location.href).searchParams.get("token") ?? undefined;
const password = new URL(window.location.href).searchParams.get("password") ?? undefined;

const state = createChatState(sessionKey);

function renderMessages() {
  const allMessages: Array<{
    role: string;
    content: string;
    isStreaming?: boolean;
    isThinking?: boolean;
  }> = [...state.messages];

  // Show typing indicator when waiting for response
  if (state.runId !== null && (state.streaming === null || state.streaming === "")) {
    allMessages.push({ role: "assistant", content: "", isThinking: true });
  } else if (state.streaming !== null && state.streaming !== "") {
    allMessages.push({ role: "assistant", content: state.streaming, isStreaming: true });
  }

  if (allMessages.length === 0) {
    messagesEl.innerHTML = `
      <div class="empty-state">
        <img src="/public/favicon.svg" alt="Lexy" class="empty-icon" />
        <p>Start a conversation with Lexy</p>
      </div>
    `;
    return;
  }

  messagesEl.innerHTML = allMessages
    .map((msg) => {
      const roleClass = msg.role === "user" ? "user" : "assistant";
      const streamingClass = msg.isStreaming ? "streaming" : "";

      if (msg.isThinking) {
        return `<div class="message assistant thinking">
          <div class="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>`;
      }

      const content = escapeHtml(msg.content);
      return `<div class="message ${roleClass} ${streamingClass}">${content}</div>`;
    })
    .join("");

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function setStatus(text: string, className: string = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${className}`;
}

function updateSendButton() {
  sendBtn.disabled = state.sending || !client.connected;
}

let pollInterval: number | null = null;

async function pollForUpdates() {
  if (!client.connected) {
    return;
  }
  const prevCount = state.messages.length;
  await loadHistory(client, state);
  if (state.messages.length !== prevCount) {
    renderMessages();
  }
}

const client = new GatewayClient({
  url: gatewayUrl,
  token,
  password,
  onConnected: async () => {
    setStatus("Connected", "connected");
    updateSendButton();
    await loadHistory(client, state);
    renderMessages();
    // Start polling for updates every 1 second
    if (pollInterval) {
      clearInterval(pollInterval);
    }
    pollInterval = window.setInterval(pollForUpdates, 1000);
  },
  onDisconnected: () => {
    setStatus("Disconnected", "error");
    updateSendButton();
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  },
  onEvent: (evt) => {
    const handled = handleEvent(state, evt);
    if (handled) {
      renderMessages();
    }
  },
});

async function handleSend() {
  const text = inputEl.value;
  if (!text.trim()) {
    return;
  }

  inputEl.value = "";
  inputEl.style.height = "auto";
  renderMessages();

  await sendMessage(client, state, text);
  renderMessages();
  updateSendButton();
}

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void handleSend();
  }
});

inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + "px";
});

sendBtn.addEventListener("click", () => void handleSend());

setStatus("Connecting...");
renderMessages();
client.start();
