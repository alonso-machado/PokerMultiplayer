import type { Card, Suit, Rank } from '../../../shared/types'

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']

// Truco Gaúcho base ranking (weakest → strongest). No 8/9/10, no jokers.
// Differs from Truco Paulista/Mineiro: J (Sota) comes *before* Q (Caballo) —
// see .claude/TrucoGaucho.md → "Ranking base das cartas".
const BASE_RANKS: Rank[] = ['4', '5', '6', '7', 'J', 'Q', 'K', 'A', '2', '3']

// Fixed manilhas (weakest → strongest) — always these 4 specific cards, no
// vira, never changes during a match. See .claude/TrucoGaucho.md → "Manilhas".
export const FIXED_MANILHAS: Card[] = [
  { suit: 'diamonds', rank: '7' }, // 7♦ (weakest)
  { suit: 'spades', rank: '7' },   // 7♠
  { suit: 'clubs', rank: 'A' },    // A♣ ("Basto")
  { suit: 'spades', rank: 'A' },   // A♠ ("Espadilha", strongest)
]

export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of BASE_RANKS) {
      deck.push({ suit, rank })
    }
  }
  return deck
}

export function shuffle(deck: Card[]): Card[] {
  const d = [...deck]
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[d[i], d[j]] = [d[j]!, d[i]!]
  }
  return d
}

function manilhaIndex(card: Card): number {
  return FIXED_MANILHAS.findIndex((m) => m.suit === card.suit && m.rank === card.rank)
}

/** Strength of a card — higher wins. Manilhas always outrank non-manilhas;
 *  among manilhas, position in FIXED_MANILHAS breaks ties. Among
 *  non-manilhas: base rank order — equal rank across different suits is a
 *  true tie (see .claude/Truco.md → "Empate de vaza", reused by this variant). */
export function cardStrength(card: Card): number {
  const mi = manilhaIndex(card)
  if (mi !== -1) return 1000 + mi
  return BASE_RANKS.indexOf(card.rank)
}

/** > 0 if a beats b, < 0 if b beats a, 0 if they tie. */
export function compareCards(a: Card, b: Card): number {
  return cardStrength(a) - cardStrength(b)
}

// ── Envido / Flor ───────────────────────────────────────────────────────────

/** Per-card point value for envido/flor math: A=1, 2-7=face, J/Q/K=0.
 *  (8/9/10 never appear in this 40-card deck — included only for type totality.) */
function envidoPoint(rank: Rank): number {
  switch (rank) {
    case 'A': return 1
    case '2': return 2
    case '3': return 3
    case '4': return 4
    case '5': return 5
    case '6': return 6
    case '7': return 7
    default: return 0
  }
}

/** Envido value of a 3-card hand: best same-suit pair's point sum + 20, or
 *  the single highest card's value if no two cards share a suit. See
 *  .claude/TrucoGaucho.md → "Envido". */
export function envidoValue(cards: Card[]): number {
  let bestPair = -1
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (cards[i]!.suit === cards[j]!.suit) {
        const sum = envidoPoint(cards[i]!.rank) + envidoPoint(cards[j]!.rank) + 20
        if (sum > bestPair) bestPair = sum
      }
    }
  }
  if (bestPair !== -1) return bestPair
  return Math.max(...cards.map((c) => envidoPoint(c.rank)))
}

/** True when all 3 cards share a suit — auto-detected "flor" at deal time. */
export function hasFlor(cards: Card[]): boolean {
  return cards.length === 3 && cards[0]!.suit === cards[1]!.suit && cards[1]!.suit === cards[2]!.suit
}

/** Flor value: sum of the 3 same-suit cards' points + 20. Only meaningful
 *  when hasFlor(cards) is true. */
export function florValue(cards: Card[]): number {
  return cards.reduce((sum, c) => sum + envidoPoint(c.rank), 0) + 20
}
