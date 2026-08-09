import type {
  PushYourLuckDrawCard, PushYourLuckDrawPhase, PushYourLuckDrawPlayer,
  PushYourLuckDrawPlayerStatus, PushYourLuckDrawRoomConfig, PushYourLuckDrawTableState,
} from '../../../shared/types'
import { buildDeck, isAceOfSpades, rankPoints, shuffle } from './deck'

interface GamePlayer {
  id: string
  name: string
  seatIndex: number
  status: PushYourLuckDrawPlayerStatus
  roundHand: PushYourLuckDrawCard[]
  savesHeld: number
  roundScore: number
  totalScore: number
  matchWins: number
}

export type PushYourLuckDrawDrawOutcome =
  | { kind: 'drew'; card: PushYourLuckDrawCard }
  | { kind: 'joker'; card: PushYourLuckDrawCard }
  | { kind: 'saved'; card: PushYourLuckDrawCard }
  | { kind: 'busted'; card: PushYourLuckDrawCard }
  /** Monte AND discard both ran dry mid-decision — treated as an automatic
   *  stop, never a forced bust. See .claude/PushYourLuckDraw.md → "Esgotamento do Monte". */
  | { kind: 'forced_stop' }

export interface PushYourLuckDrawMatchResult {
  winnerIds: string[]   // more than one entry only on a tie
}

/** Push Your Luck Draw — several rounds per match until someone's total hits
 *  the target score (like Truco's repeated hands), with free room joining
 *  and no fixed team size (like Go Fish). See .claude/PushYourLuckDraw.md
 *  for the full rules this implements. */
export class PushYourLuckDrawGame {
  readonly config: PushYourLuckDrawRoomConfig
  players: GamePlayer[] = []
  private monte: PushYourLuckDrawCard[] = []
  private descarte: PushYourLuckDrawCard[] = []
  private phase: PushYourLuckDrawPhase = 'waiting'
  private currentSeat = 0
  private startSeat = -1   // rotates each round, mirrors Canastra/Go Fish's dealer rotation
  lastMatchResult: PushYourLuckDrawMatchResult | null = null

  constructor(config: PushYourLuckDrawRoomConfig) { this.config = config }

  get maxPlayers(): number { return this.config.maxPlayers }

  addPlayer(id: string, name: string): void {
    const seatIndex = this.players.length
    this.players.push({
      id, name, seatIndex, status: 'waiting', roundHand: [], savesHeld: 0,
      roundScore: 0, totalScore: 0, matchWins: 0,
    })
  }

  removePlayer(id: string): void {
    this.players = this.players.filter((p) => p.id !== id)
  }

  publicPlayers(): PushYourLuckDrawPlayer[] {
    return this.players.map((p) => ({
      id: p.id, name: p.name, status: p.status, roundHand: p.roundHand,
      savesHeld: p.savesHeld, roundScore: p.roundScore, totalScore: p.totalScore,
    }))
  }

  private player(id: string): GamePlayer | undefined { return this.players.find((p) => p.id === id) }
  private seatedPlayer(seat: number): GamePlayer | undefined { return this.players.find((p) => p.seatIndex === seat) }
  private currentPlayer(): GamePlayer | undefined { return this.seatedPlayer(this.currentSeat) }
  private isCurrent(id: string): boolean { return this.currentPlayer()?.id === id }
  currentPlayerId(): string | null { return this.phase === 'playing' ? (this.currentPlayer()?.id ?? null) : null }

  get tableState(): PushYourLuckDrawTableState {
    return {
      phase: this.phase, turnPlayerId: this.currentPlayerId(), monteCount: this.monte.length,
      targetScore: this.config.targetScore, deckMode: this.config.deckMode,
    }
  }

  // ── Match / round lifecycle ──────────────────────────────────────────────

  /** Called once when the table starts, and again after every accepted
   *  rematch — always deals a completely fresh 95-card deck regardless of
   *  deckMode (a new match resets the shared monte either way — see
   *  .claude/PushYourLuckDraw.md → "Modo de Baralho"). */
  startMatch(): void {
    for (const p of this.players) p.totalScore = 0
    this.monte = shuffle(buildDeck())
    this.descarte = []
    this.startSeat = -1
    this.startRound()
  }

  /** Deals the next round. In `persistent` mode this reuses whatever monte is
   *  left over from the previous round instead of rebuilding it — see
   *  .claude/PushYourLuckDraw.md → "Modo de Baralho". */
  startRound(): void {
    if (this.config.deckMode === 'persistent') {
      for (const p of this.players) this.descarte.push(...p.roundHand)
    }
    for (const p of this.players) { p.status = 'active'; p.roundHand = []; p.savesHeld = 0; p.roundScore = 0 }

    if (this.config.deckMode === 'fresh') {
      this.monte = shuffle(buildDeck())
      this.descarte = []
    }

    // Modulo the actual seated count, not `maxPlayers` — mirrors Go Fish gap #3.
    this.startSeat = (this.startSeat + 1) % this.players.length
    this.phase = 'playing'
    this.currentSeat = this.startSeat
  }

  // ── Turn actions ──────────────────────────────────────────────────────────

  draw(id: string): PushYourLuckDrawDrawOutcome | null {
    if (this.phase !== 'playing' || !this.isCurrent(id)) return null
    const p = this.player(id)
    if (!p) return null

    if (this.monte.length === 0) this.reshuffleFromDiscard()
    if (this.monte.length === 0) {
      this.resolveStop(p)
      this.afterAction()
      return { kind: 'forced_stop' }
    }

    const card = this.monte.pop()!

    if (card.isJoker) {
      p.savesHeld++
      this.descarte.push(card)
      this.afterAction()
      return { kind: 'joker', card }
    }

    const isDuplicate = p.roundHand.some((c) => c.rank === card.rank)
    if (isDuplicate) {
      if (p.savesHeld > 0) {
        p.savesHeld--
        this.descarte.push(card)   // the duplicate itself never enters the hand
        this.afterAction()
        return { kind: 'saved', card }
      }
      // Bust — the whole round hand, plus the card that busted it, is lost to the discard.
      this.descarte.push(...p.roundHand, card)
      p.roundHand = []
      p.roundScore = 0
      p.status = 'busted'
      this.afterAction()
      return { kind: 'busted', card }
    }

    p.roundHand.push(card)
    this.afterAction()
    return { kind: 'drew', card }
  }

  stop(id: string): boolean {
    if (this.phase !== 'playing' || !this.isCurrent(id)) return false
    const p = this.player(id)
    if (!p) return false
    this.resolveStop(p)
    this.afterAction()
    return true
  }

  private resolveStop(p: GamePlayer): void {
    p.status = 'stood'
    p.roundScore = this.computeScore(p.roundHand)
  }

  private computeScore(hand: PushYourLuckDrawCard[]): number {
    const hasAce = hand.some(isAceOfSpades)
    const sum = hand.filter((c) => !isAceOfSpades(c)).reduce((s, c) => s + rankPoints(c.rank!), 0)
    return hasAce ? sum * 2 : sum
  }

  /** Recycles the whole accumulated discard pile into a fresh monte — in
   *  `fresh` mode that's just this round's busted cards; in `persistent`
   *  mode it's every card discarded since the match started (see
   *  .claude/PushYourLuckDraw.md → "Esgotamento do Monte"). */
  private reshuffleFromDiscard(): void {
    if (this.descarte.length === 0) return
    this.monte = shuffle(this.descarte)
    this.descarte = []
  }

  /** Common tail for every branch of draw()/stop(): end the round once
   *  nobody is left to act, otherwise advance to the next active seat. */
  private afterAction(): void {
    if (this.checkRoundEnd()) return
    this.advanceTurn()
  }

  private advanceTurn(): void {
    const order = this.players.map((p) => p.seatIndex).sort((a, b) => a - b)
    const idx = order.indexOf(this.currentSeat)
    for (let step = 1; step <= order.length; step++) {
      const seat = order[(idx + step) % order.length]!
      const p = this.seatedPlayer(seat)
      if (p && p.status === 'active') { this.currentSeat = seat; return }
    }
  }

  /** Round ends once nobody is left with `status === 'active'`. Totals are
   *  folded in right here, and a match win is declared if the target score
   *  was reached. Ties are possible (no tiebreaker in the original rule —
   *  see .claude/PushYourLuckDraw.md). */
  private checkRoundEnd(): boolean {
    if (this.players.some((p) => p.status === 'active')) return false
    for (const p of this.players) p.totalScore += p.roundScore
    this.phase = 'round_complete'

    const maxTotal = Math.max(0, ...this.players.map((p) => p.totalScore))
    if (maxTotal >= this.config.targetScore) {
      this.phase = 'match_complete'
      const winnerIds = this.players.filter((p) => p.totalScore === maxTotal).map((p) => p.id)
      this.lastMatchResult = { winnerIds }
    }
    return true
  }

  isRoundComplete(): boolean { return this.phase === 'round_complete' }
  isMatchOver(): boolean { return this.phase === 'match_complete' }

  recordMatchWin(winnerIds: string[]): void {
    if (winnerIds.length !== 1) return   // ties: nobody's matchWins increments, same convention as Go Fish/Canastra
    const p = this.player(winnerIds[0]!)
    if (p) p.matchWins++
  }

  matchWinsById(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const p of this.players) out[p.id] = p.matchWins
    return out
  }
}
