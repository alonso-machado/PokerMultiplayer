import type { Card, GauchoRoomConfig, GauchoRoomSummary, GauchoServerMessage } from '../../shared/types'
import { GauchoGame } from './gaucho/gameEngine'
import { logger } from './logger'

export type GauchoSendFn = (msg: GauchoServerMessage) => void

interface GauchoRoomPlayer { id: string; name: string; send: GauchoSendFn }

type LeaveReason = 'leave' | 'match_abandoned' | 'rematch_declined' | 'rematch_timeout'

export interface GauchoRoomOptions {
  onExpire?: () => void
  onDissolve?: () => void
}

const EMPTY_TTL = 10 * 60 * 1000
const REMATCH_TIMEOUT_S = 60
const TURN_TIMEOUT_S = Number(process.env.GAUCHO_TIMEOUT ?? 60)
const HAND_END_DELAY_MS = Number(process.env.GAUCHO_HAND_END_DELAY_MS ?? 2500)

/** Orchestration for Truco Gaúcho tables — same shape as trucoRoom.ts, but a
 *  separate game (see .claude/TrucoGaucho.md); no shared runtime state. */
export class GauchoRoom {
  readonly id: string
  readonly name: string
  readonly creatorName: string
  readonly config: GauchoRoomConfig

  private players: GauchoRoomPlayer[] = []
  readonly game: GauchoGame
  private started = false
  private expireTimer: ReturnType<typeof setTimeout> | null = null
  private rematchVotes = new Set<string>()
  private rematchTimer: ReturnType<typeof setTimeout> | null = null
  private turnTimer: ReturnType<typeof setTimeout> | null = null
  private turnDeadlineAt: number | null = null
  private readonly onExpire?: () => void
  private readonly onDissolve?: () => void

  constructor(id: string, name: string, creatorName: string, config: GauchoRoomConfig, opts: GauchoRoomOptions = {}) {
    this.id = id
    this.name = name
    this.creatorName = creatorName
    this.config = config
    this.onExpire = opts.onExpire
    this.onDissolve = opts.onDissolve
    this.game = new GauchoGame(config)
    this.scheduleExpiry()
  }

  // ── Expiry ────────────────────────────────────────────────────────────────

  private scheduleExpiry(): void {
    this.clearExpiry()
    this.expireTimer = setTimeout(() => {
      if (!this.started) {
        for (const p of this.players) p.send({ type: 'gaucho_room_left', reason: 'expired' })
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

  summary(): GauchoRoomSummary {
    return {
      id: this.id, name: this.name, creatorName: this.creatorName,
      playerCount: this.players.length, maxPlayers: this.game.maxPlayers,
      status: this.started ? 'playing' : 'waiting',
      config: this.config,
    }
  }

  // ── Join / Leave ─────────────────────────────────────────────────────────

  join(id: string, name: string, send: GauchoSendFn): boolean {
    if (this.isFull || this.started) return false
    this.players.push({ id, name, send })
    this.game.addPlayer(id, name)
    send({ type: 'gaucho_room_joined', roomId: this.id, roomName: this.name, config: this.config, yourId: id })
    this.broadcastAll({ type: 'gaucho_player_list', players: this.game.publicPlayers() })
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
      this.broadcastAll({ type: 'gaucho_room_left', reason: 'abandoned' })
      this.destroy()
      this.onDissolve?.()
      return
    }

    this.players = this.players.filter((p) => p.id !== playerId)
    this.game.removePlayer(playerId)
    this.broadcastAll({ type: 'gaucho_player_list', players: this.game.publicPlayers() })
    if (this.players.length === 0) this.destroy()
    else this.scheduleExpiry()

    logger.info('gaucho_player_left_room', {
      'gaucho.room_id': this.id, 'gaucho.player_id': playerId, 'gaucho.reason': reason,
    })
  }

  // ── Match / hand lifecycle ───────────────────────────────────────────────

  private startMatch(): void {
    if (this.started) return
    this.started = true
    this.clearExpiry()
    this.broadcastAll({ type: 'gaucho_game_started' })
    this.dealHand()
  }

  private dealHand(): void {
    this.game.startHand()
    for (const rp of this.players) {
      const gp = this.game.players.find((p) => p.id === rp.id)
      if (!gp) continue
      rp.send({
        type: 'gaucho_hand_dealt', yourCards: gp.holeCards,
        players: this.game.publicPlayers(), tableState: this.game.tableState,
      })
    }

    if (this.game.tableState.phase === 'mao_de_onze_decision') this.sendMaoDeOnzePrompts()
    else this.notifyCurrentPlayer()
  }

  private sendMaoDeOnzePrompts(): void {
    this.clearTurnTimer()
    const isFerro = this.game.isFerro()
    for (const rp of this.players) {
      const gp = this.game.players.find((p) => p.id === rp.id)
      if (!gp || gp.status !== 'mao_de_onze_pending') continue
      rp.send({ type: 'gaucho_mao_de_onze_prompt', teamCards: this.game.teamHand(rp.id), isFerro, timeoutSeconds: TURN_TIMEOUT_S })
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
    if (!ok) { this.sendTo(pid, { type: 'gaucho_room_error', message: 'Decisão inválida.' }); return }
    if (this.game.tableState.phase === 'hand_end') this.finishHand()
    else if (this.game.tableState.phase === 'playing') this.notifyCurrentPlayer()
  }

  handlePlayCard(pid: string, card: Card): void {
    const ok = this.game.playCard(pid, card)
    if (!ok) { this.sendTo(pid, { type: 'gaucho_room_error', message: 'Jogada inválida.' }); return }

    const state = this.game.tableState
    this.broadcastAll({ type: 'gaucho_card_played', playerId: pid, card, tableState: state })

    if (state.phase === 'hand_end') { this.finishHand(); return }
    if (state.vazaCardsPlayed.length === 0) {
      // The vaza just resolved and cleared — announce its winner before the next one starts.
      this.broadcastAll({
        type: 'gaucho_vaza_result',
        winnerTeam: state.vazaWinners[state.vazaWinners.length - 1] ?? null,
        tableState: state,
      })
    }
    this.notifyCurrentPlayer()
  }

  handleCallTruco(pid: string): void {
    const ok = this.game.callTruco(pid)
    if (!ok) { this.sendTo(pid, { type: 'gaucho_room_error', message: 'Não é possível chamar agora.' }); return }
    const state = this.game.tableState
    this.broadcastAll({ type: 'gaucho_truco_call_made', playerId: pid, level: state.pendingStake!, tableState: state })
    this.notifyCurrentPlayer()
  }

  handleRespondTruco(pid: string, accept: boolean): void {
    const ok = this.game.respondTruco(pid, accept)
    if (!ok) { this.sendTo(pid, { type: 'gaucho_room_error', message: 'Nada para responder.' }); return }
    this.broadcastAll({ type: 'gaucho_truco_call_responded', playerId: pid, accept, tableState: this.game.tableState })
    if (this.game.tableState.phase === 'hand_end') this.finishHand()
    else this.notifyCurrentPlayer()
  }

  handleCallEnvido(pid: string): void {
    const ok = this.game.callEnvido(pid)
    if (!ok) { this.sendTo(pid, { type: 'gaucho_room_error', message: 'Não é possível chamar envido agora.' }); return }
    const state = this.game.tableState
    this.broadcastAll({ type: 'gaucho_envido_call_made', playerId: pid, level: state.envido.pendingCall!, tableState: state })
    this.notifyCurrentPlayer()
  }

  handleRespondEnvido(pid: string, accept: boolean): void {
    const ok = this.game.respondEnvido(pid, accept)
    if (!ok) { this.sendTo(pid, { type: 'gaucho_room_error', message: 'Nada para responder.' }); return }
    const r = this.game.lastEnvidoResult!
    this.broadcastAll({
      type: 'gaucho_envido_result', winnerTeam: r.winnerTeam, points: r.points,
      reason: r.reason, values: r.values, tableState: this.game.tableState,
    })
    this.notifyCurrentPlayer()
  }

  handleCallFlor(pid: string): void {
    const ok = this.game.callFlor(pid)
    if (!ok) { this.sendTo(pid, { type: 'gaucho_room_error', message: 'Não é possível chamar flor agora.' }); return }
    const state = this.game.tableState
    if (state.flor.awaitingResponseFromTeam === null) {
      // Uncontested — callFlor already resolved and scored it.
      const r = this.game.lastFlorResult!
      this.broadcastAll({
        type: 'gaucho_flor_result', winnerTeam: r.winnerTeam, points: r.points,
        reason: r.reason, values: r.values, tableState: state,
      })
    } else {
      this.broadcastAll({ type: 'gaucho_flor_call_made', playerId: pid, level: state.flor.pendingCall!, tableState: state })
    }
    this.notifyCurrentPlayer()
  }

  handleRespondFlor(pid: string, accept: boolean): void {
    const ok = this.game.respondFlor(pid, accept)
    if (!ok) { this.sendTo(pid, { type: 'gaucho_room_error', message: 'Nada para responder.' }); return }
    const r = this.game.lastFlorResult!
    this.broadcastAll({
      type: 'gaucho_flor_result', winnerTeam: r.winnerTeam, points: r.points,
      reason: r.reason, values: r.values, tableState: this.game.tableState,
    })
    this.notifyCurrentPlayer()
  }

  private finishHand(): void {
    const result = this.game.lastHandResult!
    this.broadcastAll({
      type: 'gaucho_hand_end', winnerTeam: result.winnerTeam, points: result.points,
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
    this.broadcastAll({ type: 'gaucho_match_end', winnerTeam: result.winnerTeam, scores: result.scores, matchWins })
    this.startRematchVote()
  }

  // ── Rematch voting ───────────────────────────────────────────────────────

  private startRematchVote(): void {
    this.rematchVotes.clear()
    this.broadcastAll({ type: 'gaucho_rematch_status', accepted: [], pending: this.players.map((p) => p.id) })
    this.rematchTimer = setTimeout(() => this.dissolveForRematch(), REMATCH_TIMEOUT_S * 1000)
  }

  handleRematchVote(pid: string, accept: boolean): void {
    if (!this.players.some((p) => p.id === pid)) return
    if (!accept) { this.dissolveForRematch(); return }

    this.rematchVotes.add(pid)
    const accepted = [...this.rematchVotes]
    const pending = this.players.map((p) => p.id).filter((id) => !this.rematchVotes.has(id))
    this.broadcastAll({ type: 'gaucho_rematch_status', accepted, pending })

    if (pending.length === 0) {
      if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
      this.game.resetForRematch()
      this.dealHand()
    }
  }

  private dissolveForRematch(): void {
    if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
    this.broadcastAll({ type: 'gaucho_room_left', reason: 'rematch_declined' })
    this.destroy()
    this.onDissolve?.()
  }

  // ── Turn notification ────────────────────────────────────────────────────

  private notifyCurrentPlayer(): void {
    this.clearTurnTimer()
    const pid = this.game.currentPlayerId()
    const state = this.game.tableState
    // At most one of these is non-null at a time (see .claude/TrucoGaucho.md
    // → "Exclusão mútua entre Truco / Envido / Flor").
    const respondingTeam = state.awaitingResponseFromTeam
      ?? state.envido.awaitingResponseFromTeam
      ?? state.flor.awaitingResponseFromTeam

    if (pid) this.sendTurnInfo(pid)

    if (respondingTeam !== null) {
      for (const p of this.game.players) {
        if (p.teamIndex === respondingTeam && p.id !== pid) this.sendTurnInfo(p.id)
      }
      this.turnDeadlineAt = Date.now() + TURN_TIMEOUT_S * 1000
      this.turnTimer = setTimeout(() => this.handleResponseTimeout(), TURN_TIMEOUT_S * 1000)
    } else if (pid) {
      this.turnDeadlineAt = Date.now() + TURN_TIMEOUT_S * 1000
      this.turnTimer = setTimeout(() => this.handlePlayTimeout(pid), TURN_TIMEOUT_S * 1000)
    }
  }

  private sendTurnInfo(pid: string): void {
    const info = this.game.turnInfo(pid)
    this.sendTo(pid, {
      type: 'gaucho_your_turn',
      canCallTruco: info.canCallTruco, canRespondTruco: info.canRespondTruco,
      canCallEnvido: info.canCallEnvido, canRespondEnvido: info.canRespondEnvido,
      canCallFlor: info.canCallFlor, canRespondFlor: info.canRespondFlor,
      timeoutSeconds: this.remainingTimeoutSeconds(),
    })
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
    if (state.awaitingResponseFromTeam !== null) {
      const rep = this.game.players.find((p) => p.teamIndex === state.awaitingResponseFromTeam)
      if (rep) this.handleRespondTruco(rep.id, false)
      return
    }
    if (state.envido.awaitingResponseFromTeam !== null) {
      const rep = this.game.players.find((p) => p.teamIndex === state.envido.awaitingResponseFromTeam)
      if (rep) this.handleRespondEnvido(rep.id, false)
      return
    }
    if (state.flor.awaitingResponseFromTeam !== null) {
      const rep = this.game.players.find((p) => p.teamIndex === state.flor.awaitingResponseFromTeam)
      if (rep) this.handleRespondFlor(rep.id, false)
    }
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null }
    this.turnDeadlineAt = null
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────

  reconnect(pid: string, send: GauchoSendFn): void {
    const rp = this.players.find((p) => p.id === pid)
    if (rp) rp.send = send
    const gp = this.game.players.find((p) => p.id === pid)

    send({ type: 'gaucho_room_joined', roomId: this.id, roomName: this.name, config: this.config, yourId: pid })

    if (this.started) send({ type: 'gaucho_game_started' })
    if (gp) {
      send({
        type: 'gaucho_hand_dealt', yourCards: gp.holeCards,
        players: this.game.publicPlayers(), tableState: this.game.tableState,
      })
    }
    send({ type: 'gaucho_player_list', players: this.game.publicPlayers() })

    // Re-send whatever prompt this player was mid-decision on, with the
    // actual time left (not a fresh window) so reconnecting can't buy extra time.
    const state = this.game.tableState
    if (state.phase === 'mao_de_onze_decision' && gp?.status === 'mao_de_onze_pending') {
      send({ type: 'gaucho_mao_de_onze_prompt', teamCards: this.game.teamHand(pid), isFerro: this.game.isFerro(), timeoutSeconds: this.remainingTimeoutSeconds() })
    } else if (state.phase === 'playing') {
      const info = this.game.turnInfo(pid)
      if (info.canPlay || info.canRespondTruco || info.canRespondEnvido || info.canRespondFlor) {
        send({
          type: 'gaucho_your_turn',
          canCallTruco: info.canCallTruco, canRespondTruco: info.canRespondTruco,
          canCallEnvido: info.canCallEnvido, canRespondEnvido: info.canRespondEnvido,
          canCallFlor: info.canCallFlor, canRespondFlor: info.canRespondFlor,
          timeoutSeconds: this.remainingTimeoutSeconds(),
        })
      }
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private sendTo(pid: string, msg: GauchoServerMessage): void { this.players.find((p) => p.id === pid)?.send(msg) }
  broadcastAll(msg: GauchoServerMessage): void { for (const p of this.players) p.send(msg) }

  destroy(): void {
    this.clearExpiry()
    this.clearTurnTimer()
    if (this.rematchTimer) { clearTimeout(this.rematchTimer); this.rematchTimer = null }
  }
}
