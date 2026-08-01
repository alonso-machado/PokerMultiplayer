import { useReducer, useCallback } from 'react'
import type {
  Card, ServerMessage, TrucoPlayer, TrucoRoomConfig, TrucoTableState,
} from '../../../shared/types'

export interface TrucoHandEnd { winnerTeam: 0 | 1 | null; points: number; reason: 'vazas' | 'corri' | 'mao_de_onze_run' }
export interface TrucoMatchEnd { winnerTeam: 0 | 1; scores: [number, number]; matchWins: Record<string, number> }
export interface TrucoMaoDeOnzePrompt { teamCards: Card[]; isFerro: boolean }
export interface TrucoTurn { canCallTruco: boolean; canRespond: boolean }
export interface TrucoRematchStatus { accepted: string[]; pending: string[] }

interface TrucoGameState {
  myId: string
  roomId: string | null
  roomName: string
  config: TrucoRoomConfig | null
  players: TrucoPlayer[]
  tableState: TrucoTableState | null
  myCards: Card[]
  isStarted: boolean
  turn: TrucoTurn | null
  /** Epoch ms when the current turn/decision auto-resolves — null when nobody is on the clock. */
  turnDeadline: number | null
  maoDeOnzePrompt: TrucoMaoDeOnzePrompt | null
  handEnd: TrucoHandEnd | null
  matchEnd: TrucoMatchEnd | null
  rematch: TrucoRematchStatus | null
  error: string | null
}

function initialState(myId: string): TrucoGameState {
  return {
    myId, roomId: null, roomName: '', config: null, players: [], tableState: null,
    myCards: [], isStarted: false, turn: null, turnDeadline: null, maoDeOnzePrompt: null,
    handEnd: null, matchEnd: null, rematch: null, error: null,
  }
}

function reducer(state: TrucoGameState, msg: ServerMessage): TrucoGameState {
  switch (msg.type) {
    case 'truco_room_joined':
      return { ...initialState(msg.yourId), roomId: msg.roomId, roomName: msg.roomName, config: msg.config }
    case 'truco_room_left':
      return initialState(state.myId)
    case 'truco_room_error':
      return { ...state, error: msg.message }
    case 'truco_player_list':
      return { ...state, players: msg.players }
    case 'truco_game_started':
      return { ...state, isStarted: true, handEnd: null, matchEnd: null, rematch: null }
    case 'truco_hand_dealt':
      // A rematch deals straight into a new hand without a fresh `truco_game_started`
      // (that only fires on the table's very first match) — clear the match-end
      // overlay here too, or it stays stuck on screen after everyone accepts.
      return {
        ...state, myCards: msg.yourCards, players: msg.players, tableState: msg.tableState,
        turn: null, maoDeOnzePrompt: null, handEnd: null, matchEnd: null, rematch: null,
      }
    case 'truco_vira_revealed':
      return state.tableState
        ? { ...state, tableState: { ...state.tableState, vira: msg.vira, manilhaCards: msg.manilhaCards } }
        : state
    case 'truco_mao_de_onze_prompt':
      return {
        ...state, maoDeOnzePrompt: { teamCards: msg.teamCards, isFerro: msg.isFerro },
        turnDeadline: Date.now() + msg.timeoutSeconds * 1000,
      }
    case 'truco_your_turn':
      return {
        ...state, turn: { canCallTruco: msg.canCallTruco, canRespond: msg.canRespond },
        turnDeadline: Date.now() + msg.timeoutSeconds * 1000,
      }
    case 'truco_card_played': {
      const myCards = msg.playerId === state.myId
        ? state.myCards.filter((c) => !(c.suit === msg.card.suit && c.rank === msg.card.rank))
        : state.myCards
      return { ...state, tableState: msg.tableState, myCards, turn: null }
    }
    case 'truco_vaza_result':
      return { ...state, tableState: msg.tableState }
    case 'truco_call_made':
      return { ...state, tableState: msg.tableState, turn: null }
    case 'truco_call_responded':
      return { ...state, tableState: msg.tableState }
    case 'truco_hand_end':
      return { ...state, tableState: msg.tableState, handEnd: { winnerTeam: msg.winnerTeam, points: msg.points, reason: msg.reason }, turn: null, turnDeadline: null, maoDeOnzePrompt: null }
    case 'truco_match_end':
      return { ...state, matchEnd: { winnerTeam: msg.winnerTeam, scores: msg.scores, matchWins: msg.matchWins } }
    case 'truco_rematch_status':
      return { ...state, rematch: { accepted: msg.accepted, pending: msg.pending } }
    default:
      return state
  }
}

export function useTrucoGame(myId: string) {
  const [state, dispatch] = useReducer(reducer, myId, initialState)

  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type.startsWith('truco_')) dispatch(msg)
  }, [])

  return { trucoState: state, handleTrucoMessage: handleMessage }
}
