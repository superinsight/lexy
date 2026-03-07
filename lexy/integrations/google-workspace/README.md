# Google Workspace Integration

This integration allows Lexy to access your Google account data including Gmail, Calendar, and Drive.

## Prerequisites

Before using this integration, you need to set up a Google Cloud OAuth 2.0 client:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - Gmail API
   - Google Calendar API
   - Google Drive API
4. Go to "Credentials" → "Create Credentials" → "OAuth client ID"
5. Choose "Desktop app" as the application type
6. Download or copy the Client ID and Client Secret

## Configuration

Set the following environment variables:

```bash
export LEXY_GOOGLE_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com"
export LEXY_GOOGLE_OAUTH_CLIENT_SECRET="your-client-secret"  # Optional for desktop apps
```

Alternative environment variable names are also supported:

- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
- `OPENCLAW_GOOGLE_OAUTH_CLIENT_ID` / `OPENCLAW_GOOGLE_OAUTH_CLIENT_SECRET`

## Usage

### Authenticate via CLI

```bash
# Authenticate with all services (Gmail, Calendar, Drive)
openclaw integrations google auth

# Authenticate with specific services
openclaw integrations google auth --gmail --calendar

# Check authentication status
openclaw integrations google status

# Remove credentials
openclaw integrations google logout
```

### Programmatic Usage

```typescript
import {
  loginGoogleWorkspace,
  createGoogleWorkspaceClient,
  type GoogleWorkspaceCredentials,
} from "lexy/integrations/google-workspace";

// Authenticate (usually done via CLI)
const credentials = await loginGoogleWorkspace(context, {
  services: ["gmail", "calendar", "drive"],
});

// Create a client
const client = createGoogleWorkspaceClient({
  credentials,
  onTokenRefresh: async (newCredentials) => {
    // Save the new credentials
  },
});

// Use Gmail
const messages = await client.gmail.listMessages({ maxResults: 10 });
const message = await client.gmail.getMessage(messages.messages[0].id);

// Use Calendar
const calendars = await client.calendar.listCalendars();
const events = await client.calendar.listEvents("primary", {
  timeMin: new Date().toISOString(),
  maxResults: 10,
});

// Use Drive
const files = await client.drive.listFiles({ maxResults: 10 });
const searchResults = await client.drive.searchFiles("report");
```

## Agent Tool Actions

When using Lexy chat, the following `google_workspace` tool actions are available:

### Gmail (read)

- `gmail_list` - List recent emails with optional search query and label filter
- `gmail_read` - Read a specific email by message ID

### Gmail (write)

- `gmail_send` - Send a new email (to, subject, body, cc, bcc)
- `gmail_trash` - Move an email to trash
- `gmail_modify_labels` - Add/remove labels (e.g., mark as read, star, archive)

### Calendar (read)

- `calendar_list_calendars` - List available calendars
- `calendar_list_events` - List upcoming calendar events

### Calendar (write)

- `calendar_create_event` - Create a new calendar event with attendees
- `calendar_delete_event` - Delete a calendar event

### Drive (read-only)

- `drive_list` - List files in Google Drive
- `drive_search` - Search files by content
- `drive_read` - Read file metadata and content (exports Google Docs to text)

## Programmatic API

### Gmail

- `listMessages(params?)` - List messages with optional filters
- `getMessage(id)` - Get a specific message
- `listLabels()` - List all labels
- `sendMessage({ to, subject, body })` - Send an email

### Calendar

- `listCalendars()` - List all calendars
- `listEvents(calendarId, params?)` - List events with optional filters
- `getEvent(calendarId, eventId)` - Get a specific event
- `createEvent(calendarId, event)` - Create a new event

### Drive

- `listFiles(params?)` - List files with optional filters
- `getFile(fileId)` - Get file metadata
- `downloadFile(fileId)` - Download file content
- `searchFiles(query, maxResults?)` - Search files by content

## Scopes

The integration requests the following OAuth scopes based on the services you enable:

**Gmail:**

- `gmail.readonly` - Read emails
- `gmail.send` - Send emails
- `gmail.modify` - Modify emails

**Calendar:**

- `calendar.readonly` - Read calendar data
- `calendar.events` - Create and modify events

**Drive:**

- `drive.readonly` - Read files
- `drive.file` - Create and modify files

## Common Gmail Labels

When using `gmail_modify_labels`, these are the standard Gmail label IDs:

- `INBOX` - Main inbox
- `UNREAD` - Unread messages (remove to mark as read)
- `STARRED` - Starred messages
- `IMPORTANT` - Important messages
- `SPAM` - Spam folder
- `TRASH` - Trash folder
- `DRAFT` - Drafts
- `SENT` - Sent mail
- `CATEGORY_PERSONAL`, `CATEGORY_SOCIAL`, `CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS` - Category tabs

Example: To mark an email as read, remove the `UNREAD` label.

## Updating Scopes

If you previously authenticated and need access to write operations, re-authenticate:

```bash
openclaw integrations google logout
openclaw integrations google auth
```

This ensures all required scopes (including `gmail.send`, `gmail.modify`, `calendar.events`) are granted.

## Security

- Credentials are stored locally in `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`
- Tokens are automatically refreshed when expired
- Use `openclaw integrations google logout` to remove credentials
