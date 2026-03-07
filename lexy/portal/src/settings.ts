import type { GatewayClient } from "./gateway";

export type GoogleWorkspaceStatus = {
  connected: boolean;
  email?: string;
  scopes?: string[];
};

export type ModelConfig = {
  provider: string;
  model: string;
  hasApiKey: boolean;
};

const AVAILABLE_MODELS = [
  // OpenAI — frontier models for professional (legal/medical) work
  { id: "gpt-5.4", label: "GPT-5.4", provider: "openai" },
  { id: "gpt-5.4-pro", label: "GPT-5.4 Pro", provider: "openai" },
  { id: "gpt-5", label: "GPT-5", provider: "openai" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", provider: "openai" },
  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai" },
  // Anthropic — latest generation models
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "anthropic" },
  // Google — latest Gemini models
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview)", provider: "google" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", provider: "google" },
  {
    id: "gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash-Lite (Preview)",
    provider: "google",
  },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
];

const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
};

export type SettingsTab = "model" | "integrations";

export type SettingsState = {
  visible: boolean;
  activeTab: SettingsTab;
  googleStatus: GoogleWorkspaceStatus | null;
  modelConfig: ModelConfig | null;
  modelLoading: boolean;
  loading: boolean;
};

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

export function createSettingsState(): SettingsState {
  return {
    visible: false,
    activeTab: "model",
    googleStatus: null,
    modelConfig: null,
    modelLoading: false,
    loading: false,
  };
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function loadGoogleStatus(client: GatewayClient, state: SettingsState): Promise<void> {
  state.loading = true;
  try {
    const res = await client.request<{
      connected: boolean;
      email?: string;
      scopes?: string[];
    }>("integrations.google.status", {});
    state.googleStatus = {
      connected: res.connected ?? false,
      email: res.email,
      scopes: res.scopes,
    };
  } catch {
    state.googleStatus = { connected: false };
  } finally {
    state.loading = false;
  }
}

export async function startGoogleAuth(): Promise<void> {
  const clientId = getGoogleClientId();
  if (!clientId) {
    alert("Google OAuth Client ID not configured. Set VITE_GOOGLE_CLIENT_ID environment variable.");
    return;
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  localStorage.setItem("google_code_verifier", codeVerifier);

  const redirectUri = `${window.location.origin}/oauth/google/callback`;
  const state = crypto.randomUUID();
  localStorage.setItem("google_oauth_state", state);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  });

  window.location.href = `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export async function handleGoogleCallback(
  client: GatewayClient,
  code: string,
  state: string,
): Promise<{ success: boolean; error?: string }> {
  console.log("[Google OAuth] Starting callback handler");

  const savedState = localStorage.getItem("google_oauth_state");
  console.log("[Google OAuth] State check:", { received: state, saved: savedState });
  if (state !== savedState) {
    return {
      success: false,
      error: `Invalid OAuth state (received: ${state?.slice(0, 8)}..., saved: ${savedState?.slice(0, 8) ?? "null"}...)`,
    };
  }

  const codeVerifier = localStorage.getItem("google_code_verifier");
  if (!codeVerifier) {
    console.error("[Google OAuth] Missing code verifier in localStorage");
    return { success: false, error: "Missing code verifier - session may have expired" };
  }
  console.log("[Google OAuth] Code verifier found");

  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  if (!clientId) {
    console.error("[Google OAuth] Missing client ID");
    return { success: false, error: "Google Client ID not configured" };
  }
  console.log("[Google OAuth] Client ID found, has secret:", !!clientSecret);

  const redirectUri = `${window.location.origin}/oauth/google/callback`;

  try {
    console.log("[Google OAuth] Exchanging code for tokens...");
    const tokenBody = new URLSearchParams({
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    });

    if (clientSecret) {
      tokenBody.set("client_secret", clientSecret);
    }

    const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("[Google OAuth] Token exchange failed:", errorText);
      return { success: false, error: `Token exchange failed: ${errorText}` };
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };
    console.log(
      "[Google OAuth] Token exchange successful, has refresh_token:",
      !!tokenData.refresh_token,
    );

    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    let email: string | undefined;
    if (userInfoResponse.ok) {
      const userInfo = (await userInfoResponse.json()) as { email?: string };
      email = userInfo.email;
      console.log("[Google OAuth] Got user email:", email);
    }

    console.log("[Google OAuth] Saving credentials to gateway...");
    await client.request("integrations.google.save", {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      scopes: tokenData.scope.split(" "),
      email,
    });
    console.log("[Google OAuth] Credentials saved successfully");

    localStorage.removeItem("google_code_verifier");
    localStorage.removeItem("google_oauth_state");

    return { success: true };
  } catch (err) {
    console.error("[Google OAuth] Exception:", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function disconnectGoogle(client: GatewayClient): Promise<void> {
  await client.request("integrations.google.logout", {});
}

// --- Model configuration ---

export async function loadModelConfig(client: GatewayClient, state: SettingsState): Promise<void> {
  const fallback: ModelConfig = { provider: "openai", model: "gpt-5.4", hasApiKey: false };
  state.modelLoading = true;
  try {
    const res = await client.request<{
      config: {
        env?: Record<string, string | undefined>;
        agents?: {
          defaults?: {
            model?: string | { primary?: string };
          };
        };
      };
    }>("config.get", {});

    const modelField = res.config?.agents?.defaults?.model;
    const primaryRef = typeof modelField === "string" ? modelField : modelField?.primary;

    if (!primaryRef) {
      state.modelConfig = fallback;
      return;
    }

    // primaryRef is "provider/model" (e.g. "openai/gpt-5.4")
    const slashIdx = primaryRef.indexOf("/");
    const provider = slashIdx > 0 ? primaryRef.slice(0, slashIdx) : "openai";
    const modelId = slashIdx > 0 ? primaryRef.slice(slashIdx + 1) : primaryRef;

    const envKey = PROVIDER_ENV_KEYS[provider];
    const envVal = envKey ? res.config?.env?.[envKey] : undefined;
    const hasApiKey = typeof envVal === "string" && envVal.length > 0;

    state.modelConfig = { provider, model: modelId, hasApiKey };
  } catch {
    state.modelConfig = fallback;
  } finally {
    state.modelLoading = false;
  }
}

export async function saveModelConfig(
  client: GatewayClient,
  apiKey: string,
  model: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const snapshot = await client.request<{ hash?: string }>("config.get", {});
    const baseHash = snapshot.hash;

    const selected = AVAILABLE_MODELS.find((m) => m.id === model);
    const provider = selected?.provider ?? "openai";
    const modelRef = `${provider}/${model}`;
    const envKey = PROVIDER_ENV_KEYS[provider] ?? `${provider.toUpperCase()}_API_KEY`;

    const patch: Record<string, unknown> = {
      agents: {
        defaults: {
          model: { primary: modelRef },
        },
      },
    };

    if (apiKey) {
      patch.env = { [envKey]: apiKey };
    }

    await client.request("config.patch", {
      baseHash,
      raw: JSON.stringify(patch),
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function getGoogleClientId(): string | null {
  return (
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GOOGLE_CLIENT_ID ??
    localStorage.getItem("google_client_id") ??
    null
  );
}

function getGoogleClientSecret(): string | null {
  return (
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GOOGLE_CLIENT_SECRET ??
    localStorage.getItem("google_client_secret") ??
    null
  );
}

export function renderSettingsPanel(
  state: SettingsState,
  _onClose: () => void,
  _onConnectGoogle: () => void,
  _onDisconnectGoogle: () => void,
): string {
  if (!state.visible) {
    return "";
  }

  const googleSection = state.loading
    ? `<div class="integration-loading">Loading...</div>`
    : state.googleStatus?.connected
      ? `
        <div class="integration-connected">
          <div class="integration-status">
            <span class="status-dot connected"></span>
            <span>Connected</span>
          </div>
          ${state.googleStatus.email ? `<div class="integration-email">${escapeHtml(state.googleStatus.email)}</div>` : ""}
          <button class="btn-disconnect" data-action="disconnect-google">Disconnect</button>
        </div>
      `
      : `
        <div class="integration-disconnected">
          <div class="integration-status">
            <span class="status-dot"></span>
            <span>Not connected</span>
          </div>
          <button class="btn-connect" data-action="connect-google">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Connect Google Workspace
          </button>
          <p class="integration-desc">Connect your Google account to let Lexy access Gmail, Calendar, and Drive.</p>
        </div>
      `;

  const currentModel = state.modelConfig?.model ?? "gpt-5.4";
  const providerLabels: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
  };
  const grouped = new Map<string, typeof AVAILABLE_MODELS>();
  for (const m of AVAILABLE_MODELS) {
    const list = grouped.get(m.provider) ?? [];
    list.push(m);
    grouped.set(m.provider, list);
  }
  const modelOptions = [...grouped.entries()]
    .map(
      ([provider, models]) =>
        `<optgroup label="${escapeHtml(providerLabels[provider] ?? provider)}">${models
          .map(
            (m) =>
              `<option value="${m.id}" ${m.id === currentModel ? "selected" : ""}>${escapeHtml(m.label)}</option>`,
          )
          .join("")}</optgroup>`,
    )
    .join("");

  const modelSection = state.modelLoading
    ? `<div class="integration-loading">Loading...</div>`
    : `
        <div class="model-form">
          <div class="model-field">
            <label class="model-label" for="model-api-key">API Key</label>
            <input
              type="password"
              id="model-api-key"
              class="model-input"
              placeholder="${state.modelConfig?.hasApiKey ? "••••••••••••••••  (key saved)" : "sk-..."}"
              autocomplete="off"
            />
            <p class="model-hint">Your key is stored securely on the server and never exposed.</p>
          </div>
          <div class="model-field">
            <label class="model-label" for="model-select">Model</label>
            <select id="model-select" class="model-select">${modelOptions}</select>
          </div>
          <button class="btn-save-model" data-action="save-model">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Save
          </button>
        </div>
      `;

  const isModelTab = state.activeTab === "model";

  const modelTabContent = `
    <div class="settings-tab-content ${isModelTab ? "active" : ""}">
      <div class="integration-card">
        <div class="integration-header">
          <div class="integration-icon model">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div class="integration-info">
            <h4>Language Model</h4>
            <p>Configure your AI provider and model</p>
          </div>
        </div>
        ${modelSection}
      </div>
    </div>
  `;

  const integrationsTabContent = `
    <div class="settings-tab-content ${!isModelTab ? "active" : ""}">
      <div class="integration-card">
        <div class="integration-header">
          <div class="integration-icon google">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          </div>
          <div class="integration-info">
            <h4>Google Workspace</h4>
            <p>Gmail, Calendar, Drive</p>
          </div>
        </div>
        ${googleSection}
      </div>
    </div>
  `;

  return `
    <div class="settings-overlay" data-action="close-settings">
      <div class="settings-panel">
        <div class="settings-header">
          <h2>Settings</h2>
          <button class="settings-close" data-action="close-settings">&times;</button>
        </div>
        <div class="settings-tabs">
          <button class="settings-tab ${isModelTab ? "active" : ""}" data-action="tab-model">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
            AI Model
          </button>
          <button class="settings-tab ${!isModelTab ? "active" : ""}" data-action="tab-integrations">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            Integrations
          </button>
        </div>
        <div class="settings-content">
          ${isModelTab ? modelTabContent : integrationsTabContent}
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function attachSettingsHandlers(
  container: HTMLElement,
  onClose: () => void,
  onConnectGoogle: () => void,
  onDisconnectGoogle: () => void,
  onSaveModel?: (apiKey: string, model: string) => void,
  onTabChange?: (tab: SettingsTab) => void,
  signal?: AbortSignal,
): void {
  container.addEventListener(
    "click",
    (e) => {
      const target = e.target as HTMLElement;
      const actionEl = target.closest<HTMLElement>("[data-action]");
      const action = target.dataset.action ?? actionEl?.dataset.action;

      switch (action) {
        case "close-settings":
          if (
            target.classList.contains("settings-overlay") ||
            target.classList.contains("settings-close")
          ) {
            onClose();
          }
          break;
        case "connect-google":
          onConnectGoogle();
          break;
        case "disconnect-google":
          onDisconnectGoogle();
          break;
        case "save-model": {
          const apiKeyInput = document.getElementById("model-api-key") as HTMLInputElement | null;
          const modelSelect = document.getElementById("model-select") as HTMLSelectElement | null;
          if (apiKeyInput && modelSelect && onSaveModel) {
            onSaveModel(apiKeyInput.value, modelSelect.value);
          }
          break;
        }
        case "tab-model":
          onTabChange?.("model");
          break;
        case "tab-integrations":
          onTabChange?.("integrations");
          break;
      }
    },
    { signal },
  );
}
