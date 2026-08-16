# Push Your Luck Draw — load test

`pushyourluckdraw-loadtest.js` is a [k6](https://k6.io) script that drives the
backend's real WebSocket protocol directly — no browser, no front-end. Each
virtual user (VU) is one table: it opens N raw WebSocket connections (one per
seat), has the first one create the room and the rest join it, then plays
automatically (draw/stop, occasional joker throws, auto rematch) for as long
as the test runs.

Load shape, matching what was asked for:

- **`base_tables`** — a constant 4 tables × 4 players, running for the whole test.
- **`scaling_tables`** — starts at 0 and adds one more **`TABLE_PLAYER_COUNT`-player
  table every `SCALE_INTERVAL`**, up to the **`TABLE_MAXIMUM_CAP`** safety cap
  (defaults: 3 players/table — floored at 2, a 1-player "table" isn't a real
  match — every 5s, capped at 500 tables).

> At the default `TABLE_MAXIMUM_CAP=500` / `SCALE_INTERVAL=5s`, the ramp alone
> takes ~42min if nothing ever breaks. Lower `SCALE_INTERVAL` further (e.g.
> `2s`) if you want to reach the cap — or a bottleneck — sooner.

k6 **aborts the whole run automatically** the moment the server starts
struggling — that abort point is your answer to "how many users can we
handle". It watches three things:

| Metric | Trips when | Env var |
|---|---|---|
| `ws_action_error_rate` | >15% of draw/stop/throw actions error or time out | `ERROR_RATE_THRESHOLD` |
| `ws_action_latency` (p95) | action round-trip exceeds 4s | `LATENCY_P95_THRESHOLD_MS` |
| `ws_connect_failures` | more than 15 WebSocket connections fail to establish | `MAX_CONNECT_FAILURES` |

The script imports the WebSocket client from `k6/experimental/websockets` —
correct for the current k6 release (v1.4.2 as tested here). If your `k6
version` has since graduated it to the stable `k6/websockets` module, swap
the import at the top of the file; `k6 run` will tell you immediately if the
module name it's using doesn't exist.

## Install k6

Not part of this repo's `bun`/`npm` dependencies — it's a standalone Go binary.

```bash
winget install k6.k6
```

(or see https://grafana.com/docs/k6/latest/set-up/install-k6/ for other platforms.)

## Run it

Start the backend first (`cd server && bun run dev`), then:

```bash
k6 run loadtest/pushyourluckdraw-loadtest.js
```

Against a deployed backend:

```bash
k6 run -e BASE_URL=wss://your-render-app.onrender.com/ws loadtest/pushyourluckdraw-loadtest.js
```

A quick smoke test (skip the long ramp):

```bash
k6 run -e TABLE_MAXIMUM_CAP=2 -e SCALE_INTERVAL=3s -e BASE_DURATION_S=20 loadtest/pushyourluckdraw-loadtest.js
```

> Don't use k6's own `--duration`/`--vus` flags — they override the
> `scenarios` block wholesale and the script has none of its own to fall back
> to. Control run length with `TABLE_MAXIMUM_CAP` / `SCALE_INTERVAL` /
> `BASE_DURATION_S` instead.

> ⚠️ **Only point this at production if you're OK with it actually falling
> over.** That's the point of the test, but real players could be at real
> tables when it happens. Render's free tier in particular has a hard, small
> memory ceiling and shared CPU — expect it to break far earlier than a
> dedicated box would, and a crash there reflects the plan's limits, not
> necessarily the game code.

## Reading the result

k6 prints a live progress line while it runs, then a full summary at the end.
What to look at:

- If it **aborts early** ("test run aborted because threshold ... was
  crossed"), the summary's VU counts at that point ≈ your breaking-point
  headcount. Custom metrics (`ws_tables_created`, `ws_actions_sent`, etc.)
  show exactly what was going on server-side when it tipped over.
- If it **runs to the `TABLE_MAXIMUM_CAP` cap without aborting**, the server
  handled everything you threw at it — raise `TABLE_MAXIMUM_CAP` (and/or lower
  `SCALE_INTERVAL`) and try again.
- `ws_action_latency` climbing steadily *before* an abort is usually the
  first sign of trouble (event loop or GC pressure) — worth watching even if
  the run doesn't trip a threshold.

## Useful knobs (`-e NAME=value`)

| Var | Default | What it does |
|---|---|---|
| `BASE_URL` | `ws://localhost:3001/ws` | Target server |
| `INITIAL_TABLES` | `4` | Tables in the constant base load |
| `INITIAL_TABLE_SIZE` | `4` | Players per base table |
| `TABLE_PLAYER_COUNT` | `3` | Players per table added while scaling — floored at 2 |
| `TABLE_MAXIMUM_CAP` | `500` | Hard cap on scaling tables (safety valve) |
| `SCALE_INTERVAL` | `5s` | How often a new scaling table is added |
| `TARGET_SCORE` | `60` | Match target — kept low so matches (and rematches) cycle often, generating steady state-transition traffic instead of one long round |
| `ERROR_RATE_THRESHOLD` / `LATENCY_P95_THRESHOLD_MS` / `MAX_CONNECT_FAILURES` | `0.15` / `4000` / `15` | Break points — see table above |
| `ACTION_DELAY_MIN_MS` / `ACTION_DELAY_MAX_MS` | `0` / `0` | Simulated "thinking time" before each bot acts — zeroed by default so actions fire as fast as the server can handle them; set these >0 to simulate more realistic human pacing instead |
| `DRAW_PROBABILITY` | `0.65` | Chance a bot draws vs. stops on its turn |

## Extending to other games

The pattern (one VU = one table, leader creates + shares `roomId`, players
react to `*_your_turn` broadcasts, auto-rematch to keep the load steady) is
the same for every room-based game in `shared/types.ts` — Truco, Truco
Gaúcho, Canastra, and Poker (Blackjack is matchmaking-only, no room to
create). Copy this file and swap the `pushyourluckdraw_*` message types for
the target game's equivalents.
