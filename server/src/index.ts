// ⚠️  telemetry MUST be the very first import so OTel hooks activate before
//     any application modules load. Do not move this line.
import { startTelemetry, shutdownTelemetry } from './telemetry'
startTelemetry()

import type { ClientMessage, ServerMessage } from '../../shared/types'
import { parseClientMessage } from './validation'
import { issueToken, verifyToken, newPlayerId } from './identity'
import { openapiSpec, swaggerUiHtml } from './openapi'
import { logger } from './logger'

const IS_DEV = process.env.NODE_ENV !== 'production'
import { Room } from './room'
import { Tournament } from './tournament'
import { adminRouter, publicTournamentHandler } from './admin'

const MAX_LOBBY_ROOMS = Number(process.env.MAX_LOBBIES ?? 30)

const rooms = new Map<string, Room>()
let activeTournament: Tournament | null = null

// ── Persistent player sessions (survive WS reconnect) ─────────────────────────
interface PersistentSession {
  playerId: string
  name: string
  roomId: string | null
  tournamentToken: string | null
}
const playerSessions = new Map<string, PersistentSession>()

// ── WS session (ephemeral, per connection) ────────────────────────────────────
interface Session {
  playerId: string
  name: string
  roomId: string | null
  tournamentToken: string | null
}

function generateId(): string { return Math.random().toString(36).slice(2, 10) }

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

// ── Admin callbacks ───────────────────────────────────────────────────────────

const handleAdmin = adminRouter(
  () => activeTournament?.info() ?? null,

  (data) => {
    if (activeTournament && activeTournament.status !== 'finished')
      return { ok: false, error: 'Já existe um torneio ativo.' }
    try {
      const scheduledStart = new Date(data.scheduledStart)
      if (isNaN(scheduledStart.getTime())) return { ok: false, error: 'Data inválida.' }
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
    activeTournament.start(); broadcastTournamentInfo(); return { ok: true }
  },

  () => {
    if (!activeTournament) return { ok: false, error: 'Nenhum torneio.' }
    if (activeTournament.status === 'running' || activeTournament.status === 'final_table')
      return { ok: false, error: 'Torneio em andamento.' }
    activeTournament.destroy(); activeTournament = null
    broadcastTournamentInfo(); return { ok: true }
  },
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
      const ok = server.upgrade(req, {
        data: { playerId: '', name: 'Jogador', roomId: null, tournamentToken: null } as Session,
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
    open(ws) {
      // Subscribe so broadcastRoomList()/broadcastTournamentInfo() (server.publish('lobby', ...))
      // reach this socket — without this, clients only see lobby/tournament updates
      // pushed at connect time and never learn about a newly-created tournament
      // until they reload (new `hello` -> fresh tournament_info send).
      ws.subscribe('lobby')
      send(ws, { type: 'room_list', rooms: lobbyRoomList() })
      send(ws, { type: 'tournament_info', tournament: activeTournament?.info() ?? null })
    },

    async message(ws, raw) {
      const msg: ClientMessage | null = parseClientMessage(raw)
      if (!msg) { send(ws, { type: 'error', message: 'Mensagem inválida.' }); return }

      const session = ws.data
      const emit    = (m: ServerMessage) => send(ws, m)

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
          // Update send fn
          existing.name = session.name
          session.tournamentToken = session.tournamentToken ?? existing.tournamentToken
        } else {
          playerSessions.set(pid, { playerId: pid, name: session.name, roomId: null, tournamentToken: session.tournamentToken })
        }

        // Restore tournament registration
        const tToken = session.tournamentToken
        if (tToken && activeTournament) {
          const reg = activeTournament.findByToken(tToken)
          if (reg) {
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
          }
        }
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

        // ── Create lobby room ───────────────────────────────────────────────
        case 'create_room': {
          if (lobbyRoomCount() >= MAX_LOBBY_ROOMS) {
            emit({ type: 'room_error', message: `Limite de ${MAX_LOBBY_ROOMS} salas atingido.` }); break
          }
          const room = new Room(generateId(), msg.roomName.trim().slice(0, 40) || 'Mesa', session.name, msg.config, {
            onExpire: () => { rooms.delete(room.id); broadcastRoomList() },
          })
          rooms.set(room.id, room)
          room.join(session.playerId, session.name, emit)   // creator auto-joins
          session.roomId = room.id
          setPersistentRoom(session.playerId, room.id)
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
          broadcastRoomList()
          break
        }

        case 'leave_room':
          leaveRoom(ws)
          emit({ type: 'room_left' })
          break

        case 'start_game': {
          const room = session.roomId ? rooms.get(session.roomId) : undefined
          room?.startGame(session.playerId)
          break
        }

        case 'player_action': {
          const room = session.roomId ? rooms.get(session.roomId) : undefined
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
          const room = session.roomId ? rooms.get(session.roomId) : undefined
          if (room?.tournamentId) room.setAway(session.playerId)
          break
        }
        case 'set_back': {
          const room = session.roomId ? rooms.get(session.roomId) : undefined
          if (room?.tournamentId) room.setBack(session.playerId)
          break
        }

        // ── Tournament registration ─────────────────────────────────────────
        case 'register_tournament': {
          if (!activeTournament) { emit({ type: 'tournament_error', message: 'Nenhum torneio disponível.' }); break }
          if (activeTournament.status !== 'registering') { emit({ type: 'tournament_error', message: 'Inscrições encerradas.' }); break }
          if (activeTournament.isRegistered(session.playerId)) break
          const token = generateId() + generateId()
          activeTournament.register(session.playerId, session.name, emit, token)
          session.tournamentToken = token
          setPersistentToken(session.playerId, token)
          broadcastTournamentInfo()
          break
        }

        case 'unregister_tournament': {
          if (!activeTournament || activeTournament.status !== 'registering') break
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
      logger.info('player_disconnected', { 'poker.player_id': ws.data.playerId || null })
      // Lobby players stay in their room (persistent session handles reconnect)
      // Tournament players stay registered via token cookie
    },
  },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function leaveRoom(ws: { data: Session }): void {
  const { playerId, roomId } = ws.data
  if (!roomId) return
  const room = rooms.get(roomId)
  if (room && !room.tournamentId) {
    room.leave(playerId)
    if (room.playerCount === 0) { room.destroy(); rooms.delete(roomId) }
  }
  ws.data.roomId = null
  setPersistentRoom(playerId, null)
  broadcastRoomList()
}

function setPersistentRoom(pid: string, roomId: string | null): void {
  const ps = playerSessions.get(pid)
  if (ps) ps.roomId = roomId
}

function setPersistentToken(pid: string, token: string | null): void {
  const ps = playerSessions.get(pid)
  if (ps) ps.tournamentToken = token
}

function lobbyRoomList()  { return [...rooms.values()].filter(r => !r.tournamentId).map(r => r.summary()) }
function lobbyRoomCount() { return [...rooms.values()].filter(r => !r.tournamentId).length }

function broadcastRoomList(): void {
  server.publish('lobby', JSON.stringify({ type: 'room_list', rooms: lobbyRoomList() } satisfies ServerMessage))
}
function broadcastTournamentInfo(): void {
  server.publish('lobby', JSON.stringify({ type: 'tournament_info', tournament: activeTournament?.info() ?? null } satisfies ServerMessage))
}

logger.info('server_started', { 'poker.port': server.port, 'poker.url': `http://localhost:${server.port}` })

process.on('SIGTERM', async () => {
  await shutdownTelemetry()
  process.exit(0)
})
process.on('SIGINT', async () => {
  await shutdownTelemetry()
  process.exit(0)
})
