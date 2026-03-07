export type GoogleWorkspaceCredentials = {
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  scopes: string[];
};

export type GoogleWorkspaceOAuthContext = {
  isRemote: boolean;
  openUrl: (url: string) => Promise<void>;
  log: (msg: string) => void;
  note: (message: string, title?: string) => Promise<void>;
  prompt: (message: string) => Promise<string>;
  progress: { update: (msg: string) => void; stop: (msg?: string) => void };
};

export type GoogleWorkspaceService = "gmail" | "calendar" | "drive" | "contacts" | "tasks";

export const GOOGLE_WORKSPACE_SCOPES: Record<GoogleWorkspaceService, string[]> = {
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
  calendar: [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  drive: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ],
  contacts: ["https://www.googleapis.com/auth/contacts.readonly"],
  tasks: [
    "https://www.googleapis.com/auth/tasks.readonly",
    "https://www.googleapis.com/auth/tasks",
  ],
};

export const BASE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];

export type GoogleWorkspaceAuthConfig = {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  services?: GoogleWorkspaceService[];
};
