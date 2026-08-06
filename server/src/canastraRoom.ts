import type { CanastraMeldPlan, CanastraRoomConfig, CanastraRoomSummary, CanastraServerMessage } from '../../shared/types'
import { CanastraGame } from './canastra/gameEngine'
import { logger } from './logger'

export type CanastraSendFn = (msg: CanastraServerMessage) => void

interface CanastraRoomPlayer { id: string; name: string; send: CanastraSendFn }

type LeaveReason = 'leave' | 'match_abandoned' | 'rematch_declined' | 'rematch_timeout'

export interface CanastraRoomOptions {
  onExpire?: () => void
  onDissolve?: () => void
}

const EMPTY_TTL = 10 * 60 * 1000
const REMATCH_TIMEOUT_S = 60
const TURN_TIMEOUT_S = Number(process.env.CANASTRA_TIMEOUT ?? 60)
const ROUND_END_DELAY_MS = Number(process.env.CANASTRA_ROUND_END_DELAY_MS ?? 2500)

/** Orchestration for Canastra/Buraco tables — same shape as trucoRoom.ts /
 *  gauchoRoom.ts, but a separate game (see .claude/Canastra.md); no shared
 *  runtime state. Unlike Truco, one hand *is* the whole match — there's no
 *  repeated dealing to a target score. */
export class CanastraRoom {
  readonly id: string
  readonly name: string
  readonly creatorName: string
  readonly config: CanastraRoomConfig

  private players: CanastraRoomPlayer[] = []
  readonly game: CanastraGame
  private started = false
  private expireTimer: ReturnType<typeof setTimeout> | null = null
  private rematchVotes = new Set<string>()
  private rematchTimer: ReturnType<typeof setTimeout> | null = null
  private turnTimer: ReturnType<typeof setTimeout> | null = null
  private turnDeadlineAt: number | null = null
  private readonly onExpire?: () => void
  private readonly onDissolve?: () => void

  constructor(id: string, name: string, creatorName: string, config: CanastraRoomConfig, opts: CanastraRoomOptions = {}) {
    this.id = id
    this.name = name
    this.creatorName = creatorName
    this.config = config
    this.onExpire = opts.onExpire
    this.onDissolve = opts.onDissolve
    this.game = new CanastraGame(config)
    this.scheduleExpiry()
  }

  // ── Expiry ────────────────────────────────────────────────────────────────

  private scheduleExpiry(): void {
    this.clearExpiry()
    this.expireTimer = setTimeout(() => {
      if (!this.started) {
        for (const p of this.players) p.send({ type: 'canastra_room_left', reason: 'expired' })
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

  summary(): CanastraRoomSummary {
    return {
      id: this.id, name: this.name, creatorName: this.creatorName,
      playerCount: this.players.length, maxPlayers: this.game.maxPlayers,
      status: this.started ? 'playing' : 'waiting',
      config: this.config,
    }
  }

  // ── Join / Leave ─────────────────────────────────────────────────────────

  join(id: string, name: string, send: CanastraSendFn): boolean {
    if (this.isFull || this.started) return false
    this.players.push({ id, name, send })
    this.game.addPlayer(id, name)
    send({ type: 'canastra_room_joined', roomId: this.id, roomName: this.name, config: this.config, yourId: id })
    this.broadcastAll({ type: 'canastra_player_list', players: this.game.publicPlayers() })
    this.clearExpiry()
    if (this.isFull) setTimeout(() => this.startMatch(), 300)
    else this.scheduleExpiry()
    return true
  }

  /** No mid-match backfill — a player leaving a running match dissolves the table. */
  leave(playerId: string, reason: LeaveReason = 'leave'): void {
    const wasPresent = this.players.some((p) => p.id === playerId)
    if (!wasPresent) return

    if (this.started) {
      this.players = this.players.filter((p) => p.id !== playerId)
      this.broadcastAll({ type: 'canastra_room_left', reason: 'abandoned' })
      this.destroy()
      this.onDissolve?.()
      return
    }

    this.players = this.players.filter((p) => p.id !== playerId)
    this.game.removePlayer(playerId)
    this.broadcastAll({ type: 'canastra_player_list', players: this.game.publicPlayers() })
    if (this.players.length === 0) this.destroy()
    else this.scheduleExpiry()

    logger.info('canastra_player_left_room', {
      'canastra.room_id': this.id, 'canastra.player_id': playerId, 'canastra.reason': reason,
    })
  }

  // ── Match / hand lifecycle ───────────────────────────────────────────────

  private startMatch(): void {
    if (this.started) return
    this.started = true
    this.clearExpiry()
    this.broadcastAll({ type: 'canastra_game_started' })
    this.dealHand()
  }

  private dealHand(): void {
    this.game.startHand()
    for (const rp of this.players) {
      rp.send({
        type: 'canastra_hand_dealt', yourCards: this.game.hand(rp.id),
        players: this.game.publicPlayers(), tableState: this.game.tableState,
      })
    }
    this.notifyCurrentPlayer()
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  handleDrawStock(pid: string): void {
    const ok = this.game.drawStock(pid)
    if (!ok) { this.sendTo(pid, { type: 'canastra_room_error', message: 'Não é possível comprar do monte agora.' }); return }
    this.sendHandUpdate(pid)
    this.broadcastState()
  }

  handleTakeDiscard(pid: string, plan: CanastraMeldPlan): void {
    const ok = this.game.takeDiscard(pid, plan)
    if (!ok) { this.sendTo(pid, { type: 'canastra_room_error', message: 'Não é possível comprar o lixo com essa jogada.' }); return }
    this.sendHandUpdate(pid)
    this.afterMeldAction()
  }

  handleLayMeld(pid: string, cardIds: string[]): void {
    const ok = this.game.layMeld(pid, cardIds)
    if (!ok) { this.sendTo(pid, { type: 'canastra_room_error', message: 'Jogo inválido.' }); return }
    this.sendHandUpdate(pid)
    this.afterMeldAction()
  }

  handleAddToMeld(pid: string, meldId: string, cardIds: string[]): void {
    const ok = this.game.addToMeld(pid, meldId, cardIds)
    if (!ok) { this.sendTo(pid, { type: 'canastra_room_error', message: 'Não foi possível acrescentar essas cartas.' }); return }
    this.sendHandUpdate(pid)
    this.afterMeldAction()
  }

  handleDiscard(pid: string, cardId: string): void {
    const ok = this.game.discard(pid, cardId)
    if (!ok) { this.sendTo(pid, { type: 'canastra_room_error', message: 'Descarte inválido.' }); return }
    this.sendHandUpdate(pid)
    if (this.game.tableState.phase === 'round_end') { this.finishRound(); return }
    this.broadcastState()
    // Discard is the one action that changes whose turn it is — the new
    // current player may have just silently received a delayed morto.
    const nextId = this.game.currentPlayerId()
    if (nextId) this.sendHandUpdate(nextId)
    this.notifyCurrentPlayer()
  }

  /** Shared tail for lay/add/take-discard — none of these change whose turn
   *  it is (only `discard` does), but any of them can trigger an immediate
   *  "batida direta" that ends the round. */
  private afterMeldAction(): void {
    if (this.game.tableState.phase === 'round_end') this.finishRound()
    else this.broadcastState()
  }

  private finishRound(): void {
    const result = this.game.lastRoundResult!
    this.game.recordMatchWin(result.winnerTeam)
    const matchWins: Record<string, number> = {}
    for (const p of this.game.players) matchWins[p.id] = p.matchWins
    this.clearTurnTimer()
    this.broadcastAll({
      type: 'canastra_round_end', winnerTeam: result.winnerTeam, scores: result.scores,
      breakdown: result.breakdown, matchWins, tableState: this.game.tableState,
    })
    setTimeout(() => this.startRematchVote(), ROUND_END_DELAY_MS)
  }

  // ── Rematch voting ───────────────────────────────────────────────────────

  private startRematchVote(): void {
    this.rematchVotes.clear()
    this.broadcastAll({ type: 'canastra_rematch_status', accepted: [], pending: this.players.map((p) => p.id) })
    this.rematchTimer = setTimeout(() => this.dissolveForRematch(), REMATCH_TIMEOUT_S * 1000)
  }

  handleRematchVote(pid: string, accept: boolean): void {
    if (!this.players.some((p) => p.id === pid)) return
    if (!accept) { this.dissolveForRematch(); return }

    this.rematchVotes.add(pid)
    const accepted = [...this.rematchVotes]
    const pending = this.players.map((p) => p.id).filter((id) => !this.rematchVotes.has(id))
    this.broadcastAll({ type: 'canastra_rematch_status', accepted, pending })

    if (pending.length === 0) {
      if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
      this.dealHand()
    }
  }

  private dissolveForRematch(): void {
    if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
    this.broadcastAll({ type: 'canastra_room_left', reason: 'rematch_declined' })
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
    this.sendTo(pid, { type: 'canastra_your_turn', canTakeDiscard: info.canTakeDiscard, timeoutSeconds: this.remainingTimeoutSeconds() })
  }

  /** Seconds left on the current turn timer — for resending an accurate countdown on reconnect. */
  private remainingTimeoutSeconds(): number {
    if (this.turnDeadlineAt === null) return TURN_TIMEOUT_S
    return Math.max(1, Math.ceil((this.turnDeadlineAt - Date.now()) / 1000))
  }

  /** Auto-plays the current player's turn if they haven't acted in time:
   *  draw from the stock if possible, then discard the first card in hand. */
  private handleTurnTimeout(pid: string): void {
    if (this.game.tableState.phase !== 'playing' || this.game.currentPlayerId() !== pid) return
    const info = this.game.turnInfo(pid)
    if (info.canDraw) this.handleDrawStock(pid)
    const card = this.game.arbitraryDiscardCard(pid)
    if (card) this.handleDiscard(pid, card.id)
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null }
    this.turnDeadlineAt = null
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────

  reconnect(pid: string, send: CanastraSendFn): void {
    const rp = this.players.find((p) => p.id === pid)
    if (rp) rp.send = send

    send({ type: 'canastra_room_joined', roomId: this.id, roomName: this.name, config: this.config, yourId: pid })

    if (this.started) send({ type: 'canastra_game_started' })
    if (this.game.players.some((p) => p.id === pid)) {
      send({
        type: 'canastra_hand_dealt', yourCards: this.game.hand(pid),
        players: this.game.publicPlayers(), tableState: this.game.tableState,
      })
    }
    send({ type: 'canastra_player_list', players: this.game.publicPlayers() })

    if (this.game.tableState.phase === 'playing' && this.game.currentPlayerId() === pid) {
      send({ type: 'canastra_your_turn', canTakeDiscard: this.game.turnInfo(pid).canTakeDiscard, timeoutSeconds: this.remainingTimeoutSeconds() })
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private broadcastState(): void {
    this.broadcastAll({ type: 'canastra_state_update', tableState: this.game.tableState, players: this.game.publicPlayers() })
  }
  private sendHandUpdate(pid: string): void {
    this.sendTo(pid, { type: 'canastra_hand_update', cards: this.game.hand(pid) })
  }
  private sendTo(pid: string, msg: CanastraServerMessage): void { this.players.find((p) => p.id === pid)?.send(msg) }
  broadcastAll(msg: CanastraServerMessage): void { for (const p of this.players) p.send(msg) }

  destroy(): void {
    this.clearExpiry()
    this.clearTurnTimer()
    if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
  }
}
