import { useReducer, useCallback } from 'react'
import type {
  CanastraCard, ServerMessage, CanastraPlayer, CanastraRoomConfig, CanastraTableState,
  CanastraScoreBreakdown,
} from '../../../shared/types'

export interface CanastraRoundEnd {
  winnerTeam: 0 | 1 | null
  scores: [number, number]
  breakdown: [CanastraScoreBreakdown, CanastraScoreBreakdown]
  matchWins: Record<string, number>
}
export interface CanastraTurn { canTakeDiscard: boolean }
export interface CanastraRematchStatus { accepted: string[]; pending: string[] }

interface CanastraGameState {
  myId: string
  roomId: string | null
  roomName: string
  config: CanastraRoomConfig | null
  players: CanastraPlayer[]
  tableState: CanastraTableState | null
  myCards: CanastraCard[]
  isStarted: boolean
  turn: CanastraTurn | null
  /** Epoch ms when the current turn auto-resolves — null when nobody is on the clock. */
  turnDeadline: number | null
  roundEnd: CanastraRoundEnd | null
  rematch: CanastraRematchStatus | null
  error: string | null
}

function initialState(myId: string): CanastraGameState {
  return {
    myId, roomId: null, roomName: '', config: null, players: [], tableState: null,
    myCards: [], isStarted: false, turn: null, turnDeadline: null,
    roundEnd: null, rematch: null, error: null,
  }
}

function reducer(state: CanastraGameState, msg: ServerMessage): CanastraGameState {
  switch (msg.type) {
    case 'canastra_room_joined':
      return { ...initialState(msg.yourId), roomId: msg.roomId, roomName: msg.roomName, config: msg.config }
    case 'canastra_room_left':
      return initialState(state.myId)
    case 'canastra_room_error':
      return { ...state, error: msg.message }
    case 'canastra_player_list':
      return { ...state, players: msg.players }
    case 'canastra_game_started':
      return { ...state, isStarted: true, roundEnd: null, rematch: null }
    case 'canastra_hand_dealt':
      return {
        ...state, myCards: msg.yourCards, players: msg.players, tableState: msg.tableState,
        turn: null, roundEnd: null, rematch: null,
      }
    case 'canastra_your_turn':
      return { ...state, turn: { canTakeDiscard: msg.canTakeDiscard }, turnDeadline: Date.now() + msg.timeoutSeconds * 1000 }
    case 'canastra_state_update':
      return { ...state, tableState: msg.tableState, players: msg.players }
    case 'canastra_hand_update':
      return { ...state, myCards: msg.cards }
    case 'canastra_round_end':
      return {
        ...state, tableState: msg.tableState, turn: null, turnDeadline: null,
        roundEnd: { winnerTeam: msg.winnerTeam, scores: msg.scores, breakdown: msg.breakdown, matchWins: msg.matchWins },
      }
    case 'canastra_rematch_status':
      return { ...state, rematch: { accepted: msg.accepted, pending: msg.pending } }
    default:
      return state
  }
}

export function useCanastraGame(myId: string) {
  const [state, dispatch] = useReducer(reducer, myId, initialState)

  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type.startsWith('canastra_')) dispatch(msg)
  }, [])

  return { canastraState: state, handleCanastraMessage: handleMessage }
}
