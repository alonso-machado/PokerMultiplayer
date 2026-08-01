const MAX_PAYLOAD_BYTES = 512;
const VALID_ACTIONS = new Set(['fold', 'check', 'call', 'raise', 'all-in']);
const VALID_SUITS = new Set(['spades', 'hearts', 'diamonds', 'clubs']);
const VALID_RANKS = new Set(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
const VALID_TRUCO_MODES = new Set(['1x1', '2x2']);
const VALID_MANILHA_VARIANTS = new Set(['vira', 'fixed']);
function isString(v) { return typeof v === 'string'; }
// Signed token: 64-char playerId + '.' + ~43-char base64url HMAC = ~108 chars. Cap at 128.
function isSafeToken(v) { return isString(v) && v.length > 0 && v.length <= 128; }
function isSafeId(v) { return isString(v) && v.length > 0 && v.length <= 64; }
function isSafeName(v) { return isString(v) && v.length <= 24; }
function isSafeRoomName(v) { return isString(v) && v.length <= 40; }
function safeInt(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n))
        return null;
    if (n < min || n > max)
        return null;
    return n;
}
function parseConfig(v) {
    if (typeof v !== 'object' || v === null)
        return null;
    const c = v;
    const smallBlind = safeInt(c.smallBlind, 1, 1_000_000);
    const bigBlind = safeInt(c.bigBlind, 2, 2_000_000);
    const ante = safeInt(c.ante, 0, 1_000_000);
    const maxPlayers = safeInt(c.maxPlayers, 2, 6);
    if (smallBlind === null || bigBlind === null || ante === null || maxPlayers === null)
        return null;
    return { smallBlind, bigBlind, ante, maxPlayers };
}
function isBool(v) { return typeof v === 'boolean'; }
function parseCard(v) {
    if (typeof v !== 'object' || v === null)
        return null;
    const c = v;
    if (!isString(c.suit) || !VALID_SUITS.has(c.suit))
        return null;
    if (!isString(c.rank) || !VALID_RANKS.has(c.rank))
        return null;
    return { suit: c.suit, rank: c.rank };
}
function parseTrucoConfig(v) {
    if (typeof v !== 'object' || v === null)
        return null;
    const c = v;
    if (!isString(c.mode) || !VALID_TRUCO_MODES.has(c.mode))
        return null;
    if (!isString(c.manilhaVariant) || !VALID_MANILHA_VARIANTS.has(c.manilhaVariant))
        return null;
    return { mode: c.mode, manilhaVariant: c.manilhaVariant };
}
/**
 * Validates and parses a raw WebSocket payload into a typed ClientMessage.
 * Returns null if the payload is invalid — caller must drop the message.
 */
export function parseClientMessage(raw) {
    // Size guard — check before JSON.parse
    const str = String(raw);
    if (str.length > MAX_PAYLOAD_BYTES)
        return null;
    let obj;
    try {
        obj = JSON.parse(str);
    }
    catch {
        return null;
    }
    if (typeof obj !== 'object' || obj === null)
        return null;
    const m = obj;
    switch (m.type) {
        case 'hello': {
            if (!isSafeName(m.name))
                return null;
            return {
                type: 'hello',
                playerId: isSafeToken(m.playerId) ? m.playerId : '',
                name: m.name,
                tournamentToken: isSafeId(m.tournamentToken) ? m.tournamentToken : undefined,
            };
        }
        case 'set_name':
            if (!isSafeName(m.name))
                return null;
            return { type: 'set_name', name: m.name };
        case 'list_rooms': return { type: 'list_rooms' };
        case 'leave_room': return { type: 'leave_room' };
        case 'start_game': return { type: 'start_game' };
        case 'rebuy': return { type: 'rebuy' };
        case 'rebuy_decline': return { type: 'rebuy_decline' };
        case 'get_tournament': return { type: 'get_tournament' };
        case 'register_tournament': return { type: 'register_tournament' };
        case 'unregister_tournament': return { type: 'unregister_tournament' };
        case 'set_away': return { type: 'set_away' };
        case 'set_back': return { type: 'set_back' };
        case 'create_room': {
            if (!isSafeRoomName(m.roomName))
                return null;
            const config = parseConfig(m.config);
            if (!config)
                return null;
            return { type: 'create_room', roomName: m.roomName, config };
        }
        case 'join_room':
            if (!isSafeId(m.roomId))
                return null;
            return { type: 'join_room', roomId: m.roomId };
        case 'player_action': {
            if (!isString(m.action) || !VALID_ACTIONS.has(m.action))
                return null;
            const amount = m.amount === undefined
                ? undefined
                : safeInt(m.amount, 0, 1_000_000_000);
            if (m.amount !== undefined && amount === null)
                return null;
            return { type: 'player_action', action: m.action, amount: amount ?? undefined };
        }
        // ── Truco ────────────────────────────────────────────────────────────
        case 'truco_list_rooms': return { type: 'truco_list_rooms' };
        case 'truco_leave_room': return { type: 'truco_leave_room' };
        case 'truco_call_truco': return { type: 'truco_call_truco' };
        case 'truco_create_room': {
            if (!isSafeRoomName(m.roomName))
                return null;
            const config = parseTrucoConfig(m.config);
            if (!config)
                return null;
            return { type: 'truco_create_room', roomName: m.roomName, config };
        }
        case 'truco_join_room':
            if (!isSafeId(m.roomId))
                return null;
            return { type: 'truco_join_room', roomId: m.roomId };
        case 'truco_play_card': {
            const card = parseCard(m.card);
            if (!card)
                return null;
            return { type: 'truco_play_card', card };
        }
        case 'truco_respond':
            if (!isBool(m.accept))
                return null;
            return { type: 'truco_respond', accept: m.accept };
        case 'truco_mao_de_onze_decision':
            if (!isBool(m.accept))
                return null;
            return { type: 'truco_mao_de_onze_decision', accept: m.accept };
        case 'truco_rematch_vote':
            if (!isBool(m.accept))
                return null;
            return { type: 'truco_rematch_vote', accept: m.accept };
        default:
            return null;
    }
}
