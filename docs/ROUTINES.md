# Routines: the news briefing

Routines are jobs Max does on a schedule, so the result is ready the moment you ask. The first one is
the **news briefing**: you give Max a list of websites and what interests you; every morning (or
whenever you choose) he gathers the news, picks the 5 or 6 articles that suit you best, reads them and
prepares a short spoken summary of each.

## Setting it up

Control panel → **Routines** → *New news briefing*:

| Field | What to put |
| --- | --- |
| Websites | One per line: a news site (`bbc.co.uk/news`), a section (`theguardian.com/uk/business`), or an RSS feed |
| What interests you | Topics, people, places, separated by commas: `Formula 1, AI start-ups, Brighton local news` |
| Leave out | Optional: `celebrity gossip, shopping guides` |
| Time and days | When to gather it: a little before you usually ask (it takes a minute or two) |
| Articles | How many to pick (3 to 10, default 6) |
| Whose | Personal, Work or Household: a work briefing is only read out in work mode, like the rest of Max |
| Also search the news | Besides your websites, run a news search for each interest (needs Firecrawl; uses credits) |

**Not sure which websites?** Fill in your interests and leave the websites empty (or press **Suggest
websites** on an existing briefing). Max proposes sources for your interests, plus a web search for each
one when Firecrawl is set up, and **checks every one**: does it load, does it have a news feed, are there
fresh headlines. You see each site with the interest it covers, how Max can read it (*news feed* is the
most reliable, and those are ticked already) and its recent headlines that match your interests. Sites that
aren't news sources (shops, coupon sites, companies, investors) or whose headlines don't match are left out. Tick the ones you want and press **Add selected**.
For sites with a feed, the feed address itself is added. You can always add your own as well.
Which AI model makes the suggestions is up to you: see [MODELS.md](MODELS.md).

You can also do it by voice: "Add theverge.com to my news", "I'm interested in tennis", "Leave out
celebrity news", "Gather my news at 6:45", "What are my news settings?", "Suggest some news websites for me"
(the suggestions then appear on the Routines tab).

## Using it

- "Hey Max, **what's the news?**": he reads the prepared briefing, a sentence or two per article, and
  asks if you want more on any. "Tell me more about the second one" reads you that article.
- "**What's going on in my day?**" mentions that the briefing is ready and offers it at the end.
- "**Get me fresh news**" gathers a new one now; he says when it's ready.
- On the control panel you see the latest briefing with links to every article, and **Run now**.

Max never gives you the same article twice, and if a run finds nothing new he keeps the previous
briefing. If Max was switched off at the scheduled time, he gathers it as soon as he's back (same day).

## How it gathers the news

For each website, cheapest way first:

1. **Its news feed** (RSS/Atom), found automatically from the page: free, with dates and summaries.
2. **The headlines on the page itself**, downloaded directly.
3. **Firecrawl**, for sites that only show their content to a real browser (if `FIRECRAWL_API_KEY` is set).

Then, like an editor would:

1. **Noise out**: coupons, deals, sponsored posts, newsletters, company and investor pages (portfolios,
   careers, "about us") and navigation links are removed; so are stories older than three days and
   anything you've already been given.
2. **Research** (with *Research* ticked and Firecrawl set up): a news search for each of your interests
   adds what your websites don't cover.
3. **Ranking**: the AI model (Settings → AI models → News briefings) scores each headline 1–10 against
   your interests, your *Leave out* list and your 👍 / 👎; only clear matches (6 or more) are kept.
   Fewer good articles beat a full list of filler.
4. **Checking**: each chosen article is read. Pages that turn out to be adverts, paywalls or off-topic are
   dropped and the next best article takes their place; the rest get a two-sentence spoken summary.

If the AI model can't answer (wrong model name, out of credit, a "thinking" model that ran out of room),
Max matches the headlines on your interests' key words instead, never just "the first few", and the
briefing says so on the control panel.

**👍 / 👎** on each article in the control panel teaches Max your taste: they're used every time he chooses.

**Firecrawl credits:** with feeds, a daily briefing costs about 6 credits (reading the chosen articles),
plus a few per day for each site without a feed and for the optional news search: roughly 200 a month
for one daily briefing, within the free plan.

Everything is stored encrypted next to Max's memory (`routines.vault`).

## Troubleshooting

- **"Couldn't read site.com"** on the panel: the site blocks automatic downloads. Add its RSS feed
  address instead (often `site.com/feed` or `site.com/rss`), or set up Firecrawl.
- **Articles don't match your interests**: make the interests more specific, and use *Leave out*.
- **Nothing at the scheduled time**: check the time zone (`TZ` in `.env`) and that the routine is on.
