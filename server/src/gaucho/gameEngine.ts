import type {
  Card, GauchoCallLevel, GauchoEnvidoCallLevel, GauchoFlorCallLevel, GauchoPhase,
  GauchoPlayer, GauchoRoomConfig, GauchoTableState, GauchoVazaCard,
} from '../../../shared/types'
import { createDeck, shuffle, cardStrength, envidoValue, hasFlor, florValue, FIXED_MANILHAS } from './deck'

export interface GauchoGamePlayer extends GauchoPlayer {
  holeCards: Card[]   // shrinks as cards are played this hand
  dealtCards: Card[]  // the original 3 cards dealt — used for envido/flor math even after some are played
  hasFlor: boolean    // computed at deal — private; never sent to other clients
}

type HandEndReason = 'vazas' | 'corri' | 'mao_de_onze_run'

export interface GauchoHandResult {
  winnerTeam: 0 | 1 | null
  points: number
  reason: HandEndReason
}

export interface GauchoMatchResult {
  winnerTeam: 0 | 1
  scores: [number, number]
}

export interface GauchoEnvidoResult {
  winnerTeam: 0 | 1
  points: number
  reason: 'compared' | 'corri'
  values: Record<string, number>
}

export interface GauchoFlorResult {
  winnerTeam: 0 | 1
  points: number
  reason: 'uncontested' | 'compared' | 'corri'
  values: Record<string, number>
}

const TRUCO_LEVELS: GauchoCallLevel[] = [1, 2, 3, 4]
const ENVIDO_LEVELS: GauchoEnvidoCallLevel[] = ['envido', 'real_envido', 'falta_envido']
const ENVIDO_FIXED_POINTS: Record<'envido' | 'real_envido', number> = { envido: 2, real_envido: 5 }
const FLOR_LEVELS: GauchoFlorCallLevel[] = ['flor', 'contra_flor', 'contra_flor_e_o_resto']
const FLOR_FIXED_POINTS: Record<'flor' | 'contra_flor', number> = { flor: 3, contra_flor: 6 }

/**
 * Truco Gaúcho / Espanhol engine. See .claude/TrucoGaucho.md for the rules
 * this class implements — it links back to .claude/Truco.md for everything
 * that's identical to Truco Paulista/Mineiro (vaza structure, empate
 * cascade, mão de 11/ferro, match/revanche) and only documents what
 * actually differs (ranking, manilhas, truco ladder, Envido, Flor).
 *
 * Separate engine from `../truco/gameEngine.ts` — no shared runtime state.
 */
export class GauchoGame {
  players: GauchoGamePlayer[] = []
  private deck: Card[] = []
  private handCount = 0
  private _phase: GauchoPhase = 'waiting'
  private _vaza: 1 | 2 | 3 = 1
  private _vazaCardsPlayed: GauchoVazaCard[] = []
  private _vazaWinners: (0 | 1 | null)[] = []

  private _stake: GauchoCallLevel = 1
  private _pendingStake: GauchoCallLevel | null = null
  private _stakeCalledByTeam: 0 | 1 | null = null
  private _awaitingResponseFromTeam: 0 | 1 | null = null

  private _envidoStatus: 'available' | 'closed' = 'closed'
  private _envidoPendingCall: GauchoEnvidoCallLevel | null = null
  private _envidoCalledByTeam: 0 | 1 | null = null
  private _envidoAwaitingResponseFromTeam: 0 | 1 | null = null
  private _envidoStake = 0

  private _florStatus: 'available' | 'closed' = 'closed'
  private _florPendingCall: GauchoFlorCallLevel | null = null
  private _florCalledByTeam: 0 | 1 | null = null
  private _florAwaitingResponseFromTeam: 0 | 1 | null = null
  private _florStake = 0

  private _dealerSeat = -1
  private _leaderSeat = 0
  private _currentSeat = 0
  private _scores: [number, number] = [0, 0]
  private _maoDeOnzePendingTeams = new Set<0 | 1>()
  private _maoDeOnzeDecisions = new Map<0 | 1, boolean>()
  private _lastHandResult: GauchoHandResult | null = null
  private _lastEnvidoResult: GauchoEnvidoResult | null = null
  private _lastFlorResult: GauchoFlorResult | null = null

  constructor(private config: GauchoRoomConfig) {}

  get maxPlayers(): number {
    return this.config.mode === '1x1' ? 2 : 4
  }

  get tableState(): GauchoTableState {
    return {
      phase: this._phase,
      manilhaCards: [...FIXED_MANILHAS],
      vaza: this._vaza,
      vazaCardsPlayed: [...this._vazaCardsPlayed],
      vazaWinners: [...this._vazaWinners],
      stake: this._stake,
      pendingStake: this._pendingStake,
      stakeCalledByTeam: this._stakeCalledByTeam,
      awaitingResponseFromTeam: this._awaitingResponseFromTeam,
      envido: {
        status: this._envidoStatus,
        pendingCall: this._envidoPendingCall,
        calledByTeam: this._envidoCalledByTeam,
        awaitingResponseFromTeam: this._envidoAwaitingResponseFromTeam,
        stake: this._envidoStake,
      },
      flor: {
        status: this._florStatus,
        pendingCall: this._florPendingCall,
        calledByTeam: this._florCalledByTeam,
        awaitingResponseFromTeam: this._florAwaitingResponseFromTeam,
        stake: this._florStake,
      },
      dealerSeat: this._dealerSeat,
      leaderSeat: this._leaderSeat,
      currentSeat: this._currentSeat,
      scores: [...this._scores] as [number, number],
    }
  }

  get lastHandResult(): GauchoHandResult | null { return this._lastHandResult }
  get lastEnvidoResult(): GauchoEnvidoResult | null { return this._lastEnvidoResult }
  get lastFlorResult(): GauchoFlorResult | null { return this._lastFlorResult }

  // ── Player management ───────────────────────────────────────────────────

  addPlayer(id: string, name: string): void {
    const seat = this.nextSeat()
    const teamIndex = (this.config.mode === '1x1' ? seat : seat % 2) as 0 | 1
    this.players.push({
      id, name, seatIndex: seat, teamIndex,
      status: 'waiting', matchWins: 0, holeCards: [], dealtCards: [], hasFlor: false,
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

  private playerAtSeat(seat: number): GauchoGamePlayer | undefined {
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
    this._vaza = 1
    this._vazaCardsPlayed = []
    this._vazaWinners = []

    this._stake = 1
    this._pendingStake = null
    this._stakeCalledByTeam = null
    this._awaitingResponseFromTeam = null

    this._envidoPendingCall = null
    this._envidoCalledByTeam = null
    this._envidoAwaitingResponseFromTeam = null
    this._envidoStake = 0

    this._florPendingCall = null
    this._florCalledByTeam = null
    this._florAwaitingResponseFromTeam = null
    this._florStake = 0

    this._lastHandResult = null
    this._lastEnvidoResult = null
    this._lastFlorResult = null
    this._maoDeOnzePendingTeams.clear()
    this._maoDeOnzeDecisions.clear()

    this._dealerSeat = (this._dealerSeat + 1) % this.players.length
    this._leaderSeat = (this._dealerSeat + 1) % this.players.length

    for (const p of this.players) {
      const dealt = [this.deck.pop()!, this.deck.pop()!, this.deck.pop()!]
      p.holeCards = [...dealt]
      p.dealtCards = dealt
      p.hasFlor = hasFlor(dealt)
      p.status = 'active'
    }

    // "Flor corta o envido" — see .claude/TrucoGaucho.md → "Flor".
    const anyFlor = this.players.some((p) => p.hasFlor)
    this._florStatus = anyFlor ? 'available' : 'closed'
    this._envidoStatus = anyFlor ? 'closed' : 'available'

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
    if (this._phase !== 'playing') return false
    if (this._awaitingResponseFromTeam !== null) return false
    if (this._envidoAwaitingResponseFromTeam !== null) return false
    if (this._florAwaitingResponseFromTeam !== null) return false
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
    const strengths = this._vazaCardsPlayed.map((vc) => ({ ...vc, strength: cardStrength(vc.card) }))
    const maxStrength = Math.max(...strengths.map((s) => s.strength))
    const maxPlayers = strengths.filter((s) => s.strength === maxStrength)
    const teams = new Set(maxPlayers.map((mp) => this.teamOf(mp.playerId)))

    let winnerTeam: 0 | 1 | null = null
    if (teams.size === 1) {
      winnerTeam = [...teams][0]!
      this._leaderSeat = this.players.find((p) => p.id === maxPlayers[0]!.playerId)!.seatIndex
    }
    this._vazaWinners.push(winnerTeam)

    // Vaza 1 just resolved — Envido/Flor windows close if nobody opened them.
    if (this._vaza === 1) {
      if (this._envidoStatus === 'available') this._envidoStatus = 'closed'
      if (this._florStatus === 'available') this._florStatus = 'closed'
    }

    const over = this.checkHandOver()
    if (over.over) {
      this.endHand(over.winnerTeam, this._stake, 'vazas')
      return
    }

    this._vaza = (this._vaza + 1) as 1 | 2 | 3
    this._vazaCardsPlayed = []
    this._currentSeat = this._leaderSeat
  }

  /** Tie-break table — see .claude/Truco.md → "Empate de vaza" (reused as-is). */
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

  private faltaValue(): number {
    return Math.max(1, 12 - Math.max(this._scores[0], this._scores[1]))
  }

  // ── Truco escalation ─────────────────────────────────────────────────────

  callTruco(playerId: string): boolean {
    if (this._phase !== 'playing') return false
    if (this._envidoAwaitingResponseFromTeam !== null) return false
    if (this._florAwaitingResponseFromTeam !== null) return false
    const player = this.players.find((p) => p.id === playerId)
    if (!player) return false

    if (this._awaitingResponseFromTeam !== null) {
      if (player.teamIndex !== this._awaitingResponseFromTeam) return false
    } else {
      if (player.seatIndex !== this._currentSeat) return false
      if (player.teamIndex === this._stakeCalledByTeam) return false
    }

    const base = this._pendingStake ?? this._stake
    const next = TRUCO_LEVELS[TRUCO_LEVELS.indexOf(base) + 1]
    if (!next) return false // already at 4 (vale quatro, teto)

    this._pendingStake = next
    this._stakeCalledByTeam = player.teamIndex
    this._awaitingResponseFromTeam = player.teamIndex === 0 ? 1 : 0

    // "Truco corta envido/flor" — see .claude/TrucoGaucho.md.
    if (this._envidoStatus === 'available') this._envidoStatus = 'closed'
    if (this._florStatus === 'available') this._florStatus = 'closed'
    return true
  }

  respondTruco(playerId: string, accept: boolean): boolean {
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

  // ── Envido ───────────────────────────────────────────────────────────────

  private nextEnvidoLevel(): GauchoEnvidoCallLevel | undefined {
    const idx = this._envidoPendingCall ? ENVIDO_LEVELS.indexOf(this._envidoPendingCall) + 1 : 0
    return ENVIDO_LEVELS[idx]
  }

  private envidoLevelPoints(level: GauchoEnvidoCallLevel): number {
    return level === 'falta_envido' ? this.faltaValue() : ENVIDO_FIXED_POINTS[level]
  }

  callEnvido(playerId: string): boolean {
    if (this._phase !== 'playing' || this._vaza !== 1) return false
    if (this._envidoStatus !== 'available') return false
    if (this._awaitingResponseFromTeam !== null || this._florAwaitingResponseFromTeam !== null) return false
    const player = this.players.find((p) => p.id === playerId)
    if (!player) return false

    if (this._envidoAwaitingResponseFromTeam !== null) {
      if (player.teamIndex !== this._envidoAwaitingResponseFromTeam) return false
    } else {
      if (player.seatIndex !== this._currentSeat) return false
      if (player.teamIndex === this._envidoCalledByTeam) return false
    }

    const next = this.nextEnvidoLevel()
    if (!next) return false // already at falta_envido (teto)

    this._envidoPendingCall = next
    this._envidoCalledByTeam = player.teamIndex
    this._envidoAwaitingResponseFromTeam = player.teamIndex === 0 ? 1 : 0
    return true
  }

  respondEnvido(playerId: string, accept: boolean): boolean {
    if (this._envidoAwaitingResponseFromTeam === null) return false
    const player = this.players.find((p) => p.id === playerId)
    if (!player || player.teamIndex !== this._envidoAwaitingResponseFromTeam) return false

    if (!accept) {
      const winnerTeam = this._envidoCalledByTeam!
      const points = this._envidoStake > 0 ? this._envidoStake : 1
      this._envidoPendingCall = null
      this._envidoAwaitingResponseFromTeam = null
      this._envidoStatus = 'closed'
      this._scores[winnerTeam] += points
      this._lastEnvidoResult = { winnerTeam, points, reason: 'corri', values: {} }
      return true
    }

    const points = this.envidoLevelPoints(this._envidoPendingCall!)
    const values: Record<string, number> = {}
    for (const p of this.players) values[p.id] = envidoValue(p.dealtCards)
    const winnerTeam = this.winnerFromValues(values)

    this._envidoStake = points
    this._envidoPendingCall = null
    this._envidoAwaitingResponseFromTeam = null
    this._envidoStatus = 'closed'
    this._scores[winnerTeam] += points
    this._lastEnvidoResult = { winnerTeam, points, reason: 'compared', values }
    return true
  }

  // ── Flor ─────────────────────────────────────────────────────────────────

  private nextFlorLevel(): GauchoFlorCallLevel | undefined {
    const idx = this._florPendingCall ? FLOR_LEVELS.indexOf(this._florPendingCall) + 1 : 0
    return FLOR_LEVELS[idx]
  }

  private florLevelPoints(level: GauchoFlorCallLevel): number {
    return level === 'contra_flor_e_o_resto' ? this.faltaValue() : FLOR_FIXED_POINTS[level]
  }

  callFlor(playerId: string): boolean {
    if (this._phase !== 'playing' || this._vaza !== 1) return false
    if (this._florStatus !== 'available') return false
    if (this._awaitingResponseFromTeam !== null || this._envidoAwaitingResponseFromTeam !== null) return false
    const player = this.players.find((p) => p.id === playerId)
    if (!player || !player.hasFlor) return false

    if (this._florAwaitingResponseFromTeam !== null) {
      if (player.teamIndex !== this._florAwaitingResponseFromTeam) return false
    } else {
      if (player.seatIndex !== this._currentSeat) return false
      if (player.teamIndex === this._florCalledByTeam) return false
    }

    // Opening call and nobody on the other team has flor to contest it —
    // auto-scores uncontested, no response window needed.
    if (!this._florPendingCall) {
      const opposingHasFlor = this.players.some((p) => p.teamIndex !== player.teamIndex && p.hasFlor)
      if (!opposingHasFlor) {
        const points = FLOR_FIXED_POINTS.flor
        this._scores[player.teamIndex] += points
        this._florStatus = 'closed'
        this._lastFlorResult = {
          winnerTeam: player.teamIndex, points, reason: 'uncontested',
          values: { [playerId]: florValue(player.dealtCards) },
        }
        return true
      }
    }

    const next = this.nextFlorLevel()
    if (!next) return false // already at contra_flor_e_o_resto (teto)

    this._florPendingCall = next
    this._florCalledByTeam = player.teamIndex
    this._florAwaitingResponseFromTeam = player.teamIndex === 0 ? 1 : 0
    return true
  }

  respondFlor(playerId: string, accept: boolean): boolean {
    if (this._florAwaitingResponseFromTeam === null) return false
    const player = this.players.find((p) => p.id === playerId)
    if (!player || player.teamIndex !== this._florAwaitingResponseFromTeam) return false

    if (!accept) {
      const winnerTeam = this._florCalledByTeam!
      const points = this._florStake > 0 ? this._florStake : 1
      this._florPendingCall = null
      this._florAwaitingResponseFromTeam = null
      this._florStatus = 'closed'
      this._scores[winnerTeam] += points
      this._lastFlorResult = { winnerTeam, points, reason: 'corri', values: {} }
      return true
    }

    const points = this.florLevelPoints(this._florPendingCall!)
    const values: Record<string, number> = {}
    for (const p of this.players) if (p.hasFlor) values[p.id] = florValue(p.dealtCards)
    const winnerTeam = this.winnerFromValues(values)

    this._florStake = points
    this._florPendingCall = null
    this._florAwaitingResponseFromTeam = null
    this._florStatus = 'closed'
    this._scores[winnerTeam] += points
    this._lastFlorResult = { winnerTeam, points, reason: 'compared', values }
    return true
  }

  /** Highest value per team wins; ties go to the team holding "a mão"
   *  (leaderSeat) — see .claude/TrucoGaucho.md → "Envido". Shared by
   *  Envido and Flor comparison (both use the same tie rule). */
  private winnerFromValues(values: Record<string, number>): 0 | 1 {
    let best0 = -Infinity
    let best1 = -Infinity
    for (const [pid, v] of Object.entries(values)) {
      if (this.teamOf(pid) === 0) best0 = Math.max(best0, v)
      else best1 = Math.max(best1, v)
    }
    if (best0 === best1) return this.playerAtSeat(this._leaderSeat)!.teamIndex
    return best0 > best1 ? 0 : 1
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  currentPlayerId(): string | undefined {
    return this.playerAtSeat(this._currentSeat)?.id
  }

  turnInfo(playerId: string): {
    canPlay: boolean
    canCallTruco: boolean; canRespondTruco: boolean
    canCallEnvido: boolean; canRespondEnvido: boolean
    canCallFlor: boolean; canRespondFlor: boolean
  } {
    const none = {
      canPlay: false, canCallTruco: false, canRespondTruco: false,
      canCallEnvido: false, canRespondEnvido: false, canCallFlor: false, canRespondFlor: false,
    }
    const player = this.players.find((p) => p.id === playerId)
    if (!player || this._phase !== 'playing') return none

    const canRespondTruco = this._awaitingResponseFromTeam !== null && player.teamIndex === this._awaitingResponseFromTeam
    const canRespondEnvido = this._envidoAwaitingResponseFromTeam !== null && player.teamIndex === this._envidoAwaitingResponseFromTeam
    const canRespondFlor = this._florAwaitingResponseFromTeam !== null && player.teamIndex === this._florAwaitingResponseFromTeam && player.hasFlor

    if (this._awaitingResponseFromTeam !== null || this._envidoAwaitingResponseFromTeam !== null || this._florAwaitingResponseFromTeam !== null) {
      return {
        canPlay: false,
        canCallTruco: canRespondTruco && (this._pendingStake ?? this._stake) < 4,
        canRespondTruco,
        canCallEnvido: canRespondEnvido && this.nextEnvidoLevel() !== undefined,
        canRespondEnvido,
        canCallFlor: canRespondFlor && this.nextFlorLevel() !== undefined,
        canRespondFlor,
      }
    }

    const isTurn = player.seatIndex === this._currentSeat
    return {
      canPlay: isTurn,
      canCallTruco: isTurn && player.teamIndex !== this._stakeCalledByTeam && this._stake < 4,
      canRespondTruco: false,
      canCallEnvido: isTurn && this._envidoStatus === 'available' && player.teamIndex !== this._envidoCalledByTeam,
      canRespondEnvido: false,
      canCallFlor: isTurn && this._florStatus === 'available' && player.hasFlor && player.teamIndex !== this._florCalledByTeam,
      canRespondFlor: false,
    }
  }

  isMatchOver(): boolean {
    return this._scores[0] >= 12 || this._scores[1] >= 12
  }

  matchResult(): GauchoMatchResult | null {
    if (this._scores[0] >= 12) return { winnerTeam: 0, scores: [...this._scores] as [number, number] }
    if (this._scores[1] >= 12) return { winnerTeam: 1, scores: [...this._scores] as [number, number] }
    return null
  }

  publicPlayers(): GauchoPlayer[] {
    return this.players.map(({ holeCards: _h, dealtCards: _d, hasFlor: _f, ...p }) => p)
  }

  /** Weakest card in a player's hand — used for turn-timeout auto-play. */
  weakestCard(playerId: string): Card | undefined {
    const player = this.players.find((p) => p.id === playerId)
    if (!player || player.holeCards.length === 0) return undefined
    return [...player.holeCards].sort((a, b) => cardStrength(a) - cardStrength(b))[0]
  }
}
