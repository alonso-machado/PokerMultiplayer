import type { Card } from '../../../shared/types'
import { rankValue } from './deck'

export interface HandResult {
  rank: number       // higher = better (1=high card … 9=royal flush)
  tiebreakers: number[]
  name: string
  bestCards: Card[]
}

export function evaluateHand(cards: Card[]): HandResult {
  const best = bestFiveFrom(cards)
  return { ...scoreHand(best), bestCards: best }
}

// pick best 5 from up to 7 cards
function bestFiveFrom(cards: Card[]): Card[] {
  if (cards.length <= 5) return cards
  let best: HandResult | null = null
  let bestCards: Card[] = []
  const combos = combinations(cards, 5)
  for (const combo of combos) {
    const result = scoreHand(combo)
    if (!best || compareHands(result, best) > 0) {
      best = result
      bestCards = combo
    }
  }
  return bestCards
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [first, ...rest] = arr
  const withFirst = combinations(rest, k - 1).map(c => [first!, ...c])
  const withoutFirst = combinations(rest, k)
  return [...withFirst, ...withoutFirst]
}

function scoreHand(cards: Card[]): HandResult {
  const values = cards.map(c => rankValue(c.rank)).sort((a, b) => b - a)
  const suits = cards.map(c => c.suit)
  const isFlush = suits.every(s => s === suits[0])
  const strHigh = straightHighCard(values)
  const isStraight = strHigh !== null
  const counts = countValues(values)

  if (isFlush && isStraight) {
    // Royal Flush: A-K-Q-J-10 of same suit (high=14, NOT a wheel)
    return strHigh === 14
      ? { rank: 9, tiebreakers: [14], name: 'Royal Flush' }
      : { rank: 8, tiebreakers: [strHigh], name: 'Straight Flush' }
  }
  if (counts[0]![0] === 4) return { rank: 7, tiebreakers: sortedCounts(counts), name: 'Four of a Kind' }
  if (counts[0]![0] === 3 && counts[1]![0] === 2) return { rank: 6, tiebreakers: sortedCounts(counts), name: 'Full House' }
  if (isFlush) return { rank: 5, tiebreakers: values, name: 'Flush' }
  if (isStraight) return { rank: 4, tiebreakers: [strHigh], name: 'Straight' }
  if (counts[0]![0] === 3) return { rank: 3, tiebreakers: sortedCounts(counts), name: 'Three of a Kind' }
  if (counts[0]![0] === 2 && counts[1]![0] === 2) return { rank: 2, tiebreakers: sortedCounts(counts), name: 'Two Pair' }
  if (counts[0]![0] === 2) return { rank: 1, tiebreakers: sortedCounts(counts), name: 'Pair' }
  return { rank: 0, tiebreakers: values, name: 'High Card' }
}

function countValues(values: number[]): [number, number][] {
  const map = new Map<number, number>()
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1)
  return [...map.entries()]
    .map(([val, cnt]) => [cnt, val] as [number, number])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1])
}

function sortedCounts(counts: [number, number][]): number[] {
  return counts.map(([, val]) => val)
}

/**
 * Returns the effective high card of the best straight in `values`, or null.
 * For the wheel (A-2-3-4-5) the Ace acts as 1, so the high card is 5 — not 14.
 * This matters for both tiebreaking and royal-flush detection.
 */
function straightHighCard(values: number[]): number | null {
  const unique = [...new Set(values)].sort((a, b) => b - a)
  if (unique.length < 5) return null
  if (unique[0]! - unique[4]! === 4) return unique[0]!
  // wheel: A-2-3-4-5 → effective high = 5
  if (unique[0] === 14) {
    const low = unique.slice(1)
    if (low.length >= 4 && low[0]! - low[3]! === 3 && low[3] === 2) return 5
  }
  return null
}

export function compareHands(a: HandResult, b: HandResult): number {
  if (a.rank !== b.rank) return a.rank - b.rank
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const diff = (a.tiebreakers[i] ?? 0) - (b.tiebreakers[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
