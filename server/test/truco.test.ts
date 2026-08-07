/**
 * Tests for the Truco engine (server/src/truco/). See .claude/Truco.md for
 * the rules these scenarios are derived from.
 */

import { describe, test, expect } from 'bun:test'
import type { Card, TrucoMode, TrucoManilhaVariant } from '../../shared/types'
import { resolveManilha, cardStrength } from '../src/truco/deck'
import { TrucoGame } from '../src/truco/gameEngine'

// ─── deck / manilha resolution ─────────────────────────────────────────────

describe('manilha resolution', () => {
  test('fixed variant (Mineiro): no vira, manilhas are the 4 fixed cards', () => {
    const ctx = resolveManilha('fixed', [])
    expect(ctx.vira).toBeNull()
    expect(ctx.manilhaCards).toEqual([
      { suit: 'clubs', rank: '4' },
      { suit: 'hearts', rank: '7' },
      { suit: 'spades', rank: 'A' },
      { suit: 'diamonds', rank: '7' },
    ])
  })

  test('fixed variant: strength order matches Zap > Copas > Espadilha > Ouros, same as vira', () => {
    const ctx = resolveManilha('fixed', [])
    const zap       = cardStrength({ suit: 'clubs', rank: '4' }, ctx)
    const copas     = cardStrength({ suit: 'hearts', rank: '7' }, ctx)
    const espadilha = cardStrength({ suit: 'spades', rank: 'A' }, ctx)
    const ouros     = cardStrength({ suit: 'diamonds', rank: '7' }, ctx)
    expect(zap).toBeGreaterThan(copas)
    expect(copas).toBeGreaterThan(espadilha)
    expect(espadilha).toBeGreaterThan(ouros)
  })

  test('fixed variant: manilha is the specific card, not the whole rank', () => {
    const ctx = resolveManilha('fixed', [])
    // 4♣ (zap) is manilha, but 4♥/4♦/4♠ are ordinary base-rank cards.
    expect(cardStrength({ suit: 'clubs', rank: '4' }, ctx)).toBeGreaterThan(1000)
    expect(cardStrength({ suit: 'hearts', rank: '4' }, ctx)).toBeLessThan(1000)
  })

  test('vira variant (Paulista): manilha is the next rank up from vira', () => {
    const deck: Card[] = [{ suit: 'hearts', rank: '7' }]
    const ctx = resolveManilha('vira', deck)
    expect(ctx.vira).toEqual({ suit: 'hearts', rank: '7' })
    expect(ctx.manilhaCards).toHaveLength(4)
    for (const c of ctx.manilhaCards) expect(c.rank).toBe('Q')
  })

  test('vira variant wraps from 3 to 4', () => {
    const ctx = resolveManilha('vira', [{ suit: 'clubs', rank: '3' }])
    for (const c of ctx.manilhaCards) expect(c.rank).toBe('4')
  })

  test('vira variant: manilha suit order is Paus(Zap) > Copas > Espadas > Ouros', () => {
    const ctx = resolveManilha('vira', [{ suit: 'hearts', rank: '7' }]) // manilha rank = Q
    const clubs   = cardStrength({ suit: 'clubs', rank: 'Q' }, ctx)
    const hearts  = cardStrength({ suit: 'hearts', rank: 'Q' }, ctx)
    const spades  = cardStrength({ suit: 'spades', rank: 'Q' }, ctx)
    const diamonds = cardStrength({ suit: 'diamonds', rank: 'Q' }, ctx)
    expect(clubs).toBeGreaterThan(hearts)
    expect(hearts).toBeGreaterThan(spades)
    expect(spades).toBeGreaterThan(diamonds)
    // Any manilha outranks any non-manilha, including the strongest base rank (3).
    expect(diamonds).toBeGreaterThan(cardStrength({ suit: 'spades', rank: '3' }, ctx))
  })
})

// ─── TrucoGame helpers ──────────────────────────────────────────────────────

function makeGame(mode: TrucoMode, variant: TrucoManilhaVariant = 'fixed'): TrucoGame {
  const g = new TrucoGame({ mode, manilhaVariant: variant })
  const seats = mode === '1x1' ? [['a', 'A'], ['b', 'B']] : [['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D']]
  for (const [id, name] of seats) g.addPlayer(id!, name!)
  return g
}

/** Overwrites each player's hole cards directly (bypasses the shuffled deck for deterministic tests). */
function setHandsBySeat(g: TrucoGame, hands: Card[][]): void {
  for (const p of g.players) p.holeCards = [...hands[p.seatIndex]!]
}

/** Plays whoever's turn it is using the first remaining card in their hand. */
function autoPlay(g: TrucoGame): boolean {
  const pid = g.currentPlayerId()
  if (!pid) return false
  const player = g.players.find((p) => p.id === pid)!
  const card = player.holeCards[0]
  if (!card) return false
  return g.playCard(pid, card)
}

function playAllVazas(g: TrucoGame, maxPlays = 12): void {
  for (let i = 0; i < maxPlays; i++) {
    if (g.tableState.phase !== 'playing') break
    if (!autoPlay(g)) throw new Error('autoPlay failed')
  }
}

/** Deals a hand where `winningTeam` holds the two strongest non-manilha ranks
 *  and the other team holds only the weakest — guarantees a clean 2-0 win. */
function winSimpleHand(g: TrucoGame, winningTeam: 0 | 1): void {
  g.startHand()
  if (g.tableState.phase === 'mao_de_onze_decision') {
    // Auto-accept for whichever team(s) are pending so score-building loops
    // in tests don't get stuck waiting on a decision they don't care about.
    for (const t of [0, 1] as const) {
      const rep = g.players.find((p) => p.teamIndex === t)
      if (rep) g.maoDeOnzeDecision(rep.id, true) // no-op if `t` isn't pending
    }
  }
  if (g.tableState.phase !== 'playing') return
  const strong: Card[] = [{ suit: 'clubs', rank: '3' }, { suit: 'diamonds', rank: '2' }, { suit: 'spades', rank: '5' }]
  const weak: Card[] = [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: '5' }, { suit: 'spades', rank: '6' }]
  for (const p of g.players) p.holeCards = [...(p.teamIndex === winningTeam ? strong : weak)]
  playAllVazas(g)
}

// ─── Vaza tie-break table (.claude/Truco.md → "Empate de vaza") ───────────

describe('vaza tie-break table (2x2, fixed manilha)', () => {
  test('1ª vaza empata → quem ganha a 2ª vaza ganha a mão', () => {
    const g = makeGame('2x2')
    g.startHand() // dealer=seat0, leader=seat1 (b) → play order b,c,d,a
    setHandsBySeat(g, [
      /* a seat0 team0 */ [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: 'J' }, { suit: 'spades', rank: '5' }],
      /* b seat1 team1 */ [{ suit: 'spades', rank: 'K' }, { suit: 'spades', rank: '2' }, { suit: 'diamonds', rank: '3' }],
      /* c seat2 team0 */ [{ suit: 'hearts', rank: 'K' }, { suit: 'diamonds', rank: '5' }, { suit: 'spades', rank: '6' }],
      /* d seat3 team1 */ [{ suit: 'diamonds', rank: '4' }, { suit: 'clubs', rank: '6' }, { suit: 'clubs', rank: '7' }],
    ])
    playAllVazas(g)
    expect(g.tableState.vazaWinners).toEqual([null, 1])
    expect(g.tableState.phase).toBe('hand_end')
    expect(g.lastHandResult).toEqual({ winnerTeam: 1, points: 1, reason: 'vazas' })
  })

  test('1ª tem vencedor, 2ª empata → vencedor da 1ª ganha a mão', () => {
    const g = makeGame('2x2')
    g.startHand()
    setHandsBySeat(g, [
      /* a seat0 team0 */ [{ suit: 'spades', rank: '4' }, { suit: 'diamonds', rank: 'Q' }, { suit: 'clubs', rank: '5' }],
      /* b seat1 team1 */ [{ suit: 'spades', rank: 'K' }, { suit: 'spades', rank: 'Q' }, { suit: 'hearts', rank: '3' }],
      /* c seat2 team0 */ [{ suit: 'diamonds', rank: '5' }, { suit: 'hearts', rank: '5' }, { suit: 'hearts', rank: '6' }],
      /* d seat3 team1 */ [{ suit: 'clubs', rank: '6' }, { suit: 'diamonds', rank: '6' }, { suit: 'clubs', rank: '7' }],
    ])
    playAllVazas(g)
    expect(g.tableState.vazaWinners).toEqual([1, null])
    expect(g.tableState.phase).toBe('hand_end')
    expect(g.lastHandResult).toEqual({ winnerTeam: 1, points: 1, reason: 'vazas' })
  })

  test('1ª e 2ª empatam → decide a 3ª', () => {
    const g = makeGame('2x2')
    g.startHand()
    setHandsBySeat(g, [
      /* a seat0 team0 */ [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: 'J' }, { suit: 'spades', rank: '6' }],
      /* b seat1 team1 */ [{ suit: 'spades', rank: 'K' }, { suit: 'spades', rank: 'J' }, { suit: 'diamonds', rank: 'A' }],
      /* c seat2 team0 */ [{ suit: 'diamonds', rank: 'K' }, { suit: 'hearts', rank: '5' }, { suit: 'diamonds', rank: '6' }],
      /* d seat3 team1 */ [{ suit: 'spades', rank: '4' }, { suit: 'hearts', rank: '6' }, { suit: 'clubs', rank: '5' }],
    ])
    playAllVazas(g)
    expect(g.tableState.vazaWinners).toEqual([null, null, 1])
    expect(g.tableState.phase).toBe('hand_end')
    expect(g.lastHandResult).toEqual({ winnerTeam: 1, points: 1, reason: 'vazas' })
  })

  test('as 3 vazas empatam → ninguém pontua', () => {
    const g = makeGame('2x2')
    g.startHand()
    setHandsBySeat(g, [
      /* a seat0 team0 */ [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: 'J' }, { suit: 'spades', rank: '6' }],
      /* b seat1 team1 */ [{ suit: 'spades', rank: 'K' }, { suit: 'spades', rank: 'J' }, { suit: 'diamonds', rank: 'A' }],
      /* c seat2 team0 */ [{ suit: 'diamonds', rank: 'K' }, { suit: 'hearts', rank: '5' }, { suit: 'hearts', rank: 'A' }],
      /* d seat3 team1 */ [{ suit: 'spades', rank: '4' }, { suit: 'hearts', rank: '6' }, { suit: 'clubs', rank: '5' }],
    ])
    playAllVazas(g)
    expect(g.tableState.vazaWinners).toEqual([null, null, null])
    expect(g.tableState.phase).toBe('hand_end')
    expect(g.lastHandResult).toEqual({ winnerTeam: null, points: 1, reason: 'vazas' })
    expect(g.tableState.scores).toEqual([0, 0])
  })
})

// ─── Truco escalation ───────────────────────────────────────────────────────

describe('truco call escalation', () => {
  test('call + accept raises the stake; caller cannot immediately re-raise', () => {
    const g = makeGame('1x1')
    g.startHand() // leader = seat1 (b)
    expect(g.callTruco('b')).toBe(true)
    expect(g.tableState.stake).toBe(1) // not applied until accepted
    expect(g.tableState.awaitingResponseFromTeam).toBe(0)

    expect(g.respond('a', true)).toBe(true)
    expect(g.tableState.stake).toBe(3)
    expect(g.tableState.awaitingResponseFromTeam).toBeNull()

    expect(g.turnInfo('b').canPlay).toBe(true)
    expect(g.turnInfo('b').canCallTruco).toBe(false) // b's own team called last
  })

  test('decline ("corro") awards the last accepted stake to the caller', () => {
    const g = makeGame('1x1')
    g.startHand()
    g.callTruco('b')      // pending 3, stake still 1
    g.respond('a', false) // a runs
    expect(g.tableState.phase).toBe('hand_end')
    expect(g.lastHandResult).toEqual({ winnerTeam: 1, points: 1, reason: 'corri' })
    expect(g.tableState.scores).toEqual([0, 1])
  })

  test('cannot call out of turn', () => {
    const g = makeGame('1x1')
    g.startHand()
    expect(g.callTruco('a')).toBe(false) // not a's turn (b is leader)
  })

  test('the original caller cannot call again while their own call is pending', () => {
    const g = makeGame('1x1')
    g.startHand()
    expect(g.callTruco('b')).toBe(true) // pending 3, awaiting team0 (a)
    expect(g.callTruco('b')).toBe(false) // b isn't on the awaiting team
  })

  test('responding team may raise directly instead of accepting ("truco" answered with "seis")', () => {
    const g = makeGame('1x1')
    g.startHand()
    expect(g.callTruco('b')).toBe(true) // pending 3
    expect(g.callTruco('a')).toBe(true) // a raises straight to 6 instead of accepting 3
    expect(g.tableState.pendingStake).toBe(6)
    expect(g.tableState.stake).toBe(1) // still nothing formally accepted
    expect(g.tableState.stakeCalledByTeam).toBe(0) // now a's team holds the raise
    expect(g.tableState.awaitingResponseFromTeam).toBe(1) // b must respond

    expect(g.respond('b', true)).toBe(true)
    expect(g.tableState.stake).toBe(6)
  })

  test('declining a raised response awards only the last formally accepted stake', () => {
    const g = makeGame('1x1')
    g.startHand()
    g.callTruco('b')       // pending 3
    g.callTruco('a')       // a raises directly to 6 (3 never accepted)
    expect(g.respond('b', false)).toBe(true) // b runs from the 6
    expect(g.lastHandResult).toEqual({ winnerTeam: 0, points: 1, reason: 'corri' })
    expect(g.tableState.scores).toEqual([1, 0])
  })

  test('escalates 1 → 3 → 6 → 9 → 12 and refuses to go past 12', () => {
    const g = makeGame('2x2') // leader = seat1 (b, team1)
    g.startHand()
    // Cards so team1 (b then d) wins vaza 1 outright, keeping the leader on
    // team1 for vaza 2 — needed so the eventual 12→? attempt is a legally
    // eligible call (right seat, right team) and fails only on the cap.
    setHandsBySeat(g, [
      /* a seat0 team0 */ [{ suit: 'spades', rank: '5' }, { suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: '4' }],
      /* b seat1 team1 */ [{ suit: 'diamonds', rank: 'A' }, { suit: 'spades', rank: '4' }, { suit: 'hearts', rank: '4' }],
      /* c seat2 team0 */ [{ suit: 'hearts', rank: '5' }, { suit: 'clubs', rank: '5' }, { suit: 'clubs', rank: '6' }],
      /* d seat3 team1 */ [{ suit: 'hearts', rank: '6' }, { suit: 'diamonds', rank: '6' }, { suit: 'clubs', rank: '4' }],
    ])

    expect(g.callTruco('b')).toBe(true)               // 1 → 3
    expect(g.respond('a', true)).toBe(true)
    expect(g.tableState.stake).toBe(3)
    expect(g.playCard('b', { suit: 'diamonds', rank: 'A' })).toBe(true) // b plays, turn → c

    expect(g.callTruco('c')).toBe(true)                // 3 → 6
    expect(g.respond('d', true)).toBe(true)
    expect(g.tableState.stake).toBe(6)
    expect(g.playCard('c', { suit: 'hearts', rank: '5' })).toBe(true) // turn → d

    expect(g.callTruco('d')).toBe(true)                // 6 → 9
    expect(g.respond('a', true)).toBe(true)
    expect(g.tableState.stake).toBe(9)
    expect(g.playCard('d', { suit: 'hearts', rank: '6' })).toBe(true) // turn → a

    expect(g.callTruco('a')).toBe(true)                // 9 → 12
    expect(g.respond('b', true)).toBe(true)
    expect(g.tableState.stake).toBe(12)
    expect(g.playCard('a', { suit: 'spades', rank: '5' })).toBe(true) // vaza 1 complete, b (A♦) wins outright

    expect(g.tableState.vazaWinners).toEqual([1])
    expect(g.tableState.leaderSeat).toBe(1) // b leads vaza 2, team1, eligible to call
    expect(g.tableState.phase).toBe('playing')

    expect(g.callTruco('b')).toBe(false) // already at 12 — nothing higher to call
    expect(g.tableState.stake).toBe(12)
  })
})

// ─── Mão de 11 / Mão de Ferro ───────────────────────────────────────────────

describe('mão de 11', () => {
  test('reaching 11 gates the next hand behind a decision; declining cedes 1 point', () => {
    const g = makeGame('2x2')
    for (let i = 0; i < 11; i++) winSimpleHand(g, 0)
    expect(g.tableState.scores).toEqual([11, 0])

    g.startHand()
    expect(g.tableState.phase).toBe('mao_de_onze_decision')
    expect(g.isFerro()).toBe(false)

    const team0Player = g.players.find((p) => p.teamIndex === 0)!
    expect(g.teamHand(team0Player.id)).toHaveLength(6) // self + partner, 3 cards each

    expect(g.maoDeOnzeDecision(team0Player.id, false)).toBe(true)
    expect(g.tableState.phase).toBe('hand_end')
    expect(g.lastHandResult).toEqual({ winnerTeam: 1, points: 1, reason: 'mao_de_onze_run' })
    expect(g.tableState.scores).toEqual([11, 1])
  })

  test('mão de ferro: both teams at 11, both must accept before play resumes', () => {
    const g = makeGame('2x2')
    for (let i = 0; i < 11; i++) { winSimpleHand(g, 0); winSimpleHand(g, 1) }
    expect(g.tableState.scores).toEqual([11, 11])

    g.startHand()
    expect(g.tableState.phase).toBe('mao_de_onze_decision')
    expect(g.isFerro()).toBe(true)

    const p0 = g.players.find((p) => p.teamIndex === 0)?.id
    const p1 = g.players.find((p) => p.teamIndex === 1)?.id
    expect(g.maoDeOnzeDecision(p0, true)).toBe(true)
    expect(g.tableState.phase).toBe('mao_de_onze_decision') // still waiting on team1
    expect(g.maoDeOnzeDecision(p1, true)).toBe(true)
    expect(g.tableState.phase).toBe('playing')
  })
})

// ─── Match end & rematch (engine-level state) ──────────────────────────────

describe('match end and rematch', () => {
  test('match ends at 12; matchWins persist across resetForRematch', () => {
    const g = makeGame('1x1')
    for (let i = 0; i < 12; i++) winSimpleHand(g, 0)
    expect(g.isMatchOver()).toBe(true)
    expect(g.matchResult()).toEqual({ winnerTeam: 0, scores: [12, 0] })

    g.recordMatchWin(0)
    for (const p of g.players) expect(p.matchWins).toBe(p.teamIndex === 0 ? 1 : 0)

    g.resetForRematch()
    expect(g.tableState.scores).toEqual([0, 0])
    expect(g.isMatchOver()).toBe(false)
    for (const p of g.players) expect(p.matchWins).toBe(p.teamIndex === 0 ? 1 : 0) // persists

    g.startHand()
    expect(g.tableState.dealerSeat).toBe(0)
  })
})
