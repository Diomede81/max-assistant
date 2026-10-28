# Backups

Everything Max keeps lives on the box: memory, people, journal, health, routines, scheduled tasks,
WhatsApp, Home Assistant's login and, on the box, Home Assistant's own settings (devices, rooms,
automations). An SD card wears out, a box gets lost: keep a copy somewhere else.

A backup is **one encrypted file** (`max-backup-DATE-TIME.maxbak`). It is encrypted with Max's own key,
and the key is never inside it, so the file is safe anywhere: a laptop, a USB stick, a cloud drive, an
email to yourself. Without the key it is noise.

## Two ways to make one

**Download** (control panel › Settings › Backup › *Download a backup*): the file lands in your browser's
downloads. Do this before an update you're nervous about, or whenever you like.

**Daily, into a folder** (on by default, 03:30): Max saves a backup into the `backups` folder next to him
on the box (`~/max-assistant/backups`), keeping the last 7. That folder is still on the box, so sync or
copy it elsewhere:

| Where to | How |
|---|---|
| A USB stick | Plug it in, then once: `sudo mount /dev/sda1 /mnt/usb` and add a line to the box's crontab: `30 4 * * * cp ~/max-assistant/backups/*.maxbak /mnt/usb/` |
| Your laptop | From the laptop, now and then: `rsync -a USER@max.local:max-assistant/backups/ ~/max-backups/` |
| A cloud drive (Google Drive, Dropbox, OneDrive, iCloud via a WebDAV app, S3…) | On the box: `sudo apt install rclone`, `rclone config` (choose the drive, sign in), then crontab: `30 4 * * * rclone sync ~/max-assistant/backups remote:max-backups` |
| A NAS | Mount its share on the box (`/etc/fstab`) and use the USB line with that path |

The control panel's Home page reminds you when no backup has been made for two weeks, and when the
last one failed.

## The key

Keep a copy of the encryption key in your password manager: Settings › Backup › *Your encryption key* ›
Copy. It is `MEMORY_KEY` from `.env` if you set one, otherwise the key Max made on first start
(`data/memory.key`). **A backup is useless without it**, and anyone with both the key and a backup can
read everything, so never keep them together.

## Restore

On a new box (or after a mishap), with Max installed and running:

1. Put the key back: `MEMORY_KEY=…` in `.env` (then `docker compose up -d`), or copy `memory.key` into
   Max's data folder (`docker compose cp memory.key max:/app/data/memory.key`).
2. Control panel › Settings › Backup › *Restore*: choose the `.maxbak` file. Max replaces what he has
   with the backup and restarts (about a minute).
3. Home Assistant's own settings, when the backup has them, land in `data/home-assistant-restore`
   inside Max's data (they can't be written to Home Assistant's folder from the control panel). To put
   them back, on the box:
   ```bash
   docker compose stop homeassistant
   docker compose cp max:/app/data/home-assistant-restore/. /tmp/ha-restore
   sudo cp -a /tmp/ha-restore/. /var/lib/max/home-assistant/
   docker compose start homeassistant
   ```

A backup made with a different key says so and changes nothing.

## What is and isn't in it

In: every file in Max's data folder (the encrypted stores, photos for the screen, Max's notes), except the
key, and Home Assistant's settings folder on the box (minus its history database, which is large and
rebuilds itself, and its logs and caches). Not in: `.env` (your API keys and passwords: keep your own
copy), the voice models and the Spotify or AirPlay containers' own data. A single file over 256 MB is
left out with a line in the log.
