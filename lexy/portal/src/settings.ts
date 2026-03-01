import type { GatewayClient } from "./gateway";

export type GoogleWorkspaceStatus = {
  connected: boolean;
  email?: string;
  scopes?: string[];
};

export type SettingsState = {
  visible: boolean;
  googleStatus: GoogleWorkspaceStatus | null;
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
    googleStatus: null,
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

  sessionStorage.setItem("google_code_verifier", codeVerifier);

  const redirectUri = `${window.location.origin}/oauth/google/callback`;
  const state = crypto.randomUUID();
  sessionStorage.setItem("google_oauth_state", state);

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
  const savedState = sessionStorage.getItem("google_oauth_state");
  if (state !== savedState) {
    return { success: false, error: "Invalid OAuth state" };
  }

  const codeVerifier = sessionStorage.getItem("google_code_verifier");
  if (!codeVerifier) {
    return { success: false, error: "Missing code verifier" };
  }

  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  if (!clientId) {
    return { success: false, error: "Google Client ID not configured" };
  }

  const redirectUri = `${window.location.origin}/oauth/google/callback`;

  try {
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
      return { success: false, error: `Token exchange failed: ${errorText}` };
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    let email: string | undefined;
    if (userInfoResponse.ok) {
      const userInfo = (await userInfoResponse.json()) as { email?: string };
      email = userInfo.email;
    }

    await client.request("integrations.google.save", {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      scopes: tokenData.scope.split(" "),
      email,
    });

    sessionStorage.removeItem("google_code_verifier");
    sessionStorage.removeItem("google_oauth_state");

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function disconnectGoogle(client: GatewayClient): Promise<void> {
  await client.request("integrations.google.logout", {});
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

  return `
    <div class="settings-overlay" data-action="close-settings">
      <div class="settings-panel" onclick="event.stopPropagation()">
        <div class="settings-header">
          <h2>Settings</h2>
          <button class="settings-close" data-action="close-settings">&times;</button>
        </div>
        <div class="settings-content">
          <section class="settings-section">
            <h3>Integrations</h3>
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
          </section>
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
): void {
  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const action =
      target.dataset.action ?? target.closest<HTMLElement>("[data-action]")?.dataset.action;

    switch (action) {
      case "close-settings":
        onClose();
        break;
      case "connect-google":
        onConnectGoogle();
        break;
      case "disconnect-google":
        onDisconnectGoogle();
        break;
    }
  });
}
