import type { ClientMessage, PlayerAction, RoomConfig } from '../../shared/types'

const MAX_PAYLOAD_BYTES = 512
const VALID_ACTIONS     = new Set<string>(['fold', 'check', 'call', 'raise', 'all-in'])

function isString(v: unknown): v is string   { return typeof v === 'string' }
// Signed token: 64-char playerId + '.' + ~43-char base64url HMAC = ~108 chars. Cap at 128.
function isSafeToken(v: unknown): v is string { return isString(v) && v.length > 0 && v.length <= 128 }
function isSafeId(v: unknown): v is string    { return isString(v) && v.length > 0 && v.length <= 64 }
function isSafeName(v: unknown): v is string  { return isString(v) && v.length <= 24 }
function isSafeRoomName(v: unknown): v is string { return isString(v) && v.length <= 40 }

function safeInt(v: unknown, min: number, max: number): number | null {
  const n = Number(v)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null
  if (n < min || n > max) return null
  return n
}

function parseConfig(v: unknown): RoomConfig | null {
  if (typeof v !== 'object' || v === null) return null
  const c = v as Record<string, unknown>
  const smallBlind = safeInt(c.smallBlind, 1, 1_000_000)
  const bigBlind   = safeInt(c.bigBlind,   2, 2_000_000)
  const ante       = safeInt(c.ante,       0, 1_000_000)
  const maxPlayers = safeInt(c.maxPlayers, 2, 6)
  if (smallBlind === null || bigBlind === null || ante === null || maxPlayers === null) return null
  return { smallBlind, bigBlind, ante, maxPlayers }
}

/**
 * Validates and parses a raw WebSocket payload into a typed ClientMessage.
 * Returns null if the payload is invalid — caller must drop the message.
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  // Size guard — check before JSON.parse
  const str = String(raw)
  if (str.length > MAX_PAYLOAD_BYTES) return null

  let obj: unknown
  try { obj = JSON.parse(str) } catch { return null }

  if (typeof obj !== 'object' || obj === null) return null
  const m = obj as Record<string, unknown>

  switch (m.type) {
    case 'hello': {
      if (!isSafeName(m.name)) return null
      return {
        type: 'hello',
        playerId: isSafeToken(m.playerId) ? m.playerId : '',
        name: m.name,
        tournamentToken: isSafeId(m.tournamentToken) ? m.tournamentToken : undefined,
      }
    }

    case 'set_name':
      if (!isSafeName(m.name)) return null
      return { type: 'set_name', name: m.name }

    case 'list_rooms':        return { type: 'list_rooms' }
    case 'leave_room':        return { type: 'leave_room' }
    case 'start_game':        return { type: 'start_game' }
    case 'rebuy':             return { type: 'rebuy' }
    case 'rebuy_decline':     return { type: 'rebuy_decline' }
    case 'get_tournament':    return { type: 'get_tournament' }
    case 'register_tournament':   return { type: 'register_tournament' }
    case 'unregister_tournament': return { type: 'unregister_tournament' }
    case 'set_away':          return { type: 'set_away' }
    case 'set_back':          return { type: 'set_back' }

    case 'create_room': {
      if (!isSafeRoomName(m.roomName)) return null
      const config = parseConfig(m.config)
      if (!config) return null
      return { type: 'create_room', roomName: m.roomName as string, config }
    }

    case 'join_room':
      if (!isSafeId(m.roomId)) return null
      return { type: 'join_room', roomId: m.roomId as string }

    case 'player_action': {
      if (!isString(m.action) || !VALID_ACTIONS.has(m.action)) return null
      const amount = m.amount === undefined
        ? undefined
        : safeInt(m.amount, 0, 1_000_000_000)
      if (m.amount !== undefined && amount === null) return null
      return { type: 'player_action', action: m.action as PlayerAction, amount: amount ?? undefined }
    }

    default:
      return null
  }
}
