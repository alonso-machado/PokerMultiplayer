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
  // Truco (see below)
  | TrucoClientMessage
  // Truco Gaúcho (see below)
  | GauchoClientMessage

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
  // ── Truco (see below) ─────────────────────────────────────────────────────
  | TrucoServerMessage
  // ── Truco Gaúcho (see below) ──────────────────────────────────────────────
  | GauchoServerMessage

export interface ShowdownResult {
  playerId: string
  playerName: string
  cards: Card[]       // hole cards (2)
  bestCards: Card[]   // best 5-card combination used
  handName: string
  won: number
}

// ─── Truco ──────────────────────────────────────────────────────────────────
// See .claude/Truco.md for the full rules this section's types model.

export type TrucoMode = '1x1' | '2x2'
export type TrucoManilhaVariant = 'vira' | 'fixed'   // vira = Paulista, fixed = Mineiro

export interface TrucoRoomConfig {
  mode: TrucoMode
  manilhaVariant: TrucoManilhaVariant
}

export interface TrucoRoomSummary {
  id: string
  name: string
  creatorName: string
  playerCount: number
  maxPlayers: number   // 2 (1x1) or 4 (2x2)
  status: RoomStatus
  config: TrucoRoomConfig
}

export type TrucoPlayerStatus = 'waiting' | 'active' | 'mao_de_onze_pending' | 'disconnected'

export interface TrucoPlayer {
  id: string
  name: string
  seatIndex: number
  teamIndex: 0 | 1
  status: TrucoPlayerStatus
  matchWins: number
}

export type TrucoCallLevel = 1 | 3 | 6 | 9 | 12
export type TrucoPhase = 'waiting' | 'mao_de_onze_decision' | 'playing' | 'hand_end' | 'match_end'

export interface TrucoVazaCard {
  playerId: string
  card: Card
}

export interface TrucoTableState {
  phase: TrucoPhase
  vira: Card | null              // null in 'fixed' variant
  manilhaCards: Card[]           // the 4 cards that count as manilha this hand
  vaza: 1 | 2 | 3
  vazaCardsPlayed: TrucoVazaCard[]
  vazaWinners: (0 | 1 | null)[]  // one entry per vaza resolved so far (0-3); null = that vaza tied
  stake: TrucoCallLevel
  pendingStake: TrucoCallLevel | null  // proposed level awaiting accept/decline/raise, if any
  stakeCalledByTeam: 0 | 1 | null
  awaitingResponseFromTeam: 0 | 1 | null
  dealerSeat: number
  leaderSeat: number             // holds "a mão" — leads the current vaza
  currentSeat: number            // whose turn to act (play or respond)
  scores: [number, number]
}

// ─── WebSocket: Client → Server (Truco) ────────────────────────────────────

export type TrucoClientMessage =
  | { type: 'truco_list_rooms' }
  | { type: 'truco_create_room'; roomName: string; config: TrucoRoomConfig }
  | { type: 'truco_join_room'; roomId: string }
  | { type: 'truco_leave_room' }
  | { type: 'truco_play_card'; card: Card }
  | { type: 'truco_call_truco' }
  | { type: 'truco_respond'; accept: boolean }
  | { type: 'truco_mao_de_onze_decision'; accept: boolean }
  | { type: 'truco_rematch_vote'; accept: boolean }

// ─── WebSocket: Server → Client (Truco) ────────────────────────────────────

export type TrucoServerMessage =
  | { type: 'truco_room_list'; rooms: TrucoRoomSummary[] }
  | { type: 'truco_room_joined'; roomId: string; roomName: string; config: TrucoRoomConfig; yourId: string }
  | { type: 'truco_room_left'; reason?: 'manual' | 'expired' | 'abandoned' | 'rematch_declined' }
  | { type: 'truco_room_error'; message: string }
  | { type: 'truco_player_list'; players: TrucoPlayer[] }
  | { type: 'truco_game_started' }
  /** Private — sent only to the receiving player at the start of each hand */
  | { type: 'truco_hand_dealt'; yourCards: Card[]; players: TrucoPlayer[]; tableState: TrucoTableState }
  /** Broadcast — vira card revealed ('vira' variant only) */
  | { type: 'truco_vira_revealed'; vira: Card; manilhaCards: Card[] }
  /** Private — sent to the player whose turn it is */
  | { type: 'truco_your_turn'; canCallTruco: boolean; canRespond: boolean; timeoutSeconds: number }
  /** Broadcast — a card was played */
  | { type: 'truco_card_played'; playerId: string; card: Card; tableState: TrucoTableState }
  /** Broadcast — a vaza was resolved */
  | { type: 'truco_vaza_result'; winnerTeam: 0 | 1 | null; tableState: TrucoTableState }
  /** Broadcast — someone called truco/seis/nove/doze */
  | { type: 'truco_call_made'; playerId: string; level: TrucoCallLevel; tableState: TrucoTableState }
  /** Broadcast — a team accepted or ran from a pending call */
  | { type: 'truco_call_responded'; playerId: string; accept: boolean; tableState: TrucoTableState }
  /**
   * Private — sent only to players on the affected team(s) at mão de 11/ferro.
   * teamCards is that recipient's team's combined hand (self + partner in 2x2).
   */
  | { type: 'truco_mao_de_onze_prompt'; teamCards: Card[]; isFerro: boolean; timeoutSeconds: number }
  /** Broadcast — hand ended, points awarded */
  | { type: 'truco_hand_end'; winnerTeam: 0 | 1 | null; points: number; reason: 'vazas' | 'corri' | 'mao_de_onze_run'; tableState: TrucoTableState }
  /** Broadcast — match ended (a team hit 12) */
  | { type: 'truco_match_end'; winnerTeam: 0 | 1; scores: [number, number]; matchWins: Record<string, number> }
  /** Broadcast — rematch vote progress */
  | { type: 'truco_rematch_status'; accepted: string[]; pending: string[] }

// ─── Truco Gaúcho / Espanhol ──────────────────────────────────────────────
// See .claude/TrucoGaucho.md for the full rules this section's types model.
// Separate game from Truco above — no shared runtime state, only the same
// message-shape conventions.

export type GauchoMode = '1x1' | '2x2'

export interface GauchoRoomConfig {
  mode: GauchoMode
  // No manilha choice — this variant's manilhas are always the fixed
  // A♠ > A♣ > 7♠ > 7♦ set, never a vira.
}

export interface GauchoRoomSummary {
  id: string
  name: string
  creatorName: string
  playerCount: number
  maxPlayers: number   // 2 (1x1) or 4 (2x2)
  status: RoomStatus
  config: GauchoRoomConfig
}

export type GauchoPlayerStatus = 'waiting' | 'active' | 'mao_de_onze_pending' | 'disconnected'

export interface GauchoPlayer {
  id: string
  name: string
  seatIndex: number
  teamIndex: 0 | 1
  status: GauchoPlayerStatus
  matchWins: number
}

export type GauchoCallLevel = 1 | 2 | 3 | 4
export type GauchoPhase = 'waiting' | 'mao_de_onze_decision' | 'playing' | 'hand_end' | 'match_end'

export interface GauchoVazaCard {
  playerId: string
  card: Card
}

export type GauchoEnvidoCallLevel = 'envido' | 'real_envido' | 'falta_envido'
export type GauchoFlorCallLevel = 'flor' | 'contra_flor' | 'contra_flor_e_o_resto'

export interface GauchoEnvidoState {
  status: 'available' | 'closed'
  pendingCall: GauchoEnvidoCallLevel | null
  calledByTeam: 0 | 1 | null
  awaitingResponseFromTeam: 0 | 1 | null
  stake: number   // points already locked in by an accept so far (0 = nothing accepted yet)
}

export interface GauchoFlorState {
  status: 'available' | 'closed'
  pendingCall: GauchoFlorCallLevel | null
  calledByTeam: 0 | 1 | null
  awaitingResponseFromTeam: 0 | 1 | null
  stake: number
}

export interface GauchoTableState {
  phase: GauchoPhase
  manilhaCards: Card[]           // always the 4 fixed Gaúcho manilhas — constant all match
  vaza: 1 | 2 | 3
  vazaCardsPlayed: GauchoVazaCard[]
  vazaWinners: (0 | 1 | null)[]
  stake: GauchoCallLevel
  pendingStake: GauchoCallLevel | null
  stakeCalledByTeam: 0 | 1 | null
  awaitingResponseFromTeam: 0 | 1 | null
  envido: GauchoEnvidoState
  flor: GauchoFlorState
  dealerSeat: number
  leaderSeat: number
  currentSeat: number
  scores: [number, number]
}

// ─── WebSocket: Client → Server (Truco Gaúcho) ─────────────────────────────

export type GauchoClientMessage =
  | { type: 'gaucho_list_rooms' }
  | { type: 'gaucho_create_room'; roomName: string; config: GauchoRoomConfig }
  | { type: 'gaucho_join_room'; roomId: string }
  | { type: 'gaucho_leave_room' }
  | { type: 'gaucho_play_card'; card: Card }
  | { type: 'gaucho_call_truco' }
  | { type: 'gaucho_respond_truco'; accept: boolean }
  | { type: 'gaucho_call_envido' }
  | { type: 'gaucho_respond_envido'; accept: boolean }
  | { type: 'gaucho_call_flor' }
  | { type: 'gaucho_respond_flor'; accept: boolean }
  | { type: 'gaucho_mao_de_onze_decision'; accept: boolean }
  | { type: 'gaucho_rematch_vote'; accept: boolean }

// ─── WebSocket: Server → Client (Truco Gaúcho) ─────────────────────────────

export type GauchoServerMessage =
  | { type: 'gaucho_room_list'; rooms: GauchoRoomSummary[] }
  | { type: 'gaucho_room_joined'; roomId: string; roomName: string; config: GauchoRoomConfig; yourId: string }
  | { type: 'gaucho_room_left'; reason?: 'manual' | 'expired' | 'abandoned' | 'rematch_declined' }
  | { type: 'gaucho_room_error'; message: string }
  | { type: 'gaucho_player_list'; players: GauchoPlayer[] }
  | { type: 'gaucho_game_started' }
  /** Private — sent only to the receiving player at the start of each hand */
  | { type: 'gaucho_hand_dealt'; yourCards: Card[]; players: GauchoPlayer[]; tableState: GauchoTableState }
  /** Private — sent to the player whose turn it is (or who may respond) */
  | {
      type: 'gaucho_your_turn'
      canCallTruco: boolean; canRespondTruco: boolean
      canCallEnvido: boolean; canRespondEnvido: boolean
      canCallFlor: boolean; canRespondFlor: boolean
      timeoutSeconds: number
    }
  /** Broadcast — a card was played */
  | { type: 'gaucho_card_played'; playerId: string; card: Card; tableState: GauchoTableState }
  /** Broadcast — a vaza was resolved */
  | { type: 'gaucho_vaza_result'; winnerTeam: 0 | 1 | null; tableState: GauchoTableState }
  /** Broadcast — someone called truco/retruco/vale_quatro */
  | { type: 'gaucho_truco_call_made'; playerId: string; level: GauchoCallLevel; tableState: GauchoTableState }
  /** Broadcast — a team accepted or ran from a pending truco call */
  | { type: 'gaucho_truco_call_responded'; playerId: string; accept: boolean; tableState: GauchoTableState }
  /** Broadcast — someone called/raised envido */
  | { type: 'gaucho_envido_call_made'; playerId: string; level: GauchoEnvidoCallLevel; tableState: GauchoTableState }
  /** Broadcast — envido negotiation concluded (accepted+compared, or declined) */
  | {
      type: 'gaucho_envido_result'
      winnerTeam: 0 | 1 | null; points: number; reason: 'compared' | 'corri'
      values: Record<string, number>   // playerId → envido value; empty on 'corri'
      tableState: GauchoTableState
    }
  /** Broadcast — someone called/raised flor */
  | { type: 'gaucho_flor_call_made'; playerId: string; level: GauchoFlorCallLevel; tableState: GauchoTableState }
  /** Broadcast — flor negotiation concluded (uncontested, accepted+compared, or declined) */
  | {
      type: 'gaucho_flor_result'
      winnerTeam: 0 | 1 | null; points: number; reason: 'uncontested' | 'compared' | 'corri'
      values: Record<string, number>   // playerId → flor value; only players who declared
      tableState: GauchoTableState
    }
  /**
   * Private — sent only to players on the affected team(s) at mão de 11/ferro.
   * teamCards is that recipient's team's combined hand (self + partner in 2x2).
   */
  | { type: 'gaucho_mao_de_onze_prompt'; teamCards: Card[]; isFerro: boolean; timeoutSeconds: number }
  /** Broadcast — hand ended, points awarded */
  | { type: 'gaucho_hand_end'; winnerTeam: 0 | 1 | null; points: number; reason: 'vazas' | 'corri' | 'mao_de_onze_run'; tableState: GauchoTableState }
  /** Broadcast — match ended (a team hit 12) */
  | { type: 'gaucho_match_end'; winnerTeam: 0 | 1; scores: [number, number]; matchWins: Record<string, number> }
  /** Broadcast — rematch vote progress */
  | { type: 'gaucho_rematch_status'; accepted: string[]; pending: string[] }
