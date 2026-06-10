import type { RoomConfig, RoomSummary, ServerMessage, PlayerAction } from '../../shared/types'
import { startingChipsFor } from '../../shared/types'
import { PokerGame } from './poker/gameEngine'

export type SendFn = (msg: ServerMessage) => void

interface RoomPlayer { id: string; name: string; send: SendFn; away: boolean; sittingOut: boolean }

export interface RoomOptions {
  tournamentId?: string
  onExpire?: () => void
  onPlayerEliminated?: (playerId: string) => void
}

const EMPTY_TTL           = 10 * 60 * 1000
const REBUY_TIMEOUT_S     = 60
const SHOWDOWN_DURATION_MS = Number(process.env.SHOWDOWN_DURATION_MS ?? 4000)

export class Room {
  readonly id: string
  readonly name: string
  readonly creatorName: string
  readonly config: RoomConfig
  readonly startingChips: number
  readonly tournamentId?: string

  private players: RoomPlayer[] = []
  readonly game: PokerGame
  private started = false
  private expireTimer: ReturnType<typeof setTimeout> | null = null
  private rebuyTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly onExpire?: () => void
  private readonly onPlayerEliminated?: (pid: string) => void

  constructor(id: string, name: string, creatorName: string, config: RoomConfig, opts: RoomOptions = {}) {
    this.id           = id
    this.name         = name
    this.creatorName  = creatorName
    this.config       = config
    this.startingChips = startingChipsFor(config)
    this.tournamentId  = opts.tournamentId
    this.onExpire      = opts.onExpire
    this.onPlayerEliminated = opts.onPlayerEliminated
    this.game = new PokerGame(config)
    if (!opts.tournamentId) this.scheduleExpiry()
  }

  // ── Config (for tournament blind updates) ────────────────────────────────

  updateConfig(config: RoomConfig): void {
    this.game.updateConfig(config)
  }

  // ── Expiry ────────────────────────────────────────────────────────────────

  private scheduleExpiry(): void {
    this.clearExpiry()
    this.expireTimer = setTimeout(() => {
      if (this.players.length < 2) {
        for (const p of this.players) p.send({ type: 'room_left', reason: 'expired' })
        this.onExpire?.()
      }
    }, EMPTY_TTL)
  }
  private clearExpiry(): void {
    if (this.expireTimer) { clearTimeout(this.expireTimer); this.expireTimer = null }
  }

  // ── Info ──────────────────────────────────────────────────────────────────

  get playerCount() { return this.players.length }
  get isFull()      { return this.players.length >= this.config.maxPlayers }
  get isStarted()   { return this.started }

  summary(): RoomSummary {
    return {
      id: this.id, name: this.name, creatorName: this.creatorName,
      playerCount: this.players.length, maxPlayers: this.config.maxPlayers,
      status: this.started ? 'playing' : 'waiting',
      config: this.config,
    }
  }

  // ── Join / Leave ──────────────────────────────────────────────────────────

  join(id: string, name: string, send: SendFn, chips?: number): boolean {
    if (this.isFull) return false
    // Cancel pending rebuy timeout if player rejoins
    this.cancelRebuyTimer(id)
    this.players.push({ id, name, send, away: false, sittingOut: false })
    this.game.addPlayer(id, name, chips ?? this.startingChips)
    send({ type: 'room_joined', roomId: this.id, roomName: this.name, config: this.config })
    if (this.started) {
      // Mid-game join: send current table state so the player can watch the hand in progress.
      // yourCards is empty — they'll receive real cards on the next hand.
      send({ type: 'game_started' })
      send({
        type: 'hand_dealt',
        yourCards: [],
        players: this.game.publicPlayers(),
        tableState: this.game.tableState,
      })
    }
    this.broadcastAll({ type: 'player_list', players: this.game.publicPlayers() })
    if (this.players.length >= 2) {
      this.clearExpiry()
      if (!this.started && !this.tournamentId) {
        // Lobby: auto-start as soon as the second player sits down
        setTimeout(() => this.startGame(), 300)
      } else {
        // Mid-game rejoin: start next hand if none is running
        this.tryDealIfReady()
      }
    }
    return true
  }

  leave(playerId: string): void {
    this.cancelRebuyTimer(playerId)
    this.players = this.players.filter(p => p.id !== playerId)
    this.game.removePlayer(playerId)
    this.broadcastAll({ type: 'player_list', players: this.game.publicPlayers() })
    if (this.players.length < 2 && !this.tournamentId) this.scheduleExpiry()
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  startGame(requesterId?: string): void {
    if (this.started) return
    if (this.activePlayers().length < 2) {
      if (requesterId) this.sendTo(requesterId, { type: 'error', message: 'Precisa de pelo menos 2 jogadores.' })
      return
    }
    this.started = true
    this.clearExpiry()
    this.broadcastAll({ type: 'game_started' })
    this.dealHand()
  }

  // ── Away (tournament-only) ────────────────────────────────────────────────

  setAway(pid: string): void {
    const rp = this.players.find(p => p.id === pid); if (!rp) return
    rp.away = true
    const gp = this.game.players.find(p => p.id === pid)
    if (gp && gp.status === 'active') gp.status = 'away'
    this.broadcastAll({ type: 'player_list', players: this.game.publicPlayers() })
    if (this.game.currentPlayer()?.id === pid) setTimeout(() => this.autoFold(pid), 800)
  }

  setBack(pid: string): void {
    const rp = this.players.find(p => p.id === pid); if (!rp) return
    rp.away = false
    const gp = this.game.players.find(p => p.id === pid)
    if (gp && gp.status === 'away') gp.status = 'active'
    this.broadcastAll({ type: 'player_list', players: this.game.publicPlayers() })
  }

  private autoFold(pid: string): void {
    if (this.game.currentPlayer()?.id === pid) this.handleAction(pid, 'fold')
  }

  // ── Rebuy (lobby-only) ────────────────────────────────────────────────────

  handleRebuy(pid: string): void {
    this.cancelRebuyTimer(pid)
    const rp = this.players.find(p => p.id === pid)
    if (!rp) return
    rp.sittingOut = false
    const gp = this.game.players.find(p => p.id === pid)
    if (gp) { gp.chips = this.startingChips; gp.status = 'waiting' }
    else     this.game.addPlayer(pid, rp.name, this.startingChips)
    this.broadcastAll({ type: 'player_list', players: this.game.publicPlayers() })
    // If no hand is running and we now have enough players, start the next hand
    this.tryDealIfReady()
  }

  handleRebuyDecline(pid: string): void {
    this.cancelRebuyTimer(pid)
    this.leave(pid)
  }

  private startRebuyTimer(pid: string): void {
    this.cancelRebuyTimer(pid)
    const timer = setTimeout(() => {
      // Auto-decline after 60s
      this.leave(pid)
    }, REBUY_TIMEOUT_S * 1000)
    this.rebuyTimers.set(pid, timer)
  }

  private cancelRebuyTimer(pid: string): void {
    const t = this.rebuyTimers.get(pid)
    if (t) { clearTimeout(t); this.rebuyTimers.delete(pid) }
  }

  // ── Action ────────────────────────────────────────────────────────────────

  handleAction(pid: string, action: PlayerAction, amount?: number): void {
    // Snapshot community cards BEFORE the action so we can detect new cards dealt
    const prevCommunityLen = this.game.tableState.communityCards.length
    const prevPhase        = this.game.tableState.phase

    const ok = this.game.applyAction(pid, action, amount)
    if (!ok) {
      this.sendTo(pid, { type: 'error', message: 'Ação inválida.' })
      // Re-send your_turn so the player's UI recovers if it cleared the action panel optimistically
      const current = this.game.currentPlayer()
      if (current?.id === pid) {
        const { actions, callAmount, minRaise } = this.game.validActions(current)
        this.sendTo(pid, { type: 'your_turn', validActions: actions, minRaise, callAmount })
      }
      return
    }

    const newState  = this.game.tableState
    const newPhase  = newState.phase

    // Always broadcast the action result (bets, pot, player states)
    this.broadcastAll({
      type: 'player_acted', playerId: pid, action, amount,
      tableState: newState, players: this.game.publicPlayers(),
    })

    // If new community cards were dealt, broadcast them regardless of how many phases advanced
    if (newState.communityCards.length > prevCommunityLen) {
      const newCards = newState.communityCards.slice(prevCommunityLen)
      // Determine display phase from total community card count
      const displayPhase: 'flop' | 'turn' | 'river' =
        newState.communityCards.length <= 3 ? 'flop' :
        newState.communityCards.length === 4 ? 'turn' : 'river'
      this.broadcastAll({
        type: 'community_cards',
        cards: newCards,
        phase: displayPhase,
        tableState: newState,
        players: this.game.publicPlayers(),
      })
    }

    if (this.game.isHandOver()) this.endHand()
    else this.notifyCurrentPlayer()
  }

  // ── Hand lifecycle ────────────────────────────────────────────────────────

  private dealHand(): void {
    this.game.startHand()
    // Send each player their private hole cards + full table snapshot
    for (const rp of this.players) {
      if (rp.sittingOut) continue
      const gp = this.game.players.find(p => p.id === rp.id)
      if (!gp) continue
      rp.send({
        type: 'hand_dealt',
        yourCards: gp.holeCards,
        players: this.game.publicPlayers(),
        tableState: this.game.tableState,
      })
    }
    this.notifyCurrentPlayer()
  }

  private endHand(): void {
    const result = this.game.resolveShowdown()

    this.broadcastAll({
      type: 'showdown',
      results: result.showdown,
      tableState: this.game.tableState,
      players: this.game.publicPlayers(),
    })
    this.broadcastAll({
      type: 'hand_end',
      winnerId: result.winnerId, winnerName: result.winnerName,
      amount: result.amount, handName: result.handName,
    })

    // Handle 0-chip players
    for (const gp of this.game.players) {
      if (gp.chips > 0) continue
      const rp = this.players.find(p => p.id === gp.id)
      if (!rp || rp.sittingOut) continue

      if (this.tournamentId) {
        rp.sittingOut = true
        this.onPlayerEliminated?.(gp.id)
      } else {
        // Lobby rebuy: mark sitting out, send prompt, start 60s timer
        rp.sittingOut = true
        rp.send({ type: 'rebuy_prompt', startingChips: this.startingChips, timeoutSeconds: 60 })
        this.startRebuyTimer(gp.id)
      }
    }

    setTimeout(() => {
      const eligible = this.players.filter(p => !p.sittingOut)
      if (eligible.length >= 2) this.dealHand()
    }, SHOWDOWN_DURATION_MS)
  }

  private notifyCurrentPlayer(): void {
    const current = this.game.currentPlayer()
    if (!current) return
    const rp = this.players.find(p => p.id === current.id)
    if (rp?.away) { setTimeout(() => this.autoFold(current.id), 800); return }
    const { actions, callAmount, minRaise } = this.game.validActions(current)
    this.sendTo(current.id, { type: 'your_turn', validActions: actions, minRaise, callAmount })
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────

  reconnect(pid: string, send: SendFn): void {
    const rp = this.players.find(p => p.id === pid)
    if (rp) rp.send = send
    const gp = this.game.players.find(p => p.id === pid)
    send({ type: 'game_started' })
    if (gp) {
      send({ type: 'hand_dealt', yourCards: gp.holeCards, players: this.game.publicPlayers(), tableState: this.game.tableState })
    }
    send({ type: 'player_list', players: this.game.publicPlayers() })
    // Re-send your_turn if it's this player's turn (they may have missed it while disconnected)
    const current = this.game.currentPlayer()
    if (current?.id === pid) {
      const { actions, callAmount, minRaise } = this.game.validActions(current)
      send({ type: 'your_turn', validActions: actions, minRaise, callAmount })
    }
  }

  // ── Tournament helpers ────────────────────────────────────────────────────

  addTournamentPlayer(id: string, name: string, send: SendFn, chips: number): void { this.join(id, name, send, chips) }

  moveTournamentPlayer(pid: string): { name: string; chips: number } | null {
    const gp = this.game.players.find(p => p.id === pid)
    if (!gp) return null
    const r = { name: gp.name, chips: gp.chips }
    this.leave(pid)
    return r
  }

  getSendFn(pid: string):      SendFn | undefined { return this.players.find(p => p.id === pid)?.send }
  getPlayerChips(pid: string): number             { return this.game.players.find(p => p.id === pid)?.chips ?? 0 }

  // ── Internal ──────────────────────────────────────────────────────────────

  private activePlayers() { return this.players.filter(p => !p.sittingOut) }

  /** Start the next hand if the game is idle and ≥2 players are ready. */
  private tryDealIfReady(): void {
    if (!this.started) return
    const phase = this.game.tableState.phase
    if (phase !== 'waiting' && !this.game.isHandOver()) return
    const eligible = this.players.filter(p => !p.sittingOut)
    if (eligible.length >= 2) setTimeout(() => this.dealHand(), 1500)
  }

  private sendTo(pid: string, msg: ServerMessage): void { this.players.find(p => p.id === pid)?.send(msg) }

  broadcastAll(msg: ServerMessage): void { for (const p of this.players) p.send(msg) }

  destroy(): void {
    this.clearExpiry()
    for (const t of this.rebuyTimers.values()) clearTimeout(t)
    this.rebuyTimers.clear()
  }
}
