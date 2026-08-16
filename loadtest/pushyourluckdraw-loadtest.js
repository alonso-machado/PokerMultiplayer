/**
 * Push Your Luck Draw — backend load test (k6).
 *
 * Drives the real WebSocket protocol (no browser, no front-end): each k6 VU
 * is one table. It opens N raw WebSocket connections (one per seat), has the
 * first one create the room and the rest join it, then plays automatically
 * (draw/stop/rematch) for as long as the test runs — generating real game
 * traffic, not synthetic pings.
 *
 * Load shape, per the ask:
 *   - `base_tables`   — a constant 4 tables x 4 players, running the whole test.
 *   - `scaling_tables` — starts at 0 and adds one more TABLE_PLAYER_COUNT-player
 *     table every SCALE_INTERVAL, up to the TABLE_MAXIMUM_CAP safety cap.
 * k6 aborts the whole run the moment the thresholds below detect the server
 * struggling (action error rate, action latency, or connection failures) —
 * that abort point *is* "how many users we can handle".
 *
 * Usage:
 *   k6 run loadtest/pushyourluckdraw-loadtest.js
 *   k6 run -e BASE_URL=wss://your-render-app.onrender.com/ws loadtest/pushyourluckdraw-loadtest.js
 *
 * ⚠️  Point this at production only if you accept it may actually knock the
 * table over — that's the point, but real players could be sitting at real
 * tables when it happens. Prefer a local `bun run dev` server first.
 *
 * All knobs are -e env vars — see loadtest/README.md for the full list.
 */

import { WebSocket } from 'k6/experimental/websockets'
import exec from 'k6/execution'
import { Counter, Rate, Trend } from 'k6/metrics'

// ── Config (all overridable via -e NAME=value) ──────────────────────────────

const BASE_URL             = __ENV.BASE_URL || 'ws://localhost:3001/ws'
const INITIAL_TABLES       = Number(__ENV.INITIAL_TABLES || 4)
const INITIAL_TABLE_SIZE   = Number(__ENV.INITIAL_TABLE_SIZE || 4)
// Growing part of the test — one new table every SCALE_INTERVAL, each with
// TABLE_PLAYER_COUNT players, until TABLE_MAXIMUM_CAP tables are reached.
// Clamped to a floor of 2 — a 1-player "table" wouldn't be a real match
// (the server itself requires >=2 to start one), so it's not a viable
// minimum for a player simulation.
const TABLE_PLAYER_COUNT   = Math.max(2, Number(__ENV.TABLE_PLAYER_COUNT || 3))
const TABLE_MAXIMUM_CAP    = Number(__ENV.TABLE_MAXIMUM_CAP || 500)
const SCALE_INTERVAL       = __ENV.SCALE_INTERVAL || '5s'   // one new table per interval
const TARGET_SCORE         = Number(__ENV.TARGET_SCORE || 60)      // low on purpose: cycles matches
const JOKER_MODE           = __ENV.JOKER_MODE === 'per_player' ? 'per_player' : 'fixed'
// Default to effectively no "thinking time" — bots act the instant it's
// their turn, to hammer the server as hard as possible and expose
// bottlenecks (event-loop/GC pressure, broadcast fan-out cost, etc.)
// instead of pacing like a real human would.
const ACTION_DELAY_MIN_MS  = Number(__ENV.ACTION_DELAY_MIN_MS || 0)
const ACTION_DELAY_MAX_MS  = Number(__ENV.ACTION_DELAY_MAX_MS || 0)
const DRAW_PROBABILITY     = Number(__ENV.DRAW_PROBABILITY || 0.65)
const ACTION_TIMEOUT_MS    = Number(__ENV.ACTION_TIMEOUT_MS || 10_000)
const THROW_JOKER_CHANCE   = Number(__ENV.THROW_JOKER_CHANCE || 0.15)

// Breaking-point thresholds — k6 aborts the whole run when one trips.
const ERROR_RATE_THRESHOLD    = Number(__ENV.ERROR_RATE_THRESHOLD || 0.15)   // 15% of actions erroring/timing out
const LATENCY_P95_THRESHOLD_MS = Number(__ENV.LATENCY_P95_THRESHOLD_MS || 4_000)
const MAX_CONNECT_FAILURES     = Number(__ENV.MAX_CONNECT_FAILURES || 15)
const ABORT_WARMUP             = __ENV.ABORT_WARMUP || '20s' // ignore threshold breaches during startup noise

// ── Custom metrics ───────────────────────────────────────────────────────────

const wsConnectFailures  = new Counter('ws_connect_failures')
const wsUnexpectedCloses = new Counter('ws_unexpected_closes')
const wsErrors           = new Counter('ws_errors')
const tablesCreated      = new Counter('ws_tables_created')
const tablesFailed       = new Counter('ws_tables_failed')
// Server-level `{type:'error'}` — malformed/rejected message (e.g. a config
// value outside the server's validated range). Distinct from room_error /
// action timeouts so a bad test config shows up loudly instead of just
// silently producing zero traffic.
const protocolErrors     = new Counter('ws_protocol_errors')
const actionsSent        = new Counter('ws_actions_sent')
const actionsAcked       = new Counter('ws_actions_acked')
const actionErrorRate    = new Rate('ws_action_error_rate')
const actionLatency      = new Trend('ws_action_latency', true)
const roundsCompleted    = new Counter('ws_rounds_completed')
const matchesCompleted   = new Counter('ws_matches_completed')

// ── Scenario shape ───────────────────────────────────────────────────────────

function parseDurationSeconds(d) {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(d).trim())
  if (!m) return 15
  const n = parseFloat(m[1])
  return { ms: n / 1000, s: n, m: n * 60, h: n * 3600 }[m[2]]
}

const scaleStages = []
for (let i = 1; i <= TABLE_MAXIMUM_CAP; i++) scaleStages.push({ duration: SCALE_INTERVAL, target: i })
// Give base_tables a duration comfortably longer than the full scale ramp so
// it isn't the thing that cuts the test short. Override directly (e.g. for a
// quick smoke test) with -e BASE_DURATION_S=20 — don't use k6's --duration
// flag, it clobbers the scenarios block entirely.
const BASE_DURATION_S = Number(__ENV.BASE_DURATION_S) || Math.ceil(TABLE_MAXIMUM_CAP * parseDurationSeconds(SCALE_INTERVAL)) + 120

export const options = {
  scenarios: {
    base_tables: {
      executor: 'constant-vus',
      vus: INITIAL_TABLES,
      duration: `${BASE_DURATION_S}s`,
      exec: 'runTable',
      gracefulStop: '5s',
    },
    scaling_tables: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: scaleStages,
      startTime: '10s', // let the base tables finish connecting first
      exec: 'runTable',
      gracefulRampDown: '5s',
      gracefulStop: '5s',
    },
  },
  thresholds: {
    ws_action_error_rate: [{ threshold: `rate<${ERROR_RATE_THRESHOLD}`, abortOnFail: true, delayAbortEval: ABORT_WARMUP }],
    ws_action_latency:    [{ threshold: `p(95)<${LATENCY_P95_THRESHOLD_MS}`, abortOnFail: true, delayAbortEval: ABORT_WARMUP }],
    ws_connect_failures:  [{ threshold: `count<${MAX_CONNECT_FAILURES}`, abortOnFail: true }],
  },
  discardResponseBodies: true,
}

// ── One VU = one table ───────────────────────────────────────────────────────

export function runTable() {
  const isBase = exec.scenario.name === 'base_tables'
  const size = isBase ? INITIAL_TABLE_SIZE : TABLE_PLAYER_COUNT
  const table = {
    id: `${exec.scenario.name}-${exec.vu.idInTest}`,
    size,
    roomId: null,
    pendingJoiners: [],
  }

  openPlayer(table, /* isLeader */ true, 0)
  for (let seat = 1; seat < size; seat++) openPlayer(table, false, seat)
}

function openPlayer(table, isLeader, seat) {
  const socket = new WebSocket(BASE_URL)
  const name = `Bot-${table.id}-${seat}`.slice(0, 24)
  const player = { socket, playerId: null, helloAcked: false, savesHeld: 0, pendingSince: null }

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'hello', playerId: '', name }))
  })

  socket.addEventListener('message', (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    onMessage(table, player, isLeader, msg)
  })

  socket.addEventListener('error', () => { wsErrors.add(1) })

  socket.addEventListener('close', () => {
    if (player.helloAcked) wsUnexpectedCloses.add(1)
    else wsConnectFailures.add(1)
    if (isLeader && !table.roomId) tablesFailed.add(1)
  })
}

function onMessage(table, player, isLeader, msg) {
  switch (msg.type) {
    // Sent once per connection right after `hello`, before any game command
    // is accepted server-side — see server/src/index.ts's hello handler.
    case 'identity':
      player.helloAcked = true
      setTimeout(() => {
        if (isLeader) {
          player.socket.send(JSON.stringify({
            type: 'pushyourluckdraw_create_room',
            roomName: `LoadTest ${table.id}`,
            config: { maxPlayers: Math.min(8, Math.max(2, table.size)), targetScore: TARGET_SCORE, jokerMode: JOKER_MODE },
          }))
        } else if (table.roomId) {
          player.socket.send(JSON.stringify({ type: 'pushyourluckdraw_join_room', roomId: table.roomId }))
        } else {
          table.pendingJoiners.push(player) // leader hasn't got a roomId back yet — wait
        }
      }, 30)
      break

    case 'pushyourluckdraw_room_joined':
      player.playerId = msg.yourId
      if (isLeader) {
        table.roomId = msg.roomId
        tablesCreated.add(1)
        for (const waiter of table.pendingJoiners) {
          waiter.socket.send(JSON.stringify({ type: 'pushyourluckdraw_join_room', roomId: table.roomId }))
        }
        table.pendingJoiners = []
      }
      break

    case 'pushyourluckdraw_room_error':
      actionErrorRate.add(1)
      if (isLeader && !table.roomId) tablesFailed.add(1)
      break

    // Generic protocol-level rejection (parseClientMessage() returned null
    // server-side — see server/src/validation.ts) — most likely a bad -e
    // override (e.g. TARGET_SCORE below the server's validated minimum of
    // 50) rather than a server bug. Surfaced loudly so it can't masquerade
    // as "the game just isn't generating traffic".
    case 'error':
      protocolErrors.add(1)
      if (isLeader && !table.roomId) tablesFailed.add(1)
      break

    case 'pushyourluckdraw_player_list':
    case 'pushyourluckdraw_round_started':
    case 'pushyourluckdraw_state_update':
      updateSaves(table, player, msg.players)
      break

    case 'pushyourluckdraw_your_turn':
      scheduleAction(table, player)
      break

    case 'pushyourluckdraw_draw_result':
    case 'pushyourluckdraw_stop_result':
    case 'pushyourluckdraw_throw_result':
      updateSaves(table, player, msg.players)
      if (msg.playerId === player.playerId && player.pendingSince !== null) {
        actionLatency.add(Date.now() - player.pendingSince)
        actionErrorRate.add(0)
        actionsAcked.add(1)
        player.pendingSince = null
      }
      break

    case 'pushyourluckdraw_round_end':
      roundsCompleted.add(1)
      break

    // Table hit the target score — vote to keep the load going indefinitely
    // instead of letting the table go idle.
    case 'pushyourluckdraw_match_end':
      matchesCompleted.add(1)
      setTimeout(() => {
        player.socket.send(JSON.stringify({ type: 'pushyourluckdraw_rematch_vote', accept: true }))
      }, Math.random() * 30) // same "as fast as possible" policy as draw/stop
      break
  }
}

function updateSaves(table, player, players) {
  if (!players) return
  table.lastPlayers = players // used by pickOpponent() to find a throw_joker target
  const me = players.find((p) => p.id === player.playerId)
  if (me) player.savesHeld = me.savesHeld
}

function scheduleAction(table, player) {
  const delay = ACTION_DELAY_MIN_MS + Math.random() * (ACTION_DELAY_MAX_MS - ACTION_DELAY_MIN_MS)
  setTimeout(() => {
    if (player.socket.readyState !== 1 /* OPEN */) return

    let msg
    if (player.savesHeld >= 2 && Math.random() < THROW_JOKER_CHANCE) {
      const target = pickOpponent(table, player)
      if (target) msg = { type: 'pushyourluckdraw_throw_joker', targetId: target }
    }
    if (!msg) msg = { type: Math.random() < DRAW_PROBABILITY ? 'pushyourluckdraw_draw' : 'pushyourluckdraw_stop' }

    player.pendingSince = Date.now()
    actionsSent.add(1)
    player.socket.send(JSON.stringify(msg))

    setTimeout(() => {
      // No draw/stop/throw result arrived in time — count it as a failure
      // and stop waiting on it (the turn may have timed out server-side).
      if (player.pendingSince !== null) {
        actionErrorRate.add(1)
        player.pendingSince = null
      }
    }, ACTION_TIMEOUT_MS)
  }, delay)
}

// Mirrors the server's own throwJoker() rejection rules (see
// server/src/pushyourluckdraw/gameEngine.ts) — a target that's already
// stood/busted, or already has a halving card this round, gets a legitimate
// room_error no matter how idle the server is. Filtering here up front keeps
// ws_action_error_rate a signal of real server distress instead of the
// bot's own bad target picks.
function pickOpponent(table, player) {
  const others = table.lastPlayers
    ? table.lastPlayers.filter((p) => p.id !== player.playerId && p.status === 'active' && !p.roundHand.some((c) => c.isHalf))
    : []
  if (others.length === 0) return null
  return others[Math.floor(Math.random() * others.length)].id
}
