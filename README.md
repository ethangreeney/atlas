# Atlas

Every country, capital, flag and map, learned with spaced repetition. Free, no account needed.

**[atlasgeo.pages.dev](https://atlasgeo.pages.dev)**

![Atlas demo](docs/demo.gif)

## Why

I play [Krillion](https://krillion.io) and GeoGuessr and kept losing on the same things: micro-states in the Pacific and Caribbean, capitals nobody mentions, flags that look alike. The best material for this is the [Ultimate Geography](https://github.com/anki-geo/ultimate-geography) Anki deck, but the Anki apps are dated and fiddly. Atlas is that deck with a front end I actually want to open every day: it starts straight into today's cards, everything is a keystroke, and the scheduler is FSRS, the same algorithm Anki uses, tuned to the settings its authors recommend.

## How it works

Space flips the card. `1` to `4` grades it Again, Hard, Good or Easy and the card flies into a pile. That's the whole loop. Each grade tells FSRS how hard the card is for you and when you'll be about to forget it, and the next review is booked for exactly then.

Every name has a pre-recorded neural pronunciation (press `S`), and any card can show its location map (`M`) or open in Google Maps (`G`). Filters let you drill a region or a card type. Sign in with Google to sync progress across devices, or don't; it works fully offline as an installable web app.

## Keys

| Key | Action |
| --- | --- |
| `space` | Flip, or Good when flipped |
| `1` `2` `3` `4` | Again, Hard, Good, Easy |
| `z` | Undo |
| `s` | Pronounce |
| `m` | Show map |
| `g` | Open in Google Maps |

## Stack

Vite, React, TypeScript, Tailwind, Motion, [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), Dexie (IndexedDB). Hosted on Cloudflare Pages with a small Pages Function and D1 for sync. Pronunciation clips are generated once with Microsoft neural voices via [edge-tts](https://github.com/rany2/edge-tts) and shipped as static files.

## Scheduling

FSRS with desired retention 0.90, 20 new and 200 reviews a day, random new-card order, siblings buried for the day, one 10 minute learning and relearning step, day rollover at 4am, leeches tagged at 8 lapses but never suspended. Sync is last-write-wins per card.

## Develop

```bash
pnpm install
pnpm dev
```

`pnpm build:deck` rebuilds `src/data/deck.json` from the CrowdAnki export in `deck-src/`. `scripts/build-audio.py` regenerates the pronunciation clips. Deploy with `pnpm build && npx wrangler pages deploy dist --branch main`; sign-in needs a Google OAuth client id set as the `GOOGLE_CLIENT_ID` Pages secret.

## Credits

[Ultimate Geography](https://github.com/anki-geo/ultimate-geography) by anki-geo. Deck content is public domain (Unlicense); images are CC BY-SA / CC BY / CC0 / public domain, see [sources.csv](https://github.com/anki-geo/ultimate-geography/blob/master/src/media/sources.csv).
