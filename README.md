# Atlas

A free, minimal web front end for the [Ultimate Geography](https://github.com/anki-geo/ultimate-geography) deck: every country, capital, flag and map, scheduled with FSRS. Opens straight into today's session. No account needed; progress lives in your browser (IndexedDB) and the app installs as a PWA and works offline.

## Keys

`space` flip · `1`–`4` Again / Hard / Good / Easy · `z` undo · `m` mute pronunciation

## Scheduling

[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) with the same preset as the Anki deck: desired retention 0.90, 20 new / 200 reviews a day, random new-card order, siblings buried for the day, one 10m learning and relearning step, day rollover at 4am, leeches tagged at 8 lapses (never suspended), 20m learn-ahead when nothing else is due.

## Develop

```bash
pnpm install
pnpm dev
```

`pnpm build:deck` regenerates `src/data/deck.json` from the CrowdAnki export in `deck-src/` (media is copied to `public/media/`).

## Credits

Ultimate Geography v5.3 by anki-geo. Deck content is public domain (Unlicense); images are CC BY-SA / CC BY / CC0 / public domain, see [sources.csv](https://github.com/anki-geo/ultimate-geography/blob/master/src/media/sources.csv).
