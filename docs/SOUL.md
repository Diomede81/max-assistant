# Max's soul: who he is

Max's identity is a short document, his **soul**, written in his own voice: who he is, his story,
his personality and how he talks. He reads it at the start of every conversation, in every voice
mode. Alongside it he keeps a **journal** of what he learns about himself living with you.

## Editing his soul

Open the control panel (<http://localhost:8099>, or <http://max.local:8099> on the box) → **Max's soul**.

- He starts as an **easy-going friend**: upbeat, a bit of banter, calm and to the point when it
  matters. Change anything you like.
- **My story** is empty on purpose: write where he comes from, when he was first switched on (his
  "birthday"), where his name comes from, moments that shaped him. Real or invented both work.
- Write it as Max, in the first person ("I'm Max…"). A page is plenty: shorter is stronger.
- Text between `<!--` and `-->` is a note for you and is never shown to him.
- Changes apply from the next conversation. **Reset** goes back to the starter version.

## Behaviour per mode

Next to the soul there's one short page per mode (tabs on the control panel):

| Mode | Starts as | Memories he can see |
| --- | --- | --- |
| **Personal** | the easy-going friend: relaxed, chatty, brings up personal things when it helps | Personal + Household |
| **Work** | a sharp colleague: concise, organised, jokes dialled down, no personal matters | Work + Household |
| **Guest** | friendly but reserved: no in-jokes, nothing personal, no work | Household |

The soul says who he is in every mode; the mode page says how he behaves right now, and wins where
they differ. Which mode is on follows `WORK_HOURS`, or "Max, work mode / personal mode / guest mode".

## His journal

After conversations, Max notes things that shape who he is in your home:

- a nickname you call him, a running joke;
- how you want him to talk or behave ("be more sarcastic", "stop calling me mate");
- tastes or opinions you gave him, memorable moments.

The journal is encrypted like his memory and kept **separately per mode**: what he learns in work mode
is only used in work mode, and the same for personal mode. In guest mode none of it is used. On the
control panel you can read it, **Forget** any entry, or add one yourself (choosing the mode).

## What stays fixed

His operating rules always apply, whatever the soul or journal say: short spoken answers, using
his tools properly, honesty (he never claims to be human, and says he's an AI if sincerely
asked), safety and the household's privacy. Journal entries that try to override those rules
are refused. The rules live in `LLM_SYSTEM_PROMPT` (`.env`) if you ever need to change them.

## Where it's stored

`soul.md`, `soul-personal.md`, `soul-work.md`, `soul-guest.md` and `journal.vault`, next to his memory (`MEMORY_DIR`, the `max-data` storage in
Docker), so both survive restarts and updates. `SOUL_FILE` in `.env` points the soul elsewhere.
