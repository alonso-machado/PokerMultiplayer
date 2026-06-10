/**
 * Hand evaluator unit tests — one suite per hand rank.
 *
 * Every test uses 7 cards (2 hole + 5 community) to match real game conditions.
 * The evaluator must pick the best 5-card combination from the 7.
 *
 * Hand ranks (higher = better):
 *   9 Royal Flush | 8 Straight Flush | 7 Four of a Kind | 6 Full House
 *   5 Flush        | 4 Straight        | 3 Three of a Kind | 2 Two Pair
 *   1 Pair         | 0 High Card
 */

import { describe, test, expect } from 'bun:test'
import { evaluateHand, compareHands } from '../src/poker/handEvaluator'
import type { Card } from '../../shared/types'

function c(rank: string, suit: string): Card {
  return { rank: rank as Card['rank'], suit: suit as Card['suit'] }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Royal Flush', () => {
  test('detects royal flush from 7 cards', () => {
    // Hole: A♠ K♠  |  Community: Q♠ J♠ 10♠  2♥ 3♦
    const result = evaluateHand([
      c('A','spades'), c('K','spades'),
      c('Q','spades'), c('J','spades'), c('10','spades'), c('2','hearts'), c('3','diamonds'),
    ])
    expect(result.rank).toBe(9)
    expect(result.name).toBe('Royal Flush')
    expect(result.bestCards).toHaveLength(5)
  })

  test('royal flush beats straight flush', () => {
    const royal = evaluateHand([
      c('A','hearts'), c('K','hearts'),
      c('Q','hearts'), c('J','hearts'), c('10','hearts'), c('2','clubs'), c('3','clubs'),
    ])
    const sf = evaluateHand([
      c('9','diamonds'), c('8','diamonds'),
      c('7','diamonds'), c('6','diamonds'), c('5','diamonds'), c('2','clubs'), c('3','clubs'),
    ])
    expect(compareHands(royal, sf)).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Straight Flush', () => {
  test('detects straight flush from 7 cards', () => {
    // Hole: 9♣ 8♣  |  Community: 7♣ 6♣ 5♣  K♥ 2♦
    const result = evaluateHand([
      c('9','clubs'), c('8','clubs'),
      c('7','clubs'), c('6','clubs'), c('5','clubs'), c('K','hearts'), c('2','diamonds'),
    ])
    expect(result.rank).toBe(8)
    expect(result.name).toBe('Straight Flush')
  })

  test('higher straight flush beats lower', () => {
    const high = evaluateHand([
      c('K','spades'), c('Q','spades'),
      c('J','spades'), c('10','spades'), c('9','spades'), c('2','hearts'), c('3','diamonds'),
    ])
    const low = evaluateHand([
      c('8','spades'), c('7','spades'),
      c('6','spades'), c('5','spades'), c('4','spades'), c('2','hearts'), c('3','diamonds'),
    ])
    expect(compareHands(high, low)).toBeGreaterThan(0)
  })

  test('steel wheel (A-2-3-4-5 same suit) is a straight flush', () => {
    const result = evaluateHand([
      c('A','hearts'), c('2','hearts'),
      c('3','hearts'), c('4','hearts'), c('5','hearts'), c('K','clubs'), c('Q','clubs'),
    ])
    expect(result.rank).toBe(8)
    expect(result.name).toBe('Straight Flush')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Four of a Kind', () => {
  test('detects quads from 7 cards', () => {
    // Hole: A♠ A♥  |  Community: A♦ A♣ K♠  2♥ 3♦
    const result = evaluateHand([
      c('A','spades'), c('A','hearts'),
      c('A','diamonds'), c('A','clubs'), c('K','spades'), c('2','hearts'), c('3','diamonds'),
    ])
    expect(result.rank).toBe(7)
    expect(result.name).toBe('Four of a Kind')
    expect(result.bestCards).toHaveLength(5)
  })

  test('quads beats full house', () => {
    const quads = evaluateHand([
      c('7','spades'), c('7','hearts'),
      c('7','diamonds'), c('7','clubs'), c('K','spades'), c('2','hearts'), c('3','diamonds'),
    ])
    const fh = evaluateHand([
      c('A','spades'), c('A','hearts'),
      c('A','diamonds'), c('K','clubs'), c('K','hearts'), c('2','clubs'), c('3','clubs'),
    ])
    expect(compareHands(quads, fh)).toBeGreaterThan(0)
  })

  test('higher quads beats lower quads', () => {
    const aces = evaluateHand([
      c('A','spades'), c('A','hearts'),
      c('A','diamonds'), c('A','clubs'), c('2','spades'), c('3','hearts'), c('4','diamonds'),
    ])
    const twos = evaluateHand([
      c('2','spades'), c('2','hearts'),
      c('2','diamonds'), c('2','clubs'), c('A','spades'), c('K','hearts'), c('Q','diamonds'),
    ])
    expect(compareHands(aces, twos)).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Full House', () => {
  test('detects full house from 7 cards', () => {
    // Hole: K♠ K♥  |  Community: K♦ Q♠ Q♥  2♣ 3♣
    const result = evaluateHand([
      c('K','spades'), c('K','hearts'),
      c('K','diamonds'), c('Q','spades'), c('Q','hearts'), c('2','clubs'), c('3','clubs'),
    ])
    expect(result.rank).toBe(6)
    expect(result.name).toBe('Full House')
  })

  test('full house beats flush', () => {
    const fh = evaluateHand([
      c('J','spades'), c('J','hearts'),
      c('J','diamonds'), c('5','spades'), c('5','hearts'), c('2','clubs'), c('3','clubs'),
    ])
    const flush = evaluateHand([
      c('A','clubs'), c('K','clubs'),
      c('Q','clubs'), c('J','clubs'), c('9','clubs'), c('2','hearts'), c('3','diamonds'),
    ])
    expect(compareHands(fh, flush)).toBeGreaterThan(0)
  })

  test('best full house chosen when 7 cards offer multiple combos', () => {
    // Hole: A♠ A♥  |  Community: A♦ K♠ K♥ K♦ 2♣
    // Possible: AAAKK (rank 6, trips A + pair K) or KKKAA (rank 6, trips K + pair A)
    // AAAKK wins because trips A > trips K
    const result = evaluateHand([
      c('A','spades'), c('A','hearts'),
      c('A','diamonds'), c('K','spades'), c('K','hearts'), c('K','diamonds'), c('2','clubs'),
    ])
    expect(result.rank).toBe(6)
    // Tiebreaker[0] should be trip rank (Ace=14 vs King=13) → Aces win
    expect(result.tiebreakers[0]).toBe(14)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Flush', () => {
  test('detects flush from 7 cards', () => {
    // Hole: A♦ K♦  |  Community: Q♦ 8♦ 5♦  2♠ 3♥
    const result = evaluateHand([
      c('A','diamonds'), c('K','diamonds'),
      c('Q','diamonds'), c('8','diamonds'), c('5','diamonds'), c('2','spades'), c('3','hearts'),
    ])
    expect(result.rank).toBe(5)
    expect(result.name).toBe('Flush')
  })

  test('flush beats straight', () => {
    const flush = evaluateHand([
      c('A','clubs'), c('J','clubs'),
      c('9','clubs'), c('7','clubs'), c('5','clubs'), c('2','hearts'), c('3','diamonds'),
    ])
    const straight = evaluateHand([
      c('A','spades'), c('K','hearts'),
      c('Q','clubs'), c('J','diamonds'), c('10','spades'), c('2','hearts'), c('3','clubs'),
    ])
    expect(compareHands(flush, straight)).toBeGreaterThan(0)
  })

  test('highest card breaks flush tie', () => {
    const aceHigh = evaluateHand([
      c('A','hearts'), c('2','hearts'),
      c('5','hearts'), c('7','hearts'), c('9','hearts'), c('3','spades'), c('4','clubs'),
    ])
    const kingHigh = evaluateHand([
      c('K','hearts'), c('2','hearts'),
      c('5','hearts'), c('7','hearts'), c('9','hearts'), c('3','spades'), c('4','clubs'),
    ])
    expect(compareHands(aceHigh, kingHigh)).toBeGreaterThan(0)
  })

  test('best 5 chosen when 6 or 7 cards share a suit', () => {
    // 6 spades — evaluator should pick the 5 highest
    const result = evaluateHand([
      c('A','spades'), c('K','spades'),
      c('Q','spades'), c('J','spades'), c('9','spades'), c('2','spades'), c('3','hearts'),
    ])
    expect(result.rank).toBe(5)
    // Best 5 spades: A K Q J 9 (drop 2♠)
    const vals = result.tiebreakers
    expect(vals[0]).toBe(14) // A
    expect(vals[1]).toBe(13) // K
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Straight', () => {
  test('detects straight from 7 cards', () => {
    // Hole: 9♠ 8♥  |  Community: 7♦ 6♣ 5♠  A♥ K♦
    const result = evaluateHand([
      c('9','spades'), c('8','hearts'),
      c('7','diamonds'), c('6','clubs'), c('5','spades'), c('A','hearts'), c('K','diamonds'),
    ])
    expect(result.rank).toBe(4)
    expect(result.name).toBe('Straight')
  })

  test('broadway (A-K-Q-J-10) is a straight', () => {
    const result = evaluateHand([
      c('A','spades'), c('K','hearts'),
      c('Q','clubs'), c('J','diamonds'), c('10','spades'), c('2','hearts'), c('3','clubs'),
    ])
    expect(result.rank).toBe(4)
    expect(result.tiebreakers[0]).toBe(14)
  })

  test('wheel (A-2-3-4-5) is a straight', () => {
    const result = evaluateHand([
      c('A','spades'), c('2','hearts'),
      c('3','clubs'), c('4','diamonds'), c('5','spades'), c('K','hearts'), c('Q','clubs'),
    ])
    expect(result.rank).toBe(4)
    expect(result.name).toBe('Straight')
  })

  test('wheel (A-2-3-4-5) loses to 6-high straight', () => {
    const wheel = evaluateHand([
      c('A','spades'), c('2','hearts'),
      c('3','clubs'), c('4','diamonds'), c('5','spades'), c('K','hearts'), c('Q','clubs'),
    ])
    const sixHigh = evaluateHand([
      c('6','spades'), c('5','hearts'),
      c('4','clubs'), c('3','diamonds'), c('2','spades'), c('K','hearts'), c('Q','clubs'),
    ])
    // Both are straights but 6-high > 5-high (wheel)
    expect(compareHands(sixHigh, wheel)).toBeGreaterThan(0)
  })

  test('higher straight beats lower', () => {
    const broadway = evaluateHand([
      c('A','spades'), c('K','hearts'),
      c('Q','clubs'), c('J','diamonds'), c('10','spades'), c('2','hearts'), c('3','clubs'),
    ])
    const nine = evaluateHand([
      c('9','spades'), c('8','hearts'),
      c('7','clubs'), c('6','diamonds'), c('5','spades'), c('2','hearts'), c('3','clubs'),
    ])
    expect(compareHands(broadway, nine)).toBeGreaterThan(0)
  })

  test('straight beats three of a kind', () => {
    const str = evaluateHand([
      c('9','spades'), c('8','hearts'),
      c('7','clubs'), c('6','diamonds'), c('5','spades'), c('2','hearts'), c('3','clubs'),
    ])
    const trips = evaluateHand([
      c('A','spades'), c('A','hearts'),
      c('A','clubs'), c('K','diamonds'), c('Q','spades'), c('2','hearts'), c('3','clubs'),
    ])
    expect(compareHands(str, trips)).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Three of a Kind', () => {
  test('detects trips from 7 cards', () => {
    // Hole: J♠ J♥  |  Community: J♦ A♠ K♠  2♥ 3♣
    const result = evaluateHand([
      c('J','spades'), c('J','hearts'),
      c('J','diamonds'), c('A','spades'), c('K','spades'), c('2','hearts'), c('3','clubs'),
    ])
    expect(result.rank).toBe(3)
    expect(result.name).toBe('Three of a Kind')
  })

  test('trips beats two pair', () => {
    const trips = evaluateHand([
      c('5','spades'), c('5','hearts'),
      c('5','clubs'), c('A','diamonds'), c('K','spades'), c('2','hearts'), c('3','clubs'),
    ])
    const twoPair = evaluateHand([
      c('A','spades'), c('A','hearts'),
      c('K','clubs'), c('K','diamonds'), c('Q','spades'), c('2','hearts'), c('3','clubs'),
    ])
    expect(compareHands(trips, twoPair)).toBeGreaterThan(0)
  })

  test('higher trips rank beats lower', () => {
    const aceTrips = evaluateHand([
      c('A','spades'), c('A','hearts'),
      c('A','clubs'), c('2','diamonds'), c('3','spades'), c('4','hearts'), c('5','clubs'),
    ])
    const twoTrips = evaluateHand([
      c('2','spades'), c('2','hearts'),
      c('2','clubs'), c('A','diamonds'), c('K','spades'), c('Q','hearts'), c('J','clubs'),
    ])
    expect(compareHands(aceTrips, twoTrips)).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Two Pair', () => {
  test('detects two pair from 7 cards', () => {
    // Hole: A♠ A♥  |  Community: K♠ K♥ Q♠  2♣ 3♦
    const result = evaluateHand([
      c('A','spades'), c('A','hearts'),
      c('K','spades'), c('K','hearts'), c('Q','spades'), c('2','clubs'), c('3','diamonds'),
    ])
    expect(result.rank).toBe(2)
    expect(result.name).toBe('Two Pair')
  })

  test('two pair beats one pair', () => {
    const twoPair = evaluateHand([
      c('3','spades'), c('3','hearts'),
      c('2','clubs'), c('2','diamonds'), c('A','spades'), c('K','hearts'), c('Q','clubs'),
    ])
    const onePair = evaluateHand([
      c('A','spades'), c('A','hearts'),
      c('K','clubs'), c('Q','diamonds'), c('J','spades'), c('9','hearts'), c('8','clubs'),
    ])
    expect(compareHands(twoPair, onePair)).toBeGreaterThan(0)
  })

  test('best two pair chosen from 3 pairs in 7 cards', () => {
    // Hole: A♠ A♥  |  Community: K♠ K♥ Q♠ Q♥ 2♣
    // Three pairs: AA, KK, QQ — best two pair = AA+KK
    const result = evaluateHand([
      c('A','spades'), c('A','hearts'),
      c('K','spades'), c('K','hearts'), c('Q','spades'), c('Q','hearts'), c('2','clubs'),
    ])
    expect(result.rank).toBe(2)
    expect(result.tiebreakers[0]).toBe(14) // top pair: Aces
    expect(result.tiebreakers[1]).toBe(13) // second pair: Kings
  })

  test('higher top pair wins two-pair tie', () => {
    const aceKing = evaluateHand([
      c('A','spades'), c('A','hearts'),
      c('K','clubs'), c('K','diamonds'), c('2','spades'), c('3','hearts'), c('4','clubs'),
    ])
    const kingQueen = evaluateHand([
      c('K','spades'), c('K','hearts'),
      c('Q','clubs'), c('Q','diamonds'), c('A','spades'), c('3','hearts'), c('4','clubs'),
    ])
    expect(compareHands(aceKing, kingQueen)).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Pair', () => {
  test('detects pair from 7 cards — the reported bug scenario', () => {
    // Hole: 4♠ K♥  |  Community: 4♦ 2♣ 7♥ J♠ 9♦
    // The 4 in hand + 4 on board = Pair — must NOT evaluate as high card
    const result = evaluateHand([
      c('4','spades'), c('K','hearts'),
      c('4','diamonds'), c('2','clubs'), c('7','hearts'), c('J','spades'), c('9','diamonds'),
    ])
    expect(result.rank).toBe(1)
    expect(result.name).toBe('Pair')
  })

  test('pair of 4s beats pair of 2s', () => {
    const fours = evaluateHand([
      c('4','spades'), c('K','hearts'),
      c('4','diamonds'), c('2','clubs'), c('7','hearts'), c('J','spades'), c('9','diamonds'),
    ])
    const twos = evaluateHand([
      c('2','spades'), c('2','hearts'),
      c('A','diamonds'), c('K','clubs'), c('Q','hearts'), c('J','spades'), c('9','diamonds'),
    ])
    expect(compareHands(fours, twos)).toBeGreaterThan(0)
  })

  test('pair beats high card', () => {
    const pair = evaluateHand([
      c('2','spades'), c('2','hearts'),
      c('A','clubs'), c('K','diamonds'), c('Q','spades'), c('J','hearts'), c('9','clubs'),
    ])
    const highCard = evaluateHand([
      c('A','spades'), c('K','hearts'),
      c('Q','clubs'), c('J','diamonds'), c('9','spades'), c('7','hearts'), c('5','clubs'),
    ])
    expect(compareHands(pair, highCard)).toBeGreaterThan(0)
  })

  test('kicker breaks pair tie', () => {
    const aceKicker = evaluateHand([
      c('J','spades'), c('J','hearts'),
      c('A','clubs'), c('K','diamonds'), c('Q','spades'), c('2','hearts'), c('3','clubs'),
    ])
    const kingKicker = evaluateHand([
      c('J','clubs'), c('J','diamonds'),
      c('K','spades'), c('Q','hearts'), c('10','clubs'), c('2','spades'), c('3','diamonds'),
    ])
    expect(compareHands(aceKicker, kingKicker)).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('High Card', () => {
  test('detects high card when no other hand present', () => {
    // Hole: A♠ K♥  |  Community: Q♦ J♣ 9♥  2♠ 4♦  — no flush, no straight
    const result = evaluateHand([
      c('A','spades'), c('K','hearts'),
      c('Q','diamonds'), c('J','clubs'), c('9','hearts'), c('2','spades'), c('4','diamonds'),
    ])
    expect(result.rank).toBe(0)
    expect(result.name).toBe('High Card')
  })

  test('ace-high beats king-high', () => {
    const aceHigh = evaluateHand([
      c('A','spades'), c('2','hearts'),
      c('4','clubs'), c('6','diamonds'), c('8','spades'), c('10','hearts'), c('Q','clubs'),
    ])
    const kingHigh = evaluateHand([
      c('K','spades'), c('2','hearts'),
      c('4','clubs'), c('6','diamonds'), c('8','spades'), c('10','hearts'), c('Q','clubs'),
    ])
    expect(compareHands(aceHigh, kingHigh)).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Hand ranking order (all 10 hands)', () => {
  // Build one representative hand for each rank and verify the strict ordering
  const royalFlush = evaluateHand([
    c('A','clubs'), c('K','clubs'), c('Q','clubs'), c('J','clubs'), c('10','clubs'), c('2','spades'), c('3','hearts'),
  ])
  const straightFlush = evaluateHand([
    c('9','diamonds'), c('8','diamonds'), c('7','diamonds'), c('6','diamonds'), c('5','diamonds'), c('2','spades'), c('3','hearts'),
  ])
  const quads = evaluateHand([
    c('K','spades'), c('K','hearts'), c('K','diamonds'), c('K','clubs'), c('A','spades'), c('2','hearts'), c('3','clubs'),
  ])
  const fullHouse = evaluateHand([
    c('Q','spades'), c('Q','hearts'), c('Q','clubs'), c('J','diamonds'), c('J','spades'), c('2','hearts'), c('3','clubs'),
  ])
  const flush = evaluateHand([
    c('A','hearts'), c('K','hearts'), c('Q','hearts'), c('J','hearts'), c('9','hearts'), c('2','spades'), c('3','clubs'),
  ])
  const straight = evaluateHand([
    c('A','spades'), c('K','hearts'), c('Q','clubs'), c('J','diamonds'), c('10','spades'), c('2','hearts'), c('3','clubs'),
  ])
  const trips = evaluateHand([
    c('J','spades'), c('J','hearts'), c('J','clubs'), c('A','diamonds'), c('K','spades'), c('2','hearts'), c('3','clubs'),
  ])
  const twoPair = evaluateHand([
    c('A','spades'), c('A','hearts'), c('K','clubs'), c('K','diamonds'), c('Q','spades'), c('2','hearts'), c('3','clubs'),
  ])
  const pair = evaluateHand([
    c('A','spades'), c('A','hearts'), c('K','clubs'), c('Q','diamonds'), c('J','spades'), c('9','hearts'), c('8','clubs'),
  ])
  const highCard = evaluateHand([
    c('A','spades'), c('K','hearts'), c('Q','clubs'), c('J','diamonds'), c('9','spades'), c('7','hearts'), c('5','clubs'),
  ])

  const hands = [royalFlush, straightFlush, quads, fullHouse, flush, straight, trips, twoPair, pair, highCard]
  const names = ['Royal Flush','Straight Flush','Four of a Kind','Full House','Flush','Straight','Three of a Kind','Two Pair','Pair','High Card']

  test('each hand has the correct rank value', () => {
    const expectedRanks = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
    hands.forEach((h, i) => {
      expect(h.rank).toBe(expectedRanks[i])
      expect(h.name).toBe(names[i])
    })
  })

  test('every stronger hand beats every weaker hand (45 comparisons)', () => {
    for (let i = 0; i < hands.length; i++) {
      for (let j = i + 1; j < hands.length; j++) {
        expect(compareHands(hands[i]!, hands[j]!)).toBeGreaterThan(0)
      }
    }
  })
})
