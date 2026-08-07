import { useReducer, useCallback } from 'react'
import type {
  Card, ServerMessage, GoFishPlayer, GoFishRoomConfig, GoFishTableState, Rank,
} from '../../../shared/types'

export interface GoFishRoundEnd {
  players: GoFishPlayer[]
  winnerIds: string[]
  matchWins: Record<string, number>
}
export interface GoFishTurn { askableRanks: Rank[] }
export interface GoFishRematchStatus { accepted: string[]; pending: string[] }
export interface GoFishAskEvent {
  key: number   // bumps every message so the table can key a transient toast/log line off it
  askerId: string
  targetId: string
  rank: Rank
  cardsTransferred: number
  wentFish: boolean
  drawnMatch: boolean
  booksCompleted: { playerId: string; rank: Rank }[]
}

interface GoFishGameState {
  myId: string
  roomId: string | null
  roomName: string
  config: GoFishRoomConfig | null
  players: GoFishPlayer[]
  tableState: GoFishTableState | null
  myCards: Card[]
  isStarted: boolean
  turn: GoFishTurn | null
  /** Epoch ms when the current turn auto-resolves — null when nobody is on the clock. */
  turnDeadline: number | null
  lastAsk: GoFishAskEvent | null
  roundEnd: GoFishRoundEnd | null
  rematch: GoFishRematchStatus | null
  error: string | null
}

function initialState(myId: string): GoFishGameState {
  return {
    myId, roomId: null, roomName: '', config: null, players: [], tableState: null,
    myCards: [], isStarted: false, turn: null, turnDeadline: null,
    lastAsk: null, roundEnd: null, rematch: null, error: null,
  }
}

let askEventSeq = 0

function reducer(state: GoFishGameState, msg: ServerMessage): GoFishGameState {
  switch (msg.type) {
    case 'gofish_room_joined':
      return { ...initialState(msg.yourId), roomId: msg.roomId, roomName: msg.roomName, config: msg.config }
    case 'gofish_room_left':
      return initialState(state.myId)
    case 'gofish_room_error':
      return { ...state, error: msg.message }
    case 'gofish_player_list':
      return { ...state, players: msg.players }
    case 'gofish_game_started':
      return { ...state, isStarted: true, roundEnd: null, rematch: null }
    case 'gofish_hand_dealt':
      return {
        ...state, myCards: msg.yourCards, players: msg.players, tableState: msg.tableState,
        turn: null, lastAsk: null, roundEnd: null, rematch: null,
      }
    case 'gofish_hand_update':
      return { ...state, myCards: msg.cards }
    case 'gofish_state_update':
      return { ...state, tableState: msg.tableState, players: msg.players }
    case 'gofish_ask_result':
      return {
        ...state,
        lastAsk: {
          key: ++askEventSeq, askerId: msg.askerId, targetId: msg.targetId, rank: msg.rank,
          cardsTransferred: msg.cardsTransferred, wentFish: msg.wentFish, drawnMatch: msg.drawnMatch,
          booksCompleted: msg.booksCompleted,
        },
      }
    case 'gofish_your_turn':
      return { ...state, turn: { askableRanks: msg.askableRanks }, turnDeadline: Date.now() + msg.timeoutSeconds * 1000 }
    case 'gofish_round_end':
      return {
        ...state, tableState: msg.tableState, players: msg.players, turn: null, turnDeadline: null,
        roundEnd: { players: msg.players, winnerIds: msg.winnerIds, matchWins: msg.matchWins },
      }
    case 'gofish_rematch_status':
      return { ...state, rematch: { accepted: msg.accepted, pending: msg.pending } }
    default:
      return state
  }
}

export function useGoFishGame(myId: string) {
  const [state, dispatch] = useReducer(reducer, myId, initialState)

  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type.startsWith('gofish_')) dispatch(msg)
  }, [])

  return { gofishState: state, handleGoFishMessage: handleMessage }
}
