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
import { TrucoRoom } from './trucoRoom'
import { GauchoRoom } from './gauchoRoom'
import { CanastraRoom } from './canastraRoom'
import { Tournament } from './tournament'
import { adminRouter, publicTournamentHandler } from './admin'

const MAX_LOBBY_ROOMS = Number(process.env.MAX_LOBBIES ?? 30)

const rooms = new Map<string, Room>()
const trucoRooms = new Map<string, TrucoRoom>()
const gauchoRooms = new Map<string, GauchoRoom>()
const canastraRooms = new Map<string, CanastraRoom>()
let activeTournament: Tournament | null = null

// ── Persistent player sessions (survive WS reconnect) ─────────────────────────
interface PersistentSession {
  playerId: string
  name: string
  roomId: string | null
  trucoRoomId: string | null
  gauchoRoomId: string | null
  canastraRoomId: string | null
  tournamentToken: string | null
}
const playerSessions = new Map<string, PersistentSession>()

// ── WS session (ephemeral, per connection) ────────────────────────────────────
interface Session {
  playerId: string
  name: string
  roomId: string | null
  trucoRoomId: string | null
  gauchoRoomId: string | null
  canastraRoomId: string | null
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
        data: { playerId: '', name: 'Jogador', roomId: null, trucoRoomId: null, gauchoRoomId: null, canastraRoomId: null, tournamentToken: null } as Session,
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
      send(ws, { type: 'truco_room_list', rooms: trucoRoomList() })
      send(ws, { type: 'gaucho_room_list', rooms: gauchoRoomList() })
      send(ws, { type: 'canastra_room_list', rooms: canastraRoomList() })
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
          // Update send fn
          existing.name = session.name
          session.tournamentToken = session.tournamentToken ?? existing.tournamentToken
        } else {
          playerSessions.set(pid, { playerId: pid, name: session.name, roomId: null, trucoRoomId: null, gauchoRoomId: null, canastraRoomId: null, tournamentToken: session.tournamentToken })
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

function leaveTrucoRoom(ws: { data: Session }): void {
  const { playerId, trucoRoomId } = ws.data
  if (!trucoRoomId) return
  const room = trucoRooms.get(trucoRoomId)
  if (room) {
    room.leave(playerId)
    if (room.playerCount === 0) { room.destroy(); trucoRooms.delete(trucoRoomId) }
  }
  ws.data.trucoRoomId = null
  setPersistentTrucoRoom(playerId, null)
  broadcastTrucoRoomList()
}

function setPersistentTrucoRoom(pid: string, trucoRoomId: string | null): void {
  const ps = playerSessions.get(pid)
  if (ps) ps.trucoRoomId = trucoRoomId
}

function leaveGauchoRoom(ws: { data: Session }): void {
  const { playerId, gauchoRoomId } = ws.data
  if (!gauchoRoomId) return
  const room = gauchoRooms.get(gauchoRoomId)
  if (room) {
    room.leave(playerId)
    if (room.playerCount === 0) { room.destroy(); gauchoRooms.delete(gauchoRoomId) }
  }
  ws.data.gauchoRoomId = null
  setPersistentGauchoRoom(playerId, null)
  broadcastGauchoRoomList()
}

function setPersistentGauchoRoom(pid: string, gauchoRoomId: string | null): void {
  const ps = playerSessions.get(pid)
  if (ps) ps.gauchoRoomId = gauchoRoomId
}

function leaveCanastraRoom(ws: { data: Session }): void {
  const { playerId, canastraRoomId } = ws.data
  if (!canastraRoomId) return
  const room = canastraRooms.get(canastraRoomId)
  if (room) {
    room.leave(playerId)
    if (room.playerCount === 0) { room.destroy(); canastraRooms.delete(canastraRoomId) }
  }
  ws.data.canastraRoomId = null
  setPersistentCanastraRoom(playerId, null)
  broadcastCanastraRoomList()
}

function setPersistentCanastraRoom(pid: string, canastraRoomId: string | null): void {
  const ps = playerSessions.get(pid)
  if (ps) ps.canastraRoomId = canastraRoomId
}

function setPersistentToken(pid: string, token: string | null): void {
  const ps = playerSessions.get(pid)
  if (ps) ps.tournamentToken = token
}

function lobbyRoomList()  { return [...rooms.values()].filter(r => !r.tournamentId).map(r => r.summary()) }
function lobbyRoomCount() { return [...rooms.values()].filter(r => !r.tournamentId).length }
function trucoRoomList()  { return [...trucoRooms.values()].map(r => r.summary()) }
function gauchoRoomList() { return [...gauchoRooms.values()].map(r => r.summary()) }
function canastraRoomList() { return [...canastraRooms.values()].map(r => r.summary()) }

function broadcastRoomList(): void {
  server.publish('lobby', JSON.stringify({ type: 'room_list', rooms: lobbyRoomList() } satisfies ServerMessage))
}
function broadcastTrucoRoomList(): void {
  server.publish('lobby', JSON.stringify({ type: 'truco_room_list', rooms: trucoRoomList() } satisfies ServerMessage))
}
function broadcastGauchoRoomList(): void {
  server.publish('lobby', JSON.stringify({ type: 'gaucho_room_list', rooms: gauchoRoomList() } satisfies ServerMessage))
}
function broadcastCanastraRoomList(): void {
  server.publish('lobby', JSON.stringify({ type: 'canastra_room_list', rooms: canastraRoomList() } satisfies ServerMessage))
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
