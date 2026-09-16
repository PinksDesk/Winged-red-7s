# Winged Red 7s

Single-player 3-reel sevens slot (Batch 1). **Fake money only** — no accounts, no backend, no real money. Progress is stored in **this browser** via `localStorage` (isolated per browser/profile).

## How to open / play

### Option A — open the file
1. Clone or download this repo.
2. Double-click `index.html`, or open it from your browser (File → Open).

### Option B — local static server
```bash
npx --yes serve .
```
Then open the URL shown (usually `http://localhost:3000`).

## Controls

| Control | Action |
|--------|--------|
| **SPIN** | Place bet and spin (locked while spinning) |
| **Denom** | Cycle `$0.25` → `$0.50` → `$1` (**idle only**) |
| **Lines** | Cycle 1 → 2 → 3 lines · 1 credit per line (**idle only**) |

- **Phone:** large touch targets.
- **TV / keyboard:** Tab to focus buttons, **Enter** (or Space) to activate. Denom and Lines stay locked mid-spin.

**Total bet** = denomination × lines. Starting bankroll: **$100** fake.

## Layout

- **3 reels × 3 rows**
- Symbols: Red 7, White 7, Blue 7, Red-White-Blue 7 (CSS placeholders)
- Pay lines: **1** = middle, **2** = top, **3** = bottom
- Reels stop **left → right**

## Paytable

Win = **multiplier × current denom** for each winning active line.

| Combination | Multiplier |
|-------------|------------|
| 3 × Red-White-Blue 7 | ×40 |
| 3 × Red 7 | ×20 |
| 3 × White 7 | ×12 |
| 3 × Blue 7 | ×8 |
| Any 3 mixed 7s | ×3 |

Paytable is intentionally a bit cheap on 7s.

## Saved on refresh

Per browser: bankroll, denom, lines, last win, last reel result.

## Out of scope (not in Batch 1)

GOAL bonus, Power Play Seconds, Penalty cartoons, The Slide, Avalanche whammies, hot-seat, poker, Tigers 5-reel, accounts, chat, real money.

## Files

- `index.html` — shell + paytable UI
- `styles.css` — phone + TV layout
- `game.js` — spin loop, bets, pays, `localStorage`
