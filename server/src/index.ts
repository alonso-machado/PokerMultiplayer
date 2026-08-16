// ⚠️  telemetry MUST be the very first import so OTel hooks activate before
//     any application modules load. Do not move this line.
import { startTelemetry, shutdownTelemetry } from './telemetry'
startTelemetry()

import type { ClientMessage, LobbyGame, ServerMessage } from '../../shared/types'
import { parseClientMessage } from './validation'
import { issueToken, verifyToken, newPlayerId } from './identity'
import { openapiSpec, swaggerUiHtml } from './openapi'
import { logger } from './logger'
import { randomId, randomToken } from './random'

const IS_DEV = process.env.NODE_ENV !== 'production'
import { Room } from './room'
import { TrucoRoom } from './trucoRoom'
import { GauchoRoom } from './gauchoRoom'
import { CanastraRoom } from './canastraRoom'
import { BlackjackRoom } from './blackjackRoom'
import { PushYourLuckDrawRoom } from './pushyourluckdrawRoom'
import { Tournament } from './tournament'
import { adminRouter, publicTournamentHandler } from './admin'
import { gameMetrics, serverStartedAt } from './metrics'

// ── Per-connection message rate limit ──────────────────────────────────────
// Cheap, blanket protection against a client (buggy or malicious) hammering
// any message type — deliberately not type-specific, so it can't be bypassed
// by picking an "exempt" message. Generous enough to never bother a real
// player: even our own load-test bots acting at maximum speed (zero
// simulated "thinking time") only reached a few actions/sec per connection.
// Gated behind a flag (default ON) so a deliberate loadtest/pushyourluckdraw-
// loadtest.js run against a non-production target can disable it with
// -e RATE_LIMIT_ENABLED=false / RATE_LIMIT_ENABLED=false in the server env —
// without this it would just look like a self-inflicted breaking point.
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false'
const MAX_MESSAGES_PER_WINDOW = Number(process.env.WS_MAX_MSGS_PER_SEC ?? 30)
const MESSAGE_WINDOW_MS = 1000

// ── Per-IP message rate limit ───────────────────────────────────────────────
// Same shape as the per-connection budget above, but keyed by IP — closes the
// gap where a single actor opens many sockets from one IP, each individually
// staying under its own 30/sec budget while the IP as a whole hammers the
// server. Deliberately set well above the per-connection cap, not equal to
// or below it: a household/office NAT — or our own loadtest box, which opens
// many bot connections from one machine — legitimately runs several real
// connections that are each entitled to their own full per-connection
// budget. This is a ceiling on top of that, not a per-player throttle; it
// only trips once combined traffic from one IP looks like more simultaneous
// connections than any real use case needs. Same RATE_LIMIT_ENABLED flag as
// every other WS rate limit here.
const MAX_MESSAGES_PER_IP_WINDOW = Number(process.env.WS_MAX_MSGS_PER_SEC_PER_IP ?? 100)
const ipMsgBuckets = new Map<string, { count: number; resetAt: number }>()

function ipMsgLimited(ip: string): boolean {
  const now = Date.now()
  const entry = ipMsgBuckets.get(ip)
  if (!entry || now > entry.resetAt) {
    ipMsgBuckets.set(ip, { count: 1, resetAt: now + MESSAGE_WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > MAX_MESSAGES_PER_IP_WINDOW
}

// ── Room-creation rate limit (stricter, two-dimensional) ───────────────────
// create_room (poker + truco/gaucho/canastra/pushyourluckdraw) used to be
// guarded by a flat MAX_LOBBY_ROOMS cap on *poker only* — every other game
// had no protection at all, and a numeric cap on concurrent rooms doesn't
// stop churn (create, abandon, repeat). Creating a room is also strictly
// heavier than a normal play action: it allocates a Room with its own
// lifecycle timers that stays alive until it empties or expires (see
// room.ts), so it gets its own budget on top of the general one above,
// enforced on two axes:
//  - per connection (createCount/createWindowResetAt on Session) — stops one
//    socket from hammering create_room.
//  - per IP (ipCreateBuckets, keyed by resolveClientIp()) — stops the same
//    actor from routing around the per-connection cap by opening several
//    sockets, the same gap the old per-connection-only message limiter had.
// A minute-long window (vs. the 1s window above) because creation is rare
// for a real player but the cost per creation is high — a handful of minutes
// of unchecked creates is already enough Room objects + timers to matter.
const MAX_CREATES_PER_CONN = Number(process.env.WS_MAX_CREATES_PER_CONN ?? 5)
const MAX_CREATES_PER_IP   = Number(process.env.WS_MAX_CREATES_PER_IP ?? 10)
const CREATE_WINDOW_MS = 60_000

const CREATE_ROOM_TYPES = new Set<ClientMessage['type']>([
  'create_room', 'truco_create_room', 'gaucho_create_room',
  'canastra_create_room', 'pushyourluckdraw_create_room',
])

const ipCreateBuckets = new Map<string, { count: number; resetAt: number }>()

function ipCreateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = ipCreateBuckets.get(ip)
  if (!entry || now > entry.resetAt) {
    ipCreateBuckets.set(ip, { count: 1, resetAt: now + CREATE_WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > MAX_CREATES_PER_IP
}

// Bounds both IP bucket maps to "IPs seen in the last window", not "every IP
// that ever connected" — playerSessions (below) has an unbounded-growth
// shape we already know about; these maps are new, so they don't need to
// inherit the same issue. A bucket whose window is still running (an
// actively-hammering IP) keeps getting its resetAt pushed forward by
// ipMsgLimited()/ipCreateLimited(), so this only ever prunes IPs that have
// gone quiet — active ones are never mid-sweep candidates.
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of ipMsgBuckets) if (now > entry.resetAt) ipMsgBuckets.delete(ip)
  for (const [ip, entry] of ipCreateBuckets) if (now > entry.resetAt) ipCreateBuckets.delete(ip)
}, 5 * 60_000)

/** Best-effort real client IP. Render terminates TLS and proxies every
 *  request, so the raw peer address from `server.requestIP()` is Render's
 *  proxy, not the player — same reasoning as admin.ts's `clientKey()`.
 *  Spoofable (a client can send its own X-Forwarded-For), so this is a speed
 *  bump against casual multi-socket abuse, not an identity guarantee. */
function resolveClientIp(req: Request, server: { requestIP: (req: Request) => { address: string } | null }): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? server.requestIP(req)?.address
    ?? 'unknown'
}

/** Per-game lobby pub/sub topics. Every connection starts subscribed to all
 *  six (so an idle/browsing client sees every game's live room list — same
 *  as the snapshot already sent in open() below), then unsubscribes from a
 *  specific game's topic the moment it's seated in that game (create/join)
 *  and resubscribes on leaving.
 *
 *  Before this, every room-list broadcast (`server.publish('lobby', ...)`)
 *  went out on one shared topic that nobody ever unsubscribed from — so
 *  every create_room/join_room, for any table, went to every connected
 *  socket including players already deep in an unrelated match. Under a
 *  load test with ~200 concurrent Push Your Luck Draw tables this was the
 *  single largest source of outbound traffic (a growing room-list resent to
 *  hundreds of sockets on every single join). Splitting into per-game
 *  topics keeps each broadcast scoped to players who can actually act on it.
 *
 *  `tournament_info` deliberately stays on the shared 'lobby' topic below —
 *  a tournament starting is relevant to everyone, seated or not.
 *
 *  Scope note: the one path that doesn't re-sync a subscription is a
 *  tournament kicking off and pulling already-connected players out of a
 *  lobby room server-side (see the tournament `start` admin callback) — that
 *  leaves their poker-lobby subscription stale until their next reconnect.
 *  Rare (once per tournament start) and harmless (just a few extra bytes),
 *  not worth the extra plumbing to chase down their live socket from there. */
const LOBBY_TOPICS = {
  poker: 'lobby:poker',
  truco: 'lobby:truco',
  gaucho: 'lobby:gaucho',
  canastra: 'lobby:canastra',
  blackjack: 'lobby:blackjack',
  pushyourluckdraw: 'lobby:pushyourluckdraw',
} as const

const rooms = new Map<string, Room>()
const trucoRooms = new Map<string, TrucoRoom>()
const gauchoRooms = new Map<string, GauchoRoom>()
const canastraRooms = new Map<string, CanastraRoom>()
const blackjackRooms = new Map<string, BlackjackRoom>()
const pushyourluckdrawRooms = new Map<string, PushYourLuckDrawRoom>()
let activeTournament: Tournament | null = null
let openConnections = 0

// ── Persistent player sessions (survive WS reconnect) ─────────────────────────
interface PersistentSession {
  playerId: string
  name: string
  roomId: string | null
  trucoRoomId: string | null
  gauchoRoomId: string | null
  canastraRoomId: string | null
  blackjackRoomId: string | null
  pushyourluckdrawRoomId: string | null
  tournamentToken: string | null
  /** Last time this playerId was known alive — set on creation, refreshed on
   *  every reconnect (`hello`) and on disconnect (`close`). The only thing
   *  the TTL sweep below reads. */
  lastSeenAt: number
}
const playerSessions = new Map<string, PersistentSession>()

// ── Persistent-session TTL sweep ────────────────────────────────────────────
// playerSessions never used to be cleared — a guest who closes the tab and
// never comes back left a permanent entry, growing for as long as the
// process stays up (which, being in-memory, is otherwise the only bound on
// it — see .claude/Server.md). A player currently connected is tracked in
// connectedPlayerIds and is never evicted regardless of lastSeenAt, however
// long their socket has been open for — this only reaps players who are
// BOTH disconnected AND have been for the full TTL. Safe to be generous
// (days, not minutes): the actual Room a stale entry points to already has
// its own much shorter-lived expiry/rebuy timers (see room.ts et al.), so by
// the time this fires the entry is almost always already-dead weight, not a
// working reconnect path we'd be cutting short.
const PLAYER_SESSION_TTL_MS = Number(process.env.PLAYER_SESSION_TTL_HOURS ?? 48) * 60 * 60 * 1000
const PLAYER_SESSION_SWEEP_MS = 30 * 60_000

// Reference-counted (not a plain Set) so a player with two tabs open doesn't
// lose their "connected" status the moment either one closes.
const connectedCounts = new Map<string, number>()
function markConnected(pid: string): void {
  connectedCounts.set(pid, (connectedCounts.get(pid) ?? 0) + 1)
}
function markDisconnected(pid: string): void {
  const n = connectedCounts.get(pid)
  if (n === undefined) return
  if (n <= 1) connectedCounts.delete(pid); else connectedCounts.set(pid, n - 1)
}

setInterval(() => {
  const now = Date.now()
  for (const [pid, ps] of playerSessions) {
    if (connectedCounts.has(pid)) continue
    if (now - ps.lastSeenAt > PLAYER_SESSION_TTL_MS) playerSessions.delete(pid)
  }
}, PLAYER_SESSION_SWEEP_MS)

// ── WS session (ephemeral, per connection) ────────────────────────────────────
interface Session {
  playerId: string
  name: string
  roomId: string | null
  trucoRoomId: string | null
  gauchoRoomId: string | null
  canastraRoomId: string | null
  blackjackRoomId: string | null
  pushyourluckdrawRoomId: string | null
  tournamentToken: string | null
  /** Which game's lobby tab the client currently has open — see
   *  `set_active_lobby` / syncLobbySubscription() below. Purely a live UI
   *  signal from the client, so it isn't persisted across reconnects; the
   *  front resends it the moment it (re)connects. */
  activeLobbyTab: LobbyGame | null
  /** Rate-limit bucket — see MAX_MESSAGES_PER_WINDOW below. */
  msgCount: number
  msgWindowResetAt: number
  /** Stricter per-connection bucket just for create_room-type messages — see
   *  CREATE_ROOM_TYPES below. */
  createCount: number
  createWindowResetAt: number
  /** Best-effort client IP, resolved once at upgrade — see resolveClientIp()
   *  below. Only used for the per-IP create-room guard. */
  ip: string
}

function generateId(): string { return randomId(9) }

function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  }
}
function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...cors() },
  })
}
function send(ws: { send: (d: string) => void }, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg))
}

/** Resolve the room a player's actions should be routed to. Tournament tables
 *  can change under a player (start, rebalance, final-table consolidation)
 *  without `session.roomId` being updated for already-connected sockets, so
 *  for registered (and not-yet-eliminated) players the tournament's own
 *  table-tracking is the source of truth. Falls back to `session.roomId`
 *  for lobby play and for eliminated players who joined a regular table. */
function currentRoom(session: Session): Room | undefined {
  if (activeTournament) {
    const tableId = activeTournament.getTableId(session.playerId)
    if (tableId) return rooms.get(tableId)
  }
  return session.roomId ? rooms.get(session.roomId) : undefined
}

function currentTrucoRoom(session: Session): TrucoRoom | undefined {
  return session.trucoRoomId ? trucoRooms.get(session.trucoRoomId) : undefined
}

function currentGauchoRoom(session: Session): GauchoRoom | undefined {
  return session.gauchoRoomId ? gauchoRooms.get(session.gauchoRoomId) : undefined
}

function currentCanastraRoom(session: Session): CanastraRoom | undefined {
  return session.canastraRoomId ? canastraRooms.get(session.canastraRoomId) : undefined
}

function currentBlackjackRoom(session: Session): BlackjackRoom | undefined {
  return session.blackjackRoomId ? blackjackRooms.get(session.blackjackRoomId) : undefined
}

function currentPushYourLuckDrawRoom(session: Session): PushYourLuckDrawRoom | undefined {
  return session.pushyourluckdrawRoomId ? pushyourluckdrawRooms.get(session.pushyourluckdrawRoomId) : undefined
}

/** Matchmaking — Blackjack has no room creation/browsing (see .claude/Blackjack.md):
 *  join whichever table has a free seat, or open a new one, capped at 7 per dealer. */
function findOrCreateBlackjackRoom(): BlackjackRoom {
  for (const r of blackjackRooms.values()) if (!r.isFull) return r
  const room = new BlackjackRoom(generateId(), 'Mesa de Blackjack', {
    onEmpty: () => { blackjackRooms.delete(room.id); broadcastBlackjackLobbyStats() },
    onPlayersChanged: () => broadcastBlackjackLobbyStats(),
  })
  blackjackRooms.set(room.id, room)
  return room
}

// ── Admin callbacks ───────────────────────────────────────────────────────────

const handleAdmin = adminRouter(
  () => activeTournament?.info() ?? null,

  (data) => {
    if (activeTournament && activeTournament.status !== 'finished')
      return { ok: false, error: 'Já existe um torneio ativo.' }
    try {
      const scheduledStart = new Date(data.scheduledStart)
      if (Number.isNaN(scheduledStart.getTime())) return { ok: false, error: 'Data inválida.' }
      const cfg: RoomConfig = {
        smallBlind: Math.max(1, data.config.smallBlind | 0),
        bigBlind:   Math.max(2, data.config.bigBlind | 0),
        ante:       Math.max(0, data.config.ante | 0),
        maxPlayers: Math.min(6, Math.max(2, data.config.maxPlayers | 0)),
      }
      activeTournament = new Tournament(
        generateId(),
        { name: data.name.trim().slice(0, 40), scheduledStart, config: cfg },
        (tRooms) => { for (const [id, r] of tRooms) rooms.set(id, r); broadcastRoomList() },
        () => {
          setTimeout(() => {
            if (!activeTournament) return
            for (const r of activeTournament.tableMap.values()) r.destroy()
            for (const id of activeTournament.tableMap.keys()) rooms.delete(id)
            broadcastRoomList()
          }, 60_000)
        },
      )
      broadcastTournamentInfo()
      return { ok: true }
    } catch (e) { return { ok: false, error: String(e) } }
  },

  () => {
    if (!activeTournament) return { ok: false, error: 'Nenhum torneio.' }
    if (activeTournament.status !== 'registering') return { ok: false, error: 'Já iniciado.' }
    activeTournament.start()

    // A registered player may have been sitting in a regular lobby room when
    // the tournament kicked off — `tournament_table_assigned` already told
    // their client to switch to the tournament table, so pull them out of
    // the lobby room on the server too (free the seat for other players).
    for (const reg of activeTournament.registrations.values()) {
      const ps = playerSessions.get(reg.playerId)
      const oldRoomId = ps?.roomId
      if (!oldRoomId) continue
      const oldRoom = rooms.get(oldRoomId)
      if (oldRoom && !oldRoom.tournamentId) {
        oldRoom.leave(reg.playerId, 'tournament_move')
        if (oldRoom.playerCount === 0) { oldRoom.destroy(); rooms.delete(oldRoomId) }
      }
      if (ps) ps.roomId = null
    }

    broadcastRoomList()
    broadcastTournamentInfo()
    return { ok: true }
  },

  () => {
    if (!activeTournament) return { ok: false, error: 'Nenhum torneio.' }
    if (activeTournament.status === 'running' || activeTournament.status === 'final_table')
      return { ok: false, error: 'Torneio em andamento.' }
    activeTournament.destroy(); activeTournament = null
    broadcastTournamentInfo(); return { ok: true }
  },

  getAdminMetrics,
)

const handlePublicTournament = publicTournamentHandler(() => activeTournament?.info() ?? null)

// ── Server ────────────────────────────────────────────────────────────────────

const server = Bun.serve<Session>({
  port: Number(process.env.PORT ?? 3001),

  fetch(req, server) {
    const url = new URL(req.url)
    const { method } = url
    // Collapse repeated slashes (e.g. "//api/admin/login" -> "/api/admin/login").
    // A trailing slash on VITE_SERVER_URL would otherwise produce a path that
    // silently misses every route below and falls through to the catch-all.
    const pathname = url.pathname.replace(/\/{2,}/g, '/')

    if (method === 'OPTIONS')
      return new Response(null, { status: 204, headers: cors() })

    if (pathname === '/ws') {
      const ip = resolveClientIp(req, server)
      const ok = server.upgrade(req, {
        data: { playerId: '', name: 'Jogador', roomId: null, trucoRoomId: null, gauchoRoomId: null, canastraRoomId: null, blackjackRoomId: null, pushyourluckdrawRoomId: null, tournamentToken: null, activeLobbyTab: null, msgCount: 0, msgWindowResetAt: 0, createCount: 0, createWindowResetAt: 0, ip } as Session,
      })
      return ok ? undefined : new Response('Upgrade failed', { status: 400 })
    }

    if (pathname.startsWith('/api/admin/')) return handleAdmin(req, url)
    if (pathname === '/api/tournament')    return handlePublicTournament(req, url)

    // ── Docs (dev only) ───────────────────────────────────────────────────────
    if (IS_DEV) {
      if (pathname === '/api/docs/openapi.json')
        return new Response(JSON.stringify(openapiSpec, null, 2), {
          headers: { 'Content-Type': 'application/json', ...cors() },
        })
      if (pathname === '/api/docs' || pathname === '/api/docs/')
        return new Response(swaggerUiHtml('/api/docs/openapi.json'), {
          headers: { 'Content-Type': 'text/html' },
        })
    }

    return jsonResp({ status: 'ok' })
  },

  websocket: {
    // Every real message is <= MAX_PAYLOAD_BYTES (512, see validation.ts) —
    // 4096 gives comfortable headroom for multi-byte UTF-8 room names/framing
    // overhead while still sitting ~4000x below Bun's 16MB default, so an
    // oversized frame gets rejected by Bun itself before message() even runs.
    maxPayloadLength: Number(process.env.WS_MAX_PAYLOAD_BYTES ?? 4096),
    // No client-side ping/heartbeat (see front/src/hooks/useSocket.ts) — a
    // seated, actively-playing connection gets steady traffic anyway (every
    // broadcast in its room resets this), so a short timeout only reaps
    // truly-dead half-open sockets (network dropped without a close frame)
    // faster than Bun's 120s default. A merely-idle browsing tab just
    // reconnects — useSocket.ts already does that automatically with backoff
    // and the server resumes its session on the next `hello`.
    idleTimeout: Number(process.env.WS_IDLE_TIMEOUT_SEC ?? 60),

    open(ws) {
      openConnections++
      // Subscribe so broadcastTournamentInfo() (server.publish('lobby', ...)) reaches
      // this socket — without this, clients only see tournament updates pushed at
      // connect time and never learn about a newly-created tournament until they
      // reload (new `hello` -> fresh tournament_info send). Also start subscribed to
      // every per-game room-list topic (see LOBBY_TOPICS) — narrowed down to just the
      // games this connection isn't seated in once `hello` restores its session below.
      ws.subscribe('lobby')
      for (const topic of Object.values(LOBBY_TOPICS)) ws.subscribe(topic)
      send(ws, { type: 'room_list', rooms: lobbyRoomList() })
      send(ws, { type: 'truco_room_list', rooms: trucoRoomList() })
      send(ws, { type: 'gaucho_room_list', rooms: gauchoRoomList() })
      send(ws, { type: 'canastra_room_list', rooms: canastraRoomList() })
      send(ws, { type: 'blackjack_lobby_stats', ...blackjackLobbyStats() })
      send(ws, { type: 'pushyourluckdraw_room_list', rooms: pushyourluckdrawRoomList() })
      send(ws, { type: 'tournament_info', tournament: activeTournament?.info() ?? null })
    },

    async message(ws, raw) {
      // Cheapest possible rejection — before even touching JSON.parse — for a
      // connection sending messages faster than any real client legitimately
      // would. See MAX_MESSAGES_PER_WINDOW above.
      const session = ws.data
      if (RATE_LIMIT_ENABLED) {
        const now = Date.now()
        if (now > session.msgWindowResetAt) { session.msgWindowResetAt = now + MESSAGE_WINDOW_MS; session.msgCount = 0 }
        session.msgCount++
        if (session.msgCount > MAX_MESSAGES_PER_WINDOW || ipMsgLimited(session.ip)) return
      }

      const msg: ClientMessage | null = parseClientMessage(raw)
      if (!msg) { send(ws, { type: 'error', message: 'Mensagem inválida.' }); return }

      // ── Room-creation rate limit ────────────────────────────────────────
      // Stricter and separate from the general per-connection budget above —
      // see CREATE_ROOM_TYPES / MAX_CREATES_PER_CONN / MAX_CREATES_PER_IP.
      // Silently dropped, same posture as the general limiter above: cheapest
      // possible rejection, no signal handed back to whoever is probing it.
      // Gated behind the same RATE_LIMIT_ENABLED flag as the general limiter
      // above — a loadtest run (see loadtest/) needs every WS rate limit off
      // at once, not just this one.
      if (RATE_LIMIT_ENABLED && CREATE_ROOM_TYPES.has(msg.type)) {
        const now = Date.now()
        if (now > session.createWindowResetAt) { session.createWindowResetAt = now + CREATE_WINDOW_MS; session.createCount = 0 }
        session.createCount++
        if (session.createCount > MAX_CREATES_PER_CONN || ipCreateLimited(session.ip)) return
      }

      const emit = (m: ServerMessage) => send(ws, m)

      // ── hello ────────────────────────────────────────────────────────────
      if (msg.type === 'hello') {
        // Verify the signed token. If missing or tampered, issue a fresh identity.
        let pid = msg.playerId ? await verifyToken(msg.playerId) : null
        if (!pid) {
          pid = newPlayerId()
          emit({ type: 'identity', token: await issueToken(pid) })
        }
        session.playerId        = pid
        session.name            = msg.name.trim().slice(0, 24) || 'Jogador'
        session.tournamentToken = msg.tournamentToken ?? null

        const existing = playerSessions.get(pid)
        if (existing) {
          // Reconnect to lobby room
          if (existing.roomId) {
            const room = rooms.get(existing.roomId)
            if (room && !room.tournamentId) {
              session.roomId = existing.roomId
              room.reconnect(pid, emit)
              emit({ type: 'session_restored', inTournament: false, roomId: room.id, roomName: room.name, config: room.config })
            } else {
              existing.roomId = null
            }
          }
          // Reconnect to Truco room
          if (existing.trucoRoomId) {
            const trucoRoom = trucoRooms.get(existing.trucoRoomId)
            if (trucoRoom) {
              session.trucoRoomId = existing.trucoRoomId
              trucoRoom.reconnect(pid, emit)
            } else {
              existing.trucoRoomId = null
            }
          }
          // Reconnect to Truco Gaúcho room
          if (existing.gauchoRoomId) {
            const gauchoRoom = gauchoRooms.get(existing.gauchoRoomId)
            if (gauchoRoom) {
              session.gauchoRoomId = existing.gauchoRoomId
              gauchoRoom.reconnect(pid, emit)
            } else {
              existing.gauchoRoomId = null
            }
          }
          // Reconnect to Canastra room
          if (existing.canastraRoomId) {
            const canastraRoom = canastraRooms.get(existing.canastraRoomId)
            if (canastraRoom) {
              session.canastraRoomId = existing.canastraRoomId
              canastraRoom.reconnect(pid, emit)
            } else {
              existing.canastraRoomId = null
            }
          }
          // Reconnect to Blackjack room
          if (existing.blackjackRoomId) {
            const blackjackRoom = blackjackRooms.get(existing.blackjackRoomId)
            if (blackjackRoom) {
              session.blackjackRoomId = existing.blackjackRoomId
              blackjackRoom.reconnect(pid, emit)
            } else {
              existing.blackjackRoomId = null
            }
          }
          // Reconnect to Push Your Luck Draw room
          if (existing.pushyourluckdrawRoomId) {
            const pushyourluckdrawRoom = pushyourluckdrawRooms.get(existing.pushyourluckdrawRoomId)
            if (pushyourluckdrawRoom) {
              session.pushyourluckdrawRoomId = existing.pushyourluckdrawRoomId
              pushyourluckdrawRoom.reconnect(pid, emit)
            } else {
              existing.pushyourluckdrawRoomId = null
            }
          }
          // Update send fn
          existing.name = session.name
          existing.lastSeenAt = Date.now()
          session.tournamentToken = session.tournamentToken ?? existing.tournamentToken
        } else {
          playerSessions.set(pid, { playerId: pid, name: session.name, roomId: null, trucoRoomId: null, gauchoRoomId: null, canastraRoomId: null, blackjackRoomId: null, pushyourluckdrawRoomId: null, tournamentToken: session.tournamentToken, lastSeenAt: Date.now() })
        }

        // Restore tournament registration
        const tToken = session.tournamentToken
        if (tToken) {
          const reg = activeTournament?.findByToken(tToken)
          if (reg && activeTournament) {
            activeTournament.updateSendFn(reg.playerId, emit)
            session.playerId = reg.playerId
            const tableId = activeTournament.getTableId(reg.playerId)
            const tRoom   = tableId ? rooms.get(tableId) : null
            if (tRoom) {
              session.roomId = tableId
              tRoom.reconnect(reg.playerId, emit)
              emit({ type: 'session_restored', inTournament: true, roomId: tRoom.id, roomName: tRoom.name, config: tRoom.config })
            } else {
              emit({ type: 'session_restored', inTournament: true })
            }
            emit({ type: 'tournament_info', tournament: activeTournament.info() })
            activeTournament.broadcastRanking()
          } else {
            // Token belongs to a tournament that no longer exists (finished &
            // replaced, or server restarted) — clear it so the client shows
            // the registration UI for whatever tournament is open now.
            session.tournamentToken = null
            setPersistentToken(session.playerId, null)
            emit({ type: 'tournament_unregistered' })
          }
        }

        // Counted under whatever playerId this connection ended up as (the
        // tournament-restore block above can reassign session.playerId) —
        // see markConnected()/PLAYER_SESSION_TTL_MS. Paired with
        // markDisconnected() in close().
        markConnected(session.playerId)

        // `activeLobbyTab` starts null on every fresh connection (reconnects
        // included — see the Session field doc) — this narrows subscriptions
        // down to just whichever games this session came back seated in
        // (none, right now) until the client's own `set_active_lobby`
        // arrives a moment later with its real active tab.
        syncLobbySubscription(ws, session, session.activeLobbyTab)
        return
      }

      if (!session.playerId) return

      switch (msg.type) {

        case 'set_name': {
          session.name = msg.name.trim().slice(0, 24) || 'Jogador'
          const ps = playerSessions.get(session.playerId)
          if (ps) ps.name = session.name
          break
        }

        case 'list_rooms':     emit({ type: 'room_list', rooms: lobbyRoomList() }); break
        case 'get_tournament': emit({ type: 'tournament_info', tournament: activeTournament?.info() ?? null }); break

        // ── Active lobby tab (see LOBBY_TOPICS / syncLobbySubscription) ─────
        case 'set_active_lobby':
          syncLobbySubscription(ws, session, msg.game)
          emit(lobbySnapshotFor(msg.game))
          break

        // ── Create lobby room ───────────────────────────────────────────────
        // No flat cap on concurrent rooms — see the create-room rate limit
        // above (CREATE_ROOM_TYPES) for what actually guards this now.
        case 'create_room': {
          const room = new Room(generateId(), msg.roomName.trim().slice(0, 40) || 'Mesa', session.name, msg.config, {
            onExpire: () => { rooms.delete(room.id); broadcastRoomList() },
          })
          rooms.set(room.id, room)
          room.join(session.playerId, session.name, emit)   // creator auto-joins
          session.roomId = room.id
          setPersistentRoom(session.playerId, room.id)
          syncLobbySubscription(ws, session, session.activeLobbyTab)
          broadcastRoomList()
          break
        }

        // ── Join lobby room (mid-game allowed) ──────────────────────────────
        case 'join_room': {
          const room = rooms.get(msg.roomId)
          if (!room)          { emit({ type: 'room_error', message: 'Sala não encontrada.' }); break }
          if (room.isFull)    { emit({ type: 'room_error', message: 'Sala cheia.' }); break }
          if (room.tournamentId) { emit({ type: 'room_error', message: 'Mesa de torneio.' }); break }
          if (session.roomId) leaveRoom(ws)
          room.join(session.playerId, session.name, emit)
          session.roomId = room.id
          setPersistentRoom(session.playerId, room.id)
          syncLobbySubscription(ws, session, session.activeLobbyTab)
          broadcastRoomList()
          break
        }

        case 'leave_room':
          leaveRoom(ws)
          emit({ type: 'room_left' })
          break

        case 'start_game': {
          const room = currentRoom(session)
          room?.startGame(session.playerId)
          break
        }

        case 'player_action': {
          const room = currentRoom(session)
          room?.handleAction(session.playerId, msg.action, msg.amount)
          break
        }

        // ── Rebuy (lobby-only) ──────────────────────────────────────────────
        case 'rebuy': {
          const room = session.roomId ? rooms.get(session.roomId) : undefined
          if (room && !room.tournamentId) room.handleRebuy(session.playerId)
          break
        }

        case 'rebuy_decline': {
          const room = session.roomId ? rooms.get(session.roomId) : undefined
          if (room && !room.tournamentId) {
            room.handleRebuyDecline(session.playerId)
            session.roomId = null
            setPersistentRoom(session.playerId, null)
            broadcastRoomList()
          }
          break
        }

        // ── Away (tournament tables only) ───────────────────────────────────
        case 'set_away': {
          const room = currentRoom(session)
          if (room?.tournamentId) room.setAway(session.playerId)
          break
        }
        case 'set_back': {
          const room = currentRoom(session)
          if (room?.tournamentId) room.setBack(session.playerId)
          break
        }

        // ── Truco ────────────────────────────────────────────────────────────
        case 'truco_list_rooms': emit({ type: 'truco_room_list', rooms: trucoRoomList() }); break

        case 'truco_create_room': {
          const room = new TrucoRoom(generateId(), msg.roomName.trim().slice(0, 40) || 'Mesa', session.name, msg.config, {
            onExpire: () => { trucoRooms.delete(room.id); broadcastTrucoRoomList() },
            onDissolve: () => { trucoRooms.delete(room.id); broadcastTrucoRoomList() },
          })
          trucoRooms.set(room.id, room)
          room.join(session.playerId, session.name, emit)   // creator auto-joins
          session.trucoRoomId = room.id
          setPersistentTrucoRoom(session.playerId, room.id)
          syncLobbySubscription(ws, session, session.activeLobbyTab)
          broadcastTrucoRoomList()
          break
        }

        case 'truco_join_room': {
          const room = trucoRooms.get(msg.roomId)
          if (!room)       { emit({ type: 'truco_room_error', message: 'Mesa não encontrada.' }); break }
          if (room.isFull) { emit({ type: 'truco_room_error', message: 'Mesa cheia.' }); break }
          if (room.isStarted) { emit({ type: 'truco_room_error', message: 'Partida em andamento.' }); break }
          if (session.trucoRoomId) leaveTrucoRoom(ws)
          room.join(session.playerId, session.name, emit)
          session.trucoRoomId = room.id
          setPersistentTrucoRoom(session.playerId, room.id)
          syncLobbySubscription(ws, session, session.activeLobbyTab)
          broadcastTrucoRoomList()
          break
        }

        case 'truco_leave_room':
          leaveTrucoRoom(ws)
          emit({ type: 'truco_room_left', reason: 'manual' })
          break

        case 'truco_play_card': {
          const room = currentTrucoRoom(session)
          room?.handlePlayCard(session.playerId, msg.card)
          break
        }

        case 'truco_call_truco': {
          const room = currentTrucoRoom(session)
          room?.handleCallTruco(session.playerId)
          break
        }

        case 'truco_respond': {
          const room = currentTrucoRoom(session)
          room?.handleRespond(session.playerId, msg.accept)
          break
        }

        case 'truco_mao_de_onze_decision': {
          const room = currentTrucoRoom(session)
          room?.handleMaoDeOnzeDecision(session.playerId, msg.accept)
          break
        }

        case 'truco_rematch_vote': {
          const room = currentTrucoRoom(session)
          room?.handleRematchVote(session.playerId, msg.accept)
          break
        }

        // ── Truco Gaúcho ─────────────────────────────────────────────────────
        case 'gaucho_list_rooms': emit({ type: 'gaucho_room_list', rooms: gauchoRoomList() }); break

        case 'gaucho_create_room': {
          const room = new GauchoRoom(generateId(), msg.roomName.trim().slice(0, 40) || 'Mesa', session.name, msg.config, {
            onExpire: () => { gauchoRooms.delete(room.id); broadcastGauchoRoomList() },
            onDissolve: () => { gauchoRooms.delete(room.id); broadcastGauchoRoomList() },
          })
          gauchoRooms.set(room.id, room)
          room.join(session.playerId, session.name, emit)   // creator auto-joins
          session.gauchoRoomId = room.id
          setPersistentGauchoRoom(session.playerId, room.id)
          syncLobbySubscription(ws, session, session.activeLobbyTab)
          broadcastGauchoRoomList()
          break
        }

        case 'gaucho_join_room': {
          const room = gauchoRooms.get(msg.roomId)
          if (!room)       { emit({ type: 'gaucho_room_error', message: 'Mesa não encontrada.' }); break }
          if (room.isFull) { emit({ type: 'gaucho_room_error', message: 'Mesa cheia.' }); break }
          if (room.isStarted) { emit({ type: 'gaucho_room_error', message: 'Partida em andamento.' }); break }
          if (session.gauchoRoomId) leaveGauchoRoom(ws)
          room.join(session.playerId, session.name, emit)
          session.gauchoRoomId = room.id
          setPersistentGauchoRoom(session.playerId, room.id)
          syncLobbySubscription(ws, session, session.activeLobbyTab)
          broadcastGauchoRoomList()
          break
        }

        case 'gaucho_leave_room':
          leaveGauchoRoom(ws)
          emit({ type: 'gaucho_room_left', reason: 'manual' })
          break

        case 'gaucho_play_card': {
          const room = currentGauchoRoom(session)
          room?.handlePlayCard(session.playerId, msg.card)
          break
        }

        case 'gaucho_call_truco': {
          const room = currentGauchoRoom(session)
          room?.handleCallTruco(session.playerId)
          break
        }

        case 'gaucho_respond_truco': {
          const room = currentGauchoRoom(session)
          room?.handleRespondTruco(session.playerId, msg.accept)
          break
        }

        case 'gaucho_call_envido': {
          const room = currentGauchoRoom(session)
          room?.handleCallEnvido(session.playerId)
          break
        }

        case 'gaucho_respond_envido': {
          const room = currentGauchoRoom(session)
          room?.handleRespondEnvido(session.playerId, msg.accept)
          break
        }

        case 'gaucho_call_flor': {
          const room = currentGauchoRoom(session)
          room?.handleCallFlor(session.playerId)
          break
        }

        case 'gaucho_respond_flor': {
          const room = currentGauchoRoom(session)
          room?.handleRespondFlor(session.playerId, msg.accept)
          break
        }

        case 'gaucho_mao_de_onze_decision': {
          const room = currentGauchoRoom(session)
          room?.handleMaoDeOnzeDecision(session.playerId, msg.accept)
          break
        }

        case 'gaucho_rematch_vote': {
          const room = currentGauchoRoom(session)
          room?.handleRematchVote(session.playerId, msg.accept)
          break
        }

        // ── Canastra / Buraco ────────────────────────────────────────────────
        case 'canastra_list_rooms': emit({ type: 'canastra_room_list', rooms: canastraRoomList() }); break

        case 'canastra_create_room': {
          const room = new CanastraRoom(generateId(), msg.roomName.trim().slice(0, 40) || 'Mesa', session.name, msg.config, {
            onExpire: () => { canastraRooms.delete(room.id); broadcastCanastraRoomList() },
            onDissolve: () => { canastraRooms.delete(room.id); broadcastCanastraRoomList() },
          })
          canastraRooms.set(room.id, room)
          room.join(session.playerId, session.name, emit)   // creator auto-joins
          session.canastraRoomId = room.id
          setPersistentCanastraRoom(session.playerId, room.id)
          syncLobbySubscription(ws, session, session.activeLobbyTab)
          broadcastCanastraRoomList()
          break
        }

        case 'canastra_join_room': {
          const room = canastraRooms.get(msg.roomId)
          if (!room)       { emit({ type: 'canastra_room_error', message: 'Mesa não encontrada.' }); break }
          if (room.isFull) { emit({ type: 'canastra_room_error', message: 'Mesa cheia.' }); break }
          if (room.isStarted) { emit({ type: 'canastra_room_error', message: 'Partida em andamento.' }); break }
          if (session.canastraRoomId) leaveCanastraRoom(ws)
          room.join(session.playerId, session.name, emit)
          session.canastraRoomId = room.id
          setPersistentCanastraRoom(session.playerId, room.id)
          syncLobbySubscription(ws, session, session.activeLobbyTab)
          broadcastCanastraRoomList()
          break
        }

        case 'canastra_leave_room':
          leaveCanastraRoom(ws)
          emit({ type: 'canastra_room_left', reason: 'manual' })
          break

        case 'canastra_draw_stock': {
          const room = currentCanastraRoom(session)
          room?.handleDrawStock(session.playerId)
          break
        }

        case 'canastra_take_discard': {
          const room = currentCanastraRoom(session)
          room?.handleTakeDiscard(session.playerId, msg.meldPlan)
          break
        }

        case 'canastra_lay_meld': {
          const room = currentCanastraRoom(session)
          room?.handleLayMeld(session.playerId, msg.cardIds)
          break
        }

        case 'canastra_add_to_meld': {
          const room = currentCanastraRoom(session)
          room?.handleAddToMeld(session.playerId, msg.meldId, msg.cardIds)
          break
        }

        case 'canastra_discard': {
          const room = currentCanastraRoom(session)
          room?.handleDiscard(session.playerId, msg.cardId)
          break
        }

        case 'canastra_rematch_vote': {
          const room = currentCanastraRoom(session)
          room?.handleRematchVote(session.playerId, msg.accept)
          break
        }

        // ── Blackjack / 21 ───────────────────────────────────────────────────
        case 'blackjack_join': {
          if (session.blackjackRoomId) break // already seated
          const room = findOrCreateBlackjackRoom()
          room.join(session.playerId, session.name, emit)
          session.blackjackRoomId = room.id
          setPersistentBlackjackRoom(session.playerId, room.id)
          syncLobbySubscription(ws, session, session.activeLobbyTab)
          break
        }

        case 'blackjack_leave_room':
          leaveBlackjackRoom(ws)
          emit({ type: 'blackjack_room_left', reason: 'manual' })
          break

        case 'blackjack_place_bet': {
          const room = currentBlackjackRoom(session)
          room?.handlePlaceBet(session.playerId, msg.amount)
          break
        }

        case 'blackjack_insurance_bet': {
          const room = currentBlackjackRoom(session)
          room?.handlePlaceInsurance(session.playerId, msg.amount)
          break
        }

        case 'blackjack_hit': {
          const room = currentBlackjackRoom(session)
          room?.handleHit(session.playerId)
          break
        }

        case 'blackjack_stand': {
          const room = currentBlackjackRoom(session)
          room?.handleStand(session.playerId)
          break
        }

        case 'blackjack_double': {
          const room = currentBlackjackRoom(session)
          room?.handleDouble(session.playerId)
          break
        }

        case 'blackjack_split': {
          const room = currentBlackjackRoom(session)
          room?.handleSplit(session.playerId)
          break
        }

        // ── Push Your Luck Draw ───────────────────────────────────────────
        case 'pushyourluckdraw_list_rooms': emit({ type: 'pushyourluckdraw_room_list', rooms: pushyourluckdrawRoomList() }); break

        case 'pushyourluckdraw_create_room': {
          const room = new PushYourLuckDrawRoom(generateId(), msg.roomName.trim().slice(0, 40) || 'Mesa', session.name, msg.config, {
            onExpire: () => { pushyourluckdrawRooms.delete(room.id); broadcastPushYourLuckDrawRoomList() },
            onDissolve: () => { pushyourluckdrawRooms.delete(room.id); broadcastPushYourLuckDrawRoomList() },
          })
          pushyourluckdrawRooms.set(room.id, room)
          room.join(session.playerId, session.name, emit)   // creator auto-joins
          session.pushyourluckdrawRoomId = room.id
          setPersistentPushYourLuckDrawRoom(session.playerId, room.id)
          syncLobbySubscription(ws, session, session.activeLobbyTab)
          broadcastPushYourLuckDrawRoomList()
          break
        }

        case 'pushyourluckdraw_join_room': {
          const room = pushyourluckdrawRooms.get(msg.roomId)
          if (!room)       { emit({ type: 'pushyourluckdraw_room_error', message: 'Mesa não encontrada.' }); break }
          if (room.isFull) { emit({ type: 'pushyourluckdraw_room_error', message: 'Mesa cheia.' }); break }
          // Family-friendly drop-in: joining mid-match (even mid-round) is allowed
          // as long as there's a free seat — see .claude/PushYourLuckDraw.md.
          if (session.pushyourluckdrawRoomId) leavePushYourLuckDrawRoom(ws)
          room.join(session.playerId, session.name, emit)
          session.pushyourluckdrawRoomId = room.id
          setPersistentPushYourLuckDrawRoom(session.playerId, room.id)
          syncLobbySubscription(ws, session, session.activeLobbyTab)
          broadcastPushYourLuckDrawRoomList()
          break
        }

        case 'pushyourluckdraw_leave_room':
          // room.leave() already messages the leaving player directly (see
          // pushyourluckdrawRoom.ts) — the table no longer dissolves on a
          // mid-match leave, so it can't rely on a broadcastAll() reaching them.
          leavePushYourLuckDrawRoom(ws)
          break

        case 'pushyourluckdraw_start_game': {
          const room = currentPushYourLuckDrawRoom(session)
          room?.startMatch(session.playerId)
          break
        }

        case 'pushyourluckdraw_draw': {
          const room = currentPushYourLuckDrawRoom(session)
          room?.handleDraw(session.playerId)
          break
        }

        case 'pushyourluckdraw_stop': {
          const room = currentPushYourLuckDrawRoom(session)
          room?.handleStop(session.playerId)
          break
        }

        case 'pushyourluckdraw_throw_joker': {
          const room = currentPushYourLuckDrawRoom(session)
          room?.handleThrowJoker(session.playerId, msg.targetId)
          break
        }

        case 'pushyourluckdraw_rematch_vote': {
          const room = currentPushYourLuckDrawRoom(session)
          room?.handleRematchVote(session.playerId, msg.accept)
          break
        }

        // ── Tournament registration ─────────────────────────────────────────
        case 'register_tournament': {
          if (!activeTournament) { emit({ type: 'tournament_error', message: 'Nenhum torneio disponível.' }); break }
          if (activeTournament.status !== 'registering') { emit({ type: 'tournament_error', message: 'Inscrições encerradas.' }); break }
          if (activeTournament.isRegistered(session.playerId)) break
          const token = randomToken(24)
          activeTournament.register(session.playerId, session.name, emit, token)
          session.tournamentToken = token
          setPersistentToken(session.playerId, token)
          broadcastTournamentInfo()
          break
        }

        case 'unregister_tournament': {
          if (activeTournament?.status !== 'registering') break
          activeTournament.unregister(session.playerId)
          session.tournamentToken = null
          setPersistentToken(session.playerId, null)
          emit({ type: 'tournament_unregistered' })
          broadcastTournamentInfo()
          break
        }
      }
    },

    close(ws) {
      openConnections--
      logger.info('player_disconnected', { 'poker.player_id': ws.data.playerId || null })
      if (ws.data.playerId) {
        markDisconnected(ws.data.playerId)
        const ps = playerSessions.get(ws.data.playerId)
        // Refresh the TTL clock to "time of last disconnect" — see the
        // PLAYER_SESSION_TTL_MS sweep near playerSessions' declaration.
        if (ps) ps.lastSeenAt = Date.now()
      }
      // Lobby players stay in their room (persistent session handles reconnect)
      // Tournament players stay registered via token cookie
      // Blackjack: a real disconnect briefly holds the seat/bet instead of an
      // instant forfeit — the existing betting/insurance/turn timers already
      // auto-resolve anything that needs their input either way, so the table
      // never stalls; this only changes whether a brief drop costs the bet.
      // See BlackjackRoom.handleDisconnect() / .claude/Blackjack.md → "Sair da mesa".
      if (ws.data.blackjackRoomId) disconnectBlackjackPlayer(ws)
      // Push Your Luck Draw: also treated as leaving immediately (table stays
      // open for whoever's left, never dissolves on just one departure), but
      // unlike Blackjack the match score is preserved for a same-match rejoin
      // — see .claude/PushYourLuckDraw.md → "Desconexão".
      if (ws.data.pushyourluckdrawRoomId) disconnectPushYourLuckDrawPlayer(ws)
    },
  },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function leaveRoom(ws: { data: Session; subscribe: (topic: string) => void; unsubscribe: (topic: string) => void }): void {
  const { playerId, roomId } = ws.data
  if (!roomId) return
  const room = rooms.get(roomId)
  if (room && !room.tournamentId) {
    room.leave(playerId)
    if (room.playerCount === 0) { room.destroy(); rooms.delete(roomId) }
  }
  ws.data.roomId = null
  setPersistentRoom(playerId, null)
  syncLobbySubscription(ws, ws.data, ws.data.activeLobbyTab)
  broadcastRoomList()
}

function setPersistentRoom(pid: string, roomId: string | null): void {
  const ps = playerSessions.get(pid)
  if (ps) ps.roomId = roomId
}

function leaveTrucoRoom(ws: { data: Session; subscribe: (topic: string) => void; unsubscribe: (topic: string) => void }): void {
  const { playerId, trucoRoomId } = ws.data
  if (!trucoRoomId) return
  const room = trucoRooms.get(trucoRoomId)
  if (room) {
    room.leave(playerId)
    if (room.playerCount === 0) { room.destroy(); trucoRooms.delete(trucoRoomId) }
  }
  ws.data.trucoRoomId = null
  setPersistentTrucoRoom(playerId, null)
  syncLobbySubscription(ws, ws.data, ws.data.activeLobbyTab)
  broadcastTrucoRoomList()
}

function setPersistentTrucoRoom(pid: string, trucoRoomId: string | null): void {
  const ps = playerSessions.get(pid)
  if (ps) ps.trucoRoomId = trucoRoomId
}

function leaveGauchoRoom(ws: { data: Session; subscribe: (topic: string) => void; unsubscribe: (topic: string) => void }): void {
  const { playerId, gauchoRoomId } = ws.data
  if (!gauchoRoomId) return
  const room = gauchoRooms.get(gauchoRoomId)
  if (room) {
    room.leave(playerId)
    if (room.playerCount === 0) { room.destroy(); gauchoRooms.delete(gauchoRoomId) }
  }
  ws.data.gauchoRoomId = null
  setPersistentGauchoRoom(playerId, null)
  syncLobbySubscription(ws, ws.data, ws.data.activeLobbyTab)
  broadcastGauchoRoomList()
}

function setPersistentGauchoRoom(pid: string, gauchoRoomId: string | null): void {
  const ps = playerSessions.get(pid)
  if (ps) ps.gauchoRoomId = gauchoRoomId
}

function leaveCanastraRoom(ws: { data: Session; subscribe: (topic: string) => void; unsubscribe: (topic: string) => void }): void {
  const { playerId, canastraRoomId } = ws.data
  if (!canastraRoomId) return
  const room = canastraRooms.get(canastraRoomId)
  if (room) {
    room.leave(playerId)
    if (room.playerCount === 0) { room.destroy(); canastraRooms.delete(canastraRoomId) }
  }
  ws.data.canastraRoomId = null
  setPersistentCanastraRoom(playerId, null)
  syncLobbySubscription(ws, ws.data, ws.data.activeLobbyTab)
  broadcastCanastraRoomList()
}

function setPersistentCanastraRoom(pid: string, canastraRoomId: string | null): void {
  const ps = playerSessions.get(pid)
  if (ps) ps.canastraRoomId = canastraRoomId
}

/** Explicit "Sair da mesa" only (the `blackjack_leave_room` message) — a real
 *  disconnect goes through disconnectBlackjackPlayer() below instead, which
 *  gives a brief grace period rather than an instant forfeit. */
function leaveBlackjackRoom(ws: { data: Session; subscribe: (topic: string) => void; unsubscribe: (topic: string) => void }): void {
  const { playerId, blackjackRoomId } = ws.data
  if (!blackjackRoomId) return
  const room = blackjackRooms.get(blackjackRoomId)
  if (room) {
    room.leave(playerId)
    if (room.playerCount === 0) { room.destroy(); blackjackRooms.delete(blackjackRoomId) }
  }
  ws.data.blackjackRoomId = null
  setPersistentBlackjackRoom(playerId, null)
  syncLobbySubscription(ws, ws.data, ws.data.activeLobbyTab)
}

/** A real disconnect (closed tab/app) — see close() above and
 *  BlackjackRoom.handleDisconnect(). Deliberately does NOT touch
 *  `ws.data.blackjackRoomId` or the persistent session's copy of it: unlike
 *  every other leave path, we want a later `hello` to still find this player
 *  "in" the room so it reconnects them, for as long as the room itself keeps
 *  their seat reserved. Only once the grace period actually expires (the
 *  `onExpire` callback) do we clear the persistent session, mirroring what
 *  leaveBlackjackRoom() does immediately for an explicit leave. */
function disconnectBlackjackPlayer(ws: { data: Session }): void {
  const { playerId, blackjackRoomId } = ws.data
  if (!blackjackRoomId) return
  const room = blackjackRooms.get(blackjackRoomId)
  if (!room) return
  room.handleDisconnect(playerId, () => {
    const ps = playerSessions.get(playerId)
    if (ps) ps.blackjackRoomId = null
    if (room.playerCount === 0) { room.destroy(); blackjackRooms.delete(blackjackRoomId) }
  })
}

function setPersistentBlackjackRoom(pid: string, blackjackRoomId: string | null): void {
  const ps = playerSessions.get(pid)
  if (ps) ps.blackjackRoomId = blackjackRoomId
}

function leavePushYourLuckDrawRoom(ws: { data: Session; subscribe: (topic: string) => void; unsubscribe: (topic: string) => void }): void {
  const { playerId, pushyourluckdrawRoomId } = ws.data
  if (!pushyourluckdrawRoomId) return
  const room = pushyourluckdrawRooms.get(pushyourluckdrawRoomId)
  if (room) {
    room.leave(playerId)
    if (room.playerCount === 0) { room.destroy(); pushyourluckdrawRooms.delete(pushyourluckdrawRoomId) }
  }
  ws.data.pushyourluckdrawRoomId = null
  setPersistentPushYourLuckDrawRoom(playerId, null)
  syncLobbySubscription(ws, ws.data, ws.data.activeLobbyTab)
  broadcastPushYourLuckDrawRoomList()
}

/** WS close counts as an immediate departure (score preserved for a
 *  same-match rejoin) — see close() above and .claude/PushYourLuckDraw.md
 *  → "Desconexão". Clearing the persistent room id here (unlike every other
 *  game) is deliberate: they're actually gone from `room.players` now, so a
 *  later `hello` must NOT auto-reconnect them — it should land them back in
 *  the lobby, where re-joining the same room restores their score. */
function disconnectPushYourLuckDrawPlayer(ws: { data: Session; subscribe: (topic: string) => void; unsubscribe: (topic: string) => void }): void {
  const { playerId, pushyourluckdrawRoomId } = ws.data
  if (!pushyourluckdrawRoomId) return
  const room = pushyourluckdrawRooms.get(pushyourluckdrawRoomId)
  if (room) {
    room.handleDisconnect(playerId)
    if (room.playerCount === 0) { room.destroy(); pushyourluckdrawRooms.delete(pushyourluckdrawRoomId) }
  }
  ws.data.pushyourluckdrawRoomId = null
  setPersistentPushYourLuckDrawRoom(playerId, null)
  // Called from close() — the socket's already going away, so this is a
  // harmless no-op, kept only for consistency with leavePushYourLuckDrawRoom().
  syncLobbySubscription(ws, ws.data, ws.data.activeLobbyTab)
  broadcastPushYourLuckDrawRoomList()
}

function setPersistentPushYourLuckDrawRoom(pid: string, pushyourluckdrawRoomId: string | null): void {
  const ps = playerSessions.get(pid)
  if (ps) ps.pushyourluckdrawRoomId = pushyourluckdrawRoomId
}

function setPersistentToken(pid: string, token: string | null): void {
  const ps = playerSessions.get(pid)
  if (ps) ps.tournamentToken = token
}

function lobbyRoomList()  { return [...rooms.values()].filter(r => !r.tournamentId).map(r => r.summary()) }
function trucoRoomList()  { return [...trucoRooms.values()].map(r => r.summary()) }
function gauchoRoomList() { return [...gauchoRooms.values()].map(r => r.summary()) }
function canastraRoomList() { return [...canastraRooms.values()].map(r => r.summary()) }
function pushyourluckdrawRoomList() { return [...pushyourluckdrawRooms.values()].map(r => r.summary()) }

function broadcastRoomList(): void {
  server.publish(LOBBY_TOPICS.poker, JSON.stringify({ type: 'room_list', rooms: lobbyRoomList() } satisfies ServerMessage))
}
function broadcastTrucoRoomList(): void {
  server.publish(LOBBY_TOPICS.truco, JSON.stringify({ type: 'truco_room_list', rooms: trucoRoomList() } satisfies ServerMessage))
}
function broadcastGauchoRoomList(): void {
  server.publish(LOBBY_TOPICS.gaucho, JSON.stringify({ type: 'gaucho_room_list', rooms: gauchoRoomList() } satisfies ServerMessage))
}
function broadcastCanastraRoomList(): void {
  server.publish(LOBBY_TOPICS.canastra, JSON.stringify({ type: 'canastra_room_list', rooms: canastraRoomList() } satisfies ServerMessage))
}
function broadcastPushYourLuckDrawRoomList(): void {
  server.publish(LOBBY_TOPICS.pushyourluckdraw, JSON.stringify({ type: 'pushyourluckdraw_room_list', rooms: pushyourluckdrawRoomList() } satisfies ServerMessage))
}
function blackjackLobbyStats(): { tableCount: number; playerCount: number } {
  let playerCount = 0
  for (const r of blackjackRooms.values()) playerCount += r.playerCount
  return { tableCount: blackjackRooms.size, playerCount }
}
function broadcastBlackjackLobbyStats(): void {
  server.publish(LOBBY_TOPICS.blackjack, JSON.stringify({ type: 'blackjack_lobby_stats', ...blackjackLobbyStats() } satisfies ServerMessage))
}

function sumPlayers(map: Map<string, { playerCount: number }>): number {
  let total = 0
  for (const r of map.values()) total += r.playerCount
  return total
}

/** Live snapshot for the admin metrics tab — active tables/players read
 *  straight off the room Maps (so they're always current, no separate
 *  bookkeeping needed), merged with the since-boot cumulative counters from
 *  ./metrics.ts. Poker's counts include tournament tables alongside regular
 *  lobby ones (unlike lobbyRoomList()) — for "how much load is this game
 *  generating right now" both count the same. */
function getAdminMetrics() {
  return {
    uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
    openConnections,
    games: {
      poker:            { activeTables: rooms.size,              activePlayers: sumPlayers(rooms),              ...gameMetrics.poker },
      truco:            { activeTables: trucoRooms.size,         activePlayers: sumPlayers(trucoRooms),         ...gameMetrics.truco },
      gaucho:           { activeTables: gauchoRooms.size,        activePlayers: sumPlayers(gauchoRooms),        ...gameMetrics.gaucho },
      canastra:         { activeTables: canastraRooms.size,      activePlayers: sumPlayers(canastraRooms),      ...gameMetrics.canastra },
      blackjack:        { activeTables: blackjackRooms.size,     activePlayers: sumPlayers(blackjackRooms),     ...gameMetrics.blackjack },
      pushyourluckdraw: { activeTables: pushyourluckdrawRooms.size, activePlayers: sumPlayers(pushyourluckdrawRooms), ...gameMetrics.pushyourluckdraw },
    },
  }
}

function isSeatedIn(session: Session, game: LobbyGame): boolean {
  switch (game) {
    case 'poker':            return session.roomId !== null
    case 'truco':             return session.trucoRoomId !== null
    case 'gaucho':            return session.gauchoRoomId !== null
    case 'canastra':          return session.canastraRoomId !== null
    case 'blackjack':         return session.blackjackRoomId !== null
    case 'pushyourluckdraw':  return session.pushyourluckdrawRoomId !== null
  }
}

function lobbySnapshotFor(game: LobbyGame): ServerMessage {
  switch (game) {
    case 'poker':            return { type: 'room_list', rooms: lobbyRoomList() }
    case 'truco':             return { type: 'truco_room_list', rooms: trucoRoomList() }
    case 'gaucho':            return { type: 'gaucho_room_list', rooms: gauchoRoomList() }
    case 'canastra':          return { type: 'canastra_room_list', rooms: canastraRoomList() }
    case 'blackjack':         return { type: 'blackjack_lobby_stats', ...blackjackLobbyStats() }
    case 'pushyourluckdraw':  return { type: 'pushyourluckdraw_room_list', rooms: pushyourluckdrawRoomList() }
  }
}

/** Single source of truth for a connection's lobby subscriptions — records
 *  `game` as the session's active lobby tab, then subscribes to just that
 *  one topic (skipped if the player is already seated in that specific
 *  game's room — they need its live table updates, not its lobby list) and
 *  unsubscribes from the other five. Called both from `set_active_lobby`
 *  (tab switches) and from every join/create/leave handler below (seating
 *  changes) — either kind of change can flip whether the *current* tab's
 *  subscription should be on. */
function syncLobbySubscription(
  ws: { subscribe: (topic: string) => void; unsubscribe: (topic: string) => void },
  session: Session,
  game: LobbyGame | null,
): void {
  session.activeLobbyTab = game
  for (const key of Object.keys(LOBBY_TOPICS) as LobbyGame[]) {
    if (key === game && !isSeatedIn(session, key)) ws.subscribe(LOBBY_TOPICS[key])
    else ws.unsubscribe(LOBBY_TOPICS[key])
  }
}
function broadcastTournamentInfo(): void {
  server.publish('lobby', JSON.stringify({ type: 'tournament_info', tournament: activeTournament?.info() ?? null } satisfies ServerMessage))
}

logger.info('server_started', { 'poker.port': server.port, 'poker.url': `http://localhost:${server.port}` })

/** Warn every connected client before this process actually goes down (deploy,
 *  restart, `docker stop`) — without this, a redeploy just silently kills
 *  every live game mid-hand and looks like a bug rather than an expected
 *  restart. `'lobby'` is still the one topic every connection stays
 *  subscribed to for its whole lifetime (see LOBBY_TOPICS above), so this
 *  reaches everyone regardless of which game-specific topics they're on. A
 *  short delay before exit gives the message an actual chance to flush over
 *  the wire instead of racing the process teardown. */
async function shutdown(): Promise<void> {
  server.publish('lobby', JSON.stringify({ type: 'server_restarting' } satisfies ServerMessage))
  await shutdownTelemetry()
  setTimeout(() => process.exit(0), 250)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
