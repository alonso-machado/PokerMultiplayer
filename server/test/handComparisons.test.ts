/**
 * Same-rank hand comparison tests.
 *
 * Within each hand category the winner is determined solely by card values
 * in the order: A K Q J 10 9 8 7 6 5 4 3 2 (Ace highest, 2 lowest).
 *
 * Every test uses 7 cards (2 hole + 5 community) to match real game conditions.
 */

import { describe, test, expect } from 'bun:test'
import { evaluateHand, compareHands } from '../src/poker/handEvaluator'
import type { Card } from '../../shared/types'

function c(rank: string, suit: string): Card {
  return { rank: rank as Card['rank'], suit: suit as Card['suit'] }
}

function wins(a: Card[], b: Card[]): boolean {
  return compareHands(evaluateHand(a), evaluateHand(b)) > 0
}
function ties(a: Card[], b: Card[]): boolean {
  return compareHands(evaluateHand(a), evaluateHand(b)) === 0
}

/**
 * Returns `count` filler cards that never overlap with `exclude` and never
 * create a straight when combined with any single extra rank value.
 *
 * Pool: ['2','4','6','8','10','Q'] — all even ranks up to Q, gaps ≥ 2, so no
 * 5-consecutive run is possible when adding one more rank from outside the pool.
 * Pool has 6 items → after filtering out `exclude` we always have ≥ 5 left.
 * Suits alternate [♣♦♥♠♣…] so no suit ever reaches 5 across any 7-card hand.
 */
function fillers(exclude: string, count: number): Card[] {
  const pool = ['2','4','6','8','10','Q']
  const avail = pool.filter(r => r !== exclude)
  const suits = ['clubs','diamonds','hearts','spades'] as const
  return avail.slice(0, count).map((r, i) => c(r, suits[i % 4]!))
}

// ─── Pair ─────────────────────────────────────────────────────────────────────

describe('Pair vs Pair', () => {
  test('A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2', () => {
    const ranks = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'] as const
    // Build a pair for each rank using safe disconnected fillers
    function pairOf(rank: string): Card[] {
      return [c(rank, 'spades'), c(rank, 'hearts'), ...fillers(rank, 5)]
    }
    for (let i = 0; i < ranks.length - 1; i++) {
      const higher = pairOf(ranks[i]!)
      const lower  = pairOf(ranks[i + 1]!)
      expect(wins(higher, lower)).toBe(true)
    }
  })

  test('same pair rank — higher kicker wins', () => {
    // Both have a pair of 8s; first has A kicker, second has K kicker
    const aceKicker = [
      c('8','spades'), c('8','hearts'),
      c('A','clubs'), c('Q','diamonds'), c('J','spades'), c('2','hearts'), c('3','clubs'),
    ]
    const kingKicker = [
      c('8','clubs'), c('8','diamonds'),
      c('K','spades'), c('Q','hearts'), c('J','clubs'), c('2','diamonds'), c('3','spades'),
    ]
    expect(wins(aceKicker, kingKicker)).toBe(true)
  })

  test('same pair rank — second kicker breaks tie', () => {
    // Both pair of 8s with A kicker; first has K second kicker, second has Q
    const kingSecond = [
      c('8','spades'), c('8','hearts'),
      c('A','clubs'), c('K','diamonds'), c('J','spades'), c('2','hearts'), c('3','clubs'),
    ]
    const queenSecond = [
      c('8','clubs'), c('8','diamonds'),
      c('A','spades'), c('Q','hearts'), c('J','clubs'), c('2','diamonds'), c('3','spades'),
    ]
    expect(wins(kingSecond, queenSecond)).toBe(true)
  })

  test('identical pair + identical kickers = tie', () => {
    const a = [
      c('7','spades'), c('7','hearts'),
      c('A','clubs'), c('K','diamonds'), c('Q','spades'), c('2','hearts'), c('3','clubs'),
    ]
    const b = [
      c('7','clubs'), c('7','diamonds'),
      c('A','spades'), c('K','hearts'), c('Q','clubs'), c('2','diamonds'), c('3','spades'),
    ]
    expect(ties(a, b)).toBe(true)
  })
})

// ─── Two Pair ─────────────────────────────────────────────────────────────────

describe('Two Pair vs Two Pair', () => {
  test('higher top pair wins (AA > KK in top pair)', () => {
    const aces = [
      c('A','spades'), c('A','hearts'),
      c('2','clubs'), c('2','diamonds'), c('K','spades'), c('Q','hearts'), c('J','clubs'),
    ]
    const kings = [
      c('K','clubs'), c('K','diamonds'),
      c('Q','spades'), c('Q','hearts'), c('2','clubs'), c('3','diamonds'), c('5','spades'),
    ]
    expect(wins(aces, kings)).toBe(true)
  })

  test('same top pair — higher second pair wins (AA+KK > AA+QQ)', () => {
    const aaKK = [
      c('A','spades'), c('A','hearts'),
      c('K','clubs'), c('K','diamonds'), c('2','spades'), c('3','hearts'), c('4','clubs'),
    ]
    const aaQQ = [
      c('A','clubs'), c('A','diamonds'),
      c('Q','spades'), c('Q','hearts'), c('2','clubs'), c('3','diamonds'), c('4','spades'),
    ]
    expect(wins(aaKK, aaQQ)).toBe(true)
  })

  test('same two pairs — kicker decides', () => {
    const kicker_K = [
      c('A','spades'), c('A','hearts'),
      c('K','clubs'), c('K','diamonds'), c('Q','spades'), c('J','hearts'), c('9','clubs'),
    ]
    const kicker_J = [
      c('A','clubs'), c('A','diamonds'),
      c('K','spades'), c('K','hearts'), c('J','clubs'), c('10','diamonds'), c('8','spades'),
    ]
    expect(wins(kicker_K, kicker_J)).toBe(true)
  })

  test('best two pair chosen from 3 available pairs — KK+QQ beats QQ+JJ', () => {
    // Hole: K K | Community: Q Q J J 2  → three pairs, best = KK+QQ
    const threeP = [
      c('K','spades'), c('K','hearts'),
      c('Q','clubs'), c('Q','diamonds'), c('J','spades'), c('J','hearts'), c('2','clubs'),
    ]
    const qqJJ = [
      c('Q','spades'), c('Q','hearts'),
      c('J','clubs'), c('J','diamonds'), c('2','spades'), c('3','hearts'), c('4','clubs'),
    ]
    expect(wins(threeP, qqJJ)).toBe(true)
  })
})

// ─── Three of a Kind ──────────────────────────────────────────────────────────

describe('Three of a Kind vs Three of a Kind', () => {
  test('A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2', () => {
    const ranks = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'] as const
    function tripsOf(rank: string): Card[] {
      return [c(rank, 'spades'), c(rank, 'hearts'), c(rank, 'clubs'), ...fillers(rank, 4)]
    }
    for (let i = 0; i < ranks.length - 1; i++) {
      expect(wins(tripsOf(ranks[i]!), tripsOf(ranks[i + 1]!))).toBe(true)
    }
  })

  test('same trips rank — higher kicker wins', () => {
    const aceKicker = [
      c('7','spades'), c('7','hearts'), c('7','clubs'),
      c('A','diamonds'), c('K','spades'), c('2','hearts'), c('3','clubs'),
    ]
    const kingKicker = [
      c('7','diamonds'), c('7','hearts'), c('7','clubs'),
      c('K','spades'), c('Q','diamonds'), c('2','hearts'), c('3','clubs'),
    ]
    expect(wins(aceKicker, kingKicker)).toBe(true)
  })
})

// ─── Straight ─────────────────────────────────────────────────────────────────

describe('Straight vs Straight', () => {
  test('broadway A-K-Q-J-10 beats every lower straight', () => {
    const broadway = [
      c('A','spades'), c('K','hearts'),
      c('Q','clubs'), c('J','diamonds'), c('10','spades'), c('2','hearts'), c('3','clubs'),
    ]
    const straights = [
      [c('K','spades'), c('Q','hearts'), c('J','clubs'), c('10','diamonds'), c('9','spades'), c('2','hearts'), c('3','clubs')],
      [c('9','spades'), c('8','hearts'), c('7','clubs'), c('6','diamonds'), c('5','spades'), c('2','hearts'), c('3','clubs')],
      [c('5','spades'), c('4','hearts'), c('3','clubs'), c('2','diamonds'), c('A','spades'), c('K','hearts'), c('Q','clubs')], // wheel
    ]
    for (const s of straights) expect(wins(broadway, s)).toBe(true)
  })

  test('K-Q-J-10-9 beats Q-J-10-9-8', () => {
    const king = [
      c('K','spades'), c('Q','hearts'),
      c('J','clubs'), c('10','diamonds'), c('9','spades'), c('2','hearts'), c('3','clubs'),
    ]
    const queen = [
      c('Q','spades'), c('J','hearts'),
      c('10','clubs'), c('9','diamonds'), c('8','spades'), c('2','hearts'), c('3','clubs'),
    ]
    expect(wins(king, queen)).toBe(true)
  })

  test('wheel (A-2-3-4-5) loses to 6-high straight (2-3-4-5-6)', () => {
    const wheel = [
      c('A','spades'), c('2','hearts'),
      c('3','clubs'), c('4','diamonds'), c('5','spades'), c('K','hearts'), c('Q','clubs'),
    ]
    const sixHigh = [
      c('6','spades'), c('5','hearts'),
      c('4','clubs'), c('3','diamonds'), c('2','spades'), c('K','hearts'), c('Q','clubs'),
    ]
    expect(wins(sixHigh, wheel)).toBe(true)
  })

  test('identical straights from board tie', () => {
    const a = [c('9','spades'), c('8','hearts'), c('7','clubs'), c('6','diamonds'), c('5','spades'), c('2','hearts'), c('3','clubs')]
    const b = [c('9','clubs'), c('8','diamonds'), c('7','spades'), c('6','hearts'), c('5','clubs'), c('2','spades'), c('3','diamonds')]
    expect(ties(a, b)).toBe(true)
  })
})

// ─── Flush ────────────────────────────────────────────────────────────────────

describe('Flush vs Flush', () => {
  test('ace-high flush beats king-high flush', () => {
    const aceHigh = [
      c('A','spades'), c('J','spades'),
      c('9','spades'), c('7','spades'), c('5','spades'), c('2','hearts'), c('3','clubs'),
    ]
    const kingHigh = [
      c('K','clubs'), c('J','clubs'),
      c('9','clubs'), c('7','clubs'), c('5','clubs'), c('2','hearts'), c('3','spades'),
    ]
    expect(wins(aceHigh, kingHigh)).toBe(true)
  })

  test('same high card — second card decides', () => {
    const aK = [c('A','hearts'), c('K','hearts'), c('9','hearts'), c('7','hearts'), c('5','hearts'), c('2','spades'), c('3','clubs')]
    const aQ = [c('A','clubs'),  c('Q','clubs'),  c('9','clubs'),  c('7','clubs'),  c('5','clubs'),  c('2','spades'), c('3','hearts')]
    expect(wins(aK, aQ)).toBe(true)
  })

  test('best 5 spades chosen when 6 share a suit', () => {
    // 6 spades — best 5 = A K Q J 9 (drop 2)
    const result = evaluateHand([
      c('A','spades'), c('K','spades'),
      c('Q','spades'), c('J','spades'), c('9','spades'), c('2','spades'), c('3','hearts'),
    ])
    expect(result.rank).toBe(5)
    expect(result.tiebreakers[0]).toBe(14) // A
    expect(result.tiebreakers[1]).toBe(13) // K
    expect(result.tiebreakers[4]).toBe(9)  // 9 (2 excluded)
  })
})

// ─── Full House ───────────────────────────────────────────────────────────────

describe('Full House vs Full House', () => {
  test('higher trips rank wins (AAA-22 > KKK-AA)', () => {
    const aces = [
      c('A','spades'), c('A','hearts'), c('A','clubs'),
      c('2','diamonds'), c('2','spades'), c('K','hearts'), c('Q','clubs'),
    ]
    const kings = [
      c('K','spades'), c('K','hearts'), c('K','clubs'),
      c('A','diamonds'), c('A','spades'), c('2','hearts'), c('3','clubs'),
    ]
    expect(wins(aces, kings)).toBe(true)
  })

  test('same trips rank — higher pair wins (AAA-KK > AAA-QQ)', () => {
    const aaaKK = [
      c('A','spades'), c('A','hearts'), c('A','clubs'),
      c('K','diamonds'), c('K','spades'), c('2','hearts'), c('3','clubs'),
    ]
    const aaaQQ = [
      c('A','diamonds'), c('A','hearts'), c('A','clubs'),
      c('Q','spades'), c('Q','hearts'), c('2','diamonds'), c('3','spades'),
    ]
    expect(wins(aaaKK, aaaQQ)).toBe(true)
  })

  test('best full house chosen when 7 cards allow AAAKK vs KKKAA', () => {
    // Hole: A A | Community: A K K K 2 → possible FH: AAA+KK or KKK+AA
    // AAA+KK wins because trips A(14) > trips K(13)
    const result = evaluateHand([
      c('A','spades'), c('A','hearts'),
      c('A','diamonds'), c('K','spades'), c('K','hearts'), c('K','clubs'), c('2','clubs'),
    ])
    expect(result.rank).toBe(6)
    expect(result.tiebreakers[0]).toBe(14) // trips Aces chosen over trips Kings
  })
})

// ─── Four of a Kind ───────────────────────────────────────────────────────────

describe('Four of a Kind vs Four of a Kind', () => {
  test('higher quads rank wins (AAAA > KKKK)', () => {
    const aces = [
      c('A','spades'), c('A','hearts'),
      c('A','clubs'), c('A','diamonds'), c('2','spades'), c('3','hearts'), c('4','clubs'),
    ]
    const kings = [
      c('K','spades'), c('K','hearts'),
      c('K','clubs'), c('K','diamonds'), c('A','spades'), c('3','hearts'), c('4','clubs'),
    ]
    expect(wins(aces, kings)).toBe(true)
  })

  test('A K Q J 10 9 8 7 6 5 4 3 2 quad order', () => {
    const ranks = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'] as const
    function quadsOf(rank: string): Card[] {
      return [c(rank, 'spades'), c(rank, 'hearts'), c(rank, 'clubs'), c(rank, 'diamonds'), ...fillers(rank, 3)]
    }
    for (let i = 0; i < ranks.length - 1; i++) {
      expect(wins(quadsOf(ranks[i]!), quadsOf(ranks[i + 1]!))).toBe(true)
    }
  })

  test('same quads rank — higher kicker wins', () => {
    const aceKicker = [
      c('7','spades'), c('7','hearts'), c('7','clubs'), c('7','diamonds'),
      c('A','spades'), c('2','hearts'), c('3','clubs'),
    ]
    const kingKicker = [
      c('7','spades'), c('7','hearts'), c('7','clubs'), c('7','diamonds'),
      c('K','spades'), c('2','hearts'), c('3','clubs'),
    ]
    expect(wins(aceKicker, kingKicker)).toBe(true)
  })
})

// ─── Straight Flush ───────────────────────────────────────────────────────────

describe('Straight Flush vs Straight Flush', () => {
  test('K-high SF beats 9-high SF', () => {
    const king = [
      c('K','clubs'), c('Q','clubs'),
      c('J','clubs'), c('10','clubs'), c('9','clubs'), c('2','hearts'), c('3','diamonds'),
    ]
    const nine = [
      c('9','spades'), c('8','spades'),
      c('7','spades'), c('6','spades'), c('5','spades'), c('2','hearts'), c('3','diamonds'),
    ]
    expect(wins(king, nine)).toBe(true)
  })

  test('steel wheel (A-2-3-4-5 suited) loses to 6-high SF', () => {
    const wheel = [
      c('A','hearts'), c('2','hearts'),
      c('3','hearts'), c('4','hearts'), c('5','hearts'), c('K','clubs'), c('Q','clubs'),
    ]
    const sixHigh = [
      c('6','diamonds'), c('5','diamonds'),
      c('4','diamonds'), c('3','diamonds'), c('2','diamonds'), c('K','clubs'), c('Q','clubs'),
    ]
    expect(wins(sixHigh, wheel)).toBe(true)
  })

  test('identical straight flushes tie', () => {
    const a = [c('9','spades'), c('8','spades'), c('7','spades'), c('6','spades'), c('5','spades'), c('2','hearts'), c('K','clubs')]
    const b = [c('9','clubs'),  c('8','clubs'),  c('7','clubs'),  c('6','clubs'),  c('5','clubs'),  c('2','hearts'), c('K','spades')]
    expect(ties(a, b)).toBe(true)
  })
})

// ─── High Card ────────────────────────────────────────────────────────────────

describe('High Card vs High Card', () => {
  test('A-high beats K-high', () => {
    const aceHigh  = [c('A','spades'), c('J','hearts'), c('9','clubs'), c('7','diamonds'), c('5','spades'), c('3','hearts'), c('2','clubs')]
    const kingHigh = [c('K','clubs'),  c('J','spades'), c('9','hearts'), c('7','clubs'),  c('5','diamonds'), c('3','spades'), c('2','hearts')]
    expect(wins(aceHigh, kingHigh)).toBe(true)
  })

  test('same high card — second card breaks tie', () => {
    const aK = [c('A','spades'), c('K','hearts'), c('9','clubs'), c('7','diamonds'), c('5','spades'), c('3','hearts'), c('2','clubs')]
    const aQ = [c('A','clubs'),  c('Q','spades'), c('9','hearts'), c('7','clubs'),  c('5','diamonds'), c('3','spades'), c('2','hearts')]
    expect(wins(aK, aQ)).toBe(true)
  })

  test('completely identical high card hands tie', () => {
    // Both share the same 5 best cards through the board
    const a = [c('A','spades'), c('2','hearts'), c('K','clubs'), c('Q','diamonds'), c('J','spades'), c('9','hearts'), c('7','clubs')]
    const b = [c('A','clubs'),  c('3','diamonds'), c('K','spades'), c('Q','hearts'), c('J','clubs'), c('9','diamonds'), c('7','spades')]
    // Best 5 for both: A K Q J 9 → tie
    expect(ties(a, b)).toBe(true)
  })
})
