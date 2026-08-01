import type { Card, Suit, Rank, TrucoManilhaVariant } from '../../../shared/types'

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']

// Truco base ranking (weakest → strongest). No 8/9/10, no jokers.
const BASE_RANKS: Rank[] = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3']

// Manilha suit strength — strongest → weakest, Paus (Zap) > Copas > Espadas
// (Espadilha) > Ouros. This naming/order is the same in both variants: in
// 'vira' all 4 manilhas share a rank (one per suit); in 'fixed' each manilha
// is a different rank, but each still belongs to one of these 4 suits, so
// the exact same suit ranking decides which one wins.
const SUIT_STRENGTH: Record<Suit, number> = { clubs: 4, hearts: 3, spades: 2, diamonds: 1 }

// Fixed manilhas for the 'fixed' variant (Mineiro), strongest → weakest:
// 4♣ (Zap) > 7♥ (Copas) > A♠ (Espadilha) > 7♦ (Ouros).
const FIXED_MANILHAS: Card[] = [
  { suit: 'clubs', rank: '4' },    // 4♣ (Zap)
  { suit: 'hearts', rank: '7' },   // 7♥ (Copas)
  { suit: 'spades', rank: 'A' },   // A♠ (Espadilha)
  { suit: 'diamonds', rank: '7' }, // 7♦ (Ouros)
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

export interface ManilhaContext {
  variant: TrucoManilhaVariant
  vira: Card | null    // null when variant === 'fixed'
  manilhaCards: Card[] // the 4 cards that count as manilha this hand
}

/**
 * Resolves the manilha context for a new hand. For the 'vira' variant this
 * draws (pops) the vira card from `deck` — call after shuffling, before
 * dealing hole cards.
 */
export function resolveManilha(variant: TrucoManilhaVariant, deck: Card[]): ManilhaContext {
  if (variant === 'fixed') {
    return { variant, vira: null, manilhaCards: FIXED_MANILHAS }
  }
  const vira = deck.pop()
  if (!vira) throw new Error('deck exhausted before drawing vira')
  const viraIdx = BASE_RANKS.indexOf(vira.rank)
  const manilhaRank = BASE_RANKS[(viraIdx + 1) % BASE_RANKS.length]!
  const manilhaCards = SUITS.map((suit) => ({ suit, rank: manilhaRank }))
  return { variant, vira, manilhaCards }
}

function isManilha(card: Card, ctx: ManilhaContext): boolean {
  return ctx.manilhaCards.some((m) => m.suit === card.suit && m.rank === card.rank)
}

/**
 * Strength of a card given the hand's manilha context — higher wins.
 * Manilhas always outrank non-manilhas. Among manilhas, suit order breaks
 * ties (Zap > Copas > Espadilha > Ouros — same rule in both variants, see
 * `SUIT_STRENGTH` above). Among non-manilhas: base rank order — equal rank
 * across different suits is a true tie (see .claude/Truco.md → "Empate de
 * vaza").
 */
export function cardStrength(card: Card, ctx: ManilhaContext): number {
  if (isManilha(card, ctx)) return 1000 + SUIT_STRENGTH[card.suit]
  return BASE_RANKS.indexOf(card.rank)
}

/** > 0 if a beats b, < 0 if b beats a, 0 if they tie. */
export function compareCards(a: Card, b: Card, ctx: ManilhaContext): number {
  return cardStrength(a, ctx) - cardStrength(b, ctx)
}
