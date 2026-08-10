import type { PushYourLuckDrawRoomConfig, PushYourLuckDrawRoomSummary, PushYourLuckDrawServerMessage } from '../../shared/types'
import { PushYourLuckDrawGame } from './pushyourluckdraw/gameEngine'
import { logger } from './logger'

export type PushYourLuckDrawSendFn = (msg: PushYourLuckDrawServerMessage) => void

interface PushYourLuckDrawRoomPlayer { id: string; name: string; send: PushYourLuckDrawSendFn }

type LeaveReason = 'leave' | 'match_abandoned' | 'rematch_declined' | 'rematch_timeout'

export interface PushYourLuckDrawRoomOptions {
  onExpire?: () => void
  onDissolve?: () => void
}

const EMPTY_TTL = 10 * 60 * 1000
const REMATCH_TIMEOUT_S = 60
const TURN_TIMEOUT_S = Number(process.env.PUSHYOURLUCKDRAW_TIMEOUT ?? 20)
const ROUND_END_DELAY_MS = Number(process.env.PUSHYOURLUCKDRAW_ROUND_END_DELAY_MS ?? 2500)
const AUTO_START_DELAY_MS = 300

/** Orchestration for Push Your Luck Draw tables — room/lobby joining mirrors
 *  gofishRoom.ts (free 2-8 seats, auto-starts 300ms after the 2nd join, with
 *  a manual `pushyourluckdraw_start_game` fallback), but the match loop
 *  mirrors trucoRoom.ts (several rounds per match until a target score,
 *  round_end/match_end, then a rematch vote) instead of Go Fish's single
 *  game-to-completion. See .claude/PushYourLuckDraw.md for the rules. */
export class PushYourLuckDrawRoom {
  readonly id: string
  readonly name: string
  readonly creatorName: string
  readonly config: PushYourLuckDrawRoomConfig

  private players: PushYourLuckDrawRoomPlayer[] = []
  readonly game: PushYourLuckDrawGame
  private started = false
  private expireTimer: ReturnType<typeof setTimeout> | null = null
  private rematchVotes = new Set<string>()
  private rematchTimer: ReturnType<typeof setTimeout> | null = null
  private turnTimer: ReturnType<typeof setTimeout> | null = null
  private turnDeadlineAt: number | null = null
  private readonly onExpire?: () => void
  private readonly onDissolve?: () => void

  constructor(id: string, name: string, creatorName: string, config: PushYourLuckDrawRoomConfig, opts: PushYourLuckDrawRoomOptions = {}) {
    this.id = id
    this.name = name
    this.creatorName = creatorName
    this.config = config
    this.onExpire = opts.onExpire
    this.onDissolve = opts.onDissolve
    this.game = new PushYourLuckDrawGame(config)
    this.scheduleExpiry()
  }

  // ── Expiry ────────────────────────────────────────────────────────────────

  private scheduleExpiry(): void {
    this.clearExpiry()
    this.expireTimer = setTimeout(() => {
      if (!this.started) {
        for (const p of this.players) p.send({ type: 'pushyourluckdraw_room_left', reason: 'expired' })
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

  summary(): PushYourLuckDrawRoomSummary {
    return {
      id: this.id, name: this.name, creatorName: this.creatorName,
      playerCount: this.players.length, maxPlayers: this.game.maxPlayers,
      status: this.started ? 'playing' : 'waiting',
      config: this.config,
    }
  }

  // ── Join / Leave ─────────────────────────────────────────────────────────

  /** Family-friendly, drop-in-anytime table: joining is allowed whenever
   *  there's a free seat, **even mid-match, even mid-round** — see
   *  .claude/PushYourLuckDraw.md → "Entrar a Qualquer Momento". A newcomer's
   *  `PushYourLuckDrawPlayer.status` starts as `'waiting'` (set by
   *  `game.addPlayer()`), which the turn-rotation/round-completion logic
   *  already treats as "not in this round" — they're automatically promoted
   *  to `'active'` the moment the next round is dealt, no special-casing
   *  needed in the engine. Leaving mid-match still dissolves the table
   *  (unchanged — see `leave()` below), only the join side got relaxed. */
  join(id: string, name: string, send: PushYourLuckDrawSendFn): boolean {
    if (this.isFull) return false
    this.players.push({ id, name, send })
    this.game.addPlayer(id, name)
    send({ type: 'pushyourluckdraw_room_joined', roomId: this.id, roomName: this.name, config: this.config, yourId: id })
    this.broadcastAll({ type: 'pushyourluckdraw_player_list', players: this.game.publicPlayers() })
    this.clearExpiry()

    if (this.started) {
      // Bring the newcomer up to speed on the match already in progress —
      // they'll just watch (status 'waiting') until the next round deals them in.
      send({ type: 'pushyourluckdraw_game_started' })
      send({ type: 'pushyourluckdraw_state_update', players: this.game.publicPlayers(), tableState: this.game.tableState })
      // Joined during the post-match rematch-vote window — replay the match
      // result and current vote tally so they can see who won and vote too.
      if (this.game.tableState.phase === 'match_complete' && this.game.lastMatchResult) {
        send({
          type: 'pushyourluckdraw_match_end', players: this.game.publicPlayers(),
          winnerIds: this.game.lastMatchResult.winnerIds, matchWins: this.game.matchWinsById(),
        })
        send({
          type: 'pushyourluckdraw_rematch_status', accepted: [...this.rematchVotes],
          pending: this.players.map((p) => p.id).filter((pid) => !this.rematchVotes.has(pid)),
        })
      }
    } else if (this.players.length >= 2) {
      setTimeout(() => this.startMatch(), AUTO_START_DELAY_MS)
    } else {
      this.scheduleExpiry()
    }
    return true
  }

  /** Leaving mid-match still dissolves the table — joining got relaxed
   *  above, but a departure mid-round has no clean "pause and wait" state
   *  to fall back to (their round hand, turn order, etc. would all need
   *  resolving), so it stays out of scope. */
  leave(playerId: string, reason: LeaveReason = 'leave'): void {
    const wasPresent = this.players.some((p) => p.id === playerId)
    if (!wasPresent) return

    if (this.started) {
      this.players = this.players.filter((p) => p.id !== playerId)
      this.broadcastAll({ type: 'pushyourluckdraw_room_left', reason: 'abandoned' })
      this.destroy()
      this.onDissolve?.()
      return
    }

    this.players = this.players.filter((p) => p.id !== playerId)
    this.game.removePlayer(playerId)
    this.broadcastAll({ type: 'pushyourluckdraw_player_list', players: this.game.publicPlayers() })
    if (this.players.length === 0) this.destroy()
    else this.scheduleExpiry()

    logger.info('pushyourluckdraw_player_left_room', {
      'pushyourluckdraw.room_id': this.id, 'pushyourluckdraw.player_id': playerId, 'pushyourluckdraw.reason': reason,
    })
  }

  // ── Match / round lifecycle ─────────────────────────────────────────────

  /** Auto-called 300ms after the 2nd join; also reachable via the manual
   *  `pushyourluckdraw_start_game` fallback. */
  startMatch(requesterId?: string): void {
    if (this.started) return
    if (this.players.length < 2) {
      if (requesterId) this.sendTo(requesterId, { type: 'pushyourluckdraw_room_error', message: 'Precisa de pelo menos 2 jogadores.' })
      return
    }
    this.started = true
    this.clearExpiry()
    this.broadcastAll({ type: 'pushyourluckdraw_game_started' })
    this.game.startMatch()
    this.broadcastRoundStarted()
  }

  private broadcastRoundStarted(): void {
    this.broadcastAll({ type: 'pushyourluckdraw_round_started', players: this.game.publicPlayers(), tableState: this.game.tableState })
    this.notifyCurrentPlayer()
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  handleDraw(pid: string): void {
    const outcome = this.game.draw(pid)
    if (!outcome) { this.sendTo(pid, { type: 'pushyourluckdraw_room_error', message: 'Jogada inválida.' }); return }

    this.broadcastAll({
      type: 'pushyourluckdraw_draw_result', playerId: pid, outcome: outcome.kind,
      card: outcome.kind === 'forced_stop' ? null : outcome.card,
      bustedHand: outcome.kind === 'busted' ? outcome.previousHand : null,
      players: this.game.publicPlayers(), tableState: this.game.tableState,
    })

    if (this.game.isRoundComplete()) { this.finishRound(); return }
    this.notifyCurrentPlayer()
  }

  handleStop(pid: string): void {
    const ok = this.game.stop(pid)
    if (!ok) { this.sendTo(pid, { type: 'pushyourluckdraw_room_error', message: 'Não é sua vez.' }); return }

    const roundScore = this.game.publicPlayers().find((p) => p.id === pid)?.roundScore ?? 0
    this.broadcastAll({
      type: 'pushyourluckdraw_stop_result', playerId: pid, roundScore,
      players: this.game.publicPlayers(), tableState: this.game.tableState,
    })

    if (this.game.isRoundComplete()) { this.finishRound(); return }
    this.notifyCurrentPlayer()
  }

  private finishRound(): void {
    this.clearTurnTimer()
    this.broadcastAll({ type: 'pushyourluckdraw_round_end', players: this.game.publicPlayers(), tableState: this.game.tableState })

    if (this.game.isMatchOver()) setTimeout(() => this.finishMatch(), ROUND_END_DELAY_MS)
    else setTimeout(() => this.dealNextRound(), ROUND_END_DELAY_MS)
  }

  private dealNextRound(): void {
    this.game.startRound()
    this.broadcastRoundStarted()
  }

  private finishMatch(): void {
    const result = this.game.lastMatchResult!
    this.game.recordMatchWin(result.winnerIds)
    this.broadcastAll({
      type: 'pushyourluckdraw_match_end', players: this.game.publicPlayers(),
      winnerIds: result.winnerIds, matchWins: this.game.matchWinsById(),
    })
    this.startRematchVote()
  }

  // ── Rematch voting ───────────────────────────────────────────────────────

  private startRematchVote(): void {
    this.rematchVotes.clear()
    this.broadcastAll({ type: 'pushyourluckdraw_rematch_status', accepted: [], pending: this.players.map((p) => p.id) })
    this.rematchTimer = setTimeout(() => this.dissolveForRematch(), REMATCH_TIMEOUT_S * 1000)
  }

  handleRematchVote(pid: string, accept: boolean): void {
    if (!this.players.some((p) => p.id === pid)) return
    if (!accept) { this.dissolveForRematch(); return }

    this.rematchVotes.add(pid)
    const accepted = [...this.rematchVotes]
    const pending = this.players.map((p) => p.id).filter((id) => !this.rematchVotes.has(id))
    this.broadcastAll({ type: 'pushyourluckdraw_rematch_status', accepted, pending })

    if (pending.length === 0) {
      if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
      this.game.startMatch()
      this.broadcastRoundStarted()
    }
  }

  private dissolveForRematch(): void {
    if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
    this.broadcastAll({ type: 'pushyourluckdraw_room_left', reason: 'rematch_declined' })
    this.destroy()
    this.onDissolve?.()
  }

  // ── Turn notification ────────────────────────────────────────────────────

  private notifyCurrentPlayer(): void {
    this.clearTurnTimer()
    const pid = this.game.currentPlayerId()
    if (!pid) return
    this.sendTo(pid, { type: 'pushyourluckdraw_your_turn', timeoutSeconds: this.remainingTimeoutSeconds() })
    this.turnDeadlineAt = Date.now() + TURN_TIMEOUT_S * 1000
    this.turnTimer = setTimeout(() => this.handleTurnTimeout(pid), TURN_TIMEOUT_S * 1000)
  }

  /** Seconds left on the current turn timer — for resending an accurate countdown on reconnect. */
  private remainingTimeoutSeconds(): number {
    if (this.turnDeadlineAt === null) return TURN_TIMEOUT_S
    return Math.max(1, Math.ceil((this.turnDeadlineAt - Date.now()) / 1000))
  }

  /** Auto-stops the current player's turn if they haven't acted in time —
   *  never auto-draws blindly (see .claude/PushYourLuckDraw.md → "Timeout de Turno"). */
  private handleTurnTimeout(pid: string): void {
    if (this.game.tableState.phase !== 'playing' || this.game.currentPlayerId() !== pid) return
    this.handleStop(pid)
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null }
    this.turnDeadlineAt = null
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────

  reconnect(pid: string, send: PushYourLuckDrawSendFn): void {
    const rp = this.players.find((p) => p.id === pid)
    if (rp) rp.send = send

    send({ type: 'pushyourluckdraw_room_joined', roomId: this.id, roomName: this.name, config: this.config, yourId: pid })

    if (this.started) {
      send({ type: 'pushyourluckdraw_game_started' })
      send({ type: 'pushyourluckdraw_state_update', players: this.game.publicPlayers(), tableState: this.game.tableState })
    }
    send({ type: 'pushyourluckdraw_player_list', players: this.game.publicPlayers() })

    if (this.game.tableState.phase === 'playing' && this.game.currentPlayerId() === pid) {
      send({ type: 'pushyourluckdraw_your_turn', timeoutSeconds: this.remainingTimeoutSeconds() })
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private sendTo(pid: string, msg: PushYourLuckDrawServerMessage): void { this.players.find((p) => p.id === pid)?.send(msg) }
  broadcastAll(msg: PushYourLuckDrawServerMessage): void { for (const p of this.players) p.send(msg) }

  destroy(): void {
    this.clearExpiry()
    this.clearTurnTimer()
    if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
  }
}
