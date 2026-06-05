import type { Card, GamePhase, Player, PlayerAction, RoomConfig, TableState } from '../../../shared/types'
import { startingChipsFor } from '../../../shared/types'
import { createDeck, shuffle } from './deck'
import { evaluateHand, compareHands } from './handEvaluator'

export interface GamePlayer extends Player {
  holeCards: Card[]
}

export interface HandResult {
  winnerId: string
  winnerName: string
  amount: number
  handName?: string
  showdown: { playerId: string; playerName: string; cards: Card[]; handName: string; won: number }[]
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
        const raiseTotal = Math.min(amount, player.chips + player.bet)
        const added = raiseTotal - player.bet
        player.chips -= added; player.totalBet += added; this._pot += added
        this._minRaise = raiseTotal - this._currentBet
        this._currentBet = raiseTotal; player.bet = raiseTotal
        if (player.chips === 0) player.status = 'all-in'
        break
      }
      case 'all-in': {
        const all = player.chips
        player.bet += all; player.totalBet += all; this._pot += all; player.chips = 0
        if (player.bet > this._currentBet) { this._minRaise = player.bet - this._currentBet; this._currentBet = player.bet }
        player.status = 'all-in'
        break
      }
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

    if (canAct.length <= 1) {
      // Only all-in players remain — deal out remaining community cards
      this.advancePhase()
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
    this._actedThisStreet.clear()   // new street — everyone must act again

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

  resolveShowdown(): HandResult {
    const contenders = this.players.filter(p => p.status === 'active' || p.status === 'all-in')

    if (contenders.length === 1) {
      const winner = contenders[0]!
      winner.chips += this._pot
      return { winnerId: winner.id, winnerName: winner.name, amount: this._pot, showdown: [] }
    }

    const evaluated = contenders.map(p => ({
      player: p,
      result: evaluateHand([...p.holeCards, ...this._communityCards]),
    }))
    evaluated.sort((a, b) => compareHands(b.result, a.result))
    const winner = evaluated[0]!
    winner.player.chips += this._pot

    return {
      winnerId:   winner.player.id,
      winnerName: winner.player.name,
      amount:     this._pot,
      handName:   winner.result.name,
      showdown: evaluated.map(e => ({
        playerId:   e.player.id,
        playerName: e.player.name,
        cards:      e.player.holeCards,
        handName:   e.result.name,
        won:        e.player.id === winner.player.id ? this._pot : 0,
      })),
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
    if (p.chips > toCall) actions.push('raise')
    if (p.chips > 0) actions.push('all-in')
    return { actions, callAmount: toCall, minRaise: this._minRaise }
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
