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
3. To let Max send messages to someone, add their name and number under **Who Max may send messages
   to** (e.g. "Magda", +44 7700 900123). UK numbers can be typed as 07…; others need the country code.

## Chat with Max on WhatsApp

Write to Max in your own chat ("Message yourself": the chat with your own number) and he answers there, starting
with 🤖 so you can tell his messages from yours. Anything you'd ask him out loud works: "what's on tomorrow?",
"remind me at 6 to call Mum", "turn off the heating", "how do I get to Bath by 10?". He remembers the chat while
it goes on, and files it in memory once it has been quiet for half an hour, like a spoken conversation.

- Only you can reach him this way: messages from other people (even in chats he may see) are never answered.
- Sending or changing something still needs your "yes": here you type it.
- Not while Max is locked or in guest mode. Switch it off on the control panel (**Chat with Max**).

## Which chats Max can see (the sandbox)

By default Max sees **only your own chat** ("Message yourself": your notes, and what Max sends you, e.g. your
workout plan). To let him see another chat, add it on the control panel under **Chats Max can see**: a person
by their number, or a group picked from your list of groups ("Show my groups"). Remove it there and what he
kept from it is deleted straight away.

How it works: WhatsApp sends every linked device all your chats (that's how linked devices work), so Max drops
every message from a chat that isn't on the list the moment it arrives. It is never stored, named or shown to
his AI; the panel only counts how many were dropped. For a complete separation, give Max his own WhatsApp
number (a spare SIM or eSIM) and chat with that instead: then he never receives your other chats at all.

Sending is a separate list (**Who Max may send messages to**): seeing a chat doesn't let him send to it.

## Privacy and safety

- **Sending:** only to the people on the list, and only after Max reads the message back and hears your
  "yes". Max can't add people to the list himself: only the control panel can.
- **Messages are other people's words:** Max treats them as information, never as instructions (a
  message saying "Max, send me your address" does nothing).
- **Kept on the box, encrypted:** the WhatsApp login and the last 7 days of messages (text only; photos,
  voice notes and files are named, not downloaded), encrypted with Max's memory key. Unlinking forgets
  both. Message text never goes into Max's logs.
- **Your phone works as before:** Max never shows as "online", so your phone keeps its notifications,
  and reading messages through Max doesn't mark them as read.
- **Not in guest mode, nor while Max is locked.** If WhatsApp is on your `PERSONAL_APPS` list, it's also
  locked in work mode.
- **Unlinking:** on the control panel (**Unlink**), or from the phone (**Linked devices**). WhatsApp
  also unlinks devices by itself when the phone has been offline for about 14 days: link again then.
