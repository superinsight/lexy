import { marked } from "marked";
import { createChatState, loadHistory, sendMessage, handleEvent, wsUrlToHttpUrl } from "./chat";
import { GatewayClient } from "./gateway";
import {
  createSettingsState,
  fetchAvailableModels,
  loadGoogleStatus,
  loadModelConfig,
  loadUserProfileFromAgent,
  saveModelConfig,
  saveUserProfile,
  startGoogleAuth,
  disconnectGoogle,
  renderSettingsPanel,
  attachSettingsHandlers,
  handleGoogleCallback,
} from "./settings";
import type { UserProfile } from "./settings";

marked.setOptions({ breaks: true, gfm: true, async: false });

function renderMarkdown(text: string): string {
  try {
    const raw = marked.parse(text, { async: false });
    return raw || text;
  } catch {
    return text;
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const statusEl = $<HTMLDivElement>("status");
const messagesEl = $<HTMLDivElement>("messages");
const inputEl = $<HTMLTextAreaElement>("input");
const sendBtn = $<HTMLButtonElement>("send");
const newConversationBtn = $<HTMLButtonElement>("new-conversation");
const settingsBtn = $<HTMLButtonElement>("settings");
const settingsContainerEl = $<HTMLDivElement>("settings-container");
const chatContainerEl = $<HTMLElement>("chat-container");
const filePreviewEl = $<HTMLDivElement>("file-preview");
const fileInputEl = $<HTMLInputElement>("file-input");

let pendingFiles: File[] = [];

// Tab title notification badge for new messages while tab is not focused
const BASE_TITLE = document.title;
let unreadCount = 0;

function updateTitleBadge() {
  document.title = unreadCount > 0 ? `(${unreadCount}) ${BASE_TITLE}` : BASE_TITLE;
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    unreadCount = 0;
    updateTitleBadge();
  }
});

const urlParams = new URL(window.location.href).searchParams;

// Check for OAuth callback parameters
const pendingOAuthCode = urlParams.get("code");
const pendingOAuthState = urlParams.get("state");
const pendingOAuthError = urlParams.get("error");

const gatewayUrl =
  urlParams.get("gateway") ??
  localStorage.getItem("gateway_url") ??
  `ws://${window.location.hostname}:18789`;

const token = urlParams.get("token") ?? localStorage.getItem("gateway_token") ?? undefined;

const password = urlParams.get("password") ?? localStorage.getItem("gateway_password") ?? undefined;

function generateConversationKey(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `portal-${timestamp}-${random}`;
}

// --- Conversation list management ---
type ConversationEntry = {
  key: string;
  label: string;
  createdAt: number;
};

const CONVERSATIONS_STORAGE_KEY = "lexy_sessions";

function loadConversations(): ConversationEntry[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return JSON.parse(raw) as ConversationEntry[];
  } catch {
    return [];
  }
}

function saveConversations(conversations: ConversationEntry[]): void {
  localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(conversations));
}

function addConversation(key: string, label?: string): ConversationEntry {
  const conversations = loadConversations();
  const existing = conversations.find((s) => s.key === key);
  if (existing) {
    return existing;
  }
  const entry: ConversationEntry = {
    key,
    label: label ?? formatConversationLabel(key),
    createdAt: Date.now(),
  };
  conversations.unshift(entry);
  saveConversations(conversations);
  return entry;
}

function removeConversation(key: string): void {
  const conversations = loadConversations().filter((s) => s.key !== key);
  saveConversations(conversations);
}

function renameConversation(key: string, newLabel: string): void {
  const conversations = loadConversations();
  const entry = conversations.find((s) => s.key === key);
  if (entry) {
    entry.label = newLabel;
    saveConversations(conversations);
  }
}

function formatConversationLabel(key: string): string {
  const match = key.match(/^portal-(\d+)/);
  if (match) {
    const date = new Date(Number(match[1]));
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (key === "portal-admin") {
    return "Default Conversation";
  }
  return key;
}

const urlConversationKey = new URL(window.location.href).searchParams.get("session");
let currentConversationKey: string;
if (urlConversationKey) {
  currentConversationKey = urlConversationKey;
} else {
  const existing = loadConversations();
  currentConversationKey = existing.length > 0 ? existing[0].key : generateConversationKey();
}
addConversation(currentConversationKey);
if (!urlConversationKey && currentConversationKey !== "portal-admin") {
  const initUrl = new URL(window.location.href);
  initUrl.searchParams.set("session", currentConversationKey);
  window.history.replaceState({}, "", initUrl.toString());
}

let state = createChatState(currentConversationKey);
const settingsState = createSettingsState();
let sidebarOpen = localStorage.getItem("lexy_sidebar_open") !== "false";

// Store gateway config for persistence and OAuth callback
localStorage.setItem("gateway_url", gatewayUrl);
if (token) {
  localStorage.setItem("gateway_token", token);
}
if (password) {
  localStorage.setItem("gateway_password", password);
}

const sidebarEl = $<HTMLElement>("sidebar");
const conversationListEl = $<HTMLDivElement>("conversation-list");
const sidebarToggleBtn = $<HTMLButtonElement>("sidebar-toggle");

function renderSidebar() {
  const conversations = loadConversations();
  sidebarEl.classList.toggle("open", sidebarOpen);
  document.getElementById("app")!.classList.toggle("sidebar-open", sidebarOpen);

  conversationListEl.innerHTML = conversations
    .map((s) => {
      const active = s.key === currentConversationKey ? "active" : "";
      const label = escapeHtml(s.label);
      return `<div class="conversation-item ${active}" data-key="${escapeHtml(s.key)}">
        <div class="conversation-item-content">
          <span class="conversation-label">${label}</span>
        </div>
        <button class="conversation-delete" data-delete-key="${escapeHtml(s.key)}" title="Delete conversation">&times;</button>
      </div>`;
    })
    .join("");

  if (conversations.length === 0) {
    conversationListEl.innerHTML = `<div class="conversation-empty">No conversations yet</div>`;
  }
}

conversationListEl.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;

  const deleteBtn = target.closest<HTMLElement>(".conversation-delete");
  if (deleteBtn) {
    e.stopPropagation();
    const key = deleteBtn.dataset.deleteKey;
    if (!key) {
      return;
    }

    if (key === currentConversationKey) {
      const remaining = loadConversations().filter((s) => s.key !== key);
      if (remaining.length === 0) {
        showToast("Cannot delete the only conversation", "error");
        return;
      }
      removeConversation(key);
      void switchToConversation(remaining[0].key);
    } else {
      removeConversation(key);
      renderSidebar();
    }
    return;
  }

  const item = target.closest<HTMLElement>(".conversation-item");
  if (item?.dataset.key && item.dataset.key !== currentConversationKey) {
    void switchToConversation(item.dataset.key);
  }
});

conversationListEl.addEventListener("dblclick", (e) => {
  const item = (e.target as HTMLElement).closest<HTMLElement>(".conversation-item");
  if (!item?.dataset.key) {
    return;
  }
  const key = item.dataset.key;
  const conversations = loadConversations();
  const entry = conversations.find((s) => s.key === key);
  if (!entry) {
    return;
  }
  const newLabel = prompt("Rename conversation:", entry.label);
  if (newLabel?.trim()) {
    renameConversation(key, newLabel.trim());
    renderSidebar();
  }
});

sidebarToggleBtn.addEventListener("click", () => {
  sidebarOpen = !sidebarOpen;
  localStorage.setItem("lexy_sidebar_open", String(sidebarOpen));
  renderSidebar();
});

async function switchToConversation(key: string) {
  currentConversationKey = key;
  state = createChatState(currentConversationKey);

  const url = new URL(window.location.href);
  if (key === "portal-admin") {
    url.searchParams.delete("session");
  } else {
    url.searchParams.set("session", key);
  }
  window.history.pushState({}, "", url.toString());

  renderSidebar();
  renderMessages();

  if (client.connected) {
    await loadHistory(client, state);
    renderMessages();
  }

  inputEl.focus();
}

function renderMessages() {
  const allMessages: Array<{
    role: string;
    content: string;
    timestamp?: number;
    isStreaming?: boolean;
    isThinking?: boolean;
    isProcessing?: boolean;
    processingLabel?: string;
    isSystem?: boolean;
  }> = [...state.messages];

  // Show processing indicator while attachments are being extracted
  if (state.processingStatus) {
    allMessages.push({
      role: "assistant",
      content: "",
      isProcessing: true,
      processingLabel: state.processingStatus,
    });
  } else if (state.runId !== null && (state.streaming === null || state.streaming === "")) {
    allMessages.push({ role: "assistant", content: "", isThinking: true });
  } else if (state.streaming !== null && state.streaming !== "") {
    allMessages.push({ role: "assistant", content: state.streaming, isStreaming: true });
  }

  if (allMessages.length === 0) {
    messagesEl.innerHTML = `
      <div class="empty-state">
        <img src="/favicon.svg" alt="Lexy" class="empty-icon" />
        <p>Start a conversation with Lexy</p>
      </div>
    `;
    return;
  }

  messagesEl.innerHTML = allMessages
    .map((msg) => {
      const roleClass = msg.role === "user" ? "user" : "assistant";
      const streamingClass = msg.isStreaming ? "streaming" : "";

      if (msg.isSystem) {
        const sysContent =
          msg.role === "user" ? escapeHtml(msg.content) : renderMarkdown(msg.content);
        const sysTime = msg.timestamp ? formatTimestamp(msg.timestamp) : "";
        const sysTimeHtml = sysTime ? `<span class="system-time">${sysTime}</span>` : "";
        return `<div class="message system-message collapsed">
          <div class="system-message-header">
            <span class="system-toggle-icon">&#9654;</span>
            <span class="system-label">System message</span>
            ${sysTimeHtml}
          </div>
          <div class="system-message-body">
            <div class="message-content">${sysContent}</div>
          </div>
        </div>`;
      }

      if (msg.isProcessing) {
        return `<div class="message assistant processing">
          <div class="processing-indicator">
            <div class="processing-spinner"></div>
            <span>${msg.processingLabel}</span>
          </div>
        </div>`;
      }

      if (msg.isThinking) {
        return `<div class="message assistant thinking">
          <div class="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>`;
      }

      const content = msg.role === "user" ? escapeHtml(msg.content) : renderMarkdown(msg.content);
      const time = msg.isStreaming || msg.timestamp == null ? "" : formatTimestamp(msg.timestamp);
      const timeHtml = time ? `<div class="message-time">${time}</div>` : "";
      return `<div class="message ${roleClass} ${streamingClass}">
        <div class="message-content">${content}</div>
        ${timeHtml}
      </div>`;
    })
    .join("");

  for (const header of messagesEl.querySelectorAll(".system-message-header")) {
    header.addEventListener("click", () => {
      header.parentElement?.classList.toggle("collapsed");
    });
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (isToday) {
    return timeStr;
  }
  if (isYesterday) {
    return `Yesterday ${timeStr}`;
  }
  const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${dateStr} ${timeStr}`;
}

function setStatus(text: string, className: string = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${className}`;
}

const toastContainer = (() => {
  const el = document.createElement("div");
  el.className = "toast-container";
  document.body.appendChild(el);
  return el;
})();

function showToast(message: string, type: "success" | "error" = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icon =
    type === "success"
      ? `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
      : `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

  toast.innerHTML = `${icon}<span class="toast-message">${escapeHtml(message)}</span><button class="toast-dismiss">&times;</button>`;

  toast.querySelector(".toast-dismiss")!.addEventListener("click", () => dismiss());

  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));

  function dismiss() {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }

  setTimeout(dismiss, type === "error" ? 6000 : 4000);
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

function cleanOAuthParams() {
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("code");
  cleanUrl.searchParams.delete("state");
  cleanUrl.searchParams.delete("scope");
  cleanUrl.searchParams.delete("authuser");
  cleanUrl.searchParams.delete("prompt");
  cleanUrl.searchParams.delete("error");
  cleanUrl.searchParams.delete("error_description");
  cleanUrl.searchParams.delete("iss");
  window.history.replaceState({}, "", cleanUrl.toString());
}

const client = new GatewayClient({
  url: gatewayUrl,
  token,
  password,
  onConnected: async () => {
    // Handle pending OAuth callback first
    if (pendingOAuthError) {
      showToast(
        `Google auth failed: ${urlParams.get("error_description") || pendingOAuthError}`,
        "error",
      );
      cleanOAuthParams();
    } else if (pendingOAuthCode && pendingOAuthState) {
      try {
        setStatus("Completing Google authentication...");
        const result = await handleGoogleCallback(client, pendingOAuthCode, pendingOAuthState);
        if (result.success) {
          showToast("Google account connected successfully!");
        } else {
          showToast(`Failed to connect Google: ${result.error}`, "error");
        }
      } catch (err) {
        showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
      cleanOAuthParams();
    }

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
      // Badge the tab title when a final message arrives while tab is hidden
      const payload = evt.payload as { state?: string } | undefined;
      if (document.hidden && payload?.state === "final") {
        unreadCount++;
        updateTitleBadge();
      }
    }
  },
});

// --- File attachment helpers ---

const MAX_FILE_SIZE_MB = 50;

function renderFilePreview() {
  if (pendingFiles.length === 0) {
    filePreviewEl.innerHTML = "";
    filePreviewEl.style.display = "none";
    return;
  }
  filePreviewEl.style.display = "flex";
  filePreviewEl.innerHTML = pendingFiles
    .map((f, i) => {
      const isImage = f.type.startsWith("image/");
      const thumb = isImage
        ? `<img src="${URL.createObjectURL(f)}" alt="" class="file-chip-thumb" />`
        : "";
      const sizeKb = (f.size / 1024).toFixed(0);
      const sizeLabel =
        f.size >= 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
      return `<div class="file-chip">
        ${thumb}
        <span class="file-chip-name">${escapeHtml(f.name)}</span>
        <span class="file-chip-size">${sizeLabel}</span>
        <button class="file-chip-remove" data-remove-index="${i}" title="Remove">&times;</button>
      </div>`;
    })
    .join("");
}

function addFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      showToast(`${file.name} exceeds ${MAX_FILE_SIZE_MB} MB limit`, "error");
      continue;
    }
    if (pendingFiles.some((f) => f.name === file.name && f.size === file.size)) {
      continue;
    }
    pendingFiles.push(file);
  }
  renderFilePreview();
}

filePreviewEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>(".file-chip-remove");
  if (!btn) {
    return;
  }
  const idx = Number(btn.dataset.removeIndex);
  if (!Number.isNaN(idx) && idx >= 0 && idx < pendingFiles.length) {
    pendingFiles.splice(idx, 1);
    renderFilePreview();
  }
});

fileInputEl.addEventListener("change", () => {
  if (fileInputEl.files && fileInputEl.files.length > 0) {
    addFiles(fileInputEl.files);
    fileInputEl.value = "";
  }
});

// Drag-and-drop on chat container
chatContainerEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  chatContainerEl.classList.add("drag-over");
});

chatContainerEl.addEventListener("dragleave", (e) => {
  if (!chatContainerEl.contains(e.relatedTarget as Node)) {
    chatContainerEl.classList.remove("drag-over");
  }
});

chatContainerEl.addEventListener("drop", (e) => {
  e.preventDefault();
  chatContainerEl.classList.remove("drag-over");
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    addFiles(e.dataTransfer.files);
  }
});

// --- Send handling ---

async function handleSend() {
  const text = inputEl.value;
  const hasFiles = pendingFiles.length > 0;
  if (!text.trim() && !hasFiles) {
    return;
  }

  const files = hasFiles ? [...pendingFiles] : undefined;
  if (hasFiles) {
    pendingFiles = [];
    renderFilePreview();
  }

  inputEl.value = "";
  inputEl.style.height = "auto";
  renderMessages();

  const httpBaseUrl = wsUrlToHttpUrl(gatewayUrl);
  const authToken = token ?? password;

  await sendMessage(client, state, text, {
    files,
    httpBaseUrl,
    authToken,
    onStateChange: renderMessages,
  });
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

async function handleNewConversation() {
  currentConversationKey = generateConversationKey();
  addConversation(currentConversationKey);

  const url = new URL(window.location.href);
  url.searchParams.set("session", currentConversationKey);
  window.history.pushState({}, "", url.toString());

  state = createChatState(currentConversationKey);

  renderSidebar();
  renderMessages();

  if (client.connected) {
    await loadHistory(client, state);
    renderMessages();
  }

  inputEl.focus();
}

newConversationBtn.addEventListener("click", () => void handleNewConversation());

let settingsAbort: AbortController | null = null;

function renderSettings() {
  settingsAbort?.abort();
  settingsAbort = new AbortController();

  settingsContainerEl.innerHTML = renderSettingsPanel(
    settingsState,
    closeSettings,
    handleConnectGoogle,
    handleDisconnectGoogle,
  );
  attachSettingsHandlers(
    settingsContainerEl,
    closeSettings,
    handleConnectGoogle,
    handleDisconnectGoogle,
    handleSaveModel,
    (tab) => {
      settingsState.activeTab = tab;
      renderSettings();
    },
    settingsAbort.signal,
    handleSaveProfile,
  );
}

function openSettings() {
  settingsState.visible = true;
  void Promise.all([fetchAvailableModels(), loadModelConfig(client, settingsState)]).then(
    ([models]) => {
      settingsState.availableModels = models;
      renderSettings();
    },
  );
  void loadGoogleStatus(client, settingsState).then(renderSettings);
  void loadUserProfileFromAgent(client, settingsState).then(renderSettings);
  renderSettings();
}

function closeSettings() {
  settingsState.visible = false;
  renderSettings();
}

function handleConnectGoogle() {
  void startGoogleAuth();
}

async function handleDisconnectGoogle() {
  await disconnectGoogle(client);
  await loadGoogleStatus(client, settingsState);
  renderSettings();
}

async function handleSaveModel(model: string) {
  const saveBtn = document.querySelector(".btn-save-model");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
  }

  const result = await saveModelConfig(client, model, settingsState.availableModels);

  if (result.success) {
    showToast("Model settings saved. Reconnecting...");
    await loadModelConfig(client, settingsState);
    renderSettings();
  } else {
    showToast(`Failed to save: ${result.error}`, "error");
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  }
}

async function handleSaveProfile(profile: UserProfile) {
  const saveBtn = document.querySelector(".btn-save-profile");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
  }

  settingsState.userProfile = profile;
  const result = await saveUserProfile(client, profile);

  if (result.success) {
    showToast("Profile saved");
    renderSettings();
  } else {
    showToast(`Failed to save profile: ${result.error}`, "error");
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Profile";
    }
  }
}

settingsBtn.addEventListener("click", openSettings);

setStatus("Connecting...");
renderSidebar();
renderMessages();
client.start();
