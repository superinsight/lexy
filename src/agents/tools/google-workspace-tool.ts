import { Type } from "@sinclair/typebox";
import { loadAuthProfileStoreForSecretsRuntime } from "../auth-profiles.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const GOOGLE_WORKSPACE_PROVIDER = "google-workspace";

type GoogleWorkspaceCredentials = {
  access: string;
  refresh: string;
  expires: number;
  email?: string;
};

type GoogleWorkspaceConfig = {
  clientId?: string;
  clientSecret?: string;
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

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

function resolveGoogleOAuthConfig(): GoogleWorkspaceConfig {
  return {
    clientId: resolveEnv(CLIENT_ID_ENV_KEYS),
    clientSecret: resolveEnv(CLIENT_SECRET_ENV_KEYS),
  };
}

function loadGoogleWorkspaceCredentials(agentDir?: string): GoogleWorkspaceCredentials | null {
  try {
    const store = loadAuthProfileStoreForSecretsRuntime(agentDir);
    const profiles = Object.entries(store.profiles).filter(
      ([, cred]) => cred.provider === GOOGLE_WORKSPACE_PROVIDER && cred.type === "oauth",
    );

    if (profiles.length === 0) {
      return null;
    }

    const [, cred] = profiles[0];
    if (cred.type !== "oauth") {
      return null;
    }

    return {
      access: cred.access,
      refresh: cred.refresh,
      expires: cred.expires,
      email: cred.email,
    };
  } catch {
    return null;
  }
}

async function refreshAccessToken(
  config: GoogleWorkspaceConfig,
  refreshToken: string,
): Promise<{ access: string; expires: number }> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  if (config.clientId) {
    body.set("client_id", config.clientId);
  }
  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret);
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  return {
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}

let cachedAccessToken: { token: string; expires: number } | null = null;

async function getValidAccessToken(agentDir?: string): Promise<string> {
  const creds = loadGoogleWorkspaceCredentials(agentDir);
  if (!creds) {
    throw new Error("Google Workspace not authenticated. Run: openclaw integrations google auth");
  }

  const now = Date.now();
  const bufferMs = 5 * 60 * 1000;

  if (cachedAccessToken && cachedAccessToken.expires > now + bufferMs) {
    return cachedAccessToken.token;
  }

  if (creds.expires > now + bufferMs) {
    cachedAccessToken = { token: creds.access, expires: creds.expires };
    return creds.access;
  }

  const config = resolveGoogleOAuthConfig();
  const refreshed = await refreshAccessToken(config, creds.refresh);
  cachedAccessToken = { token: refreshed.access, expires: refreshed.expires };
  return refreshed.access;
}

async function fetchWithAuth(
  url: string,
  agentDir?: string,
  init?: RequestInit,
): Promise<Response> {
  const accessToken = await getValidAccessToken(agentDir);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed (${response.status}): ${errorText}`);
  }

  return response;
}

const GmailListSchema = Type.Object({
  action: Type.Literal("gmail_list"),
  max_results: Type.Optional(
    Type.Number({
      description: "Maximum number of messages to return (default: 10)",
      minimum: 1,
      maximum: 50,
    }),
  ),
  query: Type.Optional(
    Type.String({
      description:
        "Gmail search query (e.g., 'from:john@example.com', 'is:unread', 'subject:meeting')",
    }),
  ),
  label: Type.Optional(
    Type.String({ description: "Label to filter by (e.g., 'INBOX', 'SENT', 'STARRED')" }),
  ),
});

const GmailReadSchema = Type.Object({
  action: Type.Literal("gmail_read"),
  message_id: Type.String({ description: "The Gmail message ID to read" }),
});

const GmailSendSchema = Type.Object({
  action: Type.Literal("gmail_send"),
  to: Type.String({ description: "Recipient email address" }),
  subject: Type.String({ description: "Email subject line" }),
  body: Type.String({ description: "Email body content (plain text)" }),
  cc: Type.Optional(Type.String({ description: "CC recipients (comma-separated)" })),
  bcc: Type.Optional(Type.String({ description: "BCC recipients (comma-separated)" })),
});

const GmailTrashSchema = Type.Object({
  action: Type.Literal("gmail_trash"),
  message_id: Type.String({ description: "The Gmail message ID to move to trash" }),
});

const GmailModifyLabelsSchema = Type.Object({
  action: Type.Literal("gmail_modify_labels"),
  message_id: Type.String({ description: "The Gmail message ID to modify" }),
  add_labels: Type.Optional(
    Type.Array(Type.String(), { description: "Labels to add (e.g., ['STARRED', 'IMPORTANT'])" }),
  ),
  remove_labels: Type.Optional(
    Type.Array(Type.String(), { description: "Labels to remove (e.g., ['UNREAD'])" }),
  ),
});

const CalendarListSchema = Type.Object({
  action: Type.Literal("calendar_list_events"),
  calendar_id: Type.Optional(Type.String({ description: "Calendar ID (default: 'primary')" })),
  max_results: Type.Optional(
    Type.Number({
      description: "Maximum number of events to return (default: 10)",
      minimum: 1,
      maximum: 50,
    }),
  ),
  time_min: Type.Optional(Type.String({ description: "Start time in ISO format (default: now)" })),
  time_max: Type.Optional(Type.String({ description: "End time in ISO format" })),
  query: Type.Optional(Type.String({ description: "Search query for events" })),
});

const CalendarListCalendarsSchema = Type.Object({
  action: Type.Literal("calendar_list_calendars"),
});

const CalendarCreateEventSchema = Type.Object({
  action: Type.Literal("calendar_create_event"),
  calendar_id: Type.Optional(Type.String({ description: "Calendar ID (default: 'primary')" })),
  summary: Type.String({ description: "Event title" }),
  description: Type.Optional(Type.String({ description: "Event description" })),
  start_time: Type.String({
    description: "Start time in ISO format (e.g., '2024-01-15T10:00:00-05:00')",
  }),
  end_time: Type.String({ description: "End time in ISO format" }),
  attendees: Type.Optional(Type.Array(Type.String(), { description: "Attendee email addresses" })),
  location: Type.Optional(Type.String({ description: "Event location" })),
});

const CalendarDeleteEventSchema = Type.Object({
  action: Type.Literal("calendar_delete_event"),
  calendar_id: Type.Optional(Type.String({ description: "Calendar ID (default: 'primary')" })),
  event_id: Type.String({ description: "The event ID to delete" }),
});

const DriveListSchema = Type.Object({
  action: Type.Literal("drive_list"),
  max_results: Type.Optional(
    Type.Number({
      description: "Maximum number of files to return (default: 10)",
      minimum: 1,
      maximum: 50,
    }),
  ),
  query: Type.Optional(Type.String({ description: "Search query (e.g., 'name contains report')" })),
});

const DriveSearchSchema = Type.Object({
  action: Type.Literal("drive_search"),
  query: Type.String({ description: "Full-text search query" }),
  max_results: Type.Optional(
    Type.Number({
      description: "Maximum number of files to return (default: 10)",
      minimum: 1,
      maximum: 50,
    }),
  ),
});

const DriveReadSchema = Type.Object({
  action: Type.Literal("drive_read"),
  file_id: Type.String({ description: "The Drive file ID to read" }),
});

const GoogleWorkspaceSchema = Type.Union([
  GmailListSchema,
  GmailReadSchema,
  GmailSendSchema,
  GmailTrashSchema,
  GmailModifyLabelsSchema,
  CalendarListSchema,
  CalendarListCalendarsSchema,
  CalendarCreateEventSchema,
  CalendarDeleteEventSchema,
  DriveListSchema,
  DriveSearchSchema,
  DriveReadSchema,
]);

type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    body?: { data?: string; size: number };
    parts?: Array<{ mimeType: string; body?: { data?: string } }>;
  };
  internalDate?: string;
};

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function extractEmailBody(message: GmailMessage): string {
  const payload = message.payload;
  if (!payload) {
    return message.snippet || "";
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
  }

  return message.snippet || "";
}

function extractHeader(message: GmailMessage, name: string): string | undefined {
  const headers = message.payload?.headers ?? [];
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value;
}

async function handleGmailList(
  params: Record<string, unknown>,
  agentDir?: string,
): Promise<Record<string, unknown>> {
  const maxResults = readNumberParam(params, "max_results", { integer: true }) ?? 10;
  const query = readStringParam(params, "query");
  const label = readStringParam(params, "label");

  const searchParams = new URLSearchParams();
  searchParams.set("maxResults", String(maxResults));
  if (query) {
    searchParams.set("q", query);
  }
  if (label) {
    searchParams.append("labelIds", label);
  }

  const url = `${GMAIL_API_BASE}/users/me/messages?${searchParams.toString()}`;
  const response = await fetchWithAuth(url, agentDir);
  const data = (await response.json()) as {
    messages?: Array<{ id: string; threadId: string }>;
    resultSizeEstimate?: number;
  };

  if (!data.messages?.length) {
    return { messages: [], count: 0 };
  }

  const messages = await Promise.all(
    data.messages.slice(0, maxResults).map(async (msg) => {
      const msgUrl = `${GMAIL_API_BASE}/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`;
      const msgResponse = await fetchWithAuth(msgUrl, agentDir);
      const msgData = (await msgResponse.json()) as GmailMessage;
      return {
        id: msgData.id,
        threadId: msgData.threadId,
        from: extractHeader(msgData, "From"),
        subject: extractHeader(msgData, "Subject"),
        date: extractHeader(msgData, "Date"),
        snippet: msgData.snippet,
        labels: msgData.labelIds,
      };
    }),
  );

  return { messages, count: messages.length };
}

async function handleGmailRead(
  params: Record<string, unknown>,
  agentDir?: string,
): Promise<Record<string, unknown>> {
  const messageId = readStringParam(params, "message_id", { required: true });
  const url = `${GMAIL_API_BASE}/users/me/messages/${messageId}?format=full`;
  const response = await fetchWithAuth(url, agentDir);
  const message = (await response.json()) as GmailMessage;

  return {
    id: message.id,
    threadId: message.threadId,
    from: extractHeader(message, "From"),
    to: extractHeader(message, "To"),
    subject: extractHeader(message, "Subject"),
    date: extractHeader(message, "Date"),
    body: extractEmailBody(message),
    labels: message.labelIds,
  };
}

function encodeBase64Url(str: string): string {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildRawEmail(options: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}): string {
  const lines: string[] = [];
  lines.push(`To: ${options.to}`);
  if (options.cc) {
    lines.push(`Cc: ${options.cc}`);
  }
  if (options.bcc) {
    lines.push(`Bcc: ${options.bcc}`);
  }
  lines.push(`Subject: ${options.subject}`);
  lines.push("Content-Type: text/plain; charset=UTF-8");
  lines.push("");
  lines.push(options.body);
  return lines.join("\r\n");
}

async function handleGmailSend(
  params: Record<string, unknown>,
  agentDir?: string,
): Promise<Record<string, unknown>> {
  const to = readStringParam(params, "to", { required: true });
  const subject = readStringParam(params, "subject", { required: true });
  const body = readStringParam(params, "body", { required: true });
  const cc = readStringParam(params, "cc");
  const bcc = readStringParam(params, "bcc");

  const rawEmail = buildRawEmail({ to, subject, body, cc, bcc });
  const encodedEmail = encodeBase64Url(rawEmail);

  const url = `${GMAIL_API_BASE}/users/me/messages/send`;
  const accessToken = await getValidAccessToken(agentDir);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encodedEmail }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send email: ${errorText}`);
  }

  const result = (await response.json()) as { id: string; threadId: string; labelIds?: string[] };

  return {
    success: true,
    message_id: result.id,
    thread_id: result.threadId,
    labels: result.labelIds,
  };
}

async function handleGmailTrash(
  params: Record<string, unknown>,
  agentDir?: string,
): Promise<Record<string, unknown>> {
  const messageId = readStringParam(params, "message_id", { required: true });

  const url = `${GMAIL_API_BASE}/users/me/messages/${messageId}/trash`;
  const accessToken = await getValidAccessToken(agentDir);
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to trash message: ${errorText}`);
  }

  return { success: true, message_id: messageId, action: "trashed" };
}

async function handleGmailModifyLabels(
  params: Record<string, unknown>,
  agentDir?: string,
): Promise<Record<string, unknown>> {
  const messageId = readStringParam(params, "message_id", { required: true });
  const addLabels = params.add_labels as string[] | undefined;
  const removeLabels = params.remove_labels as string[] | undefined;

  if (!addLabels?.length && !removeLabels?.length) {
    return { error: "validation_error", message: "Must specify add_labels or remove_labels" };
  }

  const url = `${GMAIL_API_BASE}/users/me/messages/${messageId}/modify`;
  const accessToken = await getValidAccessToken(agentDir);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      addLabelIds: addLabels ?? [],
      removeLabelIds: removeLabels ?? [],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to modify labels: ${errorText}`);
  }

  const result = (await response.json()) as { id: string; labelIds?: string[] };

  return {
    success: true,
    message_id: result.id,
    labels: result.labelIds,
    added: addLabels ?? [],
    removed: removeLabels ?? [],
  };
}

async function handleCalendarListEvents(
  params: Record<string, unknown>,
  agentDir?: string,
): Promise<Record<string, unknown>> {
  const calendarId = readStringParam(params, "calendar_id") ?? "primary";
  const maxResults = readNumberParam(params, "max_results", { integer: true }) ?? 10;
  const timeMin = readStringParam(params, "time_min") ?? new Date().toISOString();
  const timeMax = readStringParam(params, "time_max");
  const query = readStringParam(params, "query");

  const searchParams = new URLSearchParams();
  searchParams.set("maxResults", String(maxResults));
  searchParams.set("timeMin", timeMin);
  searchParams.set("singleEvents", "true");
  searchParams.set("orderBy", "startTime");
  if (timeMax) {
    searchParams.set("timeMax", timeMax);
  }
  if (query) {
    searchParams.set("q", query);
  }

  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${searchParams.toString()}`;
  const response = await fetchWithAuth(url, agentDir);
  const data = (await response.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      description?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      attendees?: Array<{ email: string; responseStatus?: string }>;
      htmlLink?: string;
      status?: string;
    }>;
  };

  const events = (data.items ?? []).map((event) => ({
    id: event.id,
    summary: event.summary,
    description: event.description,
    start: event.start?.dateTime ?? event.start?.date,
    end: event.end?.dateTime ?? event.end?.date,
    attendees: event.attendees?.map((a) => ({ email: a.email, status: a.responseStatus })),
    link: event.htmlLink,
    status: event.status,
  }));

  return { events, count: events.length };
}

async function handleCalendarListCalendars(agentDir?: string): Promise<Record<string, unknown>> {
  const url = `${CALENDAR_API_BASE}/users/me/calendarList`;
  const response = await fetchWithAuth(url, agentDir);
  const data = (await response.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      description?: string;
      primary?: boolean;
      accessRole?: string;
    }>;
  };

  const calendars = (data.items ?? []).map((cal) => ({
    id: cal.id,
    name: cal.summary,
    description: cal.description,
    primary: cal.primary,
    accessRole: cal.accessRole,
  }));

  return { calendars, count: calendars.length };
}

async function handleCalendarCreateEvent(
  params: Record<string, unknown>,
  agentDir?: string,
): Promise<Record<string, unknown>> {
  const calendarId = readStringParam(params, "calendar_id") ?? "primary";
  const summary = readStringParam(params, "summary", { required: true });
  const description = readStringParam(params, "description");
  const startTime = readStringParam(params, "start_time", { required: true });
  const endTime = readStringParam(params, "end_time", { required: true });
  const attendees = params.attendees as string[] | undefined;
  const location = readStringParam(params, "location");

  const eventBody: Record<string, unknown> = {
    summary,
    start: { dateTime: startTime },
    end: { dateTime: endTime },
  };

  if (description) {
    eventBody.description = description;
  }
  if (location) {
    eventBody.location = location;
  }
  if (attendees?.length) {
    eventBody.attendees = attendees.map((email) => ({ email }));
  }

  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
  const accessToken = await getValidAccessToken(agentDir);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(eventBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create event: ${errorText}`);
  }

  const result = (await response.json()) as {
    id: string;
    summary?: string;
    htmlLink?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
  };

  return {
    success: true,
    event_id: result.id,
    summary: result.summary,
    start: result.start?.dateTime,
    end: result.end?.dateTime,
    link: result.htmlLink,
  };
}

async function handleCalendarDeleteEvent(
  params: Record<string, unknown>,
  agentDir?: string,
): Promise<Record<string, unknown>> {
  const calendarId = readStringParam(params, "calendar_id") ?? "primary";
  const eventId = readStringParam(params, "event_id", { required: true });

  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const accessToken = await getValidAccessToken(agentDir);
  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to delete event: ${errorText}`);
  }

  return { success: true, event_id: eventId, action: "deleted" };
}

async function handleDriveList(
  params: Record<string, unknown>,
  agentDir?: string,
): Promise<Record<string, unknown>> {
  const maxResults = readNumberParam(params, "max_results", { integer: true }) ?? 10;
  const query = readStringParam(params, "query");

  const searchParams = new URLSearchParams();
  searchParams.set("pageSize", String(maxResults));
  searchParams.set(
    "fields",
    "files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink)",
  );
  if (query) {
    searchParams.set("q", query);
  }

  const url = `${DRIVE_API_BASE}/files?${searchParams.toString()}`;
  const response = await fetchWithAuth(url, agentDir);
  const data = (await response.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      createdTime?: string;
      modifiedTime?: string;
      webViewLink?: string;
      webContentLink?: string;
    }>;
  };

  const files = (data.files ?? []).map((file) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    created: file.createdTime,
    modified: file.modifiedTime,
    viewLink: file.webViewLink,
    downloadLink: file.webContentLink,
  }));

  return { files, count: files.length };
}

async function handleDriveSearch(
  params: Record<string, unknown>,
  agentDir?: string,
): Promise<Record<string, unknown>> {
  const searchQuery = readStringParam(params, "query", { required: true });
  const maxResults = readNumberParam(params, "max_results", { integer: true }) ?? 10;

  const escapedQuery = searchQuery.replace(/'/g, "\\'");
  const driveQuery = `fullText contains '${escapedQuery}'`;

  return handleDriveList({ ...params, query: driveQuery, max_results: maxResults }, agentDir);
}

async function handleDriveRead(
  params: Record<string, unknown>,
  agentDir?: string,
): Promise<Record<string, unknown>> {
  const fileId = readStringParam(params, "file_id", { required: true });

  const metaUrl = `${DRIVE_API_BASE}/files/${fileId}?fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink`;
  const metaResponse = await fetchWithAuth(metaUrl, agentDir);
  const metadata = (await metaResponse.json()) as {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    createdTime?: string;
    modifiedTime?: string;
    webViewLink?: string;
  };

  const isGoogleDoc = metadata.mimeType.startsWith("application/vnd.google-apps.");
  let content: string | undefined;

  if (isGoogleDoc) {
    const exportMimeType =
      metadata.mimeType === "application/vnd.google-apps.spreadsheet" ? "text/csv" : "text/plain";
    const exportUrl = `${DRIVE_API_BASE}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`;
    try {
      const exportResponse = await fetchWithAuth(exportUrl, agentDir);
      content = await exportResponse.text();
    } catch {
      content = "[Content export failed - file may be too large or restricted]";
    }
  }

  return {
    id: metadata.id,
    name: metadata.name,
    mimeType: metadata.mimeType,
    size: metadata.size,
    created: metadata.createdTime,
    modified: metadata.modifiedTime,
    viewLink: metadata.webViewLink,
    ...(content ? { content } : {}),
  };
}

export function createGoogleWorkspaceTool(options?: { agentDir?: string }): AnyAgentTool {
  const agentDir = options?.agentDir;

  return {
    label: "Google Workspace",
    name: "google_workspace",
    description: `Access Google Workspace services (Gmail, Calendar, Drive). Available actions:
- gmail_list: List recent emails with optional search query
- gmail_read: Read a specific email by message ID
- gmail_send: Send a new email
- gmail_trash: Move an email to trash
- gmail_modify_labels: Add/remove labels (e.g., mark as read by removing UNREAD, star by adding STARRED)
- calendar_list_events: List upcoming calendar events
- calendar_list_calendars: List available calendars
- calendar_create_event: Create a new calendar event
- calendar_delete_event: Delete a calendar event
- drive_list: List files in Google Drive
- drive_search: Search files by content
- drive_read: Read file metadata and content (exports Google Docs to text)`,
    parameters: GoogleWorkspaceSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        switch (action) {
          case "gmail_list":
            return jsonResult(await handleGmailList(params, agentDir));
          case "gmail_read":
            return jsonResult(await handleGmailRead(params, agentDir));
          case "gmail_send":
            return jsonResult(await handleGmailSend(params, agentDir));
          case "gmail_trash":
            return jsonResult(await handleGmailTrash(params, agentDir));
          case "gmail_modify_labels":
            return jsonResult(await handleGmailModifyLabels(params, agentDir));
          case "calendar_list_events":
            return jsonResult(await handleCalendarListEvents(params, agentDir));
          case "calendar_list_calendars":
            return jsonResult(await handleCalendarListCalendars(agentDir));
          case "calendar_create_event":
            return jsonResult(await handleCalendarCreateEvent(params, agentDir));
          case "calendar_delete_event":
            return jsonResult(await handleCalendarDeleteEvent(params, agentDir));
          case "drive_list":
            return jsonResult(await handleDriveList(params, agentDir));
          case "drive_search":
            return jsonResult(await handleDriveSearch(params, agentDir));
          case "drive_read":
            return jsonResult(await handleDriveRead(params, agentDir));
          default:
            return jsonResult({
              error: "invalid_action",
              message: `Unknown action: ${action}. Valid actions: gmail_list, gmail_read, gmail_send, gmail_trash, gmail_modify_labels, calendar_list_events, calendar_list_calendars, calendar_create_event, calendar_delete_event, drive_list, drive_search, drive_read`,
            });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ error: "google_workspace_error", message });
      }
    },
  };
}
