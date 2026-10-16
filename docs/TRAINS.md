# Trains: live departures and journey planning (UK)

Max can check National Rail's live trains and plan journeys, and put both on his screen:

- **"Hey Max, when's the next train to Waterloo?"**, "is the 8:15 on time?", "trains from Clapham Junction to
  Reading": times, delays, cancellations (with the reason), platforms and the arrival time. The board shows on
  the screen, with any disruption notice.
- **"Trains to Manchester tomorrow morning"**, "get me to Bath by 10am on Saturday", "how do I get to Oxford":
  the best options with changes, how long they take and when you arrive. The screen shows them with a
  **QR code that opens Trainline** for that route, so you can see prices and book in the Trainline app (with
  your railcard and saved card). The card stays up for 10 minutes, even after "thank you", so there's time to
  scan it.

Max never books or pays himself, and doesn't guess ticket prices: Trainline shows them.

**Home station:** the "from" when you don't say one. Set it on the control panel (**Connections → Trains**), e.g.
*Twickenham*, or `HOME_STATION=Twickenham` in `.env`.

Station names work as you'd say them: "Waterloo", "Kings Cross" and "Paddington" are the London stations; if a
name could be several ("Manchester"), Max asks which one for live departures. For journeys, any town or address
works ("my office, 10 Downing Street").

## Live departures (free): Rail Data Marketplace

National Rail's own live data, through the official, free Rail Data Marketplace:

1. Create an account at **<https://raildata.org.uk>**.
2. Find the **Live Departure Board** data product and subscribe to it (free).
3. In the product's **Specification** tab, copy the **consumer key**.
4. On the box: `nano ~/max-assistant/.env`, add `RAIL_DATA_KEY=<the key>`, save, then `docker compose up -d`.

The control panel's **Trains** section then shows *Live departures: Connected*.

If Max says the departure board's address wasn't found, copy the endpoint shown in the product's Specification
tab (up to and including `/api/20220120`) into `RAIL_DATA_URL=` in `.env`.

## Journey planning: Google Maps

Journeys with changes come from Google Maps (its Routes API, the same journeys as in the Google Maps app):

1. Go to **<https://console.cloud.google.com>**, create a project and add a **billing account** (Google
   requires one for its Maps services, even within the free allowance).
2. **APIs & Services → Library**: enable the **Routes API**.
3. **APIs & Services → Credentials → Create credentials → API key**. Restrict it to the Routes API.
4. Add `GOOGLE_MAPS_API_KEY=<the key>` to `.env` on the box, then `docker compose up -d`.

**Cost:** Google charges per request beyond a monthly free allowance; a household asking for a few journeys
a day should stay well inside it. Check the current allowance and prices on Google's
[Maps Platform pricing page](https://mapsplatform.google.com/pricing/), and set a **budget alert** in the
Cloud Console (Billing → Budgets & alerts) for peace of mind.

## Troubleshooting

| What you see | What to do |
|---|---|
| "The rail data key was refused" | Check `RAIL_DATA_KEY` and that you subscribed to the **Live Departure Board** product. |
| "The departure board address wasn't found" | Set `RAIL_DATA_URL` from the product's Specification tab (see above). |
| "Google refused the key" | Check the Routes API is enabled for the key's project, billing is set up, and the key isn't restricted to other APIs. |
| The QR code opens Trainline without the stations filled in | Trainline changed its pages: search the route in the app (the stations are on the card). |

Station list: "A Database of UK Train Stations" by David Wheatley (github.com/davwheat/uk-railway-stations), from
Trainline EU's stations database, under the Open Database License (ODbL).
