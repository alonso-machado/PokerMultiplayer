import { useReducer, useCallback } from 'react'
import type {
  PushYourLuckDrawCard, PushYourLuckDrawPlayer, PushYourLuckDrawRoomConfig,
  PushYourLuckDrawTableState, ServerMessage,
} from '../../../shared/types'

export interface PushYourLuckDrawMatchEnd {
  players: PushYourLuckDrawPlayer[]
  winnerIds: string[]
  matchWins: Record<string, number>
}
export interface PushYourLuckDrawRematchStatus { accepted: string[]; pending: string[] }
export interface PushYourLuckDrawDrawEvent {
  key: number   // bumps every message so the table can key a transient toast/log line off it
  playerId: string
  outcome: 'drew' | 'joker' | 'saved' | 'busted' | 'forced_stop'
  card: PushYourLuckDrawCard | null
  /** Only set on a 'busted' outcome — the round hand right before it was cleared,
   *  so the table can show which card duplicated `card`. */
  bustedHand: PushYourLuckDrawCard[] | null
}
export interface PushYourLuckDrawStopEvent {
  key: number
  playerId: string
  roundScore: number
}

interface PushYourLuckDrawGameState {
  myId: string
  roomId: string | null
  roomName: string
  config: PushYourLuckDrawRoomConfig | null
  players: PushYourLuckDrawPlayer[]
  tableState: PushYourLuckDrawTableState | null
  isStarted: boolean
  /** Epoch ms when the current turn auto-resolves — null when nobody is on the clock. */
  turnDeadline: number | null
  myTurn: boolean
  lastDraw: PushYourLuckDrawDrawEvent | null
  lastStop: PushYourLuckDrawStopEvent | null
  roundEnd: { players: PushYourLuckDrawPlayer[]; tableState: PushYourLuckDrawTableState } | null
  matchEnd: PushYourLuckDrawMatchEnd | null
  rematch: PushYourLuckDrawRematchStatus | null
  error: string | null
}

function initialState(myId: string): PushYourLuckDrawGameState {
  return {
    myId, roomId: null, roomName: '', config: null, players: [], tableState: null,
    isStarted: false, turnDeadline: null, myTurn: false,
    lastDraw: null, lastStop: null, roundEnd: null, matchEnd: null, rematch: null, error: null,
  }
}

let eventSeq = 0

function reducer(state: PushYourLuckDrawGameState, msg: ServerMessage): PushYourLuckDrawGameState {
  switch (msg.type) {
    case 'pushyourluckdraw_room_joined':
      return { ...initialState(msg.yourId), roomId: msg.roomId, roomName: msg.roomName, config: msg.config }
    case 'pushyourluckdraw_room_left':
      return initialState(state.myId)
    case 'pushyourluckdraw_room_error':
      return { ...state, error: msg.message }
    case 'pushyourluckdraw_player_list':
      return { ...state, players: msg.players }
    case 'pushyourluckdraw_game_started':
      return { ...state, isStarted: true, roundEnd: null, matchEnd: null, rematch: null }
    case 'pushyourluckdraw_round_started':
      return {
        ...state, players: msg.players, tableState: msg.tableState,
        myTurn: false, turnDeadline: null, lastDraw: null, lastStop: null, roundEnd: null,
      }
    case 'pushyourluckdraw_state_update':
      return { ...state, players: msg.players, tableState: msg.tableState }
    case 'pushyourluckdraw_your_turn':
      return { ...state, myTurn: true, turnDeadline: Date.now() + msg.timeoutSeconds * 1000 }
    case 'pushyourluckdraw_draw_result':
      return {
        ...state, players: msg.players, tableState: msg.tableState, myTurn: false, turnDeadline: null,
        lastDraw: { key: ++eventSeq, playerId: msg.playerId, outcome: msg.outcome, card: msg.card, bustedHand: msg.bustedHand },
      }
    case 'pushyourluckdraw_stop_result':
      return {
        ...state, players: msg.players, tableState: msg.tableState, myTurn: false, turnDeadline: null,
        lastStop: { key: ++eventSeq, playerId: msg.playerId, roundScore: msg.roundScore },
      }
    case 'pushyourluckdraw_round_end':
      return {
        ...state, players: msg.players, tableState: msg.tableState, myTurn: false, turnDeadline: null,
        roundEnd: { players: msg.players, tableState: msg.tableState },
      }
    case 'pushyourluckdraw_match_end':
      return {
        ...state, players: msg.players, myTurn: false, turnDeadline: null, roundEnd: null,
        matchEnd: { players: msg.players, winnerIds: msg.winnerIds, matchWins: msg.matchWins },
      }
    case 'pushyourluckdraw_rematch_status':
      return { ...state, rematch: { accepted: msg.accepted, pending: msg.pending } }
    default:
      return state
  }
}

export function usePushYourLuckDrawGame(myId: string) {
  const [state, dispatch] = useReducer(reducer, myId, initialState)

  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type.startsWith('pushyourluckdraw_')) dispatch(msg)
  }, [])

  return { pushYourLuckDrawState: state, handlePushYourLuckDrawMessage: handleMessage }
}
