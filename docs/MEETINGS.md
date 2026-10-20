# Meetings: Max as your notetaker

Max can join your online meetings on **Microsoft Teams, Zoom and Google Meet** and bring back the transcript:
who said what, and when. He joins as a participant through [Recall.ai](https://www.recall.ai), the service
that runs the meeting bot.

## Setting it up (once)

1. Create an account at recall.ai. Choose the **EU region**, so meeting data stays in Europe.
2. In Recall.ai, create an **API key**.
3. Add it to Max's `.env` (on the box: `~/max-assistant/.env`):
   ```
   RECALL_API_KEY=your-key
   ```
4. Restart Max so he picks it up:
   ```bash
   cd ~/max-assistant && docker compose up -d --force-recreate max
   ```
5. Control panel → Menu → **Meetings** → **Check the Recall.ai connection**. It should say "Connected to
   Recall.ai (eu-central-1)".

The key is a password for your Recall.ai account: keep it in `.env` only (never in the code or a message).

## Using it

**By voice:**

| You say | Max does |
| --- | --- |
| "Max, join my 10 o'clock" / "join the Acme call" | Finds it in your calendar, says which meeting, and joins after your yes |
| "Join this meeting" (with a link on screen) / "join the meeting I'm sending you" | Asks for the link if he can't find one |
| "Are you in the meeting?" | Says what he's doing (joining, in the lobby, taking notes) |
| "Leave the meeting" | Leaves |
| "What did Marco say in this morning's meeting?" | Answers from the transcript |

Work meetings are in your work calendar, which Max sees in work mode (during your working hours, or "Max, work
mode"). Not in guest mode.

**On the control panel:** on the **Meetings** page, paste the meeting link (from the invitation or your calendar), optionally say what
it's about, and press **Send Max**.

- Max joins as **"Max (your first name's notetaker)"** and posts in the meeting chat that he's transcribing
  it, so everyone knows.
- **Teams:** if the meeting has a lobby, someone in the meeting has to let him in. The page says "Waiting in
  the lobby: let Max in" while he waits.
- The page shows what he's doing (joining, in the lobby, taking notes) and refreshes by itself. **Leave**
  makes him leave early.
- When the meeting ends, the transcript appears within a few minutes: **Transcript** shows it with the
  speakers and times, and **Download as text** saves it.

Meetings and transcripts are kept encrypted on the box with Max's memory. **Delete** removes one (Recall.ai
deletes its own copy on its own schedule: 7 days unless you pay to keep it longer).

## Talking to Max in a meeting

Max can also answer you **out loud** in the meeting. Start with his name:

- "Max, what did we decide about the opening?"
- "Max, who's our supplier on this project?"
- "Max?" … (pause) … "what's still open for Marco?"

He answers in one to three sentences in his own voice, about 3 to 5 seconds later, and **everyone in the meeting
hears it**. So:

- **Only you can ask.** Max recognises you by your name in the meeting (from About you; set
  `MEETING_OWNER_NAME` if the meeting shows it differently). Anyone else saying "Max" is ignored.
- **He only uses** what's been said in the meeting, general knowledge about its topic, and the **project the
  meeting is about**. Nothing personal: no email, calendar, family, memories or other projects, even if asked.
- **The project:** pick it when you send Max (Meetings page), say it ("join my 10 o'clock for the Milan
  project"), or name the meeting after it ("Milan launch weekly") and Max finds it.

### Setting it up (once): the secure link

To hear the meeting as it happens, Recall.ai has to reach the box. A **Cloudflare Tunnel** does that safely: the
box makes an outgoing connection to Cloudflare, and only one secret address on its own port (8097) is reachable
through it. The control panel never is. You need a domain on Cloudflare (a free Cloudflare account is fine).

1. In the Cloudflare dashboard, open **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** →
   **Cloudflared**, and name it `max`.
2. When it shows the install command, copy the **token** (the long text after `--token`). You don't need to
   install anything: Max's box runs it.
3. Add a **public hostname** (also called a published application route): subdomain `max-meetings`, your
   domain, type **HTTP**, URL `localhost:8097`. Save.
4. On the box, add to `~/max-assistant/.env`:
   ```
   CLOUDFLARE_TUNNEL_TOKEN=the-token
   MEETINGS_PUBLIC_URL=https://max-meetings.yourdomain.com
   ```
5. Run the setup once so the box starts the link: `cd ~/max-assistant && sudo ./scripts/pi/setup.sh`.
6. Control panel → **Meetings** → **Check the secure link**. It should say "The secure link works".

From then on, every meeting Max joins has live answers. On a laptop it works the same with any public HTTPS
address that reaches port 8097.

## Cost

Recall.ai charges for the time Max spends in meetings: about $0.50 per hour, plus $0.15 per hour for the
transcript (check recall.ai/pricing). The Meetings page shows this month's meeting time and an estimate.

## Coming next

- Max reads the transcript and proposes a summary, decisions, tasks and notes, which you approve before they go
  into your projects, to-do list and memory.
- Announcements on the box ("Max is in the lobby", "your notes are ready"), a monthly spending cap, and how long
  transcripts are kept.
