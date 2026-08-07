import type {
  Card, GoFishPhase, GoFishPlayer, GoFishPlayerStatus, GoFishRoomConfig, GoFishTableState, Rank,
} from '../../../shared/types'
import { createDeck, shuffle } from '../poker/deck'

interface GamePlayer {
  id: string
  name: string
  seatIndex: number
  status: GoFishPlayerStatus
  hand: Card[]
  books: Rank[]
  matchWins: number
}

export interface GoFishAskResult {
  askerId: string
  targetId: string
  rank: Rank
  cardsTransferred: number
  wentFish: boolean
  drawnMatch: boolean   // a "go fish" stock draw happened to match the asked rank — counts as a catch, see .claude/GoFish.md
  booksCompleted: { playerId: string; rank: Rank }[]
}

export interface GoFishRoundResult {
  winnerIds: string[]   // more than one entry only on a tie
}

const BOOK_SIZE = 4
const TOTAL_BOOKS = 13

/** Go Fish — one game per match (like Canastra, no repeated deals to a
 *  target score). See .claude/GoFish.md for the full rules this implements. */
export class GoFishGame {
  readonly config: GoFishRoomConfig
  players: GamePlayer[] = []
  private stock: Card[] = []
  private phase: GoFishPhase = 'waiting'
  private currentSeat = 0
  private startSeat = -1   // rotates each rematch, mirrors Canastra's dealerSeat
  lastRoundResult: GoFishRoundResult | null = null

  constructor(config: GoFishRoomConfig) { this.config = config }

  get maxPlayers(): number { return this.config.maxPlayers }

  addPlayer(id: string, name: string): void {
    const seatIndex = this.players.length
    this.players.push({ id, name, seatIndex, status: 'waiting', hand: [], books: [], matchWins: 0 })
  }

  removePlayer(id: string): void {
    this.players = this.players.filter((p) => p.id !== id)
  }

  publicPlayers(): GoFishPlayer[] {
    return this.players.map((p) => ({
      id: p.id, name: p.name, status: p.status, handCount: p.hand.length, books: p.books,
    }))
  }

  private player(id: string): GamePlayer | undefined { return this.players.find((p) => p.id === id) }
  private seatedPlayer(seat: number): GamePlayer | undefined { return this.players.find((p) => p.seatIndex === seat) }
  private currentPlayer(): GamePlayer | undefined { return this.seatedPlayer(this.currentSeat) }
  private isCurrent(id: string): boolean { return this.currentPlayer()?.id === id }
  currentPlayerId(): string | null { return this.phase === 'playing' ? (this.currentPlayer()?.id ?? null) : null }

  hand(id: string): Card[] { return this.player(id)?.hand ?? [] }

  get tableState(): GoFishTableState {
    return { phase: this.phase, stockCount: this.stock.length, turnPlayerId: this.currentPlayerId() }
  }

  // ── Round lifecycle ──────────────────────────────────────────────────────

  startHand(): void {
    for (const p of this.players) { p.status = 'active'; p.hand = []; p.books = [] }
    this.lastRoundResult = null

    const deck = shuffle(createDeck())
    const perPlayer = this.players.length <= 3 ? 7 : 5   // .claude/GoFish.md gap #2
    let i = 0
    const order = [...this.players].sort((a, b) => a.seatIndex - b.seatIndex)
    for (const p of order) { p.hand = deck.slice(i, i + perPlayer); i += perPlayer }
    this.stock = deck.slice(i)

    // Modulo the actual seated count, not `maxPlayers` — a match can start
    // with fewer players than the room's configured cap (see .claude/GoFish.md gap #3).
    this.startSeat = (this.startSeat + 1) % this.players.length
    this.phase = 'playing'
    this.currentSeat = this.startSeat
    this.prepareTurn()
  }

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

  // ── Turn / ask ────────────────────────────────────────────────────────────

  /** Ranks the current player is allowed to ask for — must hold at least one
   *  card of that rank. See .claude/GoFish.md → "Pedir uma carta". */
  turnInfo(id: string): { askableRanks: Rank[] } {
    const p = this.player(id)
    if (!p || !this.isCurrent(id) || this.phase !== 'playing') return { askableRanks: [] }
    return { askableRanks: [...new Set(p.hand.map((c) => c.rank))] }
  }

  ask(askerId: string, targetId: string, rank: Rank): GoFishAskResult | null {
    const asker = this.player(askerId)
    const target = this.player(targetId)
    if (!asker || !target || asker.id === target.id) return null
    if (this.phase !== 'playing' || !this.isCurrent(askerId)) return null
    if (!asker.hand.some((c) => c.rank === rank)) return null

    const matches = target.hand.filter((c) => c.rank === rank)
    if (matches.length > 0) {
      target.hand = target.hand.filter((c) => c.rank !== rank)
      asker.hand.push(...matches)
      const booksCompleted = this.collectBooks(asker)
      const result: GoFishAskResult = {
        askerId, targetId, rank, cardsTransferred: matches.length, wentFish: false, drawnMatch: false, booksCompleted,
      }
      // A catch — same player's turn continues (see .claude/GoFish.md → "Sua vez continua").
      this.afterAsk()
      return result
    }

    // Go fish — draw from the stock, if there's anything left to draw.
    let drawnMatch = false
    let booksCompleted: { playerId: string; rank: Rank }[] = []
    if (this.stock.length > 0) {
      const drawn = this.stock.pop()!
      asker.hand.push(drawn)
      if (drawn.rank === rank) {
        drawnMatch = true   // counts as a catch too — .claude/GoFish.md gap #1
        booksCompleted = this.collectBooks(asker)
      }
    }
    const result: GoFishAskResult = {
      askerId, targetId, rank, cardsTransferred: drawnMatch ? 1 : 0, wentFish: true, drawnMatch, booksCompleted,
    }
    if (!drawnMatch) this.advanceTurn()
    this.afterAsk()
    return result
  }

  /** Moves any newly-completed 4-of-a-kind out of the hand into `books`. */
  private collectBooks(p: GamePlayer): { playerId: string; rank: Rank }[] {
    const completed: { playerId: string; rank: Rank }[] = []
    const counts = new Map<Rank, number>()
    for (const c of p.hand) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1)
    for (const [rank, count] of counts) {
      if (count >= BOOK_SIZE) {
        p.hand = p.hand.filter((c) => c.rank !== rank)
        p.books.push(rank)
        completed.push({ playerId: p.id, rank })
      }
    }
    return completed
  }

  /** Common tail for every branch of `ask()`: check whether the round just
   *  ended, otherwise prepare whoever's turn it now is (which may auto-draw
   *  an empty hand, or chain-skip further "out" players). */
  private afterAsk(): void {
    if (this.checkRoundEnd()) return
    this.prepareTurn()
  }

  /** Advances to the next seat that hasn't been marked "out". */
  private advanceTurn(): void {
    const order = this.players.map((p) => p.seatIndex).sort((a, b) => a - b)
    const idx = order.indexOf(this.currentSeat)
    for (let step = 1; step <= order.length; step++) {
      const seat = order[(idx + step) % order.length]!
      const p = this.seatedPlayer(seat)
      if (p && p.status !== 'out') { this.currentSeat = seat; return }
    }
  }

  /** Mandatory, automatic empty-hand refill at the start of a turn
   *  (.claude/GoFish.md gap #4); marks the seat "out" and skips it if the
   *  stock is also empty (gap #5). Bounded loop — at most one pass per seat. */
  private prepareTurn(): void {
    if (this.phase !== 'playing') return
    for (let guard = 0; guard <= this.players.length; guard++) {
      const p = this.currentPlayer()
      if (!p || p.hand.length > 0) return
      if (this.stock.length > 0) { p.hand.push(this.stock.pop()!); return }
      p.status = 'out'
      if (this.checkRoundEnd()) return
      this.advanceTurn()
    }
  }

  /** Round ends at 13 total books, or once fewer than 2 players can still
   *  take a turn — nobody left to productively ask or be asked. See
   *  .claude/GoFish.md gap #5. Ties are possible (no tiebreaker in the source). */
  private checkRoundEnd(): boolean {
    const totalBooks = this.players.reduce((sum, p) => sum + p.books.length, 0)
    const stillIn = this.players.filter((p) => p.status !== 'out').length
    if (totalBooks < TOTAL_BOOKS && stillIn >= 2) return false
    this.phase = 'round_end'
    const maxBooks = Math.max(0, ...this.players.map((p) => p.books.length))
    const winnerIds = this.players.filter((p) => p.books.length === maxBooks).map((p) => p.id)
    this.lastRoundResult = { winnerIds }
    return true
  }

  // ── Turn timeout auto-play (for the Room) ───────────────────────────────

  /** Random rank from hand + random other still-in player — a blind guess,
   *  same spirit as a real player who ran out the clock. */
  arbitraryAsk(id: string): { targetPlayerId: string; rank: Rank } | null {
    const p = this.player(id)
    if (!p || p.hand.length === 0) return null
    const others = this.players.filter((o) => o.id !== id && o.status !== 'out')
    if (others.length === 0) return null
    const rank = p.hand[Math.floor(Math.random() * p.hand.length)]!.rank
    const target = others[Math.floor(Math.random() * others.length)]!
    return { targetPlayerId: target.id, rank }
  }
}
