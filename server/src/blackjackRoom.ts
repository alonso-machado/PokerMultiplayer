import type { BlackjackServerMessage } from '../../shared/types'
import { BlackjackGame } from './blackjack/gameEngine'
import { logger } from './logger'

export type BlackjackSendFn = (msg: BlackjackServerMessage) => void

interface BlackjackRoomPlayer { id: string; name: string; send: BlackjackSendFn }

export interface BlackjackRoomOptions {
  onEmpty?: () => void
  /** Called whenever this table's player count changes (join, leave, or a
   *  busted player being auto-removed) — lets the caller keep a lobby-wide
   *  table/player count in sync without this room knowing about other tables. */
  onPlayersChanged?: () => void
}

const BETTING_TIMEOUT_S   = Number(process.env.BLACKJACK_BETTING_TIMEOUT ?? 20)
const INSURANCE_TIMEOUT_S = Number(process.env.BLACKJACK_INSURANCE_TIMEOUT ?? 15)
const TURN_TIMEOUT_S      = Number(process.env.BLACKJACK_TURN_TIMEOUT ?? 30)
const ROUND_END_DELAY_MS  = Number(process.env.BLACKJACK_ROUND_END_DELAY_MS ?? 4000)
const NO_BETTORS_RETRY_MS = 1500

/** Orchestration for Blackjack — structurally unlike trucoRoom.ts/canastraRoom.ts:
 *  no room creation (see the matchmaking `blackjack_join` handler in index.ts),
 *  no team/points match, no rematch vote. It's Poker-Room-style continuous
 *  rounds (bet → deal → resolve → bet again) but against a shared dealer hand
 *  instead of other players, and a single seated player is enough to play.
 *  See .claude/Blackjack.md for the rules this implements. */
export class BlackjackRoom {
  readonly id: string
  readonly name: string

  private players: BlackjackRoomPlayer[] = []
  readonly game = new BlackjackGame()
  private started = false

  // Shared by the betting/insurance/turn windows — only one is ever active
  // at a time, so one timer + one deadline is enough for all three.
  private phaseTimer: ReturnType<typeof setTimeout> | null = null
  private deadlineAt: number | null = null
  private roundEndTimer: ReturnType<typeof setTimeout> | null = null

  private readonly onEmpty?: () => void
  private readonly onPlayersChanged?: () => void

  constructor(id: string, name: string, opts: BlackjackRoomOptions = {}) {
    this.id = id
    this.name = name
    this.onEmpty = opts.onEmpty
    this.onPlayersChanged = opts.onPlayersChanged
  }

  get playerCount() { return this.players.length }
  get isFull()      { return this.players.length >= this.game.maxPlayers }

  // ── Join / Leave ─────────────────────────────────────────────────────────

  join(id: string, name: string, send: BlackjackSendFn): boolean {
    if (this.isFull) return false
    this.players.push({ id, name, send })
    this.game.addPlayer(id, name)
    send({ type: 'blackjack_room_joined', roomId: this.id, yourId: id })
    if (!this.started) { this.started = true; this.broadcastAll({ type: 'blackjack_game_started' }) }
    else send({ type: 'blackjack_game_started' })
    this.broadcastAll({ type: 'blackjack_player_list', players: this.game.publicPlayers() })
    this.onPlayersChanged?.()
    // Mid-round joiners just wait for the next betting window (already
    // broadcast to them above via player_list); only kick the loop off if
    // it isn't already running (the very first player at a fresh table).
    if (this.game.tableState.phase === 'waiting') this.openBettingRound()
    return true
  }

  leave(pid: string): void {
    const wasPresent = this.players.some((p) => p.id === pid)
    if (!wasPresent) return
    const wasTurnOf = this.game.currentPlayerId() === pid

    this.game.handleLeaveDuringRound(pid)
    this.players = this.players.filter((p) => p.id !== pid)
    this.game.removePlayer(pid)

    logger.info('blackjack_player_left_room', { 'blackjack.room_id': this.id, 'blackjack.player_id': pid })

    if (this.players.length === 0) { this.destroy(); this.onEmpty?.(); return }

    this.onPlayersChanged?.()
    this.broadcastAll({ type: 'blackjack_player_list', players: this.game.publicPlayers() })

    const phase = this.game.tableState.phase
    if (phase === 'round_end') { this.finishRound(); return }
    if (phase === 'player_turns') {
      this.broadcastState()
      if (wasTurnOf) this.notifyCurrentPlayer()
      return
    }
    if (phase === 'betting') {
      this.broadcastState()
      if (this.game.hasBettors() && this.game.allPlayersBet()) { this.clearPhaseTimer(); this.closeBetting() }
      return
    }
    if (phase === 'insurance') {
      this.broadcastState()
      if (this.game.allInsuranceDecided()) { this.clearPhaseTimer(); this.closeInsurance() }
    }
  }

  // ── Betting ───────────────────────────────────────────────────────────────

  private openBettingRound(): void {
    this.clearPhaseTimer()
    this.game.openBetting()
    this.broadcastAll({
      type: 'blackjack_betting_open', players: this.game.publicPlayers(),
      tableState: this.game.tableState, timeoutSeconds: BETTING_TIMEOUT_S,
    })
    this.deadlineAt = Date.now() + BETTING_TIMEOUT_S * 1000
    this.phaseTimer = setTimeout(() => this.closeBetting(), BETTING_TIMEOUT_S * 1000)
  }

  handlePlaceBet(pid: string, amount: number): void {
    const ok = this.game.placeBet(pid, amount)
    if (!ok) { this.sendTo(pid, { type: 'blackjack_room_error', message: 'Aposta inválida.' }); return }
    this.broadcastState()
    if (this.game.allPlayersBet()) { this.clearPhaseTimer(); this.closeBetting() }
  }

  private closeBetting(): void {
    this.clearPhaseTimer()
    if (!this.game.hasBettors()) {
      setTimeout(() => { if (this.players.length > 0) this.openBettingRound() }, NO_BETTORS_RETRY_MS)
      return
    }
    this.game.dealRound()
    this.broadcastState()
    const phase = this.game.tableState.phase
    if (phase === 'insurance') this.openInsuranceWindow()
    else if (phase === 'round_end') this.finishRound()
    else this.notifyCurrentPlayer()
  }

  // ── Insurance ─────────────────────────────────────────────────────────────

  private openInsuranceWindow(): void {
    this.broadcastAll({
      type: 'blackjack_insurance_open', timeoutSeconds: INSURANCE_TIMEOUT_S,
      players: this.game.publicPlayers(), tableState: this.game.tableState,
    })
    this.deadlineAt = Date.now() + INSURANCE_TIMEOUT_S * 1000
    this.phaseTimer = setTimeout(() => this.closeInsurance(), INSURANCE_TIMEOUT_S * 1000)
  }

  handlePlaceInsurance(pid: string, amount: number): void {
    const ok = this.game.placeInsurance(pid, amount)
    if (!ok) { this.sendTo(pid, { type: 'blackjack_room_error', message: 'Seguro inválido.' }); return }
    this.broadcastState()
    if (this.game.allInsuranceDecided()) { this.clearPhaseTimer(); this.closeInsurance() }
  }

  private closeInsurance(): void {
    this.clearPhaseTimer()
    this.game.resolvePeek()
    this.broadcastState()
    if (this.game.tableState.phase === 'round_end') this.finishRound()
    else this.notifyCurrentPlayer()
  }

  // ── Player turns ────────────────────────────────────────────────────────

  private notifyCurrentPlayer(): void {
    this.clearPhaseTimer()
    const pid = this.game.currentPlayerId()
    if (!pid) { this.finishRound(); return } // defensive — shouldn't happen, playDealerAndResolve always sets round_end first
    const info = this.game.turnInfo(pid)
    this.sendTo(pid, {
      type: 'blackjack_your_turn', handIndex: this.game.tableState.currentHandIndex ?? 0,
      validActions: info.validActions, timeoutSeconds: TURN_TIMEOUT_S,
    })
    this.deadlineAt = Date.now() + TURN_TIMEOUT_S * 1000
    this.phaseTimer = setTimeout(() => this.handleTurnTimeout(pid), TURN_TIMEOUT_S * 1000)
  }

  private handleTurnTimeout(pid: string): void {
    if (this.game.tableState.phase !== 'player_turns' || this.game.currentPlayerId() !== pid) return
    this.handleStand(pid)
  }

  private handleGameAction(pid: string, apply: () => boolean): void {
    const ok = apply()
    if (!ok) { this.sendTo(pid, { type: 'blackjack_room_error', message: 'Jogada inválida.' }); return }
    this.broadcastState()
    if (this.game.tableState.phase === 'round_end') this.finishRound()
    else this.notifyCurrentPlayer()
  }

  handleHit(pid: string): void    { this.handleGameAction(pid, () => this.game.hit(pid)) }
  handleStand(pid: string): void  { this.handleGameAction(pid, () => this.game.stand(pid)) }
  handleDouble(pid: string): void { this.handleGameAction(pid, () => this.game.double(pid)) }
  handleSplit(pid: string): void  { this.handleGameAction(pid, () => this.game.split(pid)) }

  // ── Round end ─────────────────────────────────────────────────────────────

  private finishRound(): void {
    this.clearPhaseTimer()
    this.broadcastAll({
      type: 'blackjack_round_end', players: this.game.publicPlayers(),
      dealer: this.game.tableState.dealer, tableState: this.game.tableState,
    })
    const busted = this.game.bustedPlayerIds()
    this.roundEndTimer = setTimeout(() => {
      for (const id of busted) {
        this.sendTo(id, { type: 'blackjack_room_left', reason: 'busted' })
        this.players = this.players.filter((p) => p.id !== id)
        this.game.removePlayer(id)
      }
      if (busted.length > 0) {
        this.broadcastAll({ type: 'blackjack_player_list', players: this.game.publicPlayers() })
        this.onPlayersChanged?.()
      }
      if (this.players.length === 0) { this.destroy(); this.onEmpty?.(); return }
      this.openBettingRound()
    }, ROUND_END_DELAY_MS)
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────

  reconnect(pid: string, send: BlackjackSendFn): void {
    const rp = this.players.find((p) => p.id === pid)
    if (rp) rp.send = send

    send({ type: 'blackjack_room_joined', roomId: this.id, yourId: pid })
    if (this.started) send({ type: 'blackjack_game_started' })
    send({ type: 'blackjack_player_list', players: this.game.publicPlayers() })

    const phase = this.game.tableState.phase
    const remaining = (fallback: number) =>
      this.deadlineAt === null ? fallback : Math.max(1, Math.ceil((this.deadlineAt - Date.now()) / 1000))

    if (phase === 'betting') {
      send({ type: 'blackjack_betting_open', players: this.game.publicPlayers(), tableState: this.game.tableState, timeoutSeconds: remaining(BETTING_TIMEOUT_S) })
    } else if (phase === 'insurance') {
      send({ type: 'blackjack_insurance_open', timeoutSeconds: remaining(INSURANCE_TIMEOUT_S), players: this.game.publicPlayers(), tableState: this.game.tableState })
    } else {
      send({ type: 'blackjack_state_update', players: this.game.publicPlayers(), tableState: this.game.tableState })
      if (phase === 'player_turns' && this.game.currentPlayerId() === pid) {
        const info = this.game.turnInfo(pid)
        send({ type: 'blackjack_your_turn', handIndex: this.game.tableState.currentHandIndex ?? 0, validActions: info.validActions, timeoutSeconds: remaining(TURN_TIMEOUT_S) })
      }
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private clearPhaseTimer(): void {
    if (this.phaseTimer) { clearTimeout(this.phaseTimer); this.phaseTimer = null }
    this.deadlineAt = null
  }

  private broadcastState(): void {
    this.broadcastAll({ type: 'blackjack_state_update', players: this.game.publicPlayers(), tableState: this.game.tableState })
  }

  private sendTo(pid: string, msg: BlackjackServerMessage): void { this.players.find((p) => p.id === pid)?.send(msg) }
  broadcastAll(msg: BlackjackServerMessage): void { for (const p of this.players) p.send(msg) }

  destroy(): void {
    this.clearPhaseTimer()
    if (this.roundEndTimer) { clearTimeout(this.roundEndTimer); this.roundEndTimer = null }
  }
}
