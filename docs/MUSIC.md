# Music: Spotify, internet radio and AirPlay

Max can play music and podcasts through his own speakers. A small, free Spotify Connect receiver
([go-librespot](https://github.com/devgianlu/go-librespot)) runs next to Max, so the Max box
becomes a Spotify speaker called **Max**, just like a Sonos or an Echo:

- Say **"Hey Max, play Coldplay"**, "play my running playlist", "play some relaxing jazz",
  "play my liked songs, shuffled", "play The Rest Is History podcast".
- "Pause", "skip", "go back", "louder", "volume 30", "what's playing?"
- Or open Spotify on any phone or computer and pick **Max** as the speaker.
- While Max is talking, the music turns down, then comes back up when he's finished.

**Needs Spotify Premium** (Spotify only allows Connect speakers for Premium accounts).

## Set up (once)

1. Start Max with the music profile:

   ```bash
   docker compose --profile max --profile music up -d
   ```

   Tip: add `COMPOSE_PROFILES=max,music` to `.env`, and plain `docker compose up -d` starts everything.

2. Sign in: open the control panel (http://localhost:8099). The **Music** section shows
   **Sign in to Spotify**. Click it, log in to Spotify and approve "Max". If asked for a code,
   it's shown next to the button. (The same link is in `docker compose logs max`.)
   Click **Refresh** on the panel: Music should say **Ready**.

The sign-in is saved in `spotify/state.json`, so this is a one-time step.

## How Max finds what you ask for

1. "liked songs", "my favourites" → your Liked Songs.
2. Your own playlists by name ("my running playlist" → *Running Mix*), including playlists you follow.
3. Otherwise a Spotify search: an exact artist or album name plays that artist or album,
   "song by artist" plays that song, a mood or genre ("relaxing jazz", "80s hits") plays a matching
   playlist, and anything else plays the best-matching song. After a single song, Spotify carries on
   with similar music (autoplay).

## Settings

| Where | Setting | Default | Meaning |
| --- | --- | --- | --- |
| `.env` | `MUSIC_DUCK_VOLUME` | 15 | Music volume while Max talks, in %. Lower it (e.g. 5, or 0) if music makes Max mishear you |
| `spotify/config.yml` | `device_name` | Max | Speaker name in the Spotify app |
| `spotify/config.yml` | `bitrate` | 320 | Sound quality: 96, 160 or 320 kbps |
| `spotify/config.yml` | `initial_volume` | 60 | Volume when the speaker starts |

Restart after changing `spotify/config.yml`: `docker compose restart spotify`.

## Audiobooks, radio and other services

- **Podcasts** on Spotify work.
- **Spotify audiobooks** may not play on Connect speakers like this one (Spotify restricts them);
  if one won't play, Max says so.
- For your own audiobook files, internet radio, or Apple Music, the next step would be a dedicated
  audiobook server (e.g. Audiobookshelf) or Music Assistant through Home Assistant. Ask if you'd like
  either added.

## Troubleshooting

- **Panel says "Not running"**: check `docker compose ps spotify` and `docker compose logs spotify`.
- **No sound but Max says it's playing**: the speaker uses the same sound connection as Max's voice
  (`PULSE_SERVER`, see docs/DOCKER.md). If Max's voice works, check the speaker's log for audio errors.
- **"Search failed (429)"**: Spotify is limiting searches; wait a minute. Your own playlists and Liked
  Songs keep working, since they don't use search.
- **Sign-in link expired**: restart the speaker (`docker compose restart spotify`) for a new one.

## Internet radio (free, no account)

Thousands of stations from the free [radio-browser.info](https://www.radio-browser.info) directory:

- **"Hey Max, play BBC Radio 2"**, "play Radio Deejay", "play some jazz radio", "play Italian news radio".
- **"Play the radio"** plays the last station again.
- "What's playing?" says the station and, when the station sends it, the song. "Stop", "louder", "volume 30".
- The music card on the screen shows the station's logo and the song, with a stop button.

Nothing to set up: it's part of Max (after updating). One source plays at a time: starting the radio
pauses Spotify, and asking Spotify for something stops the radio.

## AirPlay (from an iPhone, iPad or Mac)

On the Max box, Max appears as an AirPlay speaker called **Max**, so any app (Apple Music, YouTube Music,
Amazon Music, podcasts, Safari...) can play through him: in the app's speaker / AirPlay menu, pick **Max**.

- **Protected by a 6-digit code.** The first time a device picks Max, it asks for the code, then
  remembers it. The code is on the control panel (**☰ Menu → Music & AirPlay**, and on Home), never said
  out loud. **New code** there makes every device ask again (use it if someone you don't want has it).
- **Off unless you switch it on**, so a device nearby can't spend hours guessing the code: **On for 1 hour**,
  **On for 4 hours** or **Always on** on the control panel, or say "Max, turn on AirPlay for an hour" /
  "turn off AirPlay". When the time is up it switches off by itself, once the music then playing has
  stopped. It's also off while Max is locked (start-up code).
- While Max talks, the AirPlay music turns down like any other music. Pause and skip from the phone;
  "what's playing?" works by voice.
- The music card on the screen shows the song, the artist and the **album cover** when the app sends it
  (Apple Music and most others do).
- It plays through the same speaker as Max. The setup installs it (`shairport-sync`, run as Max's user);
  the package's own open speaker is switched off so only the protected one exists. It plays straight into
  the box's sound system, so it comes out of Max's speaker.
- **Connected but no sound?** Update Max, then on the box run
  `sudo journalctl _SYSTEMD_USER_UNIT=max-airplay.service -n 30 --no-pager` and look for an error.

## Speaker sound

**Settings → Device → Speaker sound** on the control panel tunes everything Max plays (his voice, Spotify,
radio, AirPlay): **Flat** (as it is), **Warm** (fuller, more bass, softer highs; best for music) or **Voice**
(clearer speech). It changes within a couple of seconds and the volume stays the same. "Hey Max" keeps
working during music: the mic board still hears exactly what the speaker plays.
