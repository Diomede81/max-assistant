# Music: the Max box as a Spotify speaker

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
