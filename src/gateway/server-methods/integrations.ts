import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  loadAuthProfileStoreForSecretsRuntime,
  upsertAuthProfile,
} from "../../agents/auth-profiles.js";
import type { OAuthCredential } from "../../agents/auth-profiles/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const GOOGLE_WORKSPACE_PROVIDER = "google-workspace";

type GoogleStatusResponse = {
  connected: boolean;
  email?: string;
  scopes?: string[];
};

type GoogleSaveParams = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scopes?: string[];
  email?: string;
};

function loadGoogleStatus(agentDir?: string): GoogleStatusResponse {
  try {
    const store = loadAuthProfileStoreForSecretsRuntime(agentDir);
    const profiles = Object.entries(store.profiles).filter(
      ([, cred]) => cred.provider === GOOGLE_WORKSPACE_PROVIDER && cred.type === "oauth",
    );

    if (profiles.length === 0) {
      return { connected: false };
    }

    const [, cred] = profiles[0];
    if (cred.type !== "oauth") {
      return { connected: false };
    }

    const oauthCred = cred as OAuthCredential & { scopes?: string[] };
    return {
      connected: true,
      email: oauthCred.email,
      scopes: oauthCred.scopes,
    };
  } catch {
    return { connected: false };
  }
}

function saveGoogleCredentials(
  params: GoogleSaveParams,
  agentDir?: string,
): { success: boolean; error?: string } {
  try {
    const credential: OAuthCredential = {
      type: "oauth",
      provider: GOOGLE_WORKSPACE_PROVIDER,
      access: params.accessToken,
      refresh: params.refreshToken ?? "",
      expires: Date.now() + params.expiresIn * 1000,
      email: params.email,
      scopes: params.scopes,
    };

    upsertAuthProfile({
      profileId: GOOGLE_WORKSPACE_PROVIDER,
      credential,
      agentDir,
    });

    // Clear runtime cache so subsequent reads get fresh data from disk
    clearRuntimeAuthProfileStoreSnapshots();

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function clearGoogleCredentials(agentDir?: string): { success: boolean; error?: string } {
  try {
    const store = loadAuthProfileStoreForSecretsRuntime(agentDir);
    const profiles = Object.entries(store.profiles).filter(
      ([, cred]) => cred.provider === GOOGLE_WORKSPACE_PROVIDER,
    );

    if (profiles.length === 0) {
      return { success: true };
    }

    for (const [profileId] of profiles) {
      delete store.profiles[profileId];
    }

    const storeDir = agentDir ?? path.join(os.homedir(), ".openclaw", "agents", "main", "agent");
    const storePath = path.join(storeDir, "auth-profiles.json");
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));

    // Clear runtime cache so subsequent reads get fresh data from disk
    clearRuntimeAuthProfileStoreSnapshots();

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const integrationsHandlers: GatewayRequestHandlers = {
  "integrations.google.status": async ({ respond }) => {
    console.log("[integrations] google.status called");
    const status = loadGoogleStatus();
    console.log("[integrations] google.status result:", status);
    respond(true, status);
  },

  "integrations.google.save": async ({ params, respond }) => {
    console.log("[integrations] google.save called with params:", {
      hasAccessToken: !!params.accessToken,
      hasRefreshToken: !!params.refreshToken,
      expiresIn: params.expiresIn,
      email: params.email,
      scopesCount: (params.scopes as string[] | undefined)?.length,
    });

    const accessToken = params.accessToken as string | undefined;
    const refreshToken = params.refreshToken as string | undefined;
    const expiresIn = params.expiresIn as number | undefined;
    const scopes = params.scopes as string[] | undefined;
    const email = params.email as string | undefined;

    if (!accessToken || typeof expiresIn !== "number") {
      console.error("[integrations] google.save validation failed");
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "accessToken and expiresIn are required"),
      );
      return;
    }

    const result = saveGoogleCredentials({
      accessToken,
      refreshToken,
      expiresIn,
      scopes,
      email,
    });

    console.log("[integrations] google.save result:", result);

    if (result.success) {
      respond(true, { success: true });
    } else {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, result.error ?? "Failed to save credentials"),
      );
    }
  },

  "integrations.google.logout": async ({ respond }) => {
    const result = clearGoogleCredentials();

    if (result.success) {
      respond(true, { success: true });
    } else {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, result.error ?? "Failed to clear credentials"),
      );
    }
  },
};
