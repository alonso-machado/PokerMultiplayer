import type {
  Card, TrucoCallLevel, TrucoPhase, TrucoPlayer, TrucoRoomConfig, TrucoTableState, TrucoVazaCard,
} from '../../../shared/types'
import { createDeck, shuffle, resolveManilha, cardStrength, type ManilhaContext } from './deck'

export interface TrucoGamePlayer extends TrucoPlayer {
  holeCards: Card[]
}

type HandEndReason = 'vazas' | 'corri' | 'mao_de_onze_run'

export interface TrucoHandResult {
  winnerTeam: 0 | 1 | null
  points: number
  reason: HandEndReason
}

export interface TrucoMatchResult {
  winnerTeam: 0 | 1
  scores: [number, number]
}

const LEVELS: TrucoCallLevel[] = [1, 3, 6, 9, 12]

export class TrucoGame {
  players: TrucoGamePlayer[] = []
  private deck: Card[] = []
  private handCount = 0
  private manilhaCtx: ManilhaContext
  private _phase: TrucoPhase = 'waiting'
  private _vaza: 1 | 2 | 3 = 1
  private _vazaCardsPlayed: TrucoVazaCard[] = []
  private _vazaWinners: (0 | 1 | null)[] = []
  private _stake: TrucoCallLevel = 1
  private _pendingStake: TrucoCallLevel | null = null
  private _stakeCalledByTeam: 0 | 1 | null = null
  private _awaitingResponseFromTeam: 0 | 1 | null = null
  private _dealerSeat = -1
  private _leaderSeat = 0
  private _currentSeat = 0
  private _scores: [number, number] = [0, 0]
  private _maoDeOnzePendingTeams = new Set<0 | 1>()
  private _maoDeOnzeDecisions = new Map<0 | 1, boolean>()
  private _lastHandResult: TrucoHandResult | null = null

  constructor(private config: TrucoRoomConfig) {
    this.manilhaCtx = { variant: config.manilhaVariant, vira: null, manilhaCards: [] }
  }

  get maxPlayers(): number {
    return this.config.mode === '1x1' ? 2 : 4
  }

  get tableState(): TrucoTableState {
    return {
      phase: this._phase,
      vira: this.manilhaCtx.vira,
      manilhaCards: [...this.manilhaCtx.manilhaCards],
      vaza: this._vaza,
      vazaCardsPlayed: [...this._vazaCardsPlayed],
      vazaWinners: [...this._vazaWinners],
      stake: this._stake,
      pendingStake: this._pendingStake,
      stakeCalledByTeam: this._stakeCalledByTeam,
      awaitingResponseFromTeam: this._awaitingResponseFromTeam,
      dealerSeat: this._dealerSeat,
      leaderSeat: this._leaderSeat,
      currentSeat: this._currentSeat,
      scores: [...this._scores] as [number, number],
    }
  }

  get lastHandResult(): TrucoHandResult | null {
    return this._lastHandResult
  }

  // ── Player management ───────────────────────────────────────────────────

  addPlayer(id: string, name: string): void {
    const seat = this.nextSeat()
    const teamIndex = (this.config.mode === '1x1' ? seat : seat % 2) as 0 | 1
    this.players.push({
      id, name, seatIndex: seat, teamIndex,
      status: 'waiting', matchWins: 0, holeCards: [],
    })
  }

  removePlayer(id: string): void {
    this.players = this.players.filter((p) => p.id !== id)
  }

  private nextSeat(): number {
    const used = new Set(this.players.map((p) => p.seatIndex))
    for (let i = 0; i < this.maxPlayers; i++) if (!used.has(i)) return i
    return this.players.length
  }

  private teamOf(playerId: string): 0 | 1 {
    return this.players.find((p) => p.id === playerId)!.teamIndex
  }

  private playerAtSeat(seat: number): TrucoGamePlayer | undefined {
    return this.players.find((p) => p.seatIndex === seat)
  }

  // ── Match / hand lifecycle ──────────────────────────────────────────────

  /** Resets scores to 0-0 for a rematch. matchWins persist on `players`. */
  resetForRematch(): void {
    this._scores = [0, 0]
    this._dealerSeat = -1
    this.handCount = 0
  }

  recordMatchWin(team: 0 | 1): void {
    for (const p of this.players) if (p.teamIndex === team) p.matchWins++
  }

  startHand(): void {
    this.handCount++
    this.deck = shuffle(createDeck())
    this.manilhaCtx = resolveManilha(this.config.manilhaVariant, this.deck)
    this._vaza = 1
    this._vazaCardsPlayed = []
    this._vazaWinners = []
    this._stake = 1
    this._pendingStake = null
    this._stakeCalledByTeam = null
    this._awaitingResponseFromTeam = null
    this._lastHandResult = null
    this._maoDeOnzePendingTeams.clear()
    this._maoDeOnzeDecisions.clear()

    this._dealerSeat = (this._dealerSeat + 1) % this.players.length
    this._leaderSeat = (this._dealerSeat + 1) % this.players.length

    for (const p of this.players) {
      p.holeCards = [this.deck.pop()!, this.deck.pop()!, this.deck.pop()!]
      p.status = 'active'
    }

    const pending = new Set<0 | 1>()
    if (this._scores[0] === 11) pending.add(0)
    if (this._scores[1] === 11) pending.add(1)

    if (pending.size > 0) {
      this._phase = 'mao_de_onze_decision'
      this._maoDeOnzePendingTeams = pending
      for (const p of this.players) if (pending.has(p.teamIndex)) p.status = 'mao_de_onze_pending'
    } else {
      this._phase = 'playing'
      this._currentSeat = this._leaderSeat
    }
  }

  /** Combined hand of the caller's team — self + partner (or just self in 1x1). */
  teamHand(playerId: string): Card[] {
    const team = this.teamOf(playerId)
    return this.players.filter((p) => p.teamIndex === team).flatMap((p) => p.holeCards)
  }

  isFerro(): boolean {
    return this._maoDeOnzePendingTeams.size === 2
  }

  maoDeOnzeDecision(playerId: string, accept: boolean): boolean {
    if (this._phase !== 'mao_de_onze_decision') return false
    const team = this.teamOf(playerId)
    if (!this._maoDeOnzePendingTeams.has(team)) return false
    if (this._maoDeOnzeDecisions.has(team)) return false
    this._maoDeOnzeDecisions.set(team, accept)

    if (!accept) {
      const other = team === 0 ? 1 : 0
      this.endHand(other, 1, 'mao_de_onze_run')
      return true
    }

    const allAccepted = [...this._maoDeOnzePendingTeams].every((t) => this._maoDeOnzeDecisions.get(t) === true)
    if (allAccepted) {
      this._phase = 'playing'
      this._currentSeat = this._leaderSeat
      for (const p of this.players) if (p.status === 'mao_de_onze_pending') p.status = 'active'
    }
    return true
  }

  // ── Play ─────────────────────────────────────────────────────────────────

  playCard(playerId: string, card: Card): boolean {
    if (this._phase !== 'playing' || this._awaitingResponseFromTeam !== null) return false
    const player = this.players.find((p) => p.id === playerId)
    if (!player || player.seatIndex !== this._currentSeat) return false
    const cardIdx = player.holeCards.findIndex((c) => c.suit === card.suit && c.rank === card.rank)
    if (cardIdx === -1) return false

    player.holeCards.splice(cardIdx, 1)
    this._vazaCardsPlayed.push({ playerId, card })

    if (this._vazaCardsPlayed.length === this.players.length) {
      this.resolveVaza()
    } else {
      this._currentSeat = (this._currentSeat + 1) % this.players.length
    }
    return true
  }

  private resolveVaza(): void {
    const strengths = this._vazaCardsPlayed.map((vc) => ({
      ...vc, strength: cardStrength(vc.card, this.manilhaCtx),
    }))
    const maxStrength = Math.max(...strengths.map((s) => s.strength))
    const maxPlayers = strengths.filter((s) => s.strength === maxStrength)
    const teams = new Set(maxPlayers.map((mp) => this.teamOf(mp.playerId)))

    let winnerTeam: 0 | 1 | null = null
    if (teams.size === 1) {
      winnerTeam = [...teams][0]!
      this._leaderSeat = this.players.find((p) => p.id === maxPlayers[0]!.playerId)!.seatIndex
    }
    this._vazaWinners.push(winnerTeam)

    const over = this.checkHandOver()
    if (over.over) {
      this.endHand(over.winnerTeam, this._stake, 'vazas')
      return
    }

    this._vaza = (this._vaza + 1) as 1 | 2 | 3
    this._vazaCardsPlayed = []
    this._currentSeat = this._leaderSeat
  }

  /** Tie-break table — see .claude/Truco.md → "Empate de vaza". */
  private checkHandOver(): { over: boolean; winnerTeam: 0 | 1 | null } {
    const w = this._vazaWinners
    if (w.length < 2) return { over: false, winnerTeam: null }
    const [w1, w2] = w
    if (w1 !== null && w2 !== null && w1 === w2) return { over: true, winnerTeam: w1 }
    if (w1 === null && w2 !== null) return { over: true, winnerTeam: w2 }
    if (w1 !== null && w2 === null) return { over: true, winnerTeam: w1 }
    if (w.length < 3) return { over: false, winnerTeam: null }
    return { over: true, winnerTeam: w[2]! } // may be null → "ninguém pontua"
  }

  private endHand(winnerTeam: 0 | 1 | null, points: number, reason: HandEndReason): void {
    if (winnerTeam !== null) this._scores[winnerTeam] += points
    this._phase = 'hand_end'
    this._lastHandResult = { winnerTeam, points, reason }
  }

  // ── Truco escalation ─────────────────────────────────────────────────────

  /**
   * Calls truco/seis/nove/doze. Two ways in:
   *  - Normal call: nothing pending, caller must be the current-turn player
   *    and not the team that made the last call.
   *  - Raise-as-response: a call is already pending and the caller is on the
   *    responding team — they skip accept/decline and raise straight to the
   *    next level (any player on that team, mirroring `respond`'s permissiveness).
   */
  callTruco(playerId: string): boolean {
    if (this._phase !== 'playing') return false
    const player = this.players.find((p) => p.id === playerId)
    if (!player) return false

    if (this._awaitingResponseFromTeam !== null) {
      if (player.teamIndex !== this._awaitingResponseFromTeam) return false
    } else {
      if (player.seatIndex !== this._currentSeat) return false
      if (player.teamIndex === this._stakeCalledByTeam) return false // must wait for the other team to act
    }

    const base = this._pendingStake ?? this._stake
    const next = LEVELS[LEVELS.indexOf(base) + 1]
    if (!next) return false // already at 12 (teto)

    this._pendingStake = next
    this._stakeCalledByTeam = player.teamIndex
    this._awaitingResponseFromTeam = player.teamIndex === 0 ? 1 : 0
    return true
  }

  respond(playerId: string, accept: boolean): boolean {
    if (this._awaitingResponseFromTeam === null) return false
    const player = this.players.find((p) => p.id === playerId)
    if (!player || player.teamIndex !== this._awaitingResponseFromTeam) return false

    if (accept) {
      this._stake = this._pendingStake!
      this._pendingStake = null
      this._awaitingResponseFromTeam = null
      return true
    }

    const winner = this._stakeCalledByTeam!
    const points = this._stake
    this._pendingStake = null
    this._awaitingResponseFromTeam = null
    this.endHand(winner, points, 'corri')
    return true
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  currentPlayerId(): string | undefined {
    return this.playerAtSeat(this._currentSeat)?.id
  }

  turnInfo(playerId: string): { canPlay: boolean; canCallTruco: boolean; canRespond: boolean } {
    const player = this.players.find((p) => p.id === playerId)
    if (!player || this._phase !== 'playing') return { canPlay: false, canCallTruco: false, canRespond: false }

    if (this._awaitingResponseFromTeam !== null) {
      const canRespond = player.teamIndex === this._awaitingResponseFromTeam
      // Can also raise directly instead of accept/decline, unless already at the 12 cap.
      const canCallTruco = canRespond && (this._pendingStake ?? this._stake) < 12
      return { canPlay: false, canCallTruco, canRespond }
    }

    const isTurn = player.seatIndex === this._currentSeat
    const canCallTruco = isTurn && player.teamIndex !== this._stakeCalledByTeam && this._stake < 12
    return { canPlay: isTurn, canCallTruco, canRespond: false }
  }

  isMatchOver(): boolean {
    return this._scores[0] >= 12 || this._scores[1] >= 12
  }

  matchResult(): TrucoMatchResult | null {
    if (this._scores[0] >= 12) return { winnerTeam: 0, scores: [...this._scores] as [number, number] }
    if (this._scores[1] >= 12) return { winnerTeam: 1, scores: [...this._scores] as [number, number] }
    return null
  }

  publicPlayers(): TrucoPlayer[] {
    return this.players.map(({ holeCards: _h, ...p }) => p)
  }

  /** Weakest card in a player's hand under the current manilha context — used for turn-timeout auto-play. */
  weakestCard(playerId: string): Card | undefined {
    const player = this.players.find((p) => p.id === playerId)
    if (!player || player.holeCards.length === 0) return undefined
    return [...player.holeCards].sort((a, b) => cardStrength(a, this.manilhaCtx) - cardStrength(b, this.manilhaCtx))[0]
  }
}
