import type { Card, TrucoRoomConfig, TrucoRoomSummary, TrucoServerMessage } from '../../shared/types'
import { TrucoGame } from './truco/gameEngine'
import { logger } from './logger'

export type TrucoSendFn = (msg: TrucoServerMessage) => void

interface TrucoRoomPlayer { id: string; name: string; send: TrucoSendFn }

type LeaveReason = 'leave' | 'match_abandoned' | 'rematch_declined' | 'rematch_timeout'

export interface TrucoRoomOptions {
  onExpire?: () => void
  onDissolve?: () => void
}

const EMPTY_TTL = 10 * 60 * 1000
const REMATCH_TIMEOUT_S = 60
const TURN_TIMEOUT_S = Number(process.env.TRUCO_TIMEOUT ?? 60)
const HAND_END_DELAY_MS = Number(process.env.TRUCO_HAND_END_DELAY_MS ?? 2500)

export class TrucoRoom {
  readonly id: string
  readonly name: string
  readonly creatorName: string
  readonly config: TrucoRoomConfig

  private players: TrucoRoomPlayer[] = []
  readonly game: TrucoGame
  private started = false
  private expireTimer: ReturnType<typeof setTimeout> | null = null
  private rematchVotes = new Set<string>()
  private rematchTimer: ReturnType<typeof setTimeout> | null = null
  private turnTimer: ReturnType<typeof setTimeout> | null = null
  private turnDeadlineAt: number | null = null
  private readonly onExpire?: () => void
  private readonly onDissolve?: () => void

  constructor(id: string, name: string, creatorName: string, config: TrucoRoomConfig, opts: TrucoRoomOptions = {}) {
    this.id = id
    this.name = name
    this.creatorName = creatorName
    this.config = config
    this.onExpire = opts.onExpire
    this.onDissolve = opts.onDissolve
    this.game = new TrucoGame(config)
    this.scheduleExpiry()
  }

  // ── Expiry ────────────────────────────────────────────────────────────────

  private scheduleExpiry(): void {
    this.clearExpiry()
    this.expireTimer = setTimeout(() => {
      if (!this.started) {
        for (const p of this.players) p.send({ type: 'truco_room_left', reason: 'expired' })
        this.onExpire?.()
      }
    }, EMPTY_TTL)
  }
  private clearExpiry(): void {
    if (this.expireTimer) { clearTimeout(this.expireTimer); this.expireTimer = null }
  }

  // ── Info ──────────────────────────────────────────────────────────────────

  get playerCount() { return this.players.length }
  get isFull()      { return this.players.length >= this.game.maxPlayers }
  get isStarted()   { return this.started }

  summary(): TrucoRoomSummary {
    return {
      id: this.id, name: this.name, creatorName: this.creatorName,
      playerCount: this.players.length, maxPlayers: this.game.maxPlayers,
      status: this.started ? 'playing' : 'waiting',
      config: this.config,
    }
  }

  // ── Join / Leave ─────────────────────────────────────────────────────────

  join(id: string, name: string, send: TrucoSendFn): boolean {
    if (this.isFull || this.started) return false
    this.players.push({ id, name, send })
    this.game.addPlayer(id, name)
    send({ type: 'truco_room_joined', roomId: this.id, roomName: this.name, config: this.config, yourId: id })
    this.broadcastAll({ type: 'truco_player_list', players: this.game.publicPlayers() })
    this.clearExpiry()
    if (this.isFull) setTimeout(() => this.startMatch(), 300)
    else this.scheduleExpiry()
    return true
  }

  /** Truco has no mid-match backfill — a player leaving a running match dissolves the table. */
  leave(playerId: string, reason: LeaveReason = 'leave'): void {
    const wasPresent = this.players.some((p) => p.id === playerId)
    if (!wasPresent) return

    if (this.started) {
      this.players = this.players.filter((p) => p.id !== playerId)
      this.broadcastAll({ type: 'truco_room_left', reason: 'abandoned' })
      this.destroy()
      this.onDissolve?.()
      return
    }

    this.players = this.players.filter((p) => p.id !== playerId)
    this.game.removePlayer(playerId)
    this.broadcastAll({ type: 'truco_player_list', players: this.game.publicPlayers() })
    if (this.players.length === 0) this.destroy()
    else this.scheduleExpiry()

    logger.info('truco_player_left_room', {
      'truco.room_id': this.id, 'truco.player_id': playerId, 'truco.reason': reason,
    })
  }

  // ── Match / hand lifecycle ───────────────────────────────────────────────

  private startMatch(): void {
    if (this.started) return
    this.started = true
    this.clearExpiry()
    this.broadcastAll({ type: 'truco_game_started' })
    this.dealHand()
  }

  private dealHand(): void {
    this.game.startHand()
    for (const rp of this.players) {
      const gp = this.game.players.find((p) => p.id === rp.id)
      if (!gp) continue
      rp.send({
        type: 'truco_hand_dealt', yourCards: gp.holeCards,
        players: this.game.publicPlayers(), tableState: this.game.tableState,
      })
    }
    const { vira, manilhaCards } = this.game.tableState
    if (vira) this.broadcastAll({ type: 'truco_vira_revealed', vira, manilhaCards })

    if (this.game.tableState.phase === 'mao_de_onze_decision') this.sendMaoDeOnzePrompts()
    else this.notifyCurrentPlayer()
  }

  private sendMaoDeOnzePrompts(): void {
    this.clearTurnTimer()
    const isFerro = this.game.isFerro()
    for (const rp of this.players) {
      const gp = this.game.players.find((p) => p.id === rp.id)
      if (!gp || gp.status !== 'mao_de_onze_pending') continue
      rp.send({ type: 'truco_mao_de_onze_prompt', teamCards: this.game.teamHand(rp.id), isFerro, timeoutSeconds: TURN_TIMEOUT_S })
    }
    this.turnDeadlineAt = Date.now() + TURN_TIMEOUT_S * 1000
    this.turnTimer = setTimeout(() => this.handleMaoDeOnzeTimeout(), TURN_TIMEOUT_S * 1000)
  }

  /** If nobody has decided by the deadline, correr (decline) on behalf of one still-pending player. */
  private handleMaoDeOnzeTimeout(): void {
    if (this.game.tableState.phase !== 'mao_de_onze_decision') return
    const pending = this.game.players.find((p) => p.status === 'mao_de_onze_pending')
    if (pending) this.handleMaoDeOnzeDecision(pending.id, false)
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  handleMaoDeOnzeDecision(pid: string, accept: boolean): void {
    const ok = this.game.maoDeOnzeDecision(pid, accept)
    if (!ok) { this.sendTo(pid, { type: 'truco_room_error', message: 'Decisão inválida.' }); return }
    if (this.game.tableState.phase === 'hand_end') this.finishHand()
    else if (this.game.tableState.phase === 'playing') this.notifyCurrentPlayer()
  }

  handlePlayCard(pid: string, card: Card): void {
    const ok = this.game.playCard(pid, card)
    if (!ok) { this.sendTo(pid, { type: 'truco_room_error', message: 'Jogada inválida.' }); return }

    const state = this.game.tableState
    this.broadcastAll({ type: 'truco_card_played', playerId: pid, card, tableState: state })

    if (state.phase === 'hand_end') { this.finishHand(); return }
    if (state.vazaCardsPlayed.length === 0) {
      // The vaza just resolved and cleared — announce its winner before the next one starts.
      this.broadcastAll({
        type: 'truco_vaza_result',
        winnerTeam: state.vazaWinners[state.vazaWinners.length - 1] ?? null,
        tableState: state,
      })
    }
    this.notifyCurrentPlayer()
  }

  handleCallTruco(pid: string): void {
    const ok = this.game.callTruco(pid)
    if (!ok) { this.sendTo(pid, { type: 'truco_room_error', message: 'Não é possível chamar agora.' }); return }
    this.broadcastAll({ type: 'truco_call_made', playerId: pid, level: this.game.tableState.stake, tableState: this.game.tableState })
    this.notifyCurrentPlayer()
  }

  handleRespond(pid: string, accept: boolean): void {
    const ok = this.game.respond(pid, accept)
    if (!ok) { this.sendTo(pid, { type: 'truco_room_error', message: 'Nada para responder.' }); return }
    this.broadcastAll({ type: 'truco_call_responded', playerId: pid, accept, tableState: this.game.tableState })
    if (this.game.tableState.phase === 'hand_end') this.finishHand()
    else this.notifyCurrentPlayer()
  }

  private finishHand(): void {
    const result = this.game.lastHandResult!
    this.broadcastAll({
      type: 'truco_hand_end', winnerTeam: result.winnerTeam, points: result.points,
      reason: result.reason, tableState: this.game.tableState,
    })

    if (this.game.isMatchOver()) setTimeout(() => this.finishMatch(), HAND_END_DELAY_MS)
    else setTimeout(() => this.dealHand(), HAND_END_DELAY_MS)
  }

  private finishMatch(): void {
    const result = this.game.matchResult()!
    this.game.recordMatchWin(result.winnerTeam)
    const matchWins: Record<string, number> = {}
    for (const p of this.game.players) matchWins[p.id] = p.matchWins
    this.broadcastAll({ type: 'truco_match_end', winnerTeam: result.winnerTeam, scores: result.scores, matchWins })
    this.startRematchVote()
  }

  // ── Rematch voting ───────────────────────────────────────────────────────

  private startRematchVote(): void {
    this.rematchVotes.clear()
    this.broadcastAll({ type: 'truco_rematch_status', accepted: [], pending: this.players.map((p) => p.id) })
    this.rematchTimer = setTimeout(() => this.dissolveForRematch(), REMATCH_TIMEOUT_S * 1000)
  }

  handleRematchVote(pid: string, accept: boolean): void {
    if (!this.players.some((p) => p.id === pid)) return
    if (!accept) { this.dissolveForRematch(); return }

    this.rematchVotes.add(pid)
    const accepted = [...this.rematchVotes]
    const pending = this.players.map((p) => p.id).filter((id) => !this.rematchVotes.has(id))
    this.broadcastAll({ type: 'truco_rematch_status', accepted, pending })

    if (pending.length === 0) {
      if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
      this.game.resetForRematch()
      this.dealHand()
    }
  }

  private dissolveForRematch(): void {
    if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
    this.broadcastAll({ type: 'truco_room_left', reason: 'rematch_declined' })
    this.destroy()
    this.onDissolve?.()
  }

  // ── Turn notification ────────────────────────────────────────────────────

  private notifyCurrentPlayer(): void {
    this.clearTurnTimer()
    const pid = this.game.currentPlayerId()
    const state = this.game.tableState

    if (pid) {
      const info = this.game.turnInfo(pid)
      this.sendTo(pid, { type: 'truco_your_turn', canCallTruco: info.canCallTruco, canRespond: info.canRespond, timeoutSeconds: TURN_TIMEOUT_S })
    }

    if (state.awaitingResponseFromTeam !== null) {
      for (const p of this.game.players) {
        if (p.teamIndex === state.awaitingResponseFromTeam && p.id !== pid) {
          this.sendTo(p.id, { type: 'truco_your_turn', canCallTruco: false, canRespond: true, timeoutSeconds: TURN_TIMEOUT_S })
        }
      }
      this.turnDeadlineAt = Date.now() + TURN_TIMEOUT_S * 1000
      this.turnTimer = setTimeout(() => this.handleResponseTimeout(), TURN_TIMEOUT_S * 1000)
    } else if (pid) {
      this.turnDeadlineAt = Date.now() + TURN_TIMEOUT_S * 1000
      this.turnTimer = setTimeout(() => this.handlePlayTimeout(pid), TURN_TIMEOUT_S * 1000)
    }
  }

  /** Seconds left on the current turn/decision timer — for resending an accurate countdown on reconnect. */
  private remainingTimeoutSeconds(): number {
    if (this.turnDeadlineAt === null) return TURN_TIMEOUT_S
    return Math.max(1, Math.ceil((this.turnDeadlineAt - Date.now()) / 1000))
  }

  /** Auto-plays the current player's weakest card if they haven't acted in time. */
  private handlePlayTimeout(pid: string): void {
    if (this.game.tableState.phase !== 'playing' || this.game.currentPlayerId() !== pid) return
    const card = this.game.weakestCard(pid)
    if (card) this.handlePlayCard(pid, card)
  }

  /** Auto-declines ("corro") on behalf of the responding team if nobody answers in time. */
  private handleResponseTimeout(): void {
    const state = this.game.tableState
    if (state.awaitingResponseFromTeam === null) return
    const rep = this.game.players.find((p) => p.teamIndex === state.awaitingResponseFromTeam)
    if (rep) this.handleRespond(rep.id, false)
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null }
    this.turnDeadlineAt = null
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────

  reconnect(pid: string, send: TrucoSendFn): void {
    const rp = this.players.find((p) => p.id === pid)
    if (rp) rp.send = send
    const gp = this.game.players.find((p) => p.id === pid)

    // Without this, the client never learns roomId/config/myId again and stays
    // stuck on the Truco lobby instead of resuming the in-progress table.
    send({ type: 'truco_room_joined', roomId: this.id, roomName: this.name, config: this.config, yourId: pid })

    if (this.started) send({ type: 'truco_game_started' })
    if (gp) {
      send({
        type: 'truco_hand_dealt', yourCards: gp.holeCards,
        players: this.game.publicPlayers(), tableState: this.game.tableState,
      })
    }
    send({ type: 'truco_player_list', players: this.game.publicPlayers() })

    // Re-send whatever prompt this player was mid-decision on, with the
    // actual time left (not a fresh window) so reconnecting can't buy extra time.
    const state = this.game.tableState
    if (state.phase === 'mao_de_onze_decision' && gp?.status === 'mao_de_onze_pending') {
      send({ type: 'truco_mao_de_onze_prompt', teamCards: this.game.teamHand(pid), isFerro: this.game.isFerro(), timeoutSeconds: this.remainingTimeoutSeconds() })
    } else if (state.phase === 'playing') {
      const info = this.game.turnInfo(pid)
      if (info.canPlay || info.canRespond) {
        send({ type: 'truco_your_turn', canCallTruco: info.canCallTruco, canRespond: info.canRespond, timeoutSeconds: this.remainingTimeoutSeconds() })
      }
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private sendTo(pid: string, msg: TrucoServerMessage): void { this.players.find((p) => p.id === pid)?.send(msg) }
  broadcastAll(msg: TrucoServerMessage): void { for (const p of this.players) p.send(msg) }

  destroy(): void {
    this.clearExpiry()
    this.clearTurnTimer()
    if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
  }
}
