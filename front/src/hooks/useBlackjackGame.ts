import { useReducer, useCallback } from 'react'
import type { ServerMessage, BlackjackPlayer, BlackjackTableState } from '../../../shared/types'

export interface BlackjackTurn { handIndex: number; validActions: ('hit' | 'stand' | 'double' | 'split')[] }

interface BlackjackGameState {
  myId: string
  roomId: string | null
  players: BlackjackPlayer[]
  tableState: BlackjackTableState | null
  isStarted: boolean
  turn: BlackjackTurn | null
  /** Epoch ms when the current betting/insurance/turn window auto-resolves — null when nothing is on the clock. */
  turnDeadline: number | null
  error: string | null
}

function initialState(myId: string): BlackjackGameState {
  return { myId, roomId: null, players: [], tableState: null, isStarted: false, turn: null, turnDeadline: null, error: null }
}

function reducer(state: BlackjackGameState, msg: ServerMessage): BlackjackGameState {
  switch (msg.type) {
    case 'blackjack_room_joined':
      return { ...initialState(msg.yourId), roomId: msg.roomId }
    case 'blackjack_room_left':
      return initialState(state.myId)
    case 'blackjack_room_error':
      return { ...state, error: msg.message }
    case 'blackjack_player_list':
      return { ...state, players: msg.players }
    case 'blackjack_game_started':
      return { ...state, isStarted: true }
    case 'blackjack_betting_open':
      return { ...state, players: msg.players, tableState: msg.tableState, turn: null, turnDeadline: Date.now() + msg.timeoutSeconds * 1000 }
    case 'blackjack_insurance_open':
      return { ...state, players: msg.players, tableState: msg.tableState, turn: null, turnDeadline: Date.now() + msg.timeoutSeconds * 1000 }
    case 'blackjack_your_turn':
      return { ...state, turn: { handIndex: msg.handIndex, validActions: msg.validActions }, turnDeadline: Date.now() + msg.timeoutSeconds * 1000 }
    case 'blackjack_state_update':
      return { ...state, players: msg.players, tableState: msg.tableState }
    case 'blackjack_round_end':
      return { ...state, players: msg.players, tableState: msg.tableState, turn: null, turnDeadline: null }
    default:
      return state
  }
}

export function useBlackjackGame(myId: string) {
  const [state, dispatch] = useReducer(reducer, myId, initialState)

  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type.startsWith('blackjack_')) dispatch(msg)
  }, [])

  return { blackjackState: state, handleBlackjackMessage: handleMessage }
}
