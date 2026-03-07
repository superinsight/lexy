export {
  loginGoogleWorkspace,
  refreshGoogleWorkspaceToken,
  resolveGoogleOAuthConfig,
} from "./oauth.js";
export {
  createGoogleWorkspaceClient,
  type CalendarClient,
  type CalendarEvent,
  type CalendarListEntry,
  type CreateClientOptions,
  type DriveClient,
  type DriveFile,
  type GmailClient,
  type GmailLabel,
  type GmailMessage,
  type GmailMessageList,
  type GoogleWorkspaceClient,
} from "./client.js";
export {
  BASE_SCOPES,
  GOOGLE_WORKSPACE_SCOPES,
  type GoogleWorkspaceAuthConfig,
  type GoogleWorkspaceCredentials,
  type GoogleWorkspaceOAuthContext,
  type GoogleWorkspaceService,
} from "./types.js";
