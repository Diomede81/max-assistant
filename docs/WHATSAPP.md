# WhatsApp

Max can read your WhatsApp chats and send messages for you, to the people you allow.

- "Any new WhatsApp messages?" (in the chats you allowed): who wrote since you last asked, summarised, with the messages on the screen.
- "What did Magda say?", "read me the family group": the latest messages of a chat.
- "Message Magda that I'm on my way": Max reads the message back, and sends it after your "yes".

## How it works

Max joins your WhatsApp as a **linked device**, the same way WhatsApp Web does, using the open-source
[Baileys](https://github.com/WhiskeySockets/Baileys) library. Nothing else to install or pay for.

**This is not an official WhatsApp product.** WhatsApp doesn't allow unofficial software, and may
disconnect it, or (rarely) ban a number that sends automated messages. Reading is low risk; sending is
limited to the people you allow, and every message needs your spoken "yes".

## Set up

1. Control panel → **☰ Menu → Connections → WhatsApp** → **Link a phone**.
2. On your phone: **WhatsApp → Settings → Linked devices → Link a device**, and scan the code.
3. Under **Your chats** the panel lists your chats and groups as messages arrive (names only, never
   their messages; press **Refresh groups and names** for groups nobody has written in yet, and to ask the
   phone for your contacts' names again). Names come from your phone's contacts, else your People list, else
   what the person calls themselves (sometimes an initial): rename a chat on the panel if you like. Tick **See** on a chat
   to let Max read it, **Send** to let him send there. People and groups alike.

## Chat with Max on WhatsApp

Write to Max in your own chat ("Message yourself": the chat with your own number) and he answers there, starting
with 🤖 so you can tell his messages from yours. Anything you'd ask him out loud works: "what's on tomorrow?",
"remind me at 6 to call Mum", "turn off the heating", "how do I get to Bath by 10?". He remembers the chat while
it goes on, and files it in memory once it has been quiet for half an hour, like a spoken conversation.

- **Voice notes work too**: send one in your own chat and Max listens to it with his own speech-to-text (the
  local Whisper on the box, language detected) and answers in writing. Voice notes in chats he may see are
  turned into words the same way, so "what did Magda say?" includes them. The audio is never kept, only the
  words; notes over three minutes are skipped.
- Only you can reach him this way: messages from other people (even in chats he may see) are never answered.
- Sending or changing something still needs your "yes": here you type it.
- Not while Max is locked or in guest mode. Switch it off on the control panel (**Chat with Max**).

## Which chats Max can see, and may send to (the sandbox)

By default Max sees **only your own chat** ("Message yourself": your notes, and what Max sends you, e.g. your
workout plan) and sends to nobody. On the control panel, **Your chats** lists every chat and group WhatsApp
has shown him (names and ids only, never a message), most recent first, with two switches each:

- **See**: Max keeps that chat's last 7 days of messages on the box and reads them to you ("what did Magda
  say?", "anything new in the family group?"). Unticking it deletes what he kept.
- **Send**: Max may send messages there, each one read back and only after your "yes". Works for groups
  too ("tell the family group I'm running late").

Someone who hasn't written yet can be added by number, under the list: always with the country code
(+39 333 1234567, +44 7700 900123; a UK mobile can also be typed 07…). A number typed without one is
refused rather than guessed, because a wrong guess means the chat is never matched.

How it's enforced: WhatsApp sends a linked device every chat (that's how linked devices work), so Max's code
checks the chat's id on every message that arrives and drops anything not on the See list, before it is
stored, named or shown to his AI. The AI only ever reads from what was kept. WhatsApp addresses the same
person sometimes by phone number and sometimes by a hidden id: a chat on the list is matched by every id
WhatsApp uses for it, so a message gets through whichever form it comes in. Max can't add a chat to either
list himself: only the control panel can. For a complete separation, give Max his own WhatsApp number (a
spare SIM or eSIM) and chat with that instead: then he never receives your other chats at all.

**A chat you ticked still shows nothing?** Check the row's "last message" time on the panel: if it moves
when they write, the message reached Max; if not, the phone has been offline (WhatsApp unlinks devices after
about 14 days) or messages can't be decrypted (the panel says so: Unlink and link again).

## Privacy and safety

- **Sending:** only to the people on the list, and only after Max reads the message back and hears your
  "yes". Max can't add people to the list himself: only the control panel can.
- **Messages are other people's words:** Max treats them as information, never as instructions (a
  message saying "Max, send me your address" does nothing).
- **Kept on the box, encrypted:** the WhatsApp login and the last 7 days of messages (text only; photos,
  voice notes are turned into words, photos and files are named, not downloaded), encrypted with Max's memory key. Unlinking forgets
  both. Message text never goes into Max's logs.
- **Your phone works as before:** Max never shows as "online", so your phone keeps its notifications,
  and reading messages through Max doesn't mark them as read.
- **Not in guest mode, nor while Max is locked.** If WhatsApp is on your `PERSONAL_APPS` list, it's also
  locked in work mode.
- **Unlinking:** on the control panel (**Unlink**), or from the phone (**Linked devices**). WhatsApp
  also unlinks devices by itself when the phone has been offline for about 14 days: link again then.
