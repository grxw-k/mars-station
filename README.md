# Mars Outpost

A browser game for kids aged 7–12, made for the NASA Space Apps Challenge "Junior Astronaut Mission Trainer". You are the captain of a Mars outpost. For 15 sols you split limited solar power between life support, radiation shielding, the greenhouse, the radio and the lab, and send your crew of five to work. Every choice has a cost, and the radiation storms come from real NASA space weather records.

**Play it:** https://grxw-k.github.io/mars-station/ (no download, no account, English)

## Run

```bash
npm install
npm run dev
```

## Check

```bash
npm run typecheck
npm test
npm run simulate -- 300
npm run build
```

`npm run simulate -- 300` plays three bots (careful, sloppy, lazy) in each mode and fails if the balance guard rails break, including when a harder mode stops being harder. GitHub Actions runs the same checks and deploys `main` to GitHub Pages.

## How the game works

- **Energy cells** for 5 systems (life support, shield, greenhouse, radio, lab), unlocked one per sol on sols 1–4.
- **Crew of five with one job per sol** (grow, fix, outside, lab, care, rest), specialists, tiredness, the medbay.
- **Dose badges** in real mSv; solar storms come only from real DONKI records in `src/data/donki-periods.json`.
- **Events**: trouble with 2–3 priced choices, chances, quiet sols; trouble left alone grows.
- **Radio**: one message per sol, answered next morning, blackout on sols 11–12.
- **Three modes**: Easy, Medium, Hard. All modes play the same Mars for the same mission name.
- **Stars, Captain's report, "Same Mars again"** and a discovery album of 27 cards with real NASA photos and facts.
- No dice: the same mission name and the same choices always give the same result.

The mission name picks three things, so every new name is a different mission (and the same name is the same mission for the whole class):

- **Landing site** (`src/data/sites.json`): Gale Crater, Jezero Crater, Utopia Planitia or Hellas Basin. Each changes a few numbers with one plus and one minus based on the real place.
- **Mission twist** (`src/data/twists.json`): one gain with one price, like extra food that costs lab spare parts, or veterans who start with dose from earlier missions.
- **Mission Control tasks** (`src/data/tasks.json`): two requests with a deadline that pay extra science.

## Code map

- `src/engine/`: the rules, pure functions in strict TypeScript.
- `src/data/`: all numbers (`balance.json`), texts (`en.json`), sites, twists, tasks, cards, facts and DONKI periods.
- `src/ui/`: React screens.
- `scripts/`: balance simulation (`simulate.ts`, `bots.ts`) and the DONKI fetcher (`fetch-donki.ts`).
- `tests/`: Vitest tests for the engine and the texts.

## Data sources

- **NASA DONKI** (Space Weather Database): solar flares, coronal mass ejections and solar energetic particle events, 2013–2026. To refresh the pool, put your own key from api.nasa.gov in `.env` (see `.env.example`) and run `npm run fetch:donki`.
- **Curiosity RAD**: the everyday dose on the Mars surface, 0.67 mSv per sol.
- **NASA radiation guide**: dose on the International Space Station, for comparison.
- **NASA OSDR** and **images.nasa.gov**: facts and photos on the album cards.

The game values (badge limits, crop growth, mission length) are simplified for play and are not NASA limits. The "Where the data comes from" screen in the game says which numbers are real and which are game estimates.
