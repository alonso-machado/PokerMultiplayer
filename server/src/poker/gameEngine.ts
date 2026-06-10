import type { Card, GamePhase, Player, PlayerAction, RoomConfig, TableState } from '../../../shared/types'
import { startingChipsFor } from '../../../shared/types'
import { createDeck, shuffle } from './deck'
import { evaluateHand, compareHands } from './handEvaluator'

export interface GamePlayer extends Player {
  holeCards: Card[]
}

export interface PotResult {
  winnerId: string
  winnerName: string
  amount: number
  handName?: string
}

export interface HandResult {
  /** Primary winner (largest pot, or sole winner). */
  winnerId: string
  winnerName: string
  /** Total chips awarded to the primary winner across all pots they won. */
  amount: number
  handName?: string
  showdown: { playerId: string; playerName: string; cards: Card[]; bestCards: Card[]; handName: string; won: number }[]
  /** One entry per side pot, ordered main → side. */
  pots: PotResult[]
}

export class PokerGame {
  players: GamePlayer[] = []
  private deck: Card[] = []
  private handCount = 0
  private _phase: GamePhase = 'waiting'
  private _communityCards: Card[] = []
  private _pot = 0
  private _currentBet = 0
  private _minRaise: number
  private _currentPlayerIndex = 0
  private _dealerIndex = 0
  /**
   * Tracks which player IDs have acted in the current betting street.
   * A street ends only when ALL active players have acted AND bets match.
   * Without this, check rounds end immediately because currentBet=0 matches all bets.
   */
  private _actedThisStreet = new Set<string>()
  // Players who may not re-raise because a partial all-in (< minRaise) occurred after they acted
  private _noReraiseIds = new Set<string>()

  constructor(private config: RoomConfig) {
    this._minRaise = config.bigBlind * 2
  }

  /** Update blinds mid-tournament */
  updateConfig(config: RoomConfig): void {
    this.config = config
    this._minRaise = config.bigBlind * 2
  }

  get tableState(): TableState {
    return {
      phase: this._phase,
      pot: this._pot,
      currentBet: this._currentBet,
      minRaise: this._minRaise,
      currentPlayerIndex: this._currentPlayerIndex,
      dealerIndex: this._dealerIndex,
      communityCards: [...this._communityCards],
    }
  }

  // ── Player management ─────────────────────────────────────────────────────

  addPlayer(id: string, name: string, chips?: number): void {
    const seat = this.nextSeat()
    this.players.push({
      id, name,
      chips: chips ?? startingChipsFor(this.config),
      bet: 0, totalBet: 0,
      status: 'waiting',
      seatIndex: seat,
      isDealer: false, isSmallBlind: false, isBigBlind: false,
      holeCards: [],
    })
  }

  removePlayer(id: string): void {
    this.players = this.players.filter(p => p.id !== id)
  }

  // ── Hand ──────────────────────────────────────────────────────────────────

  startHand(): void {
    this.handCount++
    this.deck = shuffle(createDeck())
    this._communityCards = []
    this._pot = 0
    this._currentBet = 0
    this._minRaise = this.config.bigBlind * 2
    this._phase = 'preflop'
    this._actedThisStreet.clear()
    this._noReraiseIds.clear()

    // Reset player states BEFORE filtering active players —
    // 'waiting' players (joined mid-game) become 'active' here.
    for (const p of this.players) {
      p.bet = 0; p.totalBet = 0; p.holeCards = []
      p.isDealer = false; p.isSmallBlind = false; p.isBigBlind = false
      if (p.status !== 'away') p.status = p.chips > 0 ? 'active' : 'waiting'
    }

    const active = this.activePlayers()
    if (active.length < 2) return

    // Rotate dealer among active players (index within active[] for rotation logic)
    const prevDealerInActive = this.handCount === 1
      ? 0
      : (active.findIndex(p => p.id === this.players[this._dealerIndex]?.id) + 1) % active.length
    const n   = active.length
    const di  = prevDealerInActive
    const sbi = n === 2 ? di : (di + 1) % n
    const bbi = n === 2 ? (di + 1) % n : (di + 2) % n

    active[di]!.isDealer     = true
    active[sbi]!.isSmallBlind = true
    active[bbi]!.isBigBlind   = true

    // Store dealer as index into this.players (stable, never changes)
    this._dealerIndex = this.players.indexOf(active[di]!)

    // Ante: only UTG posts it, only with 3+ players.
    // It is dead money (goes to pot but NOT counted in UTG's live bet for the street),
    // so UTG still needs to call/raise/fold the big blind.
    // With 2 players (heads-up) there is no ante.
    if (this.config.ante > 0 && n > 2) {
      const utgi = (bbi + 1) % n
      const utg  = active[utgi]!
      const actual = Math.min(this.config.ante, utg.chips)
      utg.chips    -= actual
      utg.totalBet += actual
      this._pot    += actual
      // utg.bet is NOT incremented — ante is dead money, not a live bet
    }

    // Blinds (live bets)
    this.postBlind(active[sbi]!, this.config.smallBlind)
    this.postBlind(active[bbi]!, this.config.bigBlind)

    this._currentBet = this.config.bigBlind
    this._minRaise   = this.config.bigBlind * 2

    // Deal 2 cards each
    for (let i = 0; i < 2; i++) for (const p of active) p.holeCards.push(this.deck.pop()!)

    // First to act preflop: UTG (player after BB)
    // _currentPlayerIndex is now an index into this.players (full array, including folded)
    const utg = active[(bbi + 1) % n]!
    this._currentPlayerIndex = this.players.indexOf(utg)
  }

  private postBlind(p: GamePlayer, amount: number): void {
    const actual = Math.min(amount, p.chips)
    p.chips -= actual; p.bet += actual; p.totalBet += actual; this._pot += actual
    if (p.chips === 0) p.status = 'all-in'
  }

  // ── Action ────────────────────────────────────────────────────────────────

  applyAction(playerId: string, action: PlayerAction, amount = 0): boolean {
    // _currentPlayerIndex is an index into this.players (stable, never shrinks)
    const player = this.players[this._currentPlayerIndex]
    if (!player || player.id !== playerId) return false
    if (player.status !== 'active') return false

    switch (action) {
      case 'fold':
        player.status = 'folded'
        break
      case 'check':
        if (player.bet < this._currentBet) return false
        break
      case 'call': {
        const toCall = Math.min(this._currentBet - player.bet, player.chips)
        player.chips -= toCall; player.bet += toCall
        player.totalBet += toCall; this._pot += toCall
        if (player.chips === 0) player.status = 'all-in'
        break
      }
      case 'raise': {
        if (this._noReraiseIds.has(player.id)) return false
        const raiseTotal = Math.min(amount, player.chips + player.bet)
        if (raiseTotal < this._currentBet + this._minRaise) return false
        const added = raiseTotal - player.bet
        player.chips -= added; player.totalBet += added; this._pot += added
        this._minRaise = raiseTotal - this._currentBet
        this._currentBet = raiseTotal; player.bet = raiseTotal
        if (player.chips === 0) player.status = 'all-in'
        this._noReraiseIds.clear()
        break
      }
      case 'all-in': {
        const all = player.chips
        player.bet += all; player.totalBet += all; this._pot += all; player.chips = 0
        if (player.bet > this._currentBet) {
          const raiseBy = player.bet - this._currentBet
          if (raiseBy >= this._minRaise) {
            // Full raise: update minRaise and reopen action for everyone
            this._minRaise = raiseBy
            this._noReraiseIds.clear()
          } else {
            // Partial raise (short stack): players who already acted may only call, not re-raise
            for (const id of this._actedThisStreet) this._noReraiseIds.add(id)
          }
          this._currentBet = player.bet
        }
        player.status = 'all-in'
        break
      }
      default:
        return false
    }

    // Mark this player as having acted in the current street
    this._actedThisStreet.add(playerId)
    this.advanceTurn()
    return true
  }

  private advanceTurn(): void {
    // canAct = only 'active' players (not folded, not all-in, not away)
    const canAct    = this.players.filter(p => p.status === 'active')
    const nonFolded = this.players.filter(p => p.status !== 'folded')

    if (nonFolded.length <= 1) {
      // Everyone else folded — go to showdown immediately without dealing more cards
      this._phase = 'showdown'
      return
    }

    if (canAct.length === 0) {
      // All remaining players are all-in — run out ALL remaining community cards at once
      while (this._phase !== 'showdown') this.advancePhase()
      return
    }

    // Street ends when:
    //   1. All active players' bets match currentBet (everyone called or checked), AND
    //   2. Every active player has had a chance to act this street
    const allBetsMatch = canAct.every(p => p.bet === this._currentBet)
    const allHaveActed = canAct.every(p => this._actedThisStreet.has(p.id))

    if (allBetsMatch && allHaveActed) { this.advancePhase(); return }

    // Advance to next 'active' player, using this.players as the stable seat array
    let next = (this._currentPlayerIndex + 1) % this.players.length
    while (this.players[next]!.status !== 'active') {
      next = (next + 1) % this.players.length
    }
    this._currentPlayerIndex = next
  }

  /**
   * Advances to next phase and returns the newly revealed community cards.
   * Returns empty array if no cards were dealt (showdown reached).
   */
  advancePhase(): Card[] {
    for (const p of this.players) p.bet = 0
    this._currentBet = 0; this._minRaise = this.config.bigBlind * 2
    this._actedThisStreet.clear()
    this._noReraiseIds.clear()

    const phases: GamePhase[] = ['preflop', 'flop', 'turn', 'river', 'showdown']
    const idx = phases.indexOf(this._phase)
    this._phase = phases[idx + 1] ?? 'showdown'

    let newCards: Card[] = []

    switch (this._phase) {
      case 'flop':
        this.deck.pop() // burn
        newCards = [this.deck.pop()!, this.deck.pop()!, this.deck.pop()!]
        this._communityCards.push(...newCards)
        break
      case 'turn':
        this.deck.pop()
        newCards = [this.deck.pop()!]
        this._communityCards.push(...newCards)
        break
      case 'river':
        this.deck.pop()
        newCards = [this.deck.pop()!]
        this._communityCards.push(...newCards)
        break
    }

    if (this._phase !== 'showdown') {
      // First to act post-flop: first 'active' player clockwise after dealer
      // _dealerIndex is an index into this.players
      let first = (this._dealerIndex + 1) % this.players.length
      let loops = 0
      while (this.players[first]!.status !== 'active') {
        first = (first + 1) % this.players.length
        if (++loops > this.players.length) break
      }
      this._currentPlayerIndex = first
    }

    return newCards
  }

  // ── Showdown ──────────────────────────────────────────────────────────────

  /**
   * Builds side pots from each player's totalBet (TDA Rule 50).
   *
   * Algorithm:
   *   1. Collect the unique totalBet levels of all non-folded players (sorted ASC).
   *   2. For each level, every player (including folded) contributes
   *      min(totalBet, level) − min(totalBet, prevLevel) to the pot.
   *   3. Only non-folded players whose totalBet >= level are eligible to win that pot.
   *
   * Example — P1(1050 all-in), P2(850 all-in), P3(1050 active), P4(50 folded):
   *   Level 850: amount=2600  eligible=[P1,P2,P3]
   *   Level 1050: amount=400  eligible=[P1,P3]
   */
  private buildSidePots(): { amount: number; eligible: GamePlayer[] }[] {
    const nonFolded = this.players.filter(p => p.status !== 'folded' && p.totalBet > 0)
    const levels = [...new Set(nonFolded.map(p => p.totalBet))].sort((a, b) => a - b)

    const pots: { amount: number; eligible: GamePlayer[] }[] = []
    let prev = 0

    for (const level of levels) {
      let amount = 0
      for (const p of this.players) {
        amount += Math.min(p.totalBet, level) - Math.min(p.totalBet, prev)
      }
      const eligible = nonFolded.filter(p => p.totalBet >= level)
      if (amount > 0) pots.push({ amount, eligible })
      prev = level
    }

    return pots
  }

  resolveShowdown(): HandResult {
    const contenders = this.players.filter(p => p.status === 'active' || p.status === 'all-in')

    // Single contender: everyone else folded — wins without showing cards
    if (contenders.length === 1) {
      const winner = contenders[0]!
      const amount = this._pot
      winner.chips += amount
      this._pot = 0
      return {
        winnerId: winner.id, winnerName: winner.name,
        amount, showdown: [], pots: [{ winnerId: winner.id, winnerName: winner.name, amount }],
      }
    }

    // Evaluate every contender's best hand once
    const evalMap = new Map(
      contenders.map(p => [
        p.id,
        { player: p, result: evaluateHand([...p.holeCards, ...this._communityCards]) },
      ])
    )

    // Track net winnings per player (for showdown display)
    const wonMap = new Map<string, number>(contenders.map(p => [p.id, 0]))

    const pots = this.buildSidePots()
    const potResults: PotResult[] = []

    for (const pot of pots) {
      // Rank eligible contenders for this pot
      const ranked = pot.eligible
        .map(p => evalMap.get(p.id)!)
        .sort((a, b) => compareHands(b.result, a.result))

      if (ranked.length === 0) continue

      // All players tied with the best hand share this pot
      const best = ranked[0]!
      const winners = ranked.filter(e => compareHands(e.result, best.result) === 0)

      const share = Math.floor(pot.amount / winners.length)
      // Odd chip goes to the first winner (lowest seat index, deterministic)
      const remainder = pot.amount - share * winners.length

      for (let i = 0; i < winners.length; i++) {
        const gain = share + (i === 0 ? remainder : 0)
        winners[i]!.player.chips += gain
        wonMap.set(winners[i]!.player.id, (wonMap.get(winners[i]!.player.id) ?? 0) + gain)
      }

      potResults.push({
        winnerId:  winners[0]!.player.id,
        winnerName: winners[0]!.player.name,
        amount:    pot.amount,
        handName:  best.result.name,
      })
    }

    this._pot = 0

    // Primary result = the pot with the most chips (main pot)
    const primary = [...potResults].sort((a, b) => b.amount - a.amount)[0]
      ?? potResults[0]!

    // Build showdown detail ordered by hand strength (best first)
    const showdown = [...evalMap.values()]
      .sort((a, b) => compareHands(b.result, a.result))
      .map(e => ({
        playerId:   e.player.id,
        playerName: e.player.name,
        cards:      e.player.holeCards,
        bestCards:  e.result.bestCards,
        handName:   e.result.name,
        won:        wonMap.get(e.player.id) ?? 0,
      }))

    return {
      winnerId:   primary.winnerId,
      winnerName: primary.winnerName,
      amount:     wonMap.get(primary.winnerId) ?? primary.amount,
      handName:   primary.handName,
      showdown,
      pots: potResults,
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  activePlayers(): GamePlayer[] {
    return this.players.filter(p => p.status === 'active' || p.status === 'all-in' || p.status === 'away')
  }

  currentPlayer(): GamePlayer | undefined {
    // _currentPlayerIndex is an index into this.players (stable array)
    const p = this.players[this._currentPlayerIndex]
    return p?.status === 'active' ? p : undefined
  }

  validActions(p: GamePlayer): { actions: PlayerAction[]; callAmount: number; minRaise: number } {
    const actions: PlayerAction[] = ['fold']
    const toCall = this._currentBet - p.bet
    if (toCall === 0) actions.push('check')
    if (toCall > 0 && p.chips >= toCall) actions.push('call')
    if (p.chips > toCall && !this._noReraiseIds.has(p.id)) actions.push('raise')
    if (p.chips > 0) actions.push('all-in')
    // Return total minimum raise amount (currentBet + increment) so the client
    // can send it directly as the `amount` field without knowing currentBet separately.
    return { actions, callAmount: toCall, minRaise: this._currentBet + this._minRaise }
  }

  isHandOver(): boolean {
    if (this._phase === 'showdown') return true
    // All but one folded → immediate win, no further action needed
    const nonFolded = this.players.filter(p => p.status !== 'folded')
    if (nonFolded.length <= 1) return true
    // No one can still voluntarily bet (all remaining are all-in or away)
    const canBet = nonFolded.filter(p => p.status === 'active')
    return canBet.length === 0
  }

  publicPlayers(): Player[] {
    return this.players.map(({ holeCards: _h, ...p }) => p)
  }

  private nextSeat(): number {
    const used = new Set(this.players.map(p => p.seatIndex))
    for (let i = 0; i < 6; i++) if (!used.has(i)) return i
    return this.players.length
  }
}
