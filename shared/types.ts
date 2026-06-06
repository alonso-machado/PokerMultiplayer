// ─── Card ─────────────────────────────────────────────────────────────────────

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs'
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'

export interface Card { suit: Suit; rank: Rank }

// ─── Player ───────────────────────────────────────────────────────────────────

export type PlayerAction = 'fold' | 'check' | 'call' | 'raise' | 'all-in'

export type PlayerStatus =
  | 'waiting'       // seated, waiting for next hand (e.g. joined mid-game)
  | 'active'        // playing this hand
  | 'folded'
  | 'all-in'
  | 'away'          // tournament-only: auto-folds each turn

export interface Player {
  id: string
  name: string
  chips: number
  bet: number           // current street bet
  totalBet: number      // total bet this hand
  status: PlayerStatus
  seatIndex: number
  isDealer: boolean
  isSmallBlind: boolean
  isBigBlind: boolean
}

// ─── Game / Table ─────────────────────────────────────────────────────────────

export type GamePhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'

export interface TableState {
  phase: GamePhase
  pot: number
  currentBet: number
  minRaise: number
  currentPlayerIndex: number
  dealerIndex: number
  /** All community cards revealed so far (0–5). Frontend keeps this from hand_dealt + community_cards messages. */
  communityCards: Card[]
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

export type RoomStatus = 'waiting' | 'playing'

export interface RoomConfig {
  smallBlind: number
  bigBlind: number
  ante: number
  maxPlayers: number   // 2–6
}

/** Starting chips = bigBlind × 20 */
export function startingChipsFor(config: Pick<RoomConfig, 'bigBlind'>): number {
  return config.bigBlind * 20
}

export interface RoomSummary {
  id: string
  name: string
  creatorName: string
  playerCount: number
  maxPlayers: number
  status: RoomStatus
  config: RoomConfig
}

// ─── Tournament ───────────────────────────────────────────────────────────────

export interface BlindLevel {
  level: number
  smallBlind: number
  bigBlind: number
  ante: number
  durationMinutes: number
}

export type TournamentStatus = 'registering' | 'running' | 'final_table' | 'finished'

export interface TournamentPlayer {
  id: string
  name: string
  chips: number
  tableId: string | null
  tableName: string | null
  rank: number
  eliminated: boolean
  eliminatedAt?: number
}

export interface TournamentInfo {
  id: string
  name: string
  status: TournamentStatus
  scheduledStart: string              // ISO 8601
  registeredCount: number
  activeCount: number
  config: RoomConfig                  // initial blinds
  startingChips: number
  currentBlindLevel: BlindLevel | null
  nextBlindLevel: BlindLevel | null
  nextBlindInSeconds: number | null   // countdown to next blind increase
}

// ─── WebSocket: Client → Server ───────────────────────────────────────────────

export type ClientMessage =
  // Identity — first message on every connection
  | { type: 'hello'; playerId: string; name: string; tournamentToken?: string }
  | { type: 'set_name'; name: string }
  // Lobby
  | { type: 'list_rooms' }
  | { type: 'create_room'; roomName: string; config: RoomConfig }
  | { type: 'join_room'; roomId: string }
  | { type: 'leave_room' }
  | { type: 'start_game' }
  | { type: 'player_action'; action: PlayerAction; amount?: number }
  | { type: 'rebuy' }          // lobby-only: re-enter with starting chips
  | { type: 'rebuy_decline' }  // lobby-only: leave table
  // Tournament
  | { type: 'get_tournament' }
  | { type: 'register_tournament' }
  | { type: 'unregister_tournament' }
  | { type: 'set_away' }   // tournament-only
  | { type: 'set_back' }   // tournament-only

// ─── WebSocket: Server → Client ───────────────────────────────────────────────

export type ServerMessage =
  // ── Lobby ──────────────────────────────────────────────────────────────────
  | { type: 'room_list'; rooms: RoomSummary[] }
  | { type: 'room_joined'; roomId: string; roomName: string; config: RoomConfig }
  | { type: 'room_left'; reason?: 'manual' | 'expired' | 'chips' }
  | { type: 'room_error'; message: string }
  | { type: 'player_list'; players: Player[] }
  | { type: 'game_started' }
  /**
   * Private — sent only to the receiving player at the start of each hand.
   * Contains their 2 hole cards + full table snapshot for rendering.
   */
  | { type: 'hand_dealt'; yourCards: Card[]; players: Player[]; tableState: TableState }
  /**
   * Broadcast — newly revealed community cards.
   * cards.length: flop=3, turn=1, river=1.
   * Frontend accumulates: [] → [c,c,c] → [c,c,c,c] → [c,c,c,c,c]
   */
  | { type: 'community_cards'; cards: Card[]; phase: 'flop' | 'turn' | 'river'; tableState: TableState; players: Player[] }
  /** Private — sent only to the player whose turn it is */
  | { type: 'your_turn'; validActions: PlayerAction[]; minRaise: number; callAmount: number }
  /** Broadcast — result of a player's action */
  | { type: 'player_acted'; playerId: string; action: PlayerAction; amount?: number; tableState: TableState; players: Player[] }
  /** Broadcast — show all hands at showdown */
  | { type: 'showdown'; results: ShowdownResult[]; tableState: TableState; players: Player[] }
  /** Broadcast — announce winner, end of hand */
  | { type: 'hand_end'; winnerId: string; winnerName: string; amount: number; handName?: string }
  /** Lobby-only — player reached 0 chips, offer rebuy with 60s countdown */
  | { type: 'rebuy_prompt'; startingChips: number; timeoutSeconds: 60 }
  // ── Tournament ─────────────────────────────────────────────────────────────
  | { type: 'tournament_info'; tournament: TournamentInfo | null }
  | { type: 'tournament_registered'; token: string }
  | { type: 'tournament_unregistered' }
  | { type: 'tournament_started' }
  | { type: 'tournament_table_assigned'; roomId: string; roomName: string; config: RoomConfig }
  /** Ranking broadcast — sent every 30 s and on eliminations */
  | { type: 'tournament_ranking'; players: TournamentPlayer[]; status: TournamentStatus }
  | { type: 'tournament_final_table'; tableId: string }
  | { type: 'tournament_eliminated'; rank: number; totalPlayers: number }
  | { type: 'tournament_finished'; winnerId: string; winnerName: string }
  | { type: 'tournament_error'; message: string }
  /** Blind level increased */
  | { type: 'blind_update'; current: BlindLevel; next: BlindLevel | null; nextInSeconds: number | null }
  // ── Session ────────────────────────────────────────────────────────────────
  | { type: 'session_restored'; inTournament: boolean; roomId?: string; roomName?: string; config?: RoomConfig }
  /** Sent to the client when a new identity is issued or a tampered token is rejected. */
  | { type: 'identity'; token: string }
  // ── Generic ────────────────────────────────────────────────────────────────
  | { type: 'error'; message: string }

export interface ShowdownResult {
  playerId: string
  playerName: string
  cards: Card[]       // hole cards (2)
  bestCards: Card[]   // best 5-card combination used
  handName: string
  won: number
}
