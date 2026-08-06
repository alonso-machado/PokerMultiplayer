import type {
  CanastraCard, CanastraMeld, CanastraMeldPlan, CanastraPhase, CanastraPlayer,
  CanastraPlayerStatus, CanastraRoomConfig, CanastraScoreBreakdown, CanastraTableState,
  CanastraTeamState, CanastraTurnStage,
} from '../../../shared/types'
import { createDeck, shuffle, cardValue, validateMeld } from './deck'

interface GamePlayer {
  id: string
  name: string
  seatIndex: number
  teamIndex: 0 | 1
  status: CanastraPlayerStatus
  hand: CanastraCard[]
  matchWins: number
}

interface Team {
  mortoTaken: boolean
  morto: CanastraCard[]
  melds: CanastraMeld[]
}

export interface CanastraRoundResult {
  winnerTeam: 0 | 1 | null
  scores: [number, number]
  breakdown: [CanastraScoreBreakdown, CanastraScoreBreakdown]
}

let meldSeq = 0
function nextMeldId(): string { return `m${++meldSeq}` }

function emptyTeam(): Team { return { mortoTaken: false, morto: [], melds: [] } }

/** Canastra/Buraco — one hand per match (no repeated deals to a target score
 *  like Truco). See .claude/Canastra.md for the full rules this implements. */
export class CanastraGame {
  readonly config: CanastraRoomConfig
  players: GamePlayer[] = []
  private teams: [Team, Team] = [emptyTeam(), emptyTeam()]
  private stock: CanastraCard[] = []
  private discardPile: CanastraCard[] = []
  private phase: CanastraPhase = 'waiting'
  private turnStage: CanastraTurnStage = 'draw'
  private currentSeat = 0
  private dealerSeat = -1
  private pendingMortoPickup: 0 | 1 | null = null
  lastRoundResult: CanastraRoundResult | null = null

  constructor(config: CanastraRoomConfig) { this.config = config }

  get maxPlayers(): number { return this.config.mode === '1x1' ? 2 : 4 }

  addPlayer(id: string, name: string): void {
    const seatIndex = this.players.length
    const teamIndex = (seatIndex % 2) as 0 | 1 // opposite seats are partners, same as Truco/Gaúcho
    this.players.push({ id, name, seatIndex, teamIndex, status: 'waiting', hand: [], matchWins: 0 })
  }

  removePlayer(id: string): void {
    this.players = this.players.filter((p) => p.id !== id)
  }

  publicPlayers(): CanastraPlayer[] {
    return this.players.map((p) => ({
      id: p.id, name: p.name, seatIndex: p.seatIndex, teamIndex: p.teamIndex,
      status: p.status, handCount: p.hand.length, matchWins: p.matchWins,
    }))
  }

  private player(id: string): GamePlayer | undefined { return this.players.find((p) => p.id === id) }
  private currentPlayer(): GamePlayer | undefined { return this.players.find((p) => p.seatIndex === this.currentSeat) }
  private isCurrent(id: string): boolean { return this.currentPlayer()?.id === id }
  currentPlayerId(): string | null { return this.currentPlayer()?.id ?? null }

  hand(id: string): CanastraCard[] { return this.player(id)?.hand ?? [] }

  get tableState(): CanastraTableState {
    const teamState = (t: Team): CanastraTeamState => ({
      mortoTaken: t.mortoTaken, mortoCount: t.mortoTaken ? 0 : 11, melds: t.melds,
    })
    return {
      phase: this.phase, turnStage: this.turnStage,
      stockCount: this.stock.length, discardPile: this.discardPile,
      teams: [teamState(this.teams[0]), teamState(this.teams[1])],
      currentSeat: this.currentSeat,
      scores: this.lastRoundResult ? this.lastRoundResult.scores : null,
    }
  }

  // ── Hand lifecycle ─────────────────────────────────────────────────────

  startHand(): void {
    for (const p of this.players) { p.status = 'active'; p.hand = [] }
    this.teams = [emptyTeam(), emptyTeam()]
    this.discardPile = []
    this.pendingMortoPickup = null
    this.lastRoundResult = null

    const deck = shuffle(createDeck())
    let i = 0
    const order = [...this.players].sort((a, b) => a.seatIndex - b.seatIndex)
    for (const p of order) { p.hand = deck.slice(i, i + 11); i += 11 }
    this.teams[0].morto = deck.slice(i, i + 11); i += 11
    this.teams[1].morto = deck.slice(i, i + 11); i += 11
    this.stock = deck.slice(i)

    this.dealerSeat = (this.dealerSeat + 1) % this.maxPlayers
    this.phase = 'playing'
    this.currentSeat = (this.dealerSeat + 1) % this.maxPlayers
    this.turnStage = 'draw'
  }

  recordMatchWin(winnerTeam: 0 | 1 | null): void {
    if (winnerTeam === null) return
    for (const p of this.players) if (p.teamIndex === winnerTeam) p.matchWins++
  }

  // ── Turn actions ───────────────────────────────────────────────────────

  /** Melding/discarding is allowed once you've drawn (`turnStage === 'act'`),
   *  or immediately if the stock is empty — otherwise a player with an
   *  unusable discard pile on top and no stock left would be stuck unable
   *  to ever leave the "draw" stage. See .claude/Canastra.md → "Monte esgotado". */
  private canAct(id: string): boolean {
    return this.phase === 'playing' && this.isCurrent(id) && (this.turnStage === 'act' || this.stock.length === 0)
  }

  drawStock(id: string): boolean {
    const p = this.player(id)
    if (!p || this.phase !== 'playing' || !this.isCurrent(id) || this.turnStage !== 'draw' || this.stock.length === 0) return false
    const card = this.stock.pop()!
    p.hand.push(card)
    this.turnStage = 'act'
    return true
  }

  canTakeDiscard(id: string): boolean {
    return this.phase === 'playing' && this.isCurrent(id) && this.turnStage === 'draw' && this.discardPile.length > 0
  }

  /** Takes the whole discard pile — legal only if the top card can be used
   *  right away, either in a brand-new meld or appended to an existing one
   *  owned by the player's own team. See .claude/Canastra.md → "Comprar o lixo". */
  takeDiscard(id: string, plan: CanastraMeldPlan): boolean {
    const p = this.player(id)
    if (!p || !this.canTakeDiscard(id)) return false
    const top = this.discardPile[this.discardPile.length - 1]!
    const pool = [...p.hand, ...this.discardPile]

    if (plan.kind === 'new') {
      if (!plan.cardIds.includes(top.id)) return false
      const cards = plan.cardIds.map((cid) => pool.find((c) => c.id === cid)).filter((c): c is CanastraCard => !!c)
      if (cards.length !== plan.cardIds.length) return false
      const validation = validateMeld(cards)
      if (!validation) return false
      const usedIds = new Set(plan.cardIds)
      p.hand = pool.filter((c) => !usedIds.has(c.id))
      this.teams[p.teamIndex].melds.push({
        id: nextMeldId(), ownerTeam: p.teamIndex, kind: validation.kind, cards,
        isCanastra: validation.isCanastra, isClean: validation.isClean,
      })
    } else {
      if (plan.cardId !== top.id) return false
      const meld = this.teams[p.teamIndex].melds.find((m) => m.id === plan.meldId)
      if (!meld) return false
      const combined = [...meld.cards, top]
      const validation = validateMeld(combined)
      if (!validation || validation.kind !== meld.kind) return false
      p.hand = pool.filter((c) => c.id !== top.id)
      meld.cards = combined
      meld.isCanastra = validation.isCanastra
      meld.isClean = validation.isClean
    }

    this.discardPile = []
    this.turnStage = 'act'
    if (p.hand.length === 0) this.resolveHandEmpty(p)
    return true
  }

  layMeld(id: string, cardIds: string[]): boolean {
    const p = this.player(id)
    if (!p || !this.canAct(id) || cardIds.length < 3) return false
    const cards = cardIds.map((cid) => p.hand.find((c) => c.id === cid)).filter((c): c is CanastraCard => !!c)
    if (cards.length !== cardIds.length) return false
    const validation = validateMeld(cards)
    if (!validation) return false
    const usedIds = new Set(cardIds)
    p.hand = p.hand.filter((c) => !usedIds.has(c.id))
    this.teams[p.teamIndex].melds.push({
      id: nextMeldId(), ownerTeam: p.teamIndex, kind: validation.kind, cards,
      isCanastra: validation.isCanastra, isClean: validation.isClean,
    })
    if (p.hand.length === 0) this.resolveHandEmpty(p)
    return true
  }

  addToMeld(id: string, meldId: string, cardIds: string[]): boolean {
    const p = this.player(id)
    if (!p || !this.canAct(id) || cardIds.length === 0) return false
    const meld = this.teams[p.teamIndex].melds.find((m) => m.id === meldId)
    if (!meld) return false
    const cards = cardIds.map((cid) => p.hand.find((c) => c.id === cid)).filter((c): c is CanastraCard => !!c)
    if (cards.length !== cardIds.length) return false
    const combined = [...meld.cards, ...cards]
    const validation = validateMeld(combined)
    if (!validation || validation.kind !== meld.kind) return false
    const usedIds = new Set(cardIds)
    p.hand = p.hand.filter((c) => !usedIds.has(c.id))
    meld.cards = combined
    meld.isCanastra = validation.isCanastra
    meld.isClean = validation.isClean
    if (p.hand.length === 0) this.resolveHandEmpty(p)
    return true
  }

  discard(id: string, cardId: string): boolean {
    const p = this.player(id)
    if (!p || !this.canAct(id)) return false
    const idx = p.hand.findIndex((c) => c.id === cardId)
    if (idx === -1) return false
    const [card] = p.hand.splice(idx, 1)
    this.discardPile.push(card!)

    if (p.hand.length === 0) {
      // "Batida indireta" — going out via discard. If the team hasn't taken
      // its morto yet, the round doesn't end: the morto is handed to this
      // team automatically at the start of its next turn instead.
      const team = this.teams[p.teamIndex]
      if (!team.mortoTaken) {
        this.pendingMortoPickup = p.teamIndex
        this.advanceTurn()
      } else {
        this.finishRound(p.teamIndex)
      }
    } else {
      this.advanceTurn()
    }
    return true
  }

  /** Hand hit zero via melding, not discarding — "batida direta". If the
   *  team hasn't taken its morto yet, it's handed over right now and the
   *  turn continues (the player must still discard); otherwise the round
   *  ends immediately. See .claude/Canastra.md → "Batida". */
  private resolveHandEmpty(p: GamePlayer): void {
    const team = this.teams[p.teamIndex]
    if (!team.mortoTaken) {
      p.hand = [...p.hand, ...team.morto]
      team.morto = []
      team.mortoTaken = true
    } else {
      this.finishRound(p.teamIndex)
    }
  }

  private advanceTurn(): void {
    const order = this.players.map((p) => p.seatIndex).sort((a, b) => a - b)
    const idx = order.indexOf(this.currentSeat)
    this.currentSeat = order[(idx + 1) % order.length]!
    const next = this.currentPlayer()!
    if (this.pendingMortoPickup === next.teamIndex) {
      const team = this.teams[next.teamIndex]
      next.hand = [...next.hand, ...team.morto]
      team.morto = []
      team.mortoTaken = true
      this.pendingMortoPickup = null
      this.turnStage = 'act' // morto pickup replaces this turn's draw step
    } else {
      this.turnStage = 'draw'
    }
  }

  private teamHasCanastra(team: Team): boolean { return team.melds.some((m) => m.isCanastra) }

  /** Ending the round never requires a canastra (that would risk a
   *  deadlock if neither team ever completes one) — instead, going out
   *  without one simply forfeits the +100 batida bonus. See
   *  .claude/Canastra.md → "Pontuação final". */
  private finishRound(winningTeam: 0 | 1): void {
    this.phase = 'round_end'
    const breakdown = [0, 1].map((t) => this.scoreTeam(t as 0 | 1, t === winningTeam)) as [CanastraScoreBreakdown, CanastraScoreBreakdown]
    let winnerTeam: 0 | 1 | null = null
    if (breakdown[0]!.total > breakdown[1]!.total) winnerTeam = 0
    else if (breakdown[1]!.total > breakdown[0]!.total) winnerTeam = 1
    this.lastRoundResult = { winnerTeam, scores: [breakdown[0]!.total, breakdown[1]!.total], breakdown }
  }

  private scoreTeam(t: 0 | 1, wentOut: boolean): CanastraScoreBreakdown {
    const team = this.teams[t]
    let meldPoints = 0
    for (const meld of team.melds) {
      meldPoints += meld.cards.reduce((sum, c) => sum + cardValue(c), 0)
      if (meld.isCanastra) meldPoints += meld.isClean ? 200 : 100
    }
    const handCards = this.players.filter((p) => p.teamIndex === t).flatMap((p) => p.hand)
    const handPenalty = 0 - handCards.reduce((sum, c) => sum + cardValue(c), 0) // avoid -0 when there's nothing to penalize
    const mortoPenalty = team.mortoTaken ? 0 : -100
    const battingBonus = wentOut && this.teamHasCanastra(team) ? 100 : 0
    return { meldPoints, handPenalty, mortoPenalty, battingBonus, total: meldPoints + handPenalty + mortoPenalty + battingBonus }
  }

  // ── Turn info / auto-play helpers (for the Room's timeout handling) ────

  turnInfo(id: string): { canDraw: boolean; canTakeDiscard: boolean; canAct: boolean } {
    return {
      canDraw: this.phase === 'playing' && this.isCurrent(id) && this.turnStage === 'draw' && this.stock.length > 0,
      canTakeDiscard: this.canTakeDiscard(id),
      canAct: this.canAct(id),
    }
  }

  /** Used by the room on turn timeout, after an auto-draw if one was possible. */
  arbitraryDiscardCard(id: string): CanastraCard | null {
    return this.player(id)?.hand[0] ?? null
  }
}
