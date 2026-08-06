import { useReducer, useCallback } from 'react'
import type {
  Card, ServerMessage, GauchoPlayer, GauchoRoomConfig, GauchoTableState,
  GauchoEnvidoCallLevel, GauchoFlorCallLevel, GauchoCallLevel,
} from '../../../shared/types'

export interface GauchoHandEnd { winnerTeam: 0 | 1 | null; points: number; reason: 'vazas' | 'corri' | 'mao_de_onze_run' }
export interface GauchoMatchEnd { winnerTeam: 0 | 1; scores: [number, number]; matchWins: Record<string, number> }
export interface GauchoMaoDeOnzePrompt { teamCards: Card[]; isFerro: boolean }
export interface GauchoTurn {
  canCallTruco: boolean; canRespondTruco: boolean
  canCallEnvido: boolean; canRespondEnvido: boolean
  canCallFlor: boolean; canRespondFlor: boolean
}
export interface GauchoRematchStatus { accepted: string[]; pending: string[] }
/** Transient toast for the most recent call — cleared on the next hand. */
export interface GauchoCallEvent { kind: 'truco' | 'envido' | 'flor'; playerId: string; level: GauchoCallLevel | GauchoEnvidoCallLevel | GauchoFlorCallLevel }
/** Transient toast for the most recent Envido/Flor resolution. */
export interface GauchoResultEvent {
  kind: 'envido' | 'flor'
  winnerTeam: 0 | 1 | null; points: number
  reason: 'compared' | 'corri' | 'uncontested'
  values: Record<string, number>
}

interface GauchoGameState {
  myId: string
  roomId: string | null
  roomName: string
  config: GauchoRoomConfig | null
  players: GauchoPlayer[]
  tableState: GauchoTableState | null
  myCards: Card[]
  /** The 3 cards dealt this hand, never shrunk as cards are played (unlike
   *  `myCards`) — needed to tell whether I hold Flor even after I've
   *  already played a card this vaza. */
  dealtCards: Card[]
  isStarted: boolean
  turn: GauchoTurn | null
  /** Epoch ms when the current turn/decision auto-resolves — null when nobody is on the clock. */
  turnDeadline: number | null
  maoDeOnzePrompt: GauchoMaoDeOnzePrompt | null
  handEnd: GauchoHandEnd | null
  matchEnd: GauchoMatchEnd | null
  rematch: GauchoRematchStatus | null
  lastCall: GauchoCallEvent | null
  lastResult: GauchoResultEvent | null
  error: string | null
}

function initialState(myId: string): GauchoGameState {
  return {
    myId, roomId: null, roomName: '', config: null, players: [], tableState: null,
    myCards: [], dealtCards: [], isStarted: false, turn: null, turnDeadline: null, maoDeOnzePrompt: null,
    handEnd: null, matchEnd: null, rematch: null, lastCall: null, lastResult: null, error: null,
  }
}

function reducer(state: GauchoGameState, msg: ServerMessage): GauchoGameState {
  switch (msg.type) {
    case 'gaucho_room_joined':
      return { ...initialState(msg.yourId), roomId: msg.roomId, roomName: msg.roomName, config: msg.config }
    case 'gaucho_room_left':
      return initialState(state.myId)
    case 'gaucho_room_error':
      return { ...state, error: msg.message }
    case 'gaucho_player_list':
      return { ...state, players: msg.players }
    case 'gaucho_game_started':
      return { ...state, isStarted: true, handEnd: null, matchEnd: null, rematch: null }
    case 'gaucho_hand_dealt':
      // A rematch deals straight into a new hand without a fresh `gaucho_game_started`
      // (that only fires on the table's very first match) — clear stale overlays here too.
      return {
        ...state, myCards: msg.yourCards, dealtCards: msg.yourCards, players: msg.players, tableState: msg.tableState,
        turn: null, maoDeOnzePrompt: null, handEnd: null, matchEnd: null, rematch: null,
        lastCall: null, lastResult: null,
      }
    case 'gaucho_mao_de_onze_prompt':
      return {
        ...state, maoDeOnzePrompt: { teamCards: msg.teamCards, isFerro: msg.isFerro },
        turnDeadline: Date.now() + msg.timeoutSeconds * 1000,
      }
    case 'gaucho_your_turn':
      return {
        ...state,
        turn: {
          canCallTruco: msg.canCallTruco, canRespondTruco: msg.canRespondTruco,
          canCallEnvido: msg.canCallEnvido, canRespondEnvido: msg.canRespondEnvido,
          canCallFlor: msg.canCallFlor, canRespondFlor: msg.canRespondFlor,
        },
        turnDeadline: Date.now() + msg.timeoutSeconds * 1000,
      }
    case 'gaucho_card_played': {
      const myCards = msg.playerId === state.myId
        ? state.myCards.filter((c) => !(c.suit === msg.card.suit && c.rank === msg.card.rank))
        : state.myCards
      return { ...state, tableState: msg.tableState, myCards, turn: null }
    }
    case 'gaucho_vaza_result':
      return { ...state, tableState: msg.tableState }
    case 'gaucho_truco_call_made':
      return { ...state, tableState: msg.tableState, turn: null, lastCall: { kind: 'truco', playerId: msg.playerId, level: msg.level } }
    case 'gaucho_truco_call_responded':
      return { ...state, tableState: msg.tableState }
    case 'gaucho_envido_call_made':
      return { ...state, tableState: msg.tableState, turn: null, lastCall: { kind: 'envido', playerId: msg.playerId, level: msg.level } }
    case 'gaucho_envido_result':
      return { ...state, tableState: msg.tableState, lastResult: { kind: 'envido', winnerTeam: msg.winnerTeam, points: msg.points, reason: msg.reason, values: msg.values } }
    case 'gaucho_flor_call_made':
      return { ...state, tableState: msg.tableState, turn: null, lastCall: { kind: 'flor', playerId: msg.playerId, level: msg.level } }
    case 'gaucho_flor_result':
      return { ...state, tableState: msg.tableState, lastResult: { kind: 'flor', winnerTeam: msg.winnerTeam, points: msg.points, reason: msg.reason, values: msg.values } }
    case 'gaucho_hand_end':
      return { ...state, tableState: msg.tableState, handEnd: { winnerTeam: msg.winnerTeam, points: msg.points, reason: msg.reason }, turn: null, turnDeadline: null, maoDeOnzePrompt: null }
    case 'gaucho_match_end':
      return { ...state, matchEnd: { winnerTeam: msg.winnerTeam, scores: msg.scores, matchWins: msg.matchWins } }
    case 'gaucho_rematch_status':
      return { ...state, rematch: { accepted: msg.accepted, pending: msg.pending } }
    default:
      return state
  }
}

export function useGauchoGame(myId: string) {
  const [state, dispatch] = useReducer(reducer, myId, initialState)

  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type.startsWith('gaucho_')) dispatch(msg)
  }, [])

  return { gauchoState: state, handleGauchoMessage: handleMessage }
}
