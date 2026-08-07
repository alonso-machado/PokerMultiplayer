import type { Card, Suit, Rank } from '../../../shared/types'

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

/** Single 52-card deck, no jokers — see .claude/Blackjack.md → "Baralho".
 *  Reshuffled fresh at the start of every round (no persistent shoe). */
export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank })
    }
  }
  return deck
}

export function shuffle<T>(deck: T[]): T[] {
  const d = [...deck]
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[d[i], d[j]] = [d[j]!, d[i]!]
  }
  return d
}

export interface HandValue {
  total: number
  /** True when the best total still counts at least one Ace as 11 (not just 1). */
  soft: boolean
}

/** Best non-busting total for a hand: face cards = 10, Ace = 11 unless that
 *  would bust, in which case Aces fall back to 1 one at a time. */
export function handValue(cards: Card[]): HandValue {
  let total = 0
  let acesAs11 = 0
  for (const c of cards) {
    if (c.rank === 'A') { acesAs11++; total += 11 }
    else if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K' || c.rank === '10') total += 10
    else total += Number(c.rank)
  }
  while (total > 21 && acesAs11 > 0) { total -= 10; acesAs11-- }
  return { total, soft: acesAs11 > 0 }
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards).total > 21
}

/** Natural blackjack — exactly the original 2-card deal totalling 21.
 *  Never true for a hand created by a split (see .claude/Blackjack.md → "Split"). */
export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21
}
