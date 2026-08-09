import type { Card, CanastraMeldPlan, CanastraRoomConfig, ClientMessage, GauchoRoomConfig, GoFishRoomConfig, PlayerAction, PushYourLuckDrawRoomConfig, Rank, RoomConfig, Suit, TrucoRoomConfig } from '../../shared/types'
// Blackjack has no room config to validate — see blackjack_join below.

const MAX_PAYLOAD_BYTES = 512
const MAX_MELD_CARDS    = 20
const VALID_ACTIONS     = new Set<string>(['fold', 'check', 'call', 'raise', 'all-in'])
const VALID_SUITS       = new Set<string>(['spades', 'hearts', 'diamonds', 'clubs'])
const VALID_RANKS       = new Set<string>(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'])
const VALID_TRUCO_MODES = new Set<string>(['1x1', '2x2'])
const VALID_MANILHA_VARIANTS = new Set<string>(['vira', 'fixed'])
const VALID_GAUCHO_MODES = new Set<string>(['1x1', '2x2'])
const VALID_CANASTRA_MODES = new Set<string>(['1x1', '2x2'])
const VALID_DECK_MODES = new Set<string>(['fresh', 'persistent'])

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

function isBool(v: unknown): v is boolean { return typeof v === 'boolean' }

function parseCard(v: unknown): Card | null {
  if (typeof v !== 'object' || v === null) return null
  const c = v as Record<string, unknown>
  if (!isString(c.suit) || !VALID_SUITS.has(c.suit)) return null
  if (!isString(c.rank) || !VALID_RANKS.has(c.rank)) return null
  return { suit: c.suit as Suit, rank: c.rank as Rank }
}

function parseTrucoConfig(v: unknown): TrucoRoomConfig | null {
  if (typeof v !== 'object' || v === null) return null
  const c = v as Record<string, unknown>
  if (!isString(c.mode) || !VALID_TRUCO_MODES.has(c.mode)) return null
  if (!isString(c.manilhaVariant) || !VALID_MANILHA_VARIANTS.has(c.manilhaVariant)) return null
  return { mode: c.mode as TrucoRoomConfig['mode'], manilhaVariant: c.manilhaVariant as TrucoRoomConfig['manilhaVariant'] }
}

function parseGauchoConfig(v: unknown): GauchoRoomConfig | null {
  if (typeof v !== 'object' || v === null) return null
  const c = v as Record<string, unknown>
  if (!isString(c.mode) || !VALID_GAUCHO_MODES.has(c.mode)) return null
  return { mode: c.mode as GauchoRoomConfig['mode'] }
}

function parseCanastraConfig(v: unknown): CanastraRoomConfig | null {
  if (typeof v !== 'object' || v === null) return null
  const c = v as Record<string, unknown>
  if (!isString(c.mode) || !VALID_CANASTRA_MODES.has(c.mode)) return null
  return { mode: c.mode as CanastraRoomConfig['mode'] }
}

function parseGoFishConfig(v: unknown): GoFishRoomConfig | null {
  if (typeof v !== 'object' || v === null) return null
  const c = v as Record<string, unknown>
  const maxPlayers = safeInt(c.maxPlayers, 2, 6)
  if (maxPlayers === null) return null
  return { maxPlayers }
}

function parsePushYourLuckDrawConfig(v: unknown): PushYourLuckDrawRoomConfig | null {
  if (typeof v !== 'object' || v === null) return null
  const c = v as Record<string, unknown>
  const maxPlayers = safeInt(c.maxPlayers, 2, 8)
  const targetScore = safeInt(c.targetScore, 50, 2000)
  if (maxPlayers === null || targetScore === null) return null
  if (!isString(c.deckMode) || !VALID_DECK_MODES.has(c.deckMode)) return null
  return { maxPlayers, targetScore, deckMode: c.deckMode as PushYourLuckDrawRoomConfig['deckMode'] }
}

function parseIdArray(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_MELD_CARDS) return null
  if (!v.every((id) => isSafeId(id))) return null
  return v as string[]
}

function parseMeldPlan(v: unknown): CanastraMeldPlan | null {
  if (typeof v !== 'object' || v === null) return null
  const p = v as Record<string, unknown>
  if (p.kind === 'new') {
    const cardIds = parseIdArray(p.cardIds)
    if (!cardIds) return null
    return { kind: 'new', cardIds }
  }
  if (p.kind === 'append') {
    if (!isSafeId(p.meldId) || !isSafeId(p.cardId)) return null
    return { kind: 'append', meldId: p.meldId, cardId: p.cardId }
  }
  return null
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

    // ── Truco ────────────────────────────────────────────────────────────
    case 'truco_list_rooms': return { type: 'truco_list_rooms' }
    case 'truco_leave_room': return { type: 'truco_leave_room' }
    case 'truco_call_truco': return { type: 'truco_call_truco' }

    case 'truco_create_room': {
      if (!isSafeRoomName(m.roomName)) return null
      const config = parseTrucoConfig(m.config)
      if (!config) return null
      return { type: 'truco_create_room', roomName: m.roomName as string, config }
    }

    case 'truco_join_room':
      if (!isSafeId(m.roomId)) return null
      return { type: 'truco_join_room', roomId: m.roomId as string }

    case 'truco_play_card': {
      const card = parseCard(m.card)
      if (!card) return null
      return { type: 'truco_play_card', card }
    }

    case 'truco_respond':
      if (!isBool(m.accept)) return null
      return { type: 'truco_respond', accept: m.accept }

    case 'truco_mao_de_onze_decision':
      if (!isBool(m.accept)) return null
      return { type: 'truco_mao_de_onze_decision', accept: m.accept }

    case 'truco_rematch_vote':
      if (!isBool(m.accept)) return null
      return { type: 'truco_rematch_vote', accept: m.accept }

    // ── Truco Gaúcho ─────────────────────────────────────────────────────
    case 'gaucho_list_rooms': return { type: 'gaucho_list_rooms' }
    case 'gaucho_leave_room': return { type: 'gaucho_leave_room' }
    case 'gaucho_call_truco': return { type: 'gaucho_call_truco' }
    case 'gaucho_call_envido': return { type: 'gaucho_call_envido' }
    case 'gaucho_call_flor': return { type: 'gaucho_call_flor' }

    case 'gaucho_create_room': {
      if (!isSafeRoomName(m.roomName)) return null
      const config = parseGauchoConfig(m.config)
      if (!config) return null
      return { type: 'gaucho_create_room', roomName: m.roomName as string, config }
    }

    case 'gaucho_join_room':
      if (!isSafeId(m.roomId)) return null
      return { type: 'gaucho_join_room', roomId: m.roomId as string }

    case 'gaucho_play_card': {
      const card = parseCard(m.card)
      if (!card) return null
      return { type: 'gaucho_play_card', card }
    }

    case 'gaucho_respond_truco':
      if (!isBool(m.accept)) return null
      return { type: 'gaucho_respond_truco', accept: m.accept }

    case 'gaucho_respond_envido':
      if (!isBool(m.accept)) return null
      return { type: 'gaucho_respond_envido', accept: m.accept }

    case 'gaucho_respond_flor':
      if (!isBool(m.accept)) return null
      return { type: 'gaucho_respond_flor', accept: m.accept }

    case 'gaucho_mao_de_onze_decision':
      if (!isBool(m.accept)) return null
      return { type: 'gaucho_mao_de_onze_decision', accept: m.accept }

    case 'gaucho_rematch_vote':
      if (!isBool(m.accept)) return null
      return { type: 'gaucho_rematch_vote', accept: m.accept }

    // ── Canastra / Buraco ───────────────────────────────────────────────
    case 'canastra_list_rooms': return { type: 'canastra_list_rooms' }
    case 'canastra_leave_room': return { type: 'canastra_leave_room' }
    case 'canastra_draw_stock': return { type: 'canastra_draw_stock' }

    case 'canastra_create_room': {
      if (!isSafeRoomName(m.roomName)) return null
      const config = parseCanastraConfig(m.config)
      if (!config) return null
      return { type: 'canastra_create_room', roomName: m.roomName as string, config }
    }

    case 'canastra_join_room':
      if (!isSafeId(m.roomId)) return null
      return { type: 'canastra_join_room', roomId: m.roomId as string }

    case 'canastra_take_discard': {
      const meldPlan = parseMeldPlan(m.meldPlan)
      if (!meldPlan) return null
      return { type: 'canastra_take_discard', meldPlan }
    }

    case 'canastra_lay_meld': {
      const cardIds = parseIdArray(m.cardIds)
      if (!cardIds) return null
      return { type: 'canastra_lay_meld', cardIds }
    }

    case 'canastra_add_to_meld': {
      if (!isSafeId(m.meldId)) return null
      const cardIds = parseIdArray(m.cardIds)
      if (!cardIds) return null
      return { type: 'canastra_add_to_meld', meldId: m.meldId, cardIds }
    }

    case 'canastra_discard':
      if (!isSafeId(m.cardId)) return null
      return { type: 'canastra_discard', cardId: m.cardId }

    case 'canastra_rematch_vote':
      if (!isBool(m.accept)) return null
      return { type: 'canastra_rematch_vote', accept: m.accept }

    // ── Blackjack / 21 ───────────────────────────────────────────────────
    // No create/list/join-by-id — the server matchmakes on 'blackjack_join'.
    case 'blackjack_join':       return { type: 'blackjack_join' }
    case 'blackjack_leave_room': return { type: 'blackjack_leave_room' }
    case 'blackjack_hit':        return { type: 'blackjack_hit' }
    case 'blackjack_stand':      return { type: 'blackjack_stand' }
    case 'blackjack_double':     return { type: 'blackjack_double' }
    case 'blackjack_split':      return { type: 'blackjack_split' }

    case 'blackjack_place_bet': {
      const amount = safeInt(m.amount, 1, 1_000_000)
      if (amount === null) return null
      return { type: 'blackjack_place_bet', amount }
    }

    case 'blackjack_insurance_bet': {
      const amount = safeInt(m.amount, 0, 1_000_000)
      if (amount === null) return null
      return { type: 'blackjack_insurance_bet', amount }
    }

    // ── Go Fish ──────────────────────────────────────────────────────────
    case 'gofish_list_rooms': return { type: 'gofish_list_rooms' }
    case 'gofish_leave_room': return { type: 'gofish_leave_room' }
    case 'gofish_start_game': return { type: 'gofish_start_game' }

    case 'gofish_create_room': {
      if (!isSafeRoomName(m.roomName)) return null
      const config = parseGoFishConfig(m.config)
      if (!config) return null
      return { type: 'gofish_create_room', roomName: m.roomName as string, config }
    }

    case 'gofish_join_room':
      if (!isSafeId(m.roomId)) return null
      return { type: 'gofish_join_room', roomId: m.roomId as string }

    case 'gofish_ask': {
      if (!isSafeId(m.targetPlayerId)) return null
      if (!isString(m.rank) || !VALID_RANKS.has(m.rank)) return null
      return { type: 'gofish_ask', targetPlayerId: m.targetPlayerId, rank: m.rank as Rank }
    }

    case 'gofish_rematch_vote':
      if (!isBool(m.accept)) return null
      return { type: 'gofish_rematch_vote', accept: m.accept }

    // ── Push Your Luck Draw ─────────────────────────────────────────────
    case 'pushyourluckdraw_list_rooms': return { type: 'pushyourluckdraw_list_rooms' }
    case 'pushyourluckdraw_leave_room': return { type: 'pushyourluckdraw_leave_room' }
    case 'pushyourluckdraw_start_game': return { type: 'pushyourluckdraw_start_game' }
    case 'pushyourluckdraw_draw': return { type: 'pushyourluckdraw_draw' }
    case 'pushyourluckdraw_stop': return { type: 'pushyourluckdraw_stop' }

    case 'pushyourluckdraw_create_room': {
      if (!isSafeRoomName(m.roomName)) return null
      const config = parsePushYourLuckDrawConfig(m.config)
      if (!config) return null
      return { type: 'pushyourluckdraw_create_room', roomName: m.roomName as string, config }
    }

    case 'pushyourluckdraw_join_room':
      if (!isSafeId(m.roomId)) return null
      return { type: 'pushyourluckdraw_join_room', roomId: m.roomId as string }

    case 'pushyourluckdraw_rematch_vote':
      if (!isBool(m.accept)) return null
      return { type: 'pushyourluckdraw_rematch_vote', accept: m.accept }

    default:
      return null
  }
}
