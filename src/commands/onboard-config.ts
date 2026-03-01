import type { OpenClawConfig } from "../config/config.js";
import type { DmScope } from "../config/types.base.js";

export const ONBOARDING_DEFAULT_DM_SCOPE: DmScope = "per-channel-peer";

export function applyOnboardingLocalWorkspaceConfig(
  baseConfig: OpenClawConfig,
  workspaceDir: string,
): OpenClawConfig {
  return {
    ...baseConfig,
    agents: {
      ...baseConfig.agents,
      defaults: {
        ...baseConfig.agents?.defaults,
        workspace: workspaceDir,
      },
    },
    gateway: {
      ...baseConfig.gateway,
      mode: "local",
    },
    session: {
      ...baseConfig.session,
      dmScope: baseConfig.session?.dmScope ?? ONBOARDING_DEFAULT_DM_SCOPE,
    },
    tools: {
      ...baseConfig.tools,
      web: {
        ...baseConfig.tools?.web,
        search: {
          ...baseConfig.tools?.web?.search,
          enabled: baseConfig.tools?.web?.search?.enabled ?? false,
        },
        fetch: {
          ...baseConfig.tools?.web?.fetch,
          enabled: baseConfig.tools?.web?.fetch?.enabled ?? false,
        },
      },
    },
    browser: {
      ...baseConfig.browser,
      enabled: baseConfig.browser?.enabled ?? false,
    },
  };
}
