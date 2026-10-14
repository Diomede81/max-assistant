# Setting up the Max box (Raspberry Pi 5)

From a blank SD card to Max's face on the screen: about 45 minutes, most of it waiting.

## 1. Prepare the SD card (on your Mac)

1. Install **Raspberry Pi Imager** from <https://www.raspberrypi.com/software/> and insert the SD card.
2. Choose:
   - **Device:** Raspberry Pi 5
   - **Operating system:** Raspberry Pi OS (other) → **Raspberry Pi OS Lite (64-bit)**. Max draws his own
     screen, so the desktop version isn't needed.
   - **Storage:** your SD card
3. When asked to **apply OS customisation settings**, choose **Edit settings** and fill in:
   - **Hostname:** `max`
   - **Username and password:** your choice (remember them)
   - **Wireless LAN:** your WiFi name and password, **country GB**. This is how the box joins your WiFi
     the first time.
   - **Locale:** time zone Europe/London, keyboard gb
   - **Services** tab: **Enable SSH** with password authentication
4. Write the card, put it in the Pi, and connect the power. Wait about 3 minutes for the first start.

## 2. Connect to the box from your Mac

```bash
ssh YOUR-USERNAME@max.local
```

(Type `yes` the first time, then your password.) If `max.local` isn't found, wait a minute and try
again, or look up the Pi's address in your router's device list.

## 3. Copy Max onto the box

On your **Mac**, from the folder that contains `max-assistant`:

```bash
rsync -a --exclude node_modules --exclude dist --exclude data max-assistant YOUR-USERNAME@max.local:~/
```

This includes your `.env` (keys and settings). Then, on the **box** (over SSH), check these settings in
`~/max-assistant/.env` with `nano ~/max-assistant/.env`:

| Setting | On the box |
| --- | --- |
| `PULSE_SERVER` | **Delete this line** if it's there (it's for the Mac sound bridge) |
| `PANEL_PASSWORD` | Set one: the control panel will be reachable from your home network |
| `REALTIME_BARGE_IN=on` | Recommended: the mic board's echo cancellation lets you talk over Max |
| `COMPOSE_PROFILES=max,music` | Add `,music` if you use the Spotify speaker |
| `MEMORY_KEY` | Keep the same value as on your Mac |

## 4. Run the setup

On the box:

```bash
cd ~/max-assistant
sudo ./scripts/pi/setup.sh
```

It asks which screen is fitted (round DSI, round HDMI or none), installs everything, then builds and
starts Max. The first build takes 10–15 minutes on a Pi 5. When it finishes:

```bash
sudo reboot
```

After the restart, Max's face appears on the screen and he's listening for "Hey Max".

## Using the box

- **Control panel:** <http://max.local:8099> from any phone or computer on your WiFi.
- **Changing WiFi:** if the box can't reach a known WiFi network for a minute, or you **hold the screen
  for 5 seconds**, Max says so and shows a QR code. Scan it with your phone: it joins Max's temporary
  "Max-Setup" network and opens a page where you choose your WiFi and type its password. Max tells you
  when he's connected. If nobody uses the setup network for 10 minutes, it switches itself off and the
  box tries your known networks again.
- **The face:**

  ![Max's face: idle with a timer, listening, thinking (work mode), speaking happily, curious, speaking with concern, asleep, WiFi setup](img/face-states.jpg)

  - **Lip-sync:** his voice is analysed 20 times a second for its sound shape, so the mouth makes
    an open "a", a wide "ee", a round "oo", shows teeth on "s" and closes on "m".
  - **Expressions follow what he says:** apologies and problems look concerned, good news looks
    happy, questions look curious, "let me check" looks focused, timers and reminders look
    surprised. The expression relaxes back to neutral a few seconds after he finishes.
  - **Natural movement:** blinking, quick glances, breathing, a head tilt when he listens, and eyes
    that look up and away while he thinks.
  - It's asleep at night (23:00–07:00, `FACE_SLEEP` in `.env`), shows the time, timers counting
    down around the edge, what's playing, and a WORK or GUEST badge in those modes.
- **Preview on your Mac:** with Max running in Docker on the Mac, open <http://localhost:8098/?demo> to
  see every expression. To hold one, use its name, e.g. `?demo=happy`, `?demo=speaking-concerned`
  or `?demo=asleep`.

## Trying the face on your Mac (before the box arrives)

With Max running in Docker on your Mac (`docker compose --profile max up -d --build`):

1. Open <http://localhost:8098> in a browser and make the window square-ish.
2. Say "Hey Max" and ask something. The face listens, thinks, and its mouth moves with his voice.
   Try "what's the weather?" then something he can't do: his expression changes with the answer.
3. Or test without the microphone: type to Max with voice output, keeping the face in the browser:
   ```bash
   docker compose stop max
   docker compose run --rm --service-ports max node dist/tools/chat.js --speak
   ```
   (Afterwards: `docker compose --profile max up -d`.)
4. If the mouth moves a little **before** you hear the words, set `FACE_AUDIO_DELAY_MS=200` in `.env`
   (try 150–300) and restart Max. The Mac sound bridge buffers audio; the box usually needs less or none.

## Updating

Copy the new version from your Mac with the same `rsync` command, then on the box:

```bash
cd ~/max-assistant && sudo ./scripts/pi/setup.sh
```

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Screen stays black | On a Pi 5, use the cable with **one narrow end** (22-pin, into the Pi) and one wide end (15-pin, into the screen); the cable with two equal ends is for older Pis. Check both ends are fully in with the latches closed. Then run the setup again and make sure you picked the connector the cable is really in (`CAM/DISP 0` or `1`, printed on the Pi): `sudo MAX_DSI_PORT=0 ./scripts/pi/setup.sh` (or `=1`). |
| The desktop appears instead of Max's face | The card has Raspberry Pi OS **with desktop**. Run the setup again (it now switches the desktop off at boot), or by hand: `sudo systemctl disable lightdm && sudo systemctl enable max-face && sudo reboot`. To get the desktop back: `sudo systemctl enable lightdm && sudo reboot`. |
| Face shows "Reconnecting…" | Max isn't running: `cd ~/max-assistant && docker compose logs --tail 50 max` |
| No sound, or Max can't hear | `pactl list short sinks` and `pactl list short sources` should list the mic board (XVF3800). If not, check its USB cable, then run `systemctl --user restart max-audio-defaults`. |
| Max wakes up by himself (TV, music, noise) | Set `WAKEWORD_TRIGGER_LEVEL=2` in `.env` and run `docker compose -f docker-compose.yml -f docker-compose.pi.yml up -d`. The log line `Ignored a false wake-up` shows the double-check catching others. More: `training/README.md`, "Waking up by itself". |
| Max doesn't wake reliably | Run `./scripts/wake-coach.sh` from where you usually sit: it measures how well he recognises you and tells you what to change. |
| Face service | `journalctl -u max-face -n 50` |
| WiFi setup service | `journalctl -u max-wifi -n 50` |
| Start WiFi setup without the screen | `echo 1 \| sudo tee /run/max/wifi-request` |

## What was and wasn't tested

The face screen, the WiFi setup page and its logic (offline detection, wrong password, hidden networks,
long-press) were tested on a development machine with a simulated network manager. The setup script was
checked for errors but has not yet been run on a real Pi 5 with these parts: the screen's driver line,
the kiosk start-up and the mic board's sound names are the parts to watch on the first run. Send the
output if anything goes wrong.
