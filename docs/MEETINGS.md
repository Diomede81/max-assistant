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

## Cost

Recall.ai charges for the time Max spends in meetings: about $0.50 per hour, plus $0.15 per hour for the
transcript (check recall.ai/pricing). The Meetings page shows this month's meeting time and an estimate.

## Coming next

- Max reads the transcript and proposes a summary, decisions, tasks and notes, which you approve before they go
  into your projects, to-do list and memory.
- Announcements ("Max is in the lobby", "your notes are ready"), a monthly spending cap, and how long
  transcripts are kept.
