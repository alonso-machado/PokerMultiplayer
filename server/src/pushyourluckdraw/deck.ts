import type { PushYourLuckDrawCard, Rank, Suit } from '../../../shared/types'

// One suit cycled purely for visual variety on duplicate copies — suit has
// no rule meaning in this game (see .claude/PushYourLuckDraw.md → "Baralho").
const DISPLAY_SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']

const NUMBER_RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

/** copies(rank) = value(rank) for every numbered/face rank (so the 7 has 7
 *  copies, the K has 13) + a single Ace of Spades (the ×2 multiplier card) +
 *  4 Jokers = 95 cards total. See .claude/PushYourLuckDraw.md → "Baralho". */
export function buildDeck(): PushYourLuckDrawCard[] {
  const deck: PushYourLuckDrawCard[] = [
    { id: 'ace-of-spades', suit: 'spades', rank: 'A', isJoker: false },
  ]
  for (const rank of NUMBER_RANKS) {
    const copies = rankPoints(rank)
    for (let i = 0; i < copies; i++) {
      deck.push({ id: `${rank}-${i}`, suit: DISPLAY_SUITS[i % DISPLAY_SUITS.length]!, rank, isJoker: false })
    }
  }
  for (let i = 1; i <= 4; i++) {
    deck.push({ id: `joker-${i}`, suit: null, rank: null, isJoker: true })
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

/** Scoring value of a single rank — 2 through 10 at face value, J=11, Q=12,
 *  K=13. Not defined for 'A' (the Ace of Spades never adds its own value —
 *  see .claude/PushYourLuckDraw.md → "Poder do Ás de Espadas"). */
export function rankPoints(rank: Rank): number {
  switch (rank) {
    case 'J': return 11
    case 'Q': return 12
    case 'K': return 13
    case 'A': return 0
    default: return Number(rank)
  }
}

export function isAceOfSpades(card: PushYourLuckDrawCard): boolean {
  return !card.isJoker && card.suit === 'spades' && card.rank === 'A'
}
