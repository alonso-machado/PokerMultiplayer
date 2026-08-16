import type { PushYourLuckDrawRoomConfig, PushYourLuckDrawRoomSummary, PushYourLuckDrawServerMessage } from '../../shared/types'
import { PushYourLuckDrawGame, type PushYourLuckDrawDisconnectSnapshot } from './pushyourluckdraw/gameEngine'
import { logger } from './logger'
import { gameMetrics } from './metrics'

export type PushYourLuckDrawSendFn = (msg: PushYourLuckDrawServerMessage) => void

interface PushYourLuckDrawRoomPlayer { id: string; name: string; send: PushYourLuckDrawSendFn }

type LeaveReason = 'leave' | 'disconnect' | 'rematch_declined' | 'rematch_timeout'

export interface PushYourLuckDrawRoomOptions {
  onExpire?: () => void
  onDissolve?: () => void
}

const EMPTY_TTL = 10 * 60 * 1000
const REMATCH_TIMEOUT_S = 60
const TURN_TIMEOUT_S = Number(process.env.PUSHYOURLUCKDRAW_TIMEOUT ?? 20)
const ROUND_END_DELAY_MS = Number(process.env.PUSHYOURLUCKDRAW_ROUND_END_DELAY_MS ?? 2500)
const AUTO_START_DELAY_MS = 300

/** Orchestration for Push Your Luck Draw tables — free 2-8 seats, auto-starts
 *  300ms after the 2nd join, with a manual `pushyourluckdraw_start_game`
 *  fallback. The match loop mirrors trucoRoom.ts (several rounds per match
 *  until a target score, round_end/match_end, then a rematch vote). See
 *  .claude/PushYourLuckDraw.md for the rules.
 *
 *  Unlike every other game here, a departure mid-match (explicit "Sair da
 *  mesa", a real disconnect, or declining/missing a rematch vote) never
 *  dissolves the table by itself — only when it drops to 0 players. The
 *  departing player's match score is snapshotted so the same identity can
 *  rejoin mid-match with it restored — but only for the match they left;
 *  the snapshot is discarded the moment a new match starts (initial start
 *  or an accepted rematch), so a stale rejoin can never inject old points
 *  into a match that's already moved on. See .claude/PushYourLuckDraw.md
 *  → "Sair da Mesa" / "Desconexão". */
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
  /** Score snapshots for players who left/disconnected mid-match, keyed by
   *  playerId — consumed (and deleted) on a matching rejoin, and wholesale
   *  cleared every time a new match starts. See class doc above. */
  private disconnectedScores = new Map<string, PushYourLuckDrawDisconnectSnapshot>()
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
   *  needed in the engine. If this identity left/disconnected earlier in
   *  the *current* match, their preserved score is restored right away —
   *  see class doc above. */
  join(id: string, name: string, send: PushYourLuckDrawSendFn): boolean {
    if (this.isFull) return false
    this.players.push({ id, name, send })
    this.game.addPlayer(id, name)

    const snapshot = this.disconnectedScores.get(id)
    if (snapshot) {
      this.game.restoreScore(id, snapshot)
      this.disconnectedScores.delete(id)
    }

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

  /** Explicit "Sair da mesa" (also used for a rematch decline/timeout —
   *  both are just "leaving" from here on). Pre-start, this is just freeing
   *  a seat (no score exists yet). Mid-match, it goes through
   *  removeAndPreserveScore() — the table stays open for whoever's left,
   *  and this identity can rejoin mid-match with their score intact (see
   *  class doc above). Messages the leaving player directly (skipped for a
   *  real disconnect — the socket's already gone) since removal excludes
   *  them from every subsequent broadcastAll(), unlike the old
   *  dissolve-everyone behavior. */
  leave(playerId: string, reason: LeaveReason = 'leave'): void {
    const rp = this.players.find((p) => p.id === playerId)
    if (!rp) return

    if (reason !== 'disconnect') {
      rp.send({ type: 'pushyourluckdraw_room_left', reason: reason === 'leave' ? 'manual' : 'rematch_declined' })
    }

    if (this.started) {
      this.removeAndPreserveScore(playerId)
    } else {
      this.players = this.players.filter((p) => p.id !== playerId)
      this.game.removePlayer(playerId)
      this.broadcastAll({ type: 'pushyourluckdraw_player_list', players: this.game.publicPlayers() })
      if (this.players.length === 0) this.destroy()
      else this.scheduleExpiry()
    }

    logger.info('pushyourluckdraw_player_left_room', {
      'pushyourluckdraw.room_id': this.id, 'pushyourluckdraw.player_id': playerId, 'pushyourluckdraw.reason': reason,
    })
  }

  /** A real disconnect (closed tab/app) — no explicit request to reply to
   *  (the socket's already gone), otherwise identical to leave(). */
  handleDisconnect(playerId: string): void {
    this.leave(playerId, 'disconnect')
  }

  /** Shared tail for any way a player stops being at the table mid-match —
   *  removes them from the engine (same seat/Joker-rescale bookkeeping as
   *  any other removal), snapshots their match score for a possible
   *  same-match rejoin, and only destroys the table if that leaves it
   *  completely empty. Never re-triggers finishRound()/finishMatch() when
   *  the round/match had already concluded before this call (see the
   *  phase-based branches below) — those only ever fire from a real turn
   *  action, exactly once. */
  private removeAndPreserveScore(playerId: string): void {
    const phaseBefore = this.game.tableState.phase
    const wasVotingRematch = phaseBefore === 'match_complete'

    const snapshot = this.game.disconnectPlayer(playerId)
    this.players = this.players.filter((p) => p.id !== playerId)
    this.rematchVotes.delete(playerId)
    if (snapshot) this.disconnectedScores.set(playerId, snapshot)

    if (this.players.length === 0) { this.destroy(); this.onDissolve?.(); return }

    this.broadcastAll({ type: 'pushyourluckdraw_player_list', players: this.game.publicPlayers() })

    if (wasVotingRematch) {
      // Already past match-end, mid rematch-vote — just refresh the tally,
      // never re-run the match-end flow.
      this.refreshRematchVote()
      return
    }

    if (phaseBefore === 'playing') {
      // A round was actually live — mirror the exact tail every turn action
      // uses (finishRound() if that was the last decision needed, otherwise
      // notify whoever's now current).
      if (this.game.isRoundComplete()) { this.finishRound(); return }
      this.notifyCurrentPlayer()
      return
    }

    // phaseBefore === 'round_complete': removed during the brief gap between
    // a round ending and the next one dealing — the dealNextRound()/
    // finishMatch() timer already scheduled by the finishRound() call that
    // ended it will pick up the now-smaller player list on its own.
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
    this.disconnectedScores.clear()   // a new match starting invalidates any older match's snapshots
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

  handleThrowJoker(pid: string, targetId: string): void {
    const ok = this.game.throwJoker(pid, targetId)
    if (!ok) { this.sendTo(pid, { type: 'pushyourluckdraw_room_error', message: 'Jogada inválida.' }); return }

    this.broadcastAll({
      type: 'pushyourluckdraw_throw_result', playerId: pid, targetId,
      players: this.game.publicPlayers(), tableState: this.game.tableState,
    })

    if (this.game.isRoundComplete()) { this.finishRound(); return }
    this.notifyCurrentPlayer()
  }

  private finishRound(): void {
    this.clearTurnTimer()
    gameMetrics.pushyourluckdraw.roundsCompleted++
    this.broadcastAll({ type: 'pushyourluckdraw_round_end', players: this.game.publicPlayers(), tableState: this.game.tableState })

    if (this.game.isMatchOver()) setTimeout(() => this.finishMatch(), ROUND_END_DELAY_MS)
    else setTimeout(() => this.dealNextRound(), ROUND_END_DELAY_MS)
  }

  private dealNextRound(): void {
    this.game.startRound()
    this.broadcastRoundStarted()
  }

  private finishMatch(): void {
    gameMetrics.pushyourluckdraw.matchesCompleted++
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
    this.rematchTimer = setTimeout(() => this.handleRematchTimeout(), REMATCH_TIMEOUT_S * 1000)
  }

  /** Declining is just leaving from here on — the table stays open for
   *  whoever else is still around (see class doc above); it no longer
   *  vetoes everyone else's rematch. */
  handleRematchVote(pid: string, accept: boolean): void {
    if (!this.players.some((p) => p.id === pid)) return
    if (!accept) { this.leave(pid, 'rematch_declined'); return }

    this.rematchVotes.add(pid)
    this.refreshRematchVote()
  }

  /** Re-broadcasts the rematch tally (used both after a fresh vote and
   *  after a voter left/disconnected mid-vote), and starts the rematch the
   *  moment every remaining seated player has accepted. */
  private refreshRematchVote(): void {
    const accepted = [...this.rematchVotes]
    const pending = this.players.map((p) => p.id).filter((id) => !this.rematchVotes.has(id))
    this.broadcastAll({ type: 'pushyourluckdraw_rematch_status', accepted, pending })

    if (pending.length === 0) {
      if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
      this.disconnectedScores.clear()   // a new match starting invalidates any older match's snapshots
      this.game.startMatch()
      this.broadcastRoundStarted()
    }
  }

  /** Fires when the rematch vote's window closes without everyone having
   *  voted — anyone who never voted is treated the same as an explicit
   *  decline (removed, score preserved for a possible same-match rejoin —
   *  though there's no "match" left to rejoin once this closes it out).
   *  The table only actually closes if that leaves it completely empty. */
  private handleRematchTimeout(): void {
    this.rematchTimer = null
    const stragglers = this.players.map((p) => p.id).filter((id) => !this.rematchVotes.has(id))
    for (const id of stragglers) this.leave(id, 'rematch_timeout')
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
