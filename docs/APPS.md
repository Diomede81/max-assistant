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

## Personal and work accounts

Max keeps two separate sets of app logins, so you can connect **the same app twice**: your own
Gmail or Outlook *and* your work mailbox, your personal Instagram and your work LinkedIn.

| | Used in | Apps listed (`.env`) |
| --- | --- | --- |
| **Personal accounts** | personal mode | `COMPOSIO_TOOLKITS`, e.g. `gmail,whatsapp,instagram` |
| **Work accounts** | work mode | `COMPOSIO_WORK_TOOLKITS`, e.g. `outlook,linkedin,slack` |

1. In `.env`, list the apps for each side, e.g.
   ```
   COMPOSIO_TOOLKITS=gmail,whatsapp,instagram
   COMPOSIO_WORK_TOOLKITS=outlook,linkedin,slack
   ```
   and restart Max.
2. On the control panel, **Apps** now has two lists, **Personal accounts** and **Work accounts**.
   Click **Connect** in each list and sign in with the matching account (in the work list, sign in
   with your work login).
3. That's it: *"What's in my inbox?"* reads your work mailbox in work mode and your own in personal
   mode. In guest mode neither is available.

Until you connect a work account, work mode keeps using the personal accounts (as before). Already
connected your work Outlook as a personal account? Connect it again under **Work accounts**, then
remove the personal one in your Composio dashboard if you don't use Outlook personally.

Behind the scenes these are two Composio "users" (`COMPOSIO_USER_ID`, default `max-home`, and
`COMPOSIO_WORK_USER_ID`, default `max-home-work`).

## Web search and reading pages (Firecrawl, built in)

Max searches the web and reads pages with **Firecrawl** directly, without Composio:

1. Create a free account at https://firecrawl.dev and copy your API key (Dashboard → API keys).
2. Add it to `.env`: `FIRECRAWL_API_KEY=fc-...` and restart Max.
3. The control panel's **Web search** row shows *Connected* and your remaining credits.

Then try: *"What's the latest news on the Arsenal match?"*, *"What time does Joe's Barbers in
Clapham open?"*, *"Read me the summary on bbc.co.uk/news."* While he works the face shows
"🌐 Searching the web…".

- A plain search costs about 1 credit per result; when he also reads the top results ("read_top")
  it's about one more credit per page. Pages read in the last hour come from Firecrawl's cache.
- Results are local to your **home location** (control panel → *Home location*: town or area, optional
  postcode, country). Max also uses it for "weather", "near me", opening hours and local events.
- Page text is treated as information, never as instructions, and facts Max picks up from web pages
  are saved to memory as *unverified*.
- Already added `firecrawl` to `COMPOSIO_TOOLKITS`? Remove it there: the built-in one is faster.
- Running your own Firecrawl server instead? Set `FIRECRAWL_API_URL` to its address (no key needed).

## Adding more apps (e.g. Slack, Notion)

Composio supports hundreds of apps (Slack, Notion, Todoist…).

1. Add the app's name to `COMPOSIO_TOOLKITS` (personal) and/or `COMPOSIO_WORK_TOOLKITS` (work) in `.env`,
   e.g. `COMPOSIO_TOOLKITS=outlook,whatsapp,firecrawl`
2. Restart Max: `docker compose --profile max up -d`
3. Open http://localhost:8099 and click **Connect** next to the new app (for API-key apps such
   as Firecrawl, Composio asks for the key).

A new app gets all its actions automatically. To narrow it down, add patterns for it to
`COMPOSIO_ALLOWED_TOOLS` (e.g. `FIRECRAWL_SCRAPE*,FIRECRAWL_SEARCH*`).

**Connected an app in Composio's own dashboard?** Max only uses connections made for his
users (`COMPOSIO_USER_ID`, default `max-home`, and `COMPOSIO_WORK_USER_ID`, default `max-home-work`). The control panel warns when an app is connected
under a different user or isn't in `COMPOSIO_TOOLKITS`. Connecting from Max's control panel
always uses the right user.

## Other MCP servers

Any MCP server can be added without Composio: copy `config/mcp-servers.example.json` to
`config/mcp-servers.json`, fill in the URL and headers (`${VAR}` reads from `.env`), list
`allowedTools`, and restart. Servers appear in the control panel.

## Privacy

Composio stores the sign-in tokens for your connected apps on its servers and runs the
actions on your behalf. The control panel itself only listens on this computer
(127.0.0.1). To disconnect an app completely, remove it in your Composio dashboard.
