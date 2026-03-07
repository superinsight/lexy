import { refreshGoogleWorkspaceToken, resolveGoogleOAuthConfig } from "./oauth.js";
import type { GoogleWorkspaceAuthConfig, GoogleWorkspaceCredentials } from "./types.js";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

export type GoogleWorkspaceClient = {
  credentials: GoogleWorkspaceCredentials;
  getAccessToken: () => Promise<string>;
  gmail: GmailClient;
  calendar: CalendarClient;
  drive: DriveClient;
};

export type GmailClient = {
  listMessages: (params?: {
    maxResults?: number;
    q?: string;
    labelIds?: string[];
  }) => Promise<GmailMessageList>;
  getMessage: (id: string) => Promise<GmailMessage>;
  listLabels: () => Promise<GmailLabel[]>;
  sendMessage: (params: { to: string; subject: string; body: string }) => Promise<GmailMessage>;
};

export type CalendarClient = {
  listCalendars: () => Promise<CalendarListEntry[]>;
  listEvents: (
    calendarId: string,
    params?: {
      maxResults?: number;
      timeMin?: string;
      timeMax?: string;
      q?: string;
    },
  ) => Promise<CalendarEvent[]>;
  getEvent: (calendarId: string, eventId: string) => Promise<CalendarEvent>;
  createEvent: (
    calendarId: string,
    event: {
      summary: string;
      description?: string;
      start: { dateTime: string; timeZone?: string };
      end: { dateTime: string; timeZone?: string };
      attendees?: { email: string }[];
    },
  ) => Promise<CalendarEvent>;
};

export type DriveClient = {
  listFiles: (params?: {
    maxResults?: number;
    q?: string;
    orderBy?: string;
  }) => Promise<DriveFile[]>;
  getFile: (fileId: string) => Promise<DriveFile>;
  downloadFile: (fileId: string) => Promise<ArrayBuffer>;
  searchFiles: (query: string, maxResults?: number) => Promise<DriveFile[]>;
};

export type GmailMessageList = {
  messages: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate: number;
};

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    body?: { data?: string; size: number };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string; size: number };
    }>;
  };
  internalDate: string;
};

export type GmailLabel = {
  id: string;
  name: string;
  type: string;
};

export type CalendarListEntry = {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  accessRole: string;
};

export type CalendarEvent = {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string; responseStatus?: string }>;
  organizer?: { email: string };
  status: string;
  htmlLink: string;
};

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
  webContentLink?: string;
  parents?: string[];
};

async function fetchWithAuth(
  url: string,
  accessToken: string,
  init?: RequestInit,
): Promise<Response> {
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

function createGmailClient(getAccessToken: () => Promise<string>): GmailClient {
  return {
    async listMessages(params) {
      const token = await getAccessToken();
      const searchParams = new URLSearchParams();
      if (params?.maxResults) {
        searchParams.set("maxResults", String(params.maxResults));
      }
      if (params?.q) {
        searchParams.set("q", params.q);
      }
      if (params?.labelIds?.length) {
        for (const labelId of params.labelIds) {
          searchParams.append("labelIds", labelId);
        }
      }
      const url = `${GMAIL_API_BASE}/users/me/messages?${searchParams.toString()}`;
      const response = await fetchWithAuth(url, token);
      return (await response.json()) as GmailMessageList;
    },

    async getMessage(id) {
      const token = await getAccessToken();
      const url = `${GMAIL_API_BASE}/users/me/messages/${id}?format=full`;
      const response = await fetchWithAuth(url, token);
      return (await response.json()) as GmailMessage;
    },

    async listLabels() {
      const token = await getAccessToken();
      const url = `${GMAIL_API_BASE}/users/me/labels`;
      const response = await fetchWithAuth(url, token);
      const data = (await response.json()) as { labels: GmailLabel[] };
      return data.labels;
    },

    async sendMessage(params) {
      const token = await getAccessToken();
      const rawMessage = [
        `To: ${params.to}`,
        `Subject: ${params.subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        params.body,
      ].join("\r\n");

      const encodedMessage = Buffer.from(rawMessage)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const url = `${GMAIL_API_BASE}/users/me/messages/send`;
      const response = await fetchWithAuth(url, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: encodedMessage }),
      });
      return (await response.json()) as GmailMessage;
    },
  };
}

function createCalendarClient(getAccessToken: () => Promise<string>): CalendarClient {
  return {
    async listCalendars() {
      const token = await getAccessToken();
      const url = `${CALENDAR_API_BASE}/users/me/calendarList`;
      const response = await fetchWithAuth(url, token);
      const data = (await response.json()) as { items: CalendarListEntry[] };
      return data.items;
    },

    async listEvents(calendarId, params) {
      const token = await getAccessToken();
      const searchParams = new URLSearchParams();
      if (params?.maxResults) {
        searchParams.set("maxResults", String(params.maxResults));
      }
      if (params?.timeMin) {
        searchParams.set("timeMin", params.timeMin);
      }
      if (params?.timeMax) {
        searchParams.set("timeMax", params.timeMax);
      }
      if (params?.q) {
        searchParams.set("q", params.q);
      }
      searchParams.set("singleEvents", "true");
      searchParams.set("orderBy", "startTime");

      const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${searchParams.toString()}`;
      const response = await fetchWithAuth(url, token);
      const data = (await response.json()) as { items: CalendarEvent[] };
      return data.items ?? [];
    },

    async getEvent(calendarId, eventId) {
      const token = await getAccessToken();
      const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`;
      const response = await fetchWithAuth(url, token);
      return (await response.json()) as CalendarEvent;
    },

    async createEvent(calendarId, event) {
      const token = await getAccessToken();
      const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
      const response = await fetchWithAuth(url, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
      return (await response.json()) as CalendarEvent;
    },
  };
}

function createDriveClient(getAccessToken: () => Promise<string>): DriveClient {
  return {
    async listFiles(params) {
      const token = await getAccessToken();
      const searchParams = new URLSearchParams();
      searchParams.set(
        "fields",
        "files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,parents)",
      );
      if (params?.maxResults) {
        searchParams.set("pageSize", String(params.maxResults));
      }
      if (params?.q) {
        searchParams.set("q", params.q);
      }
      if (params?.orderBy) {
        searchParams.set("orderBy", params.orderBy);
      }

      const url = `${DRIVE_API_BASE}/files?${searchParams.toString()}`;
      const response = await fetchWithAuth(url, token);
      const data = (await response.json()) as { files: DriveFile[] };
      return data.files ?? [];
    },

    async getFile(fileId) {
      const token = await getAccessToken();
      const url = `${DRIVE_API_BASE}/files/${fileId}?fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,parents`;
      const response = await fetchWithAuth(url, token);
      return (await response.json()) as DriveFile;
    },

    async downloadFile(fileId) {
      const token = await getAccessToken();
      const url = `${DRIVE_API_BASE}/files/${fileId}?alt=media`;
      const response = await fetchWithAuth(url, token);
      return await response.arrayBuffer();
    },

    async searchFiles(query, maxResults = 20) {
      return this.listFiles({
        q: `fullText contains '${query.replace(/'/g, "\\'")}'`,
        maxResults,
      });
    },
  };
}

export type CreateClientOptions = {
  credentials: GoogleWorkspaceCredentials;
  config?: Partial<GoogleWorkspaceAuthConfig>;
  onTokenRefresh?: (newCredentials: GoogleWorkspaceCredentials) => void | Promise<void>;
};

export function createGoogleWorkspaceClient(options: CreateClientOptions): GoogleWorkspaceClient {
  let currentCredentials = options.credentials;
  const config = resolveGoogleOAuthConfig(options.config);

  const getAccessToken = async (): Promise<string> => {
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000;

    if (currentCredentials.expires > now + bufferMs) {
      return currentCredentials.access;
    }

    const refreshed = await refreshGoogleWorkspaceToken(
      config,
      currentCredentials.refresh,
      currentCredentials.scopes,
    );
    currentCredentials = refreshed;

    if (options.onTokenRefresh) {
      await options.onTokenRefresh(refreshed);
    }

    return refreshed.access;
  };

  return {
    credentials: currentCredentials,
    getAccessToken,
    gmail: createGmailClient(getAccessToken),
    calendar: createCalendarClient(getAccessToken),
    drive: createDriveClient(getAccessToken),
  };
}
