import type { GoFishRoomConfig, GoFishRoomSummary, GoFishServerMessage, Rank } from '../../shared/types'
import { GoFishGame } from './gofish/gameEngine'
import { logger } from './logger'

export type GoFishSendFn = (msg: GoFishServerMessage) => void

interface GoFishRoomPlayer { id: string; name: string; send: GoFishSendFn }

type LeaveReason = 'leave' | 'match_abandoned' | 'rematch_declined' | 'rematch_timeout'

export interface GoFishRoomOptions {
  onExpire?: () => void
  onDissolve?: () => void
}

const EMPTY_TTL = 10 * 60 * 1000
const REMATCH_TIMEOUT_S = 60
const TURN_TIMEOUT_S = Number(process.env.GOFISH_TIMEOUT ?? 30)
const ROUND_END_DELAY_MS = Number(process.env.GOFISH_ROUND_END_DELAY_MS ?? 2500)
const AUTO_START_DELAY_MS = 300

/** Orchestration for Go Fish tables — same shape as canastraRoom.ts, but the
 *  room size is a creator-chosen 2-6 range (not a fixed team mode), so it
 *  auto-starts 300ms after the 2nd join (Poker/Truco lobby pattern) instead
 *  of waiting for a full table, with a manual `gofish_start_game` fallback.
 *  See .claude/GoFish.md for the rules this implements. */
export class GoFishRoom {
  readonly id: string
  readonly name: string
  readonly creatorName: string
  readonly config: GoFishRoomConfig

  private players: GoFishRoomPlayer[] = []
  readonly game: GoFishGame
  private started = false
  private expireTimer: ReturnType<typeof setTimeout> | null = null
  private rematchVotes = new Set<string>()
  private rematchTimer: ReturnType<typeof setTimeout> | null = null
  private turnTimer: ReturnType<typeof setTimeout> | null = null
  private turnDeadlineAt: number | null = null
  private readonly onExpire?: () => void
  private readonly onDissolve?: () => void

  constructor(id: string, name: string, creatorName: string, config: GoFishRoomConfig, opts: GoFishRoomOptions = {}) {
    this.id = id
    this.name = name
    this.creatorName = creatorName
    this.config = config
    this.onExpire = opts.onExpire
    this.onDissolve = opts.onDissolve
    this.game = new GoFishGame(config)
    this.scheduleExpiry()
  }

  // ── Expiry ────────────────────────────────────────────────────────────────

  private scheduleExpiry(): void {
    this.clearExpiry()
    this.expireTimer = setTimeout(() => {
      if (!this.started) {
        for (const p of this.players) p.send({ type: 'gofish_room_left', reason: 'expired' })
        this.onExpire?.()
      }
    }, EMPTY_TTL)
  }
  private clearExpiry(): void {
    if (this.expireTimer) { clearTimeout(this.expireTimer); this.expireTimer = null }
  }

  // ── Info ──────────────────────────────────────────────────────────────────

  get playerCount() { return this.players.length }
  get isFull() { return this.players.length >= this.game.maxPlayers }
  get isStarted() { return this.started }

  summary(): GoFishRoomSummary {
    return {
      id: this.id, name: this.name, creatorName: this.creatorName,
      playerCount: this.players.length, maxPlayers: this.game.maxPlayers,
      status: this.started ? 'playing' : 'waiting',
      config: this.config,
    }
  }

  // ── Join / Leave ─────────────────────────────────────────────────────────

  join(id: string, name: string, send: GoFishSendFn): boolean {
    if (this.isFull || this.started) return false
    this.players.push({ id, name, send })
    this.game.addPlayer(id, name)
    send({ type: 'gofish_room_joined', roomId: this.id, roomName: this.name, config: this.config, yourId: id })
    this.broadcastAll({ type: 'gofish_player_list', players: this.game.publicPlayers() })
    this.clearExpiry()
    if (this.players.length >= 2) setTimeout(() => this.startMatch(), AUTO_START_DELAY_MS)
    else this.scheduleExpiry()
    return true
  }

  /** No mid-match backfill — a player leaving a running match dissolves the table. */
  leave(playerId: string, reason: LeaveReason = 'leave'): void {
    const wasPresent = this.players.some((p) => p.id === playerId)
    if (!wasPresent) return

    if (this.started) {
      this.players = this.players.filter((p) => p.id !== playerId)
      this.broadcastAll({ type: 'gofish_room_left', reason: 'abandoned' })
      this.destroy()
      this.onDissolve?.()
      return
    }

    this.players = this.players.filter((p) => p.id !== playerId)
    this.game.removePlayer(playerId)
    this.broadcastAll({ type: 'gofish_player_list', players: this.game.publicPlayers() })
    if (this.players.length === 0) this.destroy()
    else this.scheduleExpiry()

    logger.info('gofish_player_left_room', {
      'gofish.room_id': this.id, 'gofish.player_id': playerId, 'gofish.reason': reason,
    })
  }

  // ── Match / round lifecycle ─────────────────────────────────────────────

  /** Auto-called 300ms after the 2nd join; also reachable via the manual
   *  `gofish_start_game` fallback (.claude/GoFish.md → "Início da partida"). */
  startMatch(requesterId?: string): void {
    if (this.started) return
    if (this.players.length < 2) {
      if (requesterId) this.sendTo(requesterId, { type: 'gofish_room_error', message: 'Precisa de pelo menos 2 jogadores.' })
      return
    }
    this.started = true
    this.clearExpiry()
    this.broadcastAll({ type: 'gofish_game_started' })
    this.dealHand()
  }

  private dealHand(): void {
    this.game.startHand()
    for (const rp of this.players) {
      rp.send({
        type: 'gofish_hand_dealt', yourCards: this.game.hand(rp.id),
        players: this.game.publicPlayers(), tableState: this.game.tableState,
      })
    }
    if (this.game.tableState.phase === 'round_end') this.finishRound()
    else this.notifyCurrentPlayer()
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  handleAsk(pid: string, targetPlayerId: string, rank: Rank): void {
    const result = this.game.ask(pid, targetPlayerId, rank)
    if (!result) { this.sendTo(pid, { type: 'gofish_room_error', message: 'Pedido inválido.' }); return }

    this.broadcastAll({
      type: 'gofish_ask_result', askerId: result.askerId, targetId: result.targetId, rank: result.rank,
      cardsTransferred: result.cardsTransferred, wentFish: result.wentFish, drawnMatch: result.drawnMatch,
      booksCompleted: result.booksCompleted,
    })
    this.sendHandUpdate(result.askerId)
    // Target's hand only changes when the asker caught real cards off of
    // them — a "go fish" stock draw never touches the target's hand.
    if (!result.wentFish) this.sendHandUpdate(result.targetId)

    if (this.game.tableState.phase === 'round_end') { this.finishRound(); return }
    this.broadcastState()
    // The empty-hand auto-refill inside the engine may have silently topped
    // up whoever's turn it now is — resend their hand too so it's accurate.
    const nextId = this.game.currentPlayerId()
    if (nextId) this.sendHandUpdate(nextId)
    this.notifyCurrentPlayer()
  }

  private finishRound(): void {
    this.clearTurnTimer()
    const result = this.game.lastRoundResult!
    this.game.recordMatchWin(result.winnerIds)
    this.broadcastAll({
      type: 'gofish_round_end', players: this.game.publicPlayers(), tableState: this.game.tableState,
      winnerIds: result.winnerIds, matchWins: this.game.matchWinsById(),
    })
    setTimeout(() => this.startRematchVote(), ROUND_END_DELAY_MS)
  }

  // ── Rematch voting ───────────────────────────────────────────────────────

  private startRematchVote(): void {
    this.rematchVotes.clear()
    this.broadcastAll({ type: 'gofish_rematch_status', accepted: [], pending: this.players.map((p) => p.id) })
    this.rematchTimer = setTimeout(() => this.dissolveForRematch(), REMATCH_TIMEOUT_S * 1000)
  }

  handleRematchVote(pid: string, accept: boolean): void {
    if (!this.players.some((p) => p.id === pid)) return
    if (!accept) { this.dissolveForRematch(); return }

    this.rematchVotes.add(pid)
    const accepted = [...this.rematchVotes]
    const pending = this.players.map((p) => p.id).filter((id) => !this.rematchVotes.has(id))
    this.broadcastAll({ type: 'gofish_rematch_status', accepted, pending })

    if (pending.length === 0) {
      if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
      this.dealHand()
    }
  }

  private dissolveForRematch(): void {
    if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
    this.broadcastAll({ type: 'gofish_room_left', reason: 'rematch_declined' })
    this.destroy()
    this.onDissolve?.()
  }

  // ── Turn notification ────────────────────────────────────────────────────

  private notifyCurrentPlayer(): void {
    this.clearTurnTimer()
    const pid = this.game.currentPlayerId()
    if (!pid) return
    this.sendTurnInfo(pid)
    this.turnDeadlineAt = Date.now() + TURN_TIMEOUT_S * 1000
    this.turnTimer = setTimeout(() => this.handleTurnTimeout(pid), TURN_TIMEOUT_S * 1000)
  }

  private sendTurnInfo(pid: string): void {
    const info = this.game.turnInfo(pid)
    this.sendTo(pid, { type: 'gofish_your_turn', askableRanks: info.askableRanks, timeoutSeconds: this.remainingTimeoutSeconds() })
  }

  /** Seconds left on the current turn timer — for resending an accurate countdown on reconnect. */
  private remainingTimeoutSeconds(): number {
    if (this.turnDeadlineAt === null) return TURN_TIMEOUT_S
    return Math.max(1, Math.ceil((this.turnDeadlineAt - Date.now()) / 1000))
  }

  /** Auto-plays the current player's turn if they haven't acted in time: a
   *  blind ask at a random rank in hand against a random other active player. */
  private handleTurnTimeout(pid: string): void {
    if (this.game.tableState.phase !== 'playing' || this.game.currentPlayerId() !== pid) return
    const guess = this.game.arbitraryAsk(pid)
    if (guess) this.handleAsk(pid, guess.targetPlayerId, guess.rank)
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null }
    this.turnDeadlineAt = null
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────

  reconnect(pid: string, send: GoFishSendFn): void {
    const rp = this.players.find((p) => p.id === pid)
    if (rp) rp.send = send

    send({ type: 'gofish_room_joined', roomId: this.id, roomName: this.name, config: this.config, yourId: pid })

    if (this.started) send({ type: 'gofish_game_started' })
    if (this.game.players.some((p) => p.id === pid)) {
      send({
        type: 'gofish_hand_dealt', yourCards: this.game.hand(pid),
        players: this.game.publicPlayers(), tableState: this.game.tableState,
      })
    }
    send({ type: 'gofish_player_list', players: this.game.publicPlayers() })

    if (this.game.tableState.phase === 'playing' && this.game.currentPlayerId() === pid) {
      const info = this.game.turnInfo(pid)
      send({ type: 'gofish_your_turn', askableRanks: info.askableRanks, timeoutSeconds: this.remainingTimeoutSeconds() })
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private broadcastState(): void {
    this.broadcastAll({ type: 'gofish_state_update', tableState: this.game.tableState, players: this.game.publicPlayers() })
  }
  private sendHandUpdate(pid: string): void {
    this.sendTo(pid, { type: 'gofish_hand_update', cards: this.game.hand(pid) })
  }
  private sendTo(pid: string, msg: GoFishServerMessage): void { this.players.find((p) => p.id === pid)?.send(msg) }
  broadcastAll(msg: GoFishServerMessage): void { for (const p of this.players) p.send(msg) }

  destroy(): void {
    this.clearExpiry()
    this.clearTurnTimer()
    if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
  }
}
