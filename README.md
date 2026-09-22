# Atlas

A free, minimal web front end for the [Ultimate Geography](https://github.com/anki-geo/ultimate-geography) deck: every country, capital, flag and map, scheduled with FSRS. Opens straight into today's session. No account needed; progress lives in your browser (IndexedDB) and the app installs as a PWA and works offline.

## Keys

`space` flip · `1`–`4` Again / Hard / Good / Easy · `z` undo · `m` mute pronunciation

## Scheduling

[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) with the same preset as the Anki deck: desired retention 0.90, 20 new / 200 reviews a day, random new-card order, siblings buried for the day, one 10m learning and relearning step, day rollover at 4am, leeches tagged at 8 lapses (never suspended), 20m learn-ahead when nothing else is due.

## Pronunciation

Every country and capital name is pre-recorded with Microsoft neural voices in British and American English (`public/audio/{gb,us}`); the browser's locale picks one. Regenerate with `scripts/build-audio.py` (needs `pip install edge-tts`).

## Deploy and sync

The site is on Cloudflare Pages at https://atlasgeo.pages.dev, with the `/api` as a Pages Function backed by D1. Deploy with:

```bash
pnpm build && npx wrangler pages deploy dist --branch main
```

Sign-in with Google appears once a client id is configured:

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application.
2. Authorised JavaScript origins: `https://atlasgeo.pages.dev` (and `http://localhost:5179` for dev).
3. `npx wrangler secret put GOOGLE_CLIENT_ID` and paste the id. No redeploy needed.

Sync is last-write-wins per card; the review log is appended. Everything still works signed out.

## Develop

```bash
pnpm install
pnpm dev
```

`pnpm build:deck` regenerates `src/data/deck.json` from the CrowdAnki export in `deck-src/` (media is copied to `public/media/`).

## Credits

Ultimate Geography v5.3 by anki-geo. Deck content is public domain (Unlicense); images are CC BY-SA / CC BY / CC0 / public domain, see [sources.csv](https://github.com/anki-geo/ultimate-geography/blob/master/src/media/sources.csv).
