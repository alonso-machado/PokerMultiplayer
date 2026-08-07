import type {
  BlackjackHand, BlackjackPlayer, BlackjackTableState,
} from '../../../shared/types'
import { BLACKJACK_MAX_PLAYERS, BLACKJACK_STARTING_CHIPS } from '../../../shared/types'
import type { Card } from '../../../shared/types'
import { createDeck, shuffle, handValue, isBust, isBlackjack } from './deck'

// GamePlayer/GameHand are identical in shape to the public BlackjackPlayer/
// BlackjackHand types — unlike Canastra (where hand cards are private and
// the public shape only exposes handCount), Blackjack has nothing to hide
// except the dealer's hole card, so the internal and public shapes match.
type GameHand = BlackjackHand
type GamePlayer = BlackjackPlayer

function emptyHand(bet: number): GameHand {
  return {
    cards: [], bet, isDoubled: false, isSplitAces: false,
    isBusted: false, isBlackjack: false, isStood: false, outcome: null, payout: 0,
  }
}

type ActionKind = 'hit' | 'stand' | 'double' | 'split'

/** Blackjack / 21 — player(s) vs. a shared dealer hand, continuous rounds
 *  (no team/points match like Truco, no single-hand-then-rematch-vote like
 *  Canastra). See .claude/Blackjack.md for the full rules this implements. */
export class BlackjackGame {
  players: GamePlayer[] = []
  private deck: Card[] = []
  private dealerCards: Card[] = []
  private dealerHoleHidden = true
  private phase: BlackjackTableState['phase'] = 'waiting'
  private currentSeat: number | null = null
  private currentHandIndex: number | null = null
  private pendingBets = new Map<string, number>()
  private insuranceDecided = new Set<string>()

  get maxPlayers(): number { return BLACKJACK_MAX_PLAYERS }

  addPlayer(id: string, name: string): void {
    const used = new Set(this.players.map((p) => p.seatIndex))
    let seat = 0
    while (used.has(seat)) seat++
    this.players.push({ id, name, seatIndex: seat, chips: BLACKJACK_STARTING_CHIPS, status: 'waiting', hands: [], insuranceBet: 0 })
  }

  removePlayer(id: string): void {
    this.players = this.players.filter((p) => p.id !== id)
    this.pendingBets.delete(id)
    this.insuranceDecided.delete(id)
  }

  publicPlayers(): BlackjackPlayer[] { return this.players }

  private player(id: string): GamePlayer | undefined { return this.players.find((p) => p.id === id) }
  private currentPlayer(): GamePlayer | undefined {
    return this.currentSeat === null ? undefined : this.players.find((p) => p.seatIndex === this.currentSeat)
  }
  currentPlayerId(): string | null { return this.currentPlayer()?.id ?? null }

  get tableState(): BlackjackTableState {
    return {
      phase: this.phase,
      dealer: {
        cards: this.dealerHoleHidden ? this.dealerCards.slice(0, 1) : this.dealerCards,
        holeHidden: this.dealerHoleHidden,
        isBusted: this.dealerHoleHidden ? false : isBust(this.dealerCards),
        isBlackjack: this.dealerHoleHidden ? false : isBlackjack(this.dealerCards),
      },
      currentSeat: this.currentSeat,
      currentHandIndex: this.currentHandIndex,
    }
  }

  private draw(): Card {
    // Defensive fallback only — 52 cards comfortably covers 7 players even
    // with splits/hits in normal play; this just prevents a crash in a
    // pathological worst case rather than being part of the actual rules.
    if (this.deck.length === 0) this.deck = shuffle(createDeck())
    return this.deck.pop()!
  }

  // ── Betting ─────────────────────────────────────────────────────────────

  openBetting(): void {
    for (const p of this.players) { p.hands = []; p.insuranceBet = 0; p.status = 'waiting' }
    this.dealerCards = []
    this.dealerHoleHidden = true
    this.currentSeat = null
    this.currentHandIndex = null
    this.pendingBets.clear()
    this.insuranceDecided.clear()
    this.phase = 'betting'
  }

  placeBet(id: string, amount: number): boolean {
    if (this.phase !== 'betting') return false
    if (this.pendingBets.has(id)) return false // one bet per round — no re-betting/adjusting once placed
    const p = this.player(id)
    if (!p) return false
    if (!Number.isInteger(amount) || amount < 1 || amount > p.chips) return false
    p.chips -= amount
    this.pendingBets.set(id, amount)
    p.status = 'active'
    return true
  }

  hasBettors(): boolean { return this.pendingBets.size > 0 }
  allPlayersBet(): boolean { return this.players.length > 0 && this.players.every((p) => this.pendingBets.has(p.id)) }

  /** Deals the round to everyone who bet — call once the betting window
   *  closes (all bet, or the shared timer expired). No-op if nobody bet;
   *  caller should check hasBettors() first and just reopen betting instead. */
  dealRound(): void {
    if (this.phase !== 'betting' || !this.hasBettors()) return
    this.deck = shuffle(createDeck())
    const bettors = this.players.filter((p) => this.pendingBets.has(p.id)).sort((a, b) => a.seatIndex - b.seatIndex)
    for (const p of bettors) p.hands = [emptyHand(this.pendingBets.get(p.id)!)]
    this.pendingBets.clear()

    for (const p of bettors) p.hands[0]!.cards.push(this.draw())
    for (const p of bettors) p.hands[0]!.cards.push(this.draw())
    this.dealerCards = [this.draw(), this.draw()]
    this.dealerHoleHidden = true

    for (const p of bettors) {
      const h = p.hands[0]!
      h.isBlackjack = isBlackjack(h.cards)
      if (h.isBlackjack) h.isStood = true // already resolved at showdown — skip it in the turn order
    }

    const upCard = this.dealerCards[0]!
    const upIsAce = upCard.rank === 'A'
    const upIsTen = upCard.rank === '10' || upCard.rank === 'J' || upCard.rank === 'Q' || upCard.rank === 'K'

    if (upIsAce) { this.phase = 'insurance'; return }
    if (upIsTen) { this.resolvePeek(); return }
    this.beginPlayerTurns()
  }

  // ── Insurance ───────────────────────────────────────────────────────────

  placeInsurance(id: string, amount: number): boolean {
    if (this.phase !== 'insurance') return false
    const p = this.player(id)
    if (!p || p.hands.length === 0) return false
    const maxAmount = Math.floor(p.hands[0]!.bet / 2)
    if (!Number.isInteger(amount) || amount < 0 || amount > maxAmount || amount > p.chips) return false
    p.chips -= amount
    p.insuranceBet = amount
    this.insuranceDecided.add(id)
    return true
  }

  allInsuranceDecided(): boolean {
    const eligible = this.players.filter((p) => p.hands.length > 0)
    return eligible.every((p) => this.insuranceDecided.has(p.id))
  }

  /** Reveals whether the dealer has blackjack — called once the insurance
   *  window closes (Ace up-card case), or immediately for a 10-value
   *  up-card (no insurance offered, but the peek still happens). If the
   *  dealer has blackjack, every hand resolves right here with no player
   *  turns. See .claude/Blackjack.md → "Dealer — espiada". */
  resolvePeek(): void {
    const bettors = this.players.filter((p) => p.hands.length > 0).sort((a, b) => a.seatIndex - b.seatIndex)
    if (isBlackjack(this.dealerCards)) {
      this.dealerHoleHidden = false
      for (const p of bettors) {
        if (p.insuranceBet > 0) p.chips += p.insuranceBet * 3 // 2:1 payout + the stake back
        const h = p.hands[0]!
        if (h.isBlackjack) { h.outcome = 'push'; h.payout = h.bet; p.chips += h.bet }
        else { h.outcome = 'lose'; h.payout = 0 }
      }
      this.phase = 'round_end'
    } else {
      this.beginPlayerTurns()
    }
  }

  // ── Player turns ────────────────────────────────────────────────────────

  private beginPlayerTurns(): void {
    this.phase = 'player_turns'
    this.currentSeat = null
    this.currentHandIndex = null
    this.advanceTurn()
  }

  /** Finds the next hand needing a decision, scanning forward from
   *  (afterSeat, afterHandIndex) in ascending seat order. A player's hands
   *  are only ever appended to (via split), never reordered, so a single
   *  forward pass per call is enough — no wraparound needed within a round. */
  private nextActionable(afterSeat: number | null, afterHandIndex: number | null): { seat: number; handIndex: number } | null {
    const order = this.players.filter((p) => p.hands.length > 0).sort((a, b) => a.seatIndex - b.seatIndex)
    let started = afterSeat === null
    for (const p of order) {
      for (let hi = 0; hi < p.hands.length; hi++) {
        if (!started) {
          if (p.seatIndex === afterSeat && hi === afterHandIndex) started = true
          continue
        }
        const h = p.hands[hi]!
        if (!h.isStood && !h.isBusted) return { seat: p.seatIndex, handIndex: hi }
      }
    }
    return null
  }

  private advanceTurn(): void {
    const next = this.nextActionable(this.currentSeat, this.currentHandIndex)
    if (!next) { this.currentSeat = null; this.currentHandIndex = null; this.playDealerAndResolve(); return }
    this.currentSeat = next.seat
    this.currentHandIndex = next.handIndex
  }

  private currentHand(id: string): { p: GamePlayer; h: GameHand } | null {
    if (this.phase !== 'player_turns') return null
    const p = this.player(id)
    if (!p || p.seatIndex !== this.currentSeat || this.currentHandIndex === null) return null
    const h = p.hands[this.currentHandIndex]
    if (!h) return null
    return { p, h }
  }

  hit(id: string): boolean {
    const cur = this.currentHand(id)
    if (!cur) return false
    const { h } = cur
    if (h.isStood || h.isBusted) return false
    h.cards.push(this.draw())
    if (handValue(h.cards).total > 21) { h.isBusted = true; this.advanceTurn() }
    return true
  }

  stand(id: string): boolean {
    const cur = this.currentHand(id)
    if (!cur) return false
    const { h } = cur
    if (h.isStood || h.isBusted) return false
    h.isStood = true
    this.advanceTurn()
    return true
  }

  double(id: string): boolean {
    const cur = this.currentHand(id)
    if (!cur) return false
    const { p, h } = cur
    if (h.cards.length !== 2 || h.isDoubled || h.isSplitAces) return false
    if (p.chips < h.bet) return false
    p.chips -= h.bet
    h.bet *= 2
    h.isDoubled = true
    h.cards.push(this.draw())
    if (handValue(h.cards).total > 21) h.isBusted = true
    h.isStood = true
    this.advanceTurn()
    return true
  }

  /** One split per hand — no resplitting (see .claude/Blackjack.md → "Split"). */
  split(id: string): boolean {
    const cur = this.currentHand(id)
    if (!cur) return false
    const { p, h } = cur
    if (p.hands.length !== 1) return false
    if (h.cards.length !== 2 || h.cards[0]!.rank !== h.cards[1]!.rank) return false
    if (p.chips < h.bet) return false
    const isAces = h.cards[0]!.rank === 'A'
    const bet = h.bet
    p.chips -= bet
    const hand0: GameHand = { cards: [h.cards[0]!], bet, isDoubled: false, isSplitAces: isAces, isBusted: false, isBlackjack: false, isStood: false, outcome: null, payout: 0 }
    const hand1: GameHand = { cards: [h.cards[1]!], bet, isDoubled: false, isSplitAces: isAces, isBusted: false, isBlackjack: false, isStood: false, outcome: null, payout: 0 }
    p.hands = [hand0, hand1]
    hand0.cards.push(this.draw())
    hand1.cards.push(this.draw())
    this.currentHandIndex = 0
    if (isAces) {
      // Split aces get exactly one more card each and stand automatically — no further hit/double.
      hand0.isStood = true
      hand1.isStood = true
      this.advanceTurn()
    }
    return true
  }

  turnInfo(id: string): { isMyTurn: boolean; validActions: ActionKind[] } {
    const cur = this.currentHand(id)
    if (!cur) return { isMyTurn: false, validActions: [] }
    const { p, h } = cur
    const actions: ActionKind[] = ['hit', 'stand']
    if (h.cards.length === 2 && !h.isDoubled && !h.isSplitAces && p.chips >= h.bet) actions.push('double')
    if (h.cards.length === 2 && p.hands.length === 1 && h.cards[0]!.rank === h.cards[1]!.rank && p.chips >= h.bet) actions.push('split')
    return { isMyTurn: true, validActions: actions }
  }

  // ── Dealer + payouts ────────────────────────────────────────────────────

  /** Reached only once every live hand has stood/busted, and only when the
   *  dealer is already known NOT to have a natural blackjack (that case is
   *  always caught earlier by resolvePeek) — so a player blackjack here
   *  always safely pays 3:2 without needing to re-check the dealer. */
  private playDealerAndResolve(): void {
    this.phase = 'dealer_turn'
    this.dealerHoleHidden = false
    while (handValue(this.dealerCards).total < 17) this.dealerCards.push(this.draw())
    const dealerBust = isBust(this.dealerCards)
    const dealerTotal = handValue(this.dealerCards).total

    for (const p of this.players) {
      for (const h of p.hands) {
        if (h.outcome !== null) continue
        if (h.isBusted) { h.outcome = 'lose'; h.payout = 0; continue }
        if (h.isBlackjack) { h.outcome = 'blackjack'; h.payout = h.bet + Math.floor(h.bet * 3 / 2); p.chips += h.payout; continue }
        const total = handValue(h.cards).total
        if (dealerBust || total > dealerTotal) { h.outcome = 'win'; h.payout = h.bet * 2; p.chips += h.payout; continue }
        if (total === dealerTotal) { h.outcome = 'push'; h.payout = h.bet; p.chips += h.bet; continue }
        h.outcome = 'lose'; h.payout = 0
      }
    }
    this.phase = 'round_end'
  }

  /** Chips of every player who's now at 0 — the Room removes them (no rebuy). */
  bustedPlayerIds(): string[] { return this.players.filter((p) => p.chips === 0).map((p) => p.id) }

  /** A player is leaving mid-round: forfeits any not-yet-resolved bet/hand
   *  (no refund) and, if it was their turn, hands play to the next seat.
   *  During the betting window (no cards dealt yet) the bet is refunded
   *  instead — nothing has actually started yet. See .claude/Blackjack.md
   *  → "Sair da mesa". */
  handleLeaveDuringRound(id: string): void {
    if (this.phase === 'betting') {
      const amt = this.pendingBets.get(id)
      if (amt) { const p = this.player(id); if (p) p.chips += amt }
      this.pendingBets.delete(id)
      return
    }
    const p = this.player(id)
    if (!p) return
    const wasCurrent = p.seatIndex === this.currentSeat
    for (const h of p.hands) {
      if (h.outcome === null) { h.outcome = 'lose'; h.payout = 0; h.isStood = true }
    }
    if (wasCurrent && this.phase === 'player_turns') this.advanceTurn()
  }
}
