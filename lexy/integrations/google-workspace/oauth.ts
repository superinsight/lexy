import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import {
  BASE_SCOPES,
  GOOGLE_WORKSPACE_SCOPES,
  type GoogleWorkspaceAuthConfig,
  type GoogleWorkspaceCredentials,
  type GoogleWorkspaceOAuthContext,
  type GoogleWorkspaceService,
} from "./types.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
const DEFAULT_REDIRECT_URI = "http://localhost:8086/oauth2callback";
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

const CLIENT_ID_ENV_KEYS = [
  "LEXY_GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_ID",
  "OPENCLAW_GOOGLE_OAUTH_CLIENT_ID",
];
const CLIENT_SECRET_ENV_KEYS = [
  "LEXY_GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "OPENCLAW_GOOGLE_OAUTH_CLIENT_SECRET",
];

function resolveEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function resolveGoogleOAuthConfig(
  config?: Partial<GoogleWorkspaceAuthConfig>,
): GoogleWorkspaceAuthConfig {
  const clientId = config?.clientId ?? resolveEnv(CLIENT_ID_ENV_KEYS);
  const clientSecret = config?.clientSecret ?? resolveEnv(CLIENT_SECRET_ENV_KEYS);
  const redirectUri = config?.redirectUri ?? DEFAULT_REDIRECT_URI;

  if (!clientId) {
    throw new Error(
      `Google OAuth client ID not found. Set one of: ${CLIENT_ID_ENV_KEYS.join(", ")}`,
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    services: config?.services ?? ["gmail", "calendar", "drive"],
  };
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function buildScopes(services: GoogleWorkspaceService[]): string[] {
  const scopes = new Set<string>(BASE_SCOPES);
  for (const service of services) {
    const serviceScopes = GOOGLE_WORKSPACE_SCOPES[service];
    if (serviceScopes) {
      for (const scope of serviceScopes) {
        scopes.add(scope);
      }
    }
  }
  return Array.from(scopes);
}

function buildAuthUrl(
  config: GoogleWorkspaceAuthConfig,
  challenge: string,
  verifier: string,
  scopes: string[],
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri ?? DEFAULT_REDIRECT_URI,
    scope: scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseCallbackInput(
  input: string,
  expectedState: string,
): { code: string; state: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { error: "No input provided" };
  }

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? expectedState;
    if (!code) {
      return { error: "Missing 'code' parameter in URL" };
    }
    if (!state) {
      return { error: "Missing 'state' parameter. Paste the full URL." };
    }
    return { code, state };
  } catch {
    if (!expectedState) {
      return { error: "Paste the full redirect URL, not just the code." };
    }
    return { code: trimmed, state: expectedState };
  }
}

async function waitForLocalCallback(params: {
  redirectUri: string;
  expectedState: string;
  timeoutMs: number;
  onProgress?: (message: string) => void;
}): Promise<{ code: string; state: string }> {
  const url = new URL(params.redirectUri);
  const port = Number(url.port) || 8086;
  const hostname = url.hostname;
  const expectedPath = url.pathname;

  return new Promise<{ code: string; state: string }>((resolve, reject) => {
    let timeout: NodeJS.Timeout | null = null;
    const server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? "/", `http://${hostname}:${port}`);
        if (requestUrl.pathname !== expectedPath) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain");
          res.end("Not found");
          return;
        }

        const error = requestUrl.searchParams.get("error");
        const code = requestUrl.searchParams.get("code")?.trim();
        const state = requestUrl.searchParams.get("state")?.trim();

        if (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain");
          res.end(`Authentication failed: ${error}`);
          finish(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code || !state) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain");
          res.end("Missing code or state");
          finish(new Error("Missing OAuth code or state"));
          return;
        }

        if (state !== params.expectedState) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain");
          res.end("Invalid state");
          finish(new Error("OAuth state mismatch"));
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          "<!doctype html><html><head><meta charset='utf-8'/></head>" +
            "<body><h2>Google Workspace OAuth complete</h2>" +
            "<p>You can close this window and return to Lexy.</p></body></html>",
        );

        finish(undefined, { code, state });
      } catch (err) {
        finish(err instanceof Error ? err : new Error("OAuth callback failed"));
      }
    });

    const finish = (err?: Error, result?: { code: string; state: string }) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      try {
        server.close();
      } catch {
        // ignore close errors
      }
      if (err) {
        reject(err);
      } else if (result) {
        resolve(result);
      }
    };

    server.once("error", (err) => {
      finish(err instanceof Error ? err : new Error("OAuth callback server error"));
    });

    server.listen(port, hostname, () => {
      params.onProgress?.(`Waiting for OAuth callback on ${params.redirectUri}…`);
    });

    timeout = setTimeout(() => {
      finish(new Error("OAuth callback timeout"));
    }, params.timeoutMs);
  });
}

async function exchangeCodeForTokens(
  config: GoogleWorkspaceAuthConfig,
  code: string,
  verifier: string,
  scopes: string[],
): Promise<GoogleWorkspaceCredentials> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri ?? DEFAULT_REDIRECT_URI,
    code_verifier: verifier,
  });
  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret);
  }

  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept: "*/*",
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  if (!data.refresh_token) {
    throw new Error("No refresh token received. Please try again.");
  }

  const email = await getUserEmail(data.access_token);
  const expiresAt = Date.now() + data.expires_in * 1000 - 5 * 60 * 1000;

  return {
    refresh: data.refresh_token,
    access: data.access_token,
    expires: expiresAt,
    email,
    scopes,
  };
}

async function getUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetchWithTimeout(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) {
      const data = (await response.json()) as { email?: string };
      return data.email;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export async function refreshGoogleWorkspaceToken(
  config: GoogleWorkspaceAuthConfig,
  refreshToken: string,
  scopes: string[],
): Promise<GoogleWorkspaceCredentials> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret);
  }

  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept: "*/*",
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  const email = await getUserEmail(data.access_token);
  const expiresAt = Date.now() + data.expires_in * 1000 - 5 * 60 * 1000;

  return {
    refresh: data.refresh_token ?? refreshToken,
    access: data.access_token,
    expires: expiresAt,
    email,
    scopes,
  };
}

function shouldUseManualOAuthFlow(isRemote: boolean): boolean {
  return isRemote || process.env.WSL_DISTRO_NAME !== undefined;
}

export async function loginGoogleWorkspace(
  ctx: GoogleWorkspaceOAuthContext,
  config?: Partial<GoogleWorkspaceAuthConfig>,
): Promise<GoogleWorkspaceCredentials> {
  const resolvedConfig = resolveGoogleOAuthConfig(config);
  const services = resolvedConfig.services ?? ["gmail", "calendar", "drive"];
  const scopes = buildScopes(services);
  const needsManual = shouldUseManualOAuthFlow(ctx.isRemote);

  await ctx.note(
    needsManual
      ? [
          "You are running in a remote/VPS environment.",
          "A URL will be shown for you to open in your LOCAL browser.",
          "After signing in, copy the redirect URL and paste it back here.",
        ].join("\n")
      : [
          "Browser will open for Google authentication.",
          `Sign in with your Google account to grant access to: ${services.join(", ")}.`,
          `The callback will be captured automatically on ${resolvedConfig.redirectUri}.`,
        ].join("\n"),
    "Google Workspace OAuth",
  );

  const { verifier, challenge } = generatePkce();
  const authUrl = buildAuthUrl(resolvedConfig, challenge, verifier, scopes);

  if (needsManual) {
    ctx.progress.update("OAuth URL ready");
    ctx.log(`\nOpen this URL in your LOCAL browser:\n\n${authUrl}\n`);
    ctx.progress.update("Waiting for you to paste the callback URL...");
    const callbackInput = await ctx.prompt("Paste the redirect URL here: ");
    const parsed = parseCallbackInput(callbackInput, verifier);
    if ("error" in parsed) {
      throw new Error(parsed.error);
    }
    if (parsed.state !== verifier) {
      throw new Error("OAuth state mismatch - please try again");
    }
    ctx.progress.update("Exchanging authorization code for tokens...");
    return exchangeCodeForTokens(resolvedConfig, parsed.code, verifier, scopes);
  }

  ctx.progress.update("Complete sign-in in browser...");
  try {
    await ctx.openUrl(authUrl);
  } catch {
    ctx.log(`\nOpen this URL in your browser:\n\n${authUrl}\n`);
  }

  try {
    const { code } = await waitForLocalCallback({
      redirectUri: resolvedConfig.redirectUri ?? DEFAULT_REDIRECT_URI,
      expectedState: verifier,
      timeoutMs: 5 * 60 * 1000,
      onProgress: (msg) => ctx.progress.update(msg),
    });
    ctx.progress.update("Exchanging authorization code for tokens...");
    return await exchangeCodeForTokens(resolvedConfig, code, verifier, scopes);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("EADDRINUSE") ||
        err.message.includes("port") ||
        err.message.includes("listen"))
    ) {
      ctx.progress.update("Local callback server failed. Switching to manual mode...");
      ctx.log(`\nOpen this URL in your LOCAL browser:\n\n${authUrl}\n`);
      const callbackInput = await ctx.prompt("Paste the redirect URL here: ");
      const parsed = parseCallbackInput(callbackInput, verifier);
      if ("error" in parsed) {
        throw new Error(parsed.error, { cause: err });
      }
      if (parsed.state !== verifier) {
        throw new Error("OAuth state mismatch - please try again", { cause: err });
      }
      ctx.progress.update("Exchanging authorization code for tokens...");
      return exchangeCodeForTokens(resolvedConfig, parsed.code, verifier, scopes);
    }
    throw err;
  }
}
