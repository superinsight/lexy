import { spinner as createSpinner, text } from "@clack/prompts";
import type { Command } from "commander";
import type { GoogleWorkspaceService } from "../../lexy/integrations/google-workspace/types.js";
import { resolveOpenClawAgentDir } from "../agents/agent-paths.js";
import { upsertAuthProfile } from "../agents/auth-profiles.js";
import { openUrl } from "../commands/onboard-helpers.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { theme } from "../terminal/theme.js";

const GOOGLE_WORKSPACE_PROVIDER = "google-workspace";

type GoogleWorkspaceLoginResult = {
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  scopes: string[];
};

async function runGoogleWorkspaceAuth(
  services: GoogleWorkspaceService[],
  runtime: RuntimeEnv,
): Promise<GoogleWorkspaceLoginResult> {
  const { loginGoogleWorkspace } =
    await import("../../lexy/integrations/google-workspace/oauth.js");

  const spin = createSpinner();
  spin.start("Starting Google Workspace authentication...");
  let isSpinnerActive = true;

  const note = async (message: string, title?: string): Promise<void> => {
    if (isSpinnerActive) {
      spin.stop();
      isSpinnerActive = false;
    }
    if (title) {
      runtime.log(`\n${theme.heading(title)}\n`);
    }
    runtime.log(message);
  };

  const prompt = async (message: string): Promise<string> => {
    if (isSpinnerActive) {
      spin.stop();
      isSpinnerActive = false;
    }
    const result = await text({
      message,
      validate: (val) => (val && val.trim().length > 0 ? undefined : "Required"),
    });
    if (typeof result !== "string") {
      throw new Error("Authentication cancelled");
    }
    return result;
  };

  const progress = {
    update: (msg: string) => {
      if (!isSpinnerActive) {
        spin.start(msg);
        isSpinnerActive = true;
      }
      spin.message(msg);
    },
    stop: (msg?: string) => {
      if (isSpinnerActive) {
        spin.stop(msg);
        isSpinnerActive = false;
      }
    },
  };

  try {
    const creds = await loginGoogleWorkspace(
      {
        isRemote: Boolean(process.env.SSH_TTY || process.env.SSH_CLIENT),
        openUrl: async (url: string) => {
          await openUrl(url);
        },
        log: (msg: string) => runtime.log(msg),
        note,
        prompt,
        progress,
      },
      { services },
    );

    progress.stop("Authentication successful");
    return creds;
  } finally {
    if (isSpinnerActive) {
      spin.stop();
    }
  }
}

function saveGoogleWorkspaceCredentials(
  creds: GoogleWorkspaceLoginResult,
  agentDir?: string,
): string {
  const email =
    typeof creds.email === "string" && creds.email.trim() ? creds.email.trim() : "default";
  const profileId = `${GOOGLE_WORKSPACE_PROVIDER}:${email}`;
  const resolvedAgentDir = agentDir ?? resolveOpenClawAgentDir();

  upsertAuthProfile({
    profileId,
    credential: {
      type: "oauth",
      provider: GOOGLE_WORKSPACE_PROVIDER,
      access: creds.access,
      refresh: creds.refresh,
      expires: creds.expires,
      email: creds.email,
    },
    agentDir: resolvedAgentDir,
  });

  return profileId;
}

export function registerIntegrationsCli(program: Command): void {
  const integrationsCmd = program
    .command("integrations")
    .description("Manage third-party integrations (Google Workspace, etc.)");

  const googleCmd = integrationsCmd.command("google").description("Google Workspace integration");

  googleCmd
    .command("auth")
    .description("Authenticate with Google to access Gmail, Calendar, and Drive")
    .option("--gmail", "Include Gmail access")
    .option("--calendar", "Include Calendar access")
    .option("--drive", "Include Drive access")
    .option("--all", "Include all services (Gmail, Calendar, Drive)")
    .action(async (options) => {
      const runtime = defaultRuntime;

      const services: GoogleWorkspaceService[] = [];
      if (options.all) {
        services.push("gmail", "calendar", "drive");
      } else {
        if (options.gmail) {
          services.push("gmail");
        }
        if (options.calendar) {
          services.push("calendar");
        }
        if (options.drive) {
          services.push("drive");
        }
        if (services.length === 0) {
          services.push("gmail", "calendar", "drive");
        }
      }

      runtime.log(`\n${theme.heading("Google Workspace Authentication")}`);
      runtime.log(`Services: ${services.join(", ")}\n`);

      try {
        const creds = await runGoogleWorkspaceAuth(services, runtime);
        const profileId = saveGoogleWorkspaceCredentials(creds);

        runtime.log(
          `\n${theme.success("✓")} Authenticated as: ${theme.heading(creds.email ?? "unknown")}`,
        );
        runtime.log(`  Profile ID: ${profileId}`);
        runtime.log(`  Services: ${services.join(", ")}`);
        runtime.log(`\nYour credentials have been saved and Lexy can now access your Google data.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        runtime.error(`\n${theme.error("✗")} Authentication failed: ${message}`);
        process.exit(1);
      }
    });

  googleCmd
    .command("status")
    .description("Check Google Workspace authentication status")
    .action(async () => {
      const runtime = defaultRuntime;
      const { loadAuthProfileStore } = await import("../agents/auth-profiles/store.js");

      try {
        const store = loadAuthProfileStore();
        const googleProfiles = Object.entries(store.profiles).filter(
          ([, cred]) => cred.provider === GOOGLE_WORKSPACE_PROVIDER,
        );

        if (googleProfiles.length === 0) {
          runtime.log(`\n${theme.warn("!")} No Google Workspace credentials found.`);
          runtime.log(
            `Run ${theme.command("openclaw integrations google auth")} to authenticate.\n`,
          );
          return;
        }

        runtime.log(`\n${theme.heading("Google Workspace Credentials")}\n`);
        for (const [profileId, cred] of googleProfiles) {
          const isOAuth = cred.type === "oauth";
          const email = cred.email ?? "unknown";
          const expires =
            isOAuth && "expires" in cred ? (cred as { expires?: number }).expires : undefined;
          const isExpired = expires ? expires < Date.now() : false;
          const status = isExpired ? theme.error("expired") : theme.success("active");

          runtime.log(`  ${theme.heading(profileId)}`);
          runtime.log(`    Email: ${email}`);
          runtime.log(`    Status: ${status}`);
          if (expires) {
            const expiresDate = new Date(expires).toLocaleString();
            runtime.log(`    Expires: ${expiresDate}`);
          }
          runtime.log("");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        runtime.error(`\n${theme.error("✗")} Failed to check status: ${message}`);
        process.exit(1);
      }
    });

  googleCmd
    .command("logout")
    .description("Remove Google Workspace credentials")
    .option("--email <email>", "Remove credentials for specific email")
    .action(async (options) => {
      const runtime = defaultRuntime;
      const { loadAuthProfileStore, saveAuthProfileStore } =
        await import("../agents/auth-profiles/store.js");

      try {
        const store = loadAuthProfileStore();
        const googleProfiles = Object.entries(store.profiles).filter(
          ([, cred]) => cred.provider === GOOGLE_WORKSPACE_PROVIDER,
        );

        if (googleProfiles.length === 0) {
          runtime.log(`\n${theme.warn("!")} No Google Workspace credentials found.\n`);
          return;
        }

        const toRemove = options.email
          ? googleProfiles.filter(([, cred]) => cred.email === options.email)
          : googleProfiles;

        if (toRemove.length === 0) {
          runtime.log(`\n${theme.warn("!")} No credentials found for ${options.email}.\n`);
          return;
        }

        for (const [profileId] of toRemove) {
          delete store.profiles[profileId];
          runtime.log(`${theme.success("✓")} Removed: ${profileId}`);
        }

        saveAuthProfileStore(store);
        runtime.log(`\n${theme.success("✓")} Google Workspace credentials removed.\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        runtime.error(`\n${theme.error("✗")} Failed to logout: ${message}`);
        process.exit(1);
      }
    });
}
