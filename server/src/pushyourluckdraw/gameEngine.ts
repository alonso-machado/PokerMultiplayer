import type {
  PushYourLuckDrawCard, PushYourLuckDrawPhase, PushYourLuckDrawPlayer,
  PushYourLuckDrawPlayerStatus, PushYourLuckDrawRoomConfig, PushYourLuckDrawTableState,
} from '../../../shared/types'
import { buildDeck, isAceOfSpades, JOKERS_PER_PLAYER, rankPoints, shuffle } from './deck'

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
  /** previousHand is the round hand exactly as it stood right before being
   *  cleared — lets the UI show which card duplicated `card`. */
  | { kind: 'busted'; card: PushYourLuckDrawCard; previousHand: PushYourLuckDrawCard[] }
  /** Monte AND discard both ran dry mid-decision — treated as an automatic
   *  stop, never a forced bust. See .claude/PushYourLuckDraw.md → "Esgotamento do Monte". */
  | { kind: 'forced_stop' }

export interface PushYourLuckDrawMatchResult {
  winnerIds: string[]   // more than one entry only on a tie
}

/** What survives a disconnect for a possible rejoin — deliberately minimal
 *  (just the match-level score, not the in-progress round hand/saves) — see
 *  .claude/PushYourLuckDraw.md → "Desconexão". */
export interface PushYourLuckDrawDisconnectSnapshot {
  totalScore: number
  matchWins: number
}

/** Push Your Luck Draw — several rounds per match until someone's total hits
 *  the target score (like Truco's repeated hands), with free room joining
 *  and no fixed team size. See .claude/PushYourLuckDraw.md for the full
 *  rules this implements. */
export class PushYourLuckDrawGame {
  readonly config: PushYourLuckDrawRoomConfig
  players: GamePlayer[] = []
  private monte: PushYourLuckDrawCard[] = []
  private descarte: PushYourLuckDrawCard[] = []
  private phase: PushYourLuckDrawPhase = 'waiting'
  private currentSeat = 0
  private startSeat = -1   // rotates each round, mirrors Canastra's dealer rotation
  private halfCounter = 0  // unique id suffix for synthesized '@' halving cards
  private extraJokerSeq = 0   // unique id suffix for Jokers added by a mid-match join
  private matchStarted = false   // true once startMatch() has run at least once this match
  lastMatchResult: PushYourLuckDrawMatchResult | null = null

  constructor(config: PushYourLuckDrawRoomConfig) { this.config = config }

  get maxPlayers(): number { return this.config.maxPlayers }

  /** Before the deck is dealt, joining is just bookkeeping — startMatch()
   *  builds the deck from whoever is seated at that point anyway. Once the
   *  match is underway (family-friendly drop-in — see .claude/PushYourLuckDraw.md
   *  → "Entrar a Qualquer Momento"), a newcomer also tops up the live monte
   *  by JOKERS_PER_PLAYER — but only in `per_player` mode. In `fixed` mode
   *  the table always has the same FIXED_JOKER_COUNT regardless of who's
   *  seated, so joining never touches the deck. */
  addPlayer(id: string, name: string): void {
    const seatIndex = this.players.length
    this.players.push({
      id, name, seatIndex, status: 'waiting', roundHand: [], savesHeld: 0,
      roundScore: 0, totalScore: 0, matchWins: 0,
    })
    if (this.matchStarted && this.config.jokerMode === 'per_player') this.addJokersToDeck(JOKERS_PER_PLAYER)
  }

  /** Mirrors addPlayer() — trims JOKERS_PER_PLAYER Jokers back out of
   *  circulation on the way out (in `per_player` mode only; `fixed` mode
   *  never rescales), but only ever from the monte/discard, never from a
   *  still-seated player's banked `savesHeld` or an already-dealt round
   *  hand (see removeJokersFromDeck()). */
  removePlayer(id: string): void {
    this.players = this.players.filter((p) => p.id !== id)
    if (this.matchStarted && this.config.jokerMode === 'per_player') this.removeJokersFromDeck(JOKERS_PER_PLAYER)
  }

  /** A real disconnect (closed tab/app), not the explicit "Sair da mesa"
   *  action — the player is removed from the table like removePlayer()
   *  (same seat/Joker-rescale bookkeeping), but their match-level score is
   *  handed back to the caller (the Room) to hold onto in case the same
   *  identity rejoins later — see .claude/PushYourLuckDraw.md → "Desconexão".
   *  If it was their turn right now, the turn is advanced so the round
   *  isn't left waiting on someone who's gone; if removing them means
   *  nobody's left to act, the round is closed out same as any other
   *  action (see afterAction()/checkRoundEnd()). */
  disconnectPlayer(id: string): PushYourLuckDrawDisconnectSnapshot | null {
    const p = this.player(id)
    if (!p) return null
    const wasCurrentTurn = this.phase === 'playing' && this.isCurrent(id)
    const snapshot: PushYourLuckDrawDisconnectSnapshot = { totalScore: p.totalScore, matchWins: p.matchWins }
    this.removePlayer(id)
    if (this.phase === 'playing') {
      if (this.checkRoundEnd()) return snapshot
      if (wasCurrentTurn) this.advanceTurn()
    }
    return snapshot
  }

  /** Restores a score snapshot onto a player who just rejoined after a
   *  disconnect — addPlayer() always seats them fresh at 0, this overlays
   *  the preserved match-level totals on top. Deliberately does not restore
   *  roundHand/savesHeld/status — those are round-scoped and were dropped
   *  on disconnect, same as any other family-friendly drop-in. */
  restoreScore(id: string, snapshot: PushYourLuckDrawDisconnectSnapshot): void {
    const p = this.player(id)
    if (!p) return
    p.totalScore = snapshot.totalScore
    p.matchWins = snapshot.matchWins
  }

  /** Adds `count` fresh Jokers into the live monte, shuffled in — used when
   *  a player joins mid-match. */
  private addJokersToDeck(count: number): void {
    const extra: PushYourLuckDrawCard[] = []
    for (let i = 0; i < count; i++) {
      extra.push({ id: `joker-extra-${this.extraJokerSeq++}`, suit: null, rank: null, isJoker: true, isHalf: false })
    }
    this.monte = shuffle([...this.monte, ...extra])
  }

  /** Removes up to `count` Jokers from circulation — from the undrawn monte
   *  first, and only spills into the discard pile if the monte doesn't have
   *  enough to cover it. Never touches a player's `savesHeld` count or the
   *  cards already sitting in a round hand — those represent Jokers already
   *  "spent" by a real draw, not deck inventory. */
  private removeJokersFromDeck(count: number): void {
    let remaining = count
    const strip = (pile: PushYourLuckDrawCard[]): PushYourLuckDrawCard[] => {
      const kept: PushYourLuckDrawCard[] = []
      for (const c of pile) {
        if (remaining > 0 && c.isJoker) { remaining--; continue }
        kept.push(c)
      }
      return kept
    }
    this.monte = strip(this.monte)
    if (remaining > 0) this.descarte = strip(this.descarte)
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
      targetScore: this.config.targetScore,
    }
  }

  // ── Match / round lifecycle ──────────────────────────────────────────────

  /** Called once when the table starts, and again after every accepted
   *  rematch — always deals a completely fresh deck, sized per `jokerMode`
   *  (see .claude/PushYourLuckDraw.md → "Baralho"). A new match always
   *  resets the shared monte, even though rounds within the match never do
   *  (see startRound() below). */
  startMatch(): void {
    this.matchStarted = true
    for (const p of this.players) p.totalScore = 0
    this.monte = shuffle(buildDeck(this.players.length, this.config.jokerMode))
    this.descarte = []
    this.startSeat = -1
    this.startRound()
  }

  /** Deals the next round. The monte is never rebuilt mid-match — it just
   *  keeps going from wherever the previous round left it, reshuffling only
   *  once it runs dry (see reshuffleFromDiscard()). See
   *  .claude/PushYourLuckDraw.md → "Baralho". */
  startRound(): void {
    for (const p of this.players) this.descarte.push(...p.roundHand)
    for (const p of this.players) { p.status = 'active'; p.roundHand = []; p.savesHeld = 0; p.roundScore = 0 }

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
      const previousHand = p.roundHand
      this.descarte.push(...previousHand, card)
      p.roundHand = []
      p.roundScore = 0
      p.status = 'busted'
      this.afterAction()
      return { kind: 'busted', card, previousHand }
    }

    p.roundHand.push(card)
    // roundScore is intentionally NOT recomputed here — it stays 0 while
    // `active`, same as always. The live "if I stopped right now" preview is
    // a front-end-only computation off the (already public) roundHand — see
    // .claude/PushYourLuckDraw.md and PushYourLuckDrawTable.tsx.
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

  /** Turn action: spends 1 of the thrower's spare Jokers (the first Joker
   *  ever held is mandatory bust protection and can never be thrown — see
   *  .claude/PushYourLuckDraw.md → "Coringa") to drop an '@' halving marker
   *  into targetId's round hand. Only one '@' can land on a player per
   *  round — a second throw at an already-halved player is rejected, it
   *  doesn't stack. Consumes the thrower's turn like draw()/stop() do,
   *  but the thrower stays 'active' (only the turn advances). */
  throwJoker(fromId: string, targetId: string): boolean {
    if (this.phase !== 'playing' || !this.isCurrent(fromId)) return false
    if (fromId === targetId) return false
    const p = this.player(fromId)
    const target = this.player(targetId)
    if (!p || !target) return false
    if (p.savesHeld < 2) return false                    // 1 Joker must always stay in reserve
    if (target.status !== 'active') return false
    if (target.roundHand.some((c) => c.isHalf)) return false   // no double-halving

    p.savesHeld--
    target.roundHand.push({ id: `half-${this.halfCounter++}`, suit: null, rank: null, isJoker: false, isHalf: true })
    this.afterAction()
    return true
  }

  private resolveStop(p: GamePlayer): void {
    p.status = 'stood'
    p.roundScore = this.computeScore(p.roundHand)
  }

  /** Ace of Spades doubles first, then a thrown '@' halves the result
   *  (floored) — see .claude/PushYourLuckDraw.md → "Poder do Ás de Espadas"
   *  and "Coringa". A hand with both nets back to the plain sum. */
  private computeScore(hand: PushYourLuckDrawCard[]): number {
    const hasAce = hand.some(isAceOfSpades)
    const hasHalf = hand.some((c) => c.isHalf)
    const sum = hand.filter((c) => !isAceOfSpades(c) && !c.isHalf).reduce((s, c) => s + rankPoints(c.rank!), 0)
    const doubled = hasAce ? sum * 2 : sum
    return hasHalf ? Math.floor(doubled / 2) : doubled
  }

  /** Recycles the whole accumulated discard pile (every card discarded since
   *  the match started, across every round — see .claude/PushYourLuckDraw.md
   *  → "Esgotamento do Monte") into a fresh monte. */
  private reshuffleFromDiscard(): void {
    if (this.descarte.length === 0) return
    this.monte = shuffle(this.descarte)
    this.descarte = []
  }

  /** Common tail for every branch of draw()/stop()/throwJoker(): end the
   *  round once nobody is left to act, otherwise advance to the next
   *  active seat. */
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

  /** True once nobody is left to act this round — includes 'match_complete',
   *  since `checkRoundEnd()` jumps straight there on the round that also
   *  crosses the target score. A check for only 'round_complete' here would
   *  make the Room skip `finishRound()` (and therefore `finishMatch()` too)
   *  on exactly the round that wins the match — see .claude/PushYourLuckDraw.md. */
  isRoundComplete(): boolean { return this.phase === 'round_complete' || this.phase === 'match_complete' }
  isMatchOver(): boolean { return this.phase === 'match_complete' }

  recordMatchWin(winnerIds: string[]): void {
    if (winnerIds.length !== 1) return   // ties: nobody's matchWins increments, same convention as Canastra
    const p = this.player(winnerIds[0]!)
    if (p) p.matchWins++
  }

  matchWinsById(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const p of this.players) out[p.id] = p.matchWins
    return out
  }
}
