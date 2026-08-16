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

/** One of the six room-based games, used to scope lobby room-list updates to
 *  whichever one the client is actually looking at — see `set_active_lobby`
 *  below. */
export type LobbyGame = 'poker' | 'truco' | 'gaucho' | 'canastra' | 'blackjack' | 'pushyourluckdraw'

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
  /** Tells the server which game's lobby the client is currently looking at
   *  (e.g. on switching tabs) — the server subscribes this connection to
   *  just that game's room-list broadcasts (unsubscribing from the other
   *  five) and replies with a fresh snapshot. Send it once a game's UI is
   *  actually being shown; a player already seated in that game's room
   *  doesn't need its lobby updates regardless of which tab is active. */
  | { type: 'set_active_lobby'; game: LobbyGame }
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
  // Canastra / Buraco (see below)
  | CanastraClientMessage
  // Blackjack / 21 (see below)
  | BlackjackClientMessage
  // Push Your Luck Draw (see below)
  | PushYourLuckDrawClientMessage

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
  /** Broadcast once, right before the process exits for a deploy/restart —
   *  gives the client a chance to show a clear "restarting" message instead
   *  of a silent dead connection that looks like a bug. See index.ts's
   *  SIGTERM/SIGINT handlers. */
  | { type: 'server_restarting' }
  // ── Truco (see below) ─────────────────────────────────────────────────────
  | TrucoServerMessage
  // ── Truco Gaúcho (see below) ──────────────────────────────────────────────
  | GauchoServerMessage
  // ── Canastra / Buraco (see below) ─────────────────────────────────────────
  | CanastraServerMessage
  // ── Blackjack / 21 (see below) ────────────────────────────────────────────
  | BlackjackServerMessage
  // ── Push Your Luck Draw (see below) ───────────────────────────────────────
  | PushYourLuckDrawServerMessage

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

// ─── Canastra / Buraco ──────────────────────────────────────────────────────
// See .claude/Canastra.md for the full rules this section's types model.
// Separate game from Poker/Truco/Gaúcho above — no shared runtime state.
// Uses its own card shape (CanastraCard) instead of `Card`: the 108-card
// double deck has duplicate suit+rank combinations and jokers, so each card
// needs a stable unique `id` and `suit`/`rank` become nullable for jokers.

export type CanastraMode = '1x1' | '2x2'

export interface CanastraCard {
  id: string          // unique per physical card — 2 decks duplicate suit+rank
  suit: Suit | null   // null when isJoker
  rank: Rank | null   // null when isJoker
  isJoker: boolean
}

export interface CanastraRoomConfig {
  mode: CanastraMode
}

export interface CanastraRoomSummary {
  id: string
  name: string
  creatorName: string
  playerCount: number
  maxPlayers: number   // 2 (1x1) or 4 (2x2)
  status: RoomStatus
  config: CanastraRoomConfig
}

export type CanastraPlayerStatus = 'waiting' | 'active' | 'disconnected'

export interface CanastraPlayer {
  id: string
  name: string
  seatIndex: number
  teamIndex: 0 | 1
  status: CanastraPlayerStatus
  handCount: number   // card count only — actual cards are private, see CanastraCard messages
  matchWins: number
}

export type CanastraMeldKind = 'sequence' | 'group'

export interface CanastraMeld {
  id: string
  ownerTeam: 0 | 1
  kind: CanastraMeldKind
  cards: CanastraCard[]
  isCanastra: boolean   // true once the meld has 7+ cards
  isClean: boolean      // meaningful only when isCanastra — no wildcard used
}

export type CanastraPhase = 'waiting' | 'playing' | 'round_end'
/** Within `playing`: `draw` = must draw from stock or take the discard pile
 *  before anything else; `act` = has drawn, may lay/add melds any number of
 *  times, then must discard to end the turn. */
export type CanastraTurnStage = 'draw' | 'act'

export interface CanastraTeamState {
  mortoTaken: boolean
  mortoCount: number   // 11 until taken, 0 after — actual cards are private until merged into a hand
  melds: CanastraMeld[]
}

export interface CanastraTableState {
  phase: CanastraPhase
  turnStage: CanastraTurnStage
  stockCount: number
  discardPile: CanastraCard[]   // face-up, visible to everyone; last element = top of the pile
  teams: [CanastraTeamState, CanastraTeamState]
  currentSeat: number
  scores: [number, number] | null   // set only once phase === 'round_end'
}

export interface CanastraScoreBreakdown {
  meldPoints: number
  handPenalty: number    // negative — value of cards left in hand
  mortoPenalty: number   // -100 if the team never took its morto, else 0
  battingBonus: number   // +100 for the team that ended the round, else 0
  total: number
}

// ─── WebSocket: Client → Server (Canastra) ─────────────────────────────────

/** How the just-picked-up top discard card is used — required to legally
 *  take the discard pile (see .claude/Canastra.md → "Comprar o lixo"). */
export type CanastraMeldPlan =
  | { kind: 'new'; cardIds: string[] }               // new meld — includes the top discard card's id
  | { kind: 'append'; meldId: string; cardId: string } // cardId = the top discard card's id

export type CanastraClientMessage =
  | { type: 'canastra_list_rooms' }
  | { type: 'canastra_create_room'; roomName: string; config: CanastraRoomConfig }
  | { type: 'canastra_join_room'; roomId: string }
  | { type: 'canastra_leave_room' }
  | { type: 'canastra_draw_stock' }
  | { type: 'canastra_take_discard'; meldPlan: CanastraMeldPlan }
  | { type: 'canastra_lay_meld'; cardIds: string[] }
  | { type: 'canastra_add_to_meld'; meldId: string; cardIds: string[] }
  | { type: 'canastra_discard'; cardId: string }
  | { type: 'canastra_rematch_vote'; accept: boolean }

// ─── WebSocket: Server → Client (Canastra) ─────────────────────────────────

export type CanastraServerMessage =
  | { type: 'canastra_room_list'; rooms: CanastraRoomSummary[] }
  | { type: 'canastra_room_joined'; roomId: string; roomName: string; config: CanastraRoomConfig; yourId: string }
  | { type: 'canastra_room_left'; reason?: 'manual' | 'expired' | 'abandoned' | 'rematch_declined' }
  | { type: 'canastra_room_error'; message: string }
  | { type: 'canastra_player_list'; players: CanastraPlayer[] }
  | { type: 'canastra_game_started' }
  /** Private — sent only to the receiving player at the start of the round */
  | { type: 'canastra_hand_dealt'; yourCards: CanastraCard[]; players: CanastraPlayer[]; tableState: CanastraTableState }
  /** Private — sent to the player whose turn it is */
  | { type: 'canastra_your_turn'; canTakeDiscard: boolean; timeoutSeconds: number }
  /** Broadcast — public table state changed (draw, meld, add, discard, morto pickup) */
  | { type: 'canastra_state_update'; tableState: CanastraTableState; players: CanastraPlayer[] }
  /** Private — sent only to the player(s) whose hand changed by this action */
  | { type: 'canastra_hand_update'; cards: CanastraCard[] }
  /** Broadcast — the round (= the whole match) ended, via batida or monte exhausted */
  | {
      type: 'canastra_round_end'
      winnerTeam: 0 | 1 | null   // null on a tie
      scores: [number, number]
      breakdown: [CanastraScoreBreakdown, CanastraScoreBreakdown]
      matchWins: Record<string, number>
      tableState: CanastraTableState
    }
  /** Broadcast — rematch vote progress */
  | { type: 'canastra_rematch_status'; accepted: string[]; pending: string[] }

// ─── Blackjack / 21 ─────────────────────────────────────────────────────────
// See .claude/Blackjack.md for the full rules this section's types model.
// Rules source: https://bicyclecards.com/how-to-play/blackjack — the only
// ruleset used for this game (deliberately: many house variants exist online).
// Structurally different from every other game here: players don't play
// against each other, they each play their own hand against a shared dealer
// hand, and all cards are public except the dealer's hole card while it's
// hidden — no private per-player "yourCards" messages are needed. There's
// also no room creation: see BlackjackClientMessage below, matchmaking
// replaces it entirely (single "join", server assigns a table).

export const BLACKJACK_MAX_PLAYERS = 7
export const BLACKJACK_STARTING_CHIPS = 100

export type BlackjackPlayerStatus = 'waiting' | 'active' | 'disconnected'
export type BlackjackOutcome = 'blackjack' | 'win' | 'push' | 'lose'

export interface BlackjackHand {
  cards: Card[]
  bet: number
  isDoubled: boolean
  isSplitAces: boolean   // one of the two hands created by splitting aces — one card only, stands automatically
  isBusted: boolean
  isBlackjack: boolean   // natural 21 — exactly the original 2-card deal, never true after a split
  isStood: boolean
  outcome: BlackjackOutcome | null   // set only once tableState.phase === 'round_end'
  payout: number                     // total chips returned (bet + winnings) at round end; 0 on a loss/bust
}

export interface BlackjackPlayer {
  id: string
  name: string
  seatIndex: number
  chips: number
  status: BlackjackPlayerStatus
  hands: BlackjackHand[]   // empty outside a round; 1 normally, 2 after a split
  insuranceBet: number     // 0 if none taken this round
}

export interface BlackjackDealerHand {
  cards: Card[]        // length 1 while holeHidden — the hidden card is never sent to clients
  holeHidden: boolean
  isBusted: boolean
  isBlackjack: boolean
}

export type BlackjackPhase =
  | 'waiting'        // no players seated yet
  | 'betting'        // simultaneous betting window, all seated players
  | 'insurance'      // dealer shows an Ace — simultaneous insurance window
  | 'player_turns'   // sequential per-seat hit/stand/double/split
  | 'dealer_turn'    // dealer reveals hole card and auto-plays
  | 'round_end'      // outcomes/payouts settled, shown briefly before the next betting window

export interface BlackjackTableState {
  phase: BlackjackPhase
  dealer: BlackjackDealerHand
  currentSeat: number | null        // whose turn during player_turns
  currentHandIndex: number | null   // which of that seat's hands (0 or 1) is active
}

// ─── WebSocket: Client → Server (Blackjack) ────────────────────────────────

export type BlackjackClientMessage =
  | { type: 'blackjack_join' }   // no roomId/config — server matchmakes into any table with a free seat, or creates one
  | { type: 'blackjack_leave_room' }
  | { type: 'blackjack_place_bet'; amount: number }
  | { type: 'blackjack_insurance_bet'; amount: number }   // 0 = decline
  | { type: 'blackjack_hit' }
  | { type: 'blackjack_stand' }
  | { type: 'blackjack_double' }
  | { type: 'blackjack_split' }

// ─── WebSocket: Server → Client (Blackjack) ────────────────────────────────

export type BlackjackServerMessage =
  | { type: 'blackjack_room_joined'; roomId: string; yourId: string }
  | { type: 'blackjack_room_left'; reason?: 'manual' | 'expired' | 'busted' }
  | { type: 'blackjack_room_error'; message: string }
  | { type: 'blackjack_player_list'; players: BlackjackPlayer[] }
  | { type: 'blackjack_game_started' }
  /** Broadcast — new simultaneous betting window opens; one shared countdown for everyone, not per-seat. */
  | { type: 'blackjack_betting_open'; players: BlackjackPlayer[]; tableState: BlackjackTableState; timeoutSeconds: number }
  /** Broadcast — dealer shows an Ace; simultaneous insurance window. Each
   *  player's own cap is floor(their hand's bet / 2) — derived client-side
   *  from `players`, not sent as a single number (bets differ per player). */
  | { type: 'blackjack_insurance_open'; timeoutSeconds: number; players: BlackjackPlayer[]; tableState: BlackjackTableState }
  /** Private — sent to the seat whose turn it is during player_turns. */
  | { type: 'blackjack_your_turn'; handIndex: number; validActions: ('hit' | 'stand' | 'double' | 'split')[]; timeoutSeconds: number }
  /** Broadcast — generic re-render after any bet/insurance/hit/stand/double/split/dealer card. */
  | { type: 'blackjack_state_update'; players: BlackjackPlayer[]; tableState: BlackjackTableState }
  /** Broadcast — round settled: every hand's outcome/payout and the dealer's final hand. */
  | { type: 'blackjack_round_end'; players: BlackjackPlayer[]; dealer: BlackjackDealerHand; tableState: BlackjackTableState }
  /** Broadcast (lobby-wide, not per-table) — how many tables/players exist right
   *  now, so the lobby can show activity without a full room list to browse. */
  | { type: 'blackjack_lobby_stats'; tableCount: number; playerCount: number }

// ─── Push Your Luck Draw ────────────────────────────────────────────────────
// See .claude/PushYourLuckDraw.md for the full rules this section's types
// model. Original ruleset (not adapted from a published game) — push-your-luck
// "draw or stop", bust on drawing a rank you already hold this round, with a
// Joker "save" and an Ace of Spades ×2 multiplier. Uses its own card shape
// (same pattern as CanastraCard) because the deck isn't a standard 52: copy
// count per rank equals the rank's value (the 7 has 7 copies, the K has 13),
// plus a configurable number of Jokers — either a flat FIXED_JOKER_COUNT
// (6), or JOKERS_PER_PLAYER (3) per seated player rescaled live as players
// join/leave mid-match, picked per table via `jokerMode` — see "Baralho" in
// the doc. Free 2-8 room/lobby joining, auto-starts 300ms after the 2nd join,
// crossed with Truco's "several hands/rounds until a target score, then a
// rematch vote" match loop. All hands are public — no private per-player
// card messages needed, unlike every other game here. Single deck mode: the
// monte is dealt once per match and only reshuffled from the accumulated
// discard when it runs dry (no more fresh-per-round option — see "Baralho").

export interface PushYourLuckDrawCard {
  id: string           // unique per physical card — many ranks have duplicate copies
  suit: Suit | null     // null when isJoker/isHalf; the Ace of Spades is suit:'spades', rank:'A' (only 1 in the whole deck)
  rank: Rank | null     // null when isJoker/isHalf
  isJoker: boolean
  /** The '@' halving marker thrown by another player's spare Joker — see
   *  "Coringa" in the doc. Never dealt from the monte; synthesized only by
   *  a throw_joker action, so it's mutually exclusive with isJoker. */
  isHalf: boolean
}

/** 'fixed' = always FIXED_JOKER_COUNT (6) Jokers, never rescaled by
 *  join/leave. 'per_player' = JOKERS_PER_PLAYER (3) × seated players, live-
 *  rescaled on join/leave — see .claude/PushYourLuckDraw.md → "Baralho". */
export type PushYourLuckDrawJokerMode = 'fixed' | 'per_player'

export interface PushYourLuckDrawRoomConfig {
  maxPlayers: number    // 2–8
  targetScore: number   // match ends once someone's total reaches this, default 150
  jokerMode: PushYourLuckDrawJokerMode
}

export interface PushYourLuckDrawRoomSummary {
  id: string
  name: string
  creatorName: string
  playerCount: number
  maxPlayers: number
  status: RoomStatus
  config: PushYourLuckDrawRoomConfig
}

/** 'stood' = locked in this round's score; 'busted' = lost this round's hand,
 *  scored 0. Both reset to 'active' at the start of the next round. */
export type PushYourLuckDrawPlayerStatus = 'waiting' | 'active' | 'stood' | 'busted'

export interface PushYourLuckDrawPlayer {
  id: string
  name: string
  status: PushYourLuckDrawPlayerStatus
  roundHand: PushYourLuckDrawCard[]   // fully public — see .claude/PushYourLuckDraw.md
  savesHeld: number                   // Jokers banked this round — the first is locked as bust protection,
                                       // any beyond it can also be thrown at another player (see doc)
  roundScore: number                  // locked once stood/busted, 0 while still active — the front-end
                                       // computes its own live "if I stopped now" preview off roundHand
  totalScore: number                  // cumulative across the match
}

export type PushYourLuckDrawPhase = 'waiting' | 'playing' | 'round_complete' | 'match_complete'

export interface PushYourLuckDrawTableState {
  phase: PushYourLuckDrawPhase
  turnPlayerId: string | null
  monteCount: number
  targetScore: number
}

// ─── WebSocket: Client → Server (Push Your Luck Draw) ──────────────────────

export type PushYourLuckDrawClientMessage =
  | { type: 'pushyourluckdraw_list_rooms' }
  | { type: 'pushyourluckdraw_create_room'; roomName: string; config: PushYourLuckDrawRoomConfig }
  | { type: 'pushyourluckdraw_join_room'; roomId: string }
  | { type: 'pushyourluckdraw_leave_room' }
  | { type: 'pushyourluckdraw_start_game' }   // manual fallback — mirrors the lobby's start_game
  | { type: 'pushyourluckdraw_draw' }
  | { type: 'pushyourluckdraw_stop' }
  /** Turn action — spends 1 spare Joker (savesHeld must be ≥2, one always
   *  stays in reserve) to drop an '@' halving card into targetId's round
   *  hand. Consumes the turn like draw/stop. See .claude/PushYourLuckDraw.md. */
  | { type: 'pushyourluckdraw_throw_joker'; targetId: string }
  | { type: 'pushyourluckdraw_rematch_vote'; accept: boolean }

// ─── WebSocket: Server → Client (Push Your Luck Draw) ──────────────────────

export type PushYourLuckDrawServerMessage =
  | { type: 'pushyourluckdraw_room_list'; rooms: PushYourLuckDrawRoomSummary[] }
  | { type: 'pushyourluckdraw_room_joined'; roomId: string; roomName: string; config: PushYourLuckDrawRoomConfig; yourId: string }
  | { type: 'pushyourluckdraw_room_left'; reason?: 'manual' | 'expired' | 'rematch_declined' }
  | { type: 'pushyourluckdraw_room_error'; message: string }
  | { type: 'pushyourluckdraw_player_list'; players: PushYourLuckDrawPlayer[] }
  | { type: 'pushyourluckdraw_game_started' }
  /** Broadcast — a new round was dealt (continuing the match's monte — see "Baralho") */
  | { type: 'pushyourluckdraw_round_started'; players: PushYourLuckDrawPlayer[]; tableState: PushYourLuckDrawTableState }
  /** Broadcast — public table/player sync outside of a specific draw/stop (e.g. on reconnect) */
  | { type: 'pushyourluckdraw_state_update'; players: PushYourLuckDrawPlayer[]; tableState: PushYourLuckDrawTableState }
  /** Private — sent only to the player whose turn it is */
  | { type: 'pushyourluckdraw_your_turn'; timeoutSeconds: number }
  /** Broadcast — result of a draw. card is null only for 'forced_stop' (monte and discard both
   *  exhausted mid-decision — see .claude/PushYourLuckDraw.md → "Esgotamento do Monte"). On a
   *  'busted' outcome, bustedHand is the round hand exactly as it stood right before it was
   *  cleared (so the client can show the player which card duplicated `card`) — null otherwise. */
  | {
      type: 'pushyourluckdraw_draw_result'
      playerId: string
      outcome: 'drew' | 'joker' | 'saved' | 'busted' | 'forced_stop'
      card: PushYourLuckDrawCard | null
      bustedHand: PushYourLuckDrawCard[] | null
      players: PushYourLuckDrawPlayer[]
      tableState: PushYourLuckDrawTableState
    }
  /** Broadcast — a player chose to stop, locking in their round score */
  | { type: 'pushyourluckdraw_stop_result'; playerId: string; roundScore: number; players: PushYourLuckDrawPlayer[]; tableState: PushYourLuckDrawTableState }
  /** Broadcast — a player threw a spare Joker at targetId, dropping an '@' into their round hand */
  | { type: 'pushyourluckdraw_throw_result'; playerId: string; targetId: string; players: PushYourLuckDrawPlayer[]; tableState: PushYourLuckDrawTableState }
  /** Broadcast — round ended (everyone stood or busted); totals updated */
  | { type: 'pushyourluckdraw_round_end'; players: PushYourLuckDrawPlayer[]; tableState: PushYourLuckDrawTableState }
  /** Broadcast — match ended (someone's total reached the target score) */
  | { type: 'pushyourluckdraw_match_end'; players: PushYourLuckDrawPlayer[]; winnerIds: string[]; matchWins: Record<string, number> }
  /** Broadcast — rematch vote progress */
  | { type: 'pushyourluckdraw_rematch_status'; accepted: string[]; pending: string[] }
