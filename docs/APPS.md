# Connecting Office 365, WhatsApp and other apps

Max reaches apps outside your home through **Composio**, a service that handles the
sign-ins (OAuth) and exposes each app's actions to Max. You sign in once from Max's
control panel; Composio keeps the login fresh.

## Set up (10 minutes)

1. **Create a Composio account** at https://platform.composio.dev and copy your API key
   (Settings → API keys).
2. **Add it to `.env`:**
   ```
   COMPOSIO_API_KEY=...your key...
   COMPOSIO_TOOLKITS=outlook,whatsapp
   ```
3. **Restart Max:**
   ```bash
   docker compose --profile max up -d --build
   ```
4. **Open the control panel:** http://localhost:8099
5. Click **Connect** next to **Outlook** and sign in with your Office 365 account. You come
   back to the panel with "Signed in", and Outlook shows **Connected**.

Then try: *"Hey Jarvis, what's in my inbox?"*, *"What's on my calendar tomorrow?"*,
*"Email Anna to say I'll be 10 minutes late."*

## Safety: Max always asks before acting

Reading email and calendars happens straight away. Anything that **sends, replies,
forwards, deletes, accepts, cancels or creates** is never done on the first request: Max
reads the details back ("I'll email Anna saying you'll be 10 minutes late. Shall I go
ahead?") and only acts after a clear "yes". This is enforced in Max's code, not left to
the AI, so a misheard sentence can't send an email.

## Office 365 notes

- Outlook covers **email and calendar** for Office 365 / Microsoft 365.
- **Work or school accounts:** your organisation may require an administrator to approve
  Composio the first time ("Need admin approval"). Personal Microsoft accounts work directly.

## WhatsApp: read this first

- Composio's WhatsApp connection uses the **official WhatsApp Business API**. It needs a
  WhatsApp Business account and phone number set up with Meta, **not your personal
  WhatsApp**.
- Since January 2026, Meta's rules don't allow general-purpose AI assistants on the
  WhatsApp Business Platform.
- There is **no official way** to automate a personal WhatsApp account. Community tools
  that log in through WhatsApp Web exist, but they break WhatsApp's terms and the number
  can be banned. Max doesn't include one.

## Choosing which actions Max can use

Fewer actions mean faster, more accurate voice answers. Max only offers actions matching
`COMPOSIO_ALLOWED_TOOLS` (wildcards allowed), and only for apps you've connected. The
default covers reading/searching/sending email, replying, and calendar events.

The log lists what's offered, e.g.
`[MCP:composio] 7 of 64 tools offered to Max: OUTLOOK_LIST_MESSAGES, …`. If an action you
want is missing, add a pattern (e.g. `OUTLOOK_*CONTACT*`) and restart Max.

## Adding more apps

Composio supports hundreds of apps (Slack, Notion, Google, Spotify, Todoist…). Add their
names to `COMPOSIO_TOOLKITS` and suitable patterns to `COMPOSIO_ALLOWED_TOOLS`, restart,
then click **Connect** in the control panel.

## Other MCP servers

Any MCP server can be added without Composio: copy `config/mcp-servers.example.json` to
`config/mcp-servers.json`, fill in the URL and headers (`${VAR}` reads from `.env`), list
`allowedTools`, and restart. Servers appear in the control panel.

## Privacy

Composio stores the sign-in tokens for your connected apps on its servers and runs the
actions on your behalf. The control panel itself only listens on this computer
(127.0.0.1). To disconnect an app completely, remove it in your Composio dashboard.
